import { useEffect, useRef, useState } from 'react';
import { api } from '../../api.js';
import { useParentCall } from './useParentCall.js';
import Exercises, { EXERCISES } from '../../exercises/Exercises.jsx';
import { LINE_GROUPS, ALL_LINES, EFFECTS, COACH_EMOJIS } from '../../exercises/coachLines.js';
import { CoachPlayer } from '../../exercises/coachVoice.js';
import { MicRecorder, cleanClip, toWav, clipFromFile, canRecord } from '../../exercises/audioTools.js';

// Run an exercise with a kid, and make the coaches whose voices talk the
// kids through them.
export default function ExercisesTab({ onAuthLost, show }) {
  const { error, setError, call } = useParentCall(onAuthLost);
  const [kids, setKids] = useState([]);
  const [kidId, setKidId] = useState('');
  const [coaches, setCoaches] = useState([]);
  const [editing, setEditing] = useState(null);

  async function loadCoaches() {
    const c = await call(() => api.get('/api/coaches'));
    if (c) setCoaches(c);
  }

  useEffect(() => {
    (async () => {
      const p = await call(() => api.get('/api/parent/profiles'));
      if (p) {
        const k = p.filter((x) => !x.isParent);
        setKids(k);
        if (k.length) setKidId(String(k[0].id));
      }
      loadCoaches();
    })();
  }, []);

  const kid = kids.find((k) => String(k.id) === kidId) ?? null;

  function open(key) {
    show(<Exercises profile={kid} grownUp start={key} onExit={() => show(null)} />);
  }

  async function addCoach() {
    const c = await call(() => api.post('/api/parent/coaches', { name: 'New coach', emoji: '🤖', effect: 'robot' }));
    if (c) {
      await loadCoaches();
      setEditing(c.id);
    }
  }

  return (
    <div className="stack">
      {error && <p className="error">{error}</p>}

      <div className="card stack">
        <h3>🏃 Do an exercise</h3>
        <p className="muted">Exercises from the occupational therapist. Kids find them under 🏃 Exercises on their home screen.
          Hold times and rounds are set per kid, here (kids can see them but not change them).</p>
        <div className="row wrap">
          {kids.length > 0 && (
            <label className="inline">With
              <select value={kidId} onChange={(e) => setKidId(e.target.value)}>
                {kids.map((k) => <option key={k.id} value={k.id}>{k.emoji} {k.name}</option>)}
              </select>
            </label>
          )}
          {EXERCISES.map((e) => (
            <button key={e.key} className="btn primary" onClick={() => open(e.key)}>{e.emoji} {e.name}</button>
          ))}
        </div>
      </div>

      <div className="card stack">
        <h3>🗣️ Coaches</h3>
        <p className="muted">A coach is a voice that talks the kids through an exercise: you record the lines in your own
          voice and pick an effect (robot, radio, sparkly…), and the app adds it as it plays. Each kid picks their coach on
          the Exercises screen. Lines nobody recorded are just a tick.</p>
        {coaches.map((c) => (
          <div key={c.id} className="coach-card">
            <div className="row spread">
              <h4>{c.emoji} {c.name}</h4>
              <span className="muted small">{countRecorded(c)} of {ALL_LINES.length} lines · {effectName(c.effect)}</span>
            </div>
            {editing === c.id ? (
              <CoachEditor coach={c} call={call} setError={setError} onChange={loadCoaches} onClose={() => setEditing(null)} />
            ) : (
              <button className="btn" onClick={() => setEditing(c.id)}>Edit &amp; record</button>
            )}
          </div>
        ))}
        <button className="btn" onClick={addCoach}>+ Add a coach</button>
      </div>
    </div>
  );
}

