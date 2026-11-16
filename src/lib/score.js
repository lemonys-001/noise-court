// Pure scoring: no DOM, no AudioContext — works in Node for tests.
export const SR = 16000;

const FRAME = 320; // 20ms at 16k
const HOP = 160;   // 10ms
const MIN_F = 70;
const MAX_F = 1000;

export function analyze(samples, sampleRate = SR) {
  const frames = [];
  const lagMin = Math.max(2, Math.floor(sampleRate / MAX_F));
  const lagMax = Math.ceil(sampleRate / MIN_F);
  let peakRms = 0;
  for (let start = 0; start + FRAME <= samples.length; start += HOP) {
    const f = samples.subarray(start, start + FRAME);
    let sum2 = 0, zc = 0;
    for (let i = 0; i < f.length; i++) {
      sum2 += f[i] * f[i];
      if (i && (f[i] < 0) !== (f[i - 1] < 0)) zc++;
    }
    const rms = Math.sqrt(sum2 / f.length);
    const zcr = zc / f.length;
    let pitch = 0, conf = 0;
    if (rms > 1e-4) {
      let bestLag = 0, bestCor = 0;
      for (let lag = lagMin; lag <= lagMax && lag < f.length; lag += 2) {
        let cor = 0;
        for (let i = 0; i + lag < f.length; i++) cor += f[i] * f[i + lag];
        if (cor > bestCor) { bestCor = cor; bestLag = lag; }
      }
      if (bestLag) {
        // refine ±1
        for (const lag of [bestLag - 1, bestLag + 1]) {
          if (lag < lagMin || lag >= f.length) continue;
          let cor = 0;
          for (let i = 0; i + lag < f.length; i++) cor += f[i] * f[i + lag];
          if (cor > bestCor) { bestCor = cor; bestLag = lag; }
        }
        conf = (bestCor / f.length) / (sum2 / f.length + 1e-9);
        if (conf > 0.35 && bestLag > 0) pitch = sampleRate / bestLag;
        else { pitch = 0; conf = 0; }
      }
    }
    peakRms = Math.max(peakRms, rms);
    frames.push({ rms, zcr, pitch, conf });
  }
  return { frames, peakRms, sampleRate };
}

function trim(frames) {
  let peak = 0;
  for (const f of frames) peak = Math.max(peak, f.rms);
  if (peak === 0) return [];
  const th = peak * 0.15;
  let lo = 0, hi = frames.length - 1;
  while (lo < frames.length && frames[lo].rms < th) lo++;
  while (hi > lo && frames[hi].rms < th) hi--;
  return frames.slice(lo, hi + 1);
}

function zscores(frames, key) {
  let mean = 0;
  for (const f of frames) mean += f[key];
  mean /= frames.length || 1;
  let sd = 0;
  for (const f of frames) sd += (f[key] - mean) ** 2;
  sd = Math.sqrt(sd / (frames.length || 1)) + 1e-6;
  return frames.map((f) => (f[key] - mean) / sd);
}

// Banded DTW over [log-pitch, loudness, brightness], 0..100 (capped at 99).
export function scoreFrames(refFrames, takeFrames) {
  const a = trim(refFrames);
  const b = trim(takeFrames);
  if (!a.length || !b.length) return 0;
  const bPeak = Math.max(...b.map((f) => f.rms));
  if (bPeak < 0.004) return 0; // near-silent take

  const aRms = zscores(a, 'rms'), bRms = zscores(b, 'rms');
  const aZcr = zscores(a, 'zcr'), bZcr = zscores(b, 'zcr');

  const pairCost = (i, j) => {
    let c = 0;
    const pa = a[i].pitch, pb = b[j].pitch;
    if (pa > 0 && pb > 0) {
      const d = Math.abs(Math.log2(pa / pb));
      c += 0.6 * Math.min(1, d); // an octave off ≈ 0.6
    } else if (pa > 0 || pb > 0) {
      c += 0.4; // one is melodic, the other isn't
    }
    c += 0.25 * Math.min(1, Math.abs(aRms[i] - bRms[j]) / 2.5);
    c += 0.15 * Math.min(1, Math.abs(aZcr[i] - bZcr[j]) / 2.5);
    return c;
  };

  const n = a.length, m = b.length;
  const band = Math.max(24, Math.floor(0.35 * Math.max(n, m)));
  const W = m + 1;
  const INF = 1e9;
  const dp = new Float64Array((n + 1) * W).fill(INF);
  const len = new Float64Array((n + 1) * W);
  dp[0] = 0;
  len[0] = 0;
  for (let i = 1; i <= n; i++) {
    const jLo = Math.max(1, i - band), jHi = Math.min(m, i + band);
    for (let j = jLo; j <= jHi; j++) {
      const idx = i * W + j;
      let best = dp[(i - 1) * W + j], bl = len[(i - 1) * W + j];
      const upDiag = dp[(i - 1) * W + (j - 1)], upDiagLen = len[(i - 1) * W + (j - 1)];
      if (upDiag < best) { best = upDiag; bl = upDiagLen; }
      const left = dp[i * W + (j - 1)], leftLen = len[i * W + (j - 1)];
      if (left < best) { best = left; bl = leftLen; }
      dp[idx] = best === INF ? INF : best + pairCost(i - 1, j - 1);
      len[idx] = bl + 1;
    }
  }
  const end = n * W + m;
  if (dp[end] >= INF) return 0;
  const cost = dp[end] / len[end];

  const lenRatio = Math.min(n, m) / Math.max(n, m);
  let s = 100 * Math.max(0, 1 - cost / 0.9) * (0.35 + 0.65 * Math.sqrt(lenRatio));
  return Math.min(99, Math.max(0, Math.round(s)));
}

export function scoreTake(refAnalysis, takeSamples) {
  const take = analyze(takeSamples, refAnalysis.sampleRate);
  return scoreFrames(refAnalysis.frames, take.frames);
}
