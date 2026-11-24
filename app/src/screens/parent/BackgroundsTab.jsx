import { useEffect, useRef, useState } from 'react';
import { api } from '../../api.js';
import { useParentCall } from './useParentCall.js';
import SceneThumb from '../../scenes/SceneThumb.jsx';

// Backgrounds: picture puzzles the kids put together (one piece per brush),
// then stand their characters in front of. They're kept in groups
// ("K-pop Demon Hunters", "Transformers"); a kid picks a background from a
// group. Make a group, then add backgrounds to it.
export default function BackgroundsTab({ onAuthLost }) {
  const { error, setError, call } = useParentCall(onAuthLost);
  const [list, setList] = useState(null); // the backgrounds
  const [groups, setGroups] = useState(null);
  const [openId, setOpenId] = useState(null);
  const [addingTo, setAddingTo] = useState(undefined); // a group id (or null: no group) while adding a background
  const [newGroup, setNewGroup] = useState(null); // the name being typed for a new group
  const [progress, setProgress] = useState(null);

  async function load() {
    const [c, g] = await Promise.all([
      call(() => api.get('/api/parent/characters')),
      call(() => api.get('/api/parent/scene-groups'))
    ]);
    if (c) setList(c.filter((x) => x.kind === 'scene'));
    if (g) setGroups(g);
  }
  useEffect(() => { load(); }, []);

  const busy = (list || []).some((c) => c.status === 'processing');
  useEffect(() => {
    if (!busy) return undefined;
    const t = setInterval(load, 3000);
    return () => clearInterval(t);
  }, [busy]);

  async function upload(method, path, form) {
    setProgress(0);
    const r = await call(() => api.upload(method, path, form, setProgress));
    setProgress(null);
    if (r) await load();
    return r;
  }

  async function makeGroup(e) {
    e.preventDefault();
    if (!newGroup.trim()) return setError('Give the group a name');
    const g = await call(() => api.post('/api/parent/scene-groups', { name: newGroup }));
    if (!g) return;
    setNewGroup(null);
    await load();
    setAddingTo(g.id);
  }

  const uploading = progress != null && (
    <div className="card">Uploading… {Math.round(progress * 100)}%
      <div className="progress"><i style={{ width: `${progress * 100}%` }} /></div>
    </div>
  );

  const open = list?.find((c) => c.id === openId);
  if (open) {
    return (
      <div className="stack">
        {error && <p className="error">{error}</p>}
        {uploading}
        <BackgroundPage key={open.id} background={open} groups={groups || []} call={call} upload={upload}
          setError={setError} reload={load} onBack={() => setOpenId(null)} />
      </div>
    );
  }

  if (!list || !groups) {
    return <div className="stack">{error ? <p className="error">{error}</p> : <p className="muted">Loading…</p>}</div>;
  }

  const ungrouped = list.filter((c) => !c.groupId);
  const sections = [
    ...groups.map((g) => ({ group: g, items: list.filter((c) => c.groupId === g.id) })),
    ...(ungrouped.length || !groups.length ? [{ group: null, items: ungrouped }] : [])
  ];

  return (
    <div className="stack">
      {error && <p className="error">{error}</p>}
      {uploading}
      <p className="muted">Picture puzzles the kids put together, one piece per brush. When a kid finishes one, they can
        make it their phone or tablet background, and stand any of their characters in front of it (unless it's not for
        dancing). Kids pick backgrounds by group. Characters and songs go in the same groups.</p>
      {newGroup === null ? (
        <div className="row"><button className="btn primary" onClick={() => setNewGroup('')}>＋ New group</button></div>
      ) : (
        <form className="card row wrap" onSubmit={makeGroup}>
          <input autoFocus placeholder="Group name (e.g. Transformers)" value={newGroup} maxLength={40}
            onChange={(e) => setNewGroup(e.target.value)} />
          <button className="btn primary">Make the group</button>
          <button type="button" className="btn" onClick={() => setNewGroup(null)}>Cancel</button>
        </form>
      )}
      {sections.map(({ group, items }) => (
        <GroupCard key={group ? group.id : 'none'} group={group} items={items} call={call} reload={load}
          adding={addingTo === (group ? group.id : null)}
          onAdd={() => setAddingTo(group ? group.id : null)}
          onOpen={setOpenId}>
          {addingTo === (group ? group.id : null) && (
            <AddBackground groupId={group ? group.id : null} upload={upload} setError={setError}
              onDone={(c) => { setAddingTo(undefined); if (c?.id) setOpenId(c.id); }}
              onCancel={() => setAddingTo(undefined)} />
          )}
        </GroupCard>
      ))}
      {!groups.length && !list.length && (
        <p className="muted">Start with a group, like “K-pop Demon Hunters”, then add its backgrounds.</p>
      )}
    </div>
  );
}

