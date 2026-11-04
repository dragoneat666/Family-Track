import * as THREE from 'three';

// A dance moves bones by name. Rotations carry over between rigs as they are,
// but positions (mostly the hips) are in the units and size of the rig the
// dance was made on: a dance made in centimeters, or on a taller skeleton,
// would send the model flying or sinking. Scale each position track by how
// far this rig's bone sits from its parent compared to the dance's bone.
//
// Some dances also travel (step, step, step to the side), which would walk
// the model out of the picture. The hips keep their sway, but the slow drift
// across the floor is taken out so the dance stays where it started.
export function fitClip(clip, model, danceScene) {
  const positions = clip.tracks.filter((t) => t.name.endsWith('.position'));
  const hips = positions.find((t) => /hips|pelvis/i.test(t.name)) ?? positions[0];
  const tracks = [];
  for (const track of clip.tracks) {
    if (!track.name.endsWith('.position')) {
      tracks.push(track);
      continue;
    }
    const name = track.name.slice(0, -'.position'.length);
    const ours = model.getObjectByName(name)?.position.length();
    const theirs = danceScene.getObjectByName(name)?.position.length();
    const k = ours && theirs && Math.abs(ours / theirs - 1) >= 0.02 ? ours / theirs : 1;
    const fitted = track.clone();
    if (k !== 1) for (let i = 0; i < fitted.values.length; i++) fitted.values[i] *= k;
    if (track === hips) stayInPlace(fitted);
    tracks.push(fitted);
  }
  return new THREE.AnimationClip(clip.name, clip.duration, tracks);
}

// Subtract the hips' average sideways/forward position over about a second
// around each moment (x and z only; up and down are left alone), measured
// from where the dance starts.
function stayInPlace(track, window = 0.5) {
  const { times, values } = track;
  const n = times.length;
  if (n < 3) return;
  const avg = (i) => {
    let x = 0, z = 0, count = 0;
    for (let j = 0; j < n; j++) {
      if (Math.abs(times[j] - times[i]) > window) continue;
      x += values[j * 3];
      z += values[j * 3 + 2];
      count++;
    }
    return [x / count, z / count];
  };
  const means = Array.from({ length: n }, (_, i) => avg(i));
  const [x0, z0] = means[0];
  for (let i = 0; i < n; i++) {
    values[i * 3] -= means[i][0] - x0;
    values[i * 3 + 2] -= means[i][1] - z0;
  }
}

// Load a dance file and fit its motion to the model.
export async function loadDance(loader, url, model) {
  const gltf = await loader.loadAsync(url);
  const clip = gltf.animations[0];
  if (!clip) throw new Error('That dance has no motion in it');
  return fitClip(clip, model, gltf.scene);
}
