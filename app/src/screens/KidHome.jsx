import { useEffect, useState } from 'react';
import { api, canUseCamera } from '../api.js';
import { preloadTracker } from '../brush/tracker.js';
import UpdateBanner from '../UpdateBanner.jsx';

export default function KidHome({ profile, onBrush, onBuild, onCharacters, onExercises, onSettings }) {
  const [state, setState] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (canUseCamera) preloadTracker();
    api.get(`/api/kids/${profile.id}/state`).then(setState).catch((e) => setError(e.message));
  }, [profile.id]);

  const c = state?.character;
  const ready = c?.status === 'ready';
  const placed = ready ? c.pieces.filter((p) => p.placed).length : 0;
  const waiting = ready ? c.pieces.filter((p) => p.unlocked && !p.placed).length : 0;

  return (
    <div className="kid-home" style={{ '--c': profile.color }}>
      <UpdateBanner />
      <header className="kid-header">
        <span className="avatar">{profile.emoji}</span>
        <h1>Hi {profile.name}!</h1>
        <button className="btn gear" onClick={onSettings} title="Settings">⚙️</button>
      </header>

      {error && <p className="error">{error}</p>}
      {!state && !error && <div className="spinner" />}

      {state && (
        <div className="kid-actions">
          <button className="big-action brush" onClick={onBrush}>
            <span className="big-emoji">🪥</span>
            <span className="big-label">Brush my teeth</span>
            {state.brushedToday && <span className="badge done">Done today ✓</span>}
          </button>

          {ready ? (
            <button className="big-action build" onClick={onBuild}>
              <span className="big-emoji">{c.kind === 'dress' ? '👗' : '🤖'}</span>
              <span className="big-label">{c.complete ? `Play with ${c.name}` : `${c.kind === 'dress' ? 'Dress up' : 'Build'} ${c.name}`}</span>
              <span className="progress"><i style={{ width: `${(placed / Math.max(1, c.pieces.length)) * 100}%` }} /></span>
              <span className="small">{placed} of {c.pieces.length} pieces</span>
              {waiting > 0 && <span className="badge new">{waiting === 1 ? 'New piece!' : `${waiting} new pieces!`}</span>}
            </button>
          ) : c?.status === 'processing' ? (
            <div className="big-action disabled">
              <span className="big-emoji">🧩</span>
              <span className="big-label">Getting your build ready…</span>
            </div>
          ) : onCharacters && (
            <button className="big-action build" onClick={onCharacters}>
              <span className="big-emoji">🧩</span>
              <span className="big-label">Pick a character to unlock!</span>
            </button>
          )}

          {onCharacters && (
            <button className="big-action characters" onClick={onCharacters}>
              <span className="big-emoji">⭐</span>
              <span className="big-label">Characters</span>
            </button>
          )}

          {onExercises && (
            <button className="big-action exercise" onClick={onExercises}>
              <span className="big-emoji">🏃</span>
              <span className="big-label">Exercises</span>
            </button>
          )}
        </div>
      )}
    </div>
  );
}
