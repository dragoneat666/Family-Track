import { useEffect, useState } from 'react';
import { api } from '../../api.js';
import { useParentCall } from './useParentCall.js';
import Brush from '../Brush.jsx';
import Build from '../Build.jsx';

// Try brushing and building without touching any kid's progress.
export default function TestTab({ onLocked, show }) {
  const { error, call } = useParentCall(onLocked);
  const [characters, setCharacters] = useState([]);

  useEffect(() => {
    call(() => api.get('/api/parent/characters')).then((c) => c && setCharacters(c.filter((x) => x.status === 'ready')));
  }, []);

  function testBuild(c) {
    const testCharacter = { ...c, dances: c.dances.filter((d) => d.status === 'ready') };
    show(<Build testCharacter={testCharacter} onExit={() => show(null)} />);
  }

  return (
    <div className="stack">
      {error && <p className="error">{error}</p>}
      <div className="card stack">
        <h3>🪥 Test brushing</h3>
        <p className="muted">Runs the real brushing screen with the tracking numbers showing. Nothing is saved and no pieces unlock.
          The box around the mouth turns green while it counts as brushing, yellow when it sees you but not brushing, red when it can't see a face.</p>
        <button className="btn primary" onClick={() => show(<Brush testMode onExit={() => show(null)} />)}>Start test brushing</button>
      </div>
      <div className="card stack">
        <h3>🧩 Test building</h3>
        <p className="muted">Every piece starts unlocked so you can try putting the whole thing together, then try the dances. Nothing is saved.</p>
        {!characters.length && <p className="muted">No characters ready yet — add one under Characters.</p>}
        <div className="row wrap">
          {characters.map((c) => (
            <button key={c.id} className="btn" onClick={() => testBuild(c)}>{c.kind === 'dress' ? '👗' : '🤖'} {c.name}</button>
          ))}
        </div>
      </div>
    </div>
  );
}
