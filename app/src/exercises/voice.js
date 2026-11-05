import { api } from '../api.js';
import { tick, audioContext } from './sounds.js';
import { lineText } from './lines.js';

// Plays an exercise partner's recorded lines through its voice effect. A line
// the partner doesn't have is spoken by the device's own voice if it has one (browsers
// do; the Android app doesn't), otherwise it's a soft tick.
export class VoicePlayer {
  constructor() {
    this.ctx = audioContext();
    this.buffers = {};
    this.playing = new Set();
  }

  // Phones only allow sound after a tap: call this from one.
  resume() {
    return this.ctx.resume();
  }

  // partner: { id, effect, lines: { key: { version } } } (a character)
  async load(partner) {
    this.effect = partner?.effect || 'none';
    this.buffers = {};
    if (!partner) return;
    await Promise.all(Object.entries(partner.lines || {}).map(async ([key, l]) => {
      try {
        const r = await fetch(api.url(`/api/characters/${partner.id}/lines/${key}.wav?v=${l.version}`), { headers: api.authHeaders() });
        if (r.ok) this.buffers[key] = await this.ctx.decodeAudioData(await r.arrayBuffer());
      } catch { /* that line falls back */ }
    }));
  }

  // Use a clip that isn't saved yet (previewing a fresh recording).
  async setClip(key, blob) {
    this.buffers[key] = await this.ctx.decodeAudioData(await blob.arrayBuffer());
  }

  has(key) {
    return !!this.buffers[key];
  }

  // Resolves when the line has been said.
  play(key) {
    const buffer = this.buffers[key];
    if (buffer) return this.playBuffer(buffer);
    return this.fallback(key);
  }

  playBuffer(buffer) {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    const out = ctx.createGain();
    out.connect(ctx.destination);
    const rate = applyEffect(ctx, src, out, this.effect);
    src.playbackRate.value = rate;
    const t = ctx.currentTime + 0.02;
    src.start(t);
    const entry = { stop: () => { try { src.stop(); } catch { /* done */ } } };
    this.playing.add(entry);
    return new Promise((resolve) => {
      src.onended = () => {
        this.playing.delete(entry);
        setTimeout(() => out.disconnect(), 2000); // let echoes ring out
        resolve();
      };
    });
  }

  fallback(key) {
    const text = lineText(key);
    if (window.speechSynthesis && window.SpeechSynthesisUtterance) {
      return new Promise((resolve) => {
        const u = new SpeechSynthesisUtterance(text);
        u.rate = 0.95;
        const done = () => { clearTimeout(timer); resolve(); };
        const timer = setTimeout(done, 4000);
        u.onend = done;
        u.onerror = done;
        window.speechSynthesis.cancel();
        window.speechSynthesis.speak(u);
      });
    }
    tick(this.ctx, this.ctx.currentTime + 0.02, /^n\d+$/.test(key) ? 1 : 0.6);
    return new Promise((r) => setTimeout(r, 250));
  }

  stopAll() {
    for (const p of this.playing) p.stop();
    this.playing.clear();
    window.speechSynthesis?.cancel();
  }

  destroy() {
    this.stopAll();
    this.ctx.close().catch(() => {});
  }
}

