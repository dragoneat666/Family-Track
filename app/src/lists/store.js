import { useSyncExternalStore } from 'react';
import { api } from '../api.js';
import { notify } from '../notify.js';
import { SECTIONS, CATALOG, nameKey, standardSection } from './catalog.js';

// The grown-ups' lists, kept on this device so they open and change with no
// connection (NetBird off, no signal in the store).
//
//  base    what the server last told us
//  outbox  changes made here that the server hasn't confirmed yet ("ops")
//  view    base with the outbox applied on top: what the screens show
//
// Every change is applied here straight away and queued. A loop sends the
// queue when the server can be reached, then waits on the server for other
// people's changes (it answers the moment something changes). The server
// applies ops in the order they arrive; see server/src/lists.js, whose op
// rules applyOp() below repeats.

const DAY = 24 * 60 * 60 * 1000;
const EMPTY = Object.freeze({
  ready: false, lists: new Map(), sections: new Map(), items: new Map(), memory: new Map(),
  pins: [], people: [], me: null, online: true, pending: 0, notice: ''
});

let session = null;
let snapshot = EMPTY;
const listeners = new Set();

export function newId() {
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  return [...bytes].map((b) => (b % 36).toString(36)).join('') + Date.now().toString(36).slice(-4);
}

// ---------- applying ops ----------

function learn(v, list, name, section, used, at) {
  if (list?.kind !== 'store') return;
  const key = nameKey(name);
  if (!key) return;
  const k = `${list.id}|${key}`;
  const cur = v.memory.get(k);
  v.memory.set(k, {
    list: list.id, key, name, section: section ?? cur?.section ?? null,
    uses: (cur?.uses || 0) + (used ? 1 : 0), usedAt: used ? at : cur?.usedAt ?? null
  });
}

const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

// Row objects are never changed in place (base and view share them).
function applyOp(v, op) {
  switch (op.t) {
    case 'list.put': {
      const l = op.list;
      const cur = v.lists.get(l.id);
      if (!cur) {
        if (l.name) v.lists.set(l.id, { id: l.id, name: l.name, kind: l.kind === 'store' ? 'store' : 'plain', private: !!l.private, mine: true, sort: l.sort ?? op.at });
      } else {
        v.lists.set(l.id, { ...cur, name: l.name || cur.name, private: l.private == null ? cur.private : !!l.private, sort: l.sort ?? cur.sort });
      }
      break;
    }
    case 'list.del':
      v.lists.delete(op.list);
      for (const [id, s] of v.sections) if (s.list === op.list) v.sections.delete(id);
      for (const [id, i] of v.items) {
        if (i.list !== op.list) continue;
        v.items.delete(id);
        v.pins = v.pins.filter((p) => !(p.kind === 'item' && p.target === id));
      }
      for (const [k, m] of v.memory) if (m.list === op.list) v.memory.delete(k);
      v.pins = v.pins.filter((p) => !(p.kind === 'list' && p.target === op.list));
      break;
    case 'section.put': {
      const s = op.section;
      const cur = v.sections.get(s.id);
      if (!cur) {
        if (s.name && v.lists.has(s.list)) v.sections.set(s.id, { id: s.id, list: s.list, name: s.name, key: s.key || null, sort: s.sort ?? op.at });
      } else {
        v.sections.set(s.id, { ...cur, name: s.name || cur.name, sort: s.sort ?? cur.sort });
      }
      break;
    }
    case 'section.del':
      v.sections.delete(op.section);
      for (const [id, i] of v.items) if (i.section === op.section) v.items.set(id, { ...i, section: null });
      for (const [k, m] of v.memory) if (m.section === op.section) v.memory.set(k, { ...m, section: null });
      break;
    case 'item.put': {
      const i = op.item;
      const cur = v.items.get(i.id);
      if (!cur) {
        const list = v.lists.get(i.list);
        if (!list || !i.name) break;
        v.items.set(i.id, {
          id: i.id, list: i.list, section: i.section ?? null, name: i.name, note: i.note || '', sort: i.sort ?? op.at,
          checked: false, checkedAt: null, remindAt: null, allDay: false, who: null
        });
        learn(v, list, i.name, i.section ?? null, true, op.at);
      } else {
        const next = {
          ...cur, name: i.name || cur.name, note: has(i, 'note') ? i.note || '' : cur.note,
          section: has(i, 'section') ? i.section ?? null : cur.section, sort: i.sort ?? cur.sort
        };
        v.items.set(i.id, next);
        if (next.section && next.section !== cur.section) learn(v, v.lists.get(cur.list), next.name, next.section, false, op.at);
      }
      break;
    }
    case 'item.check': {
      const cur = v.items.get(op.item);
      if (!cur) break;
      v.items.set(cur.id, { ...cur, checked: !!op.checked, checkedAt: op.checked ? op.at : null });
      if (op.checked) v.pins = v.pins.filter((p) => !(p.kind === 'item' && p.target === cur.id));
      else if (op.again) {
        v.items.set(cur.id, { ...v.items.get(cur.id), remindAt: null, allDay: false, who: null });
        learn(v, v.lists.get(cur.list), cur.name, null, true, op.at);
      }
      break;
    }
    case 'items.del':
      for (const id of op.items) {
        v.items.delete(id);
        v.pins = v.pins.filter((p) => !(p.kind === 'item' && p.target === id));
      }
      break;
    case 'item.remind': {
      const cur = v.items.get(op.item);
      if (cur) v.items.set(cur.id, { ...cur, remindAt: op.when || null, allDay: !!(op.when && op.allDay), who: op.when ? op.who || { ids: [v.me] } : null });
      break;
    }
    case 'pin.set':
      v.pins = v.pins.filter((p) => !(p.kind === op.kind && p.target === op.target));
      if (op.on && (op.kind === 'list' ? v.lists.has(op.target) : v.items.has(op.target))) v.pins.push({ kind: op.kind, target: op.target, at: op.at });
      break;
    default:
  }
}

