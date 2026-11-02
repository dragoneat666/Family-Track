// Puts the face-detection files into public/mediapipe so they ship inside the
// app. Nothing is loaded from the internet when the app runs.
import fs from 'node:fs';
import path from 'node:path';

const out = path.resolve('public/mediapipe');
const wasmOut = path.join(out, 'wasm');
fs.mkdirSync(wasmOut, { recursive: true });

const wasmSrc = path.resolve('node_modules/@mediapipe/tasks-vision/wasm');
for (const f of fs.readdirSync(wasmSrc)) {
  if (f.startsWith('vision_wasm_internal') || f.startsWith('vision_wasm_nosimd_internal')) {
    fs.copyFileSync(path.join(wasmSrc, f), path.join(wasmOut, f));
  }
}

const MODEL = 'blaze_face_short_range.tflite';
const modelPath = path.join(out, MODEL);
if (!fs.existsSync(modelPath)) {
  const url = `https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/1/${MODEL}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Could not download ${MODEL}: HTTP ${res.status}`);
  fs.writeFileSync(modelPath, Buffer.from(await res.arrayBuffer()));
  console.log(`downloaded ${MODEL}`);
}
