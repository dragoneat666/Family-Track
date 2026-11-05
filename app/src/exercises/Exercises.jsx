import { useState } from 'react';
import Metronome from './Metronome.jsx';
import HugStarfish from './HugStarfish.jsx';
import { useExercises } from './useExercises.js';

// Exercises from the occupational therapist. Add new ones to this list.
export const EXERCISES = [
  { key: 'metronome', emoji: '🥁', name: 'Metronome', blurb: 'Clap along to the beat', Screen: Metronome },
  { key: 'starfish', emoji: '⭐', name: 'Hug & Starfish', blurb: 'Hug, cross, sit up, hold… starfish!', Screen: HugStarfish }
];

// The list of exercises; tapping one opens it. Kids pick their exercise
// partner in Settings.
export default function Exercises({ profile, grownUp = false, onExit, start = null }) {
  const [open, setOpen] = useState(start);
  const kid = useExercises(profile);
  const current = EXERCISES.find((e) => e.key === open);
  if (current) {
    const { Screen } = current;
    return <Screen profile={profile} kid={kid} grownUp={grownUp} onExit={() => (start ? onExit() : setOpen(null))} />;
  }

  return (
    <div className="exercise-screen">
      <header className="build-header">
        <button className="btn" onClick={onExit}>← Back</button>
        <div className="build-title">🏃 Exercises</div>
        {kid.partner && <span className="coach-chip">With {kid.partner.name}</span>}
      </header>
      <div className="exercise-list">
        {EXERCISES.map((e) => (
          <button key={e.key} className="big-action exercise" onClick={() => setOpen(e.key)}>
            <span className="big-emoji">{e.emoji}</span>
            <span className="big-label">{e.name}</span>
            <span className="small">{e.blurb}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

const KIND_EMOJI = { build: '🤖', dress: '👗', partner: '⭐' };

// Tiles for picking an exercise partner (kid Settings).
export function PartnerPicker({ kid }) {
  return (
    <div className="coach-picker">
      {kid.partners.map((p) => (
        <button key={p.id} className={kid.partner?.id === p.id ? 'coach-tile on' : 'coach-tile'} onClick={() => kid.save({ partnerId: p.id })}>
          <span className="coach-emoji">{KIND_EMOJI[p.kind] ?? '⭐'}</span>
          {p.name}
        </button>
      ))}
    </div>
  );
}
