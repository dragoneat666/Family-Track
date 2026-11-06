import { useEffect, useRef, useState } from 'react';
import { api } from '../../api.js';
import { DanceViewer } from '../../three/danceViewer.js';
import { PartnerScene } from '../../three/partnerScene.js';
import { glbOnly, danceFiles, KIND_EMOJI, clock } from './characterFiles.js';
import VoiceEditor from './VoiceEditor.jsx';
import ExerciseEditor from './ExerciseEditor.jsx';

// One character's own page: everything about it, one section at a time.
export default function CharacterPage({ character, all, call, upload, setError, reload, onBack }) {
  const partnerOnly = character.kind === 'partner';
  const sections = [
    ['details', 'Details'],
    ...(partnerOnly ? [] : [['build', 'Build']]),
    ['model', 'Exercise model'],
    ['voice', 'Voice'],
    ['exercises', `Exercises (${character.exercises.length})`]
  ];
  const [section, setSection] = useState(partnerOnly ? 'exercises' : 'details');
  const props = { character, all, call, upload, setError, reload };

  return (
    <div className="stack character-page">
      <div className="row wrap">
        <button className="btn" onClick={onBack}>← All characters</button>
        <h2 className="grow">{KIND_EMOJI[character.kind] ?? '🤖'} {character.name}</h2>
      </div>
      <nav className="tabs sub">
        {sections.map(([key, label]) => (
          <button key={key} className={section === key ? 'tab active' : 'tab'} onClick={() => setSection(key)}>{label}</button>
        ))}
      </nav>
      {section === 'details' && <Details {...props} onDeleted={onBack} />}
      {section === 'build' && <Build {...props} />}
      {section === 'model' && <ExerciseModel {...props} />}
      {section === 'voice' && (
        <div className="card stack">
          <p className="muted small">{character.name}'s voice: every line it can say, with the words. Exercises pick lines from
            here (or make new ones as you write them). Record in the app, add audio files, or split one long recording.</p>
          <VoiceEditor character={character} call={call} setError={setError} onChange={reload} />
        </div>
      )}
      {section === 'exercises' && <ExerciseList {...props} />}
    </div>
  );
}

