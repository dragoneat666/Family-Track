import { FilesetResolver, FaceDetector } from '@mediapipe/tasks-vision';

// Watches the camera for real brushing. Everything happens on the device:
// frames are looked at in memory and thrown away. Nothing is saved or sent.
//
// How it decides:
//  1. A small, fast face detector finds the face and the mouth.
//  2. A patch around the mouth (where the hand and brush are) is cut out,
//     following the face, so moving the head around doesn't count.
//  3. That patch is compared with the previous one. Brushing makes it change
//     a lot; sitting still, talking or bouncing in place mostly doesn't.

// Movement score needed to count as brushing, by sensitivity setting.
export const THRESHOLDS = { low: 6, normal: 3.5, high: 2 };
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
// threshold, stepMs, region } after every check. Returns stop().
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
  let box = null; // smoothed { cx, cy, w, h } of the mouth area, in video pixels
  let prev = null;
  let score = 0;

  function step(now) {
    if (!running) return;
    raf = requestAnimationFrame(step);
    if (now - lastStep < STEP_MS || video.readyState < 2 || !video.videoWidth) return;
    lastStep = now;
    const t0 = performance.now();

    const face = largest(detector.detectForVideo(video, now).detections);
    if (face?.boundingBox && face.keypoints?.length > 3) {
      const mouth = face.keypoints[3];
      const target = {
        cx: mouth.x * video.videoWidth,
        cy: mouth.y * video.videoHeight,
        w: face.boundingBox.width,
        h: face.boundingBox.height
      };
      box = box ? lerpBox(box, target, 0.4) : target;
      lastFaceAt = now;
    }
    // A brush in the mouth can hide the face for a moment; keep the last
    // known spot for a little while before calling it "gone".
    const faceVisible = !!box && now - lastFaceAt < FACE_LOST_MS;

    let raw = 0;
    let region = null;
    if (box) {
      region = { x: box.cx - box.w * 0.65, y: box.cy - box.h * 0.35, w: box.w * 1.3, h: box.h * 0.9 };
      ctx.drawImage(video, region.x, region.y, region.w, region.h, 0, 0, PATCH_W, PATCH_H);
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
      if (prev) {
        let sum = 0;
        for (let i = 0; i < gray.length; i++) {
          const d = Math.abs(gray[i] - prev[i]);
          if (d > 6) sum += d; // ignore camera noise
        }
        raw = sum / gray.length;
      }
      prev = gray;
    }
    score = score * 0.6 + raw * 0.4;

    onUpdate({
      faceVisible,
      brushing: faceVisible && score > threshold,
      score,
      threshold,
      stepMs: performance.now() - t0,
      region,
      videoWidth: video.videoWidth,
      videoHeight: video.videoHeight
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

const lerpBox = (a, b, t) => ({
  cx: a.cx + (b.cx - a.cx) * t,
  cy: a.cy + (b.cy - a.cy) * t,
  w: a.w + (b.w - a.w) * t,
  h: a.h + (b.h - a.h) * t
});

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
