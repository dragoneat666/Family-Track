import { useEffect, useMemo, useRef, useState } from 'react';
import { decodeFile, levelsOf, findSpeech, cleanClip, toWav } from '../../exercises/audioTools.js';

// Hands out lines in order from `key`, one per clip from `from` on.
function flow(assign, from, key, after) {
  const out = assign.slice(0, from);
  for (let i = from; i < assign.length; i++) {
    out.push(key);
    key = key ? after(key) : '';
  }
  return out;
}

// One long recording (say, every line read by an AI voice tool, with a pause
// between them) cut into the separate lines. It all happens on this device;
// only the finished clips are uploaded, like recording them one by one.
// targets: the lines to fill, in the order they were read ([{ key, text, version }]).
export default function AudioSplitter({ targets, upload, onSaved, onClose, note, fromStart = false }) {
  const KEYS = targets.map((l) => l.key);
  const after = (key) => KEYS[KEYS.indexOf(key) + 1] ?? '';
  const flowFrom = (a, from, key) => flow(a, from, key, after);
  const byKey = new Map(targets.map((l) => [l.key, l]));
  const textOf = (key) => byKey.get(key)?.text ?? key;
  const lines = Object.fromEntries(targets.filter((l) => l.version).map((l) => [l.key, l]));
  const firstMissing = (fromStart ? null : KEYS.find((k) => !lines[k])) ?? KEYS[0];
  const [copied, setCopied] = useState(false);
  const [audio, setAudio] = useState(null); // { name, samples, rate, levels }
  const [gap, setGap] = useState(1);
  const [startKey, setStartKey] = useState(firstMissing);
  const [regions, setRegions] = useState([]);
  const [assign, setAssign] = useState([]);
  const [playing, setPlaying] = useState(-1);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const ctx = useRef(null);
  const source = useRef(null);
  const canvas = useRef(null);

  useEffect(() => () => { stop(); ctx.current?.close().catch(() => {}); }, []);

  // Find the lines again whenever the file or the pause length changes.
  useEffect(() => {
    if (!audio) return;
    const found = findSpeech(audio.levels, { gap });
    setRegions(found);
    setAssign(flowFrom(new Array(found.length).fill(''), 0, startKey));
  }, [audio, gap]);

  useEffect(() => draw(), [audio, regions, assign, playing]);

  async function pick(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setError('');
    setStatus('Reading the file…');
    try {
      const { samples, rate } = await decodeFile(file);
      setAudio({ name: file.name, samples, rate, levels: levelsOf(samples, rate) });
      setStatus('');
    } catch (err) {
      setStatus('');
      setError(err.message);
    }
  }

  function draw() {
    const c = canvas.current;
    if (!c || !audio) return;
    const g = c.getContext('2d');
    const { width, height } = c;
    const lv = audio.levels;
    const seconds = lv.length / 100;
    const x = (s) => (s / seconds) * width;
    g.clearRect(0, 0, width, height);
    regions.forEach((r, i) => {
      g.fillStyle = i === playing ? 'rgba(79,140,255,0.45)' : assign[i] ? 'rgba(46,194,126,0.25)' : 'rgba(150,150,150,0.2)';
      g.fillRect(x(r.start), 0, Math.max(1, x(r.end) - x(r.start)), height);
    });
    let loudest = 0;
    for (const l of lv) loudest = Math.max(loudest, l);
    g.fillStyle = '#556';
    const per = lv.length / width;
    for (let px = 0; px < width; px++) {
      let m = 0;
      for (let f = Math.floor(px * per); f < Math.floor((px + 1) * per); f++) m = Math.max(m, lv[f] || 0);
      const h = Math.max(1, (m / (loudest || 1)) * (height - 14));
      g.fillRect(px, (height - h) / 2 + 6, 1, h);
    }
    g.fillStyle = '#223';
    g.font = '11px sans-serif';
    regions.forEach((r, i) => g.fillText(String(i + 1), x(r.start) + 1, 11));
  }

  function stop() {
    try { source.current?.stop(); } catch { /* already stopped */ }
    source.current = null;
    setPlaying(-1);
  }

  async function play(i) {
    stop();
    const r = regions[i];
    if (!r) return;
    ctx.current ??= new (window.AudioContext || window.webkitAudioContext)();
    await ctx.current.resume();
    const part = audio.samples.subarray(Math.round(r.start * audio.rate), Math.round(r.end * audio.rate));
    const buf = ctx.current.createBuffer(1, part.length, audio.rate);
    buf.copyToChannel(part, 0);
    const src = ctx.current.createBufferSource();
    src.buffer = buf;
    src.connect(ctx.current.destination);
    src.onended = () => { if (source.current === src) { source.current = null; setPlaying(-1); } };
    src.start();
    source.current = src;
    setPlaying(i);
  }

  function clickWave(e) {
    const rect = e.currentTarget.getBoundingClientRect();
    const at = ((e.clientX - rect.left) / rect.width) * (audio.levels.length / 100);
    const i = regions.findIndex((r) => at >= r.start && at <= r.end);
    if (i >= 0) play(i);
  }

  // Picking a line for a clip lines up the clips after it with the lines after it.
  function choose(i, key) {
    const next = assign.slice();
    next[i] = key;
    setAssign(flowFrom(next, i + 1, key ? after(key) : nextFrom(i)));
  }

  // A clip that isn't a line (a cough, a retake): skip it and move the rest up.
  function skip(i) {
    const next = assign.slice();
    const key = next[i];
    next[i] = '';
    setAssign(flowFrom(next, i + 1, key || nextFrom(i)));
  }

  // The line the next clip after i should get, going by the clips before it.
  function nextFrom(i) {
    for (let j = i - 1; j >= 0; j--) if (assign[j]) return after(assign[j]);
    return startKey;
  }

  // A line that got cut in two (a long pause in the middle): put it back together.
  function join(i) {
    stop();
    const r = regions.slice();
    r.splice(i, 2, { start: r[i].start, end: r[i + 1].end });
    const a = assign.slice();
    a.splice(i + 1, 1);
    setRegions(r);
    setAssign(flowFrom(a, i + 1, a[i] ? after(a[i]) : nextFrom(i + 1)));
  }

  function restart(key) {
    setStartKey(key);
    setAssign(flowFrom(assign, 0, key));
  }

  async function save() {
    stop();
    setSaving(true);
    setError('');
    const todo = regions.map((r, i) => ({ r, key: assign[i] })).filter((x) => x.key);
    let done = 0;
    const failed = [];
    for (const { r, key } of todo) {
      setStatus(`Saving ${done + 1} of ${todo.length}…`);
      const part = audio.samples.subarray(Math.round(r.start * audio.rate), Math.round(r.end * audio.rate));
      const clip = cleanClip(part, audio.rate);
      try {
        if (!clip) throw new Error('silent');
        await upload(key, await toWav(clip, audio.rate));
      } catch {
        failed.push(textOf(key));
      }
      done++;
    }
    setSaving(false);
    setStatus('');
    onSaved();
    if (failed.length) setError(`Not saved: ${failed.map((t) => `“${t}”`).join(', ')}`);
    else onClose();
  }

  const used = assign.filter(Boolean);
  const replacing = used.filter((k) => lines[k]).length;
  const doubled = useMemo(() => used.filter((k, i) => used.indexOf(k) !== i), [assign]);

  return (
    <div className="splitter stack">
      <div className="row wrap">
        <b>✂️ Split one long recording</b>
        <button data-back className="btn small" onClick={onClose} disabled={saving}>Close</button>
      </div>
      <p className="muted small">Make one file with the lines read in the order below, with a short pause between them
        (about 2 seconds is best). The app finds each line by the quiet around it and matches them up in order.
        Play any clip to check it; fix one that's off and the ones after it follow along.</p>
      {note && <p className="small">{note}</p>}
      {!audio && (
        <details className="split-script" open={targets.length <= 40}>
          <summary>The lines, in order ({targets.length})</summary>
          <ol>{targets.map((l) => <li key={l.key}>{l.text}{l.version ? <span className="muted small"> ✓</span> : ''}</li>)}</ol>
          <button className="btn small" onClick={() => navigator.clipboard?.writeText(targets.map((l) => l.text).join('\n')).then(() => setCopied(true))}>
            📋 {copied ? 'Copied' : 'Copy the words'}
          </button>
          <span className="muted small"> to paste into a voice tool. ✓ = already recorded.</span>
        </details>
      )}
      <label className="btn">📁 Choose the file
        <input type="file" accept="audio/*,video/*" style={{ display: 'none' }} onChange={pick} disabled={saving} />
      </label>
      {status && <p className="muted">{status}</p>}
      {error && <p className="error">{error}</p>}
      {audio && (
        <>
          <p className="small">{audio.name}: {(audio.levels.length / 100).toFixed(1)} s, {regions.length} clips found.</p>
          <canvas ref={canvas} className="waveform" width={1000} height={80} onClick={clickWave} />
          <label>Pause between lines: {gap.toFixed(2)} s
            <input type="range" min="0.15" max="2" step="0.05" value={gap} onChange={(e) => setGap(Number(e.target.value))} disabled={saving} />
            <span className="muted small">Lines cut in half? Make it longer. Two lines stuck together? Make it shorter.</span>
          </label>
          <label>The first clip is
            <select value={startKey} onChange={(e) => restart(e.target.value)} disabled={saving}>
              {targets.map((l) => <option key={l.key} value={l.key}>“{l.text}”</option>)}
            </select>
          </label>
          <ol className="split-list">
            {regions.map((r, i) => (
              <li key={`${r.start}-${r.end}`} className={`row${i === playing ? ' playing' : ''}`}>
                <span className="muted small split-time">{i + 1}. {r.start.toFixed(1)}–{r.end.toFixed(1)} s</span>
                <button className="btn small" onClick={() => (i === playing ? stop() : play(i))} aria-label="Play">{i === playing ? '■' : '▶'}</button>
                <select value={assign[i] ?? ''} onChange={(e) => choose(i, e.target.value)} disabled={saving}>
                  <option value="">— not a line (skip) —</option>
                  {targets.map((l) => <option key={l.key} value={l.key}>“{l.text}”{lines[l.key] ? ' (replaces)' : ''}</option>)}
                </select>
                <button className="btn small" onClick={() => skip(i)} disabled={saving || !assign[i]} title="Not a line: skip it and move the rest up">Skip</button>
                {i + 1 < regions.length && <button className="btn small" onClick={() => join(i)} disabled={saving} title="Join with the next clip">⤵ Join</button>}
              </li>
            ))}
          </ol>
          {doubled.length > 0 && <p className="error small">More than one clip is set to “{textOf(doubled[0])}”; the last one wins.</p>}
          <div className="row wrap">
            <button className="btn primary" onClick={save} disabled={saving || !used.length}>
              Save {used.length} {used.length === 1 ? 'line' : 'lines'}{replacing ? ` (replaces ${replacing})` : ''}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
