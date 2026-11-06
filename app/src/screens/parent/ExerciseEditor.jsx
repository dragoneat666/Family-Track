import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../../api.js';
import { PartnerScene } from '../../three/partnerScene.js';
import { VoicePlayer } from '../../exercises/voice.js';
import { ScriptPlayer } from '../../exercises/scriptPlayer.js';
import { wordLines, lineWords, MAX_COUNT } from '../../exercises/lines.js';
import { buildTimeline, sceneTiming, repeatRange, previousStart, nextStart, DEFAULT_SETTINGS } from '../../exercises/timeline.js';
import { clipFromFile, canRecord } from '../../exercises/audioTools.js';
import { uploadLine, RecordSession } from './VoiceEditor.jsx';
import AudioSplitter from './AudioSplitter.jsx';
import { clock } from './characterFiles.js';

// The exercise editor, like a little movie maker. An exercise is a row of
// scenes; each has a move (part of one of the character's animations), a
// voice line, words on the screen, and then what happens (go on, wait for the
// kid, or count while they hold). The preview at the top plays it exactly as
// the kid will see it. Changes save by themselves.

const newId = () => Math.random().toString(16).slice(2, 10);
const SPEEDS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3];
const blankScene = () => ({ id: newId(), name: '', words: '', notFirst: false, move: null, voice: null, then: 'go', seconds: null });
const round2 = (n) => Math.round(n * 100) / 100;

// "left" <-> "right" in words, and in animation names (Starfish_Sit_Up.L <-> .R).
const SWAP = { left: 'right', right: 'left', Left: 'Right', Right: 'Left', LEFT: 'RIGHT', RIGHT: 'LEFT' };
const swapWords = (s) => (s || '').replace(/\b(left|right|Left|Right|LEFT|RIGHT)\b/g, (m) => SWAP[m]);
function swapClip(name, names) {
  const tries = [
    name.replace(/([._\-\s])([LR])$/, (m, sep, side) => sep + (side === 'L' ? 'R' : 'L')),
    name.replace(/([._\-\s])([LR])([._\-\s])/, (m, a, side, b) => a + (side === 'L' ? 'R' : 'L') + b),
    name.replace(/(left|right|Left|Right|LEFT|RIGHT)/g, (m) => SWAP[m])
  ];
  return tries.find((n) => n !== name && names.has(n)) ?? name;
}
const sameWords = (a, b) => a.toLowerCase().replace(/[^a-z0-9 ]/g, '').trim() === b.toLowerCase().replace(/[^a-z0-9 ]/g, '').trim();

