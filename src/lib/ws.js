export function roomSocket(code, { onMsg, onClose }) {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  const ws = new WebSocket(`${proto}://${location.host}/api/room/${code}`);
  let open = false;
  ws.onopen = () => { open = true; };
  ws.onmessage = (e) => {
    try { onMsg(JSON.parse(e.data)); } catch {}
  };
  ws.onclose = (e) => onClose && onClose(e);
  return {
    send(o) {
      if (ws.readyState === 1) ws.send(JSON.stringify(o));
      else if (!open) setTimeout(() => this.send(o), 200);
    },
    close() {
      onClose = null;
      ws.close();
    },
  };
}
