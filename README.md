# Noise Court

A voice party game: one sound, one shot. The room hears a sound once, everyone
mimics it with their own voice in a single take of exactly the same length,
every take plays back, and a wheel hands out multipliers and sabotage.
Independent clone of the *Mimic Party* format — not affiliated with FoliesAPP
or the Steam release.

**No accounts.** You pick a nickname and get a stable browser id; a room code
is all that connects players. No sign-in, no secrets, no third-party auth.

## Modes

- **Solo** — Just Play (4 sounds), Survival (rising score targets, 3 lives),
  Daily Streak (4 sounds seeded from the UTC date). Personal best saved locally.
- **Pass the mic** — 2–5 friends on one device, turn by turn.
- **Room code** — online, 2–5 players on separate devices, hosted on a Cloudflare Worker.

## Sounds

Drop audio files into `public/sounds/` (mp3, ogg, m4a, wav, webm, aac, flac).
They are picked up automatically: `npm run dev` and `npm run build` both scan
the folder and regenerate `public/sounds/manifest.json`. To run it by hand:

```
node scripts/sounds.mjs
```

## Development

```
npm install
npm run dev        # vite dev server (frontend only; rooms need a deploy or wrangler dev)
npm test           # pure-DSP scoring tests + mock-DO room protocol tests
npm run smoke      # boots the real worker (workerd) and drives a full 2-player game
```

`npm run smoke` needs a machine that can run workerd; it is skipped in
restricted sandboxes.

## Deploy (Cloudflare Workers)

```
npm install -g wrangler   # or: npm i -D wrangler
wrangler login
npm run build
npm run deploy
```

`wrangler.jsonc` declares one Durable Object (`Room`, SQLite-backed) — nothing
else to configure, no env vars, no secrets.
