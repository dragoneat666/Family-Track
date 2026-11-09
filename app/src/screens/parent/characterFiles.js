export const glbOnly = (files) => [...(files || [])].filter((f) => /\.glb$/i.test(f.name));

// Dances can also be Mixamo downloads (.fbx, "Without Skin").
export const danceFiles = (files) => [...(files || [])].filter((f) => /\.(glb|fbx)$/i.test(f.name));

// Which brush unlocks each piece (1, 2, …). Same rule as server/src/steps.js:
// one piece per brush, except dress up body parts next to each other in the
// list, which come together.
export function brushNumbers(pieces, dress) {
  let n = 0;
  return pieces.map((p, i) => {
    if (!(dress && p.reveal && pieces[i - 1]?.reveal)) n++;
    return n;
  });
}

export const KIND_EMOJI = { build: '🤖', dress: '👗', partner: '⭐' };

// Seconds as "1:05" or "8.4 s".
export const clock = (s) => (s >= 60 ? `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}` : `${s.toFixed(1)} s`);
