import { numberLine } from './lines.js';

// Turns an exercise script into a timeline: every scene that plays, in order
// (the repeated ones once per round), with when it starts, how long its move
// and voice take, and how long it then waits or counts. The same timeline
// drives the kid's exercise and the grown-up's preview, so what you see while
// editing is what the kid gets.

export const FADE = 0.3; // seconds to blend from one animation into the next

export const DEFAULT_SETTINGS = { wait: 5, hold: 10, rounds: 1 };

export function settingsFor(exercise, saved) {
  return { ...DEFAULT_SETTINGS, ...(exercise?.script?.defaults || {}), ...(saved || {}) };
}

// Which scenes repeat: indexes [from, to], or null.
export function repeatRange(script) {
  const r = script?.repeat;
  if (!r) return null;
  const a = script.scenes.findIndex((s) => s.id === r.from);
  const b = script.scenes.findIndex((s) => s.id === r.to);
  return a < 0 || b < 0 ? null : [Math.min(a, b), Math.max(a, b)];
}

// The scenes in playing order: [{ scene, index, round }] (round only for
// repeated scenes). Scenes marked notFirst are left out of round 1, and
// notLast out of the last round (with one round, both).
export function sequence(script, rounds) {
  const scenes = script?.scenes || [];
  const range = repeatRange(script);
  if (!range) return scenes.map((scene, index) => ({ scene, index, round: null }));
  const out = [];
  scenes.slice(0, range[0]).forEach((scene, index) => out.push({ scene, index, round: null }));
  for (let r = 1; r <= rounds; r++) {
    for (let i = range[0]; i <= range[1]; i++) {
      if (scenes[i].notFirst && r === 1) continue;
      if (scenes[i].notLast && r === rounds) continue;
      out.push({ scene: scenes[i], index: i, round: r });
    }
  }
  for (let i = range[1] + 1; i < scenes.length; i++) out.push({ scene: scenes[i], index: i, round: null });
  return out;
}

export const moveLength = (move) => (move ? Math.abs(move.to - move.from) / (move.speed || 1) : 0);

// How long one scene runs: its move and voice (whichever is longer), then the
// wait or the count. voiceLength(key) gives a line's length in seconds.
export function sceneTiming(scene, settings, voiceLength) {
  const move = moveLength(scene.move);
  const voice = scene.voice ? scene.voice.at + voiceLength(scene.voice.line) : 0;
  const main = Math.max(move, voice, scene.move || scene.voice ? 0.3 : 1);
  let extra = 0;
  let count = 0;
  if (scene.then === 'wait') extra = scene.seconds ?? settings.wait;
  if (scene.then === 'count') {
    count = scene.seconds ?? settings.hold;
    extra = count + 1;
  }
  return { move, voice, main, extra, count, length: main + extra };
}

// wordsOf(lineKey) gives a line's words: shown when a scene has none of its own.
export function buildTimeline(script, settings, voiceLength, wordsOf = () => '') {
  let t = 0;
  const segs = sequence(script, settings.rounds).map((item, i) => {
    const timing = sceneTiming(item.scene, settings, voiceLength);
    const words = item.scene.words || (item.scene.voice ? wordsOf(item.scene.voice.line) : '') || '';
    const seg = { ...item, ...timing, words, i, start: t, end: t + timing.length };
    t = seg.end;
    return seg;
  });
  // Voice cues: each scene's line, and the numbers while counting.
  const cues = [];
  for (const s of segs) {
    if (s.scene.voice) cues.push({ at: s.start + s.scene.voice.at, line: s.scene.voice.line });
    for (let n = 1; n <= s.count; n++) cues.push({ at: s.start + s.main + n, line: numberLine(n) });
  }
  cues.sort((a, b) => a.at - b.at);
  const rounds = segs.reduce((m, s) => Math.max(m, s.round || 0), 0);
  return { segs, cues, total: t, rounds };
}

// Where a move is, `local` seconds into its scene. Looping moves go round
// for the whole scene; others stop at the end and hold it.
export function movePose(move, local) {
  if (!move) return null;
  const span = move.to - move.from;
  const len = Math.abs(span) / (move.speed || 1);
  if (len < 1e-3) return { clip: move.clip, time: move.from };
  let p = local / len;
  p = move.loop ? p - Math.floor(p) : Math.min(1, Math.max(0, p));
  return { clip: move.clip, time: move.from + span * p };
}

const endPose = (seg) => (seg.scene.move ? movePose(seg.scene.move, seg.scene.move.loop ? 0 : seg.main) : null);

// Everything to show at time T: the scene, the pose (and the one it's
// blending from), the words, and the countdown or count.
export function sample(tl, T) {
  const segs = tl.segs;
  if (!segs.length) return null;
  const t = Math.max(0, Math.min(T, tl.total));
  let i = segs.findIndex((s) => t < s.end);
  if (i < 0) i = segs.length - 1;
  const seg = segs[i];
  const local = t - seg.start;
  // A scene without a move holds wherever the last move left off.
  let before = null;
  for (let j = i - 1; j >= 0 && !before; j--) before = endPose(segs[j]);
  const pose = seg.scene.move ? movePose(seg.scene.move, local) : before;
  let from = null;
  let weight = 1;
  if (seg.scene.move && before && before.clip !== pose.clip && local < FADE) {
    from = before;
    weight = local / FADE;
  }
  const out = { seg, i, local, pose, from, weight, phase: 'main', words: seg.words, count: null, left: null };
  if (local >= seg.main && seg.extra > 0) {
    const into = local - seg.main;
    if (seg.scene.then === 'wait') {
      out.phase = 'wait';
      out.left = Math.max(1, Math.ceil(seg.extra - into));
    } else {
      out.phase = 'count';
      out.count = Math.min(seg.count, Math.floor(into)) || null;
    }
  }
  return out;
}

// The scene starts before and after T, for the back and next buttons. Back
// goes to the start of this scene, or the one before if it only just began.
export function previousStart(tl, T) {
  const s = sample(tl, T);
  if (!s) return 0;
  if (s.local > 1.2 || s.i === 0) return s.seg.start;
  return tl.segs[s.i - 1].start;
}

export function nextStart(tl, T) {
  const s = sample(tl, T);
  return s && s.i + 1 < tl.segs.length ? tl.segs[s.i + 1].start : tl.total;
}
