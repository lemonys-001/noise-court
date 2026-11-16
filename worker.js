import { Room } from './server/room.js';
import { json } from './server/util.js';

export { Room };

export default {
  async fetch(request, env) {
    const path = new URL(request.url).pathname;
    try {
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
