import { useEffect, useState } from 'react';
import Home from './screens/Home.jsx';
import Solo from './screens/Solo.jsx';
import Party from './screens/Party.jsx';
import Online from './screens/Online.jsx';

export default function App() {
  const [hash, setHash] = useState(location.hash || '#/');

  useEffect(() => {
    const f = () => setHash(location.hash || '#/');
    addEventListener('hashchange', f);
    return () => removeEventListener('hashchange', f);
  }, []);

  const parts = hash.replace(/^#\/?/, '').split('/');
  const route = parts[0] || '';
  const code = parts[1] || null;

  return (
    <div className="app">
      <header className="topbar">
        <button className="brand" onClick={() => { location.hash = '#/'; }}>NOISE COURT</button>
        <span className="brand-sub">one sound · one shot</span>
      </header>
      <main className="stage">
        {route === 'solo' ? (
          <Solo />
        ) : route === 'party' ? (
          <Party />
        ) : route === 'room' ? (
          <Online code={code} />
        ) : (
          <Home />
        )}
      </main>
    </div>
  );
}
