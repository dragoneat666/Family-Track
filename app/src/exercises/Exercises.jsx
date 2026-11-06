import { useState } from 'react';
import Metronome from './Metronome.jsx';
import PartnerExercise from './PartnerExercise.jsx';
import { useExercises } from './useExercises.js';

// The metronome is built in; the rest are the exercise partner's own (made
// by a grown-up under Characters).
const METRONOME = { key: 'metronome', emoji: '🥁', name: 'Metronome', blurb: 'Clap along to the beat' };

// The list of exercises; tapping one opens it. Kids pick their exercise
// partner in Settings.
export default function Exercises({ profile, grownUp = false, onExit }) {
  const [open, setOpen] = useState(null);
  const kid = useExercises(profile);
  const partnerExercises = (kid.partner?.exercises || []).filter((e) => e.script.scenes.length);

  if (open === 'metronome') return <Metronome profile={profile} kid={kid} grownUp={grownUp} onExit={() => setOpen(null)} />;
  const exercise = partnerExercises.find((e) => `ex-${e.id}` === open);
  if (exercise) return <PartnerExercise kid={kid} exercise={exercise} grownUp={grownUp} onExit={() => setOpen(null)} />;

  return (
    <div className="exercise-screen">
      <header className="build-header">
        <button className="btn" onClick={onExit}>← Back</button>
        <div className="build-title">🏃 Exercises</div>
        {kid.partner && <span className="coach-chip">With {kid.partner.name}</span>}
      </header>
      <div className="exercise-list">
        <button className="big-action exercise" onClick={() => setOpen('metronome')}>
          <span className="big-emoji">{METRONOME.emoji}</span>
          <span className="big-label">{METRONOME.name}</span>
          <span className="small">{METRONOME.blurb}</span>
        </button>
        {partnerExercises.map((e) => (
          <button key={e.id} className="big-action exercise" onClick={() => setOpen(`ex-${e.id}`)}>
            <span className="big-emoji">{e.emoji}</span>
            <span className="big-label">{e.name}</span>
            <span className="small">With {kid.partner.name}</span>
          </button>
        ))}
      </div>
      {kid.loaded && !kid.partner && <p className="muted center">Ask a grown-up to set up an exercise partner for more exercises.</p>}
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