// Builds the effect between the clip and the output. Returns the playback
// speed (lower = deeper and slower, higher = brighter and quicker).
function applyEffect(ctx, src, out, effect) {
  switch (effect) {
    case 'robot': {
      // Ring modulation (the classic robot buzz) mixed with the voice, through
      // a short metallic echo and a bit of room.
      const dry = gain(ctx, 0.45);
      const ring = gain(ctx, 0);
      const osc = ctx.createOscillator();
      osc.frequency.value = 50;
      const depth = gain(ctx, 1);
      osc.connect(depth).connect(ring.gain);
      osc.start();
      src.addEventListener('ended', () => { try { osc.stop(); } catch { /* already stopped */ } });
      const metal = comb(ctx, 0.011, 0.55);
      const mix = gain(ctx, 1);
      src.connect(dry).connect(mix);
      src.connect(ring).connect(mix);
      mix.connect(metal.input);
      metal.output.connect(out);
      mix.connect(out);
      room(ctx, mix, out, 0.9, 0.25);
      return 0.86;
    }
    case 'radio': {
      const low = ctx.createBiquadFilter();
      low.type = 'highpass';
      low.frequency.value = 450;
      const high = ctx.createBiquadFilter();
      high.type = 'lowpass';
      high.frequency.value = 3200;
      const crunch = ctx.createWaveShaper();
      crunch.curve = softClip(3);
      src.connect(low).connect(high).connect(crunch).connect(gain(ctx, 0.8)).connect(out);
      // A burst of static before and after, like a walkie-talkie.
      staticBurst(ctx, out, ctx.currentTime, 0.12);
      const len = (src.buffer?.duration || 1) + 0.05;
      staticBurst(ctx, out, ctx.currentTime + len, 0.15);
      noiseBed(ctx, out, len);
      return 1;
    }
    case 'deep':
      src.connect(out);
      room(ctx, src, out, 0.6, 0.15);
      return 0.8;
    case 'high':
      src.connect(out);
      room(ctx, src, out, 1.8, 0.35, true);
      return 1.17;
    case 'echo': {
      src.connect(out);
      const d = ctx.createDelay(1);
      d.delayTime.value = 0.28;
      const fb = gain(ctx, 0.38);
      src.connect(d);
      d.connect(fb).connect(d);
      d.connect(gain(ctx, 0.5)).connect(out);
      room(ctx, src, out, 2.5, 0.3);
      return 1;
    }
    default:
      src.connect(out);
      return 1;
  }
}

const gain = (ctx, v) => {
  const g = ctx.createGain();
  g.gain.value = v;
  return g;
};

function comb(ctx, time, feedback) {
  const input = gain(ctx, 1);
  const d = ctx.createDelay(0.1);
  d.delayTime.value = time;
  const fb = gain(ctx, feedback);
  input.connect(d);
  d.connect(fb).connect(d);
  const output = gain(ctx, 0.5);
  d.connect(output);
  return { input, output };
}

// A made-up room: noise that fades away, used as a reverb.
const rooms = new Map();
function room(ctx, from, out, seconds, wet, bright = false) {
  const key = `${seconds}-${bright}`;
  let impulse = rooms.get(key);
  if (!impulse || impulse.ctx !== ctx) {
    const len = Math.round(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = buf.getChannelData(c);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len) ** (bright ? 1.5 : 3);
    }
    impulse = { ctx, buf };
    rooms.set(key, impulse);
  }
  const conv = ctx.createConvolver();
  conv.buffer = impulse.buf;
  let chain = from.connect(conv);
  if (bright) {
    const shelf = ctx.createBiquadFilter();
    shelf.type = 'highshelf';
    shelf.frequency.value = 3000;
    shelf.gain.value = 8;
    chain = chain.connect(shelf);
  }
  chain.connect(gain(ctx, wet)).connect(out);
}

function softClip(k) {
  const n = 1024;
  const curve = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    curve[i] = Math.tanh(k * x) / Math.tanh(k);
  }
  return curve;
}

function noiseBuffer(ctx, seconds) {
  const len = Math.max(1, Math.round(ctx.sampleRate * seconds));
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  return buf;
}

function staticBurst(ctx, out, at, seconds) {
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer(ctx, seconds);
  const band = ctx.createBiquadFilter();
  band.type = 'bandpass';
  band.frequency.value = 2200;
  band.Q.value = 0.7;
  const g = gain(ctx, 0);
  g.gain.setValueAtTime(0.0001, at);
  g.gain.linearRampToValueAtTime(0.35, at + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, at + seconds);
  src.connect(band).connect(g).connect(out);
  src.start(at);
}

function noiseBed(ctx, out, seconds) {
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer(ctx, seconds);
  const band = ctx.createBiquadFilter();
  band.type = 'bandpass';
  band.frequency.value = 1800;
  src.connect(band).connect(gain(ctx, 0.035)).connect(out);
  src.start();
}
