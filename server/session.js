import { b64urlEncode, b64urlDecode, getCookie, enc, dec, hmac } from './util.js';

const NAME = '__Host-nc_session';
const MAX_AGE = 30 * 24 * 3600;

export async function createSession(env, user) {
  const payload = {
    sub: String(user.sub).slice(0, 64),
    name: String(user.name || 'Player').slice(0, 18),
    pic: String(user.pic || '').slice(0, 300),
    exp: Math.floor(Date.now() / 1000) + MAX_AGE,
  };
  const body = b64urlEncode(enc(JSON.stringify(payload)));
  const sig = b64urlEncode(await hmac(env.SESSION_SECRET, body));
  return {
    token: `${body}.${sig}`,
    cookie: `${NAME}=${body}.${sig}; Path=/; Max-Age=${MAX_AGE}; Secure; HttpOnly; SameSite=Lax`,
  };
}

export async function readSession(request, env) {
  try {
    const token = getCookie(request, NAME);
    if (!token || !env.SESSION_SECRET) return null;
    const dot = token.indexOf('.');
    if (dot === -1) return null;
    const body = token.slice(0, dot);
    const sig = token.slice(dot + 1);
    const expected = b64urlEncode(await hmac(env.SESSION_SECRET, body));
    if (sig.length !== expected.length || sig !== expected) return null;
    const payload = JSON.parse(dec(b64urlDecode(body)));
    if (!payload.sub || payload.exp * 1000 < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

export function clearSessionCookie() {
  return `${NAME}=; Path=/; Max-Age=0; Secure; HttpOnly; SameSite=Lax`;
}
