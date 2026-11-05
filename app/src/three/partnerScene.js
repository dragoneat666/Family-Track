import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';

// An exercise partner: the character's exercise model (made in Blender, with
// its props and exercise animations), shown on its own. It can jump to any
// moment of an animation, play to a moment and stop there (pause marks), or
// loop one (the cheer). Swipe to turn it around.
export class PartnerScene {
  constructor(container) {
    this.container = container;
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
    sun.position.set(1, 3, 2);
    this.scene.add(sun);
    this.camera = new THREE.PerspectiveCamera(35, 1, 0.01, 100);

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);

    const el = renderer.domElement;
    this.handlers = {
      down: (e) => {
        this.spinning = { x: e.clientX, rot: this.holder?.rotation.y ?? 0, pointerId: e.pointerId };
        el.setPointerCapture(e.pointerId);
      },
      move: (e) => {
        if (this.spinning?.pointerId === e.pointerId && this.holder) {
          this.holder.rotation.y = this.spinning.rot + (e.clientX - this.spinning.x) * 0.01;
        }
      },
      up: () => { this.spinning = null; }
    };
    el.addEventListener('pointerdown', this.handlers.down);
    el.addEventListener('pointermove', this.handlers.move);
    el.addEventListener('pointerup', this.handlers.up);
    el.addEventListener('pointercancel', this.handlers.up);
    renderer.setAnimationLoop(() => this.frame());
  }

  async load(url, headers) {
    const loader = new GLTFLoader();
    loader.setMeshoptDecoder(MeshoptDecoder);
    loader.setRequestHeader(headers);
    const gltf = await loader.loadAsync(url);
    const model = gltf.scene;
    this.model = model;
    this.clips = new Map(gltf.animations.map((c) => [c.name, c]));
    this.mixer = new THREE.AnimationMixer(model);
    this.actions = new Map();

    // Frame everything the animations reach (sitting up is taller than lying
    // down), centered so a swipe turns it around its middle.
    const box = this.reach();
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    model.position.set(-center.x, 0, -center.z);
    this.holder = new THREE.Group();
    this.holder.position.set(center.x, 0, center.z);
    this.holder.add(model);
    this.scene.add(this.holder);
    this.box = box;
    this.size = size;
    this.center = center;
    this.resize();
  }

  names() {
    return [...this.clips.keys()];
  }

  duration(name) {
    return this.clips.get(name)?.duration ?? 0;
  }

  // The space the model takes up across the start, middle and end of every
  // animation. Skinned meshes are measured in their posed shape.
  reach() {
    const box = new THREE.Box3();
    const measure = () => {
      this.model.updateMatrixWorld(true);
      this.model.traverse((o) => { if (o.isSkinnedMesh) o.boundingBox = null; });
      box.union(new THREE.Box3().setFromObject(this.model));
    };
    if (!this.clips.size) measure();
    for (const clip of this.clips.values()) {
      const a = this.mixer.clipAction(clip);
      a.play();
      for (const f of [0, 0.5, 1]) {
        a.time = clip.duration * f;
        this.mixer.update(0);
        measure();
      }
      a.stop();
    }
    return box;
  }

  action(name) {
    const clip = this.clips.get(name);
    if (!clip) return null;
    if (!this.actions.has(name)) this.actions.set(name, this.mixer.clipAction(clip));
    return this.actions.get(name);
  }

  // Show one moment of an animation and hold it there, fading over from
  // whatever was showing.
  show(name, time = 0, fade = 0.35) {
    const a = this.action(name);
    if (!a) return;
    this.endMove();
    a.setLoop(THREE.LoopOnce, 1);
    a.clampWhenFinished = true;
    if (this.current !== a) {
      a.reset().play();
      if (this.current && fade > 0) a.crossFadeFrom(this.current, fade, false);
      else this.current?.stop();
      this.current = a;
    } else {
      a.enabled = true;
      a.setEffectiveWeight(1);
    }
    a.timeScale = 1;
    a.time = Math.max(0, Math.min(time, a.getClip().duration));
    a.paused = true;
    this.mixer.update(0);
  }

  // Play the showing animation (forwards or backwards) to a moment and stop
  // there. Resolves when it gets there, or right away if it's interrupted.
  playTo(time) {
    const a = this.current;
    if (!a) return Promise.resolve();
    this.endMove();
    const to = Math.max(0, Math.min(time, a.getClip().duration));
    if (Math.abs(to - a.time) < 1e-3) return Promise.resolve();
    a.timeScale = to > a.time ? 1 : -1;
    a.paused = false;
    return new Promise((resolve) => { this.move = { action: a, to, resolve }; });
  }

  // Play an animation over and over (the cheer).
  loop(name) {
    this.show(name, 0);
    const a = this.current;
    if (a?.getClip().name !== name) return;
    a.setLoop(THREE.LoopRepeat, Infinity);
    a.clampWhenFinished = false;
    a.paused = false;
  }

  // Play freely from where it is (the grown-up preview's play button).
  play() {
    const a = this.current;
    if (!a) return;
    this.endMove();
    if (a.time >= a.getClip().duration - 1e-3) a.time = 0;
    a.timeScale = 1;
    a.paused = false;
  }

  pause() {
    this.endMove();
    if (this.current) this.current.paused = true;
  }

  get time() {
    return this.current?.time ?? 0;
  }

  get playing() {
    return !!this.current && !this.current.paused && this.current.isRunning();
  }

  // Freezes everything (the exercise's pause button).
  set frozen(on) {
    if (this.mixer) this.mixer.timeScale = on ? 0 : 1;
  }

  endMove() {
    const m = this.move;
    this.move = null;
    m?.resolve();
  }

  resize() {
    const w = this.container.clientWidth || 1;
    const h = this.container.clientHeight || 1;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    if (this.size) {
      // From the side of the body's long way, a bit above, looking down at it.
      const along = this.size.x >= this.size.z ? 'x' : 'z';
      const dir = along === 'x' ? new THREE.Vector3(0.2, 0.9, 1) : new THREE.Vector3(1, 0.9, 0.2);
      dir.normalize();
      const radius = this.size.length() / 2;
      const tanHalf = Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2));
      const fit = Math.min(tanHalf, tanHalf * this.camera.aspect);
      const dist = (radius / fit) * 1.02;
      const target = this.center.clone();
      this.camera.position.copy(target).addScaledVector(dir, dist);
      this.camera.lookAt(target);
      this.camera.near = dist / 50;
      this.camera.far = dist * 10;
    }
    this.camera.updateProjectionMatrix();
  }

  frame() {
    const dt = Math.min(this.clock.getDelta(), 0.1);
    if (this.mixer) {
      this.mixer.update(dt);
      const m = this.move;
      if (m) {
        const a = m.action;
        const there = a.timeScale > 0 ? a.time >= m.to - 1e-4 : a.time <= m.to + 1e-4;
        if (there || this.current !== a) {
          a.time = m.to;
          a.paused = true;
          this.mixer.update(0);
          this.endMove();
        }
      }
    }
    this.renderer.render(this.scene, this.camera);
  }

  destroy() {
    this.endMove();
    this.renderer.setAnimationLoop(null);
    this.resizeObserver.disconnect();
    const el = this.renderer.domElement;
    for (const [ev, h] of [['pointerdown', 'down'], ['pointermove', 'move'], ['pointerup', 'up'], ['pointercancel', 'up']]) {
      el.removeEventListener(ev, this.handlers[h]);
    }
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
