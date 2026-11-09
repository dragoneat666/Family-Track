import { useEffect, useRef, useState } from 'react';
import { api } from '../../api.js';
import { EFFECTS, wordLines, numberLines } from '../../exercises/lines.js';
import { VoicePlayer } from '../../exercises/voice.js';
import { MicRecorder, cleanClip, toWav, clipFromFile, canRecord } from '../../exercises/audioTools.js';
import AudioSplitter from './AudioSplitter.jsx';

// A partner's voice library: an effect, and every line it can say with its
// words, recorded in a grown-up's own voice, added as a file, or split out of
// one long recording. Exercises pick their lines from here. Lines nobody
// recorded are said by the device's voice (or are a tick).
export default function VoiceEditor({ character, call, setError, onChange }) {
  const library = character.partner.voice;
  const voice = { id: character.id, name: character.name, effect: character.partner.effect };
  const [busy, setBusy] = useState('');
  const [recording, setRecording] = useState(null); // lines being recorded
  const [editing, setEditing] = useState(null); // { key, text }
  const [splitting, setSplitting] = useState(false);
  const [adding, setAdding] = useState('');
  const hear = useHear(character);
  const fileFor = useRef(null);
  const fileInput = useRef(null);

  const words = wordLines(library);
  const numbers = numberLines(library);
  const usedIn = usage(character);

  async function setEffect(effect) {
    if (await call(() => api.put(`/api/parent/characters/${character.id}/partner`, { effect }))) onChange();
  }

  async function addLines() {
    const texts = adding.split('\n').map((t) => t.trim()).filter(Boolean);
    if (!texts.length) return;
    if (await call(() => api.post(`/api/parent/characters/${character.id}/lines`, { texts }))) {
      setAdding('');
      onChange();
    }
  }

  async function saveWords(key, text) {
    setEditing(null);
    const line = library.find((l) => l.key === key);
    if (!text.trim() || text.trim() === line?.text) return;
    if (await call(() => api.put(`/api/parent/characters/${character.id}/lines/${key}/words`, { text }))) onChange();
  }

  async function uploadFile(e) {
    const file = e.target.files?.[0];
    const key = fileFor.current;
    e.target.value = '';
    if (!file || !key) return;
    setBusy(key);
    try {
      await uploadLine(character.id, key, await clipFromFile(file));
      onChange();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy('');
    }
  }

  async function remove(l) {
    const where = usedIn[l.key];
    const ask = l.key.startsWith('n') && /^n\d+$/.test(l.key)
      ? `Delete the recording of “${l.text}”?`
      : `Delete the line “${l.text}”${where ? `? It's used in ${where.join(', ')}, which will have no voice there` : ''}?`;
    if (!window.confirm(ask)) return;
    if (await call(() => api.del(`/api/parent/characters/${character.id}/lines/${l.key}`))) onChange();
  }

  const missing = words.filter((l) => !l.version);

  const row = (l, canEdit) => (
    <li key={l.key} className="row">
      {editing?.key === l.key ? (
        <input className="line-text" autoFocus maxLength={160} value={editing.text}
          onChange={(e) => setEditing({ key: l.key, text: e.target.value })}
          onBlur={() => saveWords(l.key, editing.text)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') e.currentTarget.blur();
            if (e.key === 'Escape') setEditing(null);
          }} />
      ) : (
        <span className="line-text">“{l.text}”{usedIn[l.key] && <span className="muted small"> · {usedIn[l.key].join(', ')}</span>}</span>
      )}
      {canEdit && (
        <button className="btn small" onMouseDown={(e) => e.preventDefault()}
          onClick={() => setEditing(editing?.key === l.key ? null : { key: l.key, text: l.text })} aria-label="Change the words">✏️</button>
      )}
      <span className={l.version ? 'status good' : 'status'}>{busy === l.key ? 'saving…' : l.version ? `✓ ${l.seconds.toFixed(1)} s` : '—'}</span>
      <button className="btn small" onClick={() => hear(l.key)} disabled={!l.version} aria-label="Play">▶</button>
      {canRecord && <button className="btn small" onClick={() => setRecording([l])} aria-label="Record">🎙️</button>}
      <button className="btn small" onClick={() => { fileFor.current = l.key; fileInput.current.click(); }} aria-label="Add a file">📁</button>
      <button className="btn small danger" onClick={() => remove(l)} disabled={!canEdit && !l.version} aria-label="Delete">✕</button>
    </li>
  );

  return (
    <div className="stack">
      {recording && (
        <RecordSession voice={voice} lines={recording} onExit={() => { setRecording(null); hear.reset(); onChange(); }} />
      )}
      <label>Voice effect (added while it plays, so you can change it any time)
        <select value={voice.effect} onChange={(e) => setEffect(e.target.value)}>
          {EFFECTS.map((x) => <option key={x.key} value={x.key}>{x.name}</option>)}
        </select>
      </label>
      {!canRecord && <p className="muted small">Recording needs the microphone, which works in the Android app. Here you can still
        add audio or video files (a voice tool's output, a saved video…) with 📁, or split one long file into lines.</p>}
      <div className="row wrap">
        {canRecord && missing.length > 0 && (
          <button className="btn primary" onClick={() => setRecording(missing)}>🎙️ Record the {missing.length} missing {missing.length === 1 ? 'line' : 'lines'}</button>
        )}
        {!splitting && <button className="btn" onClick={() => setSplitting(true)}>✂️ Split one long recording into lines</button>}
      </div>
      {splitting && (
        <AudioSplitter targets={[...words, ...numbers]} character={character}
          upload={(key, wav) => uploadLine(character.id, key, wav)}
          onSaved={() => { hear.reset(); onChange(); }} onClose={() => setSplitting(false)} />
      )}
      <input type="file" accept="audio/*,video/*" ref={fileInput} style={{ display: 'none' }} onChange={uploadFile} />

      <b>🗣️ Lines ({words.length - missing.length} of {words.length} recorded)</b>
      {words.length > 0 ? <ul className="line-list">{words.map((l) => row(l, true))}</ul> : <p className="muted small">No lines yet.</p>}
      <label>Add lines: type the words, one line per row
        <textarea rows={3} value={adding} onChange={(e) => setAdding(e.target.value)} placeholder={'Hold it, Autobot!\nRoll out!'} />
      </label>
      <div className="row"><button className="btn" onClick={addLines} disabled={!adding.trim()}>＋ Add {adding.split('\n').filter((t) => t.trim()).length > 1 ? 'these lines' : 'this line'}</button></div>

      <b>🔢 Counting <span className="muted small">(said while the kid holds; only up to the longest hold is needed)</span></b>
      <ul className="line-list">{numbers.map((l) => row(l, false))}</ul>
    </div>
  );
}

// Which exercises use each line: { key: ['Hug & Starfish', …] }.
export function usage(character) {
  const out = {};
  for (const e of character.exercises) {
    for (const s of e.script.scenes) {
      const k = s.voice?.line;
      if (k && !(out[k] || []).includes(e.name)) (out[k] ||= []).push(e.name);
    }
  }
  return out;
}

// Plays one of the character's lines, loading the library when it changes.
export function useHear(character) {
  const player = useRef(null);
  const loadedFor = useRef('');
  useEffect(() => () => player.current?.destroy(), []);
  const hear = async (key) => {
    player.current ??= new VoicePlayer();
    await player.current.resume();
    const stamp = JSON.stringify(character.partner.voice);
    if (loadedFor.current !== stamp) {
      await player.current.load({ id: character.id, effect: character.partner.effect, voice: character.partner.voice });
      loadedFor.current = stamp;
    }
    player.current.effect = character.partner.effect;
    player.current.stopAll();
    return player.current.play(key);
  };
  hear.reset = () => { loadedFor.current = ''; };
  return hear;
}

export function uploadLine(characterId, key, wav) {
  const form = new FormData();
  form.append('audio', wav, `${key}.wav`);
  return api.upload('PUT', `/api/parent/characters/${characterId}/lines/${key}`, form);
}

// Full screen: shows one line at a time, big, like a teleprompter. The
// microphone runs the whole time; tapping Next cuts off the line just said.
export function RecordSession({ voice, lines, onExit }) {
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
        <button data-back className="btn" onClick={exit} disabled={saving > 0}>← Back</button>
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
