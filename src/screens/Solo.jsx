import { useState } from 'react';
import RoundEngine from '../components/RoundEngine.jsx';
import { loadManifest, pickDeck, dailyDeck, soundTitle } from '../lib/sounds.js';
import { api } from '../lib/api.js';

const MODES = [
  { id: 'just', name: 'Just Play', desc: '4 sounds. Safe, risky, focused routes. No lives at stake.' },
  { id: 'survival', name: 'Survival', desc: 'Rising score targets, 3 lives. How deep can you go?' },
  { id: 'daily', name: 'Daily Streak', desc: '4 deterministic sounds from the UTC date. Same for everyone.' },
];

export default function Solo({ session }) {
  const [mode, setMode] = useState(null);
  const [deck, setDeck] = useState(null);
  const [results, setResults] = useState(null);
  const [lives, setLives] = useState(3);
  const [saved, setSaved] = useState(false);

  const start = async (m) => {
    await loadManifest();
    setMode(m);
    setLives(3);
    setSaved(false);
    setResults(null);
    setDeck(m === 'just' ? pickDeck(Math.random, 4) : m === 'daily' ? dailyDeck(4) : pickDeck(Math.random, 12));
  };

  const onTurn = (r) => {
    if (mode !== 'survival') return;
    const idx = deck.indexOf(r.soundId);
    if (r.score < 40 + idx * 5) setLives((l) => l - 1);
  };

  const finish = (res) => {
    setResults(res);
    const total = res.reduce((s, r) => s + r.score, 0);
    if (session && !saved && total > 0) {
      setSaved(true);
      api('/api/score', { method: 'POST', body: { best: total } }).catch(() => {});
    }
  };

  if (results) {
    const total = results.reduce((s, r) => s + r.score, 0);
    return (
      <div className="summary">
        <h2 className="bigtitle">{total} pts</h2>
        <p className="hint">{mode === 'survival' ? `Survived ${results.length} round${results.length === 1 ? '' : 's'}` : `${results.length} sound${results.length === 1 ? '' : 's'}`}</p>
        <ul className="reslist">
          {results.map((r, i) => (
            <li key={i}><span>{soundTitle(r.soundId)}</span><strong>{r.score}</strong></li>
          ))}
        </ul>
        {session ? <p className="hint">Saved to the court records.</p> : <p className="hint">Sign in with Google to save your best.</p>}
        <div className="row">
          <button className="btn" onClick={() => start(mode)}>Run it again</button>
          <button className="btn ghost" onClick={() => { setMode(null); setDeck(null); setResults(null); }}>Change mode</button>
        </div>
      </div>
    );
  }

  if (deck) {
    return (
      <div className="solorun">
        <div className="livesbar">
          {mode === 'survival' && [0, 1, 2].map((i) => <span key={i} className={`life ${i < lives ? 'on' : ''}`}>♥</span>)}
        </div>
        <RoundEngine
          deck={deck}
          onTurn={onTurn}
          onFinish={finish}
          abort={mode === 'survival' && lives <= 0}
        />
      </div>
    );
  }

  return (
    <div className="picker">
      <h2 className="bigtitle">Pick your set.</h2>
      {MODES.map((m) => (
        <button key={m.id} className="card mode wide" onClick={() => start(m.id)}>
          <span className="mode-name">{m.name}</span>
          <span className="mode-desc">{m.desc}</span>
        </button>
      ))}
      <button className="btn ghost" onClick={() => history.back()}>Back</button>
    </div>
  );
}
