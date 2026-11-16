import { useEffect, useRef, useState } from 'react';
import MicTake from './MicTake.jsx';
import { getSoundBuffer, soundTitle } from '../lib/sounds.js';
import { toMono } from '../lib/audio.js';
import { analyze } from '../lib/score.js';

// Local round loop for solo + pass-the-mic: sounds × players, one MicTake each.
export default function RoundEngine({ deck, players, onTurn, onFinish, abort }) {
  const list = players && players.length ? players : ['You'];
  const total = deck.length * list.length;
  const [turn, setTurn] = useState(-1); // -1 = prep
  const [prep, setPrep] = useState(0);
  const [lastScore, setLastScore] = useState(null);
  const resultsRef = useRef([]);
  const refs = useRef({});

  useEffect(() => {
    if (abort && turn !== -1) onFinish([...resultsRef.current]);
  }, [abort]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      for (const id of deck) {
        const buffer = await getSoundBuffer(id);
        const mono = await toMono(buffer);
        refs.current[id] = { buffer, frames: analyze(mono.getChannelData(0), 16000) };
        if (cancelled) return;
        setPrep((p) => p + 1);
      }
      if (!cancelled) setTurn(0);
    })();
    return () => { cancelled = true; };
  }, [deck]);

  const soundIdx = Math.floor(turn / list.length);
  const playerIdx = turn % list.length;
  const soundId = deck[soundIdx];
  const ref = refs.current[soundId];

  const handleComplete = ({ takeBuffer, score }) => {
    setLastScore(score);
    const r = { player: list[playerIdx], soundId, score };
    resultsRef.current.push(r);
    onTurn && onTurn(r);
  };

  const next = () => {
    setLastScore(null);
    if (turn + 1 >= total) {
      onFinish([...resultsRef.current]);
    } else {
      setTurn(turn + 1);
    }
  };

  if (turn === -1) {
    return (
      <div className="prep">
        <div className="spinner" />
        <p>Loading sounds {prep}/{deck.length}…</p>
      </div>
    );
  }

  return (
    <div className="engine">
      <header className="roundhead">
        <span className="chip">Sound {soundIdx + 1}/{deck.length}</span>
        {list.length > 1 && <span className="chip teal">{list[playerIdx]}'s turn</span>}
        <h2 className="soundtitle">{soundTitle(soundId)}</h2>
      </header>

      {lastScore === null ? (
        <MicTake
          key={turn}
          refBuffer={ref.buffer}
          refFrames={ref.frames}
          hint={turn === 0 ? 'Listen carefully. You get it once.' : undefined}
          onComplete={handleComplete}
        />
      ) : (
        <div className="revealscore">
          <div className="bigscore" key={lastScore}>{lastScore}</div>
          <p className="hint">{lastScore >= 80 ? 'Scary close.' : lastScore >= 50 ? 'Respectable noise.' : lastScore > 0 ? 'Beautiful disaster.' : 'Was the mic even on?'}</p>
          <button className="btn big" onClick={next}>
            {turn + 1 >= total ? 'See results' : list.length > 1 ? 'Next player' : 'Next sound'}
          </button>
        </div>
      )}
    </div>
  );
}
