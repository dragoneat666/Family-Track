import { useSyncExternalStore } from 'react';
import { registerPlugin } from '@capacitor/core';
import { isNative } from '../api.js';

// Cooking mode's helpers (android/.../cook in the app):
//  - the screen kept on while cooking (the app, or a browser's wake lock)
//  - "Yes chef, next": the phone's on-device speech recognizer, only while
//    cooking mode is open and on screen, so nothing said leaves the phone
//    (the app only; Android 12 and up)
//  - reading a step out loud
//  - kitchen timers: in the app, a ringing banner; on the phone, also an
//    alarm that goes off with the app closed (see CookTimers.java).

const Native = isNative ? registerPlugin('FamilyCook') : null;

// ---------- the screen ----------

let wakeLock = null;
export async function keepAwake(on) {
  if (Native) return Native.keepAwake({ on }).catch(() => {});
  try {
    if (on && navigator.wakeLock && !wakeLock) {
      wakeLock = await navigator.wakeLock.request('screen');
      wakeLock.addEventListener('release', () => { wakeLock = null; });
    } else if (!on && wakeLock) {
      await wakeLock.release();
      wakeLock = null;
    }
  } catch { /* not allowed here: fine */ }
  return undefined;
}

// ---------- voice ----------

export const voice = {
  // { available, allowed }
  status: () => (Native ? Native.voiceStatus() : Promise.resolve({ available: false, allowed: false })),
  // { ok, reason: 'unavailable' | 'denied' }
  listen: () => (Native ? Native.listen() : Promise.resolve({ ok: false, reason: 'unavailable' })),
  stop: () => Native?.stopListening().catch(() => {}),
  // fn({ texts, final }) / fn({ state }); returns a remover.
  onHeard(fn) {
    if (!Native) return () => {};
    const h = Native.addListener('heard', fn);
    return () => h.then((x) => x.remove());
  },
  onState(fn) {
    if (!Native) return () => {};
    const h = Native.addListener('voice', fn);
    return () => h.then((x) => x.remove());
  }
};

export async function speak(text) {
  if (Native) return Native.speak({ text }).catch(() => {});
  if (!window.speechSynthesis) return undefined;
  return new Promise((done) => {
    const u = new SpeechSynthesisUtterance(text);
    u.onend = done;
    u.onerror = done;
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(u);
  });
}
export function stopSpeaking() {
  if (Native) Native.stopSpeaking().catch(() => {});
  else window.speechSynthesis?.cancel();
}

const NUMBERS = {
  a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
  thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20, thirty: 30,
  forty: 40, fifty: 50, sixty: 60, ninety: 90
};
const num = (w) => (/^\d+(\.\d+)?$/.test(w) ? Number(w) : NUMBERS[w]);

// "set a timer for 10 minutes", "twenty five minute timer", "half an hour",
// "two and a half minutes", "90 seconds" → minutes (or null).
export function timerMinutes(t) {
  if (/an hour and a half|hour and a half|one and a half hours?/.test(t)) return 90;
  if (/half an hour|half hour/.test(t)) return 30;
  let total = 0;
  let found = false;
  const words = t.replace(/-/g, ' ').split(/\s+/);
  for (let i = 0; i < words.length; i++) {
    let n = num(words[i]);
    if (n == null) continue;
    let j = i + 1;
    if (n >= 20 && n % 10 === 0 && num(words[j]) < 10) { n += num(words[j]); j++; } // "twenty five"
    if (words[j] === 'and' && words[j + 1] === 'a' && words[j + 2] === 'half') { n += 0.5; j += 3; }
    const u = (words[j] || '').replace(/s$/, '');
    if (u === 'minute' || u === 'min') total += n;
    else if (u === 'hour' || u === 'hr') total += n * 60;
    else if (u === 'second' || u === 'sec') total += n / 60;
    else continue;
    found = true;
    i = j;
  }
  return found && total > 0 ? total : null;
}

