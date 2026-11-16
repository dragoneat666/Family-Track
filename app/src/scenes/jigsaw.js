// Cutting a background picture into jigsaw pieces: a rows × cols grid whose
// inside edges get a tab (out one side or the other, nudged a little), worked
// out from a seed (the background's id), so a background's pieces are the
// same shapes every time, on every tablet.

export const ROWS = 3;
export const COLS = 3;

// Small seeded random numbers (mulberry32).
function random(seed) {
  let a = (seed * 2654435761) >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// One tab, along an edge 0 → 100, bulging toward -y (6 curves: control,
// control, end).
const TAB = [
  [0, 0], [35, 15], [37, 5],
  [37, 5], [40, 0], [38, -5],
  [38, -5], [20, -20], [50, -20],
  [50, -20], [80, -20], [62, -5],
  [62, -5], [60, 0], [63, 5],
  [63, 5], [65, 15], [100, 0]
];

// An inside edge as curves in picture pixels, from a to b. m: the tab's size
// (the smaller side of a piece); dir: which side it bulges to; shift: how far
// off the middle.
function edgeCurves(a, b, m, dir, shift) {
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const ux = (b[0] - a[0]) / len;
  const uy = (b[1] - a[1]) / len;
  // Bulging "up" in the template = toward -y; turned to the edge's normal.
  const nx = -uy;
  const ny = ux;
  const mid = len / 2 + shift * m;
  const at = ([x, y]) => {
    const along = x === 0 ? 0 : x === 100 ? len : mid + ((x - 50) / 100) * m;
    const out = (-y / 100) * m * dir;
    return [a[0] + ux * along + nx * out, a[1] + uy * along + ny * out];
  };
  const curves = [];
  for (let i = 0; i < TAB.length; i += 3) curves.push([at(TAB[i]), at(TAB[i + 1]), at(TAB[i + 2])]);
  return curves;
}

// The same edge walked the other way.
function reverse(start, curves) {
  const out = [];
  const points = [start, ...curves.map((c) => c[2])];
  for (let i = curves.length - 1; i >= 0; i--) out.push([curves[i][1], curves[i][0], points[i]]);
  return out;
}

const f = (n) => Math.round(n * 10) / 10;

// Every piece of a w × h picture: { row, col, path (SVG, picture pixels),
// box: { x, y, w, h } (the cell), pad (how far tabs can reach past it) }.
export function cutPicture(w, h, seed, rows = ROWS, cols = COLS) {
  const rnd = random(seed || 1);
  const cw = w / cols;
  const ch = h / rows;
  const m = Math.min(cw, ch);
  const corner = (r, c) => [c * cw, r * ch];
  // Horizontal inside edges (between row r-1 and r), left to right; vertical
  // ones (between col c-1 and c), top to bottom.
  const hEdge = {};
  const vEdge = {};
  for (let r = 1; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      hEdge[`${r},${c}`] = edgeCurves(corner(r, c), corner(r, c + 1), m, rnd() < 0.5 ? 1 : -1, (rnd() - 0.5) * 0.16);
    }
  }
  for (let c = 1; c < cols; c++) {
    for (let r = 0; r < rows; r++) {
      vEdge[`${r},${c}`] = edgeCurves(corner(r, c), corner(r + 1, c), m, rnd() < 0.5 ? 1 : -1, (rnd() - 0.5) * 0.16);
    }
  }
  const pieces = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const tl = corner(r, c);
      const tr = corner(r, c + 1);
      const br = corner(r + 1, c + 1);
      const bl = corner(r + 1, c);
      const parts = [`M${f(tl[0])} ${f(tl[1])}`];
      const curves = (list) => list.forEach(([p1, p2, e]) => parts.push(`C${f(p1[0])} ${f(p1[1])} ${f(p2[0])} ${f(p2[1])} ${f(e[0])} ${f(e[1])}`));
      const line = (p) => parts.push(`L${f(p[0])} ${f(p[1])}`);
      if (r > 0) curves(hEdge[`${r},${c}`]); else line(tr);
      if (c < cols - 1) curves(vEdge[`${r},${c + 1}`]); else line(br);
      if (r < rows - 1) curves(reverse(bl, hEdge[`${r + 1},${c}`])); else line(bl);
      if (c > 0) curves(reverse(tl, vEdge[`${r},${c}`])); else line(tl);
      parts.push('Z');
      pieces.push({ row: r, col: c, path: parts.join(' '), box: { x: tl[0], y: tl[1], w: cw, h: ch }, pad: m * 0.25 });
    }
  }
  return pieces;
}

// "r,c" (a piece's node name on the server) → { row, col }.
export function cellOf(nodeName) {
  const [row, col] = String(nodeName).split(',').map(Number);
  return { row: row || 0, col: col || 0 };
}
