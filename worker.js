import { Room } from './server/room.js';
import { Leaderboard } from './server/leaderboard.js';
import { verifyGoogleIdToken } from './server/google.js';
import { createSession, readSession, clearSessionCookie } from './server/session.js';
import { json } from './server/util.js';

export { Room, Leaderboard };

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;
    try {
      if (path === '/api/config') {
        return json({ clientId: env.GOOGLE_CLIENT_ID || null });
      }

      if (path === '/api/auth/google' && request.method === 'POST') {
        const { credential } = await request.json();
        if (typeof credential !== 'string' || credential.length > 4096) {
          return json({ error: 'bad credential' }, 400);
        }
        if (!env.GOOGLE_CLIENT_ID || !env.SESSION_SECRET) {
          return json({ error: 'auth not configured (set GOOGLE_CLIENT_ID and SESSION_SECRET)' }, 500);
        }
        const user = await verifyGoogleIdToken(credential, env.GOOGLE_CLIENT_ID);
        const { cookie } = await createSession(env, user);
        return json({ user: { sub: user.sub, name: user.name, pic: user.pic } }, 200, { 'set-cookie': cookie });
      }

      if (path === '/api/me') {
        const s = await readSession(request, env);
        return json({ user: s ? { sub: s.sub, name: s.name, pic: s.pic } : null });
      }

      if (path === '/api/logout' && request.method === 'POST') {
        return json({ ok: true }, 200, { 'set-cookie': clearSessionCookie() });
      }

      if (path === '/api/leaderboard') {
        const stub = env.LEADERBOARD.get(env.LEADERBOARD.idFromName('global'));
        const res = await stub.fetch('https://lb/top');
        return new Response(res.body, res);
      }

      if (path === '/api/score' && request.method === 'POST') {
        const s = await readSession(request, env);
        if (!s) return json({ error: 'sign in first' }, 401);
        const body = await request.json();
        const n = Number(body.best);
        if (!Number.isFinite(n) || n < 0 || n > 100000) return json({ error: 'bad score' }, 400);
        const stub = env.LEADERBOARD.get(env.LEADERBOARD.idFromName('global'));
        const res = await stub.fetch('https://lb/post', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ sub: s.sub, name: s.name, pic: s.pic, best: n }),
        });
        return new Response(res.body, res);
      }

      const m = path.match(/^\/api\/room\/([A-Za-z0-9]{3,8})$/);
      if (m) {
        const stub = env.ROOM.get(env.ROOM.idFromName(m[1].toUpperCase()));
        return await stub.fetch(request);
      }

      if (path.startsWith('/api/')) return json({ error: 'not found' }, 404);
    } catch (e) {
      return json({ error: String((e && e.message) || e) }, 500);
    }
    return env.ASSETS.fetch(request);
  },
};
