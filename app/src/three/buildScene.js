import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { loadDance } from './dance.js';

// The build board. Every piece in build.glb already sits at its "home" (the
// files were exported from the whole character), so:
//  - placed pieces are drawn where they are,
//  - unlocked-but-unplaced pieces float in a tray and get dragged home.
//
// Levels (each kid picks one):
//  - easy: pieces not placed yet show as a faint ghost, and a piece snaps in
//    when it's dropped near its spot.
//  - medium: no ghosts. A dropped piece stays where it was let go ("parked")
//    until the kid taps Check. Close enough clicks in; otherwise it wiggles.
//    Three misses on one piece flash its ghost for a moment.
//  - hard: medium, plus pieces arrive turned and the kid turns them back with
//    the arrows (quarter turns in the screen's plane).
// The character's first piece always works like easy, so they know where to start.

const GHOST_COLORS = { build: 0x8fc8ff, dress: 0xf6c4ff };
const SNAP_FRACTION = 0.09; // how close (share of the screen) counts as "there"
const TRAY_SLOTS = 4; // more waiting pieces than this queue up behind
const QUARTER = Math.PI / 2;
const HINT_AFTER = 3; // wrong checks on one piece before its outline flashes
const HINT_SECONDS = 1.6;

export class BuildScene {
  constructor(container, { onPlace, onTrayChange, onParkedChange, level = 'easy' } = {}) {
    this.container = container;
    this.onPlace = onPlace;
    this.onTrayChange = onTrayChange;
    this.onParkedChange = onParkedChange;
    this.level = level;
    this.pieces = new Map(); // id -> { id, pivot, ghost, homeLocal, state: locked|tray|parked|placed }
    this.anims = [];
    this.clock = new THREE.Clock();

    const renderer = new THREE.WebGLRenderer({ antialias: window.devicePixelRatio < 2, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    renderer.domElement.style.touchAction = 'none';
    container.appendChild(renderer.domElement);
    this.renderer = renderer;

    this.scene = new THREE.Scene();
    const pmrem = new THREE.PMREMGenerator(renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    pmrem.dispose();
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x667788, 1.2));
    const sun = new THREE.DirectionalLight(0xffffff, 1.6);
    sun.position.set(1, 2, 3);
    this.scene.add(sun);

    this.camera = new THREE.PerspectiveCamera(35, 1, 0.01, 100);
    this.raycaster = new THREE.Raycaster();

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);

    const el = renderer.domElement;
    this.handlers = {
      down: (e) => this.pointerDown(e),
      move: (e) => this.pointerMove(e),
      up: (e) => this.pointerUp(e)
    };
    el.addEventListener('pointerdown', this.handlers.down);
    el.addEventListener('pointermove', this.handlers.move);
    el.addEventListener('pointerup', this.handlers.up);
    el.addEventListener('pointercancel', this.handlers.up);

    renderer.setAnimationLoop(() => this.frame());
  }

  loader(headers) {
    const loader = new GLTFLoader();
    loader.setMeshoptDecoder(MeshoptDecoder);
    loader.setRequestHeader(headers);
    return loader;
  }

