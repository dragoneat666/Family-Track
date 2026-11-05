// How hard building is. Each kid picks their own in Settings.
export const PUZZLE_LEVELS = [
  { key: 'easy', emoji: '🙂', name: 'Easy', blurb: 'Outlines show where pieces go' },
  { key: 'medium', emoji: '🤔', name: 'Medium', blurb: 'No outlines. Place it, then tap Check' },
  { key: 'hard', emoji: '🤯', name: 'Hard', blurb: 'Medium, and turn the pieces too' }
];

export function PuzzleLevelPicker({ value, onChange, disabled }) {
  return (
    <div className="level-picker">
      {PUZZLE_LEVELS.map((l) => (
        <button
          key={l.key}
          type="button"
          className={`level-tile${value === l.key ? ' on' : ''}`}
          onClick={() => onChange(l.key)}
          disabled={disabled}
          aria-pressed={value === l.key}
        >
          <span className="level-emoji">{l.emoji}</span>
          <b>{l.name}</b>
          <span className="small">{l.blurb}</span>
        </button>
      ))}
    </div>
  );
}
