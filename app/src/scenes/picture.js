import { photoUrl } from '../recipes/data.js';

// A background's picture (it needs the sign-in, so it's fetched and kept on
// the tablet like recipe photos): { url, w, h }.
const sizes = new Map();
export async function scenePicture(c) {
  const url = await photoUrl(`/api/characters/${c.id}/scene.jpg?v=${c.version}`);
  if (!sizes.has(url)) {
    sizes.set(url, await new Promise((done, fail) => {
      const img = new Image();
      img.onload = () => done({ w: img.naturalWidth, h: img.naturalHeight });
      img.onerror = () => fail(new Error('The picture would not load.'));
      img.src = url;
    }));
  }
  return { url, ...sizes.get(url) };
}
