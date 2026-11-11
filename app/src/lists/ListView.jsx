import { useEffect, useRef, useState } from 'react';
import { notify } from '../notify.js';
import { useLists, lists, sectionsOf, itemsOf, openItems, checkedItems, suggest, parseEntry, isPinned } from './store.js';
import { Sheet, Reorder, SyncNote } from './ui.jsx';

// One list, full screen: add box with suggestions on top, what's left
// (by section for store lists), then what's been checked off.
export default function ListView({ listId, focusItem, onExit }) {
  const v = useLists();
  const list = v.lists.get(listId);
  const [text, setText] = useState('');
  const [said, setSaid] = useState('');
  const [flash, setFlash] = useState(focusItem || null);
  const [sheet, setSheet] = useState(null); // { item } | 'menu' | 'sections'
  const [showChecked, setShowChecked] = useState(true);
  const input = useRef(null);
  const sayTimer = useRef(null);

  useEffect(() => {
    if (!flash) return undefined;
    document.querySelector(`[data-item="${flash}"]`)?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    const t = setTimeout(() => setFlash(null), 1800);
    return () => clearTimeout(t);
  }, [flash]);
  useEffect(() => () => clearTimeout(sayTimer.current), []);

  if (!list) {
    return (
      <div className="list-screen">
        <header className="list-header"><button data-back className="btn" onClick={onExit}>← Lists</button></header>
        <p className="muted list-empty">{v.ready ? 'This list is gone. Someone deleted it, or made it their own.' : 'Getting your lists…'}</p>
      </div>
    );
  }

  function say(msg) {
    clearTimeout(sayTimer.current);
    setSaid(msg);
    sayTimer.current = setTimeout(() => setSaid(''), 2500);
  }

  function add(typed) {
    const r = lists.addItem(listId, typed);
    if (!r) return;
    setText('');
    if (r.was === 'open') say('Already on the list');
    else if (r.was === 'checked') say('Back on the list');
    else setSaid('');
    setFlash(r.id);
    input.current?.focus();
  }

  function clearChecked() {
    const n = checkedItems(v, listId).length;
    if (window.confirm(`Clear ${n} checked ${n === 1 ? 'item' : 'items'} from ${list.name}?`)) lists.clearChecked(listId);
  }

  const isStore = list.kind === 'store';
  const sections = sectionsOf(v, listId);
  const open = openItems(v, listId);
  const checked = checkedItems(v, listId);
  const hits = suggest(v, listId, text);
  const typedNote = parseEntry(text).note;
  const groups = isStore
    ? [
      ...sections.map((s) => ({ key: s.id, name: s.name, items: open.filter((i) => i.section === s.id) })),
      { key: 'none', name: sections.length ? 'No section' : '', items: open.filter((i) => !v.sections.has(i.section)) }
    ].filter((g) => g.items.length)
    : [{ key: 'all', name: '', items: open }].filter((g) => g.items.length);

  const row = (i) => (
    <div key={i.id} data-item={i.id} className={`li-row${i.checked ? ' checked' : ''}${flash === i.id ? ' flash' : ''}`}>
      <button className="li-main" onClick={() => lists.check(i.id, !i.checked)} aria-label={`${i.checked ? 'Put back' : 'Check off'} ${i.name}`}>
        <span className="li-box">{i.checked ? '✓' : ''}</span>
        <span className="li-name">{i.name}{i.note && <span className="li-note"> {i.note}</span>}</span>
        {!i.checked && isPinned(v, 'item', i.id) && <span className="li-flag">📌</span>}
        {!i.checked && i.remindAt && <span className={i.remindAt < Date.now() ? 'li-flag late' : 'li-flag'}>⏰ {shortTime(i.remindAt)}</span>}
      </button>
      <button className="li-more" onClick={() => setSheet({ item: i.id })} aria-label={`More about ${i.name}`}>⋯</button>
    </div>
  );

  return (
    <div className="list-screen">
      <header className="list-header">
        <button data-back className="btn" onClick={onExit}>← Lists</button>
        <h2>{list.name} {list.private && '🔒'}{isPinned(v, 'list', listId) && '📌'}</h2>
        <button className="btn" onClick={() => setSheet('menu')} aria-label="List options">⋯</button>
      </header>
      <SyncNote v={v} />
      {v.notice && <p className="error list-pad" onClick={lists.clearNotice}>{v.notice} (tap to hide)</p>}

      <form className="list-add" onSubmit={(e) => { e.preventDefault(); add(text); }}>
        <input
          ref={input} value={text} onChange={(e) => setText(e.target.value)} maxLength={160}
          placeholder={`Add to ${list.name}…`} enterKeyHint="done" autoComplete="off" autoCapitalize="sentences"
        />
        <button className="btn primary" disabled={!text.trim()}>Add</button>
        {hits.length > 0 && (
          <div className="list-suggest">
            {hits.map((h) => (
              // pointerdown, so the keyboard stays up for the next thing
              <button type="button" key={h.key} onPointerDown={(e) => { e.preventDefault(); add(typedNote ? `${h.name} (${typedNote})` : h.name); }}>
                {h.name}
                {h.on && <span className="muted small"> · {h.on === 'open' ? 'on the list' : 'checked off'}</span>}
              </button>
            ))}
          </div>
        )}
      </form>
      <div className="list-said">{said}</div>

      <main className="list-body">
        {!open.length && !checked.length && <p className="muted list-empty">Nothing here yet. Type the first thing above.</p>}
        {!open.length && checked.length > 0 && <p className="muted list-empty">Everything is checked off 🎉</p>}
        {groups.map((g) => (
          <section key={g.key} className="li-group">
            {g.name && <h4>{g.name}</h4>}
            <div className="li-rows">{g.items.map(row)}</div>
          </section>
        ))}
        {checked.length > 0 && (
          <section className="li-group checked-group">
            <div className="row spread">
              <button className="btn link" onClick={() => setShowChecked(!showChecked)}>{showChecked ? '▾' : '▸'} Checked ({checked.length})</button>
              <button className="btn small" onClick={clearChecked}>Clear checked</button>
            </div>
            {showChecked && <div className="li-rows">{checked.map(row)}</div>}
          </section>
        )}
      </main>

      {sheet?.item && v.items.get(sheet.item) && <ItemSheet v={v} list={list} item={v.items.get(sheet.item)} onClose={() => setSheet(null)} />}
      {sheet === 'menu' && <ListMenu v={v} list={list} onClose={() => setSheet(null)} onSections={() => setSheet('sections')} onClear={clearChecked} onDeleted={onExit} />}
      {sheet === 'sections' && <SectionsSheet v={v} list={list} onClose={() => setSheet(null)} />}
    </div>
  );
}

