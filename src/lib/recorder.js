import { actx } from './audio.js';

export async function startRecording({ onLevel } = {}) {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: true, noiseSuppression: true },
  });
  const mimes = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus'];
  const mimeType = mimes.find((t) => window.MediaRecorder && MediaRecorder.isTypeSupported(t));
  const rec = new MediaRecorder(stream, mimeType ? { mimeType, audioBitsPerSecond: 32000 } : undefined);

  // level meter
  const c = actx();
  const src = c.createMediaStreamSource(stream);
  const an = c.createAnalyser();
  an.fftSize = 512;
  src.connect(an);
  const td = new Uint8Array(an.fftSize);
  let metering = true;
  const meterLoop = () => {
    if (!metering) return;
    an.getByteTimeDomainData(td);
    let s = 0;
    for (let i = 0; i < td.length; i++) {
      const v = (td[i] - 128) / 128;
      s += v * v;
    }
    onLevel && onLevel(Math.sqrt(s / td.length));
    requestAnimationFrame(meterLoop);
  };
  meterLoop();

  const chunks = [];
  rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  const done = new Promise((res) => {
    rec.onstop = () => res(new Blob(chunks, { type: rec.mimeType || 'audio/webm' }));
  });
  rec.start(250);

  return {
    stop() {
      metering = false;
      try { rec.stop(); } catch {}
      stream.getTracks().forEach((t) => t.stop());
      try { src.disconnect(); } catch {}
      return done;
    },
  };
}

export function blobToB64Url(blob) {
  return new Promise((res, rej) => {
    const fr = new FileReader();
    fr.onload = () => res(String(fr.result).slice(String(fr.result).indexOf(',') + 1));
    fr.onerror = rej;
    fr.readAsDataURL(blob);
  });
}

export function b64ToBlob(b64, type) {
  const bin = atob(b64);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return new Blob([arr], { type });
}
