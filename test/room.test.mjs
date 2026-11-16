import test from 'node:test';
import assert from 'node:assert/strict';
import { Room } from '../server/room.js';

class MockWs {
  constructor() { this.sent = []; this.closed = false; }
  send(d) { this.sent.push(JSON.parse(d)); }
  close() { this.closed = true; }
  last(t) { return [...this.sent].reverse().find((m) => m.t === t) || null; }
}

globalThis.WebSocketPair = class {
  constructor() { this[0] = new MockWs(); this[1] = new MockWs(); }
};

// Node's Response rejects status 101 (WebSocket upgrade); Workers allows it.
const RealResponse = globalThis.Response;
globalThis.Response = class extends RealResponse {
  constructor(body, init = {}) {
    if (init.status === 101) {
      super(body ?? null, { ...init, status: 200 });
      this._status = 101;
    } else {
      super(body, init);
    }
  }
  get status() { return this._status ?? super.status; }
};

function makeCtx() {
  const store = new Map();
  const sockets = [];
  return {
    sockets,
    storage: {
      get: async (k) => store.get(k),
      put: async (k, v) => store.set(k, v),
      deleteAll: async () => store.clear(),
      setAlarm: async () => {},
    },
    acceptWebSocket(ws, tags) { ws.tag = tags[0]; sockets.push(ws); },
    getWebSockets: () => sockets.filter((s) => !s.closed),
    getTags: (ws) => [ws.tag],
  };
}

const envNoBypass = { SESSION_SECRET: 'x' };
const env = { DEV_BYPASS_AUTH: '1', SESSION_SECRET: 'x' };

function joinReq(code, user) {
  let url = `https://test/api/room/${code}`;
  if (user) url += `?u=${encodeURIComponent(Buffer.from(JSON.stringify(user)).toString('base64url'))}`;
  return new Request(url, { headers: { upgrade: 'websocket' } });
}

// One DO instance per code, like idFromName would give.
function harness() {
  const dos = new Map();
  return {
    async join(code, user, envOverride) {
      if (!dos.has(code)) {
        const ctx = makeCtx();
        dos.set(code, { ctx, room: new Room(ctx, envOverride || env) });
      }
      const { ctx, room } = dos.get(code);
      const res = await room.fetch(joinReq(code, user));
      return { res, ws: ctx.sockets.at(-1), ctx, room };
    },
  };
}

function msg(ws, m) { return ws ? ws.last(m) : null; }

test('room: full game lobby → 3 rounds → wheel → standings', async () => {
  const h = harness();
  const a = await h.join('SMOK', { sub: 'u1', name: 'Al' });
  assert.equal(a.res.status, 101);
  const b = await h.join('SMOK', { sub: 'u2', name: 'Bo' });
  assert.equal(b.res.status, 101);

  const st = msg(a.ws, 'state');
  assert.equal(st.phase, 'lobby');
  assert.equal(st.players.length, 2);

  await a.room.webSocketMessage(a.ws, JSON.stringify({ t: 'ready', v: true }));
  await b.room.webSocketMessage(b.ws, JSON.stringify({ t: 'ready', v: true }));
  await a.room.webSocketMessage(a.ws, JSON.stringify({ t: 'start', deck: ['demo:siren', 'demo:beep', 'demo:boing'] }));

  const round = msg(a.ws, 'round');
  assert.equal(round.i, 0);
  assert.equal(round.sound, 'demo:siren');

  await a.room.webSocketMessage(a.ws, JSON.stringify({ t: 'roundReady' }));
  await b.room.webSocketMessage(b.ws, JSON.stringify({ t: 'roundReady' }));
  assert.ok(msg(a.ws, 'go'), 'go broadcast after all ready');

  await a.room.webSocketMessage(a.ws, JSON.stringify({ t: 'submit', score: 50, audio: null, dur: 1000 }));
  await b.room.webSocketMessage(b.ws, JSON.stringify({ t: 'submit', score: 70, audio: null, dur: 1000 }));
  const takes = msg(a.ws, 'takes');
  assert.equal(takes.takes.length, 2);
  assert.deepEqual(takes.takes.map((t) => t.score).sort((x, y) => x - y), [50, 70]);
  const wheel = msg(a.ws, 'wheel');
  assert.equal(Object.keys(wheel.cards).length, 2);

  for (let i = 1; i <= 2; i++) {
    await a.room.webSocketMessage(a.ws, JSON.stringify({ t: 'advance' }));
    const r = msg(a.ws, 'round');
    assert.equal(r.i, i);
    await a.room.webSocketMessage(a.ws, JSON.stringify({ t: 'roundReady' }));
    await b.room.webSocketMessage(b.ws, JSON.stringify({ t: 'roundReady' }));
    await a.room.webSocketMessage(a.ws, JSON.stringify({ t: 'submit', score: 10 + i, audio: null, dur: 500 }));
    await b.room.webSocketMessage(b.ws, JSON.stringify({ t: 'submit', score: 20 + i, audio: null, dur: 500 }));
    assert.ok(msg(a.ws, 'takes'));
    assert.ok(msg(a.ws, 'wheel'));
  }
  await a.room.webSocketMessage(a.ws, JSON.stringify({ t: 'advance' }));
  const end = msg(a.ws, 'end');
  assert.equal(end.standings.length, 2);
  assert.ok(end.standings[0].score >= end.standings[1].score);
});