  // character: from the kid state ({ kind, pieces: [{ id, nodeName, unlocked, placed }] })
  async load(url, headers, character) {
    const gltf = await this.loader(headers).loadAsync(url);
    this.kind = character.kind;
    this.root = gltf.scene;
    this.scene.add(this.root);
    this.root.updateMatrixWorld(true);

    const ghostMat = new THREE.MeshBasicMaterial({
      color: GHOST_COLORS[character.kind] ?? GHOST_COLORS.build,
      transparent: true, opacity: 0.16, depthWrite: false
    });
    // Ghosts live inside root so they turn with the model.
    this.ghostRoot = new THREE.Group();
    this.root.add(this.ghostRoot);
    const rootInverse = this.root.matrixWorld.clone().invert();

    for (const p of character.pieces) {
      const node = this.root.getObjectByName(p.nodeName);
      if (!node) continue;
      const ghost = node.clone(true);
      ghost.traverse((o) => { if (o.isMesh) o.material = ghostMat.clone(); });
      rootInverse.clone().multiply(node.matrixWorld).decompose(ghost.position, ghost.quaternion, ghost.scale);
      ghost.name = `ghost_${p.id}`;
      this.ghostRoot.add(ghost);

      // Wrap each piece in a pivot at its own center, so it can be moved and
      // scaled around its middle. At pivot "home" it sits exactly in place.
      const bounds = new THREE.Box3().setFromObject(node);
      const center = bounds.getCenter(new THREE.Vector3());
      const size = bounds.getSize(new THREE.Vector3());
      const pivot = new THREE.Group();
      pivot.position.copy(this.root.worldToLocal(center.clone()));
      this.root.add(pivot);
      pivot.attach(node);
      const piece = {
        id: p.id, name: p.name, pivot, ghost, size: Math.max(size.x, size.y, 1e-6),
        homeLocal: pivot.position.clone(), state: null, wobble: Math.random() * 6,
        turn: 0, angle: 0, misses: 0, hintUntil: 0, shakeAt: -1
      };
      if (!this.firstPiece) this.firstPiece = piece;
      this.pieces.set(p.id, piece);
      if (this.level === 'hard' && piece !== this.firstPiece && !p.placed) this.scramble(piece, node);
    }

    this.box = new THREE.Box3().setFromObject(this.root);
    this.resize();
    this.setState(character);
  }

  // Apply unlocked/placed flags from the server.
  setState(character) {
    let trayChanged = false;
    for (const p of character.pieces) {
      const piece = this.pieces.get(p.id);
      if (!piece) continue;
      const state = p.placed ? 'placed' : p.unlocked ? 'tray' : 'locked';
      if (piece.state === state || (piece.state === 'parked' && state === 'tray')) continue;
      if (piece.state === 'tray' || state === 'tray') trayChanged = true;
      piece.state = state;
      piece.pivot.visible = state !== 'locked';
      if (state === 'placed') this.sendHome(piece, false);
    }
    this.updateGhosts();
    if (trayChanged) {
      this.root.rotation.y = 0;
      this.layoutTray(false);
      this.onTrayChange?.(this.trayPieces().map((p) => p.id));
    }
  }

  // All unlocked-but-unplaced pieces, in unlock order.
  trayPieces() {
    return [...this.pieces.values()].filter((p) => p.state === 'tray');
  }

  // The ones actually showing in the tray right now.
  shownTray() {
    return this.trayPieces().slice(0, TRAY_SLOTS);
  }

  // Dropped on the model but not checked yet (medium and hard).
  parkedPieces() {
    return [...this.pieces.values()].filter((p) => p.state === 'parked');
  }

  // Outline + snap for this piece? Always on easy, and for the first piece.
  easyFor(piece) {
    return this.level === 'easy' || piece === this.firstPiece;
  }

  updateGhosts(now = this.clock.elapsedTime) {
    for (const piece of this.pieces.values()) {
      const hint = piece.hintUntil > now;
      piece.ghost.visible = piece.state !== 'placed' && (this.easyFor(piece) || hint);
      if (piece.hinting !== hint) {
        piece.hinting = hint;
        this.highlight(piece, hint);
      }
    }
  }

  // Pick a starting turn that doesn't already look right (hard). A piece that
  // looks the same turned (a ball, a square block) counts as right in those turns.
  scramble(piece, node) {
    const { queries, targets } = samplePoints(node, piece.pivot);
    piece.okTurns = [0, ...[1, 2, 3].filter((k) => sameShape(queries, targets, k, piece.size))];
    const wrong = [1, 2, 3].filter((k) => !piece.okTurns.includes(k));
    piece.turn = wrong.length ? wrong[Math.floor(Math.random() * wrong.length)] : 0;
    piece.angle = piece.turn * QUARTER;
  }

  turnedRight(piece) {
    return !piece.okTurns || piece.okTurns.includes(((piece.turn % 4) + 4) % 4);
  }

