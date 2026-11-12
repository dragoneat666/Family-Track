import { useSyncExternalStore } from 'react';
import { api } from '../api.js';

// The Recipes screen's data: every recipe comes in one go from
// GET /api/recipes and is kept on the device, so a recipe can still be
// cooked from with no server in reach. Adding or changing one needs the server.

const listeners = new Set();
let snapshot = { key: '', data: null, offline: false };

const keyNow = () => `ft.recipes.${api.serverUrl}|${api.knownAccount?.id ?? ''}`;

function current() {
  const key = keyNow();
  if (snapshot.key !== key) {
    let data = null;
    try { data = JSON.parse(localStorage.getItem(key)); } catch { /* nothing kept */ }
    snapshot = { key, data, offline: false };
  }
  return snapshot;
}

function publish(next) {
  snapshot = { ...current(), ...next };
  for (const fn of listeners) fn();
}

function got({ recipes }) {
  const data = { recipes };
  try { localStorage.setItem(current().key, JSON.stringify(data)); } catch { /* full or private: fine */ }
  publish({ data, offline: false });
}

export const currentRecipes = () => current();

export function useRecipes() {
  return useSyncExternalStore((fn) => {
    listeners.add(fn);
    return () => listeners.delete(fn);
  }, current);
}

export async function refreshRecipes() {
  try {
    got(await api.get('/api/recipes', { timeout: 8000 }));
  } catch (e) {
    if (e.status === 401) throw e;
    publish({ offline: true });
  }
}

const after = (r) => {
  got(r);
  return r;
};

// Steps are kept one per entry; in the editor they're one per line, or
// split by blank lines when a step runs over more than one line.
export const stepsToText = (steps) => {
  const parts = steps.map((s) => (s.section ? `${s.section}:` : s.text));
  return parts.join(parts.some((p) => p.includes('\n')) ? '\n\n' : '\n');
};
export const textToSteps = (t) => (/\n\s*\n/.test(t) ? t.split(/\n\s*\n/) : t.split('\n')).map((s) => s.trim()).filter(Boolean);
export const ingredientsToText = (list) => list.map((i) => (i.section ? `${i.section}:` : i.text)).join('\n');

export async function saveRecipe(r) {
  const body = {
    title: r.title, description: r.description, servings: r.servings, yield: r.yield,
    prepMin: r.prepMin, cookMin: r.cookMin, totalMin: r.totalMin,
    ingredients: r.ingredientsText.split('\n'), steps: textToSteps(r.stepsText),
    notes: r.notes, tags: r.tagsText.split(','), sourceUrl: r.sourceUrl
  };
  return after(r.id ? await api.put(`/api/recipes/${r.id}`, body) : await api.post('/api/recipes', body)).id;
}

export async function deleteRecipe(id) {
  after(await api.del(`/api/recipes/${id}`));
}

export async function setRecipePhoto(id, file, onProgress) {
  const form = new FormData();
  form.append('photo', file);
  after(await api.upload('POST', `/api/recipes/${id}/photo`, form, onProgress));
}

export async function removeRecipePhoto(id) {
  after(await api.del(`/api/recipes/${id}/photo`));
}

// Importing can take a while (photos come too).
const slow = (path, body) => api.request('POST', path, body, { timeout: 240000 });
export const importFromPage = async (url) => after(await slow('/api/recipes/import/url', { url }));

// ---------- photos ----------

// Photos need the sign-in, so they're fetched (not just <img src>) and kept
// on the device, which also lets them show with no server in reach. Their
// addresses never change, so a kept one is always right.
const shown = new Map(); // photo address -> object URL
const CACHE = 'ft-recipe-photos';

export async function photoUrl(path) {
  if (shown.has(path)) return shown.get(path);
  const url = api.url(path);
  let blob = null;
  const cache = typeof caches !== 'undefined' ? await caches.open(CACHE).catch(() => null) : null;
  const kept = cache && await cache.match(url).catch(() => null);
  if (kept) blob = await kept.blob();
  else {
    const res = await fetch(url, { headers: api.authHeaders() });
    if (!res.ok) throw new Error(`Photo ${res.status}`);
    if (cache) await cache.put(url, res.clone()).catch(() => {});
    blob = await res.blob();
  }
  const objectUrl = URL.createObjectURL(blob);
  shown.set(path, objectUrl);
  return objectUrl;
}

