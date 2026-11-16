import { actx } from './audio.js';
import { mulberry32 } from './rng.js';

// Playback-time sabotage. Deterministic per effect so every device hears
// (roughly) the same ruined take.
export async function applyEffect(buffer, effect) {
  if (!effect || effect === 'none') return buffer;
  if (effect === 'fart') return fart(buffer.sampleRate);

  let length = buffer.length;
  let rate = 1;
  if (effect === 'pitch') { rate = 0.72; length = Math.ceil(buffer.length / rate); }
  const off = new OfflineAudioContext(buffer.numberOfChannels, length, buffer.sampleRate);
  const src = off.createBufferSource();
  src.buffer = buffer;
  src.playbackRate.value = rate;

  if (effect === 'saturate') {
    const ws = off.createWaveShaper();
    const curve = new Float32Array(1024);
    for (let i = 0; i < 1024; i++) {
      const x = (i / 1023) * 2 - 1;
      curve[i] = Math.tanh(6 * x);
    }
    ws.curve = curve;
    src.connect(ws).connect(off.destination);
  } else if (effect === 'echo') {
    const dry = off.createGain(); dry.gain.value = 0.65;
    const d = off.createDelay(1); d.delayTime.value = 0.28;
    const fb = off.createGain(); fb.gain.value = 0.5;
    src.connect(dry).connect(off.destination);
    dry.connect(d);
    d.connect(fb).connect(d);
    d.connect(off.destination);
  } else if (effect === 'chop') {
    // deterministic slice shuffle
    src.disconnect();
    const slices = 5;
    const per = Math.floor(buffer.length / slices);
    const order = [3, 0, 4, 1, 2];
    for (let k = 0; k < slices; k++) {
      const s = off.createBufferSource();
      s.buffer = buffer;
      s.connect(off.destination);
      s.start((k * per) / buffer.sampleRate, (order[k] * per) / buffer.sampleRate, per / buffer.sampleRate);
    }
    return await off.startRendering();
  } else {
    src.connect(off.destination);
  }
  src.start();
  return await off.startRendering();
}

function fart(sr) {
  const dur = 0.9;
  const n = Math.floor(dur * sr);
  const buf = actx().createBuffer(1, n, sr);
  const out = buf.getChannelData(0);
  const rand = mulberry32(42);
  let lp = 0;
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    const f = 55 + 25 * Math.sin(2 * Math.PI * 9 * t);
    const pulse = Math.sin(2 * Math.PI * f * t) > 0 ? 1 : -1;
    const noise = rand() * 2 - 1;
    lp = lp * 0.86 + 0.14 * noise;
    const env = Math.min(1, t / 0.03) * Math.min(1, (dur - t) / 0.15);
    out[i] = (pulse * 0.6 + lp * 1.6) * env * 0.5;
  }
  return buf;
}
