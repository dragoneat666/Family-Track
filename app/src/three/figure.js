import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';

// A simple jointed kid figure made of rounded shapes, lying on a mat, that
// moves smoothly between poses to show an exercise. Swipe to turn it.
//
// Poses are described in the figure's own space as if standing: x is the
// figure's LEFT, y is up (toward the head), z is forward (toward the ceiling
// once it lies down). Arms and legs are given as directions for the upper
// and lower part.

const DOWN = new THREE.Vector3(0, -1, 0);
const X = new THREE.Vector3(1, 0, 0);
const v = (a) => new THREE.Vector3(...a).normalize();

const COLORS = { shirt: '#4f8cff', shorts: '#2f3b66', skin: '#f2c7a5', shoe: '#ff6b9a', eye: '#1d2440', mat: '#bfeed6' };

export class FigureScene {
  constructor(container) {
    this.container = container;
    const renderer = new THREE.WebGLRenderer({ antialias: window.devicePixelRatio < 2, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.domElement.style.touchAction = 'none';
    container.appendChild(renderer.domElement);
    this.renderer = renderer;

    const scene = new THREE.Scene();
    const pmrem = new THREE.PMREMGenerator(renderer);
    scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    pmrem.dispose();
    scene.add(new THREE.HemisphereLight(0xffffff, 0x667788, 1.1));
    const sun = new THREE.DirectionalLight(0xffffff, 1.5);
    sun.position.set(0.6, 3, 1);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    Object.assign(sun.shadow.camera, { left: -1.2, right: 1.2, top: 1.2, bottom: -1.2, near: 0.5, far: 6 });
    sun.shadow.bias = -0.002;
    scene.add(sun);
    this.scene = scene;

    this.holder = new THREE.Group();
    scene.add(this.holder);
    const mat = new THREE.Mesh(
      new THREE.BoxGeometry(1.25, 0.02, 2.0),
      new THREE.MeshStandardMaterial({ color: COLORS.mat, roughness: 0.9 })
    );
    mat.position.set(0, -0.01, -0.02);
    mat.receiveShadow = true;
    this.holder.add(mat);
    this.buildFigure();

    this.camera = new THREE.PerspectiveCamera(35, 1, 0.05, 50);
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
    this.resize();

    const el = renderer.domElement;
    this.handlers = {
      down: (e) => {
        this.spinning = { x: e.clientX, rot: this.holder.rotation.y, pointerId: e.pointerId };
        el.setPointerCapture(e.pointerId);
      },
      move: (e) => {
        if (this.spinning?.pointerId === e.pointerId) this.holder.rotation.y = this.spinning.rot + (e.clientX - this.spinning.x) * 0.01;
      },
      up: () => { this.spinning = null; }
    };
    el.addEventListener('pointerdown', this.handlers.down);
    el.addEventListener('pointermove', this.handlers.move);
    el.addEventListener('pointerup', this.handlers.up);
    el.addEventListener('pointercancel', this.handlers.up);

    this.moves = [];
    this.highlighted = [];
    this.setPose(resolvePose(STARFISH), 0);
    renderer.setAnimationLoop((now) => this.frame(now));
  }

  buildFigure() {
    const mats = {};
    const material = (color) => new THREE.MeshStandardMaterial({ color, roughness: 0.55 });
    const parts = {};
    const mesh = (geo, color, parent, pos, group) => {
      const m = new THREE.Mesh(geo, material(color));
      m.position.set(...pos);
      m.castShadow = true;
      parent.add(m);
      if (group) (parts[group] ??= []).push(m);
      return m;
    };
    const joint = (parent, pos) => {
      const g = new THREE.Group();
      g.position.set(...pos);
      parent.add(g);
      return g;
    };
    const capsule = (r, len) => new THREE.CapsuleGeometry(r, len, 6, 14);

    // Lying on its back: standing-space y (head) points away from the camera,
    // standing-space z (front) points up.
    const root = new THREE.Group();
    root.rotation.x = -Math.PI / 2;
    root.position.y = 0.1;
    this.holder.add(root);

    const pelvis = mesh(capsule(0.1, 0.1), COLORS.shorts, root, [0, 0, 0]);
    pelvis.rotation.z = Math.PI / 2;
    pelvis.scale.set(1, 1, 0.85);

    const spine = joint(root, [0, 0.05, 0]);
    const torso = mesh(capsule(0.12, 0.2), COLORS.shirt, spine, [0, 0.19, 0], 'body');
    torso.scale.set(1.05, 1, 0.75);
    const neck = joint(spine, [0, 0.41, 0.0]);
    mesh(new THREE.CylinderGeometry(0.045, 0.05, 0.08, 12), COLORS.skin, neck, [0, 0.03, 0.01], 'head');
    const head = mesh(new THREE.SphereGeometry(0.12, 24, 16), COLORS.skin, neck, [0, 0.15, 0.02], 'head');
    head.scale.set(0.95, 1.05, 1);
    for (const x of [-0.042, 0.042]) mesh(new THREE.SphereGeometry(0.018, 10, 8), COLORS.eye, neck, [x, 0.17, 0.13]);
    mesh(new THREE.SphereGeometry(0.014, 8, 6), COLORS.skin, neck, [0, 0.14, 0.14]);

    const joints = { spine, neck };
    for (const [side, s] of [['L', 1], ['R', -1]]) {
      const shoulder = joint(spine, [0.165 * s, 0.35, -0.03]);
      mesh(capsule(0.045, 0.17), COLORS.shirt, shoulder, [0, -0.12, 0], `arm${side}`);
      const elbow = joint(shoulder, [0, -0.25, 0]);
      mesh(capsule(0.04, 0.16), COLORS.skin, elbow, [0, -0.11, 0], `arm${side}`);
      mesh(new THREE.SphereGeometry(0.052, 14, 10), COLORS.skin, elbow, [0, -0.25, 0], `arm${side}`);

      const hip = joint(root, [0.085 * s, -0.04, -0.02]);
      mesh(capsule(0.062, 0.24), COLORS.shorts, hip, [0, -0.16, 0], `leg${side}`);
      const knee = joint(hip, [0, -0.33, 0]);
      mesh(capsule(0.05, 0.24), COLORS.skin, knee, [0, -0.16, 0], `leg${side}`);
      mesh(new THREE.BoxGeometry(0.09, 0.06, 0.16), COLORS.shoe, knee, [0, -0.32, 0.04], `leg${side}`);
      Object.assign(joints, { [`shoulder${side}`]: shoulder, [`elbow${side}`]: elbow, [`hip${side}`]: hip, [`knee${side}`]: knee });
    }
    this.joints = joints;
    this.parts = parts;
  }

  // Move to a pose over `seconds` (0 = jump there).
  setPose(pose, seconds = 1.2) {
    const start = performance.now();
    this.moves = Object.entries(pose).map(([name, to]) => ({
      joint: this.joints[name],
      from: this.joints[name].quaternion.clone(),
      to
    }));
    this.moveStart = start;
    this.moveLength = seconds * 1000;
    if (!seconds) this.applyMove(1);
  }

  applyMove(k) {
    const e = k < 0.5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2; // ease in and out
    for (const m of this.moves) m.joint.quaternion.slerpQuaternions(m.from, m.to, e);
  }

  // Glow the parts being moved right now ('armL', 'legR', 'head', 'body').
  highlight(groups = []) {
    for (const m of this.highlighted) m.material.emissive.setRGB(0, 0, 0);
    this.highlighted = groups.flatMap((g) => this.parts[g] || []);
  }

  resize() {
    const w = this.container.clientWidth || 1;
    const h = this.container.clientHeight || 1;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    // Seen from beside the feet, up high, so arms, legs and sitting up all show.
    const tanHalf = Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2));
    const need = 1.75;
    const dist = Math.max(need / (2 * tanHalf), need / (2 * tanHalf * this.camera.aspect));
    const dir = new THREE.Vector3(0.85, 1.15, 1.0).normalize();
    this.camera.position.copy(dir.multiplyScalar(dist)).add(new THREE.Vector3(0, 0.12, -0.05));
    this.camera.lookAt(0, 0.12, -0.05);
    this.camera.updateProjectionMatrix();
  }

