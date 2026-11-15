import { registerPlugin } from '@capacitor/core';
import { isNative } from './api.js';

// Things coming into the app to make a recipe from (android/.../share):
// "Share → Family Track" from another app (a link or text, or screenshots,
// read on the phone), and what "Read a reel as it plays" read. The grown-ups'
// area opens them as a recipe import; only taken while a grown-up is signed
// in, otherwise they wait for one.
//
// Each is { id, text, from: 'share' | 'screenshots' | 'screen', steady?, error? }.
const Native = isNative ? registerPlugin('FamilyShare') : null;
const handled = new Set();

// fn(item) for what came before this (and is still waiting) and for each one
// from now on. Returns a remover.
export function onShared(fn) {
  if (!Native) return () => {};
  let live = true;
  const got = (item) => {
    if (!live || !item?.id || handled.has(item.id)) return;
    handled.add(item.id);
    fn(item);
  };
  Native.take().then(got).catch(() => {});
  const h = Native.addListener('shared', got);
  return () => {
    live = false;
    h.then((x) => x.remove());
  };
}