export default function ExerciseEditor({ character, exercise, call, reload, onClose }) {
  const animations = character.partner.exercise?.animations || [];
  const clipNames = useMemo(() => new Set(animations.map((a) => a.name)), [animations]);
  const library = character.partner.voice;
  const lines = wordLines(library);

  const [script, setScript] = useState(exercise.script);
  const [name, setName] = useState(exercise.name);
  const [emoji, setEmoji] = useState(exercise.emoji);
  const [selected, setSelected] = useState(exercise.script.scenes[0]?.id ?? null);
  const [saveState, setSaveState] = useState('saved'); // saved | waiting | saving | error
  const [frame, setFrame] = useState(null);
  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [ready, setReady] = useState(false);
  const [voiceStamp, setVoiceStamp] = useState(0);
  const [zoom, setZoom] = useState(40); // px per second
  const [tool, setTool] = useState(null); // 'split' | null
  const [recording, setRecording] = useState(null);
  const [message, setMessage] = useState('');

  const holder = useRef(null);
  const player = useRef(null);
  const voice = useRef(null);
  const scene3d = useRef(null);
  const saveTimer = useRef(null);
  const first = useRef(true);
  const latest = useRef({ script, name, emoji });
  latest.current = { script, name, emoji };

  const settings = { ...DEFAULT_SETTINGS, ...script.defaults };
  const wordsOf = (k) => lineWords(library, k);

  // The preview: the partner, its voice and the player.
  useEffect(() => {
    const v = new VoicePlayer();
    voice.current = v;
    const s = new PartnerScene(holder.current);
    scene3d.current = s;
    const p = new ScriptPlayer({
      scene: s, voice: v,
      onFrame: (f, t) => { setFrame(f); setTime(t); },
      onEnd: () => setPlaying(false)
    });
    player.current = p;
    let gone = false;
    s.load(api.url(`/api/characters/${character.id}/exercise.glb?v=${character.partner.exercise.version}`), api.authHeaders())
      .then(() => { if (!gone) setReady(true); })
      .catch((e) => { if (!gone) setMessage(e.message || 'The exercise model would not load.'); });
    return () => {
      gone = true;
      p.destroy();
      v.destroy();
      s.destroy();
    };
  }, []);

  // (Re)load the voice whenever the library changes.
  const libraryStamp = JSON.stringify(library);
  useEffect(() => {
    let gone = false;
    voice.current.load({ id: character.id, effect: character.partner.effect, voice: library })
      .then(() => { if (!gone) setVoiceStamp((n) => n + 1); });
    return () => { gone = true; };
  }, [libraryStamp, character.partner.effect]);

  const tl = useMemo(
    () => buildTimeline(script, settings, (k) => voice.current?.duration(k) ?? 0, wordsOf),
    [script, voiceStamp]
  );
  useEffect(() => { if (ready) player.current.setTimeline(tl); }, [tl, ready]);

  // Save a moment after the last change.
  useEffect(() => {
    if (first.current) { first.current = false; return; }
    setSaveState('waiting');
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(save, 700);
  }, [script, name, emoji]);

  async function save() {
    clearTimeout(saveTimer.current);
    saveTimer.current = null;
    setSaveState('saving');
    const { script: s, name: n, emoji: e } = latest.current;
    try {
      await api.put(`/api/parent/exercises/${exercise.id}`, { script: s, name: n, emoji: e });
      setSaveState((x) => (x === 'saving' ? 'saved' : x));
    } catch (err) {
      setSaveState('error');
      setMessage(err.message);
    }
  }

  async function close() {
    if (saveTimer.current || saveState === 'waiting') await save();
    await reload();
    onClose();
  }

  // ----- editing -----
  const scenes = script.scenes;
  const index = scenes.findIndex((s) => s.id === selected);
  const scene = scenes[index] ?? null;
  const range = repeatRange(script);

  const update = (fn) => setScript((s) => ({ ...s, ...fn(s) }));
  const setScenes = (fn) => update((s) => ({ scenes: fn(s.scenes) }));
  const patchScene = (id, patch) => setScenes((list) => list.map((x) => (x.id === id ? { ...x, ...patch } : x)));
  const patch = (p) => scene && patchScene(scene.id, p);
  const patchMove = (p) => scene && patchScene(scene.id, { move: { ...scene.move, ...p } });

  function addScene(after = scenes.length - 1) {
    const s = blankScene();
    setScenes((list) => [...list.slice(0, after + 1), s, ...list.slice(after + 1)]);
    setSelected(s.id);
  }

  function copyScene() {
    if (!scene) return;
    const s = { ...structuredClone(scene), id: newId() };
    setScenes((list) => [...list.slice(0, index + 1), s, ...list.slice(index + 1)]);
    setSelected(s.id);
  }

  function moveScene(d) {
    const j = index + d;
    if (!scene || j < 0 || j >= scenes.length) return;
    setScenes((list) => {
      const next = [...list];
      [next[index], next[j]] = [next[j], next[index]];
      return next;
    });
  }

  function deleteScene() {
    if (!scene || !window.confirm(`Delete scene ${index + 1}${scene.name ? ` (${scene.name})` : ''}?`)) return;
    const id = scene.id;
    update((s) => {
      const list = s.scenes.filter((x) => x.id !== id);
      let repeat = s.repeat;
      if (repeat && (repeat.from === id || repeat.to === id)) {
        const r = repeatRange(s);
        const inside = s.scenes.slice(r[0], r[1] + 1).filter((x) => x.id !== id);
        repeat = inside.length ? { from: inside[0].id, to: inside[inside.length - 1].id } : null;
      }
      return { scenes: list, repeat };
    });
    setSelected(scenes[index + 1]?.id ?? scenes[index - 1]?.id ?? null);
  }

  function setRepeat(fromId, toId) {
    update(() => ({ repeat: fromId && toId ? { from: fromId, to: toId } : null }));
  }

  function setDefault(key, value) {
    update((s) => ({ defaults: { ...DEFAULT_SETTINGS, ...s.defaults, [key]: value } }));
  }

  // New voice lines with these words; resolves to their keys.
  async function newLines(texts) {
    const r = await call(() => api.post(`/api/parent/characters/${character.id}/lines`, { texts }));
    if (r) await reload();
    return r?.keys ?? null;
  }

  async function lineFromWords() {
    const text = scene.words.trim();
    if (!text) return setMessage('Type the words first, then make a line from them.');
    const keys = await newLines([text]);
    if (keys) patch({ voice: { line: keys[0], at: scene.voice?.at ?? 0 }, words: '' });
  }

  // Every scene with words and no voice gets a new line with those words.
  async function linesForAll() {
    const todo = scenes.filter((s) => s.words.trim() && !s.voice);
    if (!todo.length) return setMessage('Every scene with words already has a voice line.');
    const keys = await newLines(todo.map((s) => s.words.trim()));
    if (!keys) return;
    const byId = new Map(todo.map((s, i) => [s.id, keys[i]]));
    setScenes((list) => list.map((s) => (byId.has(s.id) ? { ...s, voice: { line: byId.get(s.id), at: 0 }, words: '' } : s)));
    setMessage(`Made ${keys.length} new ${keys.length === 1 ? 'line' : 'lines'} from the words. Record them, or split one recording into them.`);
  }

  // Copies scenes from..to for the other side: left and right swapped in the
  // words, in the animation names and in the voice lines (new lines are made
  // for words the voice doesn't have yet). The copies go right after them.
  async function copyOtherSide(fromId, toId) {
    const a = scenes.findIndex((s) => s.id === fromId);
    const b = scenes.findIndex((s) => s.id === toId);
    if (a < 0 || b < 0) return;
    const [lo, hi] = [Math.min(a, b), Math.max(a, b)];
    const part = scenes.slice(lo, hi + 1);
    const want = new Map(); // swapped words -> key (existing or to make)
    for (const s of part) {
      if (!s.voice) continue;
      const text = wordsOf(s.voice.line);
      const swapped = swapWords(text);
      if (swapped === text) continue;
      const have = lines.find((l) => sameWords(l.text, swapped));
      want.set(swapped, have?.key ?? null);
    }
    const make = [...want.entries()].filter(([, k]) => !k).map(([t]) => t);
    if (make.length) {
      const keys = await newLines(make);
      if (!keys) return;
      make.forEach((t, i) => want.set(t, keys[i]));
    }
    const copies = part.map((s) => {
      const c = structuredClone(s);
      c.id = newId();
      c.words = swapWords(c.words);
      c.name = swapWords(c.name);
      if (c.move) c.move.clip = swapClip(c.move.clip, clipNames);
      if (c.voice) {
        const swapped = swapWords(wordsOf(c.voice.line));
        c.voice.line = want.get(swapped) ?? c.voice.line;
      }
      return c;
    });
    setScenes((list) => [...list.slice(0, hi + 1), ...copies, ...list.slice(hi + 1)]);
    setSelected(copies[0].id);
    setMessage(`Copied ${copies.length} scenes for the other side${make.length ? `, with ${make.length} new voice ${make.length === 1 ? 'line' : 'lines'} to record` : ''}.`);
  }

  // ----- playing -----
  function togglePlay() {
    const p = player.current;
    if (playing) {
      p.pause();
      setPlaying(false);
    } else {
      voice.current.resume();
      p.play();
      setPlaying(true);
    }
  }

  function seek(t) {
    player.current.seek(t);
  }

  // Jump to where a scene first plays.
  function goTo(id) {
    setSelected(id);
    const seg = tl.segs.find((s) => s.scene.id === id);
    if (seg) seek(seg.start);
  }

  // Show one moment of an animation (the move's own scrubber).
  function peek(clip, t) {
    player.current.pause();
    setPlaying(false);
    scene3d.current?.setPose({ clip, time: t });
  }

  const durationOf = (clip) => animations.find((a) => a.name === clip)?.seconds ?? 0;
  const nowScene = frame?.seg.scene.id;

  // ----- the timeline strip: each scene once, as wide as it takes -----
  const layout = [];
  {
    let x = 0;
    for (const s of scenes) {
      const t = sceneTiming(s, settings, (k) => voice.current?.duration(k) ?? 0);
      const w = Math.max(64, t.length * zoom);
      layout.push({ s, t, x, w });
      x += w + 4;
    }
  }
  const stripWidth = layout.length ? layout[layout.length - 1].x + layout[layout.length - 1].w : 0;
  const head = (() => {
    const l = frame && layout.find((c) => c.s.id === nowScene);
    if (!l) return null;
    return l.x + Math.min(1, frame.local / (l.t.length || 1)) * l.w;
  })();
  const pct = (part, whole) => `${Math.max(0, Math.min(100, (part / (whole || 1)) * 100))}%`;

  return (
    <div className="exercise-editor">
      {recording && (
        <RecordSession voice={{ id: character.id, name: character.name, effect: character.partner.effect }} lines={recording}
          onExit={() => { setRecording(null); reload(); }} />
      )}
      <header className="ee-header">
        <button className="btn" onClick={close}>← Done</button>
        <input className="ee-emoji" value={emoji} maxLength={8} onChange={(e) => setEmoji(e.target.value)} aria-label="Icon" />
        <input className="ee-name" value={name} maxLength={40} onChange={(e) => setName(e.target.value)} aria-label="Name" />
        <span className="muted small">{character.name}</span>
        <span className={`status ${saveState === 'error' ? 'error' : saveState === 'saved' ? 'good' : ''}`}>
          {saveState === 'saved' ? '✓ Saved' : saveState === 'error' ? 'Not saved' : 'Saving…'}
        </span>
      </header>
      {message && <p className="ee-message" onClick={() => setMessage('')}>{message} <span className="muted small">(tap to hide)</span></p>}

      <div className="ee-top">
        <div className="ee-stage-wrap">
          <div className="ee-stage" ref={holder}>
            {!ready && <div className="dance-preview-note">Loading {character.name}…</div>}
            {frame && (
              <div className="ee-overlay">
                {frame.seg.round && tl.rounds > 1 && <span className="ee-round">Round {frame.seg.round} of {tl.rounds}</span>}
                <b className="ee-words">{frame.words}</b>
                {frame.phase === 'count' && <b className="ee-big">{frame.count}</b>}
                {frame.phase === 'wait' && <b className="ee-big">⏳ {frame.left}</b>}
              </div>
            )}
          </div>
          <div className="row ee-transport">
            <button className="btn small" onClick={() => seek(previousStart(tl, time))} aria-label="Back a scene">⏮</button>
            <button className="btn primary small" onClick={togglePlay} disabled={!ready || !tl.segs.length}>{playing ? '⏸' : '▶'}</button>
            <button className="btn small" onClick={() => seek(nextStart(tl, time))} aria-label="Next scene">⏭</button>
            <input className="grow" type="range" min={0} max={tl.total || 1} step={0.01} value={Math.min(time, tl.total)}
              onChange={(e) => seek(Number(e.target.value))} disabled={!ready} />
            <span className="small ee-clock">{clock(time)} / {clock(tl.total)}</span>
          </div>
        </div>

        <div className="ee-side stack">
          <b>For kids, unless you set theirs</b>
          <div className="ee-defaults">
            <label>Wait <input type="number" min={0} max={60} value={settings.wait} onChange={(e) => setDefault('wait', Number(e.target.value))} /> s</label>
            <label>Hold <input type="number" min={1} max={MAX_COUNT} value={settings.hold} onChange={(e) => setDefault('hold', Number(e.target.value))} /> s</label>
            <label>Rounds <input type="number" min={1} max={20} value={settings.rounds} onChange={(e) => setDefault('rounds', Number(e.target.value))} /></label>
          </div>
          <p className="muted small">The preview uses these. Each kid's own times and rounds are set when a grown-up opens the
            exercise with them.</p>

          <b>🔁 Rounds repeat</b>
          <RangePicker scenes={scenes} value={script.repeat} onChange={setRepeat} none="Nothing (it plays once)" />

          <b>⇄ Copy for the other side</b>
          <OtherSide scenes={scenes} range={range} onCopy={copyOtherSide} />

          <b>🗣️ Voice</b>
          <div className="row wrap">
            <button className="btn small" onClick={linesForAll}>Make voice lines from the words</button>
            <button className="btn small" onClick={() => setTool(tool === 'split' ? null : 'split')}>✂️ Split one recording into the scenes</button>
          </div>
        </div>
      </div>

      {tool === 'split' && (
        <AudioSplitter
          targets={[...new Set(scenes.map((s) => s.voice?.line).filter(Boolean))].map((k) => library.find((l) => l.key === k) ?? { key: k, text: k })}
          note="These are this exercise's voice lines, in scene order (each once)." fromStart
          upload={(key, wav) => uploadLine(character.id, key, wav)}
          onSaved={() => reload()} onClose={() => setTool(null)} />
      )}

      <div className="ee-timeline">
        <div className="ee-strip" style={{ width: stripWidth }}>
          {range && layout[range[0]] && (
            <div className="ee-repeat" style={{ left: layout[range[0]].x, width: layout[range[1]].x + layout[range[1]].w - layout[range[0]].x }}>
              🔁 repeats for {settings.rounds} {settings.rounds === 1 ? 'round' : 'rounds'} (kid's setting)
            </div>
          )}
          {layout.map(({ s, t, x, w }, i) => (
            <div key={s.id} className={`ee-scene${s.id === selected ? ' selected' : ''}${s.id === nowScene ? ' now' : ''}`}
              style={{ left: x, width: w }} onClick={() => goTo(s.id)}>
              <div className="ee-scene-name">{i + 1}{s.notFirst ? ' ↺' : ''} {s.name}</div>
              <div className="ee-lane">
                {s.move && <div className="ee-blk move" style={{ width: pct(t.move || t.main, t.length) }}>{s.move.loop ? '↻ ' : t.move ? '' : '📌 '}{s.move.clip}</div>}
                {!s.move && <div className="ee-blk still" style={{ width: pct(t.main, t.length) }}>holds still</div>}
                {t.extra > 0 && <div className="ee-blk after" style={{ left: pct(t.main, t.length), width: pct(t.extra, t.length) }}>
                  {s.then === 'count' ? `count ${t.count}` : `wait ${t.extra}s`}</div>}
              </div>
              <div className="ee-lane">
                {s.voice && <div className="ee-blk voice" style={{ left: pct(s.voice.at, t.length), width: pct(t.voice - s.voice.at, t.length) }}>
                  {library.find((l) => l.key === s.voice.line)?.version ? '' : '⚠ '}{wordsOf(s.voice.line)}</div>}
              </div>
              <div className="ee-lane">
                <div className="ee-blk words" style={{ width: '100%' }}>{s.words || (s.voice ? wordsOf(s.voice.line) : '')}</div>
              </div>
            </div>
          ))}
          {head != null && <div className="ee-head" style={{ left: head }} />}
        </div>
      </div>
      <div className="row wrap ee-under">
        <button className="btn small" onClick={() => addScene(index >= 0 ? index : scenes.length - 1)}>＋ Add a scene{scene ? ' after this one' : ''}</button>
        <label className="inline small">Zoom <input type="range" min={10} max={160} value={zoom} onChange={(e) => setZoom(Number(e.target.value))} /></label>
        <span className="muted small">Moves · Voice (⚠ = not recorded yet) · Words. Tap a scene to edit it.</span>
      </div>

      {scene && (
        <SceneInspector key={scene.id} scene={scene} index={index} count={scenes.length} inRepeat={!!range && index >= range[0] && index <= range[1]}
          animations={animations} durationOf={durationOf} lines={lines} library={library} settings={settings} wordsOf={wordsOf}
          patch={patch} patchMove={patchMove} peek={peek}
          onMove={moveScene} onCopy={copyScene} onDelete={deleteScene} onAdd={() => addScene(index)}
          onLineFromWords={lineFromWords} onRecord={(key) => setRecording([{ key, text: wordsOf(key) }])}
          onFile={async (key, file) => {
            try {
              await uploadLine(character.id, key, await clipFromFile(file));
              reload();
            } catch (e) { setMessage(e.message); }
          }}
          hear={async (key) => { await voice.current.resume(); voice.current.stopAll(); voice.current.play(key); }}
          playScene={() => { goTo(scene.id); voice.current.resume(); player.current.play(); setPlaying(true); }} />
      )}
    </div>
  );
}

function RangePicker({ scenes, value, onChange, none }) {
  const label = (s, i) => `${i + 1}${s.name ? ` ${s.name}` : ''}`;
  const from = value?.from ?? '';
  const to = value?.to ?? '';
  return (
    <div className="row wrap small">
      <select value={from} onChange={(e) => onChange(e.target.value, e.target.value ? (to || e.target.value) : '')}>
        <option value="">{none}</option>
        {scenes.map((s, i) => <option key={s.id} value={s.id}>From scene {label(s, i)}</option>)}
      </select>
      {from && (
        <select value={to} onChange={(e) => onChange(from, e.target.value)}>
          {scenes.map((s, i) => <option key={s.id} value={s.id}>to scene {label(s, i)}</option>)}
        </select>
      )}
    </div>
  );
}

function OtherSide({ scenes, range, onCopy }) {
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const label = (s, i) => `${i + 1}${s.name ? ` ${s.name}` : ''}`;
  useEffect(() => {
    if (!from && range) { setFrom(scenes[range[0]].id); setTo(scenes[range[1]].id); }
  }, []);
  return (
    <div className="stack">
      <div className="row wrap small">
        <select value={from} onChange={(e) => { setFrom(e.target.value); if (!to) setTo(e.target.value); }}>
          <option value="">Scenes from…</option>
          {scenes.map((s, i) => <option key={s.id} value={s.id}>{label(s, i)}</option>)}
        </select>
        <select value={to} onChange={(e) => setTo(e.target.value)}>
          <option value="">…to</option>
          {scenes.map((s, i) => <option key={s.id} value={s.id}>{label(s, i)}</option>)}
        </select>
        <button className="btn small" onClick={() => onCopy(from, to)} disabled={!from || !to}>Copy</button>
      </div>
      <p className="muted small">Copies those scenes right after them, with left and right swapped in the words, the animations
        (.L ↔ .R) and the voice lines.</p>
    </div>
  );
}

function SceneInspector({
  scene, index, count, inRepeat, animations, durationOf, lines, library, settings, wordsOf,
  patch, patchMove, peek, onMove, onCopy, onDelete, onAdd, onLineFromWords, onRecord, onFile, hear, playScene
}) {
  const move = scene.move;
  const len = move ? durationOf(move.clip) : 0;
  const [cursor, setCursor] = useState(move ? move.from : 0);
  const file = useRef(null);
  const line = scene.voice ? library.find((l) => l.key === scene.voice.line) : null;

  function pickClip(clip) {
    if (!clip) return patch({ move: null });
    const d = durationOf(clip);
    patch({ move: { clip, from: 0, to: round2(d), speed: move?.speed ?? 1, loop: false } });
    setCursor(0);
    peek(clip, 0);
  }

  function scrub(t) {
    setCursor(t);
    peek(move.clip, t);
  }

  const num = (v, fallback) => (v === '' || !Number.isFinite(Number(v)) ? fallback : Number(v));

  return (
    <div className="card stack ee-inspector">
      <div className="row wrap">
        <b>Scene {index + 1}</b>
        <input className="grow" placeholder="Name (just for you, e.g. Under arm)" value={scene.name} maxLength={40} onChange={(e) => patch({ name: e.target.value })} />
        <button className="btn small" onClick={playScene}>▶ Play from here</button>
        <button className="btn small" onClick={() => onMove(-1)} disabled={index === 0} aria-label="Earlier">◀</button>
        <button className="btn small" onClick={() => onMove(1)} disabled={index === count - 1} aria-label="Later">▶</button>
        <button className="btn small" onClick={onCopy}>⧉ Copy</button>
        <button className="btn small" onClick={onAdd}>＋ After</button>
        <button className="btn small danger" onClick={onDelete}>✕ Delete</button>
      </div>

      <div className="ee-field">
        <span className="ee-label move">🎬 Move</span>
        <div className="stack">
          <select value={move?.clip ?? ''} onChange={(e) => pickClip(e.target.value)}>
            <option value="">No move: stay where the last one ended</option>
            {animations.map((a) => <option key={a.name} value={a.name}>{a.name} ({a.seconds.toFixed(1)} s)</option>)}
            {move && !animations.some((a) => a.name === move.clip) && <option value={move.clip}>⚠ {move.clip} (not in the model)</option>}
          </select>
          {move && (
            <>
              <div className="ee-clipbar">
                <input type="range" min={0} max={len || 1} step={0.01} value={Math.min(cursor, len)} onChange={(e) => scrub(Number(e.target.value))} />
                <i className="ee-mark from" style={{ left: `${(move.from / (len || 1)) * 100}%` }} />
                <i className="ee-mark to" style={{ left: `${(move.to / (len || 1)) * 100}%` }} />
              </div>
              <div className="row wrap small">
                <span>At {cursor.toFixed(2)} s</span>
                <button className="btn small" onClick={() => scrub(Math.max(0, round2(cursor - 0.05)))}>◀</button>
                <button className="btn small" onClick={() => scrub(Math.min(len, round2(cursor + 0.05)))}>▶</button>
                <label className="inline">From <input type="number" step={0.01} min={0} max={len} value={move.from} onChange={(e) => patchMove({ from: num(e.target.value, 0) })} /></label>
                <button className="btn small" onClick={() => patchMove({ from: round2(cursor) })}>Start here</button>
                <label className="inline">to <input type="number" step={0.01} min={0} max={len} value={move.to} onChange={(e) => patchMove({ to: num(e.target.value, 0) })} /></label>
                <button className="btn small" onClick={() => patchMove({ to: round2(cursor) })}>End here</button>
                <button className="btn small" onClick={() => patchMove({ from: move.to, to: move.from })} title="Play it backwards">⇄ Backwards</button>
              </div>
              <div className="row wrap small">
                <label className="inline">Speed
                  <select value={move.speed} onChange={(e) => patchMove({ speed: Number(e.target.value) })}>
                    {SPEEDS.map((s) => <option key={s} value={s}>{s}×</option>)}
                    {!SPEEDS.includes(move.speed) && <option value={move.speed}>{move.speed}×</option>}
                  </select>
                </label>
                <label className="inline check"><input type="checkbox" checked={move.loop} onChange={(e) => patchMove({ loop: e.target.checked })} /> Keep repeating it until the scene ends</label>
                <span className="muted">{move.from === move.to ? 'Holds this pose' : `${(Math.abs(move.to - move.from) / move.speed).toFixed(2)} s${move.to < move.from ? ', backwards' : ''}`}</span>
              </div>
            </>
          )}
        </div>
      </div>

      <div className="ee-field">
        <span className="ee-label voice">🗣️ Voice</span>
        <div className="stack">
          <div className="row wrap">
            <select className="grow" value={scene.voice?.line ?? ''} onChange={(e) => patch({ voice: e.target.value ? { line: e.target.value, at: scene.voice?.at ?? 0 } : null })}>
              <option value="">No voice</option>
              {lines.map((l) => <option key={l.key} value={l.key}>{l.version ? '' : '⚠ '}“{l.text}”</option>)}
              {scene.voice && !lines.some((l) => l.key === scene.voice.line) && <option value={scene.voice.line}>“{wordsOf(scene.voice.line) || scene.voice.line}”</option>}
            </select>
            {scene.voice && (
              <label className="inline small">starts at <input type="number" min={0} max={60} step={0.1} value={scene.voice.at}
                onChange={(e) => patch({ voice: { ...scene.voice, at: num(e.target.value, 0) } })} /> s</label>
            )}
          </div>
          {scene.voice && (
            <div className="row wrap small">
              <span className={line?.version ? 'status good' : 'status warn'}>{line?.version ? `✓ recorded, ${line.seconds.toFixed(1)} s` : '⚠ not recorded yet (the device voice says it)'}</span>
              <button className="btn small" onClick={() => hear(scene.voice.line)}>▶ Hear it</button>
              {canRecord && <button className="btn small" onClick={() => onRecord(scene.voice.line)}>🎙️ Record</button>}
              <button className="btn small" onClick={() => file.current.click()}>📁 Add a file</button>
              <input type="file" accept="audio/*,video/*" ref={file} style={{ display: 'none' }}
                onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) onFile(scene.voice.line, f); }} />
            </div>
          )}
          {!scene.voice && scene.words.trim() && (
            <div className="row"><button className="btn small" onClick={onLineFromWords}>＋ New voice line saying “{scene.words.trim()}”</button></div>
          )}
        </div>
      </div>

      <div className="ee-field">
        <span className="ee-label words">💬 Words</span>
        <div className="stack">
          <input value={scene.words} maxLength={160} onChange={(e) => patch({ words: e.target.value })}
            placeholder={scene.voice ? `Same as the voice line: “${wordsOf(scene.voice.line)}”` : 'What the screen says'} />
          <span className="muted small">Shown on the screen for the whole scene. Leave it empty to show what the voice line says.</span>
        </div>
      </div>

      <div className="ee-field">
        <span className="ee-label after">⏭ Then</span>
        <div className="row wrap">
          <select value={scene.then} onChange={(e) => patch({ then: e.target.value, seconds: null })}>
            <option value="go">Go straight on</option>
            <option value="wait">Wait for the kid</option>
            <option value="count">Count while they hold</option>
          </select>
          {scene.then !== 'go' && (
            <>
              <label className="inline check small">
                <input type="checkbox" checked={scene.seconds == null}
                  onChange={(e) => patch({ seconds: e.target.checked ? null : (scene.then === 'count' ? settings.hold : settings.wait) })} />
                their own {scene.then === 'count' ? 'hold' : 'wait'} time ({scene.then === 'count' ? settings.hold : settings.wait} s unless set)
              </label>
              {scene.seconds != null && (
                <label className="inline small">always <input type="number" min={scene.then === 'count' ? 1 : 0} max={scene.then === 'count' ? MAX_COUNT : 120}
                  value={scene.seconds} onChange={(e) => patch({ seconds: num(e.target.value, 1) })} /> s</label>
              )}
            </>
          )}
        </div>
      </div>

      {inRepeat && (
        <label className="inline check small">
          <input type="checkbox" checked={scene.notFirst} onChange={(e) => patch({ notFirst: e.target.checked })} />
          Skip it in the first round (like “Other side!” before starting again)
        </label>
      )}
    </div>
  );
}
