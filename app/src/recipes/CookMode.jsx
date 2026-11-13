import { useEffect, useRef, useState } from 'react';
import { Sheet } from '../lists/ui.jsx';
import { ingredientText } from './data.js';
import {
  keepAwake, voice, speak, stopSpeaking, command, stepMinutes, useTimers, startTimer, stopTimer, stopRinging, addMinute, leftText, leftWords
} from './cook.js';

const VOICE_ON = 'ft.cook.voice';
const voiceSaved = () => { try { return localStorage.getItem(VOICE_ON) === '1'; } catch { return false; } };

// The recipe one step at a time, in big letters, with the screen kept on.
// Back / Next (or swipe), the ingredients any time, kitchen timers, and in
// the app "Yes chef, next / back / read it / ingredients / set a timer for
// 10 minutes / stop / how long" (heard on the phone itself, only while this
// is open). by: the amounts' scale from the recipe page.
export default function CookMode({ r, by, onClose }) {
  const pages = [{ kind: 'ingredients' }];
  let section = '';
  for (const s of r.steps) {
    if (s.section) section = s.section;
    else pages.push({ kind: 'step', text: s.text, section, n: pages.length });
  }
  const steps = pages.length - 1;
  const [page, setPage] = useState(steps && r.ingredients.length === 0 ? 1 : 0);
  const [showIngredients, setShowIngredients] = useState(false);
  const [crossed, setCrossed] = useState(new Set());
  const [voiceOn, setVoiceOn] = useState(voiceSaved);
  const [voiceState, setVoiceState] = useState('off'); // off | starting | listening | unavailable | denied | downloading
  const [said, setSaid] = useState(''); // what the chef just heard (or a note)
  const [addingTimer, setAddingTimer] = useState(false);
  const timers = useTimers();
  const pageRef = useRef(page);
  pageRef.current = page;
  const swipe = useRef(null);
  const lastCmd = useRef({ cmd: '', at: 0 });

  // ---------- reading out ----------
  const ingredientsSpoken = () => r.ingredients.map((i) => (i.section ? `${i.section}:` : ingredientText(i, by))).join('. ');
  const pageSpoken = (p) => (pages[p].kind === 'ingredients'
    ? `Ingredients. ${ingredientsSpoken()}`
    : `Step ${pages[p].n}${pages[p].section ? `, ${pages[p].section}` : ''}. ${pages[p].text}`);
  const go = (p, read) => {
    const next = Math.max(0, Math.min(steps, p));
    setPage(next);
    if (read) speak(pageSpoken(next));
    else stopSpeaking();
  };

  // ---------- the screen stays on ----------
  useEffect(() => {
    keepAwake(true);
    const again = () => { if (!document.hidden) keepAwake(true); }; // (a browser drops it when hidden)
    document.addEventListener('visibilitychange', again);
    return () => {
      document.removeEventListener('visibilitychange', again);
      keepAwake(false);
      stopSpeaking();
    };
  }, []);

  // ---------- voice ----------
  useEffect(() => {
    if (!voiceOn) {
      setVoiceState('off');
      return undefined;
    }
    let live = true;
    setVoiceState('starting');
    const offState = voice.onState(({ state }) => live && setVoiceState(state));
    const offHeard = voice.onHeard(({ texts, final }) => {
      if (!live || !final) return;
      const c = texts.map(command).find(Boolean);
      if (!c) return;
      // (The same thing heard twice in a row is said once.)
      const now = Date.now();
      if (c.cmd === lastCmd.current.cmd && now - lastCmd.current.at < 1500) return;
      lastCmd.current = { cmd: c.cmd, at: now };
      act(c, texts[0]);
    });
    voice.listen().then((res) => {
      if (!live) return;
      if (!res.ok) {
        setVoiceState(res.reason || 'unavailable');
        setVoiceOn(false);
      }
    });
    return () => {
      live = false;
      offState();
      offHeard();
      voice.stop();
    };
  }, [voiceOn]);

  function toggleVoice() {
    const on = !voiceOn;
    setVoiceOn(on);
    setSaid('');
    try { localStorage.setItem(VOICE_ON, on ? '1' : '0'); } catch { /* fine */ }
  }

  function act(c, heard) {
    const p = pageRef.current;
    setSaid(`“${heard}”`);
    switch (c.cmd) {
      case 'next':
        if (p >= steps) speak("That's the last step.");
        else go(p + 1, true);
        break;
      case 'back':
        if (p <= 0) speak("That's the start.");
        else go(p - 1, true);
        break;
      case 'start': go(0, true); break;
      case 'read': speak(pageSpoken(p)); break;
      case 'ingredients': speak(r.ingredients.length ? `You need: ${ingredientsSpoken()}` : 'This recipe has no ingredients written down.'); break;
      case 'timer': {
        const label = pages[p].kind === 'step' ? `Step ${pages[p].n}` : r.title;
        startTimer(label, c.minutes);
        speak(`Timer set for ${leftWords(c.minutes * 60000)}.`);
        break;
      }
      case 'stop':
        if (timersRef.current.some((t) => t.ringing)) stopRinging();
        else stopSpeaking();
        break;
      case 'left': {
        const running = timersRef.current.filter((t) => !t.ringing);
        speak(running.length
          ? running.map((t) => `${t.label}: ${leftWords(t.endAt - Date.now())} left`).join('. ')
          : 'No timers are running.');
        break;
      }
      case 'wake': speak('Yes?'); break;
      default: setSaid(`Didn't catch that: “${heard}”`);
    }
  }
  const timersRef = useRef(timers);
  timersRef.current = timers;

  // ---------- swiping ----------
  const down = (e) => { swipe.current = { x: e.clientX, y: e.clientY }; };
  const up = (e) => {
    const s = swipe.current;
    swipe.current = null;
    if (!s) return;
    const dx = e.clientX - s.x;
    if (Math.abs(dx) > 70 && Math.abs(dx) > Math.abs(e.clientY - s.y) * 1.5) go(page + (dx < 0 ? 1 : -1));
  };

  const cur = pages[page];
  const minutes = cur.kind === 'step' ? stepMinutes(cur.text) : null;
  const voiceNote = {
    starting: 'Starting to listen…',
    listening: 'Say “Yes chef, next”, “back”, “read it”, “ingredients”, “set a timer for 10 minutes”, “stop” or “how long”.',
    downloading: 'The phone is getting its offline speech for your language. Voice will start once it has it.',
    unavailable: "Voice needs the app on a phone with Android 12 or newer that can recognize speech offline.",
    denied: 'Voice needs the microphone. Allow it in the phone\'s settings for Family Track to use it.'
  }[voiceState];

  return (
    <div className="cook" role="dialog" aria-label={`Cooking ${r.title}`}>
      <header className="cook-head">
        <button data-back className="btn" onClick={onClose}>✕ Done</button>
        <b className="cook-title">{r.title}</b>
        <button className={`btn cook-voice${voiceOn ? ' on' : ''}`} onClick={toggleVoice} aria-pressed={voiceOn}>
          🎙 {voiceOn ? (voiceState === 'listening' ? 'Listening' : 'Voice on') : 'Voice'}
        </button>
      </header>

      <TimerBar onAdd={() => setAddingTimer(true)} big />

      <main className="cook-page" onPointerDown={down} onPointerUp={up}>
        {cur.kind === 'ingredients' ? (
          <>
            <p className="cook-step-n">Ingredients{by !== 1 ? ' (amounts changed)' : ''}</p>
            <IngredientList r={r} by={by} crossed={crossed} setCrossed={setCrossed} big />
            {!r.ingredients.length && <p className="cook-text muted">No ingredients written down.</p>}
          </>
        ) : (
          <>
            <p className="cook-step-n">Step {cur.n} of {steps}{cur.section ? ` · ${cur.section}` : ''}</p>
            <p className="cook-text">{cur.text}</p>
            {minutes && (
              <button className="btn cook-step-timer" onClick={() => startTimer(`Step ${cur.n}`, minutes)}>
                ⏲ Start a {leftWords(minutes * 60000)} timer
              </button>
            )}
          </>
        )}
      </main>

      {(voiceOn || voiceState === 'unavailable' || voiceState === 'denied') && (
        <p className="cook-voice-note">{said || voiceNote}</p>
      )}

      <footer className="cook-nav">
        <button className="btn cook-nav-btn" disabled={page === 0} onClick={() => go(page - 1)}>◀ Back</button>
        {page > 0 && r.ingredients.length > 0 && <button className="btn" onClick={() => setShowIngredients(true)}>🥕</button>}
        {page < steps
          ? <button className="btn primary cook-nav-btn" onClick={() => go(page + 1)}>{page === 0 ? 'First step ▶' : 'Next ▶'}</button>
          : <button className="btn primary cook-nav-btn" onClick={onClose}>✓ Finished</button>}
      </footer>

      {showIngredients && (
        <Sheet title="Ingredients" onClose={() => setShowIngredients(false)}>
          <IngredientList r={r} by={by} crossed={crossed} setCrossed={setCrossed} />
        </Sheet>
      )}
      {addingTimer && <AddTimer label={cur.kind === 'step' ? `Step ${cur.n}` : r.title} onClose={() => setAddingTimer(false)} />}
    </div>
  );
}

