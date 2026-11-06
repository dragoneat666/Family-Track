// Exercises are scripts a grown-up edits: a list of scenes, each with a move
// (part of an animation from the character's exercise model), a voice line,
// words on the screen, and what happens next (go on, wait for the kid, or
// count while they hold). A stretch of scenes can repeat for the kid's rounds.
//
// script = {
//   defaults: { wait, hold, rounds },     used until a grown-up sets them per kid
//   repeat: { from: sceneId, to: sceneId } | null,
//   scenes: [{ id, name, words, notFirst, notLast,   (skipped in the first / last round)
//     move: { clip, from, to, speed, loop } | null,   to < from plays it backwards
//     voice: { line, at } | null,                       at = seconds into the scene
//     then: 'go' | 'wait' | 'count', seconds: number | null  (null = the kid's own time)
//   }]
// }

import crypto from 'node:crypto';

export const LINE_KEY = /^[a-z0-9_]{1,40}$/;
export const MAX_COUNT = 30;

// The lines every partner started with, and the words for them.
export const STARTER_TEXT = {
  starfish_start: 'Lie down like a starfish.',
  chest_right: 'Right arm on your chest.',
  chest_left: 'Left arm on your chest.',
  top_right: 'Right arm on top.',
  top_left: 'Left arm on top.',
  leg_right: 'Cross your right leg over.',
  leg_left: 'Cross your left leg over.',
  sit_up: 'Sit up and tuck your head.',
  hold: 'Hold it!',
  lie_back: 'Lie back down. Starfish!',
  other_side: 'Other side!',
  done: 'All done! Great job!'
};
const NUMBERS = [
  'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten',
  'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen', 'Twenty',
  'Twenty-one', 'Twenty-two', 'Twenty-three', 'Twenty-four', 'Twenty-five',
  'Twenty-six', 'Twenty-seven', 'Twenty-eight', 'Twenty-nine', 'Thirty'
];
export const isNumberLine = (key) => /^n([1-9]|[12]\d|30)$/.test(key);
export const numberText = (key) => NUMBERS[Number(key.slice(1)) - 1];
export const starterText = (key) => (isNumberLine(key) ? numberText(key) : STARTER_TEXT[key] ?? '');

export const newId = () => crypto.randomBytes(4).toString('hex');
export const newLineKey = () => `l_${crypto.randomBytes(5).toString('hex')}`;

const num = (v, lo, hi, fallback) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : fallback;
};
const round3 = (n) => Math.round(n * 1000) / 1000;
const text = (v, max) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

export const DEFAULTS = { wait: 5, hold: 10, rounds: 1 };

export function cleanSettings(s = {}, base = DEFAULTS) {
  return {
    wait: Math.round(num(s.wait, 0, 60, base.wait)),
    hold: Math.round(num(s.hold, 1, MAX_COUNT, base.hold)),
    rounds: Math.round(num(s.rounds, 1, 20, base.rounds))
  };
}

// Whatever the app sent, as a script that's safe to keep.
export function cleanScript(input) {
  const s = input && typeof input === 'object' ? input : {};
  const seen = new Set();
  const scenes = (Array.isArray(s.scenes) ? s.scenes : []).slice(0, 200).map((sc) => {
    let id = /^[a-z0-9]{1,16}$/.test(sc?.id) && !seen.has(sc.id) ? sc.id : newId();
    seen.add(id);
    const m = sc?.move;
    const v = sc?.voice;
    return {
      id,
      name: text(sc?.name, 40),
      words: text(sc?.words, 160),
      notFirst: !!sc?.notFirst,
      notLast: !!sc?.notLast,
      move: m && typeof m.clip === 'string' && m.clip ? {
        clip: m.clip.slice(0, 120),
        from: round3(num(m.from, 0, 3600, 0)),
        to: round3(num(m.to, 0, 3600, 0)),
        speed: round3(num(m.speed, 0.1, 4, 1)),
        loop: !!m.loop
      } : null,
      voice: v && LINE_KEY.test(v.line) ? { line: v.line, at: round3(num(v.at, 0, 60, 0)) } : null,
      then: ['go', 'wait', 'count'].includes(sc?.then) ? sc.then : 'go',
      seconds: sc?.seconds == null || sc.seconds === '' ? null : Math.round(num(sc.seconds, 0, sc?.then === 'count' ? MAX_COUNT : 120, 0))
    };
  });
  const ids = new Set(scenes.map((x) => x.id));
  let repeat = null;
  if (s.repeat && ids.has(s.repeat.from) && ids.has(s.repeat.to)) {
    const a = scenes.findIndex((x) => x.id === s.repeat.from);
    const b = scenes.findIndex((x) => x.id === s.repeat.to);
    repeat = { from: scenes[Math.min(a, b)].id, to: scenes[Math.max(a, b)].id };
  }
  return { defaults: cleanSettings(s.defaults), repeat, scenes };
}

