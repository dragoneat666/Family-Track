import { useEffect, useMemo, useState } from 'react';
import { Sheet } from '../lists/ui.jsx';
import { useLists, sortedLists, itemsOf, lists, parseEntry } from '../lists/store.js';
import { nameKey } from '../lists/catalog.js';
import { todayDay, addDays, dayTitle, shortDay, fromDay, WEEKDAYS } from '../calendar/data.js';
import { useRecipes, timeText, totalTime } from './data.js';
import { useMeals, loadMeals, addMeal, changeMeal, removeMeal, mealsOn, SLOTS, QUICK, groceryRows } from './meals.js';
import { Photo } from './Photo.jsx';

const DAYS = 7;
const SHOW_ALL = 'ft.meals.allSlots';
const showAllSaved = () => { try { return localStorage.getItem(SHOW_ALL) === '1'; } catch { return false; } };
const by = (recipe, meal) => (recipe?.servings && meal.servings ? meal.servings / recipe.servings : 1);

// Seven days of meals from `start` (today to begin with). Dinner is always
// there ("Not picked yet"); breakfast and lunch when something's planned or
// "Breakfast and lunch too" is on.
export function Planner({ offline, onOpenRecipe, onAuthLost }) {
  const today = todayDay();
  const [start, setStart] = useState(today);
  const [allSlots, setAllSlots] = useState(showAllSaved);
  const { days, offline: mealsOffline } = useMeals();
  const { data } = useRecipes();
  const [adding, setAdding] = useState(null); // { day, slot }
  const [editing, setEditing] = useState(null); // a meal
  const [shopping, setShopping] = useState(false);
  const recipes = new Map((data?.recipes || []).map((r) => [r.id, r]));
  const end = addDays(start, DAYS - 1);

  useEffect(() => {
    const load = () => loadMeals(start, end).catch((e) => e.status === 401 && onAuthLost?.());
    load();
    const onVisible = () => { if (!document.hidden) load(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [start]);

  function toggleAll() {
    setAllSlots(!allSlots);
    try { localStorage.setItem(SHOW_ALL, allSlots ? '0' : '1'); } catch { /* fine */ }
  }

  const range = Array.from({ length: DAYS }, (_, i) => addDays(start, i));
  // Groceries for what's planned from today on (in these days).
  const toShop = range.filter((d) => d >= today).flatMap((d) => mealsOn(days, d)).filter((m) => recipes.has(m.recipeId));
  const cantChange = offline || mealsOffline;

  return (
    <div className="stack plan">
      {mealsOffline && <p className="sync-note">📴 Can't reach the server: these are the meals from last time.</p>}
      <div className="row spread wrap plan-top">
        <div className="row plan-nav">
          <button className="btn small" onClick={() => setStart(addDays(start, -DAYS))} aria-label="Earlier">‹</button>
          <b>{start === today ? 'The next 7 days' : `${shortDay(start)} – ${shortDay(end)}`}</b>
          <button className="btn small" onClick={() => setStart(addDays(start, DAYS))} aria-label="Later">›</button>
          {start !== today && <button className="btn small" onClick={() => setStart(today)}>Today</button>}
        </div>
        <label className="inline check small"><input type="checkbox" checked={allSlots} onChange={toggleAll} /> Breakfast and lunch too</label>
      </div>
      <button className="btn" disabled={!toShop.length} onClick={() => setShopping(true)}>
        🛒 Add {start === today ? "this week's" : "these days'"} meals to a grocery list
      </button>

      {range.map((d) => {
        const past = d < today;
        const weekday = fromDay(d).getDay();
        return (
          <section key={d} className={`card plan-day${d === today ? ' today' : ''}${past ? ' past' : ''}${weekday === 0 || weekday === 6 ? ' weekend' : ''}`}>
            <h3>{dayTitle(d, today)}</h3>
            {SLOTS.map(([slot, label]) => {
              const meals = mealsOn(days, d, slot);
              if (slot !== 'dinner' && !allSlots && !meals.length) return null;
              return (
                <div key={slot} className="plan-slot">
                  <span className="plan-slot-name">{label}</span>
                  <div className="plan-meals">
                    {meals.map((m) => {
                      const r = recipes.get(m.recipeId);
                      return (
                        <button key={m.id} className="plan-meal" onClick={() => setEditing(m)}>
                          {m.recipeId ? <Photo src={r?.thumb} className="plan-thumb" /> : <span className="plan-thumb plan-note-icon">📝</span>}
                          <span className="plan-meal-text">
                            <b>{r ? r.title : m.title}</b>
                            {r && (m.servings || totalTime(r)) && (
                              <small className="muted">{[m.servings && `for ${m.servings}`, totalTime(r) && `⏱ ${timeText(totalTime(r))}`].filter(Boolean).join(' · ')}</small>
                            )}
                          </span>
                        </button>
                      );
                    })}
                    {!meals.length && slot === 'dinner' && <span className="muted plan-empty">Not picked yet</span>}
                    <button className="btn small plan-add" disabled={cantChange} onClick={() => setAdding({ day: d, slot })} aria-label={`Add to ${label}`}>+</button>
                  </div>
                </div>
              );
            })}
          </section>
        );
      })}

      {adding && <PickMeal at={adding} recipes={data?.recipes || []} onClose={() => setAdding(null)} />}
      {editing && (
        <MealSheet meal={editing} recipe={recipes.get(editing.recipeId)} offline={cantChange} onClose={() => setEditing(null)}
          onOpen={(serves) => { setEditing(null); onOpenRecipe(editing.recipeId, serves); }} />
      )}
      {shopping && (
        <GrocerySheet
          title={start === today ? "This week's meals" : `Meals ${shortDay(start)} – ${shortDay(end)}`}
          sources={toShop.map((m) => ({ recipe: recipes.get(m.recipeId), by: by(recipes.get(m.recipeId), m) }))}
          onClose={() => setShopping(false)} />
      )}
    </div>
  );
}

// Add to a day's breakfast, lunch or dinner: a recipe, or a few words.
function PickMeal({ at, recipes, onClose }) {
  const [slot, setSlot] = useState(at.slot);
  const [q, setQ] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const shown = recipes.filter((r) => !q.trim() || r.title.toLowerCase().includes(q.trim().toLowerCase()) || r.tags.some((t) => t.toLowerCase().includes(q.trim().toLowerCase())));

  async function add(m) {
    setBusy(true);
    setError('');
    try {
      await addMeal({ day: at.day, slot, ...m });
      onClose();
    } catch (e) {
      setError(e.message);
      setBusy(false);
    }
  }

  return (
    <Sheet title={`${dayTitle(at.day)}`} onClose={onClose} closeLabel="Cancel" wide>
      <div className="row wrap">
        {SLOTS.map(([k, label]) => <button key={k} className={`cal-chip${slot === k ? ' on' : ''}`} onClick={() => setSlot(k)}>{label}</button>)}
      </div>
      <div className="stack tight">
        <b>Something quick</b>
        <div className="row wrap">
          {QUICK.map((t) => <button key={t} className="cal-chip" disabled={busy} onClick={() => add({ note: t })}>{t}</button>)}
        </div>
        <div className="row plan-note">
          <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={80} placeholder="Or write it: Grandma's, Hot dogs…" />
          <button className="btn" disabled={busy || !note.trim()} onClick={() => add({ note: note.trim() })}>Add</button>
        </div>
      </div>
      <div className="stack tight">
        <b>A recipe</b>
        {recipes.length > 6 && <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="🔍 Find a recipe" />}
        {error && <p className="error">{error}</p>}
        <ul className="plan-pick">
          {shown.map((r) => (
            <li key={r.id}>
              <button className="plan-meal" disabled={busy} onClick={() => add({ recipeId: r.id })}>
                <Photo src={r.thumb} className="plan-thumb" />
                <span className="plan-meal-text"><b>{r.title}</b>{totalTime(r) && <small className="muted">⏱ {timeText(totalTime(r))}</small>}</span>
              </button>
            </li>
          ))}
          {!shown.length && <li className="muted">{recipes.length ? 'No recipes like that' : 'No recipes yet: add some under Recipes.'}</li>}
        </ul>
      </div>
    </Sheet>
  );
}

// One planned meal: open its recipe, move it, change how many, or take it off.
function MealSheet({ meal, recipe, offline, onClose, onOpen }) {
  const [day, setDay] = useState(meal.day);
  const [slot, setSlot] = useState(meal.slot);
  const [serves, setServes] = useState(meal.servings || recipe?.servings || null);
  const [note, setNote] = useState(meal.note);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const changed = day !== meal.day || slot !== meal.slot || (recipe ? (serves || null) !== (meal.servings || recipe.servings || null) : note.trim() !== meal.note);

  async function run(fn) {
    setBusy(true);
    setError('');
    try {
      await fn();
      onClose();
    } catch (e) {
      setError(e.message);
      setBusy(false);
    }
  }
  const save = () => run(() => changeMeal(meal.id, {
    day, slot, ...(recipe ? { servings: serves && serves !== recipe.servings ? serves : null } : { note: note.trim() })
  }));

  return (
    <Sheet title={recipe ? recipe.title : meal.title} onClose={onClose} closeLabel={changed ? 'Cancel' : 'Done'}>
      {recipe && <button className="btn primary" onClick={() => onOpen(serves)}>📖 Open the recipe</button>}
      {!recipe && meal.recipeId && <p className="muted">That recipe was deleted.</p>}
      {!recipe && !meal.recipeId && (
        <label>What it is<input value={note} onChange={(e) => setNote(e.target.value)} maxLength={80} /></label>
      )}
      <label>Day<input type="date" value={day} onChange={(e) => e.target.value && setDay(e.target.value)} /></label>
      <div className="row wrap">
        {SLOTS.map(([k, label]) => <button key={k} className={`cal-chip${slot === k ? ' on' : ''}`} onClick={() => setSlot(k)}>{label}</button>)}
      </div>
      {recipe?.servings && (
        <div className="row rec-scale">
          <button className="btn small" disabled={serves <= 1} onClick={() => setServes(serves - 1)} aria-label="Fewer">−</button>
          <span>Serves <b>{serves}</b>{serves !== recipe.servings && <span className="muted small"> (written for {recipe.servings})</span>}</span>
          <button className="btn small" disabled={serves >= 100} onClick={() => setServes(serves + 1)} aria-label="More">+</button>
        </div>
      )}
      {error && <p className="error">{error}</p>}
      {changed && <button className="btn primary" disabled={busy || offline || (!recipe && !note.trim())} onClick={save}>Save</button>}
      <button className="btn danger" disabled={busy || offline} onClick={() => run(() => removeMeal(meal.id))}>Take it off the plan</button>
    </Sheet>
  );
}

// Plan a recipe from its page: which day and meal, for how many.
export function PlanRecipe({ recipe, serves, onClose }) {
  const today = todayDay();
  const [day, setDay] = useState(today);
  const [slot, setSlot] = useState('dinner');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const { days } = useMeals();
  useEffect(() => { loadMeals(today, addDays(today, DAYS - 1)).catch(() => {}); }, []);
  const choices = Array.from({ length: 14 }, (_, i) => addDays(today, i));
  const label = (d) => {
    const n = (d === today ? 'Today' : d === addDays(today, 1) ? 'Tomorrow' : WEEKDAYS[fromDay(d).getDay()].slice(0, 3));
    return `${n} ${shortDay(d).split(' ')[1]}`;
  };

  async function plan() {
    setBusy(true);
    setError('');
    try {
      await addMeal({ day, slot, recipeId: recipe.id, servings: recipe.servings && serves !== recipe.servings ? serves : null });
      onClose(true);
    } catch (e) {
      setError(e.message);
      setBusy(false);
    }
  }

  const there = mealsOn(days, day, slot);
  return (
    <Sheet title={`Plan ${recipe.title}`} onClose={() => onClose(false)} closeLabel="Cancel">
      <div className="row wrap">
        {SLOTS.map(([k, l]) => <button key={k} className={`cal-chip${slot === k ? ' on' : ''}`} onClick={() => setSlot(k)}>{l}</button>)}
      </div>
      <div className="plan-days">
        {choices.map((d) => {
          const taken = mealsOn(days, d, slot).length > 0;
          return (
            <button key={d} className={`cal-chip${day === d ? ' on' : ''}${taken ? ' taken' : ''}`} onClick={() => setDay(d)}>
              {label(d)}{taken ? ' •' : ''}
            </button>
          );
        })}
      </div>
      <label className="small">Another day<input type="date" value={day} onChange={(e) => e.target.value && setDay(e.target.value)} /></label>
      {there.length > 0 && <p className="muted small">Already planned then: {there.map((m) => m.title).join(', ')}. This is added too.</p>}
      {recipe.servings && serves !== recipe.servings && <p className="muted small">For {serves} (it's written for {recipe.servings}).</p>}
      {error && <p className="error">{error}</p>}
      <button className="btn primary" disabled={busy} onClick={plan}>📅 Plan it for {dayTitle(day).split(' - ')[0]} {slot}</button>
    </Sheet>
  );
}

const LAST_LIST = 'ft.meals.groceryList';

// Put what some recipes need on a list: everything to buy, ticked, with
// its amount; untick what's already in the house, change any line, pick
// the list. Things already on that list start unticked.
export function GrocerySheet({ title, sources, onClose }) {
  const v = useLists();
  const choices = useMemo(() => {
    const all = sortedLists(v);
    return [...all.filter((l) => l.kind === 'store'), ...all.filter((l) => l.kind !== 'store')];
  }, [v]);
  const [listId, setListId] = useState(() => { try { return localStorage.getItem(LAST_LIST); } catch { return null; } });
  const list = choices.find((l) => l.id === listId) || choices[0];
  const rows = useMemo(() => groceryRows(sources), []);
  const [texts, setTexts] = useState(() => Object.fromEntries(rows.map((r) => [r.key, r.text])));
  const [off, setOff] = useState(null); // keys unticked (null: not decided yet for this list)
  const [done, setDone] = useState(null);

  const onList = useMemo(() => {
    if (!list) return new Set();
    return new Set(itemsOf(v, list.id).filter((i) => !i.checked).map((i) => nameKey(i.name)));
  }, [v, list?.id]);
  const already = (r) => onList.has(nameKey(parseEntry(texts[r.key]).name));
  // Until something's ticked or unticked by hand, what's on the list (and
  // salt, pepper, water) is unticked.
  const unticked = off ?? new Set(rows.filter((r) => r.pantry || already(r)).map((r) => r.key));
  const toggle = (key) => {
    const n = new Set(unticked);
    if (n.has(key)) n.delete(key); else n.add(key);
    setOff(n);
  };

  function add() {
    try { localStorage.setItem(LAST_LIST, list.id); } catch { /* fine */ }
    let added = 0;
    let had = 0;
    for (const r of rows) {
      if (unticked.has(r.key) || !texts[r.key].trim()) continue;
      const res = lists.addItem(list.id, texts[r.key]);
      if (res?.was === 'open') had++;
      else if (res) added++;
    }
    setDone({ added, had });
  }

  const count = rows.filter((r) => !unticked.has(r.key) && texts[r.key].trim()).length;
  const many = sources.length > 1;
  return (
    <Sheet title="Add to a grocery list" onClose={onClose} closeLabel={done ? 'Done' : 'Cancel'} wide>
      {!v.ready && <div className="spinner" />}
      {v.ready && !list && <p>There are no lists yet. Make one under Lists first.</p>}
      {done && (
        <p>✓ Added {done.added} {done.added === 1 ? 'thing' : 'things'} to {list.name}
          {done.had ? ` (${done.had} ${done.had === 1 ? 'was' : 'were'} already on it)` : ''}.</p>
      )}
      {v.ready && list && !done && (
        <>
          <p className="muted small">{title}{many ? ` (${sources.length} recipes)` : ''}. Untick what you have; tap a line to change it.</p>
          <label>List
            <select value={list.id} onChange={(e) => { setListId(e.target.value); setOff(null); }}>
              {choices.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
            </select>
          </label>
          <ul className="grocery-rows">
            {rows.map((r) => (
              <li key={r.key} className={unticked.has(r.key) ? 'off' : ''}>
                <input type="checkbox" checked={!unticked.has(r.key)} onChange={() => toggle(r.key)} aria-label="Add this" />
                <span className="grocery-text">
                  <input value={texts[r.key]} onChange={(e) => setTexts({ ...texts, [r.key]: e.target.value })} maxLength={120} />
                  {(already(r) || (many && r.from.length > 1)) && (
                    <small className="muted">{[already(r) && 'already on the list', many && r.from.length > 1 && `for ${r.from.length} recipes`].filter(Boolean).join(' · ')}</small>
                  )}
                </span>
              </li>
            ))}
          </ul>
          <button className="btn primary" disabled={!count} onClick={add}>🛒 Add {count} to {list.name}</button>
        </>
      )}
    </Sheet>
  );
}
