import { useSyncExternalStore } from 'react';
import { api } from '../api.js';
import { todayDay, addDays } from '../calendar/data.js';
import { nameKey } from '../lists/catalog.js';
import { amountText, PLURAL } from './data.js';

// The meal planner's data: the planned meals of the days last looked at,
// kept on the device (so tonight's dinner shows with no server in reach).
// Changing a meal needs the server; then those days are fetched again.

export const SLOTS = [['breakfast', 'Breakfast'], ['lunch', 'Lunch'], ['dinner', 'Dinner']];
export const QUICK = ['Leftovers', 'Easy night', 'Takeout', 'Eating out', 'Pizza night', 'Sandwiches', 'Breakfast for dinner'];

const listeners = new Set();
let snapshot = { key: '', days: {}, offline: false };
let lastRange = null;

const keyNow = () => `ft.meals.${api.serverUrl}|${api.knownAccount?.id ?? ''}`;

function current() {
  const key = keyNow();
  if (snapshot.key !== key) {
    let days = {};
    try { days = JSON.parse(localStorage.getItem(key)) || {}; } catch { /* nothing kept */ }
    snapshot = { key, days, offline: false };
  }
  return snapshot;
}

function publish(next) {
  snapshot = { ...current(), ...next };
  for (const fn of listeners) fn();
}

export function useMeals() {
  return useSyncExternalStore((fn) => {
    listeners.add(fn);
    return () => listeners.delete(fn);
  }, current);
}

// Fetch from..to (and keep only the last few weeks around).
export async function loadMeals(from, to) {
  lastRange = [from, to];
  try {
    const { meals } = await api.get(`/api/meals?from=${from}&to=${to}`, { timeout: 8000 });
    const days = {};
    const keepFrom = addDays(todayDay(), -14);
    for (const [d, list] of Object.entries(current().days)) if (d >= keepFrom && (d < from || d > to)) days[d] = list;
    for (const m of meals) (days[m.day] ||= []).push(m);
    try { localStorage.setItem(current().key, JSON.stringify(days)); } catch { /* fine */ }
    publish({ days, offline: false });
  } catch (e) {
    if (e.status === 401) throw e;
    publish({ offline: true });
  }
}

const again = () => lastRange && loadMeals(...lastRange);

export async function addMeal(m) {
  await api.post('/api/meals', m);
  await again();
}
export async function changeMeal(id, patch) {
  await api.put(`/api/meals/${id}`, patch);
  await again();
}
export async function removeMeal(id) {
  await api.del(`/api/meals/${id}`);
  await again();
}

export const mealsOn = (days, day, slot) => (days[day] || []).filter((m) => !slot || m.slot === slot);

// "Tonight: Taco Tuesday" for the home screen button.
export function tonightNote(days) {
  const dinner = mealsOn(days, todayDay(), 'dinner');
  return dinner.length ? `Tonight: ${dinner.map((m) => m.title).join(' + ')}` : '';
}

// ---------- the grocery list ----------

const capital = (s) => s.charAt(0).toUpperCase() + s.slice(1);
// Bought whole: 1⅓ jars of sauce is 2 jars; 7½ taco shells is 8.
const WHOLE = new Set(['', 'can', 'jar', 'package', 'stick', 'head', 'bunch', 'slice', 'piece', 'clove']);
// Usually in the house: these start unticked.
const PANTRY = /^(salt|pepper|black pepper|salt and pepper|water|ice|cold water|warm water|hot water)$|\bto taste\b/i;

// What to buy for some recipes, each scaled `by`: the same thing in the same
// unit is added up ("Ground beef (3 lb)"); things with no amount are listed
// once. sources: [{ recipe, by }] → [{ key, text, from: [titles] }].
export function groceryRows(sources) {
  const rows = new Map();
  for (const { recipe, by } of sources) {
    for (const i of recipe.ingredients) {
      if (i.section) continue;
      const name = i.name.replace(/\s+/g, ' ').trim();
      if (!name) continue;
      const key = `${nameKey(name)}|${i.qty == null ? '' : i.unit}`;
      const row = rows.get(key) || { key, name: capital(name), unit: i.unit, qty: 0, counted: true, from: [] };
      if (i.qty == null) row.counted = false;
      else row.qty += (i.qty2 ?? i.qty) * by;
      if (!row.from.includes(recipe.title)) row.from.push(recipe.title);
      rows.set(key, row);
    }
  }
  return [...rows.values()].map((r) => {
    const qty = WHOLE.has(r.unit) ? Math.ceil(r.qty - 0.01) : r.qty;
    const unit = r.unit && qty > 1 && PLURAL[r.unit] ? PLURAL[r.unit] : r.unit;
    return {
      key: r.key,
      name: r.name,
      text: r.counted && qty ? `${r.name} (${amountText(qty, r.unit)}${unit ? ` ${unit}` : ''})` : r.name,
      from: r.from,
      pantry: PANTRY.test(r.name)
    };
  });
}
