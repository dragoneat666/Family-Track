import { useEffect, useRef, useState } from 'react';
import { api } from '../../api.js';
import { LINE_GROUPS, ALL_LINES, EFFECTS, lineText, defaultText } from '../../exercises/lines.js';
import { VoicePlayer } from '../../exercises/voice.js';
import { MicRecorder, cleanClip, toWav, clipFromFile, canRecord } from '../../exercises/audioTools.js';
import AudioSplitter from './AudioSplitter.jsx';

// A partner's voice: an effect, and every line recorded in a grown-up's own
// voice (or added as a file). Lines nobody recorded are just a tick.
export default function VoiceEditor({ character, call, setError, onChange }) {
  const phrases = character.partner.phrases || {};
  const voice = { id: character.id, name: character.name, effect: character.partner.effect, lines: character.partner.lines, phrases };
  const textOf = (key) => lineText(key, phrases);
  const withText = (list) => list.map((l) => ({ ...l, text: textOf(l.key) }));
  const [busy, setBusy] = useState('');
  const [editing, setEditing] = useState(null); // { key, text }
  const [reRecord, setReRecord] = useState({}); // key -> true: words changed since it was recorded
  const [splitting, setSplitting] = useState(false);
  const [recording, setRecording] = useState(null); // lines being recorded
  const player = useRef(null);
  const loadedFor = useRef('');
  const fileFor = useRef(null);
  const fileInput = useRef(null);

  useEffect(() => () => player.current?.destroy(), []);

  async function setEffect(effect) {
    if (await call(() => api.put(`/api/parent/characters/${character.id}/partner`, { effect }))) onChange();
  }

  async function hear(key) {
    player.current ??= new VoicePlayer();
    await player.current.resume();
    const stamp = JSON.stringify(voice.lines);
    if (loadedFor.current !== stamp) {
      await player.current.load(voice);
      loadedFor.current = stamp;
    }
    player.current.effect = voice.effect;
    player.current.stopAll();
    player.current.play(key);
  }

  async function uploadFile(e) {
    const file = e.target.files?.[0];
    const key = fileFor.current;
    e.target.value = '';
    if (!file || !key) return;
    setBusy(key);
    try {
      const wav = await clipFromFile(file);
      await uploadLine(character.id, key, wav);
      setReRecord((r) => ({ ...r, [key]: false }));
      onChange();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy('');
    }
  }

  async function saveText(key, text) {
    setEditing(null);
    text = text.trim();
    if (text === textOf(key) || (!text && !phrases[key])) return;
    const value = text === defaultText(key) ? '' : text;
    if (await call(() => api.put(`/api/parent/characters/${character.id}/partner`, { phrases: { [key]: value } }))) {
      if (voice.lines[key]) setReRecord((r) => ({ ...r, [key]: true }));
      onChange();
    }
  }

  async function removeLine(key) {
    if (await call(() => api.del(`/api/parent/characters/${character.id}/lines/${key}`))) onChange();
  }

  const missing = ALL_LINES.filter((l) => !voice.lines[l.key]);

  return (
    <div className="stack">
      {recording && (
        <RecordSession voice={voice} lines={withText(recording)} onExit={(saved) => {
          setRecording(null);
          loadedFor.current = '';
          setReRecord((r) => Object.fromEntries(Object.entries(r).filter(([k]) => !saved.includes(k))));
          onChange();
        }} />
      )}
      <label>Voice effect (added while it plays, so you can change it any time)
        <select value={voice.effect} onChange={(e) => setEffect(e.target.value)}>
          {EFFECTS.map((x) => <option key={x.key} value={x.key}>{x.name}</option>)}
        </select>
      </label>
      <p className="muted small">{ALL_LINES.length - missing.length} of {ALL_LINES.length} lines recorded. You only need the numbers up to the longest hold.</p>
      {!canRecord && <p className="muted small">Recording needs the microphone, which works in the Android app. Here you can still
        add audio or video files (a voice changer's output, a saved video…) with 📁.</p>}
      {canRecord && (
        <div className="row wrap">
          <button className="btn primary" onClick={() => setRecording(missing.length ? missing : ALL_LINES)}>
            🎙️ {missing.length === ALL_LINES.length ? 'Record all the lines' : missing.length ? `Record the ${missing.length} missing lines` : 'Record them all again'}
          </button>
          {missing.length > 0 && missing.length < ALL_LINES.length && (
            <button className="btn" onClick={() => setRecording(ALL_LINES)}>Record them all again</button>
          )}
        </div>
      )}
      <p className="muted small">Tap ✏️ to change what {voice.name} says (and what the screen shows). Record a line again after changing its words.</p>
      {splitting ? (
        <AudioSplitter character={character} textOf={textOf}
          upload={(key, wav) => uploadLine(character.id, key, wav).then(() => setReRecord((r) => ({ ...r, [key]: false })))}
          onSaved={() => { loadedFor.current = ''; onChange(); }} onClose={() => setSplitting(false)} />
      ) : (
        <div className="row wrap">
          <button className="btn" onClick={() => setSplitting(true)}>✂️ Split one long recording into lines</button>
        </div>
      )}
      <input type="file" accept="audio/*,video/*" ref={fileInput} style={{ display: 'none' }} onChange={uploadFile} />
      {LINE_GROUPS.map((g) => (
        <div key={g.title} className="stack">
          <b>{g.title}</b>
          <ul className="line-list">
            {g.lines.map((l) => {
              const have = voice.lines[l.key];
              return (
                <li key={l.key} className="row">
                  {editing?.key === l.key ? (
                    <input className="line-text" autoFocus maxLength={120} value={editing.text}
                      onChange={(e) => setEditing({ key: l.key, text: e.target.value })}
                      onBlur={() => saveText(l.key, editing.text)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') e.currentTarget.blur();
                        if (e.key === 'Escape') setEditing(null);
                      }} />
                  ) : (
                    <span className="line-text">“{textOf(l.key)}”
                      {phrases[l.key] && <span className="muted small"> (was “{l.text}”)</span>}
                      {reRecord[l.key] && <span className="status warn small"> record again</span>}
                    </span>
                  )}
                  <button className="btn small" onMouseDown={(e) => e.preventDefault()}
                    onClick={() => setEditing(editing?.key === l.key ? null : { key: l.key, text: textOf(l.key) })} aria-label="Change the words">✏️</button>
                  {phrases[l.key] && editing?.key !== l.key && (
                    <button className="btn small" onClick={() => saveText(l.key, l.text)} title="Back to the standard words" aria-label="Back to the standard words">↺</button>
                  )}
                  <span className={have ? 'status good' : 'status'}>{busy === l.key ? 'saving…' : have ? `✓ ${have.seconds.toFixed(1)} s` : '—'}</span>
                  <button className="btn small" onClick={() => hear(l.key)} disabled={!have} aria-label="Play">▶</button>
                  {canRecord && <button className="btn small" onClick={() => setRecording([l])} aria-label="Record">🎙️</button>}
                  <button className="btn small" onClick={() => { fileFor.current = l.key; fileInput.current.click(); }} aria-label="Add a file">📁</button>
                  <button className="btn small danger" onClick={() => removeLine(l.key)} disabled={!have} aria-label="Delete">✕</button>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </div>
  );
}

function uploadLine(characterId, key, wav) {
  const form = new FormData();
  form.append('audio', wav, `${key}.wav`);
  return api.upload('PUT', `/api/parent/characters/${characterId}/lines/${key}`, form);
}

// Full screen: shows one line at a time, big, like a teleprompter. The
// microphone runs the whole time; tapping Next cuts off the line just said.
function RecordSession({ voice, lines, onExit }) {
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
      player.current = new VoicePlayer();
      player.current.effect = voice.effect;
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
      await uploadLine(voice.id, line.key, wav);
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

  const exit = () => onExit(Object.keys(saved).filter((k) => saved[k] === 'saved'));
  const done = index >= lines.length;
  const failed = Object.entries(saved).filter(([, v]) => v !== 'saving' && v !== 'saved');
  const saving = Object.values(saved).filter((v) => v === 'saving').length;

  return (
    <div className="exercise-screen record-screen">
      <header className="build-header">
        <button className="btn" onClick={exit} disabled={saving > 0}>← Back</button>
        <div className="build-title">🎙️ {voice.name}</div>
      </header>
      <div className="record-body">
        {!started && !done && (
          <>
            <p className="record-help">Read each line out loud, then tap <b>Next</b>. Speak the way you want {voice.name} to sound;
              the {EFFECTS.find((e) => e.key === voice.effect)?.name.replace(/ \(.*/, '').toLowerCase()} effect is added when it plays.</p>
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
            {failed.map(([k, why]) => <p key={k} className="error">“{lines.find((l) => l.key === k)?.text ?? k}”: {why}</p>)}
            <div className="row wrap record-buttons">
              {last && <button className="btn" onClick={hearLast}>▶ Hear the last one</button>}
              <button className="btn big primary" onClick={exit} disabled={saving > 0}>Done</button>
            </div>
          </>
        )}
        {message && <p className="record-message">{message}</p>}
      </div>
    </div>
  );
}
