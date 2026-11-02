import { NodeIO, getBounds } from '@gltf-transform/core';
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

// Keeps only the skeleton and its animation. The app plays it on rigged.glb
// by matching bone names, so a dance from any file with the same rig works.
export async function processDance(characterId, danceId, file) {
  const io = await getIO();
  const doc = await io.read(file);
  const root = doc.getRoot();
  const anims = root.listAnimations();
  if (!anims.length) throw new Error('This file has no animation in it');
  for (const node of root.listNodes()) node.setMesh(null).setSkin(null);
  for (const skin of root.listSkins()) skin.dispose();
  for (const extra of anims.slice(1)) extra.dispose();
  await doc.transform(prune({ keepLeaves: true }), meshopt({ encoder: MeshoptEncoder, level: 'medium' }));
  const out = path.join(characterDir(characterId), 'dances', `${danceId}.glb`);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  await io.write(out, doc);
  return anims[0].getName();
}

// "Meshy_AI_Bumblebee_biped_Animation_Hip_Hop_Dance_withSkin.glb" -> "Hip Hop Dance"
export function niceName(filename) {
  return path.basename(filename, path.extname(filename))
    .replace(/^Meshy_AI_.*?_Animation_/i, '')
    .replace(/_withSkin$/i, '')
    .replace(/[_]+/g, ' ')
    .trim() || 'Untitled';
}
