import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';

// Still pictures of characters for the kids' Characters screen: pieces the
// kid has put on are drawn for real, the rest as the faint outline from the
// build screen. One hidden renderer draws them one at a time (tablets only
// allow a few 3D views at once), and pictures are kept until the pieces change.

const SIZE = 384;
const GHOST = { build: 0x8fc8ff, dress: 0xf6c4ff };
const cache = new Map(); // key -> Promise<dataUrl>
let queue = Promise.resolve();
let renderer;
let environment;

function setup() {
  if (renderer) return;
  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(1);
  renderer.setSize(SIZE, SIZE, false);
  const pmrem = new THREE.PMREMGenerator(renderer);
  environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  pmrem.dispose();
}

// character: { id, kind, version, pieces: [{ nodeName, placed }] }
export function characterPicture(character, url, headers) {
  const placed = character.pieces.filter((p) => p.placed).map((p) => p.nodeName).join(',');
  const key = `${character.id}:${character.version}:${placed}`;
  if (!cache.has(key)) {
    const job = queue.then(() => draw(character, url, headers));
    queue = job.catch(() => {});
    cache.set(key, job);
    job.catch(() => cache.delete(key));
  }
  return cache.get(key);
}

async function draw(character, url, headers) {
  setup();
  const loader = new GLTFLoader();
  loader.setMeshoptDecoder(MeshoptDecoder);
  loader.setRequestHeader(headers);
  const gltf = await loader.loadAsync(url);
  const root = gltf.scene;

  const ghost = new THREE.MeshBasicMaterial({
    color: GHOST[character.kind] ?? GHOST.build, transparent: true, opacity: 0.4, depthWrite: false
  });
  for (const p of character.pieces) {
    if (p.placed) continue;
    root.getObjectByName(p.nodeName)?.traverse((o) => { if (o.isMesh) o.material = ghost; });
  }

  const scene = new THREE.Scene();
  scene.environment = environment;
  scene.add(new THREE.HemisphereLight(0xffffff, 0x667788, 1.2));
  const sun = new THREE.DirectionalLight(0xffffff, 1.6);
  sun.position.set(1, 2, 3);
  scene.add(sun);
  scene.add(root);

  // Fit it from the front, like the build screen.
  const box = new THREE.Box3().setFromObject(root);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const camera = new THREE.PerspectiveCamera(35, 1, 0.01, 100);
  const tanHalf = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
  const dist = Math.max(size.y, size.x) / (2 * tanHalf * 0.9) + size.z / 2;
  camera.position.set(center.x, center.y, center.z + dist);
  camera.lookAt(center);
  camera.near = dist / 50;
  camera.far = dist * 10;
  camera.updateProjectionMatrix();

  renderer.setClearColor(0x000000, 0);
  renderer.render(scene, camera);
  const picture = renderer.domElement.toDataURL('image/png');

  root.traverse((o) => {
    if (!o.isMesh) return;
    o.geometry?.dispose();
    for (const m of [].concat(o.material)) {
      for (const v of Object.values(m)) if (v?.isTexture) v.dispose();
      m.dispose();
    }
  });
  return picture;
}
