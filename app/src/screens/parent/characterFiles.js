export const glbOnly = (files) => [...(files || [])].filter((f) => /\.glb$/i.test(f.name));

// Dances can also be Mixamo downloads (.fbx, "Without Skin").
export const danceFiles = (files) => [...(files || [])].filter((f) => /\.(glb|fbx)$/i.test(f.name));

export const KIND_EMOJI = { build: '🤖', dress: '👗', partner: '⭐' };

// Seconds as "1:05" or "8.4 s".
export const clock = (s) => (s >= 60 ? `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}` : `${s.toFixed(1)} s`);
