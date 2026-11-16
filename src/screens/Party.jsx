import { useState } from 'react';
import RoundEngine from '../components/RoundEngine.jsx';
import { loadManifest, pickDeck, soundTitle } from '../lib/sounds.js';

export default function Party() {
  const [names, setNames] = useState(['', '', '']);
  const [players, setPlayers] = useState(null);
  const [deck, setDeck] = useState(null);
  const [results, setResults] = useState([]);
  const [done, setDone] = useState(null);

  const valid = names.map((n) => n.trim().slice(0, 12)).filter(Boolean);
  const canStart = valid.length >= 2;

  const start = async () => {
    await loadManifest();
    setResults([]);
    setPlayers(valid);
    setDeck(pickDeck(Math.random, 4));
  };

  const onTurn = (r) => setResults((prev) => [...prev, r]);

  if (done) {
    const totals = {};
    for (const r of done) totals[r.player] = (totals[r.player] || 0) + r.score;
    const standings = Object.entries(totals).sort((a, b) => b[1] - a[1]);
    return (
      <div className="summary">
        <h2 className="bigtitle">{standings[0][0]} takes the crown</h2>
        <ul className="reslist">
          {standings.map(([name, score], i) => (
            <li key={name}><span>{i + 1}. {name}</span><strong>{score}</strong></li>
          ))}
        </ul>
        <div className="row">
          <button className="btn" onClick={() => { setDone(null); setResults([]); start(); }}>Rematch</button>
          <button className="btn ghost" onClick={() => { setDone(null); setPlayers(null); setDeck(null); }}>Change players</button>
        </div>
      </div>
    );
  }

  if (deck) {
    const totals = {};
    for (const r of results) totals[r.player] = (totals[r.player] || 0) + r.score;
    return (
      <div className="partyrun">
        <ul className="mini-board">
          {players.map((p) => <li key={p}><strong>{totals[p] || 0}</strong> {p}</li>)}
        </ul>
        <RoundEngine
          deck={deck}
          players={players}
          onTurn={onTurn}
          onFinish={(res) => setDone(res)}
        />
      </div>
    );
  }

  return (
    <div className="picker">
      <h2 className="bigtitle">Who's in?</h2>
      <p className="hint">2–5 players, one device, taking turns.</p>
      {names.map((n, i) => (
        <div className="row" key={i}>
          <input
            className="input"
            placeholder={`Player ${i + 1}`}
            maxLength={12}
            value={n}
            onChange={(e) => setNames(names.map((x, j) => (j === i ? e.target.value : x)))}
          />
          {names.length > 2 && (
            <button className="btn ghost" onClick={() => setNames(names.filter((_, j) => j !== i))}>✕</button>
          )}
        </div>
      ))}
      {names.length < 5 && (
        <button className="btn ghost" onClick={() => setNames([...names, ''])}>+ Add player</button>
      )}
      <button className="btn big" disabled={!canStart} onClick={start}>Start the party</button>
    </div>
  );
}
