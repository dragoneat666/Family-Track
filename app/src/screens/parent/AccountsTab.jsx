import { useEffect, useState } from 'react';
import { api } from '../../api.js';
import { useParentCall } from './useParentCall.js';

const EMOJIS = ['🙂', '🧑', '👩', '👨', '🦖', '🤖', '🚀', '🦄', '👑', '🐱', '🐶', '🦋', '⚽', '🌈', '🐉'];
const COLORS = ['#4f8cff', '#ff6b9a', '#ffb020', '#2ec27e', '#9b5de5', '#00bbf9'];
const blank = { name: '', emoji: '🙂', color: COLORS[0], isParent: false, pin: '' };

export default function AccountsTab({ onAuthLost }) {
  const { error, call } = useParentCall(onAuthLost);
  const [accounts, setAccounts] = useState([]);
  const [characters, setCharacters] = useState([]);
  const [draft, setDraft] = useState(blank);
  const [msg, setMsg] = useState('');

  async function load() {
    const [a, c] = await Promise.all([
      call(() => api.get('/api/parent/profiles')),
      call(() => api.get('/api/parent/characters'))
    ]);
    if (a) setAccounts(a);
    if (c) setCharacters(c);
  }
  useEffect(() => { load(); }, []);

  async function add(e) {
    e.preventDefault();
    if (!draft.name.trim()) return;
    const created = await call(() => api.post('/api/parent/profiles', draft));
    if (created) {
      setMsg(created.isParent && !draft.pin
        ? `${created.name} will pick their own PIN the first time they sign in.`
        : `Added ${created.name}.`);
      setDraft(blank);
      load();
    }
  }

  async function update(a, patch) {
    if (await call(() => api.put(`/api/parent/profiles/${a.id}`, { ...a, ...patch }))) load();
  }

  async function setCharacter(a, characterId) {
    if (await call(() => api.put(`/api/parent/profiles/${a.id}/character`, { characterId: characterId || null }))) load();
  }

  async function resetProgress(a) {
    const c = characters.find((x) => x.id === a.characterId);
    if (!c || !window.confirm(`Reset ${a.name}'s progress on ${c.name}? All their pieces go back to locked.`)) return;
    if (await call(() => api.del(`/api/parent/profiles/${a.id}/progress/${c.id}`))) load();
  }

  async function resetPin(a) {
    if (!window.confirm(`Clear ${a.name}'s PIN? They'll pick a new one the next time they sign in.`)) return;
    if (await call(() => api.post(`/api/parent/profiles/${a.id}/reset-pin`))) {
      setMsg(`${a.name} will pick a new PIN at their next sign-in.`);
      load();
    }
  }

  async function remove(a) {
    const extra = a.isParent ? '' : ' Their brushing history and progress are deleted too.';
    if (!window.confirm(`Delete ${a.name}'s account?${extra}`)) return;
    if (await call(() => api.del(`/api/parent/profiles/${a.id}`))) load();
  }

  const kids = accounts.filter((a) => !a.isParent);
  const adults = accounts.filter((a) => a.isParent);

  const identity = (a) => (
    <div className="row">
      <select value={a.emoji} onChange={(e) => update(a, { emoji: e.target.value })} className="emoji-select">
        {[...new Set([a.emoji, ...EMOJIS])].map((x) => <option key={x}>{x}</option>)}
      </select>
      <input defaultValue={a.name} onBlur={(e) => e.target.value !== a.name && update(a, { name: e.target.value })} />
      <div className="swatches">
        {COLORS.map((c) => (
          <button key={c} className={a.color === c ? 'swatch on' : 'swatch'} style={{ background: c }} onClick={() => update(a, { color: c })} />
        ))}
      </div>
    </div>
  );

  return (
    <div className="stack">
      {error && <p className="error">{error}</p>}
      {msg && <p className="muted">{msg}</p>}

      <h3>Kids</h3>
      {!kids.length && <p className="muted">No kid accounts yet.</p>}
      {kids.map((a) => (
        <div key={a.id} className="card row-card">
          {identity(a)}
          <div className="row wrap">
            <label className="inline">Building
              <select value={a.characterId || ''} onChange={(e) => setCharacter(a, Number(e.target.value))}>
                <option value="">— nothing —</option>
                {characters.filter((c) => c.status === 'ready' && c.kind !== 'partner').map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </label>
            <button className="btn" onClick={() => resetProgress(a)} disabled={!a.characterId}>Reset progress</button>
            <button className="btn danger" onClick={() => remove(a)}>Delete</button>
          </div>
        </div>
      ))}

      <h3>Grown-ups</h3>
      {adults.map((a) => (
        <div key={a.id} className="card row-card">
          {identity(a)}
          <div className="row wrap">
            <span className="muted small">{a.needsPin ? 'Picks a PIN at first sign-in' : '🔒 Has a PIN'}{a.isMe && ' · this is you'}</span>
            {!a.isMe && !a.needsPin && <button className="btn" onClick={() => resetPin(a)}>Reset PIN</button>}
            {!a.isMe && <button className="btn danger" onClick={() => remove(a)}>Delete</button>}
          </div>
        </div>
      ))}

      <form className="card stack" onSubmit={add}>
        <h3>Add an account</h3>
        <div className="segmented">
          <button type="button" className={!draft.isParent ? 'on' : ''} onClick={() => setDraft({ ...draft, isParent: false, pin: '' })}>🧒 Kid</button>
          <button type="button" className={draft.isParent ? 'on' : ''} onClick={() => setDraft({ ...draft, isParent: true })}>🧑 Grown-up</button>
        </div>
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
        </div>
        {draft.isParent ? (
          <label>PIN (optional — leave empty and they pick their own at first sign-in)
            <input type="password" inputMode="numeric" value={draft.pin} onChange={(e) => setDraft({ ...draft, pin: e.target.value })} autoComplete="new-password" />
          </label>
        ) : (
          <p className="muted small">Kids don't have a PIN. Signing in as a kid, or switching away from a kid's account, needs a grown-up's PIN.</p>
        )}
        <button className="btn primary" disabled={!draft.name.trim()}>Add {draft.isParent ? 'grown-up' : 'kid'}</button>
      </form>
    </div>
  );
}
