// Recording and tidying partner voice lines, all on the device: the server only ever
// gets the finished, short WAV clip for each line.

const CLIP_RATE = 22050; // plenty for speech, and small

export const canRecord = !!navigator.mediaDevices?.getUserMedia && (window.isSecureContext || location.hostname === 'localhost');

// The microphone, recorded continuously; marks cut it into lines.
export class MicRecorder {
  async start() {
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }
    });
    this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    await this.ctx.resume();
    this.rate = this.ctx.sampleRate;
    this.chunks = [];
    this.length = 0;
    this.level = 0;
    const source = this.ctx.createMediaStreamSource(this.stream);
    // ScriptProcessor is old but works in every WebView, and speech is light work.
    const node = this.ctx.createScriptProcessor(4096, 1, 1);
    node.onaudioprocess = (e) => {
      const data = new Float32Array(e.inputBuffer.getChannelData(0));
      this.chunks.push(data);
      this.length += data.length;
      let sum = 0;
      for (let i = 0; i < data.length; i++) sum += data[i] * data[i];
      this.level = Math.sqrt(sum / data.length);
    };
    const mute = this.ctx.createGain();
    mute.gain.value = 0;
    source.connect(node).connect(mute).connect(this.ctx.destination);
    this.node = node;
  }

  // Current position, in samples.
  mark() {
    return this.length;
  }

  slice(from, to = this.length) {
    const out = new Float32Array(Math.max(0, to - from));
    let at = 0;
    for (const c of this.chunks) {
      const start = Math.max(from - at, 0);
      const end = Math.min(to - at, c.length);
      if (end > start) out.set(c.subarray(start, end), at + start - from);
      at += c.length;
      if (at >= to) break;
    }
    return out;
  }

  stop() {
    this.node?.disconnect();
    this.stream?.getTracks().forEach((t) => t.stop());
    this.ctx?.close().catch(() => {});
    this.chunks = [];
  }
}

// Cut off the quiet before and after the words, and bring the loudest part
// up to a good volume, so every line sounds about as loud as the others.
export function cleanClip(samples, rate, { skipStart = 0, skipEnd = 0 } = {}) {
  const s = samples.subarray(Math.round(skipStart * rate), Math.max(0, samples.length - Math.round(skipEnd * rate)));
  const frame = Math.round(rate * 0.01);
  const levels = [];
  for (let i = 0; i + frame <= s.length; i += frame) {
    let sum = 0;
    for (let j = i; j < i + frame; j++) sum += s[j] * s[j];
    levels.push(Math.sqrt(sum / frame));
  }
  let loudest = 0;
  for (const l of levels) loudest = Math.max(loudest, l);
  if (loudest < 0.015) return null; // nothing said
  const threshold = Math.max(0.012, loudest * 0.08);
  const first = levels.findIndex((l) => l > threshold);
  let last = levels.length - 1;
  while (last > first && levels[last] <= threshold) last--;
  const from = Math.max(0, (first - 6) * frame);
  const to = Math.min(s.length, (last + 12) * frame);
  const out = s.slice(from, to);
  let peak = 0;
  for (let i = 0; i < out.length; i++) peak = Math.max(peak, Math.abs(out[i]));
  const gain = Math.min(8, 0.9 / (peak || 1));
  for (let i = 0; i < out.length; i++) out[i] *= gain;
  // Short fades so there's no click at either end.
  const fade = Math.min(Math.round(rate * 0.01), out.length >> 1);
  for (let i = 0; i < fade; i++) {
    out[i] *= i / fade;
    out[out.length - 1 - i] *= i / fade;
  }
  return out;
}

async function resample(samples, rate, target) {
  if (rate === target) return samples;
  const length = Math.max(1, Math.round((samples.length * target) / rate));
  const off = new OfflineAudioContext(1, length, target);
  const buf = off.createBuffer(1, samples.length, rate);
  buf.copyToChannel(samples, 0);
  const src = off.createBufferSource();
  src.buffer = buf;
  src.connect(off.destination);
  src.start();
  return (await off.startRendering()).getChannelData(0);
}

