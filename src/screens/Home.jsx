import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';

export default function Home({ go, session }) {
  const [top, setTop] = useState(null);

  useEffect(() => {
    api('/api/leaderboard').then((d) => setTop(d.top)).catch(() => setTop([]));
  }, []);

  return (
    <div className="home">
      <section className="hero">
        <p className="kicker">one sound · one shot · no mercy</p>
        <h1>Hear it.<br /><em>Beat it.</em><br />Blame the wheel.</h1>
        <p className="sub">
          The room hears a sound. Everyone gets a single take to mimic it with their voice.
          Your mic grades you. The wheel ruins you.
        </p>
        <div className="modes">
          <button className="card mode" onClick={() => go('solo')}>
            <span className="mode-num">01</span>
            <span className="mode-name">Solo</span>
            <span className="mode-desc">Just Play, Survival, Daily Streak. Warm up the pipes.</span>
          </button>
          <button className="card mode" onClick={() => go('party')}>
            <span className="mode-num">02</span>
            <span className="mode-name">Pass the mic</span>
            <span className="mode-desc">2–5 friends, one device, take turns, compare shame.</span>
          </button>
          <button className="card mode" onClick={() => go('room')}>
            <span className="mode-num">03</span>
            <span className="mode-name">Online rooms</span>
            <span className="mode-desc">Private room codes, separate devices, takes replayed to all.</span>
          </button>
        </div>
      </section>

      {top && top.length > 0 && (
        <section className="leaderboard card">
          <h3>Court records</h3>
          <table>
            <tbody>
              {top.map((r, i) => (
                <tr key={i}>
                  <td className="rank">{i + 1}</td>
                  <td className="lb-name">{r.pic ? <img src={r.pic} alt="" referrerPolicy="no-referrer" /> : null}{r.name}</td>
                  <td className="lb-best">{r.best}</td>
                  <td className="lb-plays">{r.plays} run{r.plays === 1 ? '' : 's'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!session && <p className="hint">Sign in with Google to claim a spot.</p>}
        </section>
      )}

      <footer className="foot">
        <p>Independent browser party game. Not affiliated with FoliesAPP or the Steam release of Mimic Party.</p>
      </footer>
    </div>
  );
}