// One group: its name (rename it), its backgrounds, and adding one. group is
// null for the backgrounds in no group.
function GroupCard({ group, items, call, reload, adding, onAdd, onOpen, children }) {
  const [renaming, setRenaming] = useState(null);

  async function rename(e) {
    e.preventDefault();
    if (await call(() => api.put(`/api/parent/scene-groups/${group.id}`, { name: renaming }))) {
      setRenaming(null);
      reload();
    }
  }

  async function remove() {
    const more = group.characters + group.songs;
    const what = items.length || more
      ? `Delete the ${group.name} group? Its backgrounds, characters and songs stay (in no group), and so does the kids' progress.`
      : `Delete the ${group.name} group?`;
    if (!window.confirm(what)) return;
    if (await call(() => api.del(`/api/parent/scene-groups/${group.id}`))) reload();
  }

  return (
    <section className="card stack bg-group-card">
      {renaming !== null ? (
        <form className="row wrap" onSubmit={rename}>
          <input autoFocus value={renaming} maxLength={40} onChange={(e) => setRenaming(e.target.value)} />
          <button className="btn primary">Save</button>
          <button type="button" className="btn" onClick={() => setRenaming(null)}>Cancel</button>
        </form>
      ) : (
        <div className="row wrap">
          <h3 className="grow">{group ? group.name : 'No group'}</h3>
          {group && <button className="btn" onClick={() => setRenaming(group.name)}>Rename</button>}
          {group && <button className="btn danger" onClick={remove}>Delete group</button>}
        </div>
      )}
      {!group && <p className="muted small">Kids see these under “Other backgrounds”.</p>}
      <div className="bg-grid">
        {items.map((c) => (
          <button key={c.id} className="bg-tile" onClick={() => onOpen(c.id)}>
            {c.status === 'ready' ? <SceneThumb character={{ ...c, pieces: [] }} showAll />
              : <span className="bg-tile-msg">{c.status === 'processing' ? 'Getting ready…' : 'Problem: open it to see'}</span>}
            <span>{c.name}{c.forDancing === false && <span className="muted small"> · not for dancing</span>}</span>
          </button>
        ))}
        {!adding && (
          <button className="bg-tile add" onClick={onAdd}>
            <span className="bg-tile-msg">＋</span>
            <span>Add a background</span>
          </button>
        )}
      </div>
      {children}
    </section>
  );
}

function AddBackground({ groupId, upload, setError, onDone, onCancel }) {
  const [name, setName] = useState('');
  const [forDancing, setForDancing] = useState(true);
  const picture = useRef(null);

  async function submit(e) {
    e.preventDefault();
    if (!name.trim()) return setError('Give the background a name');
    const pic = picture.current?.files?.[0];
    if (!pic) return setError('Pick the picture');
    const form = new FormData();
    form.append('name', name.trim());
    form.append('kind', 'scene');
    form.append('groupId', groupId == null ? '' : String(groupId));
    form.append('forDancing', forDancing ? '1' : '0');
    form.append('picture', pic, pic.name);
    const r = await upload('POST', '/api/parent/characters', form);
    if (r) onDone(r);
  }

  return (
    <form className="stack bg-add" onSubmit={submit}>
      <h4>Add a background</h4>
      <input autoFocus placeholder="Name (e.g. City at night)" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} />
      <label>Picture (JPG or PNG)
        <input type="file" accept="image/*" ref={picture} />
      </label>
      <DancingSwitch value={forDancing} onChange={setForDancing} />
      <p className="muted small">It’s cut into 9 jigsaw pieces, one for each brush. Once a kid finishes it, they can make it their
        phone or tablet background (tall pictures fill a phone best).</p>
      <div className="row">
        <button className="btn primary">Upload</button>
        <button type="button" className="btn" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}

