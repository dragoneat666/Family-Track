import { useState } from 'react';
import Metronome from './Metronome.jsx';
import HugStarfish from './HugStarfish.jsx';
import { useExercises } from './useExercises.js';

// Exercises from the occupational therapist. Add new ones to this list.
export const EXERCISES = [
  { key: 'metronome', emoji: '🥁', name: 'Metronome', blurb: 'Clap along to the beat', Screen: Metronome },
  { key: 'starfish', emoji: '⭐', name: 'Hug & Starfish', blurb: 'Hug, cross, sit up, hold… starfish!', Screen: HugStarfish }
];

// The list of exercises and the kid's coach; tapping one opens it.
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
      </header>
      {kid.coaches.length > 0 && <CoachPicker kid={kid} />}
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

export function CoachPicker({ kid }) {
  return (
    <div className="coach-picker">
      <span className="coach-picker-title">Your coach:</span>
      {kid.coaches.map((c) => (
        <button key={c.id} className={kid.coach?.id === c.id ? 'coach-tile on' : 'coach-tile'} onClick={() => kid.save({ coachId: c.id })}>
          <span className="coach-emoji">{c.emoji}</span>
          {c.name}
        </button>
      ))}
      <button className={!kid.coach ? 'coach-tile on' : 'coach-tile'} onClick={() => kid.save({ coachId: null })}>
        <span className="coach-emoji">🔕</span>
        No coach
      </button>
    </div>
  );
}