// What was said to the chef → a command, or null if it wasn't for us.
// Recognizers hear "chef" many ways ("Jeff", "shef", "chief").
const WAKE = /\b(?:yes |yeah |ok |okay |hey )?(?:chef|chefs|jeff|shef|chief|sheff|shep)\b[,.!]?\s*(.*)$/i;
export function command(heard) {
  const m = WAKE.exec(heard.toLowerCase());
  if (!m) return null;
  const t = m[1].trim();
  if (/\b(timer|minutes?|hours?|seconds?)\b/.test(t) && !/\b(stop|cancel|off|how long|left)\b/.test(t)) {
    const minutes = timerMinutes(t);
    return minutes ? { cmd: 'timer', minutes } : { cmd: 'unknown', heard: t };
  }
  if (/\b(stop|cancel|quiet|off|enough)\b/.test(t)) return { cmd: 'stop' };
  if (/\b(how long|time left|how much time|timers?)\b/.test(t)) return { cmd: 'left' };
  if (/\b(next|continue|go on|forward|then what|what's next|whats next)\b/.test(t)) return { cmd: 'next' };
  if (/\b(back|previous|before|last step|go back)\b/.test(t)) return { cmd: 'back' };
  if (/\b(ingredients?|what do i need|shopping)\b/.test(t)) return { cmd: 'ingredients' };
  if (/\b(read|repeat|again|say that|what was that|what's that|pardon|huh)\b/.test(t)) return { cmd: 'read' };
  if (/\b(start|first step|beginning|top)\b/.test(t)) return { cmd: 'start' };
  if (!t) return { cmd: 'wake' };
  return { cmd: 'unknown', heard: t };
}

// "Simmer for 10 minutes" → 10; "bake 25-30 minutes" → 25; "1 hour" → 60.
export function stepMinutes(text) {
  const m = /(\d+(?:\.\d+)?)(?:\s*(?:-|–|to)\s*(\d+(?:\.\d+)?))?\s*(minutes?|mins?|hours?|hrs?)\b/i.exec(text);
  if (!m) return null;
  const n = Number(m[1]);
  return /^h/i.test(m[3]) ? n * 60 : n;
}

// ---------- timers ----------

const KEY = 'ft.cook.timers';
const listeners = new Set();
let timers = (() => { try { return JSON.parse(localStorage.getItem(KEY)) || []; } catch { return []; } })();
let ticker = null;
let beeper = null;

function publish(next) {
  timers = next;
  try { localStorage.setItem(KEY, JSON.stringify(timers)); } catch { /* fine */ }
  for (const fn of listeners) fn();
  run();
}

export function useTimers() {
  return useSyncExternalStore((fn) => {
    listeners.add(fn);
    return () => listeners.delete(fn);
  }, () => timers);
}

export function startTimer(label, minutes) {
  const id = `t${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const endAt = Date.now() + Math.round(minutes * 60000);
  publish([...timers, { id, label, endAt, minutes, ringing: false }]);
  Native?.timerStart({ id, label, endAt }).catch(() => {});
  return id;
}

export function stopTimer(id) {
  publish(timers.filter((t) => t.id !== id));
  Native?.timerStop({ id }).catch(() => {});
}

export const stopRinging = () => timers.filter((t) => t.ringing).forEach((t) => stopTimer(t.id));

export function addMinute(id) {
  const t = timers.find((x) => x.id === id);
  if (!t) return;
  const endAt = (t.ringing ? Date.now() : t.endAt) + 60000;
  publish(timers.map((x) => (x.id === id ? { ...x, endAt, ringing: false } : x)));
  Native?.timerStop({ id }).then(() => Native.timerStart({ id, label: t.label, endAt })).catch(() => {});
}

// Every second while there are timers: ring the ones that are up.
function run() {
  if (timers.length && !ticker) {
    ticker = setInterval(() => {
      const now = Date.now();
      if (timers.some((t) => !t.ringing && t.endAt <= now)) {
        publish(timers.map((t) => (!t.ringing && t.endAt <= now ? { ...t, ringing: true } : t)));
      }
    }, 1000);
  } else if (!timers.length && ticker) {
    clearInterval(ticker);
    ticker = null;
  }
  // The app rings through the phone's alarm notification; a browser beeps.
  const ringing = timers.some((t) => t.ringing);
  if (!Native && ringing && !beeper) beeper = beep();
  if ((!ringing || Native) && beeper) {
    beeper();
    beeper = null;
  }
}

function beep() {
  let ctx;
  try { ctx = new AudioContext(); } catch { return () => {}; }
  const ring = () => {
    for (const at of [0, 0.25, 0.5]) {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.frequency.value = 880;
      g.gain.setValueAtTime(0.25, ctx.currentTime + at);
      g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + at + 0.2);
      o.connect(g).connect(ctx.destination);
      o.start(ctx.currentTime + at);
      o.stop(ctx.currentTime + at + 0.2);
    }
  };
  ring();
  const t = setInterval(ring, 1500);
  return () => {
    clearInterval(t);
    ctx.close().catch(() => {});
  };
}

// The phone's own record wins: Stop on the notification, or a timer that
// went off while the app was closed.
async function syncNative() {
  if (!Native) return;
  try {
    const { timers: there } = await Native.timerList();
    const byId = new Map(there.map((t) => [t.id, t]));
    const next = timers.filter((t) => byId.has(t.id)).map((t) => ({ ...t, ringing: t.ringing || byId.get(t.id).ringing }));
    for (const t of there) if (!next.some((x) => x.id === t.id)) next.push({ id: t.id, label: t.label, endAt: t.endAt, ringing: t.ringing });
    if (JSON.stringify(next) !== JSON.stringify(timers)) publish(next);
  } catch { /* fine */ }
}

if (Native) {
  Native.addListener('timer', ({ id, what }) => {
    if (what === 'stopped') publish(timers.filter((t) => t.id !== id));
    else if (what === 'ringing') publish(timers.map((t) => (t.id === id ? { ...t, ringing: true } : t)));
  });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) syncNative(); });
  syncNative();
}
run();

export function leftText(ms) {
  const s = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}` : `${m}:${String(sec).padStart(2, '0')}`;
}

// "4 minutes", "1 hour 5 minutes", "30 seconds" for reading out.
export function leftWords(ms) {
  const s = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (!h && !m) return `${s} seconds`;
  return [h && `${h} ${h === 1 ? 'hour' : 'hours'}`, m && `${m} ${m === 1 ? 'minute' : 'minutes'}`].filter(Boolean).join(' ');
}
