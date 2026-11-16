# Noise Court

A browser voice party game — one sound, one shot. The room hears a reference
sound, everyone gets a single take to mimic it with their own voice, a local
pitch/rhythm matcher grades it 0–100, and a wheel deals out points, multipliers
and sabotages between rounds.

Independent fan-styled game inspired by Mimic Party (FoliesAPP). No official
assets, audio or branding are used.

## Modes

- **Solo** — Just Play (4 sounds), Survival (rising targets, 3 lives), Daily Streak (UTC-seeded picks)
- **Pass the mic** — 2–5 friends on one device, turn-based
- **Online rooms** — private room codes, 2–5 players on separate devices, takes replayed to everyone with sabotage effects

## Stack

- React + Vite SPA, plain CSS
- Single Cloudflare Worker: static assets + `/api/*` + WebSocket rooms
- Durable Objects (SQLite): `Room` (realtime game state) and `Leaderboard`
- Google Sign-In (GIS ID token) verified server-side with Google's JWKS → signed `__Host-` session cookie
- Scoring is client-side DSP (autocorrelation pitch + banded DTW vs the reference). No audio leaves your device except optional take sharing in online rooms.

## Sounds

Drop your own audio files into `public/sounds/` (mp3/ogg/m4a/wav/webm), then:

```
npm run sounds
```

regenerates `public/sounds/manifest.json`. No files? The app synthesizes four
demo sounds in-browser so it always runs. Use headphones — the reference bleed
into your mic hurts your score.

## Develop

```
cp .dev.vars.example .dev.vars   # set a SESSION_SECRET (any random string)
npm install
npm run dev:cf                   # build + wrangler dev (full stack, http://localhost:8787)
npm test                         # scoring unit tests (node --test)
npm run smoke                    # end-to-end room test (2 WS clients through a real DO)
```

`DEV_BYPASS_AUTH=1` in `.dev.vars` lets smoke tests join rooms without Google.

## Deploy

1. **Google client**: Google Cloud Console → APIs & Services → Credentials →
   OAuth client ID (Web). Authorized JavaScript origins:
   `https://<your-worker>.<account>.workers.dev` (and `http://localhost:8787` for dev).
2. **Secrets**:
   ```
   wrangler login
   npx wrangler secret put SESSION_SECRET   # long random string
   npx wrangler secret put GOOGLE_CLIENT_ID # the OAuth client ID
   ```
3. **Deploy** (Durable Object migration runs automatically on first deploy):
   ```
   npm run deploy
   ```
4. Optional: attach a custom domain in the Cloudflare dashboard.

Free plan is enough: Workers static assets + SQLite Durable Objects.

## Limits / notes

- Scores are computed in the browser and trusted by the room server — fine for
  playing with friends, not an anti-cheat boundary.
- Online takes (≤ ~10 s, ≤ 96 KB base64) live in the Room DO and are deleted
  when the room ends (2 h TTL, or 10 min after everyone leaves).
- No live voice chat; open your own call. 120 s per round, then a missing take scores 0.
- The wheel is server-side RNG: 45% nothing, 20% +50, 15% ×2, 10% ×½, 10% sabotage
  (saturation / echo / pitch drop / chop / fart) on the victim's next take.
