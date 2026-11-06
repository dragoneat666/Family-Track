import { useEffect, useRef, useState } from 'react';
import { api } from '../../api.js';
import { useParentCall } from './useParentCall.js';
import CharacterPage from './CharacterPage.jsx';
import { glbOnly, KIND_EMOJI } from './characterFiles.js';

// All the characters as tiles, plus adding one. Tapping a character opens its
// own page (building, exercise model, voice, exercises). The server shrinks
// the 3D files for the tablets, so the big originals are fine to upload.
export default function CharactersTab({ onAuthLost }) {
  const { error, setError, call } = useParentCall(onAuthLost);
  const [list, setList] = useState(null);
  const [openId, setOpenId] = useState(null);
  const [adding, setAdding] = useState(false);
  const [progress, setProgress] = useState(null);

  async function load() {
    const c = await call(() => api.get('/api/parent/characters'));
    if (c) setList(c);
    return c;
  }
  useEffect(() => { load(); }, []);

  // While anything is being processed, check back every few seconds.
  const busy = (list || []).some((c) => c.status === 'processing' || c.partner?.exercise?.status === 'processing' ||
    c.dances.some((d) => d.status === 'processing'));
  useEffect(() => {
    if (!busy) return;
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
        <CharacterPage key={open.id} character={open} all={list} call={call} upload={upload} setError={setError}
          reload={load} onBack={() => setOpenId(null)} />
      </div>
    );
  }

  return (
    <div className="stack">
      {error && <p className="error">{error}</p>}
      {uploading}
      <div className="char-grid">
        {(list || []).map((c) => (
          <button key={c.id} className="char-tile" onClick={() => setOpenId(c.id)}>
            <span className="char-emoji">{KIND_EMOJI[c.kind] ?? '🤖'}</span>
            <b>{c.name}</b>
            <span className="muted small">{summary(c)}</span>
          </button>
        ))}
        <button className="char-tile add" onClick={() => setAdding(!adding)}>
          <span className="char-emoji">＋</span>
          <b>Add a character</b>
        </button>
      </div>
      {list && !list.length && !adding && <p className="muted">No characters yet. Add the first one.</p>}
      {adding && <AddCharacter upload={upload} setError={setError} onAdded={(c) => { setAdding(false); if (c?.id) setOpenId(c.id); }} />}
    </div>
  );
}

function summary(c) {
  if (c.status === 'processing') return 'Getting ready…';
  if (c.status === 'error') return 'Problem: open it to see';
  const bits = [];
  if (c.kind !== 'partner') bits.push(`${c.pieces.length} pieces`);
  else bits.push('Exercise partner');
  const ex = c.partner?.exercise;
  if (ex?.status === 'processing') bits.push('exercise model getting ready…');
  if (c.exercises.length) bits.push(`${c.exercises.length} ${c.exercises.length === 1 ? 'exercise' : 'exercises'}`);
  return bits.join(' · ');
}

function AddCharacter({ upload, setError, onAdded }) {
  const [name, setName] = useState('');
  const [kind, setKind] = useState('build');
  const pieces = useRef(null);
  const exercise = useRef(null);
  const partnerOnly = kind === 'partner';

  async function submit(e) {
    e.preventDefault();
    if (!name.trim()) return setError('Give the character a name');
    const ex = glbOnly(exercise.current?.files)[0];
    const p = partnerOnly ? [] : glbOnly(pieces.current.files);
    if (partnerOnly && !ex) return setError('Pick the exercise model (.glb)');
    if (!partnerOnly && !p.length) return setError('Pick the piece files (.glb)');
    const form = new FormData();
    form.append('name', name.trim());
    form.append('kind', kind);
    p.forEach((f) => form.append('pieces', f, f.name));
    if (ex) form.append('exercise', ex, ex.name);
    const r = await upload('POST', '/api/parent/characters', form);
    if (r) onAdded(r);
  }

  return (
    <form className="card stack" onSubmit={submit}>
      <h3>Add a character</h3>
      <div className="row wrap">
        <input placeholder="Name (e.g. Bumblebee)" value={name} onChange={(e) => setName(e.target.value)} />
        <select value={kind} onChange={(e) => setKind(e.target.value)}>
          <option value="build">Build (snap parts together)</option>
          <option value="dress">Dress up (outfit pieces)</option>
          <option value="partner">Exercise partner only (nothing to build)</option>
        </select>
      </div>
      {partnerOnly ? (
        <label>Exercise model — one .glb with the model, props and its exercise animations
          <input type="file" accept=".glb" ref={exercise} />
        </label>
      ) : (
        <label>Pieces — pick all the piece .glb files. They must all be exported from the whole model without moving them.
          <input type="file" multiple ref={pieces} />
        </label>
      )}
      <p className="muted small">{partnerOnly
        ? 'Every kid can pick an exercise-only partner. Its voice and exercises are set up on its page next.'
        : 'The dancing model, dances and exercise model can be added on its page next.'}</p>
      <button className="btn primary">Upload</button>
    </form>
  );
}

