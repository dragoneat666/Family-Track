import { useEffect, useRef, useState } from 'react';
import { api } from '../api.js';
import { BuildScene } from '../three/buildScene.js';

// Either a kid's real build (profile) or a parent test run (testCharacter:
// every piece unlocked, nothing saved).
export default function Build({ profile, testCharacter, onExit }) {
  const holderRef = useRef(null);
  const sceneRef = useRef(null);
  const [character, setCharacter] = useState(null);
  const [tray, setTray] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [dancing, setDancing] = useState(null);

  useEffect(() => {
    let scene;
    let cancelled = false;
    (async () => {
      try {
        let c;
        if (testCharacter) {
          c = { ...testCharacter, pieces: testCharacter.pieces.map((p) => ({ ...p, unlocked: true, placed: false })) };
        } else {
          c = (await api.get(`/api/kids/${profile.id}/state`)).character;
          if (!c || c.status !== 'ready') throw new Error('Nothing to build yet.');
        }
        if (cancelled) return;
        setCharacter(c);
        scene = new BuildScene(holderRef.current, {
          onPlace: (pieceId) => place(pieceId),
          onTrayChange: setTray
        });
        sceneRef.current = scene;
        await scene.load(api.url(`/api/characters/${c.id}/build.glb?v=${c.version}`), api.authHeaders(), c);
        scene.setComplete(isComplete(c));
        if (!cancelled) setLoading(false);
      } catch (e) {
        if (!cancelled) {
          setError(e.message || 'Could not load the model.');
          setLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
      scene?.destroy();
    };
  }, []);

  async function place(pieceId) {
    if (testCharacter) {
      setCharacter((c) => {
        const next = { ...c, pieces: c.pieces.map((p) => (p.id === pieceId ? { ...p, placed: true } : p)) };
        sceneRef.current?.setComplete(isComplete(next));
        return next;
      });
      return;
    }
    try {
      const state = await api.post(`/api/kids/${profile.id}/place`, { pieceId });
      setCharacter(state.character);
      sceneRef.current?.setState(state.character);
      sceneRef.current?.setComplete(isComplete(state.character));
    } catch (e) {
      setError(e.message);
    }
  }

  async function dance() {
    const list = character.dances || [];
    if (!list.length) return;
    const pool = list.length > 1 ? list.filter((d) => d.id !== dancing?.id) : list;
    const pick = pool[Math.floor(Math.random() * pool.length)];
    setDancing({ ...pick, loading: true });
    try {
      await sceneRef.current.dance(
        api.url(`/api/characters/${character.id}/rigged.glb?v=${character.version}`),
        api.url(`/api/characters/${character.id}/dances/${pick.id}.glb?v=${character.version}`),
        api.authHeaders()
      );
      setDancing(pick);
    } catch (e) {
      setDancing(null);
      setError(e.message || 'That dance would not load.');
    }
  }

  function stopDance() {
    sceneRef.current?.stopDance();
    setDancing(null);
  }

  const complete = character && isComplete(character);
  const placed = character ? character.pieces.filter((p) => p.placed).length : 0;
  const nextName = character?.pieces.find((p) => p.id === tray[0])?.name;
  const canDance = complete && character.hasRigged && character.dances?.length > 0;

  let hint = '';
  if (character && !loading) {
    if (complete) hint = `🎉 ${character.name} is finished!`;
    else if (tray.length) hint = `Drag the ${nextName} onto ${character.name}!`;
    else hint = 'Brush your teeth to unlock the next piece!';
  }

  return (
    <div className="build-screen">
      <header className="build-header">
        <button className="btn" onClick={onExit}>← Back</button>
        <div className="build-title">
          {character?.name}
          {character && <span className="small"> · {placed} / {character.pieces.length}</span>}
          {testCharacter && <span className="test-pill">Test</span>}
        </div>
      </header>
      <div className="build-stage" ref={holderRef}>
        {loading && <div className="stage-msg"><div className="spinner" />Loading…</div>}
        {error && <div className="stage-msg error">{error}</div>}
      </div>
      <footer className="build-footer">
        <div className="hint">{dancing ? `Dancing: ${dancing.name}${dancing.loading ? '…' : ''}` : hint}</div>
        {canDance && (
          <div className="dance-buttons">
            <button className="btn primary big" onClick={dance} disabled={dancing?.loading}>
              {dancing ? '💃 Another dance' : '💃 Dance!'}
            </button>
            {dancing && <button className="btn" onClick={stopDance}>Stop</button>}
          </div>
        )}
      </footer>
    </div>
  );
}

const isComplete = (c) => c.pieces.length > 0 && c.pieces.every((p) => p.placed);
