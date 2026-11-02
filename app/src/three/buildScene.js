import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';

// The build board. Every piece in build.glb already sits at its "home" (the
// files were exported from the whole character), so:
//  - placed pieces are drawn where they are,
//  - pieces not placed yet show as a faint ghost so the kid sees the shape,
//  - unlocked-but-unplaced pieces float in a tray and get dragged home.

const GHOST_COLORS = { build: 0x8fc8ff, dress: 0xf6c4ff };
const SNAP_FRACTION = 0.09; // how close (share of the screen) counts as "there"
const TRAY_SLOTS = 4; // more waiting pieces than this queue up behind

export class BuildScene {
  constructor(container, { onPlace, onTrayChange } = {}) {
    this.container = container;
    this.onPlace = onPlace;
    this.onTrayChange = onTrayChange;
    this.pieces = new Map(); // id -> { id, pivot, ghost, homeLocal, state }
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
      this.pieces.set(p.id, {
        id: p.id, name: p.name, pivot, ghost, size: Math.max(size.x, size.y, 1e-6),
        homeLocal: pivot.position.clone(), state: null, wobble: Math.random() * 6
      });
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
      if (piece.state === state) continue;
      if (piece.state === 'tray' || state === 'tray') trayChanged = true;
      piece.state = state;
      piece.pivot.visible = state !== 'locked';
      piece.ghost.visible = state !== 'placed';
      if (state === 'placed') this.sendHome(piece, false);
    }
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
    this.moveTo(piece, piece.homeLocal, 1, animate, done);
  }

  pointer(e) {
    const r = this.renderer.domElement.getBoundingClientRect();
    return new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  }

  pointerDown(e) {
    this.raycaster.setFromCamera(this.pointer(e), this.camera);
    for (const piece of this.dancer ? [] : this.shownTray()) {
      if (this.raycaster.intersectObject(piece.pivot, true).length) {
        this.dragging = { piece, pointerId: e.pointerId };
        this.renderer.domElement.setPointerCapture(e.pointerId);
        this.anims = this.anims.filter((a) => a.piece !== piece);
        piece.pivot.rotation.set(0, 0, 0);
        this.highlight(piece, true);
        return;
      }
    }
    // Spin the finished model with a swipe (only when nothing is waiting in the tray).
    if (this.dancer || !this.trayPieces().length) {
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
    const piece = this.dragging.piece;
    this.dragging = null;
    this.highlight(piece, false);
    const at = this.root.localToWorld(piece.pivot.position.clone()).project(this.camera);
    const home = this.root.localToWorld(piece.homeLocal.clone()).project(this.camera);
    const w = this.container.clientWidth, h = this.container.clientHeight;
    const dx = ((at.x - home.x) / 2) * w;
    const dy = ((at.y - home.y) / 2) * h;
    if (Math.hypot(dx, dy) < Math.min(w, h) * SNAP_FRACTION + 20) {
      piece.state = 'placed';
      piece.ghost.visible = false;
      this.sendHome(piece, true, () => this.pop(piece));
      this.layoutTray(true); // the next waiting piece slides in
      this.onPlace?.(piece.id);
      this.onTrayChange?.(this.trayPieces().map((p) => p.id));
    } else {
      this.moveTo(piece, piece.trayLocal, piece.trayScale, true);
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
      this.mixer = new THREE.AnimationMixer(model);
    }
    const clip = (await loader.loadAsync(danceUrl)).animations[0];
    if (!clip) throw new Error('That dance has no motion in it');
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
    // Waiting pieces wiggle a little so they look grabbable.
    for (const piece of this.shownTray()) {
      if (piece !== this.dragging?.piece) piece.pivot.rotation.y = Math.sin(time * 1.5 + piece.wobble) * 0.35;
    }
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