  // The arrows turn the piece the kid touched last (or the next one waiting).
  turn(dir) {
    if (this.dancer) return;
    let piece = this.selected;
    if (!piece || (piece.state !== 'tray' && piece.state !== 'parked') || (piece.state === 'tray' && !this.shownTray().includes(piece))) {
      piece = this.parkedPieces().at(-1) || this.shownTray()[0];
    }
    if (!piece || piece === this.firstPiece) return;
    this.selected = piece;
    piece.turn += dir;
  }

  // Medium/hard: snap every parked piece that's close enough (and turned
  // right); wiggle the rest. Returns what happened so the screen can say so.
  check() {
    const result = { placed: 0, wrongSpot: 0, wrongTurn: 0 };
    const now = this.clock.elapsedTime;
    for (const piece of this.parkedPieces()) {
      const near = this.nearHome(piece);
      if (near && this.turnedRight(piece)) {
        this.placePiece(piece);
        result.placed++;
      } else {
        result[near ? 'wrongTurn' : 'wrongSpot']++;
        piece.shakeAt = now;
        piece.misses++;
        if (piece.misses >= HINT_AFTER) piece.hintUntil = now + HINT_SECONDS;
      }
    }
    this.updateGhosts(now);
    this.onParkedChange?.(this.parkedPieces().length);
    return result;
  }

  // Screen distance between where the piece is and where it belongs.
  nearHome(piece) {
    const at = this.root.localToWorld(piece.pivot.position.clone()).project(this.camera);
    const home = this.root.localToWorld(piece.homeLocal.clone()).project(this.camera);
    const w = this.container.clientWidth, h = this.container.clientHeight;
    const dx = ((at.x - home.x) / 2) * w;
    const dy = ((at.y - home.y) / 2) * h;
    return Math.hypot(dx, dy) < Math.min(w, h) * SNAP_FRACTION + 20;
  }

  placePiece(piece) {
    piece.state = 'placed';
    piece.ghost.visible = false;
    if (this.selected === piece) this.selected = null;
    this.sendHome(piece, true, () => this.pop(piece));
    this.layoutTray(true); // the next waiting piece slides in
    this.onPlace?.(piece.id);
    this.onTrayChange?.(this.trayPieces().map((p) => p.id));
  }

  // Let go over the tray (or barely moved): it goes back there.
  overTray(e) {
    const p = this.pointer(e);
    return this.camera.aspect >= 1 ? p.x > 0.38 : p.y < -0.5;
  }

  resize() {
    const w = this.container.clientWidth || 1;
    const h = this.container.clientHeight || 1;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    if (this.box) this.frameModel();
    this.camera.updateProjectionMatrix();
    this.layoutTray(false);
  }

