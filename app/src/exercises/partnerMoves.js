// What an exercise partner's animations are for. A grown-up picks a use for
// each animation in their exercise model (the server guesses from names like
// "Starfish_Sit_Up.L" and "Wave"). Moves with parts get pause marks: the
// partner stops at each one so the kid can catch up.

export const USES = [
  { key: 'starfish_in_left', name: '⭐ Left arm on top: get into position', parts: 'starfish' },
  { key: 'starfish_out_left', name: '⭐ Left arm on top: lie back to starfish' },
  { key: 'starfish_in_right', name: '⭐ Right arm on top: get into position', parts: 'starfish' },
  { key: 'starfish_out_right', name: '⭐ Right arm on top: lie back to starfish' },
  { key: 'cheer', name: '🎉 Cheer (at the end: “Great job!”)' }
];

// The steps inside "get into position", in order. Pause marks go between them.
export const PARTS = {
  starfish: ['Under arm on the chest', 'Other arm on top', 'Cross the leg', 'Sit up and tuck the head']
};

export const useOf = (key) => USES.find((u) => u.key === key);

// Which use an animation has (or null).
export function useFor(partner, animationName) {
  return Object.entries(partner.uses || {}).find(([, name]) => name === animationName)?.[0] ?? null;
}

// The animation for a move on one side, or the other side's if only one was made.
export function clipFor(partner, move, side) {
  const uses = partner.uses || {};
  const other = side === 'left' ? 'right' : 'left';
  return uses[`starfish_${move}_${side}`] || uses[`starfish_${move}_${other}`] || null;
}

export const canStarfish = (partner) => !!(partner && clipFor(partner, 'in', 'left'));

// Splits an animation into its parts at the pause marks: [[from, to], …].
// Missing marks are spread evenly over the rest, so it works (roughly) before
// any marks are set.
export function segments(marks = [], duration, parts) {
  const cuts = marks.filter((t) => t > 0 && t < duration).sort((a, b) => a - b).slice(0, parts - 1);
  const last = cuts.length ? cuts[cuts.length - 1] : 0;
  const missing = parts - 1 - cuts.length;
  for (let k = 1; k <= missing; k++) cuts.push(last + ((duration - last) * k) / (missing + 1));
  const edges = [0, ...cuts, duration];
  return edges.slice(0, -1).map((from, i) => [from, edges[i + 1]]);
}
