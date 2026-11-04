// A steady beat from the Web Audio clock. Timers in JavaScript drift and
// stutter, so instead each tick is booked a little ahead on the audio clock,
// which plays it at exactly the right moment.
const LOOKAHEAD = 0.12; // seconds of beats booked ahead
const CHECK_EVERY = 25; // ms between bookings

export class Metronome {
  constructor() {
    this.bpm = 60;
    this.ctx = null;
    this.timer = null;
    this.beats = []; // booked beats: { time, n }
    this.count = 0;
  }

  get running() {
    return this.timer != null;
  }

  // Must be called from a tap: phones only allow sound after one.
  async start() {
    if (this.running) return;
    this.ctx ??= new (window.AudioContext || window.webkitAudioContext)();
    await this.ctx.resume();
    this.count = 0;
    this.beats = [];
    this.lastHeard = null;
    this.next = this.ctx.currentTime + 0.15;
    this.startedAt = this.next;
    this.book();
    this.timer = setInterval(() => this.book(), CHECK_EVERY);
  }

  stop() {
    clearInterval(this.timer);
    this.timer = null;
    this.beats = [];
  }

  // A new speed takes effect from the next beat.
  setBpm(bpm) {
    this.bpm = bpm;
  }

  book() {
    const until = this.ctx.currentTime + LOOKAHEAD;
    while (this.next < until) {
      this.play(this.next);
      this.beats.push({ time: this.next, n: ++this.count });
      this.next += 60 / this.bpm;
    }
  }

  play(t) {
    const ctx = this.ctx;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    // A woodblock-like tick: a note that dies away almost at once.
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(1800, t);
    osc.frequency.exponentialRampToValueAtTime(900, t + 0.03);
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.linearRampToValueAtTime(1, t + 0.001);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.04);
    osc.start(t);
    osc.stop(t + 0.05);
    osc.connect(gain).connect(ctx.destination);
  }

  // The latest beat the listener has heard (sound reaches the speaker a
  // moment after it's played), so the picture flashes with the sound.
  heard() {
    if (!this.running) return null;
    const now = this.ctx.currentTime - (this.ctx.outputLatency || this.ctx.baseLatency || 0);
    let last = null;
    while (this.beats.length && this.beats[0].time <= now) last = this.beats.shift();
    if (last) this.lastHeard = last;
    return this.lastHeard && this.lastHeard.time <= now
      ? { n: this.lastHeard.n, since: now - this.lastHeard.time, elapsed: Math.max(0, now - this.startedAt) }
      : { n: 0, since: Infinity, elapsed: 0 };
  }

  destroy() {
    this.stop();
    this.ctx?.close().catch(() => {});
    this.ctx = null;
  }
}
