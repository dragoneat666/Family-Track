import { FilesetResolver, FaceDetector } from '@mediapipe/tasks-vision';
import { thresholdFor } from './tuning.js';

// Watches the camera for real brushing. Everything happens on the device:
// frames are looked at in memory and thrown away. Nothing is saved or sent.
//
// How it decides:
//  1. A small, fast face detector finds the eyes. Everything is placed from
//     the eyes (a brush covers the mouth, which makes the face box jumpy),
//     and that position is smoothed.
//  2. A patch around the mouth (where the hand and brush are) follows the face.
//  3. It's compared with its previous frame, after trying small shifts and
//     keeping the best match. Moving the head or the phone mostly slides the
//     picture, which the shift cancels out; a hand and brush moving across
//     the face don't line up that way, so they still count.
//  4. While the face itself is moving a lot (head or phone moving), nothing
//     counts.
//
// Tuned from a real tracking check (Nov 2026): leftover mouth change was
// ~1 holding still, ~4 moving the head, ~3 moving the phone and ~16
// brushing; the face moved ~0.2-0.3 eye-widths per check when moving the
// head or phone and ~0.1 while brushing.
//
// Kids sitting further from a tablet (Nov 2026) scored only ~4-6 brushing,
// with ~1-2 for moving the head, so each kid can have their own setting from
// a tracking check (see tuning.js).

// Score needed to count as brushing, by sensitivity setting.
export const THRESHOLDS = { low: 11, normal: 8, high: 6 };
const MOVING_FACE = 0.3; // face moving more than this many eye-widths per check: don't count
const FACE_LOST_MS = 1500;
const STEP_MS = 90; // ~11 checks a second at most; slow tablets get fewer
const PATCH_W = 32;
const PATCH_H = 24;
const MAX_SHIFT = 2; // patch pixels tried in each direction when lining frames up
const NOISE = 6; // per-pixel brightness change ignored as camera noise
const LOW_NOISE = 3; // also measured (not used yet) to see if it helps faces far away

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
//   faceVisible, brushing, score, threshold, stepMs, region,
//   mouth (leftover change after lining up, smoothed), moving (how fast the
//   face moves, smoothed), and raw per-check numbers in `sample` (used by
//   the tracking check).
// tuning: the kid's own settings (tuning.js); used instead of `sensitivity`.
// Returns stop().
export async function startTracker(video, { sensitivity = 'normal', tuning = null, onUpdate }) {
  const detector = await loadDetector();
  const base = THRESHOLDS[sensitivity] ?? THRESHOLDS.normal;
  let threshold = thresholdFor(tuning, 0) ?? base;
  const canvas = document.createElement('canvas');
  canvas.width = PATCH_W;
  canvas.height = PATCH_H;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });

  let running = true;
  let raf = 0;
  let lastStep = 0;
  let lastFaceAt = -Infinity;
  let geo = null; // smoothed { ex, ey, d }: between the eyes, eye distance (video px)
  let prevPatch = null;
  let mouth = 0;
  let moving = 0;
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
    let spread = 0;
    for (let i = 0; i < gray.length; i++) {
      gray[i] -= mean;
      spread += gray[i] * gray[i];
    }
    gray.contrast = Math.sqrt(spread / gray.length);
    return gray;
  }

  // Change between two patches: straight (raw) and after the best small shift
  // (aligned); `low` is aligned with a smaller noise cut, only logged for now.
  function change(cur, before) {
    if (!before) return { raw: 0, aligned: 0, low: 0 };
    let raw = 0;
    let aligned = Infinity;
    let low = Infinity;
    const m = MAX_SHIFT;
    const count = (PATCH_W - 2 * m) * (PATCH_H - 2 * m);
    for (let sy = -m; sy <= m; sy++) {
      for (let sx = -m; sx <= m; sx++) {
        let sum = 0;
        let sumLow = 0;
        for (let y = m; y < PATCH_H - m; y++) {
          const row = y * PATCH_W;
          const prow = (y + sy) * PATCH_W + sx;
          for (let x = m; x < PATCH_W - m; x++) {
            const d = Math.abs(cur[row + x] - before[prow + x]);
            if (d > LOW_NOISE) {
              sumLow += d;
              if (d > NOISE) sum += d;
            }
          }
        }
        const v = sum / count;
        if (sx === 0 && sy === 0) raw = v;
        if (v < aligned) aligned = v;
        if (sumLow / count < low) low = sumLow / count;
      }
    }
    return { raw, aligned, low };
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
    let m = { raw: 0, aligned: 0, low: 0 };
    let raw = 0;
    let contrast = 0;
    moving = moving * 0.6 + moved * 0.4;
    if (geo) {
      const { ex, ey, d } = geo;
      threshold = thresholdFor(tuning, d) ?? base;
      // Mouth sits about 1.1 eye-distances below the eyes; the patch reaches
      // a bit lower and wider to take in the hand and brush.
      region = { x: ex - 1.4 * d, y: ey + 0.45 * d, w: 2.8 * d, h: 2.1 * d };
      const patch = grab(region);
      m = change(patch, prevPatch);
      prevPatch = patch;
      contrast = patch.contrast;
      mouth = mouth * 0.6 + m.aligned * 0.4;
      raw = moving > MOVING_FACE ? 0 : m.aligned;
    }
    score = score * 0.6 + raw * 0.4;
    const brushing = faceVisible && score > threshold;

    onUpdate({
      faceVisible,
      brushing,
      score,
      mouth,
      moving,
      threshold,
      stepMs: performance.now() - t0,
      region,
      videoWidth: vw,
      videoHeight: vh,
      sample: {
        t: Math.round(now),
        detected,
        moved: round(moved),
        moving: round(moving),
        d: round(geo?.d ?? 0),
        mouthRaw: round(m.raw),
        mouthAligned: round(m.aligned),
        mouthLow: round(m.low),
        contrast: round(contrast),
        score: round(score),
        threshold,
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
