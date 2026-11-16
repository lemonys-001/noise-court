import { useEffect, useRef, useState } from 'react';
import { api } from '../lib/api.js';

export default function UserChip({ session, setSession, clientId }) {
  const divRef = useRef(null);
  const [gsiReady, setGsiReady] = useState(!!window.google?.accounts?.id);

  useEffect(() => {
    if (!clientId || session || gsiReady) return;
    if (window.google?.accounts?.id) { setGsiReady(true); return; }
    const s = document.createElement('script');
    s.src = 'https://accounts.google.com/gsi/client';
    s.async = true;
    s.onload = () => setGsiReady(true);
    document.head.appendChild(s);
  }, [clientId, session, gsiReady]);

  useEffect(() => {
    if (!gsiReady || !clientId || session || !divRef.current) return;
    window.google.accounts.id.initialize({
      client_id: clientId,
      callback: async (r) => {
        try {
          const d = await api('/api/auth/google', { method: 'POST', body: { credential: r.credential } });
          setSession(d.user);
        } catch {}
      },
      auto_select: false,
    });
    window.google.accounts.id.renderButton(divRef.current, {
      theme: 'filled_black', size: 'medium', text: 'signin_with', shape: 'pill',
    });
  }, [gsiReady, clientId, session]);

  if (session) {
    return (
      <div className="userchip">
        {session.pic
          ? <img src={session.pic} alt="" referrerPolicy="no-referrer" />
          : <span className="avatar-fallback">{(session.name || '?')[0]}</span>}
        <span className="userchip-name">{session.name}</span>
        <button className="btn ghost" onClick={async () => { try { await api('/api/logout', { method: 'POST' }); } catch {} setSession(null); }}>
          Sign out
        </button>
      </div>
    );
  }
  if (clientId) return <div ref={divRef} className="gsi-slot" />;
  return null;
}
