// How a character's pieces are handed out, one step per counted brush.
//
// Build (robots): every piece is its own step.
// Dress up (people): clothes are placed like pieces, but body parts are
// revealed instead: they appear under sparkly clouds the kid rubs away. Body
// parts that come one after another in the unlock order are one step, so
// "Shorts, then Stomach + Legs" is two brushes: place the shorts, then rub
// the clouds off the stomach and legs.

// "Stomach (Body)" / "Left Leg [body part]" from Blender -> a body part named "Stomach".
const BODY_TAG = /\s*[([]\s*body(?:\s*part)?\s*[)\]]\s*/i;
export function pieceName(raw) {
  const s = String(raw ?? '');
  return BODY_TAG.test(s) ? { name: s.replace(BODY_TAG, ' ').replace(/\s+/g, ' ').trim() || 'Body', reveal: true } : { name: s, reveal: false };
}

// pieces: all of a character's pieces in unlock order, each with { reveal,
// unlocked }. The pieces the next brush unlocks (empty when all are).
export function nextStep(pieces, kind) {
  const i = pieces.findIndex((p) => !p.unlocked);
  if (i < 0) return [];
  if (kind !== 'dress' || !pieces[i].reveal) return [pieces[i]];
  const step = [];
  for (let j = i; j < pieces.length && pieces[j].reveal && !pieces[j].unlocked; j++) step.push(pieces[j]);
  return step;
}

// "Stomach", "Stomach and Left Leg", "Stomach, Left Leg and Right Leg".
export function stepLabel(step) {
  const names = step.map((p) => p.name);
  return names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names.at(-1)}` : names[0] ?? null;
}
