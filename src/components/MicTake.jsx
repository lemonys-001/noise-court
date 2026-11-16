import { useEffect, useMemo, useRef, useState } from 'react';
import { play, decode, toMono, actx } from '../lib/audio.js';
import { analyze, scoreTake } from '../lib/score.js';
import { startRecording } from '../lib/recorder.js';

// One listen → countdown → single-take record → hard cut → replay → grade.
// The reference waveform stays on screen the whole way: it is the track you copy.
export default function MicTake({ refBuffer, refFrames, onComplete, hint }) {
  const [phase, setPhase] = useState('listen'); // listen | count | rec | grade | replay
  const [count, setCount] = useState(3);
  const [lit, setLit] = useState(0); // bars lit during listen
  const [prog, setProg] = useState(0); // 0..1 while recording
  const [cut, setCut] = useState(false);
  const [takeBars, setTakeBars] = useState(null);
  const recRef = useRef(null);
  const timers = useRef([]);
  const dead = useRef(false);
  const waveRef = useRef(null);
  const canvasRef = useRef(null);
  const rafRef = useRef(0);

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
    return out.map((v) => Math.max(0.06, v / peak));
  }, [refFrames]);

  const refDur = refBuffer.duration;

  useEffect(() => () => {
    dead.current = true;
    cancelAnimationFrame(rafRef.current);
    timers.current.forEach(clearTimeout);
    if (recRef.current) { try { recRef.current.stop(); } catch {} }
  }, []);

  const later = (fn, ms) => timers.current.push(setTimeout(fn, ms));

  const listen = () => {
    setPhase('count-prep');
    const src = play(refBuffer);
    const t0 = actx().currentTime;
    const loop = () => {
      if (dead.current) return;
      const p = (actx().currentTime - t0) / refDur;
      setLit(Math.min(bars.length, Math.ceil(p * bars.length)));
      if (p < 1) rafRef.current = requestAnimationFrame(loop);
    };
    loop();
    src.onended = () => { if (!dead.current) { setLit(bars.length); later(beginCountdown, 700); } };
    later(beginCountdown, refDur * 1000 + 750); // fallback if onended is flaky
  };

  const beginCountdown = () => {
    setPhase('count');
    const tick = (n) => {
      setCount(n);
      if (n > 1) later(() => tick(n - 1), 850);
      else later(() => beginRec(), 850);
    };
    tick(3);
  };

  const beginRec = async () => {
    if (dead.current) return;
    setPhase('rec');
    const t0 = performance.now();
    const maxMs = refDur * 1000 + 250; // same length as the sound — like the real game
    const rec = await startRecording({
      onWave: (w) => { waveRef.current = w; },
    });
    if (dead.current) { try { rec.stop(); } catch {} return; }
    recRef.current = rec;
    if (draw.hist) draw.hist.length = 0;

    const tick = () => {
      if (dead.current) return;
      const p = Math.min(1, (performance.now() - t0) / maxMs);
      setProg(p);
      draw();
      if (p < 1) rafRef.current = requestAnimationFrame(tick);
      else hardStop();
    };
    rafRef.current = requestAnimationFrame(tick);
  };

  // live mic trace: columns of peaks scrolling right→left under the target bars
  const draw = () => {
    const cv = canvasRef.current;
    if (!cv) return;
    const ctx = cv.getContext('2d');
    const w = cv.width, h = cv.height;
    ctx.clearRect(0, 0, w, h);
    const wave = waveRef.current;
    if (wave && wave.length) {
      let peak = 0;
      for (let i = 0; i < wave.length; i += 4) peak = Math.max(peak, Math.abs(wave[i]));
      const hist = (draw.hist ||= []);
      hist.push(peak);
      while (hist.length > w / 3) hist.shift();
      ctx.fillStyle = 'rgba(255, 79, 40, 0.85)';
      const col = 3, mid = h / 2;
      for (let x = 0; x < hist.length; x++) {
        const amp = Math.max(1, Math.min(1, hist[x] * 1.6) * (h / 2 - 2));
        ctx.fillRect(w - x * col, mid - amp, col - 1, amp * 2);
      }
    }
  };

  const hardStop = () => {
    setCut(true);
    stopRec();
    later(() => setCut(false), 650);
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
      // quick peaks of the take for the replay visual
      const data = mono.getChannelData(0);
      const tb = [];
      const bucket = Math.max(1, Math.floor(data.length / 36));
      for (let i = 0; i < data.length; i += bucket) {
        let m = 0;
        for (let j = i; j < Math.min(data.length, i + bucket); j += 2) m = Math.max(m, Math.abs(data[j]));
        tb.push(m);
      }
      const tp = Math.max(...tb, 1e-4);
      setTakeBars(tb.map((v) => Math.max(0.06, v / tp)));
      setPhase('replay');
      setProg(0);
      const t0 = performance.now(), d = buf.duration * 1000;
      const rp = () => {
        if (dead.current) return;
        const p = Math.min(1, (performance.now() - t0) / d);
        setProg(p);
        if (p < 1) rafRef.current = requestAnimationFrame(rp);
      };
      rafRef.current = requestAnimationFrame(rp);
      play(buf);
      later(() => { if (!dead.current) onComplete({ takeBuffer: buf, score, blob }); }, d + 500);
    } catch (e) {
      if (!dead.current) onComplete({ takeBuffer: null, score: 0, blob, error: String(e.message || e) });
    }
  };

  return (
    <div className={`mictake ${cut ? 'cut' : ''}`}>
      <div className="track">
        <div className="wavebars" aria-hidden="true">
          {bars.map((h, i) => (
            <div
              key={i}
              className={`bar ${phase === 'listen' && i < lit ? 'lit' : ''} ${phase === 'rec' || phase === 'count' ? 'target' : ''} ${phase === 'replay' && takeBars && i < Math.ceil(takeBars.length * prog) ? 'playing' : ''}`}
              style={{ '--h': phase === 'replay' && takeBars ? takeBars[i] : h, '--d': `${i * 40}ms` }}
            />
          ))}
        </div>
        {(phase === 'rec' || phase === 'replay') && (
          <div className="playhead" style={{ left: `${prog * 100}%` }} />
        )}
        <canvas ref={canvasRef} className={`micwave ${phase === 'rec' ? 'on' : ''}`} width="480" height="120" />
      </div>

      {phase === 'listen' && (
        <div className="listenbox">
          <p className="hint">{hint || 'Listen once. Your take will be exactly this long.'}</p>
          <button className="btn big" onClick={listen}>Listen</button>
        </div>
      )}

      {(phase === 'count-prep' || phase === 'count') && (
        <div className="listenbox">
          {phase === 'count'
            ? <div className="count" key={count}>{count}</div>
            : <div className="spinner" />}
        </div>
      )}

      {phase === 'rec' && (
        <div className="listenbox">
          <div className="tag rec-tag">REC · match the track</div>
        </div>
      )}

      {phase === 'grade' && <div className="count">…</div>}

      {phase === 'replay' && <div className="tag">Playing your take</div>}

      {cut && <div className="cutstamp">CUT</div>}
    </div>
  );
}
