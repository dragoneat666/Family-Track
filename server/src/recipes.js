import express from 'express';
import multer from 'multer';
import sharp from 'sharp';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { db } from './db.js';
import { DATA_DIR, TMP_DIR } from './config.js';
import { httpError, requireAdult } from './auth.js';
import { parseIngredients, isHeading, headingText, minutes } from './ingredients.js';
import { safeFetch } from './safeFetch.js';

// The family's recipes. Grown-ups add them by hand, from a recipe web page
// (its schema.org Recipe data, which nearly every recipe site has). Each
// can have a photo of the dish.
//
// Ingredients are kept both as written and read into amount / unit / thing,
// so the app can scale them and the grocery list gets just the thing.

const PHOTO_DIR = path.join(DATA_DIR, 'recipes');
fs.mkdirSync(PHOTO_DIR, { recursive: true });
const PHOTO_NAME = /^\d+-[0-9a-f]{12}(-s)?\.jpg$/;

const MAX_INGREDIENTS = 150;
const MAX_STEPS = 100;
const MAX_TAGS = 12;

const text = (v, max) => decode(String(v ?? '')).replace(/\s+/g, ' ').trim().slice(0, max);
const lines = (v, max) => decode(String(v ?? '')).split('\n').map((l) => l.replace(/[ \t]+/g, ' ').trim())
  .join('\n').replace(/\n{3,}/g, '\n\n').trim().slice(0, max);
const listOf = (v) => (Array.isArray(v) ? v : String(v ?? '').split('\n'));
const whole = (v, min, max) => {
  if (v == null || v === '') return null;
  const n = Math.round(Number(v));
  return Number.isFinite(n) && n >= min && n <= max ? n : null;
};

// What a recipe web page or another app writes: HTML entities and tags out.
function decode(s) {
  if (!/[&<]/.test(s)) return s;
  const named = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', frac12: '½', frac14: '¼', frac34: '¾', deg: '°', ndash: '–', mdash: '—', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“', hellip: '…', eacute: 'é', egrave: 'è', ntilde: 'ñ', times: '×' };
  return s
    .replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|li|div|h\d)>/gi, '\n').replace(/<[^>]+>/g, '')
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => safeChar(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => safeChar(Number(d)))
    .replace(/&([a-z]+\d*);/gi, (m, n) => named[n.toLowerCase()] ?? m);
}
const safeChar = (n) => (n > 0 && n < 0x110000 ? String.fromCodePoint(n) : '');

// ---------- saving ----------

