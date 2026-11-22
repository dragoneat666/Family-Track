import { registerPlugin } from '@capacitor/core';
import { isNative } from '../api.js';
import { scenePicture } from './picture.js';

// Making a finished picture the phone's or tablet's background, in the
// Android app (android/.../wallpaper). In a browser there's no such thing.
const Native = isNative ? registerPlugin('FamilyWallpaper') : null;

export const wallpaper = {
  available: !!Native,

  // Can this device's background be changed? (Some managed ones can't.)
  async allowed() {
    if (!Native) return false;
    try { return !!(await Native.available()).available; } catch { return false; }
  },

  // where: 'home' | 'lock' | 'both'. c: the background (id, version).
  async set(c, where) {
    if (!Native) throw new Error('Backgrounds can only be set in the Android app.');
    const { url } = await scenePicture(c);
    const blob = await (await fetch(url)).blob();
    const image = await new Promise((done, fail) => {
      const r = new FileReader();
      r.onload = () => done(String(r.result).split(',')[1] || '');
      r.onerror = () => fail(new Error('The picture would not load.'));
      r.readAsDataURL(blob);
    });
    await Native.set({ image, where });
  }
};