// Splits an animation into parts at the old pause marks (missing ones spread
// evenly), the way partners worked before exercises could be edited.
function segments(marks = [], duration, parts) {
  const cuts = marks.filter((t) => t > 0 && t < duration).sort((a, b) => a - b).slice(0, parts - 1);
  const last = cuts.length ? cuts[cuts.length - 1] : 0;
  const missing = parts - 1 - cuts.length;
  for (let k = 1; k <= missing; k++) cuts.push(last + ((duration - last) * k) / (missing + 1));
  const edges = [0, ...cuts, duration];
  return edges.slice(0, -1).map((from, i) => [from, edges[i + 1]]);
}

// Hug & Starfish as it used to be built in, made from a partner's animations
// (what each is for, and the pause marks), as a script to edit. Null if it has no "get into position" animation.
export function starfishScript(ex) {
  const uses = ex?.uses || {};
  const length = new Map((ex?.animations || []).map((a) => [a.name, a.seconds]));
  const clip = (move, side) => uses[`starfish_${move}_${side}`] || uses[`starfish_${move}_${side === 'left' ? 'right' : 'left'}`] || null;
  if (!clip('in', 'left')) return null;
  // Scenes show their voice line's words (no words of their own), so changing
  // a line's words changes the screen too.
  const say = (line, words, rest) => ({
    id: newId(), name: '', words: '', notFirst: false, notLast: false, move: null,
    voice: { line, at: 0 }, then: 'go', seconds: null, ...rest
  });
  const side = (top) => {
    const under = top === 'left' ? 'right' : 'left';
    const cap = (w) => w[0].toUpperCase() + w.slice(1);
    const into = clip('in', top);
    const len = length.get(into) || 1;
    const parts = segments(ex.marks?.[into], len, 4);
    const out = clip('out', top);
    const part = (n) => ({ clip: into, from: round3(parts[n][0]), to: round3(parts[n][1]), speed: 1, loop: false });
    return [
      say(`chest_${under}`, `${cap(under)} arm on your chest`, { name: `${cap(top)} on top: under arm`, move: part(0), then: 'wait' }),
      say(`top_${top}`, `${cap(top)} arm on top`, { name: 'Top arm', move: part(1), then: 'wait' }),
      say(`leg_${top}`, `Cross your ${top} leg over`, { name: 'Cross the leg', move: part(2), then: 'wait' }),
      say('sit_up', 'Sit up and tuck your head', { name: 'Sit up', move: part(3), then: 'wait' }),
      say('hold', 'Hold it!', { name: 'Hold', move: { clip: into, from: round3(len), to: round3(len), speed: 1, loop: false }, then: 'count' }),
      say('lie_back', 'Lie back down… starfish!', {
        name: 'Lie back',
        move: out
          ? { clip: out, from: 0, to: round3(length.get(out) || 1), speed: 1, loop: false }
          : { clip: into, from: round3(len), to: 0, speed: 1, loop: false },
        then: 'wait'
      })
    ];
  };
  const start = say('starfish_start', 'Lie down like a starfish', {
    name: 'Starfish', move: { clip: clip('in', 'left'), from: 0, to: 0, speed: 1, loop: false }, then: 'wait'
  });
  const again = say('other_side', 'Other side!', { name: 'Switch sides', notFirst: true });
  const left = side('left');
  const switchSides = say('other_side', 'Other side!', { name: 'Switch sides' });
  const right = side('right');
  const cheer = uses.cheer;
  const done = say('done', 'All done! Great job!', {
    name: 'Done', move: cheer ? { clip: cheer, from: 0, to: round3(length.get(cheer) || 1), speed: 1, loop: true } : null
  });
  const scenes = [start, again, ...left, switchSides, ...right, done];
  return cleanScript({ defaults: DEFAULTS, repeat: { from: again.id, to: right[right.length - 1].id }, scenes });
}

// Every voice line a script uses.
export const linesUsed = (script) => [...new Set((script?.scenes || []).map((s) => s.voice?.line).filter(Boolean))];