  // Fit the model in part of the screen and leave room for the tray: right
  // side in landscape, bottom in portrait.
  frameModel() {
    const size = this.box.getSize(new THREE.Vector3());
    const center = this.box.getCenter(new THREE.Vector3());
    const landscape = this.camera.aspect >= 1;
    const hasTray = this.trayPieces().length > 0 || !this.complete;
    const [wFrac, hFrac] = hasTray ? (landscape ? [0.6, 0.88] : [0.9, 0.66]) : [0.9, 0.9];
    const tanHalf = Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2));
    const dist = Math.max(size.y / (2 * tanHalf * hFrac), size.x / (2 * tanHalf * this.camera.aspect * wFrac)) + size.z / 2;
    const visH = 2 * tanHalf * dist;
    const visW = visH * this.camera.aspect;
    const target = center.clone();
    if (hasTray) {
      if (landscape) target.x += visW * 0.18;
      else target.y -= visH * 0.15;
    }
    this.camera.position.set(target.x, target.y, target.z + dist);
    this.camera.lookAt(target);
    this.camera.near = dist / 50;
    this.camera.far = dist * 10;
    this.modelCenter = center;
    this.visH = visH;
  }

  layoutTray(animate = true) {
    if (!this.box) return;
    const tray = this.shownTray();
    for (const piece of this.trayPieces()) piece.pivot.visible = tray.includes(piece);
    const landscape = this.camera.aspect >= 1;
    const depth = this.modelCenter.clone().project(this.camera).z;
    tray.forEach((piece, i) => {
      const t = tray.length === 1 ? 0.5 : i / (tray.length - 1);
      const ndc = landscape
        ? new THREE.Vector3(0.66, 0.55 - t * 1.1, depth)
        : new THREE.Vector3(-0.6 + t * 1.2, -0.75, depth);
      const world = ndc.unproject(this.camera);
      const slot = (this.visH * (landscape ? 0.8 : 0.22)) / Math.max(1, landscape ? tray.length : 1);
      const scale = Math.min(1, slot / piece.size, (this.visH * 0.35) / piece.size);
      piece.trayLocal = this.root.worldToLocal(world.clone());
      piece.trayScale = scale;
      if (piece !== this.dragging?.piece) this.moveTo(piece, piece.trayLocal, scale, animate);
    });
  }

  moveTo(piece, local, scale, animate, done) {
    this.anims = this.anims.filter((a) => a.piece !== piece);
    if (!animate) {
      piece.pivot.position.copy(local);
      piece.pivot.scale.setScalar(scale);
      done?.();
      return;
    }
    this.anims.push({
      piece, t: 0, dur: 0.35, done,
      fromPos: piece.pivot.position.clone(), toPos: local.clone(),
      fromScale: piece.pivot.scale.x, toScale: scale
    });
  }

  sendHome(piece, animate, done) {
    piece.pivot.rotation.set(0, 0, 0);
    piece.turn = 0;
    piece.angle = 0;
    this.moveTo(piece, piece.homeLocal, 1, animate, done);
  }

  pointer(e) {
    const r = this.renderer.domElement.getBoundingClientRect();
    return new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  }

  pointerDown(e) {
    this.raycaster.setFromCamera(this.pointer(e), this.camera);
    // Nearest piece under the finger (parked pieces can sit in front of others).
    const grabbable = this.dancer ? [] : [...this.parkedPieces(), ...this.shownTray()];
    let best = null;
    for (const piece of grabbable) {
      const hit = this.raycaster.intersectObject(piece.pivot, true)[0];
      if (hit && (!best || hit.distance < best.distance)) best = { piece, distance: hit.distance };
    }
    if (best) {
      const piece = best.piece;
      this.dragging = { piece, pointerId: e.pointerId, from: piece.state, x: e.clientX, y: e.clientY };
      this.selected = piece;
      this.renderer.domElement.setPointerCapture(e.pointerId);
      this.anims = this.anims.filter((a) => a.piece !== piece);
      if (this.easyFor(piece)) this.highlight(piece, true);
      return;
    }
    // Spin the finished model with a swipe (only when nothing is waiting in the tray).
    if (this.dancer || (!this.trayPieces().length && !this.parkedPieces().length)) {
      this.spinning = { x: e.clientX, rot: this.root.rotation.y, pointerId: e.pointerId };
      this.renderer.domElement.setPointerCapture(e.pointerId);
    }
  }

  pointerMove(e) {
    if (this.spinning && e.pointerId === this.spinning.pointerId) {
      this.root.rotation.y = this.spinning.rot + (e.clientX - this.spinning.x) * 0.01;
      if (this.dancer) this.dancer.rotation.y = this.root.rotation.y;
      return;
    }
    if (!this.dragging || e.pointerId !== this.dragging.pointerId) return;
    const piece = this.dragging.piece;
    // Move the piece's center to the finger, on the plane through its home.
    const home = this.root.localToWorld(piece.homeLocal.clone());
    const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(this.camera.getWorldDirection(new THREE.Vector3()).negate(), home);
    this.raycaster.setFromCamera(this.pointer(e), this.camera);
    const hit = this.raycaster.ray.intersectPlane(plane, new THREE.Vector3());
    if (!hit) return;
    piece.pivot.position.copy(this.root.worldToLocal(hit));
    const s = piece.pivot.scale.x;
    piece.pivot.scale.setScalar(s + (1 - s) * 0.25);
  }

  pointerUp(e) {
    if (this.spinning && e.pointerId === this.spinning.pointerId) this.spinning = null;
    if (!this.dragging || e.pointerId !== this.dragging.pointerId) return;
    const { piece, from, x, y } = this.dragging;
    this.dragging = null;
    if (!piece.hinting) this.highlight(piece, false);
    if (this.easyFor(piece)) {
      if (this.nearHome(piece)) this.placePiece(piece);
      else this.moveTo(piece, piece.trayLocal, piece.trayScale, true);
      return;
    }
    // Medium/hard: it stays where it was let go, unless that's the tray
    // (a tap without moving it just picks it to turn).
    const tapped = Math.hypot(e.clientX - x, e.clientY - y) < 12;
    const toTray = tapped ? from === 'tray' : this.overTray(e);
    const state = toTray ? 'tray' : 'parked';
    if (toTray) this.moveTo(piece, piece.trayLocal ?? piece.pivot.position, piece.trayScale ?? 1, true);
    else this.moveTo(piece, piece.pivot.position.clone(), 1, true);
    if (state !== piece.state) {
      piece.state = state;
      this.layoutTray(true);
      this.onTrayChange?.(this.trayPieces().map((p) => p.id));
      this.onParkedChange?.(this.parkedPieces().length);
    }
  }

  highlight(piece, on) {
    piece.ghost.traverse((o) => {
      if (!o.isMesh) return;
      o.material.opacity = on ? 0.45 : 0.16;
      o.material.color.set(on ? 0xffe066 : GHOST_COLORS[this.kind] ?? GHOST_COLORS.build);
    });
  }

  // Little bounce when a piece clicks into place.
  pop(piece) {
    this.anims.push({ piece, t: 0, dur: 0.3, pop: true });
  }

  setComplete(complete) {
    this.complete = complete;
    this.resize();
  }

  // Swap the build for the rigged model and play one dance.
  async dance(riggedUrl, danceUrl, headers) {
    const loader = this.loader(headers);
    if (!this.dancer) {
      const gltf = await loader.loadAsync(riggedUrl);
      const model = gltf.scene;
      // Match the build's height and stand on the same floor.
      const box = new THREE.Box3().setFromObject(model);
      const size = box.getSize(new THREE.Vector3());
      const target = this.box.getSize(new THREE.Vector3());
      const s = target.y / size.y;
      model.scale.setScalar(s);
      const holder = new THREE.Group();
      holder.add(model);
      model.position.set(
        -box.getCenter(new THREE.Vector3()).x * s + this.box.getCenter(new THREE.Vector3()).x,
        -box.min.y * s + this.box.min.y,
        -box.getCenter(new THREE.Vector3()).z * s + this.box.getCenter(new THREE.Vector3()).z
      );
      holder.rotation.y = this.root.rotation.y;
      this.scene.add(holder);
      this.dancer = holder;
      this.dancerModel = model;
      this.mixer = new THREE.AnimationMixer(model);
    }
    const clip = await loadDance(loader, danceUrl, this.dancerModel);
    this.root.visible = false;
    this.ghostRoot.visible = false;
    this.mixer.stopAllAction();
    this.mixer.clipAction(clip).reset().play();
  }

  stopDance() {
    if (!this.dancer) return;
    this.mixer.stopAllAction();
    this.scene.remove(this.dancer);
    this.dancer = null;
    this.root.visible = true;
    this.ghostRoot.visible = true;
  }

  frame() {
    const dt = Math.min(this.clock.getDelta(), 0.1);
    const time = this.clock.elapsedTime;
    this.anims = this.anims.filter((a) => {
      a.t += dt;
      const k = Math.min(1, a.t / a.dur);
      const ease = 1 - Math.pow(1 - k, 3);
      if (a.pop) {
        a.piece.pivot.scale.setScalar(1 + Math.sin(k * Math.PI) * 0.08);
      } else {
        a.piece.pivot.position.lerpVectors(a.fromPos, a.toPos, ease);
        a.piece.pivot.scale.setScalar(a.fromScale + (a.toScale - a.fromScale) * ease);
      }
      if (k >= 1) a.done?.();
      return k < 1;
    });
    for (const piece of this.pieces.values()) {
      if (piece.state !== 'tray' && piece.state !== 'parked') continue;
      // Waiting pieces sway a little so they look grabbable.
      const sway = piece.state === 'tray' && piece !== this.dragging?.piece ? Math.sin(time * 1.5 + piece.wobble) * 0.35 : 0;
      // Turns ease toward the arrow presses (hard).
      piece.angle += (piece.turn * QUARTER - piece.angle) * Math.min(1, dt * 14);
      // "Not quite" head-shake after a wrong Check.
      const since = time - piece.shakeAt;
      const shake = piece.shakeAt >= 0 && since < 0.6 ? Math.sin(since * 38) * 0.22 * (1 - since / 0.6) : 0;
      piece.pivot.rotation.set(0, sway + shake, piece.angle);
    }
    if (this.ghostRoot) this.updateGhosts(time);
    this.mixer?.update(dt);
    this.renderer.render(this.scene, this.camera);
  }

  destroy() {
    this.renderer.setAnimationLoop(null);
    this.resizeObserver.disconnect();
    const el = this.renderer.domElement;
    el.removeEventListener('pointerdown', this.handlers.down);
    el.removeEventListener('pointermove', this.handlers.move);
    el.removeEventListener('pointerup', this.handlers.up);
    el.removeEventListener('pointercancel', this.handlers.up);
    this.scene.traverse((o) => {
      if (o.isMesh) {
        o.geometry?.dispose();
        for (const m of [].concat(o.material)) {
          for (const v of Object.values(m)) if (v?.isTexture) v.dispose();
          m.dispose();
        }
      }
    });
    this.scene.environment?.dispose();
    this.renderer.dispose();
    el.remove();
  }
}

