import express from 'express';
import { db } from './db.js';
import { httpError, requireAdult } from './auth.js';

// The meal planner: what's for breakfast, lunch and dinner on each day. A
// planned meal is a recipe (for how many) or just a few words ("Leftovers",
// "Takeout"). Grown-ups plan; kids see dinner only, in their My Day.

export const SLOTS = ['breakfast', 'lunch', 'dinner'];
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const MAX_RANGE = 62;

const isAdult = (p) => !!p.is_parent && !p.is_test;
const text = (v, max) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const validDay = (d) => DAY.test(d || '') && !Number.isNaN(new Date(`${d}T12:00:00`).getTime());
const photoUrl = (file) => file && `/api/recipes/photo/${file.replace('.jpg', '-s.jpg')}`;

const toMeal = (m) => ({
  id: m.id, day: m.day, slot: m.slot, recipeId: m.recipe_id, note: m.note, servings: m.servings,
  // (For kids, who don't get the recipes themselves.)
  title: m.title || m.note, thumb: photoUrl(m.photo)
});

const mealRow = (id) => db.prepare('SELECT * FROM meals WHERE id = ?').get(Number(id));

function clean(b, old = {}) {
  const day = b.day ?? old.day;
  if (!validDay(day)) throw httpError(400, 'Pick a day');
  const slot = b.slot ?? old.slot ?? 'dinner';
  if (!SLOTS.includes(slot)) throw httpError(400, 'Breakfast, lunch or dinner?');
  const recipeId = b.recipeId !== undefined ? (b.recipeId == null ? null : Number(b.recipeId)) : old.recipe_id ?? null;
  if (recipeId != null && !db.prepare('SELECT 1 FROM recipes WHERE id = ?').get(recipeId)) throw httpError(400, 'That recipe is gone');
  const note = b.note !== undefined ? text(b.note, 80) : old.note ?? '';
  if (recipeId == null && !note) throw httpError(400, 'Pick a recipe or write what it is');
  let servings = b.servings !== undefined ? b.servings : old.servings ?? null;
  servings = servings == null || servings === '' ? null : Math.round(Number(servings));
  if (servings != null && !(servings >= 1 && servings <= 100)) throw httpError(400, 'Serves 1 to 100');
  return { day, slot, recipeId, note, servings: recipeId == null ? null : servings };
}

export const mealsRouter = express.Router();

// GET ?from=YYYY-MM-DD&to=YYYY-MM-DD (up to two months).
mealsRouter.get('/', (req, res) => {
  const { from, to } = req.query;
  if (!validDay(from) || !validDay(to) || to < from) throw httpError(400, 'Which days?');
  if ((new Date(`${to}T12:00:00`) - new Date(`${from}T12:00:00`)) / 86400000 > MAX_RANGE) throw httpError(400, 'Too many days at once');
  const adult = isAdult(req.account);
  const meals = db.prepare(`SELECT m.*, r.title, r.photo FROM meals m LEFT JOIN recipes r ON r.id = m.recipe_id
    WHERE m.day BETWEEN ? AND ? ${adult ? '' : "AND m.slot = 'dinner'"} ORDER BY m.day, m.sort, m.id`).all(from, to);
  res.json({ meals: meals.map(toMeal) });
});

mealsRouter.post('/', requireAdult, (req, res) => {
  const m = clean(req.body);
  const now = Date.now();
  const { lastInsertRowid } = db.prepare(`INSERT INTO meals (day, slot, recipe_id, note, servings, sort, created_by, changed_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(m.day, m.slot, m.recipeId, m.note, m.servings, now, req.account.id, now);
  res.json({ ok: true, id: Number(lastInsertRowid) });
});

mealsRouter.put('/:id', requireAdult, (req, res) => {
  const old = mealRow(req.params.id);
  if (!old) throw httpError(404, 'That meal is gone');
  const m = clean(req.body, old);
  // Moved to another day or meal: it goes at the end there.
  const sort = m.day !== old.day || m.slot !== old.slot ? Date.now() : old.sort;
  db.prepare('UPDATE meals SET day = ?, slot = ?, recipe_id = ?, note = ?, servings = ?, sort = ?, changed_at = ? WHERE id = ?')
    .run(m.day, m.slot, m.recipeId, m.note, m.servings, sort, Date.now(), old.id);
  res.json({ ok: true, id: old.id });
});

mealsRouter.delete('/:id', requireAdult, (req, res) => {
  db.prepare('DELETE FROM meals WHERE id = ?').run(Number(req.params.id));
  res.json({ ok: true });
});
