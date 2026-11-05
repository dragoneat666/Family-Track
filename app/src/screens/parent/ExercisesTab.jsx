import { useEffect, useState } from 'react';
import { api } from '../../api.js';
import { useParentCall } from './useParentCall.js';
import Exercises, { EXERCISES } from '../../exercises/Exercises.jsx';

// Run an exercise with a kid. Exercise partners (the characters who show the
// moves and talk the kids through them) are set up under Characters.
export default function ExercisesTab({ onAuthLost, show }) {
  const { error, call } = useParentCall(onAuthLost);
  const [kids, setKids] = useState([]);
  const [kidId, setKidId] = useState('');

  useEffect(() => {
    (async () => {
      const p = await call(() => api.get('/api/parent/profiles'));
      if (p) {
        const k = p.filter((x) => !x.isParent);
        setKids(k);
        if (k.length) setKidId(String(k[0].id));
      }
    })();
  }, []);

  const kid = kids.find((k) => String(k.id) === kidId) ?? null;

  function open(key) {
    show(<Exercises profile={kid} grownUp start={key} onExit={() => show(null)} />);
  }

  return (
    <div className="stack">
      {error && <p className="error">{error}</p>}

      <div className="card stack">
        <h3>🏃 Do an exercise</h3>
        <p className="muted">Exercises from the occupational therapist. Kids find them under 🏃 Exercises on their home screen.
          Hold times and rounds are set per kid, here (kids can see them but not change them).</p>
        <div className="row wrap">
          {kids.length > 0 && (
            <label className="inline">With
              <select value={kidId} onChange={(e) => setKidId(e.target.value)}>
                {kids.map((k) => <option key={k.id} value={k.id}>{k.emoji} {k.name}</option>)}
              </select>
            </label>
          )}
          {EXERCISES.map((e) => (
            <button key={e.key} className="btn primary" onClick={() => open(e.key)}>{e.emoji} {e.name}</button>
          ))}
        </div>
      </div>

      <div className="card stack">
        <h3>⭐ Exercise partners</h3>
        <p className="muted">A partner is one of your characters: it shows each move with animations you made for it, and talks the
          kids through it in lines you record. Set them up under <b>Characters</b> (upload the exercise model, mark the pauses,
          record the voice). Each kid picks their partner in their own Settings, from the characters they've finished building
          and any you've opened to everyone. Without one, the shape figure shows the moves.</p>
      </div>
    </div>
  );
}
