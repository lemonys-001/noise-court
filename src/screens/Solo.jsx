import { useState } from 'react';
import RoundEngine from '../components/RoundEngine.jsx';
import { loadManifest, hasSounds, pickDeck, dailyDeck, soundTitle } from '../lib/sounds.js';

const MODES = [
  { id: 'just', name: 'Just Play', desc: '4 sounds. Nothing at stake but pride.' },
  { id: 'survival', name: 'Survival', desc: 'Rising score targets, 3 lives. How deep can you go?' },
  { id: 'daily', name: 'Daily Streak', desc: '4 sounds picked from the UTC date. Same for everyone.' },
];

export default function Solo() {
  const [mode, setMode] = useState(null);
  const [deck, setDeck] = useState(null);
  const [results, setResults] = useState(null);
  const [lives, setLives] = useState(3);
  const [noSounds, setNoSounds] = useState(false);

  const start = async (m) => {
    await loadManifest();
    if (!hasSounds()) { setNoSounds(true); return; }
    setMode(m);
    setLives(3);
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
    try {
      const prev = Number(localStorage.getItem('nc_best') || 0);
      if (total > prev) localStorage.setItem('nc_best', String(total));
    } catch {}
  };

  if (results) {
    const total = results.reduce((s, r) => s + r.score, 0);
    let best = null;
    try { best = Number(localStorage.getItem('nc_best') || 0); } catch {}
    return (
      <div className="summary">
        <h2 className="bigtitle">{total} pts</h2>
        <p className="hint">
          {mode === 'survival' ? `Survived ${results.length} round${results.length === 1 ? '' : 's'}` : `${results.length} sound${results.length === 1 ? '' : 's'}`}
          {best != null && total >= best ? ' · personal best' : best != null ? ` · best ${best}` : ''}
        </p>
        <ul className="reslist">
          {results.map((r, i) => (
            <li key={i}><span>{soundTitle(r.soundId)}</span><strong>{r.score}</strong></li>
          ))}
        </ul>
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
        {mode === 'survival' && (
          <div className="livesbar">
            {[0, 1, 2].map((i) => <span key={i} className={`life ${i < lives ? 'on' : ''}`} />)}
          </div>
        )}
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
      <h2 className="bigtitle">Pick your set</h2>
      {noSounds && (
        <div className="card nosound">
          <strong>No sound files yet</strong>
          <p className="hint">Drop audio into <code>public/sounds/</code> and rebuild — the game picks them up automatically.</p>
        </div>
      )}
      {MODES.map((m) => (
        <button key={m.id} className="mode" onClick={() => start(m.id)}>
          <span className="mode-name">{m.name}</span>
          <span className="mode-desc">{m.desc}</span>
        </button>
      ))}
      <button className="btn ghost" onClick={() => history.back()}>Back</button>
    </div>
  );
}
