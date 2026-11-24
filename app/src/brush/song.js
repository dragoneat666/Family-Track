import { api } from '../api.js';
import { photoUrl } from '../recipes/data.js';

// The song for one brush (server: a random one from the group of the
// character the kid is working on), loaded and ready: { name, play(),
// pause(), stop() }, or null when there's none (or it won't load: brushing
// goes on without it). The file is kept on the tablet after the first time.
export async function brushSong(profile) {
  if (!profile?.id) return null;
  try {
    const { song } = await api.get(`/api/kids/${profile.id}/brush-song`);
    if (!song) return null;
    const url = await photoUrl(`/api/songs/${song.id}/file?v=${song.version}`);
    const audio = new Audio(url);
    audio.loop = true; // shorter than the brush: it starts over
    audio.preload = 'auto';
    let stopped = false;
    return {
      name: song.name,
      play() {
        if (!stopped && audio.paused) audio.play().catch(() => {});
      },
      pause() {
        if (!audio.paused) audio.pause();
      },
      stop() {
        stopped = true;
        audio.pause();
      }
    };
  } catch {
    return null;
  }
}
