import { FilesetResolver, FaceDetector } from '@mediapipe/tasks-vision';

// Watches the camera for real brushing. Everything happens on the device:
// frames are looked at in memory and thrown away. Nothing is saved or sent.
//
// How it decides:
//  1. A small, fast face detector finds the face, the eyes and the mouth.
//  2. Two patches are cut out, both following the face: one around the
//     mouth (where the hand and brush are) and one across the eyes.
//  3. Each is compared with its previous frame. Moving the head or the
//     phone changes both patches about the same (the face-following is
//     never perfect), so the eye patch's change is subtracted from the mouth
//     patch's. Brushing changes the mouth patch while the eyes stay put.
//     If the eyes move a lot, nothing counts at all.

// Movement score needed to count as brushing, by sensitivity setting.
export const THRESHOLDS = { low: 6, normal: 3.5, high: 2 };
const EYE_WEIGHT = 1.5; // how much of the eye patch's movement to subtract
const EYES_TOO_BUSY = 2; // eye movement above this many thresholds: head/phone is moving, don't count
const FACE_LOST_MS = 1500;
const STEP_MS = 90; // ~11 checks a second at most; slow tablets get fewer
const PATCH_W = 32;
const PATCH_H = 24;

let detectorPromise = null;

function loadDetector() {
  if (!detectorPromise) {
    detectorPromise = (async () => {
      const base = new URL('mediapipe/', document.baseURI).href;
      const fileset = await FilesetResolver.forVisionTasks(base + 'wasm');
      const options = (delegate) => ({
        baseOptions: { modelAssetPath: base + 'blaze_face_short_range.tflite', delegate },
        runningMode: 'VIDEO',
        minDetectionConfidence: 0.5
      });
      try {
        return await FaceDetector.createFromOptions(fileset, options('GPU'));
      } catch {
        return await FaceDetector.createFromOptions(fileset, options('CPU'));
      }
    })();
    detectorPromise.catch(() => { detectorPromise = null; });
  }
  return detectorPromise;
}

// Starts watching `video`. onUpdate gets { faceVisible, brushing, score,
// mouth, eyes, threshold, stepMs, region, eyeRegion } after every check.
// Returns stop().
export async function startTracker(video, { sensitivity = 'normal', onUpdate }) {
  const detector = await loadDetector();
  const threshold = THRESHOLDS[sensitivity] ?? THRESHOLDS.normal;
  const canvas = document.createElement('canvas');
  canvas.width = PATCH_W;
  canvas.height = PATCH_H;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });

  let running = true;
  let raf = 0;
  let lastStep = 0;
  let lastFaceAt = -Infinity;
  // Smoothed face position in video pixels: mouth (mx, my), between the
  // eyes (ex, ey), face size (w, h).
  let box = null;
  const prev = { mouth: null, eyes: null };
  let mouth = 0;
  let eyes = 0;
  let score = 0;

  // How much a face-following patch changed since the last check.
  function patchChange(key, r) {
    ctx.drawImage(video, r.x, r.y, r.w, r.h, 0, 0, PATCH_W, PATCH_H);
    const px = ctx.getImageData(0, 0, PATCH_W, PATCH_H).data;
    const gray = new Float32Array(PATCH_W * PATCH_H);
    let mean = 0;
    for (let i = 0; i < gray.length; i++) {
      gray[i] = 0.299 * px[i * 4] + 0.587 * px[i * 4 + 1] + 0.114 * px[i * 4 + 2];
      mean += gray[i];
    }
    // Remove overall brightness so the camera's auto-exposure doesn't count.
    mean /= gray.length;
    for (let i = 0; i < gray.length; i++) gray[i] -= mean;
    let change = 0;
    const before = prev[key];
    if (before) {
      let sum = 0;
      for (let i = 0; i < gray.length; i++) {
        const d = Math.abs(gray[i] - before[i]);
        if (d > 6) sum += d; // ignore camera noise
      }
      change = sum / gray.length;
    }
    prev[key] = gray;
    return change;
  }

  function step(now) {
    if (!running) return;
    raf = requestAnimationFrame(step);
    if (now - lastStep < STEP_MS || video.readyState < 2 || !video.videoWidth) return;
    lastStep = now;
    const t0 = performance.now();
    const vw = video.videoWidth;
    const vh = video.videoHeight;

    const face = largest(detector.detectForVideo(video, now).detections);
    if (face?.boundingBox && face.keypoints?.length > 3) {
      const [rightEye, leftEye, , mouthPoint] = face.keypoints;
      const target = {
        mx: mouthPoint.x * vw,
        my: mouthPoint.y * vh,
        ex: ((rightEye.x + leftEye.x) / 2) * vw,
        ey: ((rightEye.y + leftEye.y) / 2) * vh,
        w: face.boundingBox.width,
        h: face.boundingBox.height
      };
      box = box ? lerpBox(box, target, 0.6) : target;
      lastFaceAt = now;
    }
    // A brush in the mouth can hide the face for a moment; keep the last
    // known spot for a little while before calling it "gone".
    const faceVisible = !!box && now - lastFaceAt < FACE_LOST_MS;

    let raw = 0;
    let region = null;
    let eyeRegion = null;
    if (box) {
      region = { x: box.mx - box.w * 0.65, y: box.my - box.h * 0.35, w: box.w * 1.3, h: box.h * 0.9 };
      eyeRegion = { x: box.ex - box.w * 0.5, y: box.ey - box.h * 0.18, w: box.w, h: box.h * 0.36 };
      const m = patchChange('mouth', region);
      const e = patchChange('eyes', eyeRegion);
      mouth = mouth * 0.6 + m * 0.4;
      eyes = eyes * 0.6 + e * 0.4;
      raw = e > threshold * EYES_TOO_BUSY ? 0 : Math.max(0, m - e * EYE_WEIGHT);
    }
    score = score * 0.6 + raw * 0.4;

    onUpdate({
      faceVisible,
      brushing: faceVisible && score > threshold,
      score,
      mouth,
      eyes,
      threshold,
      stepMs: performance.now() - t0,
      region,
      eyeRegion,
      videoWidth: vw,
      videoHeight: vh
    });
  }

  raf = requestAnimationFrame(step);
  return () => {
    running = false;
    cancelAnimationFrame(raf);
  };
}

function largest(detections = []) {
  let best = null;
  for (const d of detections) {
    const area = (d.boundingBox?.width || 0) * (d.boundingBox?.height || 0);
    if (!best || area > best.area) best = { d, area };
  }
  return best?.d ?? null;
}

const lerpBox = (a, b, t) => Object.fromEntries(Object.keys(b).map((k) => [k, a[k] + (b[k] - a[k]) * t]));

// Front camera, small resolution: plenty for this and easy on slow tablets.
export function openCamera() {
  return navigator.mediaDevices.getUserMedia({
    video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 30 } },
    audio: false
  });
}

// Start loading the model early (e.g. on the kid's home screen).
export function preloadTracker() {
  loadDetector().catch(() => {});
}
