import { registerPlugin } from '@capacitor/core';
import { isNative } from '../api.js';

// Recipes off the screen, in the app (android/.../read): the text in
// screenshots, or on screen while a video plays, read on the phone. Only
// the text is used; the pictures aren't kept or sent anywhere.
const Native = isNative ? registerPlugin('FamilyRead') : null;
export const canReadScreen = !!Native;

// The apps' own bits that end up in a screenshot: counts, times, buttons.
const NOISE = /^(?:[\d.,]+\s*[kKmM]?|\d{1,2}:\d{2}(?::\d{2})?|\d+\s*[smhdw]|\d{1,3}\s*%|reply|replies|see translation|more|less|follow|following|like|likes|share|send|save|saved|comment|comments|remix|sponsored|suggested for you|search|home|reels|friends|inbox|profile|for you|explore|live|add comment.*|add a comment.*|liked by .*|view all .* comments|view replies.*|original audio.*|.*· original audio|see more|\.\.\.\s*more|…\s*more)$/i;
export const cleanScreenText = (text) => text.split('\n').map((l) => l.trim()).filter((l) => l && !NOISE.test(l)).join('\n');

// Screenshots picked in the app → their text ({ text, error }).
export async function readScreenshots(files) {
  const images = await Promise.all([...files].slice(0, 10).map((f) => new Promise((done, fail) => {
    const r = new FileReader();
    r.onload = () => done(r.result);
    r.onerror = () => fail(new Error("That picture couldn't be opened"));
    r.readAsDataURL(f);
  })));
  const r = await Native.readImages({ images });
  return { text: cleanScreenText(r.text || ''), error: r.error || null };
}

// "Read a reel as it plays": { ok } or { ok: false, reason: 'overlay' |
// 'denied' | 'old' | 'failed' }. On ok, Family Track steps aside for the
// video; what was read comes back as a share (share.js, from: 'screen').
export const watchReel = () => Native.watch();

export const WATCH_WHY = {
  overlay: 'First, Family Track needs "Display over other apps" (for the little bubble you tap when the video is done). Turn it on in the page that just opened, come back, and tap again.',
  denied: 'Family Track needs the OK to read the screen while the video plays.',
  old: 'This needs Android 10 or newer.',
  failed: "Couldn't start reading the screen."
};

// The video a screen reading or screenshots are for (its link), so the
// recipe keeps it. Remembered for half an hour.
const LINK = 'ft.read.link';
export function rememberLink(link) {
  try {
    if (link) localStorage.setItem(LINK, JSON.stringify({ link, at: Date.now() }));
    else localStorage.removeItem(LINK);
  } catch { /* fine */ }
}
export function takeLink() {
  try {
    const v = JSON.parse(localStorage.getItem(LINK));
    localStorage.removeItem(LINK);
    return v && Date.now() - v.at < 30 * 60 * 1000 ? v.link : null;
  } catch {
    return null;
  }
}
