import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { characterPicture } from '../three/thumbnail.js';
import SceneThumb from '../scenes/SceneThumb.jsx';
import { groupScenes } from '../scenes/BackgroundPicker.jsx';

// The kids' Characters screen: every character, how far along they are on
// each, and picking which one brushing earns pieces for.

const KIND = {
  build: { emoji: '🤖', verb: 'Build', doing: 'Building now' },
  dress: { emoji: '👗', verb: 'Dress up', doing: 'Dressing up now' },
  scene: { emoji: '🖼️', verb: 'Put together', doing: 'Putting it together now' }
};
const kindOf = (c) => KIND[c.kind] ?? KIND.build;
const counts = (c) => ({
  placed: c.pieces.filter((p) => p.placed).length,
  waiting: c.pieces.filter((p) => p.unlocked && !p.placed).length,
  total: c.pieces.length
});

function Picture({ character, big }) {
  if (character.kind === 'scene') {
    return <div className={`char-picture scene${big ? ' big' : ''}`}><SceneThumb character={character} /></div>;
  }
  return <ModelPicture character={character} big={big} />;
}

function ModelPicture({ character, big }) {
  const [src, setSrc] = useState(null);
  useEffect(() => {
    let live = true;
    characterPicture(character, api.url(`/api/characters/${character.id}/build.glb?v=${character.version}`), api.authHeaders())
      .then((s) => live && setSrc(s))
      .catch(() => live && setSrc(''));
    return () => { live = false; };
  }, [character.id, character.version, character.pieces.map((p) => +p.placed).join('')]);
  return (
    <div className={`char-picture${big ? ' big' : ''}`}>
      {src ? <img src={src} alt="" /> : src === '' ? <span className="char-emoji">{kindOf(character).emoji}</span> : <div className="spinner" />}
    </div>
  );
}

function Badge({ c }) {
  const { placed, waiting, total } = counts(c);
  if (c.complete) return <span className="char-badge done">{c.kind === 'scene' ? '⭐ Finished!' : '⭐ Unlocked!'}</span>;
  if (waiting) return <span className="char-badge new">{waiting === 1 ? 'New piece!' : `${waiting} new pieces!`}</span>;
  if (c.active) return <span className="char-badge active">{kindOf(c).doing}</span>;
  return <span className="char-badge locked">🔒 {placed ? `${placed} of ${total}` : 'Locked'}</span>;
}

export function Characters({ profile, onExit, onOpen }) {
  const [list, setList] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => {
    api.get(`/api/kids/${profile.id}/characters`).then((r) => setList(r.characters)).catch((e) => setError(e.message));
  }, [profile.id]);

  return (
    <div className="kid-page" style={{ '--c': profile.color }}>
      <header className="kid-page-header">
        <button data-back className="btn" onClick={onExit}>← Back</button>
        <h1>Characters</h1>
      </header>
      {error && <p className="error">{error}</p>}
      {!list && !error && <div className="spinner" />}
      {list?.length === 0 && <p className="muted">No characters yet. Ask a grown-up to add some!</p>}
      <div className="char-grid">
        {list?.filter((c) => c.kind !== 'scene').map((c) => <Tile key={c.id} c={c} onOpen={onOpen} />)}
      </div>
      {groupScenes(list?.filter((c) => c.kind === 'scene') || []).map(([name, scenes], i) => (
        <section key={name} className="char-section">
          <h2>{i === 0 ? '🖼️ Backgrounds: ' : ''}{name}</h2>
          <div className="char-grid">
            {scenes.map((c) => <Tile key={c.id} c={c} onOpen={onOpen} />)}
          </div>
        </section>
      ))}
    </div>
  );
}

function Tile({ c, onOpen }) {
  const { placed, total } = counts(c);
  return (
    <button className={`char-tile${c.active ? ' active' : ''}${c.complete ? ' done' : ''}${c.kind === 'scene' ? ' scene' : ''}`} onClick={() => onOpen(c.id)}>
      <Picture character={c} />
      <span className="char-name">{kindOf(c).emoji} {c.name}</span>
      {!c.complete && placed > 0 && <span className="progress"><i style={{ width: `${(placed / Math.max(1, total)) * 100}%` }} /></span>}
      <Badge c={c} />
    </button>
  );
}

export function CharacterDetail({ profile, characterId, onExit, onBuild }) {
  const [c, setC] = useState(null);
  const [background, setBackground] = useState(null);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  async function load() {
    try {
      const r = await api.get(`/api/kids/${profile.id}/characters/${characterId}`);
      setC(r.character);
      setBackground(r.background || null);
    } catch (e) {
      setError(e.message);
    }
  }

  async function useBackground(on) {
    setSaving(true);
    try {
      setBackground((await api.put(`/api/kids/${profile.id}/background`, { characterId: on ? characterId : null })).background);
    } catch (e) {
      setError(e.message);
    }
    setSaving(false);
  }
  useEffect(() => { load(); }, [characterId]);

  async function makeActive() {
    setSaving(true);
    try {
      await api.put(`/api/kids/${profile.id}/character`, { characterId });
      await load();
    } catch (e) {
      setError(e.message);
    }
    setSaving(false);
  }

  const k = c && kindOf(c);
  const n = c && counts(c);
  const canDance = c?.hasRigged && c.dances?.length > 0;
  const scene = c?.kind === 'scene';

  return (
    <div className="kid-page" style={{ '--c': profile.color }}>
      <header className="kid-page-header">
        <button data-back className="btn" onClick={onExit}>← Characters</button>
        {c && <h1>{c.name}</h1>}
      </header>
      {error && <p className="error">{error}</p>}
      {!c && !error && <div className="spinner" />}
      {c && (
        <div className="char-detail">
          <Picture character={c} big />
          <div className="char-detail-side">
            {c.complete && scene ? (
              <>
                <p className="char-status">⭐ You finished {c.name}!</p>
                {background?.id === c.id
                  ? <>
                    <p className="char-active">✓ Your characters stand in front of it</p>
                    <button className="btn big" onClick={() => useBackground(false)} disabled={saving}>No background</button>
                  </>
                  : <button className="btn primary big" onClick={() => useBackground(true)} disabled={saving}>🖼️ Put it behind my characters</button>}
                <button className="btn big" onClick={onBuild}>👀 Look at it</button>
              </>
            ) : c.complete ? (
              <>
                <p className="char-status">⭐ You finished {c.name}!</p>
                <button className="btn primary big" onClick={onBuild}>{canDance ? `💃 Watch ${c.name} dance` : `👀 Look at ${c.name}`}</button>
              </>
            ) : (
              <>
                <p className="char-status">
                  {n.placed ? `${n.placed} of ${n.total} pieces done` : `${n.total} pieces to unlock`}
                  {n.waiting > 0 && <><br /><b>{n.waiting === 1 ? '1 new piece is waiting!' : `${n.waiting} new pieces are waiting!`}</b></>}
                </p>
                {c.active
                  ? <p className="char-active">✓ Brushing unlocks pieces for {c.name}</p>
                  : <button className="btn big" onClick={makeActive} disabled={saving}>⭐ {scene ? 'Work on this one' : 'Set as my character'}</button>}
                <button className="btn primary big" onClick={onBuild} disabled={!n.waiting}>
                  {k.emoji} {k.verb} {c.name}
                </button>
                {!n.waiting && <p className="muted small">{c.active ? 'Brush your teeth to unlock the next piece!' : scene ? 'Tap “Work on this one”, then brush to unlock pieces.' : `Set ${c.name} as your character, then brush to unlock pieces.`}</p>}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
