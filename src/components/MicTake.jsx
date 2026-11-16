import { useEffect, useMemo, useRef, useState } from 'react';
import { play } from '../lib/audio.js';
import { decode, toMono, actx } from '../lib/audio.js';
import { analyze, scoreTake } from '../lib/score.js';
import { startRecording } from '../lib/recorder.js';

// One listen → countdown → single-take record → grade cycle.
// Used by solo, pass-the-mic and online rounds.
export default function MicTake({ refBuffer, refFrames, onComplete, hint }) {
  const [phase, setPhase] = useState('listen'); // listen | count | rec | grade
  const [count, setCount] = useState(3);
  const [level, setLevel] = useState(0);
  const recRef = useRef(null);
  const timers = useRef([]);
  const dead = useRef(false);

  const bars = useMemo(() => {
    const f = refFrames.frames;
    if (!f.length) return [];
    const bucket = Math.max(1, Math.floor(f.length / 36));
    const out = [];
    for (let i = 0; i < f.length; i += bucket) {
      let m = 0;
      for (let j = i; j < Math.min(f.length, i + bucket); j++) m = Math.max(m, f[j].rms);
      out.push(m);
    }
    const peak = Math.max(...out, 1e-4);
    return out.map((v) => Math.max(0.04, v / peak));
  }, [refFrames]);

  useEffect(() => () => {
    dead.current = true;
    timers.current.forEach(clearTimeout);
    if (recRef.current) { try { recRef.current.stop(); } catch {} }
  }, []);

  const later = (fn, ms) => timers.current.push(setTimeout(fn, ms));

  const beginCountdown = () => {
    setPhase('count');
    const tick = (n) => {
      setCount(n);
      if (n > 1) later(() => tick(n - 1), 850);
      else later(() => beginRec(), 850);
    };
    tick(3);
  };

  const listen = () => {
    const src = play(refBuffer);
    const dur = refBuffer.duration * 1000;
    later(() => beginCountdown(), dur + 700);
    return src;
  };

  const beginRec = async () => {
    if (dead.current) return;
    setPhase('rec');
    const rec = await startRecording({ onLevel: setLevel });
    if (dead.current) { try { rec.stop(); } catch {} return; }
    recRef.current = rec;
    const maxMs = Math.min(10000, refBuffer.duration * 1000 + 2200);
    later(() => stopRec(), maxMs);
  };

  const stopRec = async () => {
    if (!recRef.current) return;
    const rec = recRef.current;
    recRef.current = null;
    setPhase('grade');
    const blob = await rec.stop();
    try {
      const buf = await decode(await blob.arrayBuffer());
      const mono = await toMono(buf);
      const score = scoreTake(refFrames, mono.getChannelData(0));
      if (!dead.current) onComplete({ takeBuffer: buf, score, blob });
    } catch (e) {
      if (!dead.current) onComplete({ takeBuffer: null, score: 0, blob, error: String(e.message || e) });
    }
  };

  return (
    <div className="mictake">
      <div className="wavebars" aria-hidden="true">
        {bars.map((h, i) => (
          <div key={i} className={`bar ${phase !== 'listen' ? 'lit' : ''}`} style={{ '--h': h, '--d': `${i * 40}ms` }} />
        ))}
      </div>

      {phase === 'listen' && (
        <div className="listenbox">
          <p className="hint">{hint || 'Listen carefully. You get it once.'}</p>
          <button className="btn big" onClick={listen}>Listen</button>
        </div>
      )}

      {phase === 'count' && <div className="count" key={count}>{count}</div>}

      {phase === 'rec' && (
        <div className="recbox">
          <div className={`recdot ${level > 0.06 ? 'hot' : ''}`} />
          <div className="meter"><div className="fill" style={{ width: `${Math.min(100, level * 220)}%` }} /></div>
          <button className="btn stop" onClick={stopRec}>That's it — send it</button>
          <p className="hint">One shot. No undo.</p>
        </div>
      )}

      {phase === 'grade' && <div className="count">…</div>}
    </div>
  );
}
