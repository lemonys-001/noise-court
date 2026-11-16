import test from 'node:test';
import assert from 'node:assert/strict';
import { analyze, scoreFrames, SR } from '../src/lib/score.js';

function tone(freqFn, dur, sr = SR, amp = 0.3) {
  const n = Math.floor(dur * sr);
  const out = new Float32Array(n);
  let phase = 0;
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    phase += (2 * Math.PI * freqFn(t)) / sr;
    const env = Math.min(1, t / 0.02) * Math.min(1, (dur - t) / 0.05);
    out[i] = Math.sin(phase) * amp * env;
  }
  return out;
}

function noise(dur, sr = SR) {
  const out = new Float32Array(Math.floor(dur * sr));
  for (let i = 0; i < out.length; i++) out[i] = (Math.random() * 2 - 1) * 0.15;
  return out;
}

test('identical take scores near 100', () => {
  const a = analyze(tone((t) => 300 + 200 * t, 2));
  const s = scoreFrames(a.frames, a.frames);
  assert.ok(s >= 90, `got ${s}`);
});

test('detuned take scores clearly lower', () => {
  const good = analyze(tone((t) => 300 + 200 * t, 2));
  const bad = analyze(tone((t) => (300 + 200 * t) * 1.6, 2));
  const sGood = scoreFrames(good.frames, good.frames);
  const sBad = scoreFrames(good.frames, bad.frames);
  assert.ok(sBad < sGood - 15, `bad ${sBad} vs good ${sGood}`);
});

test('silence scores 0', () => {
  const ref = analyze(tone((t) => 400, 1));
  const s = scoreFrames(ref.frames, analyze(new Float32Array(SR * 2)).frames);
  assert.equal(s, 0);
});

test('time-shifted copy still scores decently', () => {
  const sig = tone((t) => 300 + 200 * t, 2);
  const shifted = new Float32Array(Math.floor(0.3 * SR) + sig.length);
  shifted.set(sig, Math.floor(0.3 * SR));
  const s = scoreFrames(analyze(sig).frames, analyze(shifted).frames);
  assert.ok(s >= 55, `got ${s}`);
});

test('noise against melody scores low', () => {
  const ref = analyze(tone((t) => 440, 1.5));
  const s = scoreFrames(ref.frames, analyze(noise(1.5)).frames);
  assert.ok(s < 45, `got ${s}`);
});