// "5:00 PM" today, "Tue 5:00 PM" this week, "Nov 21, 5:00 PM" otherwise.
export function shortTime(ms) {
  const d = new Date(ms);
  const time = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const days = Math.round((new Date(d).setHours(0, 0, 0, 0) - new Date().setHours(0, 0, 0, 0)) / 86400000);
  if (days === 0) return time;
  if (days === 1) return `tomorrow ${time}`;
  if (days === -1) return `yesterday ${time}`;
  if (days > 1 && days < 7) return `${d.toLocaleDateString([], { weekday: 'short' })} ${time}`;
  return `${d.toLocaleDateString([], { month: 'short', day: 'numeric' })}, ${time}`;
}

// <input type="datetime-local"> speaks "2026-11-21T17:00" in the phone's own time.
const pad = (n) => String(n).padStart(2, '0');
const toField = (ms) => {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

function quickTimes() {
  const now = new Date();
  const at = (addDays, hour) => new Date(now.getFullYear(), now.getMonth(), now.getDate() + addDays, hour).getTime();
  const out = [['In 1 hour', Math.ceil((now.getTime() + 3600000) / 300000) * 300000]];
  if (now.getHours() < 17) out.push(['Tonight 6 PM', at(0, 18)]);
  out.push(['Tomorrow 8 AM', at(1, 8)]);
  return out;
}

function ItemSheet({ v, list, item, onClose }) {
  const [warn, setWarn] = useState('');
  const pinned = isPinned(v, 'item', item.id);
  const others = v.people.filter((p) => p.id !== v.me);
  const who = item.who || { ids: [v.me] };
  const gets = (id) => !!who.all || who.ids?.includes(id);

  // Pins and reminders are Android notifications: make sure they're allowed.
  async function allowed() {
    if (!notify.available || await notify.allow()) return true;
    setWarn('Notifications are turned off for Family Track. Turn them on in Android Settings → Apps → Family Track → Notifications.');
    return false;
  }
  async function pin(on) {
    setWarn('');
    if (on && !(await allowed())) return;
    lists.pin('item', item.id, on);
  }
  async function remind(when, nextWho = who) {
    setWarn('');
    if (when) await allowed();
    lists.remind(item.id, when, nextWho);
  }
  function toggleWho(id) {
    const ids = v.people.map((p) => p.id).filter((p) => (p === id ? !gets(p) : gets(p)));
    if (ids.length) remind(item.remindAt, { ids });
  }
  function remove() {
    lists.deleteItems([item.id]);
    onClose();
  }

  return (
    <Sheet title={item.name} onClose={onClose}>
      <label>Name
        <input defaultValue={item.name} maxLength={120} onBlur={(e) => e.target.value.trim() && e.target.value.trim() !== item.name && lists.updateItem(item.id, { name: e.target.value.trim() })} />
      </label>
      <label>Note
        <input defaultValue={item.note} maxLength={200} placeholder="How many, which kind…" onBlur={(e) => e.target.value.trim() !== item.note && lists.updateItem(item.id, { note: e.target.value.trim() })} />
      </label>
      {list.kind === 'store' && (
        <label>Section
          <select value={v.sections.has(item.section) ? item.section : ''} onChange={(e) => lists.updateItem(item.id, { section: e.target.value || null })}>
            <option value="">No section</option>
            {sectionsOf(v, list.id).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
          <span className="muted small">{list.name} remembers where it goes next time.</span>
        </label>
      )}

      {!item.checked && (
        <div className="stack remind-box">
          <b>Remind me</b>
          {notify.available ? (
            <label className="inline check">
              <input type="checkbox" checked={pinned} onChange={(e) => pin(e.target.checked)} />
              📌 Pin to this phone's notifications until it's done
            </label>
          ) : (
            <p className="muted small">📌 Pinning to notifications is in the Android app.</p>
          )}
          <label>⏰ At a time
            <div className="row">
              <input type="datetime-local" value={item.remindAt ? toField(item.remindAt) : ''} onChange={(e) => remind(e.target.value ? new Date(e.target.value).getTime() : null)} />
              {item.remindAt && <button type="button" className="btn small" onClick={() => remind(null)}>Clear</button>}
            </div>
          </label>
          <div className="row wrap">
            {quickTimes().map(([label, when]) => <button type="button" key={label} className="btn small" onClick={() => remind(when)}>{label}</button>)}
          </div>
          {item.remindAt && !list.private && others.length > 0 && (
            <div className="row wrap">
              <span className="small">Who gets it:</span>
              {v.people.map((p) => (
                <label key={p.id} className="inline check small">
                  <input type="checkbox" checked={gets(p.id)} onChange={() => toggleWho(p.id)} />
                  {p.emoji} {p.id === v.me ? 'Me' : p.name}
                </label>
              ))}
            </div>
          )}
          {item.remindAt && !notify.available && <p className="muted small">The reminder shows up on phones with the Android app.</p>}
          {warn && <p className="error small">{warn}</p>}
        </div>
      )}

      <button className="btn danger" onClick={remove}>Delete from the list</button>
    </Sheet>
  );
}

function ListMenu({ v, list, onClose, onSections, onClear, onDeleted }) {
  const [warn, setWarn] = useState('');
  const pinned = isPinned(v, 'list', list.id);
  const hasChecked = itemsOf(v, list.id).some((i) => i.checked);

  async function pin(on) {
    setWarn('');
    if (on && !(await notify.allow())) {
      setWarn('Notifications are turned off for Family Track. Turn them on in Android Settings → Apps → Family Track → Notifications.');
      return;
    }
    lists.pin('list', list.id, on);
  }
  function remove() {
    const n = itemsOf(v, list.id).length;
    if (!window.confirm(`Delete the list ${list.name}${n ? ` and the ${n} ${n === 1 ? 'thing' : 'things'} on it` : ''}?${list.private ? '' : ' It goes away for everyone.'}`)) return;
    lists.deleteList(list.id);
    onDeleted();
  }

  return (
    <Sheet title="This list" onClose={onClose}>
      <label>Name
        <input defaultValue={list.name} maxLength={80} onBlur={(e) => e.target.value.trim() !== list.name && lists.renameList(list.id, e.target.value)} />
      </label>
      {notify.available && (
        <label className="inline check">
          <input type="checkbox" checked={pinned} onChange={(e) => pin(e.target.checked)} />
          📌 Pin to this phone's notifications (shows what's left)
        </label>
      )}
      {warn && <p className="error small">{warn}</p>}
      {list.mine ? (
        <label className="inline check">
          <input type="checkbox" checked={list.private} onChange={(e) => lists.setPrivate(list.id, e.target.checked)} />
          🔒 Just me (nobody else sees this list)
        </label>
      ) : (
        <p className="muted small">Shared with every grown-up. Only the person who made it can make it "Just me".</p>
      )}
      {list.kind === 'store' && <button className="btn" onClick={onSections}>🗂 Sections and their order</button>}
      <button className="btn" disabled={!hasChecked} onClick={() => { onClose(); onClear(); }}>🧹 Clear checked</button>
      <button className="btn danger" onClick={remove}>Delete this list</button>
    </Sheet>
  );
}

function SectionsSheet({ v, list, onClose }) {
  const [name, setName] = useState('');
  const sections = sectionsOf(v, list.id);
  const count = (id) => itemsOf(v, list.id).filter((i) => i.section === id).length;

  function add(e) {
    e.preventDefault();
    if (!name.trim()) return;
    lists.addSection(list.id, name);
    setName('');
  }
  function remove(s) {
    const n = count(s.id);
    if (n && !window.confirm(`Delete the section ${s.name}? Its ${n} ${n === 1 ? 'thing stays' : 'things stay'} on the list, without a section.`)) return;
    lists.deleteSection(s.id);
  }

  return (
    <Sheet title={`${list.name}: sections`} onClose={onClose}>
      <p className="muted small">Drag ≡ into the order you walk the store. Rename them any way you like: things you move into a section are remembered for next time.</p>
      <Reorder ids={sections.map((s) => s.id)} onOrder={lists.orderSections}>
        {(id) => {
          const s = v.sections.get(id);
          if (!s) return null;
          return (
            <>
              <input key={s.name} defaultValue={s.name} maxLength={60} onBlur={(e) => e.target.value.trim() !== s.name && lists.renameSection(s.id, e.target.value)} />
              <button type="button" className="btn small danger" onClick={() => remove(s)} aria-label={`Delete ${s.name}`}>🗑</button>
            </>
          );
        }}
      </Reorder>
      <form className="row" onSubmit={add}>
        <input placeholder="New section" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} />
        <button className="btn" disabled={!name.trim()}>Add</button>
      </form>
    </Sheet>
  );
}
