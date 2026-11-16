import { b64urlDecode, dec, enc } from './util.js';

let jwksCache = null;
let jwksAt = 0;

async function getJwks() {
  if (jwksCache && Date.now() - jwksAt < 6 * 3600e3) return jwksCache;
  const res = await fetch('https://www.googleapis.com/oauth2/v3/certs');
  if (!res.ok) throw new Error('jwks fetch failed');
  jwksCache = await res.json();
  jwksAt = Date.now();
  return jwksCache;
}

export async function verifyGoogleIdToken(token, clientId) {
  if (!clientId) throw new Error('auth not configured');
  const parts = token.split('.');
  if (parts.length !== 3) throw new Error('bad token');
  const header = JSON.parse(dec(b64urlDecode(parts[0])));
  const { keys } = await getJwks();
  const jwk = keys.find((k) => k.kid === header.kid);
  if (!jwk) throw new Error('unknown signing key');
  const key = await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
  const ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, b64urlDecode(parts[2]), enc(`${parts[0]}.${parts[1]}`));
  if (!ok) throw new Error('bad signature');
  const claims = JSON.parse(dec(b64urlDecode(parts[1])));
  if (claims.aud !== clientId) throw new Error('wrong audience');
  if (claims.exp * 1000 < Date.now()) throw new Error('expired token');
  if (!['accounts.google.com', 'https://accounts.google.com'].includes(claims.iss)) throw new Error('bad issuer');
  return {
    sub: claims.sub,
    name: claims.name || 'Player',
    pic: claims.picture || '',
  };
}
