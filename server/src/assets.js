import { NodeIO, Document, getBounds } from '@gltf-transform/core';
import { Worker } from 'node:worker_threads';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, prune, weld, simplify, textureCompress, meshopt, mergeDocuments, unpartition } from '@gltf-transform/functions';
import { MeshoptDecoder, MeshoptEncoder, MeshoptSimplifier } from 'meshoptimizer';
import sharp from 'sharp';
import fs from 'node:fs';
import path from 'node:path';
import { ASSETS_DIR, BUILD_MAX_TRIANGLES, RIGGED_MAX_TRIANGLES, TEXTURE_SIZE } from './config.js';

// Turns the big files exported from Meshy/Blender into small ones the
// tablets can load quickly:
//   build.glb        all pieces of a character in one file, one node per piece
//   rigged.glb       the dancing model (mesh + skeleton)
//   dances/<id>.glb  motion only, no mesh or textures

let ioPromise;
function getIO() {
  ioPromise ??= Promise.all([MeshoptDecoder.ready, MeshoptEncoder.ready, MeshoptSimplifier.ready]).then(() =>
    new NodeIO()
      .registerExtensions(ALL_EXTENSIONS)
      .registerDependencies({ 'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder })
  );
  return ioPromise;
}

export const characterDir = (characterId) => path.join(ASSETS_DIR, String(characterId));

// The JSON part of a .glb, read without loading the rest (names and counts).
// Null for anything that isn't a .glb.
function glbJson(file) {
  let fd;
  try {
    fd = fs.openSync(file, 'r');
    const head = Buffer.alloc(20);
    fs.readSync(fd, head, 0, 20, 0);
    if (head.readUInt32LE(0) !== 0x46546c67 || head.readUInt32LE(16) !== 0x4e4f534a) return null; // "glTF", "JSON"
    const json = Buffer.alloc(head.readUInt32LE(12));
    fs.readSync(fd, json, 0, json.length, 20);
    return JSON.parse(json.toString('utf8'));
  } catch {
    return null;
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
}

// The objects at the top of a .glb's scene that have a mesh somewhere in
// them, as [{ index, name }] (index = place among the scene's top nodes).
// A file from Blender with every piece in it has one per piece.
export function glbObjects(file) {
  const g = glbJson(file);
  if (!g?.scenes?.length) return [];
  const nodes = g.nodes || [];
  const hasMesh = (i, seen = new Set()) => {
    if (seen.has(i) || !nodes[i]) return false;
    seen.add(i);
    return nodes[i].mesh !== undefined || (nodes[i].children || []).some((c) => hasMesh(c, seen));
  };
  const top = g.scenes[g.scene ?? 0]?.nodes || [];
  return top.map((n, index) => ({ index, node: n, name: nodes[n]?.name || '' })).filter((o) => hasMesh(o.node));
}

// The animations' names in a .glb (empty for .fbx or a file with none).
export function glbAnimations(file) {
  return (glbJson(file)?.animations || []).map((a, i) => a.name || `Dance ${i + 1}`);
}

// Saves each wanted top object of a many-piece .glb as its own file, as if
// it had been exported on its own: outs = [{ index, out }].
export async function splitPieces(file, outs) {
  const io = await getIO();
  for (const { index, out } of outs) {
    const doc = await io.read(file);
    const scene = doc.getRoot().getDefaultScene() || doc.getRoot().listScenes()[0];
    scene.listChildren().forEach((n, i) => { if (i !== index) n.dispose(); });
    await doc.transform(prune());
    await io.write(out, doc);
  }
}

function countTriangles(doc) {
  let tris = 0;
  for (const mesh of doc.getRoot().listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      const idx = prim.getIndices();
      tris += Math.floor((idx ? idx.getCount() : prim.getAttribute('POSITION').getCount()) / 3);
    }
  }
  return tris;
}

// Simplify only as much as needed to get under the budget. lockBorder keeps
// the open edges where two pieces meet, so seams stay closed.
async function shrink(doc, maxTriangles, { lockBorder = false } = {}) {
  await doc.transform(dedup(), prune(), weld());
  const before = countTriangles(doc);
  if (before > maxTriangles) {
    const ratio = maxTriangles / before;
    await doc.transform(simplify({ simplifier: MeshoptSimplifier, ratio, error: 0.01, lockBorder }));
  }
  await doc.transform(
    prune(),
    textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [TEXTURE_SIZE, TEXTURE_SIZE], quality: 85 }),
    meshopt({ encoder: MeshoptEncoder, level: 'medium' })
  );
  return { before, after: countTriangles(doc) };
}

// pieces: [{ nodeName, file }] — every piece must have been exported in the
// same position space (as if the character were whole), so each one's home
// is simply where it already sits.
export async function buildCharacterModel(characterId, pieces) {
  const io = await getIO();
  const target = await io.read(pieces[0].file);
  const root = target.getRoot();
  const scene = root.getDefaultScene() || root.listScenes()[0];
  wrapSceneChildren(target, scene, pieces[0].nodeName);

  for (const piece of pieces.slice(1)) {
    const source = await io.read(piece.file);
    const srcScene = source.getRoot().getDefaultScene() || source.getRoot().listScenes()[0];
    const map = mergeDocuments(target, source);
    const merged = map.get(srcScene);
    const group = target.createNode(piece.nodeName);
    for (const child of merged.listChildren()) group.addChild(child);
    scene.addChild(group);
    merged.dispose();
  }
  root.setDefaultScene(scene);
  for (const s of root.listScenes()) if (s !== scene) s.dispose();
  await target.transform(unpartition()); // a .glb holds one data buffer

  // Lowest point of each piece, so new characters can unlock bottom-up
  // (feet/shoes first, head last).
  const bottoms = {};
  for (const node of scene.listChildren()) bottoms[node.getName()] = getBounds(node).min[1];

  const tris = await shrink(target, BUILD_MAX_TRIANGLES, { lockBorder: true });
  const out = path.join(characterDir(characterId), 'build.glb');
  fs.mkdirSync(path.dirname(out), { recursive: true });
  await io.write(out, target);
  return { ...tris, bottoms };
}