  frame(now) {
    if (this.moves.length) this.applyMove(Math.min(1, (performance.now() - this.moveStart) / (this.moveLength || 1)));
    const glow = 0.35 + 0.3 * Math.sin(now / 180);
    for (const m of this.highlighted) m.material.emissive.setRGB(glow, glow * 0.75, 0);
    this.renderer.render(this.scene, this.camera);
  }

  destroy() {
    this.renderer.setAnimationLoop(null);
    this.resizeObserver.disconnect();
    const el = this.renderer.domElement;
    for (const [ev, h] of [['pointerdown', 'down'], ['pointermove', 'move'], ['pointerup', 'up'], ['pointercancel', 'up']]) {
      el.removeEventListener(ev, this.handlers[h]);
    }
    this.scene.traverse((o) => {
      if (o.isMesh) {
        o.geometry.dispose();
        o.material.dispose();
      }
    });
    this.scene.environment?.dispose();
    this.renderer.dispose();
    el.remove();
  }
}

// ---------- poses ----------

// Arm and leg positions for the figure's LEFT side; the right side is the
// mirror image. [upper part direction, lower part direction].
export const ARMS = {
  star: [[0.5, 0.86, 0], [0.5, 0.86, 0]], // above the head, spread out
  side: [[0.2, -1, 0], [0.15, -1, 0.1]],
  under: [[-0.3, -0.75, 0.5], [-1, 0.25, 0.05]], // on the chest, first (underneath)
  over: [[-0.25, -0.65, 0.8], [-1, 0.25, 0.3]] // on the chest, on top of the other arm
};
export const LEGS = {
  star: [[0.2, -1, 0], [0.2, -1, 0]], // down and spread a little
  straight: [[0.02, -1, 0], [0.02, -1, 0]],
  over: [[-0.13, -1, 0.3], [-0.35, -1, 0.1]] // crossed over the other leg
};
const mirror = ([x, y, z]) => [-x, y, z];

// A pose: { spine, neck (radians forward), armL, armR, legL, legR (names above) }
export const STARFISH = { spine: 0, neck: 0, armL: 'star', armR: 'star', legL: 'star', legR: 'star' };

export function resolvePose(p) {
  const out = {
    spine: new THREE.Quaternion().setFromAxisAngle(X, p.spine || 0),
    neck: new THREE.Quaternion().setFromAxisAngle(X, p.neck || 0)
  };
  for (const [side, flip] of [['L', false], ['R', true]]) {
    const limb = (table, name) => {
      const [a, b] = table[name].map((d) => v(flip ? mirror(d) : d));
      const upper = new THREE.Quaternion().setFromUnitVectors(DOWN, a);
      const lower = new THREE.Quaternion().setFromUnitVectors(DOWN, b.applyQuaternion(upper.clone().invert()));
      return [upper, lower];
    };
    [out[`shoulder${side}`], out[`elbow${side}`]] = limb(ARMS, p[`arm${side}`]);
    [out[`hip${side}`], out[`knee${side}`]] = limb(LEGS, p[`leg${side}`]);
  }
  return out;
}