// 16-bit mono WAV.
export async function toWav(samples, rate) {
  const s = await resample(samples, rate, CLIP_RATE);
  const view = new DataView(new ArrayBuffer(44 + s.length * 2));
  const text = (at, str) => [...str].forEach((ch, i) => view.setUint8(at + i, ch.charCodeAt(0)));
  text(0, 'RIFF');
  view.setUint32(4, 36 + s.length * 2, true);
  text(8, 'WAVE');
  text(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, CLIP_RATE, true);
  view.setUint32(28, CLIP_RATE * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  text(36, 'data');
  view.setUint32(40, s.length * 2, true);
  for (let i = 0; i < s.length; i++) view.setInt16(44 + i * 2, Math.max(-1, Math.min(1, s[i])) * 0x7fff, true);
  return new Blob([view.buffer], { type: 'audio/wav' });
}

// Any audio or video file, as mono samples.
export async function decodeFile(file) {
  const ctx = new (window.AudioContext || window.webkitAudioContext)();
  try {
    const buf = await ctx.decodeAudioData(await file.arrayBuffer());
    const mono = new Float32Array(buf.length);
    for (let c = 0; c < buf.numberOfChannels; c++) {
      const d = buf.getChannelData(c);
      for (let i = 0; i < d.length; i++) mono[i] += d[i] / buf.numberOfChannels;
    }
    return { samples: mono, rate: buf.sampleRate };
  } catch {
    throw new Error("Couldn't read that file. Try an mp3, m4a, wav or video file.");
  } finally {
    ctx.close().catch(() => {});
  }
}

// Any audio or video file (mp3, m4a, wav, a saved TikTok video…) as one
// cleaned-up clip.
export async function clipFromFile(file) {
  const { samples, rate } = await decodeFile(file);
  const clean = cleanClip(samples, rate);
  if (!clean) throw new Error('That file sounds silent.');
  return toWav(clean, rate);
}

// Loudness of every 10 ms of a recording, for finding words and drawing it.
export function levelsOf(samples, rate) {
  const frame = Math.max(1, Math.round(rate * 0.01));
  const levels = new Float32Array(Math.floor(samples.length / frame));
  for (let f = 0; f < levels.length; f++) {
    let sum = 0;
    for (let j = f * frame; j < (f + 1) * frame; j++) sum += samples[j] * samples[j];
    levels[f] = Math.sqrt(sum / frame);
  }
  return levels;
}

// Where someone is talking in one long recording: [{ start, end }] in
// seconds. Quiet shorter than `gap` seconds counts as a pause inside a line
// (a comma, a breath); longer quiet starts the next line.
export function findSpeech(levels, { gap = 0.6, shortest = 0.15 } = {}) {
  let loudest = 0;
  for (const l of levels) loudest = Math.max(loudest, l);
  if (loudest < 0.015) return [];
  const threshold = Math.max(0.01, loudest * 0.06);
  const gapFrames = Math.round(gap * 100);
  const out = [];
  let start = -1;
  let lastLoud = -1;
  for (let f = 0; f < levels.length; f++) {
    if (levels[f] <= threshold) continue;
    if (start >= 0 && f - lastLoud > gapFrames) {
      out.push([start, lastLoud]);
      start = -1;
    }
    if (start < 0) start = f;
    lastLoud = f;
  }
  if (start >= 0) out.push([start, lastLoud]);
  return out
    .filter(([a, b]) => (b - a + 1) / 100 >= shortest)
    .map(([a, b]) => ({ start: Math.max(0, a - 8) / 100, end: Math.min(levels.length, b + 15) / 100 }))
    .map((r, i, all) => ({ start: r.start, end: Math.min(r.end, all[i + 1]?.start ?? r.end) }));
}
