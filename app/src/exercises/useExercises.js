import { useEffect, useState } from 'react';
import { api } from '../api.js';

// A kid's exercise partner, the partners they can pick (characters they've
// finished building, plus any open to everyone), and their exercise settings.
// Kept on the server so they're the same on every device.
export function useExercises(profile) {
  const [state, setState] = useState({ partnerId: null, partners: [], settings: {} });
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let gone = false;
    if (!profile) {
      setLoaded(true);
      return;
    }
    api.get(`/api/kids/${profile.id}/exercises`)
      .then((s) => { if (!gone) { setState(s); setLoaded(true); } })
      .catch((e) => { if (!gone) { setError(e.message); setLoaded(true); } });
    return () => { gone = true; };
  }, [profile?.id]);

  async function save(patch) {
    setState((s) => ({
      ...s,
      partnerId: 'partnerId' in patch ? patch.partnerId : s.partnerId,
      settings: { ...s.settings, ...(patch.settings || {}) }
    }));
    if (!profile) return;
    try {
      setState(await api.put(`/api/kids/${profile.id}/exercises`, patch));
    } catch (e) {
      setError(e.message);
    }
  }

  const partner = state.partners.find((p) => p.id === state.partnerId) ?? null;
  return { loaded, error, partners: state.partners, partner, settings: state.settings, save };
}
