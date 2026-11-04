// Reads an FBX file (e.g. a Mixamo download) with three.js and sends back
// its skeleton and first animation as plain data. Runs in a worker thread
// because three's FBX loader expects a browser, and the small stand-ins for
// browser globals below should never leak into the main server.
import { parentPort, workerData } from 'node:worker_threads';
import fs from 'node:fs';

globalThis.self ??= globalThis;
globalThis.window ??= globalThis;
globalThis.document ??= {
  createElementNS: () => ({ style: {}, addEventListener() {}, removeEventListener() {}, setAttribute() {} })
};

const { FBXLoader } = await import('three/examples/jsm/loaders/FBXLoader.js');

const PATHS = { position: 'translation', quaternion: 'rotation', scale: 'scale' };

try {
  const buf = fs.readFileSync(workerData.file);
  const root = new FBXLoader().parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.length), '');
  const clip = root.animations[0];
  if (!clip) throw new Error('This file has no animation in it');

  // Every object except meshes (bones and the groups above them), parents first.
  const nodes = [];
  const index = new Map();
  root.traverse((o) => {
    if (o.isMesh || o.isSkinnedMesh) return;
    index.set(o, nodes.length);
    nodes.push({
      name: o.name || 'Armature',
      parent: o.parent && index.has(o.parent) ? index.get(o.parent) : -1,
      t: o.position.toArray(), r: o.quaternion.toArray(), s: o.scale.toArray()
    });
  });
  const byName = new Map(nodes.map((n, i) => [n.name, i]));

  const tracks = [];
  for (const track of clip.tracks) {
    const dot = track.name.lastIndexOf('.');
    const node = byName.get(track.name.slice(0, dot));
    const path = PATHS[track.name.slice(dot + 1)];
    if (node == null || !path) continue;
    tracks.push({ node, path, times: Float32Array.from(track.times), values: Float32Array.from(track.values) });
  }
  if (!tracks.length) throw new Error('This file has no animation in it');
  parentPort.postMessage({ name: clip.name, nodes, tracks });
} catch (e) {
  parentPort.postMessage({ error: e.message || String(e) });
}