// One background: its picture, name, group, a new picture, or deleting it.
function BackgroundPage({ background: c, groups, call, upload, setError, reload, onBack }) {
  const [name, setName] = useState(c.name);
  const [groupId, setGroupId] = useState(c.groupId ?? '');
  const [forDancing, setForDancing] = useState(c.forDancing !== false);
  const picture = useRef(null);
  const changed = name !== c.name || String(groupId) !== String(c.groupId ?? '') || forDancing !== (c.forDancing !== false);

  async function save() {
    const body = { name, groupId: groupId === '' ? null : Number(groupId), forDancing };
    if (await call(() => api.put(`/api/parent/characters/${c.id}`, body))) reload();
  }

  async function newPicture() {
    const pic = picture.current?.files?.[0];
    if (!pic) return setError('Pick a picture first');
    const form = new FormData();
    form.append('picture', pic, pic.name);
    if (await upload('POST', `/api/parent/characters/${c.id}/picture`, form)) picture.current.value = '';
  }

  async function remove() {
    if (!window.confirm(`Delete the ${c.name} background? Every kid's pieces of it are deleted too.`)) return;
    if (await call(() => api.del(`/api/parent/characters/${c.id}`))) {
      await reload();
      onBack();
    }
  }

  return (
    <div className="stack">
      <div className="row wrap">
        <button data-back className="btn" onClick={onBack}>← All backgrounds</button>
        <h2 className="grow">🖼️ {c.name}</h2>
      </div>
      <div className="card stack">
        {c.status === 'processing' && <p className="muted">Getting the picture ready…</p>}
        {c.status === 'ready' && (
          <div className="scene-preview">
            <SceneThumb character={{ ...c, pieces: [] }} showAll />
          </div>
        )}
        {c.error && <p className="error">{c.error}</p>}
        <label>Name
          <input value={name} maxLength={60} onChange={(e) => setName(e.target.value)} />
        </label>
        <label>Group
          <select value={groupId} onChange={(e) => setGroupId(e.target.value)}>
            <option value="">No group</option>
            {groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
          </select>
        </label>
        <DancingSwitch value={forDancing} onChange={setForDancing} />
        <div className="row"><button className="btn primary" onClick={save} disabled={!changed}>Save</button></div>
        <h4>Picture</h4>
        <p className="muted small">Cut into 9 jigsaw pieces, one per brush. A new picture keeps everyone's progress (same pieces, new picture).</p>
        <div className="row wrap">
          <input type="file" accept="image/*" ref={picture} />
          <button className="btn" onClick={newPicture}>Use this picture</button>
        </div>
        <div className="row"><button className="btn danger" onClick={remove}>Delete {c.name}</button></div>
      </div>
    </div>
  );
}

// Can characters dance in front of it? Off for pictures with characters
// already in them: those are just a puzzle and a phone background.
function DancingSwitch({ value, onChange }) {
  return (
    <>
      <label className="inline check">
        <input type="checkbox" checked={value} onChange={(e) => onChange(e.target.checked)} />
        Use for dancing
      </label>
      <span className="muted small">
        {value ? 'Kids can put their characters in front of it once they finish it.' : 'Only a puzzle and a phone background, never behind a dance.'}
      </span>
    </>
  );
}
