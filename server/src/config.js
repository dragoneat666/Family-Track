import path from 'node:path';

export const DATA_DIR = process.env.DATA_DIR || path.resolve('data');
export const PORT = Number(process.env.PORT || 8080);
export const ASSETS_DIR = path.join(DATA_DIR, 'characters');
export const TMP_DIR = path.join(DATA_DIR, 'tmp');

// Triangle budgets for what the tablets download. The kids' tablets are slow,
// so these stay modest; raise them if the tablets get upgraded.
export const BUILD_MAX_TRIANGLES = Number(process.env.BUILD_MAX_TRIANGLES || 80000);
export const RIGGED_MAX_TRIANGLES = Number(process.env.RIGGED_MAX_TRIANGLES || 50000);
export const TEXTURE_SIZE = Number(process.env.TEXTURE_SIZE || 2048);

// Today's date in the server's time zone (TZ env), as YYYY-MM-DD.
export function today() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
