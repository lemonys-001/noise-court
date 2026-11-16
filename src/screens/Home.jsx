import { useEffect, useState } from 'react';

const STEPS = [
  ['Listen', 'The room hears the same sound once.'],
  ['Copy', 'One take, same length as the sound. No redo.'],
  ['Hear it', 'Every take plays back, then the wheel decides.'],
];

export default function Home() {
  const [best, setBest] = useState(null);

  useEffect(() => {
    try { setBest(JSON.parse(localStorage.getItem('nc_best') || 'null')); } catch {}
  }, []);

  return (
    <div className="home">
      <section className="hero">
        <h1>The courtroom<br />for <em>bad impressions.</em></h1>
        <p className="sub">
          One sound. One take with your voice. The track is on screen — copy it,
          get graded 0–100, then let the wheel hand out multipliers and sabotage.
        </p>
        <nav className="modelist">
          <button className="mode" onClick={() => { location.hash = '#/solo'; }}>
            <span className="mode-num">01</span>
            <span className="mode-name">Solo</span>
            <span className="mode-desc">Just Play, Survival, Daily Streak</span>
            {best != null && <span className="mode-best">best {best}</span>}
          </button>
          <button className="mode" onClick={() => { location.hash = '#/party'; }}>
            <span className="mode-num">02</span>
            <span className="mode-name">Pass the mic</span>
            <span className="mode-desc">2–5 friends, one device, turn by turn</span>
          </button>
          <button className="mode" onClick={() => { location.hash = '#/room'; }}>
            <span className="mode-num">03</span>
            <span className="mode-name">Room code</span>
            <span className="mode-desc">Online, 2–5 players, separate devices</span>
          </button>
        </nav>
      </section>

      <section className="howto">
        {STEPS.map(([t, d]) => (
          <div className="step" key={t}>
            <span className="step-t">{t}</span>
            <span className="step-d">{d}</span>
          </div>
        ))}
      </section>

      <footer className="foot">
        <p>No accounts. A nickname and a room code are all you need. Independent game, not affiliated with FoliesAPP or the Steam release of Mimic Party.</p>
      </footer>
    </div>
  );
}