function wrapSceneChildren(doc, scene, nodeName) {
  const group = doc.createNode(nodeName);
  for (const child of scene.listChildren()) group.addChild(child);
  scene.addChild(group);
}

export async function processRigged(characterId, file) {
  const io = await getIO();
  const doc = await io.read(file);
  // The rigged model doubles as the first dance file in Meshy exports; its
  // motion is kept separately as a dance, so drop it here.
  for (const anim of doc.getRoot().listAnimations()) anim.dispose();
  const tris = await shrink(doc, RIGGED_MAX_TRIANGLES);
  const out = path.join(characterDir(characterId), 'rigged.glb');
  fs.mkdirSync(path.dirname(out), { recursive: true });
  await io.write(out, doc);
  return tris;
}

// The exercise model: mesh, skeleton, props (a pillow…) and every exercise
// animation, all kept. Returns the animations' names and lengths.
export async function processExercise(characterId, file) {
  const io = await getIO();
  const doc = await io.read(file);
  const animations = doc.getRoot().listAnimations().map((a) => {
    let seconds = 0;
    for (const s of a.listSamplers()) {
      const times = s.getInput()?.getArray();
      if (times?.length) seconds = Math.max(seconds, times[times.length - 1]);
    }
    return { name: a.getName() || 'Untitled', seconds: Math.round(seconds * 1000) / 1000 };
  });
  if (!animations.length) throw new Error('This file has no animations in it');
  const tris = await shrink(doc, RIGGED_MAX_TRIANGLES);
  const out = path.join(characterDir(characterId), 'exercise.glb');
  fs.mkdirSync(path.dirname(out), { recursive: true });
  await io.write(out, doc);
  return { ...tris, animations };
}

// FBX files start with "Kaydara FBX Binary" (or "; FBX" when saved as text).
export function isFbx(file) {
  const head = Buffer.alloc(20);
  const fd = fs.openSync(file, 'r');
  try { fs.readSync(fd, head, 0, 20, 0); } finally { fs.closeSync(fd); }
  const text = head.toString('latin1');
  return text.startsWith('Kaydara FBX') || text.startsWith('; FBX');
}

// An FBX animation (e.g. from Mixamo) as a glTF document: the skeleton's
// nodes plus one animation, no meshes.
function readFbxAnimation(file) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./fbx-worker.js', import.meta.url), { workerData: { file } });
    worker.once('message', (msg) => {
      worker.terminate();
      if (msg.error) return reject(new Error(msg.error));
      const doc = new Document();
      const buffer = doc.createBuffer();
      const scene = doc.createScene();
      doc.getRoot().setDefaultScene(scene);
      const nodes = msg.nodes.map((n) => doc.createNode(n.name).setTranslation(n.t).setRotation(n.r).setScale(n.s));
      msg.nodes.forEach((n, i) => (n.parent >= 0 ? nodes[n.parent] : scene).addChild(nodes[i]));
      const anim = doc.createAnimation(msg.name);
      for (const t of msg.tracks) {
        const input = doc.createAccessor().setType('SCALAR').setArray(t.times).setBuffer(buffer);
        const output = doc.createAccessor().setType(t.path === 'rotation' ? 'VEC4' : 'VEC3').setArray(t.values).setBuffer(buffer);
        const sampler = doc.createAnimationSampler().setInput(input).setOutput(output).setInterpolation('LINEAR');
        anim.addSampler(sampler).addChannel(
          doc.createAnimationChannel().setTargetNode(nodes[t.node]).setTargetPath(t.path).setSampler(sampler));
      }
      resolve(doc);
    });
    worker.once('error', reject);
  });
}

// Keeps only the skeleton and its animation. The app plays it on rigged.glb
// by matching bone names, so a dance from any file with the same rig works.
// Takes .glb (Meshy) or .fbx (Mixamo "Without Skin" downloads). `which` picks
// one animation from a file with several (one dance each).
export async function processDance(characterId, danceId, file, which = 0) {
  const io = await getIO();
  const doc = isFbx(file) ? await readFbxAnimation(file) : await io.read(file);
  const root = doc.getRoot();
  const anims = root.listAnimations();
  if (!anims[which]) throw new Error('This file has no animation in it');
  for (const node of root.listNodes()) node.setMesh(null).setSkin(null);
  for (const skin of root.listSkins()) skin.dispose();
  anims.forEach((a, i) => { if (i !== which) a.dispose(); });
  await doc.transform(prune({ keepLeaves: true }), meshopt({ encoder: MeshoptEncoder, level: 'medium' }));
  const out = path.join(characterDir(characterId), 'dances', `${danceId}.glb`);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  await io.write(out, doc);
  return anims[which].getName();
}

// "Hip_Hop_Dance_2" -> "Hip Hop Dance 2"; "Right Leg" stays.
export const cleanObjectName = (name, fallback) => String(name || '').replace(/_+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60) || fallback;

// "Meshy_AI_Bumblebee_biped_Animation_Hip_Hop_Dance_withSkin.glb" -> "Hip Hop Dance"
export function niceName(filename) {
  return path.basename(filename, path.extname(filename))
    .replace(/^Meshy_AI_.*?_Animation_/i, '')
    .replace(/_withSkin$/i, '')
    .replace(/[_]+/g, ' ')
    .trim() || 'Untitled';
}
