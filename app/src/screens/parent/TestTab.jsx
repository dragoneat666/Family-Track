import { useEffect, useState } from 'react';
import { api } from '../../api.js';
import { useParentCall } from './useParentCall.js';
import Brush from '../Brush.jsx';
import Build from '../Build.jsx';
import KidHome from '../KidHome.jsx';
import TrackingCheck from './TrackingCheck.jsx';

// Try brushing and building without touching any kid's progress.
export default function TestTab({ onAuthLost, show }) {
  const { error, call } = useParentCall(onAuthLost);
  const [characters, setCharacters] = useState([]);
  const [kidCharacter, setKidCharacter] = useState('');

  useEffect(() => {
    call(() => api.get('/api/parent/characters')).then((c) => {
      if (!c) return;
      const ready = c.filter((x) => x.status === 'ready');
      setCharacters(ready);
      if (ready.length) setKidCharacter(String(ready[0].id));
    });
  }, []);

  function testBuild(c) {
    const testCharacter = { ...c, dances: c.dances.filter((d) => d.status === 'ready') };
    show(<Build testCharacter={testCharacter} onExit={() => show(null)} />);
  }

  async function tryAsKid() {
    const profile = await call(() => api.post('/api/parent/test-kid', { characterId: Number(kidCharacter) }));
    if (profile) show(<KidFlow profile={profile} onExit={() => show(null)} />);
  }

  return (
    <div className="stack">
      {error && <p className="error">{error}</p>}

      <div className="card stack">
        <h3>🧒 Try it as a kid</h3>
        <p className="muted">The real kid screens, start to finish: brush, unlock a piece, build it, dance. Uses a hidden
          "Test kid" that gets a new piece after <b>every</b> finished brush (not once a day), shows the tracking numbers and
          a skip button, and starts fresh each time. Your kids' profiles and history aren't touched.</p>
        {characters.length ? (
          <div className="row wrap">
            <select value={kidCharacter} onChange={(e) => setKidCharacter(e.target.value)}>
              {characters.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <button className="btn primary" onClick={tryAsKid}>Start as Test kid</button>
          </div>
        ) : (
          <p className="muted">Add a character under Characters first.</p>
        )}
      </div>

      <div className="card stack">
        <h3>📏 Tracking check</h3>
        <p className="muted">About 30 seconds: hold still, move your head, move the phone, then brush. It shows how much of each
          counted as brushing, and sends just the numbers (never a picture) to the server so the detection can be tuned.</p>
        <button className="btn primary" onClick={() => show(<TrackingCheck onExit={() => show(null)} />)}>Start tracking check</button>
      </div>

      <div className="card stack">
        <h3>🪥 Test brushing only</h3>
        <p className="muted">Runs the brushing screen with the tracking numbers showing. Nothing is saved and no pieces unlock.
          The box around the mouth turns green while it counts as brushing, yellow when it sees you but not brushing, red when it
          can't see a face. The thin white box across the eyes is what it compares against: moving your head or the phone
          moves both boxes the same, so that doesn't count.</p>
        <button className="btn" onClick={() => show(<Brush testMode onExit={() => show(null)} />)}>Start test brushing</button>
      </div>

      <div className="card stack">
        <h3>🧩 Test building only</h3>
        <p className="muted">Every piece starts unlocked so you can put the whole thing together, then try the dances. Nothing is saved.</p>
        {!characters.length && <p className="muted">No characters ready yet.</p>}
        <div className="row wrap">
          {characters.map((c) => (
            <button key={c.id} className="btn" onClick={() => testBuild(c)}>{c.kind === 'dress' ? '👗' : '🤖'} {c.name}</button>
          ))}
        </div>
      </div>
    </div>
  );
}

// The kid screens (home -> brush -> build) for the test kid, inside the parent area.
function KidFlow({ profile, onExit }) {
  const [screen, setScreen] = useState('home');
  if (screen === 'brush') return <Brush profile={profile} onExit={(goBuild) => setScreen(goBuild ? 'build' : 'home')} />;
  if (screen === 'build') return <Build profile={profile} onExit={() => setScreen('home')} />;
  return (
    <>
      <div className="test-strip">
        Test kid — a new piece after every brush
        <button className="btn small" onClick={onExit}>Back to parents</button>
      </div>
      <KidHome profile={profile} onBrush={() => setScreen('brush')} onBuild={() => setScreen('build')} onSettings={onExit} />
    </>
  );
}
