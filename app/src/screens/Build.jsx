import { useEffect, useRef, useState } from 'react';
import { api } from '../api.js';
import { BuildScene } from '../three/buildScene.js';

// Either a kid's real build (profile) or a parent test run (testCharacter:
// every piece unlocked, nothing saved; level picks easy/medium/hard).
export default function Build({ profile, testCharacter, level: testLevel = 'easy', onExit }) {
  const holderRef = useRef(null);
  const sceneRef = useRef(null);
  const sayTimer = useRef(null);
  const [character, setCharacter] = useState(null);
  const [level, setLevel] = useState('easy');
  const [tray, setTray] = useState([]);
  const [parked, setParked] = useState(0);
  const [said, setSaid] = useState(null); // { text, good } after Check
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [dancing, setDancing] = useState(null);
  const [revealing, setRevealing] = useState(null); // dress up: the body part under the clouds

  useEffect(() => {
    let scene;
    let cancelled = false;
    (async () => {
      try {
        let c;
        let lvl = testLevel;
        if (testCharacter) {
          c = { ...testCharacter, pieces: testCharacter.pieces.map((p) => ({ ...p, unlocked: true, placed: false })) };
        } else {
          const state = await api.get(`/api/kids/${profile.id}/state`);
          c = state.character;
          lvl = state.puzzleLevel || 'easy';
          if (!c || c.status !== 'ready') throw new Error('Nothing to build yet.');
        }
        if (cancelled) return;
        setCharacter(c);
        setLevel(lvl);
        scene = new BuildScene(holderRef.current, {
          level: lvl,
          onPlace: (pieceId) => place(pieceId),
          onTrayChange: setTray,
          onReveal: (piece) => setRevealing(piece ? { id: piece.id, name: piece.name } : null),
          onParkedChange: (n) => {
            setParked(n);
            if (n) say(null);
          }
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
      clearTimeout(sayTimer.current);
      scene?.destroy();
    };
  }, []);

  function say(next) {
    clearTimeout(sayTimer.current);
    setSaid(next);
    if (next) sayTimer.current = setTimeout(() => setSaid(null), 3500);
  }

  function check() {
    const r = sceneRef.current?.check();
    if (!r) return;
    const fits = r.placed ? (r.placed > 1 ? `🎉 ${r.placed} fit! ` : '🎉 That fits! ') : '';
    if (r.wrongSpot) say({ text: `${fits}${r.placed ? 'Try the other one again.' : 'Not quite. Try moving it!'}`, good: false });
    else if (r.wrongTurn) say({ text: `${fits}${r.placed ? 'Now turn the other one.' : 'Right spot! Now turn it with the arrows.'}`, good: false });
    else if (r.placed) say({ text: r.placed > 1 ? `🎉 Yes! ${r.placed} pieces fit!` : '🎉 Yes! That’s right!', good: true });
  }

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

  // Dress up body parts aren't dragged: they're uncovered (see buildScene.js).
  const isReveal = (p) => character?.kind === 'dress' && !!p.reveal;
  const firstId = character?.pieces.find((p) => !isReveal(p))?.id;
  const easyNext = level === 'easy' || tray[0] === firstId;
  const turnable = level === 'hard' && !complete && !dancing && !revealing && (parked > 0 || tray.some((id) => id !== firstId));
  const revealWaiting = !tray.length && !parked && character?.pieces.some((p) => isReveal(p) && p.unlocked && !p.placed);

  let hint = '';
  if (character && !loading) {
    if (complete) hint = `🎉 ${character.name} is finished!`;
    else if (revealing) hint = `✨ Rub the sparkly clouds away to find ${character.name}’s ${revealing.name.toLowerCase()}!`;
    else if (said) hint = said.text;
    else if (revealWaiting) hint = '✨ Something is hiding under sparkly clouds…';
    else if (parked) hint = level === 'hard' ? 'Turn it, move it, then tap Check!' : 'Tap Check when you think it’s right!';
    else if (tray.length && easyNext) hint = `Drag the ${nextName} onto ${character.name}!`;
    else if (tray.length) hint = `Where does the ${nextName} go?${level === 'hard' ? ' Turn it to fit!' : ''}`;
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
      <footer className={`build-footer${level !== 'easy' && !complete ? ' puzzle' : ''}`}>
        <div className={`hint${said ? (said.good ? ' good' : ' oops') : ''}`}>{dancing ? `Dancing: ${dancing.name}${dancing.loading ? '…' : ''}` : hint}</div>
        {/* Always there on medium/hard (just greyed out) so nothing jumps around. */}
        {character && level !== 'easy' && !complete && (
          <div className="puzzle-buttons">
            {level === 'hard' && <button className="btn big turn" onClick={() => sceneRef.current?.turn(1)} disabled={!turnable} aria-label="Turn left">⟲</button>}
            <button className="btn primary big check" onClick={check} disabled={!parked}>✔ Check</button>
            {level === 'hard' && <button className="btn big turn" onClick={() => sceneRef.current?.turn(-1)} disabled={!turnable} aria-label="Turn right">⟳</button>}
          </div>
        )}
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
