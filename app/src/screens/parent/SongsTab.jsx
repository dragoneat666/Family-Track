import { useEffect, useRef, useState } from 'react';
import { api } from '../../api.js';
import { photoUrl } from '../../recipes/data.js';
import { useParentCall } from './useParentCall.js';

// Songs to brush to, by group (the same groups as backgrounds; characters
// go in them too, on each character's Details). A brush plays a random song
// from the group of the character the kid is working on. Songs in no group
// play when that group has none (or the character is in no group).
export default function SongsTab({ onAuthLost }) {
  const { error, setError, call } = useParentCall(onAuthLost);
  const [songs, setSongs] = useState(null);
  const [groups, setGroups] = useState(null);
  const [newGroup, setNewGroup] = useState(null);
  const [progress, setProgress] = useState(null);
  const [playing, setPlaying] = useState(null); // song id
  const audio = useRef(null);

  async function load() {
    const [s, g] = await Promise.all([
      call(() => api.get('/api/parent/songs')),
      call(() => api.get('/api/parent/scene-groups'))
    ]);
    if (s) setSongs(s);
    if (g) setGroups(g);
  }
  useEffect(() => {
    load();
    return () => audio.current?.pause();
  }, []);

  async function add(groupId, files) {
    if (!files.length) return;
    const form = new FormData();
    form.append('groupId', groupId == null ? '' : String(groupId));
    files.forEach((f) => form.append('songs', f, f.name));
    setProgress(0);
    const r = await call(() => api.upload('POST', '/api/parent/songs', form, setProgress));
    setProgress(null);
    if (r) {
      if (r.length < files.length) setError(`${files.length - r.length} of those weren't song files (MP3, M4A, OGG, WAV or FLAC), so they were skipped.`);
      load();
    }
  }

  async function makeGroup(e) {
    e.preventDefault();
    if (!newGroup.trim()) return setError('Give the group a name');
    if (await call(() => api.post('/api/parent/scene-groups', { name: newGroup }))) {
      setNewGroup(null);
      load();
    }
  }

  async function play(s) {
    audio.current?.pause();
    if (playing === s.id) return setPlaying(null);
    const url = await call(() => photoUrl(`/api/songs/${s.id}/file?v=${s.version}`));
    if (!url) return;
    const a = new Audio(url);
    a.onended = () => setPlaying(null);
    audio.current = a;
    setPlaying(s.id);
    a.play().catch(() => setPlaying(null));
  }

  if (!songs || !groups) return <div className="stack">{error ? <p className="error">{error}</p> : <div className="spinner" />}</div>;

  const sections = [
    ...groups.map((g) => ({ group: g, items: songs.filter((s) => s.groupId === g.id) })),
    { group: null, items: songs.filter((s) => !s.groupId) }
  ];

  return (
    <div className="stack">
      {error && <p className="error">{error}</p>}
      {progress != null && (
        <div className="card">Uploading… {Math.round(progress * 100)}%
          <div className="progress"><i style={{ width: `${progress * 100}%` }} /></div>
        </div>
      )}
      <p className="muted">Music while the kids brush. Each brush plays a random song from the group of the character the
        kid is working on (put characters in groups on their Details). Songs in no group play when that group has none.
        The song stops while brushing is paused.</p>
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
        <section key={group ? group.id : 'none'} className="card stack">
          <div className="row wrap">
            <h3 className="grow">{group ? group.name : 'No group'}</h3>
            {group && <span className="muted small">{group.characters} {group.characters === 1 ? 'character' : 'characters'}</span>}
          </div>
          {!group && <p className="muted small">For characters in no group, and groups with no songs of their own.</p>}
          {items.length
            ? <ul className="line-list">{items.map((s) => (
              <SongRow key={s.id} song={s} groups={groups} call={call} reload={load} playing={playing === s.id} onPlay={() => play(s)} />
            ))}</ul>
            : <p className="muted small">No songs yet.</p>}
          <label className="btn" style={{ alignSelf: 'flex-start', cursor: 'pointer' }}>
            ＋ Add songs
            <input type="file" multiple accept="audio/*,.mp3,.m4a,.aac,.ogg,.opus,.wav,.flac" hidden
              onChange={(e) => { add(group ? group.id : null, [...e.target.files]); e.target.value = ''; }} />
          </label>
        </section>
      ))}
    </div>
  );
}

function SongRow({ song: s, groups, call, reload, playing, onPlay }) {
  const [name, setName] = useState(null); // while renaming

  async function save(body) {
    if (await call(() => api.put(`/api/parent/songs/${s.id}`, body))) reload();
  }
  async function remove() {
    if (!window.confirm(`Delete the song ${s.name}?`)) return;
    if (await call(() => api.del(`/api/parent/songs/${s.id}`))) reload();
  }

  return (
    <li className="row wrap">
      {name !== null ? (
        <input className="line-text" autoFocus maxLength={80} value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={() => { if (name.trim() && name !== s.name) save({ name }); setName(null); }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') e.currentTarget.blur();
            if (e.key === 'Escape') setName(null);
          }} />
      ) : (
        <span className="line-text">🎵 {s.name}</span>
      )}
      <button className="btn small" onClick={onPlay} aria-label={playing ? 'Stop' : 'Play'}>{playing ? '■' : '▶'}</button>
      <button className="btn small" onMouseDown={(e) => e.preventDefault()} onClick={() => setName(name === null ? s.name : null)} aria-label="Rename">✏️</button>
      <select value={s.groupId ?? ''} onChange={(e) => save({ groupId: e.target.value === '' ? null : Number(e.target.value) })} aria-label="Group">
        <option value="">No group</option>
        {groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
      </select>
      <button className="btn small danger" onClick={remove} aria-label="Delete">✕</button>
    </li>
  );
}
