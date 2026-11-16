let ctx;

export function actx() {
  if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

export async function decode(data) {
  return await actx().decodeAudioData(data);
}

export async function toMono(buffer, sampleRate = 16000) {
  const off = new OfflineAudioContext(1, Math.max(1, Math.ceil(buffer.duration * sampleRate)), sampleRate);
  const src = off.createBufferSource();
  src.buffer = buffer;
  src.connect(off.destination);
  src.start();
  return await off.startRendering();
}

export function play(buffer, { rate = 1, when = 0 } = {}) {
  const c = actx();
  const src = c.createBufferSource();
  src.buffer = buffer;
  src.playbackRate.value = rate;
  src.connect(c.destination);
  src.start(c.currentTime + when);
  return src;
}