// The piece's vertices around its pivot (its center): a few hundred to test
// and a few thousand to compare against.
function samplePoints(node, pivot) {
  pivot.updateMatrixWorld(true);
  const inverse = pivot.matrixWorld.clone().invert();
  const meshes = [];
  let total = 0;
  node.traverse((o) => {
    if (o.isMesh && o.geometry?.attributes.position) {
      meshes.push(o);
      total += o.geometry.attributes.position.count;
    }
  });
  const pick = (max) => {
    const stride = Math.max(1, Math.ceil(total / max));
    const out = [];
    let i = 0;
    const v = new THREE.Vector3();
    const m = new THREE.Matrix4();
    for (const mesh of meshes) {
      m.multiplyMatrices(inverse, mesh.matrixWorld);
      const pos = mesh.geometry.attributes.position;
      for (; i < pos.count; i += stride) {
        v.fromBufferAttribute(pos, i).applyMatrix4(m);
        out.push(v.x, v.y, v.z);
      }
      i -= pos.count;
    }
    return out;
  };
  return { queries: pick(200), targets: pick(2500) };
}

// Does the piece look the same after k quarter turns around the view axis?
function sameShape(queries, targets, k, size) {
  if (!queries.length) return false;
  const c = Math.round(Math.cos(k * QUARTER));
  const s = Math.round(Math.sin(k * QUARTER));
  let sum = 0;
  for (let i = 0; i < queries.length; i += 3) {
    const x = c * queries[i] - s * queries[i + 1];
    const y = s * queries[i] + c * queries[i + 1];
    const z = queries[i + 2];
    let best = Infinity;
    for (let j = 0; j < targets.length; j += 3) {
      const dx = targets[j] - x, dy = targets[j + 1] - y, dz = targets[j + 2] - z;
      const d = dx * dx + dy * dy + dz * dz;
      if (d < best) best = d;
    }
    sum += Math.sqrt(best);
  }
  return sum / (queries.length / 3) < size * 0.05;
}
