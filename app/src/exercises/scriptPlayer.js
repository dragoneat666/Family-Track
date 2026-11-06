import { sample } from './timeline.js';

// Plays a timeline: moves the partner to the exact pose for each moment,
// says each line when its time comes, and reports what's showing (words,
// countdown, count) through onFrame. Pause, seek and play work anywhere,
// so the same player runs the kid's exercise and the editor's preview.
export class ScriptPlayer {
  constructor({ scene, voice, onFrame, onEnd }) {
    Object.assign(this, { scene, voice, onFrame, onEnd });
    this.tl = null;
    this.t = 0;
    this.playing = false;
    this.frame = null;
  }

  setTimeline(tl, keepTime = true) {
    this.tl = tl;
    if (!keepTime) this.t = 0;
    this.t = Math.min(this.t, tl.total);
    this.render();
  }

  get time() {
    return this.t;
  }

  play() {
    if (!this.tl) return;
    if (this.t >= this.tl.total - 1e-3) this.t = 0;
    this.playing = true;
    this.last = performance.now();
    this.heard = this.t - 1e-4; // cues after this still need saying
    cancelAnimationFrame(this.frame);
    const step = () => {
      if (!this.playing) return;
      const now = performance.now();
      this.t = Math.min(this.tl.total, this.t + Math.min(0.25, (now - this.last) / 1000));
      this.last = now;
      for (const c of this.tl.cues) {
        if (c.at > this.heard && c.at <= this.t) {
          if (/^n\d+$/.test(c.line)) this.voice.stopAll();
          this.voice.play(c.line);
        }
      }
      this.heard = this.t;
      this.render();
      if (this.t >= this.tl.total) {
        this.playing = false;
        this.onEnd?.();
        this.idle();
        return;
      }
      this.frame = requestAnimationFrame(step);
    };
    this.frame = requestAnimationFrame(step);
  }

  pause() {
    this.playing = false;
    cancelAnimationFrame(this.frame);
    this.voice.stopAll();
    this.render();
  }

  seek(t) {
    if (!this.tl) return;
    this.t = Math.max(0, Math.min(t, this.tl.total));
    this.heard = this.t - 1e-4;
    this.last = performance.now();
    this.voice.stopAll();
    this.render();
  }

  // At the very end a looping move (the cheer) keeps going.
  idle() {
    const s = this.tl && sample(this.tl, this.tl.total);
    if (!s?.seg.scene.move?.loop) return;
    let local = s.local;
    let last = performance.now();
    const step = () => {
      if (this.playing || this.t < this.tl.total) return;
      const now = performance.now();
      local += (now - last) / 1000;
      last = now;
      const move = s.seg.scene.move;
      const span = move.to - move.from;
      const len = Math.abs(span) / (move.speed || 1) || 1;
      const p = (local / len) % 1;
      this.scene.setPose({ clip: move.clip, time: move.from + span * p });
      this.frame = requestAnimationFrame(step);
    };
    this.frame = requestAnimationFrame(step);
  }

  render() {
    if (!this.tl) return;
    const s = sample(this.tl, this.t);
    if (s) this.scene?.setPose(s.pose, s.from, s.weight);
    this.onFrame?.(s, this.t);
  }

  destroy() {
    this.playing = false;
    cancelAnimationFrame(this.frame);
    this.voice.stopAll();
  }
}