// What the server sent (rows changed since our rev) into base.
function merge(base, data) {
  if (data.full) {
    base.lists = new Map();
    base.sections = new Map();
    base.items = new Map();
    base.memory = new Map();
  }
  for (const l of data.lists || []) {
    if (!l.deleted) {
      base.lists.set(l.id, l);
      continue;
    }
    base.lists.delete(l.id);
    for (const [id, s] of base.sections) if (s.list === l.id) base.sections.delete(id);
    for (const [id, i] of base.items) if (i.list === l.id) base.items.delete(id);
    for (const [k, m] of base.memory) if (m.list === l.id) base.memory.delete(k);
  }
  for (const s of data.sections || []) (s.deleted ? base.sections.delete(s.id) : base.sections.set(s.id, s));
  for (const i of data.items || []) (i.deleted ? base.items.delete(i.id) : base.items.set(i.id, i));
  for (const m of data.memory || []) base.memory.set(`${m.list}|${m.key}`, m);
  base.pins = data.pins || [];
  base.people = data.people || base.people;
  base.me = data.me ?? base.me;
  base.rev = data.rev;
}

function rebuild(s) {
  const v = {
    lists: new Map(s.base.lists), sections: new Map(s.base.sections), items: new Map(s.base.items),
    memory: new Map(s.base.memory), pins: s.base.pins.slice(), me: s.me
  };
  for (const op of s.outbox) applyOp(v, op);
  s.view = v;
  snapshot = {
    ready: s.base.rev != null || s.outbox.length > 0, ...v, people: s.base.people,
    online: s.online, pending: s.outbox.length, notice: s.notice
  };
  for (const fn of listeners) fn();
}

// ---------- saved on the device ----------

function load(key) {
  const blank = { rev: null, lists: new Map(), sections: new Map(), items: new Map(), memory: new Map(), pins: [], people: [], me: null };
  try {
    const saved = JSON.parse(localStorage.getItem(key) || 'null');
    if (!saved) return { base: blank, outbox: [], dirty: [] };
    return {
      base: {
        rev: saved.rev, pins: saved.pins || [], people: saved.people || [], me: saved.me,
        lists: new Map(saved.lists.map((x) => [x.id, x])), sections: new Map(saved.sections.map((x) => [x.id, x])),
        items: new Map(saved.items.map((x) => [x.id, x])), memory: new Map(saved.memory.map((x) => [`${x.list}|${x.key}`, x]))
      },
      outbox: saved.outbox || [], dirty: saved.dirty || []
    };
  } catch {
    return { base: blank, outbox: [], dirty: [] };
  }
}

