import { useEffect, useRef, useState } from 'react';
import { api } from '../../api.js';
import { useParentCall } from './useParentCall.js';

// Add characters by uploading the .glb files. The server shrinks them for
// the tablets, so the big originals are fine to upload.
export default function CharactersTab({ onAuthLost }) {
  const { error, setError, call } = useParentCall(onAuthLost);
  const [list, setList] = useState([]);
  const [editing, setEditing] = useState(null);
  const [progress, setProgress] = useState(null);

  async function load() {
    const c = await call(() => api.get('/api/parent/characters'));
    if (c) setList(c);
  }
  useEffect(() => { load(); }, []);

  // While anything is being processed, check back every few seconds.
  const busy = list.some((c) => c.status === 'processing' || c.dances.some((d) => d.status === 'processing'));
  useEffect(() => {
    if (!busy) return;
    const t = setInterval(load, 3000);
    return () => clearInterval(t);
  }, [busy]);

  async function upload(method, path, form) {
    setProgress(0);
    const r = await call(() => api.upload(method, path, form, setProgress));
    setProgress(null);
    if (r) load();
    return r;
  }

  return (
    <div className="stack">
      {error && <p className="error">{error}</p>}
      {progress != null && (
        <div className="card">Uploading… {Math.round(progress * 100)}%
          <div className="progress"><i style={{ width: `${progress * 100}%` }} /></div>
        </div>
      )}

      {list.map((c) => (
        <div key={c.id} className="card">
          <div className="row spread">
            <h3>{c.kind === 'dress' ? '👗' : '🤖'} {c.name}</h3>
            <span className={`status ${c.status}`}>
              {c.status === 'processing' ? 'Getting ready…' : c.status === 'error' ? 'Problem' : `${c.pieces.length} pieces`}
            </span>
          </div>
          {c.error && <p className="error">{c.error}</p>}
          {editing === c.id ? (
            <CharacterEditor character={c} call={call} upload={upload} onDone={() => { setEditing(null); load(); }} setError={setError} />
          ) : (
            <button className="btn" onClick={() => setEditing(c.id)}>Edit</button>
          )}
        </div>
      ))}

      <AddCharacter upload={upload} setError={setError} />
    </div>
  );
}

function glbOnly(files) {
  return [...(files || [])].filter((f) => /\.glb$/i.test(f.name));
}

function AddCharacter({ upload, setError }) {
  const [name, setName] = useState('');
  const [kind, setKind] = useState('build');
  const pieces = useRef(null);
  const rigged = useRef(null);
  const dances = useRef(null);

  async function submit(e) {
    e.preventDefault();
    const p = glbOnly(pieces.current.files);
    if (!name.trim()) return setError('Give the character a name');
    if (!p.length) return setError('Pick the piece files (.glb)');
    const form = new FormData();
    form.append('name', name.trim());
    form.append('kind', kind);
    p.forEach((f) => form.append('pieces', f, f.name));
    const r = glbOnly(rigged.current.files)[0];
    if (r) form.append('rigged', r, r.name);
    glbOnly(dances.current.files).forEach((f) => form.append('dances', f, f.name));
    if (await upload('POST', '/api/parent/characters', form)) {
      setName('');
      e.target.reset();
    }
  }

  return (
    <form className="card stack" onSubmit={submit}>
      <h3>Add a character</h3>
      <div className="row">
        <input placeholder="Name (e.g. Bumblebee)" value={name} onChange={(e) => setName(e.target.value)} />
        <select value={kind} onChange={(e) => setKind(e.target.value)}>
          <option value="build">Build (snap parts together)</option>
          <option value="dress">Dress up (outfit pieces)</option>
        </select>
      </div>
      <label>Pieces — pick all the piece .glb files. They must all be exported from the whole model without moving them.
        <input type="file" multiple ref={pieces} />
      </label>
      <label>Dancing model (optional) — the rigged .glb
        <input type="file" ref={rigged} />
      </label>
      <label>Dances (optional) — any number of animation .glb files for the same rig
        <input type="file" multiple ref={dances} />
      </label>
      <p className="muted small">Pieces start out unlocking from the bottom up (feet first, head last). You can reorder them afterwards.</p>
      <button className="btn primary">Upload</button>
    </form>
  );
}

