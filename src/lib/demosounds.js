// Deterministic synth fallbacks so the game runs before real sound files exist.
// Same formula on every device, so online scores stay comparable.
export const DEMO_SOUNDS = [
  { id: 'demo:siren', title: 'Siren' },
  { id: 'demo:beep', title: 'Robot Beep' },
  { id: 'demo:meow', title: 'Space Meow' },
  { id: 'demo:boing', title: 'Boing' },
];

export function synthDemoBuffer(ctx, id) {
  const dur = { 'demo:siren': 2.2, 'demo:beep': 1.8, 'demo:meow': 1.6, 'demo:boing': 1.1 }[id] || 1.5;
  const sr = ctx.sampleRate;
  const n = Math.floor(dur * sr);
  const buf = ctx.createBuffer(1, n, sr);
  const out = buf.getChannelData(0);
  let phase = 0;
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    const prog = t / dur;
    let f, s;
    if (id === 'demo:siren') {
      f = 520 + 340 * Math.sin(2 * Math.PI * 1.15 * t);
      s = Math.sin(phase) * 0.55;
    } else if (id === 'demo:beep') {
      const gate = Math.sin(2 * Math.PI * 4.2 * t) > 0 ? 1 : 0.08;
      f = (Math.floor(t / 0.22) % 2) ? 880 : 620;
      s = (2 * ((phase / (2 * Math.PI)) % 1) - 1) * 0.4 * gate;
    } else if (id === 'demo:meow') {
      f = 240 + 480 * Math.exp(-2.2 * prog) + 90 * Math.sin(2 * Math.PI * 1.4 * t);
      s = (2 * ((phase / (2 * Math.PI)) % 1) - 1) * 0.45;
    } else {
      f = 300 * Math.exp(-3 * prog) + 50;
      s = Math.sin(phase) * Math.exp(-2.2 * prog) * 0.7;
    }
    phase += (2 * Math.PI * f) / sr;
    const env = Math.min(1, t / 0.02) * Math.min(1, (dur - t) / 0.08);
    out[i] = s * env;
  }
  return buf;
}
