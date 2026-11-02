import { FilesetResolver, FaceDetector } from '@mediapipe/tasks-vision';

// Watches the camera for real brushing. Everything happens on the device:
// frames are looked at in memory and thrown away. Nothing is saved or sent.
//
// How it decides:
//  1. A small, fast face detector finds the eyes. Everything is placed from
//     the eyes (a brush covers the mouth, which makes the face box jumpy),
//     and that position is smoothed.
//  2. Two patches follow the face: one around the mouth (where the hand and
//     brush are) and one across the eyes.
//  3. Each patch is compared with its previous frame, after trying small
//     shifts and keeping the best match. Moving the head or the phone mostly
//     slides the picture, which the shift cancels out; a hand and brush
//     moving across the face don't line up that way, so they still count.
//  4. What's left in the mouth patch, minus what's left in the eye patch,
//     is the brushing score. If the eyes are very busy, nothing counts.

// Score needed to count as brushing, by sensitivity setting.
export const THRESHOLDS = { low: 4, normal: 2.5, high: 1.5 };
const EYE_WEIGHT = 1; // how much of the eye patch's leftover change to subtract
const EYES_TOO_BUSY = 2; // eye change above this many thresholds: head/phone moving, don't count
const FACE_LOST_MS = 1500;
const STEP_MS = 90; // ~11 checks a second at most; slow tablets get fewer
const PATCH_W = 32;
const PATCH_H = 24;
const MAX_SHIFT = 2; // patch pixels tried in each direction when lining frames up
const NOISE = 6; // per-pixel brightness change ignored as camera noise

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

// Starts watching `video`. onUpdate gets, after every check:
//   faceVisible, brushing, score, threshold, stepMs, region, eyeRegion,
//   mouth / eyes (leftover change after lining up, smoothed),
//   and raw per-check numbers in `sample` (used by the tracking check).
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
  let geo = null; // smoothed { ex, ey, d }: between the eyes, eye distance (video px)
  const prev = { mouth: null, eyes: null };
  let mouth = 0;
  let eyes = 0;
  let score = 0;

  function grab(r) {
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
    return gray;
  }

  // Change between two patches: straight (raw) and after the best small shift (aligned).
  function change(cur, before) {
    if (!before) return { raw: 0, aligned: 0 };
    let raw = 0;
    let aligned = Infinity;
    const m = MAX_SHIFT;
    const count = (PATCH_W - 2 * m) * (PATCH_H - 2 * m);
    for (let sy = -m; sy <= m; sy++) {
      for (let sx = -m; sx <= m; sx++) {
        let sum = 0;
        for (let y = m; y < PATCH_H - m; y++) {
          const row = y * PATCH_W;
          const prow = (y + sy) * PATCH_W + sx;
          for (let x = m; x < PATCH_W - m; x++) {
            const d = Math.abs(cur[row + x] - before[prow + x]);
            if (d > NOISE) sum += d;
          }
        }
        const v = sum / count;
        if (sx === 0 && sy === 0) raw = v;
        if (v < aligned) aligned = v;
      }
    }
    return { raw, aligned };
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
    let detected = false;
    let moved = 0;
    if (face?.keypoints?.length > 1) {
      const [rightEye, leftEye] = face.keypoints;
      const target = {
        ex: ((rightEye.x + leftEye.x) / 2) * vw,
        ey: ((rightEye.y + leftEye.y) / 2) * vh,
        d: Math.hypot((leftEye.x - rightEye.x) * vw, (leftEye.y - rightEye.y) * vh)
      };
      if (target.d > 4) {
        if (geo) moved = Math.hypot(target.ex - geo.ex, target.ey - geo.ey) / geo.d;
        geo = geo ? lerp(geo, target, 0.35) : target;
        lastFaceAt = now;
        detected = true;
      }
    }
    // A brush in the mouth can hide the face for a moment; keep the last
    // known spot for a little while before calling it "gone".
    const faceVisible = !!geo && now - lastFaceAt < FACE_LOST_MS;

    let region = null;
    let eyeRegion = null;
    let m = { raw: 0, aligned: 0 };
    let e = { raw: 0, aligned: 0 };
    let raw = 0;
    if (geo) {
      const { ex, ey, d } = geo;
      // Mouth sits about 1.1 eye-distances below the eyes; the patch reaches
      // a bit lower and wider to take in the hand and brush.
      region = { x: ex - 1.4 * d, y: ey + 0.45 * d, w: 2.8 * d, h: 2.1 * d };
      eyeRegion = { x: ex - 1.2 * d, y: ey - 0.45 * d, w: 2.4 * d, h: 0.9 * d };
      const mp = grab(region);
      const ep = grab(eyeRegion);
      m = change(mp, prev.mouth);
      e = change(ep, prev.eyes);
      prev.mouth = mp;
      prev.eyes = ep;
      mouth = mouth * 0.6 + m.aligned * 0.4;
      eyes = eyes * 0.6 + e.aligned * 0.4;
      raw = e.aligned > threshold * EYES_TOO_BUSY ? 0 : Math.max(0, m.aligned - e.aligned * EYE_WEIGHT);
    }
    score = score * 0.6 + raw * 0.4;
    const brushing = faceVisible && score > threshold;

    onUpdate({
      faceVisible,
      brushing,
      score,
      mouth,
      eyes,
      threshold,
      stepMs: performance.now() - t0,
      region,
      eyeRegion,
      videoWidth: vw,
      videoHeight: vh,
      sample: {
        t: Math.round(now),
        detected,
        moved: round(moved),
        d: round(geo?.d ?? 0),
        mouthRaw: round(m.raw),
        mouthAligned: round(m.aligned),
        eyesRaw: round(e.raw),
        eyesAligned: round(e.aligned),
        score: round(score),
        brushing
      }
    });
  }

  raf = requestAnimationFrame(step);
  return () => {
    running = false;
    cancelAnimationFrame(raf);
  };
}

const round = (v) => Math.round(v * 100) / 100;

function largest(detections = []) {
  let best = null;
  for (const d of detections) {
    const area = (d.boundingBox?.width || 0) * (d.boundingBox?.height || 0);
    if (!best || area > best.area) best = { d, area };
  }
  return best?.d ?? null;
}

const lerp = (a, b, t) => Object.fromEntries(Object.keys(b).map((k) => [k, a[k] + (b[k] - a[k]) * t]));

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
