import { useEffect, useState } from 'react';
import { api } from '../../api.js';
import Build from '../Build.jsx';
import PartnerExercise from '../../exercises/PartnerExercise.jsx';
import { PUZZLE_LEVELS } from '../PuzzleLevel.jsx';
import { groupScenes } from '../../scenes/BackgroundPicker.jsx';

// Trying out one character the way the kids get it, without touching anyone's
// progress: build it (every piece unlocked), see it finished in front of any
// background and play its dances, and run its exercises.
export default function CharacterTest({ character: c, show }) {
  const [backgrounds, setBackgrounds] = useState(null);
  const [backgroundId, setBackgroundId] = useState('');
  const [level, setLevel] = useState('easy');
  const partnerOnly = c.kind === 'partner';
  const ready = c.status === 'ready';
  const dances = c.dances.filter((d) => d.status === 'ready');
  const exerciseReady = c.partner.exercise?.status === 'ready';
  const exercises = c.exercises.filter((e) => e.script.scenes.length);

  useEffect(() => {
    api.get('/api/parent/characters')
      .then((all) => setBackgrounds(all.filter((x) => x.kind === 'scene' && x.status === 'ready')))
      .catch(() => setBackgrounds([]));
  }, []);

  const background = backgrounds?.find((b) => String(b.id) === backgroundId) || null;
  const testCharacter = { ...c, dances };

  function build(finished) {
    show(<Build key={Date.now()} testCharacter={testCharacter} finished={finished} level={level}
      testBackground={background} testBackgrounds={backgrounds || []} onExit={() => show(null)} />);
  }

  function exercise(e) {
    show(<TestExercise character={c} exercise={e} onExit={() => show(null)} />);
  }

  return (
    <div className="stack">
      <p className="muted small">Nothing here is saved or changes any kid's progress.</p>

      {!partnerOnly && (
        <>
          <div className="card stack">
            <h3>🖼️ Background</h3>
            <p className="muted small">Shows behind {c.name} once it's finished (in both tests below). You can change it from the 🖼️ button
              while it's showing, too, even mid-dance.</p>
            {backgrounds && !backgrounds.length && <p className="muted">No backgrounds yet. Add them under Kids Setup → Backgrounds.</p>}
            {backgrounds?.length > 0 && (
              <select value={backgroundId} onChange={(e) => setBackgroundId(e.target.value)}>
                <option value="">No background</option>
                {groupScenes(backgrounds).map(([group, list]) => (
                  <optgroup key={group} label={group}>
                    {list.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                  </optgroup>
                ))}
              </select>
            )}
          </div>

          <div className="card stack">
            <h3>✨ See it finished</h3>
            <p className="muted small">{c.name} all put together, the way a kid sees it at the end.
              {c.hasRigged && dances.length ? ' Pick any of its dances to play.' : ' It has no dances yet (add them under Build).'}</p>
            <div className="row"><button className="btn primary" onClick={() => build(true)} disabled={!ready}>✨ Show {c.name} finished</button></div>
          </div>

          <div className="card stack">
            <h3>🧩 Test building</h3>
            <p className="muted small">Every piece starts unlocked so you can put the whole thing together, then try the dances.</p>
            <div className="row wrap">
              <label className="inline">Puzzle
                <select value={level} onChange={(e) => setLevel(e.target.value)}>
                  {PUZZLE_LEVELS.map((l) => <option key={l.key} value={l.key}>{l.emoji} {l.name}</option>)}
                </select>
              </label>
              <button className="btn primary" onClick={() => build(false)} disabled={!ready}>🧩 Build {c.name}</button>
            </div>
            {!ready && <p className="muted small">It's not ready yet.</p>}
          </div>
        </>
      )}

      <div className="card stack">
        <h3>🏃 Test exercises</h3>
        {!exerciseReady && <p className="muted small">{c.name} has no exercise model yet (under Exercise model).</p>}
        {exerciseReady && !exercises.length && <p className="muted small">No exercises with scenes yet (under Exercises).</p>}
        {exerciseReady && exercises.length > 0 && (
          <>
            <p className="muted small">Runs it exactly as a kid gets it. Hold time and rounds start at the exercise's own settings;
              changing them here isn't saved for any kid.</p>
            <div className="row wrap">
              {exercises.map((e) => <button key={e.id} className="btn" onClick={() => exercise(e)}>{e.emoji} {e.name}</button>)}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// An exercise with this character as the partner, for a pretend kid whose
// settings live only on this screen.
function TestExercise({ character: c, exercise, onExit }) {
  const [settings, setSettings] = useState({});
  const kid = {
    partner: {
      id: c.id, name: c.name, kind: c.kind, effect: c.partner.effect, voice: c.partner.voice,
      version: c.partner.exercise?.version ?? 0, animations: c.partner.exercise?.animations ?? [], exercises: c.exercises
    },
    settings,
    save: (patch) => setSettings((s) => ({ ...s, ...(patch.settings || {}) }))
  };
  return <PartnerExercise kid={kid} exercise={exercise} grownUp onExit={onExit} />;
}
