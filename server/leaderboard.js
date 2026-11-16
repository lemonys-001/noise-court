export class Leaderboard {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;
    this.ready = false;
  }

  async ensure() {
    if (this.ready) return;
    this.ctx.storage.sql.exec(
      `CREATE TABLE IF NOT EXISTS scores (
        sub TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        pic TEXT NOT NULL DEFAULT '',
        best INTEGER NOT NULL DEFAULT 0,
        plays INTEGER NOT NULL DEFAULT 0,
        updated INTEGER NOT NULL DEFAULT 0
      )`
    );
    this.ready = true;
  }

  async fetch(request) {
    await this.ensure();
    const url = new URL(request.url);
    if (url.pathname === '/top') {
      const rows = [...this.ctx.storage.sql.exec(
        'SELECT name, pic, best, plays FROM scores ORDER BY best DESC, updated ASC LIMIT 25'
      )];
      return Response.json({ top: rows });
    }
    if (url.pathname === '/post' && request.method === 'POST') {
      const { sub, name, pic, best } = await request.json();
      if (typeof sub !== 'string' || !sub || sub.length > 64) {
        return Response.json({ error: 'bad input' }, { status: 400 });
      }
      const n = Number(best);
      if (!Number.isFinite(n) || n < 0 || n > 100000) {
        return Response.json({ error: 'bad score' }, { status: 400 });
      }
      this.ctx.storage.sql.exec(
        `INSERT INTO scores (sub, name, pic, best, plays, updated)
         VALUES (?, ?, ?, ?, 1, ?)
         ON CONFLICT(sub) DO UPDATE SET
           name = excluded.name,
           pic = excluded.pic,
           best = MAX(best, excluded.best),
           plays = plays + 1,
           updated = excluded.updated`,
        sub, String(name || 'Player').slice(0, 40), String(pic || '').slice(0, 300),
        Math.floor(n), Date.now()
      );
      return Response.json({ ok: true });
    }
    return Response.json({ error: 'not found' }, { status: 404 });
  }
}