function IngredientList({ r, by, crossed, setCrossed, big }) {
  const cross = (k) => setCrossed((s) => { const n = new Set(s); if (n.has(k)) n.delete(k); else n.add(k); return n; });
  return (
    <ul className={`rec-ingredients${big ? ' cook-ingredients' : ''}`}>
      {r.ingredients.map((i, k) => (i.section
        ? <li key={k} className="rec-sub">{i.section}</li>
        : <li key={k} className={crossed.has(k) ? 'got' : ''} onClick={() => cross(k)}>{ingredientText(i, by)}</li>))}
    </ul>
  );
}

// The timers running (and ringing), each with a countdown. onAdd: show a
// "+ Timer" button.
export function TimerBar({ onAdd, big }) {
  const timers = useTimers();
  const [, redraw] = useState(0);
  // The countdowns.
  useEffect(() => {
    if (!timers.length) return undefined;
    const t = setInterval(() => redraw((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, [timers.length]);
  if (!timers.length && !onAdd) return null;
  const now = Date.now();
  return (
    <div className={`timer-bar${big ? ' big' : ''}`}>
      {timers.map((t) => (t.ringing ? (
        <div key={t.id} className="timer ringing">
          <span>⏰ <b>{t.label}</b> is done!</span>
          <button className="btn small" onClick={() => addMinute(t.id)}>+1 min</button>
          <button className="btn primary small" onClick={() => stopTimer(t.id)}>Stop</button>
        </div>
      ) : (
        <div key={t.id} className="timer">
          <span>⏲ {t.label} <b className="timer-left">{leftText(t.endAt - now)}</b></span>
          <button className="btn small" onClick={() => stopTimer(t.id)} aria-label={`Cancel ${t.label}`}>✕</button>
        </div>
      )))}
      {onAdd && <button className="btn small timer-add" onClick={onAdd}>⏲ + Timer</button>}
    </div>
  );
}

function AddTimer({ label: start, onClose }) {
  const [label, setLabel] = useState(start);
  const [min, setMin] = useState('');
  const go = (m) => {
    startTimer(label.trim() || 'Timer', m);
    onClose();
  };
  return (
    <Sheet title="New timer" onClose={onClose} closeLabel="Cancel">
      <label>Name<input value={label} onChange={(e) => setLabel(e.target.value)} maxLength={40} /></label>
      <div className="row wrap">
        {[1, 3, 5, 10, 15, 20, 30, 45, 60].map((m) => <button key={m} className="cal-chip" onClick={() => go(m)}>{m < 60 ? `${m} min` : '1 hour'}</button>)}
      </div>
      <div className="row plan-note">
        <input type="number" inputMode="numeric" min="1" max="600" value={min} onChange={(e) => setMin(e.target.value)} placeholder="Minutes" />
        <button className="btn primary" disabled={!(Number(min) > 0 && Number(min) <= 600)} onClick={() => go(Number(min))}>Start</button>
      </div>
    </Sheet>
  );
}
