import express from 'express';
import { db } from './db.js';
import { httpError } from './auth.js';

// Shared lists for the grown-ups: a list per store, to-dos, anything.
//
// Phones keep their own copy and work without the server. They send what
// changed as small "ops" (add this item, check that one) and ask for
// everything that changed since the last "rev" they saw. Ops are applied in
// the order they arrive, so two people editing at once both get their way
// unless they change the very same thing, where the later one wins.

const ID = /^[a-z0-9]{8,32}$/;
const DAY = 24 * 60 * 60 * 1000;
const KEEP_DELETED = 90 * DAY; // how long markers of deleted rows are kept
const KEEP_OPS = 30 * DAY;
const KEEP_REMINDERS = 30 * DAY; // a reminder nobody dealt with stays in the plan this long

const text = (v, max) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const num = (v, fallback) => (Number.isFinite(Number(v)) ? Number(v) : fallback);
const id = (v, what) => {
  if (!ID.test(String(v ?? ''))) throw httpError(400, `Bad ${what} id`);
  return String(v);
};
export const memoryKey = (name) => String(name).trim().toLowerCase().replace(/\s+/g, ' ');

const syncState = () => db.prepare('SELECT rev, floor FROM list_sync WHERE id = 1').get();
const nextRev = () => db.prepare('UPDATE list_sync SET rev = rev + 1 WHERE id = 1 RETURNING rev').get().rev;

const canSee = (list, account) => !!list && !list.deleted && (!list.private || list.owner_id === account.id);
const listRow = (listId) => db.prepare('SELECT * FROM lists WHERE id = ?').get(listId);
const itemRow = (itemId) => db.prepare('SELECT * FROM list_items WHERE id = ?').get(itemId);

// The list an op is about, as long as this person may change it.
function openList(listId, account) {
  const list = listRow(listId);
  if (!canSee(list, account)) throw httpError(404, 'That list is gone');
  return list;
}
function openItem(itemId, account) {
  const item = itemRow(itemId);
  if (!item || item.deleted) throw httpError(404, 'That item is gone');
  return { item, list: openList(item.list_id, account) };
}

function cleanWho(who, account) {
  if (who?.all) return { all: true };
  const adults = new Set(db.prepare('SELECT id FROM profiles WHERE is_parent = 1 AND is_test = 0').all().map((p) => p.id));
  const ids = [...new Set((Array.isArray(who?.ids) ? who.ids : []).map(Number))].filter((n) => adults.has(n));
  return { ids: ids.length ? ids : [account.id] };
}

function remember(list, name, sectionId, used, at, rev) {
  if (list.kind !== 'store') return;
  const key = memoryKey(name);
  if (!key) return;
  db.prepare(`INSERT INTO list_memory (list_id, key, name, section_id, uses, used_at, rev) VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(list_id, key) DO UPDATE SET name = excluded.name, rev = excluded.rev,
      section_id = CASE WHEN ?4 IS NULL THEN section_id ELSE ?4 END,
      uses = uses + ?5, used_at = CASE WHEN ?5 > 0 THEN ?6 ELSE used_at END`)
    .run(list.id, key, name, sectionId ?? null, used ? 1 : 0, used ? at : null, rev);
}

const dropPins = (kind, target) => db.prepare('DELETE FROM list_pins WHERE kind = ? AND target = ?').run(kind, target);

