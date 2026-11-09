// Each kid can have their own brushing setting, from a tracking check done by
// them, for each place they brush (at the sink, sitting on the floor). The
// further away the face is, the less a brush shows up on the camera, and kids
// brush differently, so one setting for everyone doesn't fit.
//
// tuning = { standing: { threshold, d, at }, sitting: { ... } }
//   d = how big the face was (eye distance in camera pixels) during the check;
//   while brushing, the setting from the spot with the closest face size is used.

export const SPOTS = {
  standing: { label: 'Standing (at the sink)', short: 'standing', emoji: '🧍' },
  sitting: { label: 'Sitting (further from the camera)', short: 'sitting', emoji: '🧘' }
};

export const MIN_THRESHOLD = 1.5;
export const MAX_THRESHOLD = 20;
const GRACE_MS = 900; // same as the brushing screen: a short stop still counts

// Plays a check back as if the score needed were `threshold`. Returns how much
// of each step's time would have counted as brushing (0-100).
export function replay(samples, threshold) {
  const acc = {};
  let lastOn = -Infinity;
  let prevT = null;
  for (const x of samples) {
    if (x.detected && x.score > threshold) lastOn = x.t;
    const dt = prevT == null ? 0 : Math.min(300, x.t - prevT);
    prevT = x.t;
    const a = (acc[x.phase] ??= { on: 0, all: 0 });
    a.all += dt;
    if (x.t - lastOn <= GRACE_MS) a.on += dt;
  }
  return Object.fromEntries(Object.entries(acc).map(([k, a]) => [k, a.all ? Math.round((100 * a.on) / a.all) : 0]));
}

// The setting that counts the most real brushing while counting almost none of
// holding still, moving the head or moving the phone. Among settings that do
// about as well, the strictest wins, so it's hardest to fool. Null if no
// setting tells brushing apart well enough (brushing under 50%).
export function suggest(samples) {
  const good = [];
  for (let t = MIN_THRESHOLD; t <= MAX_THRESHOLD + 1e-9; t += 0.25) {
    const r = replay(samples, t);
    const fooled = Math.max(r.head ?? 0, r.phone ?? 0);
    if ((r.still ?? 0) <= 5 && fooled <= 15) good.push({ threshold: Math.round(t * 100) / 100, result: r });
  }
  if (!good.length) return null;
  const best = Math.max(...good.map((g) => g.result.brush ?? 0));
  if (best < 50) return null;
  const pick = good.filter((g) => (g.result.brush ?? 0) >= best - 3).pop();
  const sizes = samples.filter((x) => x.phase === 'brush' && x.detected && x.d > 0).map((x) => x.d).sort((a, b) => a - b);
  return { ...pick, d: sizes.length ? Math.round(sizes[sizes.length >> 1] * 10) / 10 : null };
}

// The setting to use for a face this big (eye distance in camera pixels).
export function thresholdFor(tuning, d) {
  const spots = Object.values(tuning || {}).filter((s) => s && s.threshold > 0);
  if (!spots.length) return null;
  if (spots.length === 1 || !(d > 0)) return spots[0].threshold;
  let best = spots[0];
  for (const s of spots) if (Math.abs(Math.log(d / s.d)) < Math.abs(Math.log(d / best.d))) best = s;
  return best.threshold;
}
