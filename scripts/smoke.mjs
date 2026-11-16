// End-to-end room test: two WS clients join, start, submit, replay, wheel.
// Login-free identity: each client passes pid + name in the query string.
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { unstable_dev } from 'wrangler';
import WebSocket from 'ws';

if (!existsSync('dist')) {
  console.log('building frontend first…');
  execSync('npm run build', { stdio: 'inherit' });
}

function client(url) {
  const ws = new WebSocket(url);
  const queue = [];
  const waiters = [];
  ws.on('message', (d) => {
    const m = JSON.parse(d.toString());
    const i = waiters.findIndex((w) => w.type === m.t);
    if (i !== -1) waiters.splice(i, 1)[0].res(m);
    else queue.push(m);
  });
  const open = new Promise((res, rej) => {
    ws.on('open', res);
    ws.on('error', rej);
    ws.on('unexpected-response', (_req, r) => rej(new Error('ws rejected: ' + r.statusCode)));
  });
  return {
    send: (o) => ws.send(JSON.stringify(o)),
    wait(type, ms = 8000) {
      const i = queue.findIndex((m) => m.t === type);
      if (i !== -1) return Promise.resolve(queue.splice(i, 1)[0]);
      return new Promise((res, rej) => {
        waiters.push({ type, res });
        setTimeout(() => rej(new Error('timeout waiting for ' + type)), ms);
      });
    },
    close: () => ws.close(),
    open,
  };
}


let worker;
try {
  worker = await unstable_dev('worker.js', { experimental: { disableExperimentalWarning: true } });
  const base = `http://127.0.0.1:${worker.port}`;

  assert.ok((await (await fetch(base)).text()).includes('root'), 'static assets served');

  const wsBase = `ws://127.0.0.1:${worker.port}/api/room/SMOK`;
  const c1 = client(`${wsBase}?pid=smoke-u1&name=Al`);
  const c2 = client(`${wsBase}?pid=smoke-u2&name=Bo`);
  await Promise.all([c1.open, c2.open]);

  const s1 = await c1.wait('state');
  assert.equal(s1.phase, 'lobby');
  assert.equal(s1.players.length, 1);
  await c2.wait('state');

  // both ready, host starts
  c1.send({ t: 'ready', v: true });
  c2.send({ t: 'ready', v: true });
  c1.send({ t: 'start', deck: ['siren', 'beep', 'boing'] });

  const r1 = await c1.wait('round');
  const r2 = await c2.wait('round');
  assert.equal(r1.i, 0);
  assert.equal(r1.sound, 'siren');
  assert.deepEqual(r2, r1);

  c1.send({ t: 'roundReady' });
  c2.send({ t: 'roundReady' });
  await c1.wait('go');
  await c2.wait('go');

  c1.send({ t: 'submit', score: 50, audio: null, dur: 1000 });
  await c1.wait('submitted');
  c2.send({ t: 'submit', score: 70, audio: null, dur: 1000 });

  const takes = await c1.wait('takes');
  assert.equal(takes.takes.length, 2);
  assert.deepEqual(
    takes.takes.map((t) => t.score).sort((a, b) => a - b),
    [50, 70]
  );
  await c1.wait('wheel');
  await c2.wait('wheel');

  // round 2
  c1.send({ t: 'advance' });
  const r2b = await c1.wait('round');
  assert.equal(r2b.i, 1);
  c1.send({ t: 'roundReady' });
  c2.send({ t: 'roundReady' });
  await c1.wait('go');
  c1.send({ t: 'submit', score: 10, audio: null, dur: 500 });
  c2.send({ t: 'submit', score: 20, audio: null, dur: 500 });
  await c1.wait('takes');
  await c1.wait('wheel');

  // round 3 then end
  c1.send({ t: 'advance' });
  const r3 = await c1.wait('round');
  assert.equal(r3.i, 2);
  c1.send({ t: 'roundReady' });
  c2.send({ t: 'roundReady' });
  await c1.wait('go');
  c1.send({ t: 'submit', score: 30, audio: null, dur: 500 });
  c2.send({ t: 'submit', score: 40, audio: null, dur: 500 });
  await c1.wait('takes');
  await c1.wait('wheel');
  c1.send({ t: 'advance' });
  const end = await c1.wait('end');
  assert.equal(end.standings.length, 2);
  assert.ok(end.standings[0].score >= end.standings[1].score);

  c1.close();
  c2.close();
  console.log('SMOKE OK: lobby → 3 rounds → wheel → standings all behaved');
} finally {
  if (worker) await worker.stop();
}