const countRecorded = (c) => ALL_LINES.filter((l) => c.lines[l.key]).length;
const effectName = (key) => EFFECTS.find((e) => e.key === key)?.name.replace(/ \(.*/, '') ?? key;

function CoachEditor({ coach, call, setError, onChange, onClose }) {
  const [name, setName] = useState(coach.name);
  const [emoji, setEmoji] = useState(coach.emoji);
  const [effect, setEffect] = useState(coach.effect);
  const [busy, setBusy] = useState('');
  const [recording, setRecording] = useState(null); // lines being recorded
  const player = useRef(null);
  const loadedFor = useRef('');
  const fileFor = useRef(null);
  const fileInput = useRef(null);

  useEffect(() => () => player.current?.destroy(), []);

  async function save(patch = {}) {
    const r = await call(() => api.put(`/api/parent/coaches/${coach.id}`, { name, emoji, effect, ...patch }));
    if (r) onChange();
  }

  // Hear a line with the effect picked right now (even before saving it).
  async function hear(key) {
    player.current ??= new CoachPlayer();
    await player.current.resume();
    const stamp = JSON.stringify(coach.lines);
    if (loadedFor.current !== stamp) {
      await player.current.load(coach);
      loadedFor.current = stamp;
    }
    player.current.effect = effect;
    player.current.stopAll();
    player.current.play(key);
  }

  function record(lines) {
    setRecording(lines);
  }

  async function uploadFile(e) {
    const file = e.target.files?.[0];
    const key = fileFor.current;
    e.target.value = '';
    if (!file || !key) return;
    setBusy(key);
    try {
      const wav = await clipFromFile(file);
      await uploadLine(coach.id, key, wav);
      onChange();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy('');
    }
  }

  async function removeLine(key) {
    if (await call(() => api.del(`/api/parent/coaches/${coach.id}/lines/${key}`))) onChange();
  }

  async function removeCoach() {
    if (!window.confirm(`Delete the coach ${coach.name} and all its recordings?`)) return;
    if (await call(() => api.del(`/api/parent/coaches/${coach.id}`))) { onClose(); onChange(); }
  }

  const missing = ALL_LINES.filter((l) => !coach.lines[l.key]);

  return (
    <div className="stack">
      {recording && (
        <RecordSession coach={{ ...coach, effect }} lines={recording} onExit={() => { setRecording(null); loadedFor.current = ''; onChange(); }} />
      )}
      <div className="row wrap">
        <select className="emoji-select" value={emoji} onChange={(e) => setEmoji(e.target.value)}>
          {COACH_EMOJIS.map((x) => <option key={x}>{x}</option>)}
        </select>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Coach name" />
      </div>
      <label>Voice effect
        <select value={effect} onChange={(e) => setEffect(e.target.value)}>
          {EFFECTS.map((x) => <option key={x.key} value={x.key}>{x.name}</option>)}
        </select>
      </label>
      <div className="row wrap">
        <button className="btn primary" onClick={() => save()}>Save</button>
        <button className="btn" onClick={onClose}>Close</button>
      </div>

      <h4>Lines</h4>
      {!canRecord && <p className="muted small">Recording needs the microphone, which works in the Android app. Here you can still
        add audio or video files (a voice changer's output, a saved video…) with 📁.</p>}
      {canRecord && (
        <div className="row wrap">
          <button className="btn primary" onClick={() => record(missing.length ? missing : ALL_LINES)}>
            🎙️ {missing.length === ALL_LINES.length ? 'Record all the lines' : missing.length ? `Record the ${missing.length} missing lines` : 'Record them all again'}
          </button>
          {missing.length > 0 && missing.length < ALL_LINES.length && (
            <button className="btn" onClick={() => record(ALL_LINES)}>Record them all again</button>
          )}
        </div>
      )}
      <input type="file" accept="audio/*,video/*" ref={fileInput} style={{ display: 'none' }} onChange={uploadFile} />
      {LINE_GROUPS.map((g) => (
        <div key={g.title} className="stack">
          <b>{g.title}</b>
          <ul className="line-list">
            {g.lines.map((l) => {
              const have = coach.lines[l.key];
              return (
                <li key={l.key} className="row">
                  <span className="line-text">“{l.text}”</span>
                  <span className={have ? 'status good' : 'status'}>{busy === l.key ? 'saving…' : have ? `✓ ${have.seconds.toFixed(1)} s` : '—'}</span>
                  <button className="btn small" onClick={() => hear(l.key)} disabled={!have} aria-label="Play">▶</button>
                  {canRecord && <button className="btn small" onClick={() => record([l])} aria-label="Record">🎙️</button>}
                  <button className="btn small" onClick={() => { fileFor.current = l.key; fileInput.current.click(); }} aria-label="Add a file">📁</button>
                  <button className="btn small danger" onClick={() => removeLine(l.key)} disabled={!have} aria-label="Delete">✕</button>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
      <button className="btn danger" onClick={removeCoach}>Delete this coach</button>
    </div>
  );
}

function uploadLine(coachId, key, wav) {
  const form = new FormData();
  form.append('audio', wav, `${key}.wav`);
  return api.upload('PUT', `/api/parent/coaches/${coachId}/lines/${key}`, form);
}

// Full screen: shows one line at a time, big, like a teleprompter. The
// microphone runs the whole time; tapping Next cuts off the line just said.
function RecordSession({ coach, lines, onExit }) {
  const recorder = useRef(null);
  const player = useRef(null);
  const segStart = useRef(0);
  const meter = useRef(null);
  const [index, setIndex] = useState(0);
  const [started, setStarted] = useState(false);
  const [message, setMessage] = useState('');
  const [saved, setSaved] = useState({}); // key -> 'saving' | 'saved' | error text
  const [last, setLast] = useState(null);

  useEffect(() => {
    let frame;
    const draw = () => {
      if (meter.current && recorder.current) meter.current.style.width = `${Math.min(100, recorder.current.level * 400)}%`;
      frame = requestAnimationFrame(draw);
    };
    frame = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(frame);
      recorder.current?.stop();
      player.current?.destroy();
    };
  }, []);

  async function start() {
    try {
      const r = new MicRecorder();
      await r.start();
      recorder.current = r;
      segStart.current = r.mark();
      player.current = new CoachPlayer();
      player.current.effect = coach.effect;
      setStarted(true);
    } catch {
      setMessage("Couldn't use the microphone. Allow it for Family Track and try again.");
    }
  }

  function next() {
    const r = recorder.current;
    const line = lines[index];
    // Skip the tap itself at the end, and any leftover from the last tap.
    const clip = cleanClip(r.slice(segStart.current), r.rate, { skipStart: 0.12, skipEnd: 0.25 });
    if (!clip) {
      setMessage("Didn't hear anything. Say it again, then tap Next.");
      segStart.current = r.mark();
      return;
    }
    setMessage('');
    segStart.current = r.mark();
    setSaved((s) => ({ ...s, [line.key]: 'saving' }));
    const rate = r.rate;
    toWav(clip, rate).then(async (wav) => {
      await player.current.setClip(line.key, wav);
      setLast(line.key);
      await uploadLine(coach.id, line.key, wav);
      setSaved((s) => ({ ...s, [line.key]: 'saved' }));
    }).catch((e) => setSaved((s) => ({ ...s, [line.key]: e.message || 'not saved' })));
    advance();
  }

  function advance() {
    if (index + 1 >= lines.length) {
      recorder.current?.stop();
      recorder.current = null;
      setIndex(lines.length);
    } else {
      setIndex(index + 1);
    }
  }

  function again() {
    segStart.current = recorder.current.mark();
    setMessage('Go ahead, say it again.');
  }

  function skip() {
    segStart.current = recorder.current.mark();
    setMessage('');
    advance();
  }

  async function hearLast() {
    await player.current.resume();
    player.current.stopAll();
    player.current.play(last);
  }

  const done = index >= lines.length;
  const failed = Object.entries(saved).filter(([, v]) => v !== 'saving' && v !== 'saved');
  const saving = Object.values(saved).filter((v) => v === 'saving').length;

  return (
    <div className="exercise-screen record-screen">
      <header className="build-header">
        <button className="btn" onClick={onExit} disabled={saving > 0}>← Back</button>
        <div className="build-title">🎙️ {coach.emoji} {coach.name}</div>
      </header>
      <div className="record-body">
        {!started && !done && (
          <>
            <p className="record-help">Read each line out loud, then tap <b>Next</b>. Speak the way you want the coach to sound;
              the {EFFECTS.find((e) => e.key === coach.effect)?.name.replace(/ \(.*/, '').toLowerCase()} effect is added when it plays.</p>
            <p className="muted">{lines.length} {lines.length === 1 ? 'line' : 'lines'} to record.</p>
            <button className="btn big primary" onClick={start}>🎙️ Start</button>
          </>
        )}
        {started && !done && (
          <>
            <p className="muted">Line {index + 1} of {lines.length}</p>
            <p className="record-line">“{lines[index].text}”</p>
            <div className="record-meter"><i ref={meter} /></div>
            <div className="row wrap record-buttons">
              <button className="btn big primary" onClick={next}>Next ▶</button>
              <button className="btn" onClick={again}>Start this line over</button>
              <button className="btn" onClick={skip}>Skip</button>
              {last && <button className="btn" onClick={hearLast}>▶ Hear the last one</button>}
            </div>
          </>
        )}
        {done && (
          <>
            <p className="record-line">{saving ? 'Saving…' : failed.length ? 'Some lines were not saved' : '✓ All saved'}</p>
            {failed.map(([k, why]) => <p key={k} className="error">“{ALL_LINES.find((l) => l.key === k)?.text}”: {why}</p>)}
            <div className="row wrap record-buttons">
              {last && <button className="btn" onClick={hearLast}>▶ Hear the last one</button>}
              <button className="btn big primary" onClick={onExit} disabled={saving > 0}>Done</button>
            </div>
          </>
        )}
        {message && <p className="record-message">{message}</p>}
      </div>
    </div>
  );
}
