import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { loadDance } from './dance.js';

// For grown-ups: the dancing model on its own, playing any of its dances,
// with the same lighting and files the kids' build screen uses. Swipe to
// turn it around.
export class DanceViewer {
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
    sun.position.set(1, 2, 3);
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

  async load(riggedUrl, headers) {
    this.gltfLoader = new GLTFLoader();
    this.gltfLoader.setMeshoptDecoder(MeshoptDecoder);
    this.gltfLoader.setRequestHeader(headers);
    const model = (await this.gltfLoader.loadAsync(riggedUrl)).scene;
    // Stand it on the floor, centered, about 1 unit tall like any model.
    const box = new THREE.Box3().setFromObject(model);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    model.position.set(-center.x, -box.min.y, -center.z);
    this.holder = new THREE.Group();
    this.holder.add(model);
    this.scene.add(this.holder);
    this.model = model;
    this.height = size.y;
    this.mixer = new THREE.AnimationMixer(model);
    this.resize();
  }

  async play(danceUrl) {
    const clip = await loadDance(this.gltfLoader, danceUrl, this.model);
    this.mixer.stopAllAction();
    this.action = this.mixer.clipAction(clip).reset().play();
    return clip.duration;
  }

  stop() {
    this.mixer?.stopAllAction();
    this.action = null;
  }

  // Seconds into the current dance and its length, for the time display.
  progress() {
    if (!this.action) return null;
    const d = this.action.getClip().duration;
    return { time: this.action.time % d, duration: d };
  }

  resize() {
    const w = this.container.clientWidth || 1;
    const h = this.container.clientHeight || 1;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    if (this.height) {
      // Leave room around the model, since dances reach out and jump.
      const tanHalf = Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2));
      const visH = this.height * 1.45;
      const dist = Math.max(visH / (2 * tanHalf), (this.height * 1.2) / (2 * tanHalf * this.camera.aspect));
      this.camera.position.set(0, this.height * 0.55, dist);
      this.camera.lookAt(0, this.height * 0.5, 0);
      this.camera.near = dist / 50;
      this.camera.far = dist * 10;
    }
    this.camera.updateProjectionMatrix();
  }

  frame() {
    this.mixer?.update(Math.min(this.clock.getDelta(), 0.1));
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
