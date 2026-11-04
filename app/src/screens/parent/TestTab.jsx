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
  const [testState, setTestState] = useState(null);

  async function loadTestKid() {
    const s = await call(() => api.get('/api/parent/test-kid'));
    if (s) setTestState(s);
    return s;
  }

  useEffect(() => {
    (async () => {
      const [c, s] = await Promise.all([call(() => api.get('/api/parent/characters')), loadTestKid()]);
      if (!c) return;
      const ready = c.filter((x) => x.status === 'ready');
      setCharacters(ready);
      // Pick up where the test kid left off, if it was building something.
      const current = s?.character && ready.find((x) => x.id === s.character.id);
      if (current) setKidCharacter(String(current.id));
      else if (ready.length) setKidCharacter(String(ready[0].id));
    })();
  }, []);

  function testBuild(c) {
    const testCharacter = { ...c, dances: c.dances.filter((d) => d.status === 'ready') };
    show(<Build testCharacter={testCharacter} onExit={() => show(null)} />);
  }

  async function actAsKid() {
    const profile = await call(() => api.post('/api/parent/test-kid', { characterId: Number(kidCharacter) }));
    if (profile) show(<KidFlow profile={profile} onExit={() => { show(null); loadTestKid(); }} />);
  }

  async function resetTestKid() {
    if (!window.confirm('Start the test kid over? All its pieces go back to locked.')) return;
    const s = await call(() => api.post('/api/parent/test-kid/reset'));
    if (s) setTestState(s);
  }

  const tc = testState?.character;
  const progress = tc?.pieces
    ? `building ${tc.name}: ${tc.pieces.filter((p) => p.placed).length} of ${tc.pieces.length} pieces placed` +
      (tc.pieces.some((p) => p.unlocked && !p.placed) ? `, ${tc.pieces.filter((p) => p.unlocked && !p.placed).length} waiting` : '')
    : 'not started yet';

  return (
    <div className="stack">
      {error && <p className="error">{error}</p>}

      <div className="card stack">
        <h3>🧪 Act as the test kid</h3>
        <p className="muted">Use the app exactly like a kid would: brush, unlock a piece, build, dance. The test kid is invisible
          (not in any list or history) and keeps its progress between tries, so each brush adds to the same build. It gets a
          piece after <b>every</b> finished brush, with no wait in between, and shows the tracking numbers and a skip button.</p>
        <p className="small"><b>Test kid:</b> {progress}</p>
        {characters.length ? (
          <div className="row wrap">
            <select value={kidCharacter} onChange={(e) => setKidCharacter(e.target.value)}>
              {characters.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <button className="btn primary" onClick={actAsKid}>Act as test kid</button>
            <button className="btn" onClick={resetTestKid} disabled={!tc?.pieces?.some((p) => p.unlocked)}>Start over</button>
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
          can't see a face. It doesn't count while your whole face is moving (moving your head or the phone).</p>
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
