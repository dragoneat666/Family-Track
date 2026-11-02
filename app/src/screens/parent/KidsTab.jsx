import { useEffect, useState } from 'react';
import { api } from '../../api.js';
import { useParentCall } from './useParentCall.js';

const EMOJIS = ['🙂', '🦖', '🤖', '🚀', '🦄', '👑', '🐱', '🐶', '🦋', '⚽', '🌈', '🐉'];
const COLORS = ['#4f8cff', '#ff6b9a', '#ffb020', '#2ec27e', '#9b5de5', '#00bbf9'];

export default function KidsTab({ onLocked }) {
  const { error, call } = useParentCall(onLocked);
  const [profiles, setProfiles] = useState([]);
  const [characters, setCharacters] = useState([]);
  const [draft, setDraft] = useState({ name: '', emoji: EMOJIS[0], color: COLORS[0] });

  async function load() {
    const [p, c] = await Promise.all([
      call(() => api.get('/api/parent/profiles')),
      call(() => api.get('/api/parent/characters'))
    ]);
    if (p) setProfiles(p);
    if (c) setCharacters(c);
  }
  useEffect(() => { load(); }, []);

  async function add(e) {
    e.preventDefault();
    if (!draft.name.trim()) return;
    if (await call(() => api.post('/api/parent/profiles', draft))) {
      setDraft({ name: '', emoji: EMOJIS[0], color: COLORS[0] });
      load();
    }
  }

  async function update(p, patch) {
    if (await call(() => api.put(`/api/parent/profiles/${p.id}`, { ...p, ...patch }))) load();
  }

  async function setCharacter(p, characterId) {
    if (await call(() => api.put(`/api/parent/profiles/${p.id}/character`, { characterId: characterId || null }))) load();
  }

  async function reset(p) {
    const c = characters.find((x) => x.id === p.characterId);
    if (!c || !window.confirm(`Reset ${p.name}'s progress on ${c.name}? All their pieces go back to locked.`)) return;
    if (await call(() => api.del(`/api/parent/profiles/${p.id}/progress/${c.id}`))) load();
  }

  async function remove(p) {
    if (!window.confirm(`Delete ${p.name}? Their brushing history and progress are deleted too.`)) return;
    if (await call(() => api.del(`/api/parent/profiles/${p.id}`))) load();
  }

  const kids = profiles.filter((p) => !p.isParent);
  return (
    <div className="stack">
      {error && <p className="error">{error}</p>}
      {kids.map((p) => (
        <div key={p.id} className="card row-card">
          <div className="row">
            <select value={p.emoji} onChange={(e) => update(p, { emoji: e.target.value })} className="emoji-select">
              {EMOJIS.map((x) => <option key={x}>{x}</option>)}
            </select>
            <input defaultValue={p.name} onBlur={(e) => e.target.value !== p.name && update(p, { name: e.target.value })} />
            <div className="swatches">
              {COLORS.map((c) => (
                <button key={c} className={p.color === c ? 'swatch on' : 'swatch'} style={{ background: c }} onClick={() => update(p, { color: c })} />
              ))}
            </div>
          </div>
          <div className="row">
            <label className="inline">Building
              <select value={p.characterId || ''} onChange={(e) => setCharacter(p, Number(e.target.value))}>
                <option value="">— nothing —</option>
                {characters.filter((c) => c.status === 'ready').map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </label>
            <button className="btn" onClick={() => reset(p)} disabled={!p.characterId}>Reset progress</button>
            <button className="btn danger" onClick={() => remove(p)}>Delete</button>
          </div>
        </div>
      ))}

      <form className="card" onSubmit={add}>
        <h3>Add a kid</h3>
        <div className="row">
          <select value={draft.emoji} onChange={(e) => setDraft({ ...draft, emoji: e.target.value })} className="emoji-select">
            {EMOJIS.map((x) => <option key={x}>{x}</option>)}
          </select>
          <input placeholder="Name" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
          <div className="swatches">
            {COLORS.map((c) => (
              <button type="button" key={c} className={draft.color === c ? 'swatch on' : 'swatch'} style={{ background: c }} onClick={() => setDraft({ ...draft, color: c })} />
            ))}
          </div>
          <button className="btn primary">Add</button>
        </div>
      </form>
    </div>
  );
}
