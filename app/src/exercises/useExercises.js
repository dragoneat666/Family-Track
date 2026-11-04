import { useEffect, useState } from 'react';
import { api } from '../api.js';

// A kid's coach and exercise settings, kept on the server so they're the
// same on every device. Without a kid (nobody picked) they only last while
// the screen is open.
export function useExercises(profile) {
  const [coaches, setCoaches] = useState([]);
  const [state, setState] = useState({ coachId: null, settings: {} });
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let gone = false;
    Promise.all([api.get('/api/coaches'), profile ? api.get(`/api/kids/${profile.id}/exercises`) : null])
      .then(([c, s]) => {
        if (gone) return;
        setCoaches(c);
        if (s) setState(s);
        setLoaded(true);
      })
      .catch((e) => { if (!gone) { setError(e.message); setLoaded(true); } });
    return () => { gone = true; };
  }, [profile?.id]);

  async function save(patch) {
    setState((s) => ({
      coachId: 'coachId' in patch ? patch.coachId : s.coachId,
      settings: { ...s.settings, ...(patch.settings || {}) }
    }));
    if (!profile) return;
    try {
      setState(await api.put(`/api/kids/${profile.id}/exercises`, patch));
    } catch (e) {
      setError(e.message);
    }
  }

  const coach = coaches.find((c) => c.id === state.coachId) ?? null;
  return { loaded, error, coaches, coach, settings: state.settings, save };
}
