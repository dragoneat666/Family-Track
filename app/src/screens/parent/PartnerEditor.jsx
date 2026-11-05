import { useEffect, useRef, useState } from 'react';
import { api } from '../../api.js';
import { PartnerScene } from '../../three/partnerScene.js';
import { USES, PARTS, useOf, useFor, segments } from '../../exercises/partnerMoves.js';
import VoiceEditor from './VoiceEditor.jsx';

// A character as an exercise partner: its exercise model (a .glb from
// Blender with the props and exercise animations), what each animation is
// for, pause marks, who can pick it, and its voice.
export default function PartnerEditor({ character, call, upload, setError, onChange }) {
  const p = character.partner;
  const ex = p.exercise;
  const file = useRef(null);

  async function uploadModel() {
    const f = [...(file.current.files || [])].find((x) => /\.glb$/i.test(x.name));
    if (!f) return setError('Pick the exercise .glb first');
    const form = new FormData();
    form.append('exercise', f, f.name);
    if (await upload('POST', `/api/parent/characters/${character.id}/exercise`, form)) {
      file.current.value = '';
      onChange();
    }
  }

  async function save(patch) {
    if (await call(() => api.put(`/api/parent/characters/${character.id}/partner`, patch))) onChange();
  }

  async function removeModel() {
    if (!window.confirm(`Remove ${character.name}'s exercise model? The recorded voice stays.`)) return;
    if (await call(() => api.del(`/api/parent/characters/${character.id}/exercise`))) onChange();
  }

  function setUse(animation, use) {
    const uses = Object.fromEntries(Object.entries(ex.uses).filter(([k, v]) => v !== animation && k !== use));
    if (use) uses[use] = animation;
    save({ uses });
  }

  return (
    <div className="stack partner-editor">
      <h4>⭐ Exercise partner</h4>
      <p className="muted small">Upload one .glb from Blender with the model, any props (the pillow…) and all of its exercise
        animations. Names like <code>Starfish_Sit_Up.L</code>, <code>Starfish_Sit_Up_Rev.L</code> and <code>Wave</code> are
        matched up for you.</p>

      <div className="row wrap">
        <span>Exercise model: {!ex ? 'none yet' : ex.status === 'ready' ? `✓ ${ex.animations.length} animations` : ex.status === 'processing' ? 'getting ready…' : 'problem'}</span>
        <input type="file" ref={file} accept=".glb" />
        <button className="btn" onClick={uploadModel}>{ex ? 'Replace' : 'Upload'}</button>
        {ex && character.kind !== 'partner' && <button className="btn small danger" onClick={removeModel}>Remove</button>}
      </div>
      {ex?.error && <p className="error">{ex.error}</p>}

      {character.kind === 'partner'
        ? <p className="muted small">Every kid can pick {character.name} (there's nothing to build).</p>
        : (
          <label className="inline check">
            <input type="checkbox" checked={p.forAll} onChange={(e) => save({ forAll: e.target.checked })} />
            Every kid can pick {character.name}, without building it first
          </label>
        )}

      {ex?.status === 'ready' && (
        <>
          <b>What each animation is for</b>
          <ul className="line-list">
            {ex.animations.map((a) => (
              <li key={a.name} className="row">
                <span className="line-text">{a.name} <span className="muted small">{a.seconds.toFixed(1)} s</span></span>
                <select value={useFor(ex, a.name) ?? ''} onChange={(e) => setUse(a.name, e.target.value)}>
                  <option value="">Not used</option>
                  {USES.map((u) => <option key={u.key} value={u.key}>{u.name}</option>)}
                </select>
              </li>
            ))}
          </ul>
          <PartnerPreview key={ex.version} character={character} save={save} />
        </>
      )}

      <b>🗣️ Voice</b>
      <VoiceEditor character={character} call={call} setError={setError} onChange={onChange} />
    </div>
  );
}

const andList = (xs) => (xs.length < 2 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);

// Watch the animations and set pause marks: the partner stops at each mark
// while the kid catches up (one part of the move per instruction).
function PartnerPreview({ character, save }) {
  const ex = character.partner.exercise;
  const holder = useRef(null);
  const scene = useRef(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');
  const first = ex.uses.starfish_in_left || ex.uses.starfish_in_right || ex.animations[0]?.name;
  const [clip, setClip] = useState(first);
  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [marks, setMarks] = useState(ex.marks);

  useEffect(() => {
    const s = new PartnerScene(holder.current);
    scene.current = s;
    let gone = false;
    s.load(api.url(`/api/characters/${character.id}/exercise.glb?v=${ex.version}`), api.authHeaders())
      .then(() => { if (!gone) { s.show(clip, 0, 0); setReady(true); } })
      .catch((e) => { if (!gone) setError(e.message || 'The exercise model would not load.'); });
    const t = setInterval(() => { setTime(s.time); setPlaying(s.playing); }, 80);
    return () => { gone = true; clearInterval(t); s.destroy(); };
  }, []);

  useEffect(() => { setMarks(ex.marks); }, [JSON.stringify(ex.marks)]);

  const duration = ex.animations.find((a) => a.name === clip)?.seconds ?? 0;
  const use = useOf(useFor(ex, clip));
  const parts = use?.parts ? PARTS[use.parts] : null;
  const clipMarks = marks[clip] || [];
  const pieces = parts ? segments(clipMarks, duration, parts.length) : [];

  function pick(name) {
    setClip(name);
    scene.current?.show(name, 0, 0);
  }

  function seek(t) {
    scene.current.pause();
    scene.current.show(clip, t, 0);
    setTime(t);
  }

  function setClipMarks(list) {
    const next = { ...marks, [clip]: list };
    if (!list.length) delete next[clip];
    setMarks(next);
    save({ marks: next });
  }

  function addMark() {
    const t = Math.round(scene.current.time * 100) / 100;
    if (t <= 0.05 || t >= duration - 0.05 || clipMarks.some((m) => Math.abs(m - t) < 0.05)) return;
    setClipMarks([...clipMarks, t].sort((a, b) => a - b));
  }

  function tryPart(i) {
    const [from, to] = pieces[i];
    scene.current.show(clip, from, 0);
    scene.current.playTo(to);
  }

  const full = parts && clipMarks.length >= parts.length - 1;

  return (
    <div className="stack">
      <div className="dance-preview" ref={holder}>
        {!ready && !error && <div className="dance-preview-note">Loading {character.name}…</div>}
      </div>
      {error && <p className="error">{error}</p>}
      <div className="row wrap">
        <select value={clip} onChange={(e) => pick(e.target.value)}>
          {ex.animations.map((a) => <option key={a.name} value={a.name}>{a.name}</option>)}
        </select>
        <button className="btn small" onClick={() => (playing ? scene.current.pause() : scene.current.play())} disabled={!ready}>
          {playing ? '⏸ Pause' : '▶ Play'}
        </button>
        <button className="btn small" onClick={() => seek(Math.max(0, time - 0.1))} disabled={!ready} aria-label="Back a little">◀ 0.1 s</button>
        <button className="btn small" onClick={() => seek(Math.min(duration, time + 0.1))} disabled={!ready} aria-label="Forward a little">0.1 s ▶</button>
        <span className="muted small">{time.toFixed(2)} of {duration.toFixed(2)} s</span>
      </div>
      <div className="timeline">
        <input type="range" min={0} max={duration} step={0.01} value={Math.min(time, duration)} onChange={(e) => seek(Number(e.target.value))} disabled={!ready} />
        {clipMarks.map((m) => <i key={m} className="timeline-mark" style={{ left: `${(m / duration) * 100}%` }} />)}
      </div>

      {parts ? (
        <div className="stack">
          <p className="muted small">
            {character.name} stops at each pause mark so the kid can catch up. Put {parts.length - 1}: {andList(parts.slice(0, -1).map((x) => `after “${x.toLowerCase()}”`))}.
            The last part ({parts[parts.length - 1].toLowerCase()}) runs to the end. Move the slider to the spot, then tap <b>+ Pause here</b>.
          </p>
          <div className="row wrap">
            <button className="btn primary small" onClick={addMark} disabled={!ready || full}>+ Pause here</button>
            {clipMarks.map((m, i) => (
              <span key={m} className="mark-chip">
                <button className="btn link small" onClick={() => seek(m)}>{i + 1}: {m.toFixed(2)} s</button>
                <button className="btn small danger" onClick={() => setClipMarks(clipMarks.filter((x) => x !== m))} aria-label="Remove this mark">✕</button>
              </span>
            ))}
          </div>
          {clipMarks.length < parts.length - 1 && (
            <p className="muted small">Until all {parts.length - 1} are there, the rest are spread out evenly.</p>
          )}
          <div className="row wrap">
            <span className="small">Try a part:</span>
            {parts.map((name, i) => (
              <button key={name} className="btn small" onClick={() => tryPart(i)} disabled={!ready}>{i + 1}. {name}</button>
            ))}
          </div>
        </div>
      ) : (
        <p className="muted small">{use ? `Used for: ${use.name}. It plays all the way through.` : 'Not used in any exercise yet: pick what it is for above.'}</p>
      )}
    </div>
  );
}