// ---------- showing them ----------

export function timeText(min) {
  if (!min) return '';
  const h = Math.floor(min / 60);
  const m = min % 60;
  return h ? `${h} hr${m ? ` ${m} min` : ''}` : `${m} min`;
}

export function timesText(r) {
  return [r.prepMin && `Prep ${timeText(r.prepMin)}`, r.cookMin && `Cook ${timeText(r.cookMin)}`,
    r.totalMin && (r.prepMin || r.cookMin) && `Total ${timeText(r.totalMin)}`,
    r.totalMin && !r.prepMin && !r.cookMin && `Takes ${timeText(r.totalMin)}`].filter(Boolean);
}

export const totalTime = (r) => r.totalMin || ((r.prepMin || 0) + (r.cookMin || 0)) || null;

const METRIC = new Set(['g', 'kg', 'ml', 'l']);
const FRACTIONS = [[1 / 8, '⅛'], [1 / 4, '¼'], [1 / 3, '⅓'], [3 / 8, '⅜'], [1 / 2, '½'], [5 / 8, '⅝'], [2 / 3, '⅔'], [3 / 4, '¾'], [7 / 8, '⅞']];

// An amount as a cook reads it: 1.5 → 1½ (cups and spoons), 375 g, 0.4 l.
export function amountText(n, unit) {
  if (n == null) return '';
  if (METRIC.has(unit)) {
    const r = n >= 100 ? Math.round(n / 5) * 5 : n >= 10 ? Math.round(n) : Math.round(n * 10) / 10;
    return String(r);
  }
  if (n >= 20) return String(Math.round(n));
  let whole = Math.floor(n);
  const rest = n - whole;
  let best = ['', 0];
  let err = rest;
  for (const [v, s] of FRACTIONS) {
    if (Math.abs(rest - v) < err) { err = Math.abs(rest - v); best = [s, v]; }
  }
  if (1 - rest < err) { whole += 1; best = ['', 0]; err = 1 - rest; }
  if (err > 0.06) return String(Math.round(n * 100) / 100);
  return whole ? `${whole}${best[0]}` : best[0] || '0';
}

export const PLURAL = { cup: 'cups', quart: 'quarts', pint: 'pints', gallon: 'gallons', pinch: 'pinches', dash: 'dashes', clove: 'cloves', can: 'cans', jar: 'jars',
  package: 'packages', stick: 'sticks', slice: 'slices', bunch: 'bunches', head: 'heads', sprig: 'sprigs', handful: 'handfuls', piece: 'pieces' };

// One ingredient, scaled by `by` (1: just as it was written).
export function ingredientText(i, by = 1) {
  if (by === 1 || i.qty == null) return i.text;
  const top = i.qty2 ?? i.qty;
  const amount = `${amountText(i.qty * by, i.unit)}${i.qty2 != null ? `–${amountText(i.qty2 * by, i.unit)}` : ''}`;
  const unit = i.unit && (top * by > 1 && PLURAL[i.unit] ? PLURAL[i.unit] : i.unit);
  const note = i.note ? (i.note.startsWith('(') ? ` ${i.note}` : `, ${i.note}`) : '';
  return [amount, unit, `${i.name}${note}`].filter(Boolean).join(' ');
}

// "Makes 12" for twice the recipe: "Makes 24".
export const yieldText = (y, by = 1) => (by === 1 ? y : y.replace(/\d+(\.\d+)?/, (n) => amountText(Number(n) * by, '')));

export function matches(r, q) {
  if (!q) return true;
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  const hay = [r.title, r.description, r.tags.join(' '), ...r.ingredients.map((i) => i.name || i.section || '')].join(' ').toLowerCase();
  return words.every((w) => hay.includes(w));
}

// The tags used most, for the filter chips.
export function topTags(recipes, max = 12) {
  const count = new Map();
  for (const r of recipes) for (const t of r.tags) count.set(t, (count.get(t) || 0) + 1);
  return [...count].filter(([, n]) => n > 1 || recipes.length < 6).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, max).map(([t]) => t);
}