function CharacterEditor({ character, call, upload, onDone, setError }) {
  const [name, setName] = useState(character.name);
  const [kind, setKind] = useState(character.kind);
  const [pieces, setPieces] = useState(character.pieces);
  const addPieces = useRef(null);
  const rigged = useRef(null);
  const dances = useRef(null);

  function move(i, d) {
    const next = [...pieces];
    const j = i + d;
    if (j < 0 || j >= next.length) return;
    [next[i], next[j]] = [next[j], next[i]];
    setPieces(next);
  }

  async function save() {
    if (await call(() => api.put(`/api/parent/characters/${character.id}`, { name, kind, pieces }))) onDone();
  }

  async function removePiece(p) {
    if (!window.confirm(`Remove the piece "${p.name}"? Kids who unlocked it lose it.`)) return;
    if (await call(() => api.del(`/api/parent/pieces/${p.id}`))) onDone();
  }

  async function uploadFiles(ref, field, path, single) {
    const files = glbOnly(ref.current.files);
    if (!files.length) return setError('Pick a .glb file first');
    const form = new FormData();
    (single ? files.slice(0, 1) : files).forEach((f) => form.append(field, f, f.name));
    if (await upload('POST', path, form)) onDone();
  }

  async function removeCharacter() {
    if (!window.confirm(`Delete ${character.name} completely? Every kid's progress on it is deleted too.`)) return;
    if (await call(() => api.del(`/api/parent/characters/${character.id}`))) onDone();
  }

  async function renameDance(d, value) {
    if (value !== d.name) await call(() => api.put(`/api/parent/dances/${d.id}`, { name: value }));
  }

  async function removeDance(d) {
    if (await call(() => api.del(`/api/parent/dances/${d.id}`))) onDone();
  }

  return (
    <div className="stack">
      <div className="row">
        <input value={name} onChange={(e) => setName(e.target.value)} />
        <select value={kind} onChange={(e) => setKind(e.target.value)}>
          <option value="build">Build</option>
          <option value="dress">Dress up</option>
        </select>
      </div>

      <h4>Pieces, in unlock order</h4>
      <ol className="piece-list">
        {pieces.map((p, i) => (
          <li key={p.id} className="row">
            <input value={p.name} onChange={(e) => setPieces(pieces.map((x) => (x.id === p.id ? { ...x, name: e.target.value } : x)))} />
            <button className="btn small" onClick={() => move(i, -1)} disabled={i === 0}>↑</button>
            <button className="btn small" onClick={() => move(i, 1)} disabled={i === pieces.length - 1}>↓</button>
            <button className="btn small danger" onClick={() => removePiece(p)}>✕</button>
          </li>
        ))}
      </ol>
      <div className="row">
        <button className="btn primary" onClick={save}>Save names &amp; order</button>
        <button className="btn" onClick={onDone}>Close</button>
      </div>

      <h4>Add more pieces</h4>
      <div className="row">
        <input type="file" multiple ref={addPieces} />
        <button className="btn" onClick={() => uploadFiles(addPieces, 'pieces', `/api/parent/characters/${character.id}/pieces`)}>Upload</button>
      </div>

      <h4>Dancing model {character.hasRigged ? '✓' : '(none yet)'}</h4>
      <div className="row">
        <input type="file" ref={rigged} />
        <button className="btn" onClick={() => uploadFiles(rigged, 'rigged', `/api/parent/characters/${character.id}/rigged`, true)}>
          {character.hasRigged ? 'Replace' : 'Upload'}
        </button>
      </div>

      <h4>Dances</h4>
      <ul className="piece-list">
        {character.dances.map((d) => (
          <li key={d.id} className="row">
            <input defaultValue={d.name} onBlur={(e) => renameDance(d, e.target.value)} />
            <span className={`status ${d.status}`}>{d.status === 'ready' ? '' : d.status === 'error' ? d.error : 'processing…'}</span>
            <button className="btn small danger" onClick={() => removeDance(d)}>✕</button>
          </li>
        ))}
      </ul>
      <div className="row">
        <input type="file" multiple ref={dances} />
        <button className="btn" onClick={() => uploadFiles(dances, 'dances', `/api/parent/characters/${character.id}/dances`)}>Upload dances</button>
      </div>

      <button className="btn danger" onClick={removeCharacter}>Delete this character</button>
    </div>
  );
}
