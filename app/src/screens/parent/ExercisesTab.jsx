import Exercises, { EXERCISES } from '../../exercises/Exercises.jsx';

// Grown-ups can run the exercises too, from their own phone.
export default function ExercisesTab({ show }) {
  return (
    <div className="stack">
      <div className="card stack">
        <h3>🏃 Exercises</h3>
        <p className="muted">Exercises from the occupational therapist. Kids find them under the 🏃 Exercises button on their home screen.</p>
        <div className="row wrap">
          {EXERCISES.map((e) => (
            <button key={e.key} className="btn primary" onClick={() => show(<Exercises start={e.key} onExit={() => show(null)} />)}>
              {e.emoji} {e.name}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