function save(s) {
  clearTimeout(s.saveTimer);
  s.saveTimer = setTimeout(() => saveNow(s), 150);
}
function saveNow(s) {
  clearTimeout(s.saveTimer);
  const b = s.base;
  try {
    localStorage.setItem(s.key, JSON.stringify({
      rev: b.rev, lists: [...b.lists.values()], sections: [...b.sections.values()], items: [...b.items.values()],
      memory: [...b.memory.values()], pins: b.pins, people: b.people, me: b.me, outbox: s.outbox, dirty: [...s.dirty]
    }));
  } catch { /* storage full or blocked: keep going from memory */ }
}

// ---------- talking to the server ----------

async function http(s, method, path, body, timeout) {
  const ctrl = new AbortController();
  s.ctrl = ctrl;
  const timer = setTimeout(() => ctrl.abort(), timeout);
  try {
    const res = await fetch(api.url(path), {
      method, signal: ctrl.signal,
      headers: { ...api.authHeaders(), ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw Object.assign(new Error(data.error || `Server error ${res.status}`), { status: res.status });
    return data;
  } finally {
    clearTimeout(timer);
    if (s.ctrl === ctrl) s.ctrl = null;
  }
}

function sleep(s, ms) {
  return new Promise((resolve) => {
    const timer = setTimeout(done, ms);
    function done() {
      clearTimeout(timer);
      if (s.wake === done) s.wake = null;
      resolve();
    }
    s.wake = done;
  });
}

// Stop waiting (on the server or on a retry timer) and go round again now.
function nudge(s) {
  if (s.wake) s.wake();
  else if (s.waiting && s.ctrl) {
    s.interrupted = true;
    s.ctrl.abort();
  }
}

async function push(s) {
  const batch = s.outbox.slice(0, s.batch);
  let data;
  try {
    data = await http(s, 'POST', '/api/lists/ops', { ops: batch, since: s.base.rev }, s.online ? 12000 : 6000);
  } catch (e) {
    // Something in the batch the server won't take at all: find it by
    // sending one at a time, and drop it so the rest can go.
    if (e.status >= 400 && e.status < 500 && ![401, 403, 408, 429].includes(e.status)) {
      if (batch.length > 1) s.batch = 1;
      else {
        s.outbox = s.outbox.filter((o) => o.id !== batch[0].id);
        s.notice = `A change couldn't be saved: ${e.message}`;
        rebuild(s);
        save(s);
      }
      return;
    }
    throw e;
  }
  s.batch = 200;
  const sent = new Set(batch.map((o) => o.id));
  s.outbox = s.outbox.filter((o) => !sent.has(o.id));
  // (A change from a notification button that no longer applies, like Done
  // on something already deleted, isn't worth a message.)
  const fromButtons = new Set(batch.filter((o) => o.button).map((o) => o.id));
  const refused = (data.results || []).find((r) => r.error && !fromButtons.has(r.id));
  if (refused) s.notice = refused.error;
  merge(s.base, data);
  rebuild(s);
  save(s);
  planSoon(s);
}

// Normally this waits on the server, which answers the moment something
// changes. Until the server has answered once, and while it can't be
// reached, it just asks and gives up fast, so being out of reach (or back
// in reach) is noticed within seconds.
async function pull(s) {
  const first = s.base.rev == null;
  const wait = !first && s.online && s.reached;
  s.waiting = wait;
  let data;
  try {
    data = await http(s, 'GET', `/api/lists/sync${first ? '' : `?since=${s.base.rev}${wait ? '&wait=25' : ''}`}`, null, wait ? 40000 : 6000);
  } finally {
    s.waiting = false;
  }
  s.reached = true;
  const changed = data.full || data.rev !== s.base.rev;
  merge(s.base, data);
  if (changed || !snapshot.ready) {
    rebuild(s);
    save(s);
    planSoon(s);
  }
}

async function loop(s) {
  let fails = 0;
  while (s.running) {
    if (document.hidden) {
      await sleep(s, 3600000); // woken when the app is looked at again
      continue;
    }
    try {
      if (s.outbox.length) await push(s);
      else await pull(s);
      fails = 0;
      setOnline(s, true);
    } catch (e) {
      if (!s.running) return;
      if (s.interrupted) {
        s.interrupted = false;
        continue;
      }
      if (e.status === 401 || e.status === 403) {
        s.onAuthLost?.(e);
        await sleep(s, 30000);
        continue;
      }
      fails++;
      setOnline(s, false);
      await sleep(s, Math.min(12000, 2000 * fails));
    }
  }
}

function setOnline(s, online) {
  if (s.online === online) return;
  s.online = online;
  rebuild(s);
  if (online) planSoon(s);
}

// ---------- notifications (pins and reminders) ----------

const listOps = (ops) => ({ path: '/api/lists/ops', body: { ops } });
const doneAction = (itemId, stamp) => ({
  id: 'done', title: 'Done',
  post: listOps([{ id: `done-${itemId}-${stamp}`, t: 'item.check', item: itemId, checked: true }])
});

// The same entry the server would make (server/src/lists.js listPlan), for
// things changed here that it hasn't heard about yet.
function planEntry(v, id) {
  const [, what, target] = /^(remind|pin-item|pin-list)-(.+)$/.exec(id) || [];
  if (what === 'pin-list') {
    const list = v.lists.get(target);
    const pin = v.pins.find((p) => p.kind === 'list' && p.target === target);
    if (!list || !pin) return null;
    const left = openItems(v, target);
    return {
      id, at: null, ongoing: true, channel: 'pins', quiet: true, title: list.name,
      body: left.length ? `${left.length} left: ${left.slice(0, 4).map((i) => i.name).join(', ')}${left.length > 4 ? '…' : ''}` : 'All done ✓',
      lines: left.slice(0, 8).map((i) => (i.note ? `${i.name} (${i.note})` : i.name)).concat(left.length > 8 ? [`+ ${left.length - 8} more`] : []),
      dismiss: { post: listOps([{ id: `unpin-${target}-${pin.at}`, t: 'pin.set', kind: 'list', target, on: false }]) },
      tap: { screen: 'list', list: target }
    };
  }
  const item = v.items.get(target);
  const list = item && v.lists.get(item.list);
  if (!list || item.checked) return null;
  const body = [item.note, list.name].filter(Boolean).join(' · ');
  const tap = { screen: 'list', list: list.id, item: item.id };
  const pin = v.pins.find((p) => p.kind === 'item' && p.target === target);
  // Pinned before its reminder time: on this phone the pin is the reminder,
  // and it stays away until then.
  const later = pinWaits(v, item);
  if (what === 'pin-item') {
    if (!pin) return null;
    return {
      id, at: later ? item.remindAt : null, ongoing: true,
      channel: later && !item.allDay ? 'reminders' : 'pins', quiet: later ? !!item.allDay : true,
      title: item.name, body, actions: [doneAction(item.id, pin.at)],
      dismiss: { post: listOps([{ id: `unpin-${target}-${pin.at}`, t: 'pin.set', kind: 'item', target, on: false }]) }, tap
    };
  }
  if (what !== 'remind' || !item.remindAt || item.remindAt <= Date.now() - 30 * DAY || later) return null;
  if (!(item.who?.all || item.who?.ids?.includes(v.me))) return null;
  return {
    id, at: item.remindAt, channel: item.allDay ? 'pins' : 'reminders', quiet: !!item.allDay,
    title: item.name, body, actions: [doneAction(item.id, item.remindAt)], tap
  };
}

// Which notifications an op can change (looked up before it's applied).
function touches(v, op) {
  const ids = [];
  const item = (itemId, listId = v.items.get(itemId)?.list) => {
    ids.push(`remind-${itemId}`, `pin-item-${itemId}`);
    if (listId) ids.push(`pin-list-${listId}`);
  };
  const wholeList = (listId) => {
    ids.push(`pin-list-${listId}`);
    for (const i of v.items.values()) if (i.list === listId && (i.remindAt || v.pins.some((p) => p.target === i.id))) item(i.id, listId);
  };
  switch (op.t) {
    case 'item.put': item(op.item.id, op.item.list); break;
    case 'item.check': case 'item.remind': item(op.item); break;
    case 'items.del': op.items.forEach((x) => item(x)); break;
    // (Pinning an item also decides whether its reminder shows by itself.)
    case 'pin.set': ids.push(`pin-${op.kind}-${op.target}`, ...(op.kind === 'item' ? [`remind-${op.target}`] : [])); break;
    case 'list.put': wholeList(op.list.id); break;
    case 'list.del': wholeList(op.list); break;
    case 'section.put': if (op.section.list || v.sections.get(op.section.id)) ids.push(`pin-list-${op.section.list || v.sections.get(op.section.id).list}`); break;
    case 'section.del': if (v.sections.get(op.section)) ids.push(`pin-list-${v.sections.get(op.section).list}`); break;
    default:
  }
  return ids;
}

function planSoon(s) {
  if (!notify.available) return;
  clearTimeout(s.planTimer);
  s.planTimer = setTimeout(() => planNow(s), 250);
}

async function planNow(s) {
  if (s.planning) {
    s.planAgain = true;
    return;
  }
  s.planning = true;
  const sentDirty = [...s.dirty];
  const settled = s.outbox.length === 0;
  const { fetched } = await notify.sync(sentDirty.map((id) => planEntry(s.view, id) || { id, removed: true }));
  // The server knew everything we did when the phone fetched its plan, so
  // the plan is right by itself now: take our overrides back out (or they
  // would hide later changes from other phones).
  if (fetched && settled && s.running && sentDirty.length) {
    for (const id of sentDirty) s.dirty.delete(id);
    save(s);
    s.planAgain = true;
  }
  s.planning = false;
  if (s.planAgain) {
    s.planAgain = false;
    planSoon(s);
  }
}

// Buttons tapped on notifications. Their changes join the outbox, so they
// show here straight away. Most were already sent by the notification
// itself: the server knows those by their id and doesn't apply them twice.
function takeEvents(events) {
  const s = session;
  if (!s) return;
  let added = false;
  for (const ev of events) {
    if (ev.post?.path !== '/api/lists/ops') continue;
    for (const op of ev.post.body?.ops || []) {
      if (s.outbox.some((o) => o.id === op.id)) continue;
      for (const id of touches(s.view, op)) s.dirty.add(id);
      s.outbox.push({ ...op, at: ev.at || Date.now(), button: true });
      added = true;
    }
  }
  if (added) {
    rebuild(s);
    save(s);
  }
  planSoon(s);
  nudge(s);
}

// ---------- start / stop ----------

export function startLists(account, { onAuthLost } = {}) {
  stopLists();
  const key = `ft.lists.${api.serverUrl}|${account.id}`;
  const saved = load(key);
  const s = {
    key, me: account.id, base: saved.base, outbox: saved.outbox, dirty: new Set(saved.dirty),
    online: true, notice: '', running: true, batch: 200, onAuthLost
  };
  session = s;
  rebuild(s);
  s.onVisible = () => {
    if (document.hidden) saveNow(s);
    else {
      notify.drainEvents();
      nudge(s);
    }
  };
  s.onOnline = () => nudge(s);
  document.addEventListener('visibilitychange', s.onVisible);
  window.addEventListener('pagehide', s.onVisible);
  window.addEventListener('online', s.onOnline);
  s.offEvents = notify.onEvents(takeEvents);
  notify.drainEvents();
  planSoon(s);
  loop(s);
}

export function stopLists() {
  const s = session;
  if (!s) return;
  s.running = false;
  saveNow(s);
  clearTimeout(s.planTimer);
  document.removeEventListener('visibilitychange', s.onVisible);
  window.removeEventListener('pagehide', s.onVisible);
  window.removeEventListener('online', s.onOnline);
  s.offEvents?.();
  s.ctrl?.abort();
  s.wake?.();
  session = null;
  snapshot = EMPTY;
  for (const fn of listeners) fn();
}

export function useLists() {
  return useSyncExternalStore((fn) => {
    listeners.add(fn);
    return () => listeners.delete(fn);
  }, () => snapshot);
}

// ---------- reading ----------

const bySort = (a, b) => a.sort - b.sort || (a.id < b.id ? -1 : 1);

export const sortedLists = (v) => [...v.lists.values()].sort(bySort);
export const sectionsOf = (v, listId) => [...v.sections.values()].filter((s) => s.list === listId).sort(bySort);
export const itemsOf = (v, listId) => [...v.items.values()].filter((i) => i.list === listId);
export const isPinned = (v, kind, target) => v.pins.some((p) => p.kind === kind && p.target === target);
// Pinned with a reminder that came after: the pin stays away until that time.
export function pinWaits(v, item) {
  const pin = v.pins.find((p) => p.kind === 'item' && p.target === item.id);
  return !!pin && !!item.remindAt && item.remindAt > pin.at;
}

// Not yet checked, in the order the list shows them: by section, then
// things with no section.
export function openItems(v, listId) {
  const order = new Map(sectionsOf(v, listId).map((s, n) => [s.id, n]));
  const place = (i) => (order.has(i.section) ? order.get(i.section) : Infinity);
  return itemsOf(v, listId).filter((i) => !i.checked).sort((a, b) => place(a) - place(b) || bySort(a, b));
}
export const checkedItems = (v, listId) => itemsOf(v, listId).filter((i) => i.checked).sort((a, b) => (b.checkedAt || 0) - (a.checkedAt || 0));

// "milk x2", "2x milk", "milk (the big one)" -> name + note.
export function parseEntry(raw) {
  let name = String(raw).replace(/\s+/g, ' ').trim();
  let note = '';
  let m;
  if ((m = /^(.*\S)\s*\(([^()]+)\)$/.exec(name))) [, name, note] = m;
  else if ((m = /^(.*\S)\s+[x×]\s?(\d+)$/i.exec(name))) [name, note] = [m[1], `×${m[2]}`];
  else if ((m = /^(\d+)\s?[x×]\s+(.+)$/i.exec(name))) [name, note] = [m[2], `×${m[1]}`];
  return { name: name.slice(0, 120), note: note.slice(0, 200) };
}

const capital = (name) => name.charAt(0).toUpperCase() + name.slice(1);

// Things this family has put on lists before, then the starter groceries.
function known(v, listId) {
  const out = new Map();
  const add = (key, name, source, uses, section) => {
    const cur = out.get(key);
    if (!cur || source < cur.source) out.set(key, { key, name, source, uses, section });
  };
  for (const m of v.memory.values()) add(m.key, m.name, m.list === listId ? 0 : 1, m.list === listId ? m.uses : 0, m.list === listId ? m.section : null);
  if (v.lists.get(listId)?.kind === 'store') for (const c of CATALOG) add(c.key, c.name, 2, 0, null);
  return out;
}

// Suggestions while typing: every word typed must start a word of the name
// ("pea but" finds Peanut butter). This list's own favourites come first.
export function suggest(v, listId, typed, limit = 7) {
  const q = nameKey(parseEntry(typed).name);
  if (!q) return [];
  const words = q.split(' ');
  const onList = new Map(itemsOf(v, listId).map((i) => [nameKey(i.name), i]));
  const hits = [];
  for (const k of known(v, listId).values()) {
    const parts = k.key.split(/[\s-]+/);
    if (!words.every((w) => parts.some((p) => p.startsWith(w)))) continue;
    const item = onList.get(k.key);
    hits.push({ ...k, starts: k.key.startsWith(q) ? 0 : 1, on: item ? (item.checked ? 'checked' : 'open') : null });
  }
  hits.sort((a, b) => a.starts - b.starts || a.source - b.source || b.uses - a.uses || a.key.length - b.key.length || (a.key < b.key ? -1 : 1));
  return hits.slice(0, limit);
}

// Which of this list's sections a new item goes in.
function sectionFor(v, list, name) {
  if (list.kind !== 'store') return null;
  const key = nameKey(name);
  const mine = sectionsOf(v, list.id);
  const remembered = v.memory.get(`${list.id}|${key}`)?.section;
  if (remembered && v.sections.has(remembered)) return remembered;
  const byKey = (k) => (k ? mine.find((s) => s.key === k)?.id : undefined);
  // Where another list keeps it, if this list has the same kind of section.
  for (const m of v.memory.values()) {
    const k = m.key === key && m.section && v.sections.get(m.section)?.key;
    if (k && byKey(k)) return byKey(k);
  }
  return byKey(standardSection(name)) || byKey('other') || null;
}

// ---------- changing ----------

function queue(...ops) {
  const s = session;
  if (!s) return;
  const at = Date.now();
  for (const raw of ops) {
    const op = { id: newId(), at, ...raw };
    if (notify.available) for (const id of touches(s.view, op)) s.dirty.add(id);
    s.outbox.push(op);
  }
  rebuild(s);
  save(s);
  planSoon(s);
  nudge(s);
}

export const lists = {
  // sections: 'standard', or the id of a list to copy them from.
  addList({ name, kind, isPrivate, sections = 'standard' }) {
    const id = newId();
    const v = session.view;
    const ops = [{ t: 'list.put', list: { id, name: name.trim(), kind, private: !!isPrivate, sort: Date.now() } }];
    if (kind === 'store') {
      const from = v.lists.has(sections) ? sectionsOf(v, sections).map((s) => [s.key, s.name]) : SECTIONS;
      from.forEach(([key, sectionName], n) => ops.push({ t: 'section.put', section: { id: newId(), list: id, name: sectionName, key, sort: n + 1 } }));
    }
    queue(...ops);
    return id;
  },
  renameList: (id, name) => name.trim() && queue({ t: 'list.put', list: { id, name: name.trim() } }),
  setPrivate: (id, on) => queue({ t: 'list.put', list: { id, private: !!on } }),
  deleteList: (id) => queue({ t: 'list.del', list: id }),
  orderLists: (ids) => {
    const v = session.view;
    queue(...ids.map((id, n) => ({ id, sort: n + 1 })).filter((x) => v.lists.get(x.id)?.sort !== x.sort).map((x) => ({ t: 'list.put', list: x })));
  },

  // Returns { id, was }: was = 'open' (already on the list), 'checked'
  // (brought back from Checked) or null (new).
  addItem(listId, typed) {
    const v = session.view;
    const list = v.lists.get(listId);
    const entry = parseEntry(typed);
    if (!list || !entry.name) return null;
    const key = nameKey(entry.name);
    const existing = itemsOf(v, listId).find((i) => nameKey(i.name) === key);
    if (existing && !existing.checked) {
      if (entry.note && entry.note !== existing.note) queue({ t: 'item.put', item: { id: existing.id, note: entry.note } });
      return { id: existing.id, was: 'open' };
    }
    if (existing) {
      const ops = [{ t: 'item.check', item: existing.id, checked: false, again: true }];
      if (entry.note !== existing.note) ops.push({ t: 'item.put', item: { id: existing.id, note: entry.note } });
      queue(...ops);
      return { id: existing.id, was: 'checked' };
    }
    const name = known(v, listId).get(key)?.name || capital(entry.name);
    const id = newId();
    queue({ t: 'item.put', item: { id, list: listId, section: sectionFor(v, list, name), name, note: entry.note, sort: Date.now() } });
    return { id, was: null };
  },
  check: (id, checked) => queue({ t: 'item.check', item: id, checked: !!checked }),
  updateItem: (id, patch) => queue({ t: 'item.put', item: { id, ...patch } }),
  deleteItems: (ids) => ids.length && queue({ t: 'items.del', items: ids }),
  clearChecked: (listId) => lists.deleteItems(checkedItems(session.view, listId).map((i) => i.id)),
  // when: a time in ms, or null to remove the reminder. allDay: that whole
  // day (when is the start of it).
  remind: (id, when, who, allDay) => queue({ t: 'item.remind', item: id, when: when || null, allDay: !!(when && allDay), who: who || { ids: [session.me] } }),
  pin: (kind, target, on) => queue({ t: 'pin.set', kind, target, on: !!on }),

  addSection(listId, name) {
    const last = sectionsOf(session.view, listId).at(-1);
    queue({ t: 'section.put', section: { id: newId(), list: listId, name: name.trim(), key: null, sort: (last?.sort || 0) + 1 } });
  },
  renameSection: (id, name) => name.trim() && queue({ t: 'section.put', section: { id, name: name.trim() } }),
  deleteSection: (id) => queue({ t: 'section.del', section: id }),
  orderSections: (ids) => {
    const v = session.view;
    queue(...ids.map((id, n) => ({ id, sort: n + 1 })).filter((x) => v.sections.get(x.id)?.sort !== x.sort).map((x) => ({ t: 'section.put', section: x })));
  },

  clearNotice() {
    if (!session?.notice) return;
    session.notice = '';
    rebuild(session);
  },
  // Look for changes right now (pull-to-refresh style).
  refresh: () => session && nudge(session)
};