// Each op gets { account, device, rev, at } and throws to refuse.
const OPS = {
  // Make a list, or change its name / order / "Just me".
  'list.put'(op, ctx) {
    const l = op.list || {};
    const listId = id(l.id, 'list');
    const row = listRow(listId);
    if (!row) {
      const name = text(l.name, 80);
      if (!name) throw httpError(400, 'A list needs a name');
      db.prepare('INSERT INTO lists (id, name, kind, owner_id, private, sort, rev, changed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
        .run(listId, name, l.kind === 'store' ? 'store' : 'plain', ctx.account.id, l.private ? 1 : 0, num(l.sort, ctx.at), ctx.rev, ctx.at);
      return;
    }
    openList(listId, ctx.account);
    const isPrivate = l.private == null ? row.private : (l.private ? 1 : 0);
    // Only its owner can make a list private (or it would vanish for them).
    if (isPrivate && !row.private && row.owner_id !== ctx.account.id) throw httpError(403, 'Only the person who made a list can make it "Just me"');
    db.prepare('UPDATE lists SET name = ?, private = ?, sort = ?, rev = ?, changed_at = ? WHERE id = ?')
      .run(text(l.name, 80) || row.name, isPrivate, num(l.sort, row.sort), ctx.rev, ctx.at, listId);
    if (isPrivate !== row.private) {
      // Everything in it has to reach (or leave) the other phones.
      for (const table of ['list_sections', 'list_items', 'list_memory']) db.prepare(`UPDATE ${table} SET rev = ? WHERE list_id = ?`).run(ctx.rev, listId);
      if (isPrivate) db.prepare("DELETE FROM list_pins WHERE profile_id != ? AND ((kind = 'list' AND target = ?) OR (kind = 'item' AND target IN (SELECT id FROM list_items WHERE list_id = ?)))").run(ctx.account.id, listId, listId);
    }
  },

  'list.del'(op, ctx) {
    const list = openList(id(op.list, 'list'), ctx.account);
    db.prepare("DELETE FROM list_pins WHERE (kind = 'list' AND target = ?) OR (kind = 'item' AND target IN (SELECT id FROM list_items WHERE list_id = ?))").run(list.id, list.id);
    db.prepare('UPDATE lists SET deleted = 1, rev = ?, changed_at = ? WHERE id = ?').run(ctx.rev, ctx.at, list.id);
    for (const table of ['list_sections', 'list_items']) db.prepare(`UPDATE ${table} SET deleted = 1, rev = ?, changed_at = ? WHERE list_id = ? AND deleted = 0`).run(ctx.rev, ctx.at, list.id);
    db.prepare('DELETE FROM list_memory WHERE list_id = ?').run(list.id);
  },

  'section.put'(op, ctx) {
    const s = op.section || {};
    const sectionId = id(s.id, 'section');
    const row = db.prepare('SELECT * FROM list_sections WHERE id = ?').get(sectionId);
    if (!row) {
      const list = openList(id(s.list, 'list'), ctx.account);
      const name = text(s.name, 60);
      if (!name) throw httpError(400, 'A section needs a name');
      db.prepare('INSERT INTO list_sections (id, list_id, name, key, sort, rev, changed_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .run(sectionId, list.id, name, text(s.key, 40) || null, num(s.sort, ctx.at), ctx.rev, ctx.at);
      return;
    }
    if (row.deleted) throw httpError(404, 'That section is gone');
    openList(row.list_id, ctx.account);
    db.prepare('UPDATE list_sections SET name = ?, sort = ?, rev = ?, changed_at = ? WHERE id = ?')
      .run(text(s.name, 60) || row.name, num(s.sort, row.sort), ctx.rev, ctx.at, sectionId);
  },

  // Its items stay on the list, just without a section.
  'section.del'(op, ctx) {
    const row = db.prepare('SELECT * FROM list_sections WHERE id = ? AND deleted = 0').get(id(op.section, 'section'));
    if (!row) return;
    openList(row.list_id, ctx.account);
    db.prepare('UPDATE list_sections SET deleted = 1, rev = ?, changed_at = ? WHERE id = ?').run(ctx.rev, ctx.at, row.id);
    db.prepare('UPDATE list_items SET section_id = NULL, rev = ?, changed_at = ? WHERE section_id = ? AND deleted = 0').run(ctx.rev, ctx.at, row.id);
    db.prepare('UPDATE list_memory SET section_id = NULL, rev = ? WHERE section_id = ?').run(ctx.rev, row.id);
  },

  // Add an item, or change its name / note / section / place.
  'item.put'(op, ctx) {
    const i = op.item || {};
    const itemId = id(i.id, 'item');
    const row = itemRow(itemId);
    const section = i.section == null ? null : id(i.section, 'section');
    if (!row) {
      const list = openList(id(i.list, 'list'), ctx.account);
      const name = text(i.name, 120);
      if (!name) throw httpError(400, 'An item needs a name');
      db.prepare('INSERT INTO list_items (id, list_id, section_id, name, note, sort, added_by, rev, changed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .run(itemId, list.id, section, name, text(i.note, 200), num(i.sort, ctx.at), ctx.account.id, ctx.rev, ctx.at);
      remember(list, name, section, true, ctx.at, ctx.rev);
      return;
    }
    const { item, list } = openItem(itemId, ctx.account);
    const name = text(i.name, 120) || item.name;
    const moved = 'section' in i && section !== item.section_id;
    db.prepare('UPDATE list_items SET name = ?, note = ?, section_id = ?, sort = ?, rev = ?, changed_at = ? WHERE id = ?')
      .run(name, 'note' in i ? text(i.note, 200) : item.note, 'section' in i ? section : item.section_id, num(i.sort, item.sort), ctx.rev, ctx.at, itemId);
    // Moving it teaches this list where it goes next time.
    if (moved && section) remember(list, name, section, false, ctx.at, ctx.rev);
  },

  // again: it was put back on the list from Checked (counts as used again).
  'item.check'(op, ctx) {
    const { item, list } = openItem(id(op.item, 'item'), ctx.account);
    const checked = op.checked ? 1 : 0;
    db.prepare('UPDATE list_items SET checked = ?, checked_at = ?, checked_by = ?, rev = ?, changed_at = ? WHERE id = ?')
      .run(checked, checked ? ctx.at : null, checked ? ctx.account.id : null, ctx.rev, ctx.at, item.id);
    if (checked) dropPins('item', item.id);
    else if (op.again) {
      // Back on the list for another round: its old reminder doesn't apply.
      db.prepare('UPDATE list_items SET remind_at = NULL, remind_who = NULL WHERE id = ?').run(item.id);
      remember(list, item.name, null, true, ctx.at, ctx.rev);
    }
  },

  'items.del'(op, ctx) {
    for (const raw of (Array.isArray(op.items) ? op.items : []).slice(0, 2000)) {
      const item = itemRow(id(raw, 'item'));
      if (!item || item.deleted || !canSee(listRow(item.list_id), ctx.account)) continue;
      db.prepare('UPDATE list_items SET deleted = 1, rev = ?, changed_at = ? WHERE id = ?').run(ctx.rev, ctx.at, item.id);
      dropPins('item', item.id);
    }
  },

  // when: the time to remind at (ms), or null for no reminder.
  'item.remind'(op, ctx) {
    const { item } = openItem(id(op.item, 'item'), ctx.account);
    const when = op.when == null ? null : Math.round(num(op.when, 0)) || null;
    db.prepare('UPDATE list_items SET remind_at = ?, remind_who = ?, rev = ?, changed_at = ? WHERE id = ?')
      .run(when, when ? JSON.stringify(cleanWho(op.who, ctx.account)) : null, ctx.rev, ctx.at, item.id);
  },

  // Pin an item or a whole list to this phone's notifications.
  'pin.set'(op, ctx) {
    const kind = op.kind === 'list' ? 'list' : 'item';
    const target = id(op.target, kind);
    if (!op.on) {
      db.prepare('DELETE FROM list_pins WHERE device_id = ? AND profile_id = ? AND kind = ? AND target = ?').run(ctx.device.id, ctx.account.id, kind, target);
      return;
    }
    if (kind === 'list') openList(target, ctx.account);
    else openItem(target, ctx.account);
    db.prepare('INSERT INTO list_pins (device_id, profile_id, kind, target, at) VALUES (?, ?, ?, ?, ?) ON CONFLICT DO NOTHING')
      .run(ctx.device.id, ctx.account.id, kind, target, ctx.at);
  }
};

function applyOps(ops, account, device) {
  const results = [];
  const now = Date.now();
  db.transaction(() => {
    for (const op of ops) {
      const opId = text(op?.id, 80);
      if (!opId || !OPS[op.t]) {
        results.push({ id: opId, error: 'Unknown change' });
        continue;
      }
      if (db.prepare('SELECT 1 FROM list_ops WHERE id = ?').get(opId)) {
        results.push({ id: opId, ok: true });
        continue;
      }
      // When it was done on the phone, unless its clock is off.
      const at = Number.isFinite(op.at) && op.at <= now + 5 * 60 * 1000 && op.at > now - 60 * DAY ? Math.round(op.at) : now;
      db.exec('SAVEPOINT list_op');
      try {
        OPS[op.t](op, { account, device, at, rev: nextRev() });
        db.prepare('INSERT INTO list_ops (id, at) VALUES (?, ?)').run(opId, now);
        db.exec('RELEASE list_op');
        results.push({ id: opId, ok: true });
      } catch (e) {
        db.exec('ROLLBACK TO list_op');
        db.exec('RELEASE list_op');
        if (!e.status) console.error('list op failed', op.t, e);
        results.push({ id: opId, error: e.status ? e.message : 'That change could not be saved' });
      }
    }
  })();
  return results;
}

const toSection = (s) => (s.deleted ? { id: s.id, deleted: true } : { id: s.id, list: s.list_id, name: s.name, key: s.key, sort: s.sort });
const toItem = (i) => (i.deleted ? { id: i.id, deleted: true } : {
  id: i.id, list: i.list_id, section: i.section_id, name: i.name, note: i.note, sort: i.sort,
  checked: !!i.checked, checkedAt: i.checked_at, remindAt: i.remind_at, who: i.remind_who ? JSON.parse(i.remind_who) : null
});

// Everything this person can see that changed after `since`. A phone that's
// too far behind (or ahead: the server was restored from a backup) gets the
// lot, marked full, and replaces its copy.
function changes(account, device, since) {
  const { rev, floor } = syncState();
  const full = !Number.isFinite(since) || since < floor || since > rev;
  const from = full ? -1 : since;
  const visible = new Map(db.prepare('SELECT * FROM lists').all().map((l) => [l.id, canSee(l, account)]));
  const rows = (table) => db.prepare(`SELECT * FROM ${table} WHERE rev > ?${full ? ' AND deleted = 0' : ''}`).all(from);

  const lists = [];
  for (const l of rows('lists')) {
    if (visible.get(l.id)) lists.push({ id: l.id, name: l.name, kind: l.kind, private: !!l.private, mine: l.owner_id === account.id, sort: l.sort });
    else if (!full) lists.push({ id: l.id, deleted: true });
  }
  return {
    rev,
    full,
    lists,
    sections: rows('list_sections').filter((s) => visible.get(s.list_id)).map(toSection),
    items: rows('list_items').filter((i) => visible.get(i.list_id)).map(toItem),
    memory: db.prepare('SELECT * FROM list_memory WHERE rev > ?').all(from).filter((m) => visible.get(m.list_id))
      .map((m) => ({ list: m.list_id, key: m.key, name: m.name, section: m.section_id, uses: m.uses, usedAt: m.used_at })),
    pins: db.prepare('SELECT kind, target, at FROM list_pins WHERE device_id = ? AND profile_id = ?').all(device.id, account.id),
    people: db.prepare('SELECT id, name, emoji, color FROM profiles WHERE is_parent = 1 AND is_test = 0 ORDER BY sort, id').all(),
    me: account.id
  };
}

// Phones waiting to hear about the next change (a held-open request each).
const waiting = new Set();
function wake() {
  for (const w of [...waiting]) w.send();
}

export const listsRouter = express.Router();

listsRouter.get('/sync', (req, res) => {
  const since = req.query.since == null ? NaN : Number(req.query.since);
  const wait = Math.min(55, Math.max(0, Number(req.query.wait) || 0));
  const reply = () => res.json(changes(req.account, req.device, since));
  if (!wait || !Number.isFinite(since) || since !== syncState().rev) return reply();
  const w = {
    send() {
      clearTimeout(timer);
      waiting.delete(w);
      if (!res.headersSent && !res.destroyed) reply();
    }
  };
  const timer = setTimeout(w.send, wait * 1000);
  waiting.add(w);
  res.on('close', () => {
    clearTimeout(timer);
    waiting.delete(w);
  });
});

listsRouter.post('/ops', (req, res) => {
  const body = req.body || {};
  const ops = Array.isArray(body.ops) ? body.ops.slice(0, 1000) : [];
  const results = applyOps(ops, req.account, req.device);
  res.json({ results, ...changes(req.account, req.device, body.since == null ? NaN : Number(body.since)) });
  wake();
});

// ---------- notifications ----------
// What this phone should show for lists: reminders set on items, and
// whatever is pinned on it. The app turns these into Android notifications
// (see notify.js in the app); `post` is what tapping a button sends back.

const listOps = (ops) => ({ path: '/api/lists/ops', body: { ops } });
const doneAction = (itemId, stamp) => ({
  id: 'done', title: 'Done',
  post: listOps([{ id: `done-${itemId}-${stamp}`, t: 'item.check', item: itemId, checked: true }])
});

export function listPlan(account, device) {
  if (!account.is_parent || account.is_test) return [];
  const entries = [];
  const lists = new Map(db.prepare('SELECT * FROM lists WHERE deleted = 0').all().filter((l) => canSee(l, account)).map((l) => [l.id, l]));
  const open = (listId) => db.prepare(`
    SELECT i.* FROM list_items i LEFT JOIN list_sections s ON s.id = i.section_id AND s.deleted = 0
    WHERE i.list_id = ? AND i.deleted = 0 AND i.checked = 0
    ORDER BY s.id IS NULL, s.sort, i.sort, i.id`).all(listId);

  // Reminders stay in the plan after their time, until the item is checked
  // off: that keeps the notification up, and lets a phone that was off show
  // it late (the phone decides how late is too late).
  const due = db.prepare('SELECT * FROM list_items WHERE deleted = 0 AND checked = 0 AND remind_at > ?').all(Date.now() - KEEP_REMINDERS);
  for (const i of due) {
    const list = lists.get(i.list_id);
    const who = i.remind_who ? JSON.parse(i.remind_who) : {};
    if (!list || !(who.all || who.ids?.includes(account.id))) continue;
    entries.push({
      id: `remind-${i.id}`, at: i.remind_at, channel: 'reminders',
      title: i.name, body: [i.note, list.name].filter(Boolean).join(' · '),
      actions: [doneAction(i.id, i.remind_at)],
      tap: { screen: 'list', list: list.id, item: i.id }
    });
  }

  for (const pin of db.prepare('SELECT * FROM list_pins WHERE device_id = ? AND profile_id = ? ORDER BY at').all(device.id, account.id)) {
    // Swiping a pin away unpins it.
    const dismiss = { post: listOps([{ id: `unpin-${pin.target}-${pin.at}`, t: 'pin.set', kind: pin.kind, target: pin.target, on: false }]) };
    if (pin.kind === 'item') {
      const i = itemRow(pin.target);
      const list = i && !i.deleted && !i.checked && lists.get(i.list_id);
      if (!list) continue;
      entries.push({
        id: `pin-item-${i.id}`, at: null, ongoing: true, channel: 'pins',
        title: i.name, body: [i.note, list.name].filter(Boolean).join(' · '),
        actions: [doneAction(i.id, pin.at)], dismiss,
        tap: { screen: 'list', list: list.id, item: i.id }
      });
    } else {
      const list = lists.get(pin.target);
      if (!list) continue;
      const left = open(list.id);
      entries.push({
        id: `pin-list-${list.id}`, at: null, ongoing: true, channel: 'pins',
        title: list.name,
        body: left.length ? `${left.length} left: ${left.slice(0, 4).map((i) => i.name).join(', ')}${left.length > 4 ? '…' : ''}` : 'All done ✓',
        lines: left.slice(0, 8).map((i) => (i.note ? `${i.name} (${i.note})` : i.name)).concat(left.length > 8 ? [`+ ${left.length - 8} more`] : []),
        dismiss,
        tap: { screen: 'list', list: list.id }
      });
    }
  }
  return entries;
}

// ---------- housekeeping ----------

// An account is going away: its "Just me" lists go with it.
export function dropPrivateLists(profileId) {
  const mine = db.prepare('SELECT id FROM lists WHERE private = 1 AND owner_id = ? AND deleted = 0').all(profileId);
  if (!mine.length) return;
  db.transaction(() => {
    const rev = nextRev();
    const at = Date.now();
    for (const l of mine) {
      db.prepare('UPDATE lists SET deleted = 1, rev = ?, changed_at = ? WHERE id = ?').run(rev, at, l.id);
      for (const table of ['list_sections', 'list_items']) db.prepare(`UPDATE ${table} SET deleted = 1, rev = ?, changed_at = ? WHERE list_id = ?`).run(rev, at, l.id);
      db.prepare('DELETE FROM list_memory WHERE list_id = ?').run(l.id);
    }
  })();
  wake();
}

// Forget markers of long-deleted rows. Phones that haven't synced since
// before then get a full copy next time (see `floor` in changes()).
function prune() {
  const before = Date.now() - KEEP_DELETED;
  db.transaction(() => {
    let floor = syncState().floor;
    for (const table of ['list_items', 'list_sections', 'lists']) {
      const top = db.prepare(`SELECT MAX(rev) AS rev FROM ${table} WHERE deleted = 1 AND changed_at < ?`).get(before).rev;
      if (top == null) continue;
      floor = Math.max(floor, top);
      db.prepare(`DELETE FROM ${table} WHERE deleted = 1 AND changed_at < ?`).run(before);
    }
    db.prepare('UPDATE list_sync SET floor = ? WHERE id = 1').run(floor);
    db.prepare('DELETE FROM list_ops WHERE at < ?').run(Date.now() - KEEP_OPS);
  })();
}
prune();
setInterval(prune, DAY).unref();