test('room: rejects unsigned joins when bypass is off', async () => {
  const h = harness();
  const { res } = await h.join('NOPE', { sub: 'u1', name: 'x' }, envNoBypass);
  assert.equal(res.status, 401);
});

test('room: caps at 5 players', async () => {
  const h = harness();
  for (let i = 1; i <= 5; i++) {
    const { res } = await h.join('FULL', { sub: `u${i}`, name: `p${i}` });
    assert.equal(res.status, 101);
  }
  const { res } = await h.join('FULL', { sub: 'u6', name: 'p6' });
  assert.equal(res.status, 403);
});

test('room: host-only controls and deck validation', async () => {
  const h = harness();
  const a = await h.join('CTRL', { sub: 'u1', name: 'host' });
  const b = await h.join('CTRL', { sub: 'u2', name: 'peer' });
  // non-host start is ignored
  await b.room.webSocketMessage(b.ws, JSON.stringify({ t: 'start', deck: ['x'] }));
  assert.equal(msg(b.ws, 'round'), null);
  // bad deck ignored
  await a.room.webSocketMessage(a.ws, JSON.stringify({ t: 'ready', v: true }));
  await b.room.webSocketMessage(b.ws, JSON.stringify({ t: 'ready', v: true }));
  await a.room.webSocketMessage(a.ws, JSON.stringify({ t: 'start', deck: 'nope' }));
  assert.equal(msg(a.ws, 'state').phase, 'lobby');
  // good deck starts
  await a.room.webSocketMessage(a.ws, JSON.stringify({ t: 'start', deck: ['demo:siren'] }));
  assert.equal(msg(a.ws, 'round').i, 0);
  // double submit ignored — first take (5) sticks, second (99) is dropped
  await a.room.webSocketMessage(a.ws, JSON.stringify({ t: 'submit', score: 5, audio: null, dur: 100 }));
  await a.room.webSocketMessage(a.ws, JSON.stringify({ t: 'submit', score: 99, audio: null, dur: 100 }));
  await b.room.webSocketMessage(b.ws, JSON.stringify({ t: 'roundReady' }));
  // deadline alarm finalizes: u1 keeps its submitted 5, u2 never submitted → 0
  const s = await a.room.ctx.storage.get('s');
  s.deadline = Date.now() - 1;
  await a.room.ctx.storage.put('s', s);
  await a.room.onAlarm();
  const takes = msg(a.ws, 'takes');
  assert.equal(takes.takes.length, 2);
  assert.equal(takes.takes.find((t) => t.sub === 'u1').score, 5);
  assert.equal(takes.takes.find((t) => t.sub === 'u2').score, 0);
});

test('room: disconnect marks player away, reconnect restores', async () => {
  const h = harness();
  const a = await h.join('DISC', { sub: 'u1', name: 'host' });
  const b = await h.join('DISC', { sub: 'u2', name: 'peer' });
  await b.room.webSocketClose(b.ws);
  let st = msg(a.ws, 'state');
  assert.equal(st.players.find((p) => p.sub === 'u2').connected, false);
  const b2 = await h.join('DISC', { sub: 'u2', name: 'peer' });
  assert.equal(b2.res.status, 101);
  st = msg(a.ws, 'state');
  assert.equal(st.players.find((p) => p.sub === 'u2').connected, true);
});
