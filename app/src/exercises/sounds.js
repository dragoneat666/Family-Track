// The metronome's woodblock-like tick, shared by the exercises. pitch < 1
// makes it lower (used for "done").
export function tick(ctx, t = ctx.currentTime, pitch = 1, volume = 1) {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = 'triangle';
  osc.frequency.setValueAtTime(1800 * pitch, t);
  osc.frequency.exponentialRampToValueAtTime(900 * pitch, t + 0.03);
  gain.gain.setValueAtTime(0.0001, t);
  gain.gain.linearRampToValueAtTime(volume, t + 0.001);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.04);
  osc.start(t);
  osc.stop(t + 0.05);
  osc.connect(gain).connect(ctx.destination);
}

export function audioContext() {
  return new (window.AudioContext || window.webkitAudioContext)();
}
