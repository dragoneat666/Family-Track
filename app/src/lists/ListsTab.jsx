import { useState } from 'react';
import { useLists, lists, sortedLists, itemsOf, isPinned } from './store.js';
import { Sheet, Reorder, SyncNote } from './ui.jsx';

// The grown-ups' Lists tab: every list as a card. Tapping one opens it
// full screen (openList, from the grown-up area).
export default function ListsTab({ openList }) {
  const v = useLists();
  const [adding, setAdding] = useState(false);
  const [arranging, setArranging] = useState(false);
  const all = sortedLists(v);

  if (!v.ready) {
    return <p className="muted">{v.online ? 'Getting your lists…' : "Can't reach the server yet. Lists show up here once this device has connected one time."}</p>;
  }

  return (
    <div className="stack">
      <SyncNote v={v} />
      {v.notice && <p className="error" onClick={lists.clearNotice}>{v.notice} (tap to hide)</p>}
      <div className="lists-grid">
        {all.map((l) => {
          const items = itemsOf(v, l.id);
          const left = items.filter((i) => !i.checked).length;
          return (
            <button key={l.id} className={`list-card ${l.kind}`} onClick={() => openList(l.id)}>
              <span className="list-card-emoji">{l.kind === 'store' ? '🛒' : '📝'}</span>
              <span className="list-card-name">{l.name}</span>
              <span className="list-card-count">{left ? `${left} left` : items.length ? 'All checked ✓' : 'Empty'}</span>
              <span className="list-card-flags">{l.private && '🔒'}{isPinned(v, 'list', l.id) && '📌'}</span>
            </button>
          );
        })}
        <button className="list-card new" onClick={() => setAdding(true)}>
          <span className="list-card-emoji">＋</span>
          <span className="list-card-name">New list</span>
        </button>
      </div>
      {all.length > 1 && <button className="btn link" onClick={() => setArranging(true)}>Change the order</button>}
      {!all.length && <p className="muted">No lists yet. Make one for each store, and for anything else you keep track of.</p>}

      {adding && <NewList v={v} onClose={() => setAdding(false)} onMade={(id) => { setAdding(false); openList(id); }} />}
      {arranging && (
        <Sheet title="Order of your lists" onClose={() => setArranging(false)}>
          <Reorder ids={all.map((l) => l.id)} onOrder={lists.orderLists}>
            {(id) => <span className="reorder-label">{v.lists.get(id)?.kind === 'store' ? '🛒' : '📝'} {v.lists.get(id)?.name}</span>}
          </Reorder>
        </Sheet>
      )}
    </div>
  );
}

function NewList({ v, onClose, onMade }) {
  const [name, setName] = useState('');
  const [kind, setKind] = useState('store');
  const [isPrivate, setPrivate] = useState(false);
  const [sections, setSections] = useState('standard');
  const stores = sortedLists(v).filter((l) => l.kind === 'store');

  function make(e) {
    e.preventDefault();
    if (name.trim()) onMade(lists.addList({ name, kind, isPrivate, sections }));
  }

  return (
    <Sheet title="New list" onClose={onClose} closeLabel="Cancel">
      <form className="stack" onSubmit={make}>
        <input autoFocus placeholder={kind === 'store' ? 'Store name, like Costco' : 'Name, like To do or Packing'} value={name} onChange={(e) => setName(e.target.value)} maxLength={80} />
        <div className="segmented">
          <button type="button" className={kind === 'store' ? 'on' : ''} onClick={() => setKind('store')}>🛒 Store</button>
          <button type="button" className={kind === 'plain' ? 'on' : ''} onClick={() => setKind('plain')}>📝 Plain</button>
        </div>
        <p className="muted small">
          {kind === 'store'
            ? 'Sorted by section (Produce, Dairy…), and it suggests groceries as you type.'
            : 'A simple list: to-dos, packing, anything.'}
        </p>
        {kind === 'store' && stores.length > 0 && (
          <label>Sections
            <select value={sections} onChange={(e) => setSections(e.target.value)}>
              <option value="standard">The standard set</option>
              {stores.map((l) => <option key={l.id} value={l.id}>Same as {l.name}</option>)}
            </select>
          </label>
        )}
        <label className="inline check">
          <input type="checkbox" checked={isPrivate} onChange={(e) => setPrivate(e.target.checked)} />
          🔒 Just me (nobody else sees this list)
        </label>
        <button className="btn primary" disabled={!name.trim()}>Make the list</button>
      </form>
    </Sheet>
  );
}
