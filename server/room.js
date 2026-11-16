import { readSession } from './session.js';
import { json } from './util.js';

const MAX_PLAYERS = 5;
const ROUND_MS = 120000;
const ROOM_TTL_MS = 2 * 3600e3;
const EMPTY_TTL_MS = 10 * 60e3;
const MAX_AUDIO_B64 = 96 * 1024;
const SAB_EFFECTS = ['saturate', 'echo', 'pitch', 'chop', 'fart'];

const clamp = (n, a, b) => Math.min(b, Math.max(a, n));

function rnd() {
  const a = new Uint32Array(1);
  crypto.getRandomValues(a);
  return a[0] / 0x100000000;
}

function randCard() {
  const r = rnd();
  if (r < 0.45) return { k: 'none' };
  if (r < 0.65) return { k: 'bonus50' };
  if (r < 0.8) return { k: 'mult2' };
  if (r < 0.9) return { k: 'mult05' };
  return { k: 'sab', e: SAB_EFFECTS[Math.floor(rnd() * SAB_EFFECTS.length)] };
}

export class Room {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;
    this.s = null;
  }

  async load() {
    if (!this.s) this.s = (await this.ctx.storage.get('s')) || null;
    return this.s;
  }

  async save() {
    await this.ctx.storage.put('s', this.s);
  }

  async broadcast(msg) {
    const data = JSON.stringify(msg);
    for (const ws of this.ctx.getWebSockets()) {
      try { ws.send(data); } catch {}
    }
  }

  snapshot() {
    const s = this.s;
    return {
      t: 'state',
      code: s.code,
      phase: s.phase,
      hostSub: s.hostSub,
      roundIdx: s.roundIdx,
      deckLen: s.deck.length,
      soundId: s.soundId,
      deadline: s.deadline,
      players: s.order.map((sub) => {
        const p = s.players[sub];
        return { sub: p.sub, name: p.name, pic: p.pic, ready: p.ready, connected: p.connected, score: p.score, card: p.card };
      }),
    };
  }

  async arm() {
    const s = this.s;
    if (!s) return;
    const times = [s.created + ROOM_TTL_MS];
    if (s.phase === 'round' && s.deadline) times.push(s.deadline);
    if (s.emptyAt) times.push(s.emptyAt + EMPTY_TTL_MS);
    await this.ctx.storage.setAlarm(Math.min(...times));
  }

  async wipe(reason) {
    this.broadcast({ t: 'close', msg: reason });
    for (const ws of this.ctx.getWebSockets()) {
      try { ws.close(1000, reason); } catch {}
    }
    await this.ctx.storage.deleteAll();
    this.s = null;
  }

  async fetch(request) {
    if ((request.headers.get('upgrade') || '').toLowerCase() !== 'websocket') {
      return json({ error: 'websocket only' }, 426);
    }
    const s = await this.load();
    const url = new URL(request.url);
    const code = url.pathname.split('/').pop().toUpperCase();

    let user = null;
    try { user = await readSession(request, this.env); } catch {}
    if (!user && this.env.DEV_BYPASS_AUTH === '1') {
      const u = url.searchParams.get('u');
      if (u) {
        try { user = JSON.parse(atob(u.replace(/-/g, '+').replace(/_/g, '/'))); } catch {}
      }
    }
    if (!user || !user.sub) return json({ error: 'Sign in with Google to play online' }, 401);

    const sub = String(user.sub).slice(0, 64);
    const name = String(user.name || 'Player').slice(0, 18).trim() || 'Player';
    const pic = String(user.pic || '').slice(0, 300);

    if (!s) {
      this.s = {
        code, created: Date.now(), hostSub: sub, players: {}, order: [],
        phase: 'lobby', deck: [], roundIdx: -1, soundId: null, deadline: 0,
        takes: {}, emptyAt: null,
      };
    }
    if (!this.s.players[sub] && this.s.order.length >= MAX_PLAYERS) {
      return json({ error: 'Room is full (5 players max)' }, 403);
    }
    let p = this.s.players[sub];
    if (!p) {
      p = this.s.players[sub] = {
        sub, name, pic, ready: false, connected: false,
        score: 0, bonus: 0, mult: 1, sab: null, card: null, roundReady: false,
      };
      this.s.order.push(sub);
    }
    p.name = name;
    p.pic = pic;
    p.connected = true;
    this.s.emptyAt = null;
    await this.save();

    const pair = new WebSocketPair();
    this.ctx.acceptWebSocket(pair[1], [sub]);
    await this.arm();
    await this.broadcast(this.snapshot());
    return new Response(null, { status: 101, webSocket: pair[0] });
  }

  async onAlarm() {
    const s = await this.load();
    if (!s) return;
    const now = Date.now();
    if (now >= s.created + ROOM_TTL_MS) return this.wipe('Room expired');
    if (s.emptyAt && now >= s.emptyAt + EMPTY_TTL_MS) return this.wipe('Room closed');
    if (s.phase === 'round' && now >= s.deadline) await this.finalize();
    await this.arm();
  }

  async webSocketMessage(ws, raw) {
    const s = await this.load();
    if (!s) return;
    let m;
    try {
      m = JSON.parse(typeof raw === 'string' ? raw : new TextDecoder().decode(raw));
    } catch {
      return;
    }
    const tag = this.ctx.getTags(ws)[0];
    const p = s.players[tag];
    if (!p) return;

    switch (m.t) {
      case 'ping':
        try { ws.send('{"t":"pong"}'); } catch {}
        break;

      case 'ready':
        if (s.phase === 'lobby') {
          p.ready = !!m.v;
          await this.save();
          this.broadcast(this.snapshot());
        }
        break;

      case 'start': {
        if (p.sub !== s.hostSub || s.phase !== 'lobby') return;
        const deck = Array.isArray(m.deck) ? m.deck.filter((x) => typeof x === 'string' && x.length <= 64) : [];
        if (deck.length < 1 || deck.length > 12) return;
        for (const q of s.order) {
          const pl = s.players[q];
          pl.score = 0; pl.bonus = 0; pl.mult = 1; pl.sab = null; pl.card = null; pl.roundReady = false;
        }
        s.deck = deck;
        s.roundIdx = -1;
        await this.save();
        await this.nextRound();
        break;
      }

      case 'roundReady':
        if (s.phase === 'round' && !p.roundReady) {
          p.roundReady = true;
          await this.save();
          const all = s.order.every((sub) => !s.players[sub].connected || s.players[sub].roundReady);
          if (all) {
            for (const q of s.order) s.players[q].roundReady = false;
            await this.save();
            this.broadcast({ t: 'go' });
          }
        }
        break;

      case 'submit': {
        if (s.phase !== 'round' || Date.now() > s.deadline + 3000 || s.takes[p.sub]) return;
        const audio = typeof m.audio === 'string' && m.audio.length <= MAX_AUDIO_B64 ? m.audio : null;
        s.takes[p.sub] = {
          score: clamp(Math.round(Number(m.score)) || 0, 0, 100),
          audio,
          dur: clamp(Math.round(Number(m.dur)) || 0, 0, 20000),
        };
        await this.save();
        const submitted = s.order.filter((q) => s.takes[q]).length;
        this.broadcast({ t: 'submitted', who: p.sub, n: submitted, need: s.order.length });
        const all = s.order.every((q) => s.takes[q] || !s.players[q].connected);
        if (all) await this.finalize();
        break;
      }

      case 'advance':
        if (p.sub === s.hostSub && (s.phase === 'takes' || s.phase === 'wheel')) {
          await this.nextRound();
        }
        break;

      case 'again':
        if (p.sub === s.hostSub && s.phase === 'end') {
          s.phase = 'lobby';
          s.roundIdx = -1;
          s.soundId = null;
          s.deck = [];
          s.takes = {};
          for (const q of s.order) {
            const pl = s.players[q];
            pl.score = 0; pl.bonus = 0; pl.mult = 1; pl.sab = null; pl.card = null;
          }
          await this.save();
          this.broadcast(this.snapshot());
        }
        break;
    }
  }

  async nextRound() {
    const s = this.s;
    s.roundIdx++;
    if (s.roundIdx >= s.deck.length) {
      s.phase = 'end';
      s.soundId = null;
      await this.save();
      this.broadcast({
        t: 'end',
        standings: [...s.order]
          .map((sub) => ({ sub, name: s.players[sub].name, score: s.players[sub].score }))
          .sort((a, b) => b.score - a.score),
      });
      await this.arm();
      return;
    }
    s.soundId = s.deck[s.roundIdx];
    s.phase = 'round';
    s.deadline = Date.now() + ROUND_MS;
    s.takes = {};
    for (const q of s.order) s.players[q].roundReady = false;
    await this.save();
    this.broadcast(this.snapshot());
    this.broadcast({ t: 'round', i: s.roundIdx, sound: s.soundId, deadline: s.deadline });
    await this.arm();
  }

  async finalize() {
    const s = this.s;
    if (s.phase !== 'round') return;
    s.phase = 'takes';
    const takes = s.order.map((sub) => {
      const p = s.players[sub];
      const t = s.takes[sub];
      let final = Math.round((t ? t.score : 0) * (p.mult || 1)) + (p.bonus || 0);
      if (p.sab) final = Math.round(final * 0.85);
      final = clamp(final, 0, 110);
      p.score += final;
      return { sub, name: p.name, score: final, raw: t ? t.score : 0, audio: t ? t.audio : null, sab: p.sab };
    });
    for (const q of s.order) {
      const p = s.players[q];
      p.bonus = 0; p.mult = 1; p.sab = null; p.card = null;
    }
    this.broadcast({ t: 'takes', i: s.roundIdx, takes });

    const cards = {};
    for (const sub of s.order) {
      const p = s.players[sub];
      const c = randCard();
      cards[sub] = c;
      p.card = c;
      if (c.k === 'bonus50') p.bonus = 50;
      else if (c.k === 'mult2') p.mult = 2;
      else if (c.k === 'mult05') p.mult = 0.5;
      else if (c.k === 'sab') p.sab = c.e;
    }
    s.phase = 'wheel';
    await this.save();
    this.broadcast({ t: 'wheel', cards });
    await this.arm();
  }

  async webSocketClose(ws) {
    const s = await this.load();
    if (!s) return;
    const tag = this.ctx.getTags(ws)[0];
    const p = s.players[tag];
    if (!p) return;
    p.connected = false;
    if (!s.order.some((sub) => s.players[sub].connected)) {
      s.emptyAt = Date.now();
    }
    await this.save();
    this.broadcast(this.snapshot());
    await this.arm();
  }

  async webSocketError() {}
}
