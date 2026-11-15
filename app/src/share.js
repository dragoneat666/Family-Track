import { registerPlugin } from '@capacitor/core';
import { isNative } from './api.js';

// "Share → Family Track" from another app (android/.../share): a link or
// text, which the grown-ups' area opens as a recipe import. Only taken
// while a grown-up is signed in; otherwise it waits for one.
const Native = isNative ? registerPlugin('FamilyShare') : null;

// fn(text) for what was shared before this (and is still waiting) and for
// each share from now on. Returns a remover.
export function onShared(fn) {
  if (!Native) return () => {};
  let live = true;
  const take = () => Native.take().then((r) => { if (live && r?.text) fn(r.text); }).catch(() => {});
  take();
  const h = Native.addListener('shared', take);
  return () => {
    live = false;
    h.then((x) => x.remove());
  };
}