function Details({ character, call, reload, onDeleted }) {
  const partnerOnly = character.kind === 'partner';
  const [name, setName] = useState(character.name);
  const [kind, setKind] = useState(character.kind);

  async function save() {
    if (await call(() => api.put(`/api/parent/characters/${character.id}`, { name, kind }))) reload();
  }

  async function setForAll(forAll) {
    if (await call(() => api.put(`/api/parent/characters/${character.id}/partner`, { forAll }))) reload();
  }

  async function remove() {
    if (!window.confirm(`Delete ${character.name} completely? Every kid's progress on it, its voice and its exercises are deleted too.`)) return;
    if (await call(() => api.del(`/api/parent/characters/${character.id}`))) {
      await reload();
      onDeleted();
    }
  }

  return (
    <div className="card stack">
      <label>Name
        <input value={name} onChange={(e) => setName(e.target.value)} />
      </label>
      {!partnerOnly && (
        <label>Kind
          <select value={kind} onChange={(e) => setKind(e.target.value)}>
            <option value="build">Build (snap parts together)</option>
            <option value="dress">Dress up (outfit pieces)</option>
          </select>
        </label>
      )}
      <div className="row"><button className="btn primary" onClick={save} disabled={name === character.name && kind === character.kind}>Save</button></div>
      <h4>Exercise partner</h4>
      {partnerOnly
        ? <p className="muted small">Every kid can pick {character.name} as their partner (there's nothing to build).</p>
        : (
          <label className="inline check">
            <input type="checkbox" checked={character.partner.forAll} onChange={(e) => setForAll(e.target.checked)} />
            Every kid can pick {character.name}, without building it first
          </label>
        )}
      <p className="muted small">Kids can pick it once it has an exercise model. They get its exercises.</p>
      {character.error && <p className="error">{character.error}</p>}
      <div className="row"><button className="btn danger" onClick={remove}>Delete {character.name}</button></div>
    </div>
  );
}

function Build({ character, call, upload, setError, reload }) {
  const [pieces, setPieces] = useState(character.pieces);
  const addPieces = useRef(null);
  const rigged = useRef(null);
  const dances = useRef(null);
  const [watching, setWatching] = useState(false);
  useEffect(() => { setPieces(character.pieces); }, [JSON.stringify(character.pieces)]);

  function move(i, d) {
    const next = [...pieces];
    const j = i + d;
    if (j < 0 || j >= next.length) return;
    [next[i], next[j]] = [next[j], next[i]];
    setPieces(next);
  }

  async function save() {
    if (await call(() => api.put(`/api/parent/characters/${character.id}`, { pieces }))) reload();
  }

  async function removePiece(p) {
    if (!window.confirm(`Remove the piece "${p.name}"? Kids who unlocked it lose it.`)) return;
    if (await call(() => api.del(`/api/parent/pieces/${p.id}`))) reload();
  }

  async function uploadFiles(ref, field, path, single) {
    const files = field === 'dances' ? danceFiles(ref.current.files) : glbOnly(ref.current.files);
    if (!files.length) return setError(field === 'dances' ? 'Pick a .glb or .fbx file first' : 'Pick a .glb file first');
    const form = new FormData();
    (single ? files.slice(0, 1) : files).forEach((f) => form.append(field, f, f.name));
    if (await upload('POST', path, form)) ref.current.value = '';
  }

  async function renameDance(d, value) {
    if (value !== d.name) await call(() => api.put(`/api/parent/dances/${d.id}`, { name: value }));
  }

  async function removeDance(d) {
    if (await call(() => api.del(`/api/parent/dances/${d.id}`))) reload();
  }

  const changed = JSON.stringify(pieces) !== JSON.stringify(character.pieces);
  const canWatch = character.hasRigged && character.dances.some((d) => d.status === 'ready');

  return (
    <div className="stack">
      <div className="card stack">
        <h4>Pieces, in unlock order <span className={`status ${character.status}`}>{character.status === 'processing' ? 'getting ready…' : ''}</span></h4>
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
        <div className="row"><button className="btn primary" onClick={save} disabled={!changed}>Save names &amp; order</button></div>
        <h4>Add more pieces</h4>
        <div className="row">
          <input type="file" multiple ref={addPieces} />
          <button className="btn" onClick={() => uploadFiles(addPieces, 'pieces', `/api/parent/characters/${character.id}/pieces`)}>Upload</button>
        </div>
      </div>

      <div className="card stack">
        <h4>Dancing model {character.hasRigged ? '✓' : '(none yet)'}</h4>
        <p className="muted small">The rigged .glb the kids see dance after the build is finished.</p>
        <div className="row">
          <input type="file" ref={rigged} />
          <button className="btn" onClick={() => uploadFiles(rigged, 'rigged', `/api/parent/characters/${character.id}/rigged`, true)}>
            {character.hasRigged ? 'Replace' : 'Upload'}
          </button>
        </div>
        <h4>Dances <span className="muted small">(.glb, or Mixamo .fbx “Without Skin”)</span></h4>
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
        {canWatch && (
          <div className="row"><button className="btn" onClick={() => setWatching(!watching)}>{watching ? 'Close dances' : '💃 Watch dances'}</button></div>
        )}
        {watching && canWatch && <DancePreview key={character.version} character={character} />}
      </div>
    </div>
  );
}

// The dancing model playing its dances, exactly as the kids will see it.
function DancePreview({ character }) {
  const holder = useRef(null);
  const viewer = useRef(null);
  const [current, setCurrent] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [time, setTime] = useState(null);
  const dances = character.dances.filter((d) => d.status === 'ready');

  useEffect(() => {
    const v = new DanceViewer(holder.current);
    viewer.current = v;
    let cancelled = false;
    v.load(api.url(`/api/characters/${character.id}/rigged.glb?v=${character.version}`), api.authHeaders())
      .then(() => { if (!cancelled) { setLoading(false); play(dances[0]); } })
      .catch((e) => { if (!cancelled) { setError(e.message || 'The dancing model would not load.'); setLoading(false); } });
    const t = setInterval(() => setTime(v.progress()), 250);
    return () => { cancelled = true; clearInterval(t); v.destroy(); };
  }, []);

  async function play(d) {
    setError('');
    setCurrent(d.id);
    try {
      await viewer.current.play(api.url(`/api/characters/${character.id}/dances/${d.id}.glb?v=${character.version}`));
    } catch (e) {
      setError(e.message || 'That dance would not load.');
      setCurrent(null);
    }
  }

  function stop() {
    viewer.current.stop();
    setCurrent(null);
  }

  return (
    <div className="stack">
      <div className="dance-preview" ref={holder}>
        {loading && <div className="dance-preview-note">Loading {character.name}…</div>}
      </div>
      {error && <p className="error">{error}</p>}
      <div className="row wrap">
        {dances.map((d) => (
          <button key={d.id} className={current === d.id ? 'btn primary small' : 'btn small'} onClick={() => play(d)} disabled={loading}>
            {d.name}
          </button>
        ))}
        <button className="btn small" onClick={stop} disabled={loading || current == null}>Stand still</button>
      </div>
      <p className="muted small">
        {time ? `${time.time.toFixed(1)} of ${time.duration.toFixed(1)} s · ` : ''}
        Swipe the picture to turn {character.name} around. Dances loop here; kids pick one with the 💃 button after the build is done.
      </p>
    </div>
  );
}

// The exercise model: one .glb from Blender with the model, its props and
// every exercise animation. Exercises use parts of these animations.
function ExerciseModel({ character, call, upload, setError, reload }) {
  const ex = character.partner.exercise;
  const file = useRef(null);

  async function uploadModel() {
    const f = glbOnly(file.current.files)[0];
    if (!f) return setError('Pick the exercise .glb first');
    const form = new FormData();
    form.append('exercise', f, f.name);
    if (await upload('POST', `/api/parent/characters/${character.id}/exercise`, form)) file.current.value = '';
  }

  async function removeModel() {
    if (!window.confirm(`Remove ${character.name}'s exercise model? Its voice and exercises stay.`)) return;
    if (await call(() => api.del(`/api/parent/characters/${character.id}/exercise`))) reload();
  }

  return (
    <div className="card stack">
      <p className="muted small">One .glb from Blender with the model, any props (the pillow…) and all of its exercise animations.
        Replacing it keeps the exercises: scenes use animations by name, so keep the names the same.</p>
      <div className="row wrap">
        <span>{!ex ? 'None yet' : ex.status === 'ready' ? `✓ ${ex.animations.length} animations` : ex.status === 'processing' ? 'Getting ready…' : 'Problem'}</span>
        <input type="file" ref={file} accept=".glb" />
        <button className="btn" onClick={uploadModel}>{ex ? 'Replace' : 'Upload'}</button>
        {ex && character.kind !== 'partner' && <button className="btn small danger" onClick={removeModel}>Remove</button>}
      </div>
      {ex?.error && <p className="error">{ex.error}</p>}
      {ex?.status === 'ready' && <AnimationViewer key={ex.version} character={character} />}
    </div>
  );
}

// Watch any of the animations, scrubbing through it.
function AnimationViewer({ character }) {
  const ex = character.partner.exercise;
  const holder = useRef(null);
  const scene = useRef(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');
  const [clip, setClip] = useState(ex.animations[0]?.name);
  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const duration = ex.animations.find((a) => a.name === clip)?.seconds ?? 0;

  useEffect(() => {
    const s = new PartnerScene(holder.current);
    scene.current = s;
    let gone = false;
    s.load(api.url(`/api/characters/${character.id}/exercise.glb?v=${ex.version}`), api.authHeaders())
      .then(() => { if (!gone) { s.setPose({ clip, time: 0 }); setReady(true); } })
      .catch((e) => { if (!gone) setError(e.message || 'The exercise model would not load.'); });
    return () => { gone = true; s.destroy(); };
  }, []);

  // Playing: move along with the real clock and loop.
  useEffect(() => {
    if (!playing) return;
    let last = performance.now();
    let t = time >= duration - 0.01 ? 0 : time;
    let frame;
    const step = () => {
      const now = performance.now();
      t += (now - last) / 1000;
      last = now;
      if (t > duration) t = 0;
      scene.current.setPose({ clip, time: t });
      setTime(t);
      frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [playing, clip]);

  function seek(t) {
    setPlaying(false);
    setTime(t);
    scene.current?.setPose({ clip, time: t });
  }

  function pick(name) {
    setClip(name);
    setPlaying(false);
    setTime(0);
    scene.current?.setPose({ clip: name, time: 0 });
  }

  return (
    <div className="stack">
      <div className="dance-preview" ref={holder}>
        {!ready && !error && <div className="dance-preview-note">Loading {character.name}…</div>}
      </div>
      {error && <p className="error">{error}</p>}
      <div className="row wrap">
        <select value={clip} onChange={(e) => pick(e.target.value)}>
          {ex.animations.map((a) => <option key={a.name} value={a.name}>{a.name} ({clock(a.seconds)})</option>)}
        </select>
        <button className="btn small" onClick={() => setPlaying(!playing)} disabled={!ready}>{playing ? '⏸ Pause' : '▶ Play'}</button>
        <span className="muted small">{time.toFixed(2)} of {duration.toFixed(2)} s</span>
      </div>
      <input type="range" min={0} max={duration} step={0.01} value={Math.min(time, duration)} onChange={(e) => seek(Number(e.target.value))} disabled={!ready} />
      <p className="muted small">Swipe the picture to turn {character.name} around.</p>
    </div>
  );
}

function ExerciseList({ character, all, call, reload }) {
  const [editing, setEditing] = useState(null);
  const [copyFrom, setCopyFrom] = useState('');
  const ready = character.partner.exercise?.status === 'ready';
  const others = all.flatMap((c) => c.exercises.map((e) => ({ ...e, owner: c })));
  const open = character.exercises.find((e) => e.id === editing);

  async function add(body) {
    const r = await call(() => api.post(`/api/parent/characters/${character.id}/exercises`, body));
    if (r) {
      await reload();
      setEditing(r.id);
    }
  }

  async function remove(e) {
    if (!window.confirm(`Delete the exercise "${e.name}"? Its voice lines stay in ${character.name}'s voice.`)) return;
    if (await call(() => api.del(`/api/parent/exercises/${e.id}`))) reload();
  }

  return (
    <div className="stack">
      {open && <ExerciseEditor key={open.id} character={character} exercise={open} call={call} reload={reload} onClose={() => setEditing(null)} />}
      {!ready && <p className="card muted">Upload {character.name}'s exercise model first (under <b>Exercise model</b>): exercises are made from its animations.</p>}
      <div className="card stack">
        {character.exercises.length === 0 && <p className="muted">No exercises yet.</p>}
        <ul className="line-list">
          {character.exercises.map((e) => (
            <li key={e.id} className="row">
              <span className="line-text"><b>{e.emoji} {e.name}</b> <span className="muted small">{e.script.scenes.length} scenes</span></span>
              <button className="btn primary small" onClick={() => setEditing(e.id)} disabled={!ready}>🎬 Edit</button>
              <button className="btn small danger" onClick={() => remove(e)} aria-label="Delete">✕</button>
            </li>
          ))}
        </ul>
      </div>
      <div className="card stack">
        <h4>Add an exercise</h4>
        <div className="row wrap">
          <button className="btn" onClick={() => add({ name: 'New exercise' })} disabled={!ready}>＋ Start from scratch</button>
          {character.partner.canStarfish && (
            <button className="btn" onClick={() => add({ starter: 'starfish' })} disabled={!ready}>⭐ Hug &amp; Starfish from its animations</button>
          )}
        </div>
        {others.length > 0 && (
          <div className="row wrap">
            <select value={copyFrom} onChange={(e) => setCopyFrom(e.target.value)}>
              <option value="">Copy one from…</option>
              {others.map((e) => <option key={e.id} value={e.id}>{e.owner.name}: {e.emoji} {e.name}</option>)}
            </select>
            <button className="btn" onClick={() => add({ copyFrom: Number(copyFrom) })} disabled={!copyFrom || !ready}>Copy</button>
          </div>
        )}
        <p className="muted small">A copy keeps the scenes and words, and uses animations with the same names. Its voice lines come
          along with their words, ready to record in {character.name}'s voice. Each kid's hold time and rounds carry over too.</p>
      </div>
    </div>
  );
}