function clean(b) {
  const title = text(b.title, 120);
  if (!title) throw httpError(400, 'Give it a name');
  const ingredients = parseIngredients(listOf(b.ingredients).slice(0, MAX_INGREDIENTS * 2)).slice(0, MAX_INGREDIENTS);
  const steps = [];
  for (const raw of listOf(b.steps)) {
    const line = lines(raw, 2000);
    if (!line) continue;
    steps.push(isHeading(line) && !line.includes('\n') ? { section: headingText(line).slice(0, 80) } : { text: line });
    if (steps.length >= MAX_STEPS) break;
  }
  const tags = [...new Set((Array.isArray(b.tags) ? b.tags : String(b.tags ?? '').split(','))
    .map((t) => text(t, 30)).filter(Boolean).map((t) => t[0].toUpperCase() + t.slice(1)))].slice(0, MAX_TAGS);
  let sourceUrl = text(b.sourceUrl, 500);
  if (sourceUrl && !/^https?:\/\//i.test(sourceUrl)) sourceUrl = '';
  return {
    title, description: lines(b.description, 1000), servings: whole(b.servings, 1, 100), yield: text(b.yield, 60),
    prepMin: whole(b.prepMin, 0, 10000), cookMin: whole(b.cookMin, 0, 10000), totalMin: whole(b.totalMin, 0, 10000),
    ingredients, steps, notes: lines(b.notes, 4000), tags, sourceUrl
  };
}

const photoUrl = (file) => file && `/api/recipes/photo/${file}`;
const toRecipe = (r) => ({
  id: r.id, title: r.title, description: r.description, servings: r.servings, yield: r.yield,
  prepMin: r.prep_min, cookMin: r.cook_min, totalMin: r.total_min,
  ingredients: JSON.parse(r.ingredients), steps: JSON.parse(r.steps), notes: r.notes, tags: JSON.parse(r.tags),
  sourceUrl: r.source_url, photo: photoUrl(r.photo), thumb: photoUrl(r.photo?.replace('.jpg', '-s.jpg')),
  importedFrom: r.imported_from?.split(':')[0] || null, createdBy: r.created_by, changedAt: r.changed_at
});
const row = (id) => db.prepare('SELECT * FROM recipes WHERE id = ?').get(Number(id));

function everything() {
  return { recipes: db.prepare('SELECT * FROM recipes ORDER BY title COLLATE NOCASE, id').all().map(toRecipe) };
}

function insert(r, accountId, importedFrom = null) {
  const now = Date.now();
  const { lastInsertRowid } = db.prepare(`INSERT INTO recipes (title, description, servings, yield, prep_min, cook_min, total_min,
    ingredients, steps, notes, tags, source_url, imported_from, created_by, created_at, changed_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(r.title, r.description, r.servings, r.yield, r.prepMin, r.cookMin, r.totalMin, JSON.stringify(r.ingredients),
      JSON.stringify(r.steps), r.notes, JSON.stringify(r.tags), r.sourceUrl, importedFrom, accountId, now, now);
  return Number(lastInsertRowid);
}

// ---------- photos ----------

function dropPhoto(file) {
  if (!file) return;
  for (const f of [file, file.replace('.jpg', '-s.jpg')]) fs.rmSync(path.join(PHOTO_DIR, f), { force: true });
}

// Any picture (a phone photo, a web page's .webp) → a JPEG up to 1600 px and
// a small one for the list. Turned the right way up; the camera's details
// (where and when it was taken) aren't kept.
async function setPhoto(id, input) {
  const file = `${id}-${crypto.randomBytes(6).toString('hex')}.jpg`;
  try {
    const img = sharp(input, { failOn: 'error', limitInputPixels: 80e6 }).rotate();
    await img.clone().resize(1600, 1600, { fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 82, mozjpeg: true })
      .toFile(path.join(PHOTO_DIR, file));
    await img.clone().resize(480, 480, { fit: 'cover' }).jpeg({ quality: 78, mozjpeg: true })
      .toFile(path.join(PHOTO_DIR, file.replace('.jpg', '-s.jpg')));
  } catch {
    dropPhoto(file);
    throw httpError(400, "That picture couldn't be read");
  }
  const old = row(id)?.photo;
  db.prepare('UPDATE recipes SET photo = ?, changed_at = ? WHERE id = ?').run(file, Date.now(), id);
  dropPhoto(old);
}

const upload = multer({
  dest: TMP_DIR,
  limits: { fileSize: 30 * 1024 * 1024, files: 1 },
  fileFilter: (req, file, cb) => cb(null, /^image\//.test(file.mimetype))
});

// ---------- importing ----------

// A recipe from a web page's schema.org data, in the shape clean() takes, plus where its picture is.
function fromSchema(r, pageUrl) {
  const many = (v) => (v == null ? [] : Array.isArray(v) ? v : [v]);
  const steps = [];
  const addSteps = (v) => {
    for (const s of many(v)) {
      if (typeof s === 'string') steps.push(...decode(s).split(/\n+/));
      else if (s?.['@type'] === 'HowToSection' || s?.itemListElement) {
        if (s.name) steps.push(`${text(s.name, 80)}:`);
        addSteps(s.itemListElement);
      } else if (s) steps.push(s.text || s.name || '');
    }
  };
  addSteps(r.recipeInstructions);
  const yields = many(r.recipeYield).map((y) => String(y));
  const servings = yields.map((y) => y.match(/^\s*(\d+)\s*(servings?|portions?|people|serves)?\s*$/i)).find(Boolean);
  const image = many(r.image).map((i) => (typeof i === 'string' ? i : i?.url || i?.contentUrl)).find(Boolean);
  return {
    data: {
      title: r.name, description: r.description,
      servings: servings ? servings[1] : yields.map((y) => y.match(/(\d+)\s*(servings?|portions?|people)/i)?.[1]).find(Boolean),
      yield: servings ? '' : yields.find((y) => /\D/.test(y)) || '',
      prepMin: minutes(r.prepTime), cookMin: minutes(r.cookTime), totalMin: minutes(r.totalTime),
      ingredients: many(r.recipeIngredient || r.ingredients).map((i) => decode(String(i))),
      steps,
      // (Not the page's keywords: on most sites they're there for search engines.)
      tags: [...many(r.recipeCategory), ...many(r.recipeCuisine)].flatMap((t) => String(t).split(',')).slice(0, 30),
      sourceUrl: pageUrl
    },
    image: image && new URL(image, pageUrl).href
  };
}

// The Recipe in a page's <script type="application/ld+json"> blocks.
function findRecipe(html) {
  const isRecipe = (o) => [].concat(o?.['@type'] ?? []).some((t) => String(t).toLowerCase() === 'recipe');
  const walk = (o, depth = 0) => {
    if (!o || typeof o !== 'object' || depth > 6) return null;
    if (isRecipe(o)) return o;
    for (const v of Array.isArray(o) ? o : [o['@graph'], o.mainEntity, ...Object.values(o)]) {
      const found = walk(v, depth + 1);
      if (found) return found;
    }
    return null;
  };
  for (const [, json] of html.matchAll(/<script[^>]*type\s*=\s*["']?application\/ld\+json["']?[^>]*>([\s\S]*?)<\/script>/gi)) {
    let data;
    try {
      data = JSON.parse(json);
    } catch {
      try { data = JSON.parse(json.replace(/[\u0000-\u001f]+/g, ' ')); } catch { continue; }
    }
    const r = walk(data);
    if (r) return r;
  }
  return null;
}

const importedId = (key) => db.prepare('SELECT id FROM recipes WHERE imported_from = ?').get(key)?.id ?? null;

// ---------- routes ----------

export const recipesRouter = express.Router();

recipesRouter.get('/', (req, res) => res.json(everything()));

// Photos are named after what's in them, so they never change.
recipesRouter.get('/photo/:file', (req, res) => {
  if (!PHOTO_NAME.test(req.params.file)) throw httpError(404, 'No such photo');
  const file = path.join(PHOTO_DIR, req.params.file);
  if (!fs.existsSync(file)) throw httpError(404, 'No such photo');
  res.set('Cache-Control', 'private, max-age=31536000, immutable');
  res.type('image/jpeg').sendFile(file);
});

recipesRouter.post('/', requireAdult, (req, res) => {
  const id = insert(clean(req.body), req.account.id);
  res.json({ ok: true, id, ...everything() });
});

recipesRouter.put('/:id', requireAdult, (req, res) => {
  const old = row(req.params.id);
  if (!old) throw httpError(404, 'That recipe is gone');
  const r = clean(req.body);
  db.prepare(`UPDATE recipes SET title = ?, description = ?, servings = ?, yield = ?, prep_min = ?, cook_min = ?, total_min = ?,
    ingredients = ?, steps = ?, notes = ?, tags = ?, source_url = ?, changed_at = ? WHERE id = ?`)
    .run(r.title, r.description, r.servings, r.yield, r.prepMin, r.cookMin, r.totalMin, JSON.stringify(r.ingredients),
      JSON.stringify(r.steps), r.notes, JSON.stringify(r.tags), r.sourceUrl, Date.now(), old.id);
  res.json({ ok: true, id: old.id, ...everything() });
});

recipesRouter.delete('/:id', requireAdult, (req, res) => {
  const old = row(req.params.id);
  if (old) {
    db.prepare('DELETE FROM recipes WHERE id = ?').run(old.id);
    dropPhoto(old.photo);
  }
  res.json({ ok: true, ...everything() });
});

recipesRouter.post('/:id/photo', requireAdult, upload.single('photo'), async (req, res) => {
  try {
    if (!row(req.params.id)) throw httpError(404, 'That recipe is gone');
    if (!req.file) throw httpError(400, 'Pick a picture');
    await setPhoto(Number(req.params.id), req.file.path);
  } finally {
    if (req.file) fs.rmSync(req.file.path, { force: true });
  }
  res.json({ ok: true, ...everything() });
});

recipesRouter.delete('/:id/photo', requireAdult, (req, res) => {
  const old = row(req.params.id);
  if (old?.photo) {
    db.prepare('UPDATE recipes SET photo = NULL, changed_at = ? WHERE id = ?').run(Date.now(), old.id);
    dropPhoto(old.photo);
  }
  res.json({ ok: true, ...everything() });
});

// A recipe from a web page. Only pages out on the internet (not the home
// network), so this can't be used to poke at the family's own servers.
recipesRouter.post('/import/url', requireAdult, async (req, res) => {
  let url;
  try {
    url = new URL(String(req.body.url || '').trim());
    if (!/^https?:$/.test(url.protocol)) throw new Error();
  } catch {
    throw httpError(400, "That doesn't look like a web address");
  }
  url.hash = '';
  const have = importedId(url.href);
  if (have) return res.json({ ok: true, id: have, already: true, ...everything() });
  const page = await safeFetch(url.href, { maxBytes: 6 * 1024 * 1024, accept: 'text/html,application/xhtml+xml' });
  const found = findRecipe(page.body.toString('utf8'));
  if (!found) throw httpError(400, "That page doesn't have a recipe Family Track can read. You can still add it by hand.");
  const r = fromSchema(found, page.url);
  const id = insert(clean(r.data), req.account.id, url.href);
  let photo = true;
  if (r.image) {
    try {
      await setPhoto(id, (await safeFetch(r.image, { maxBytes: 20 * 1024 * 1024, accept: 'image/*' })).body);
    } catch {
      photo = false;
    }
  }
  res.json({ ok: true, id, photo, ...everything() });
});
