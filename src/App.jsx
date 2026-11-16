import { useEffect, useState } from 'react';
import Home from './screens/Home.jsx';
import Solo from './screens/Solo.jsx';
import Party from './screens/Party.jsx';
import Online from './screens/Online.jsx';
import UserChip from './components/UserChip.jsx';
import { api } from './lib/api.js';

export default function App() {
  const [hash, setHash] = useState(location.hash || '#/');
  const [session, setSession] = useState(undefined); // undefined = loading
  const [clientId, setClientId] = useState(null);

  useEffect(() => {
    const f = () => setHash(location.hash || '#/');
    addEventListener('hashchange', f);
    return () => removeEventListener('hashchange', f);
  }, []);

  useEffect(() => {
    api('/api/me').then((d) => setSession(d.user)).catch(() => setSession(null));
    api('/api/config').then((d) => setClientId(d.clientId)).catch(() => {});
  }, []);

  const parts = hash.replace(/^#\/?/, '').split('/');
  const route = parts[0] || '';
  const code = parts[1] || null;
  const go = (r) => { location.hash = `#/${r}`; };

  return (
    <div className="app">
      <header className="topbar">
        <button className="brand" onClick={() => { location.hash = '#/'; }}>NOISE COURT</button>
        <UserChip session={session} setSession={setSession} clientId={clientId} />
      </header>
      <main className="stage">
        {session === undefined ? (
          <div className="prep"><div className="spinner" /></div>
        ) : route === 'solo' ? (
          <Solo session={session} />
        ) : route === 'party' ? (
          <Party />
        ) : route === 'room' ? (
          <Online code={code} session={session} clientId={clientId} setSession={setSession} />
        ) : (
          <Home go={go} session={session} />
        )}
      </main>
    </div>
  );
}
