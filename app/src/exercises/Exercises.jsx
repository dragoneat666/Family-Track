import { useState } from 'react';
import Metronome from './Metronome.jsx';

// Exercises from the occupational therapist. Add new ones to this list.
export const EXERCISES = [
  { key: 'metronome', emoji: '🥁', name: 'Metronome', blurb: 'Clap along to the beat', Screen: Metronome }
];

// The list of exercises; tapping one opens it.
export default function Exercises({ profile, onExit, start = null }) {
  const [open, setOpen] = useState(start);
  const current = EXERCISES.find((e) => e.key === open);
  if (current) {
    const { Screen } = current;
    return <Screen profile={profile} onExit={() => (start ? onExit() : setOpen(null))} />;
  }

  return (
    <div className="exercise-screen">
      <header className="build-header">
        <button className="btn" onClick={onExit}>← Back</button>
        <div className="build-title">🏃 Exercises</div>
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
