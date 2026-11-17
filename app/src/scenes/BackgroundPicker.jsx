import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { Sheet } from '../lists/ui.jsx';
import SceneThumb from './SceneThumb.jsx';

// Picking the background a kid's characters stand in front of: the ones
// they've finished, by group ("Transformers", …), or none. choices: a grown-up
// testing picks from these instead, and nothing is saved.
export default function BackgroundPicker({ profile, choices, current, onPicked, onClose }) {
  const [done, setDone] = useState(choices || null);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (choices) return;
    api.get(`/api/kids/${profile.id}/characters`)
      .then((r) => setDone(r.characters.filter((c) => c.kind === 'scene' && c.complete)))
      .catch((e) => setError(e.message));
  }, [profile?.id]);

  async function pick(id) {
    if (choices) {
      onPicked(id == null ? null : choices.find((c) => c.id === id));
      return;
    }
    setSaving(true);
    try {
      const r = await api.put(`/api/kids/${profile.id}/background`, { characterId: id });
      onPicked(r.background);
    } catch (e) {
      setError(e.message);
      setSaving(false);
    }
  }

  const groups = groupScenes(done || []);
  return (
    <Sheet title="🖼️ Pick a background" onClose={onClose} closeLabel="Close" wide>
      {error && <p className="error">{error}</p>}
      {!done && !error && <div className="spinner" />}
      {done && !done.length && <p className="muted">{choices ? 'No backgrounds yet. Add them under Kids Setup → Backgrounds.'
        : 'Finish a background puzzle first! Pick one on the Characters screen.'}</p>}
      {groups.map(([name, list]) => (
        <div key={name} className="stack tight">
          {groups.length > 1 && <h3 className="bg-group">{name}</h3>}
          <div className="bg-grid">
            {list.map((c) => (
              <button key={c.id} className={`bg-tile${current?.id === c.id ? ' active' : ''}`} disabled={saving} onClick={() => pick(c.id)}>
                <SceneThumb character={c} showAll />
                <span>{c.name}</span>
              </button>
            ))}
          </div>
        </div>
      ))}
      {done?.length > 0 && current && <button className="btn" disabled={saving} onClick={() => pick(null)}>No background</button>}
    </Sheet>
  );
}

// [[group name, backgrounds], …]: named groups A to Z, then ungrouped ones.
export function groupScenes(list) {
  const map = new Map();
  for (const c of list) {
    const g = c.group || '';
    if (!map.has(g)) map.set(g, []);
    map.get(g).push(c);
  }
  return [...map.entries()]
    .sort(([a], [b]) => (!a) - (!b) || a.localeCompare(b))
    .map(([g, l]) => [g || 'Other backgrounds', l]);
}
