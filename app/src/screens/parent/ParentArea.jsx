import { useState } from 'react';
import { api } from '../../api.js';
import KidsTab from './KidsTab.jsx';
import CharactersTab from './CharactersTab.jsx';
import BrushingTab from './BrushingTab.jsx';
import TestTab from './TestTab.jsx';
import DevicesTab from './DevicesTab.jsx';
import UpdateBanner from '../../UpdateBanner.jsx';

const TABS = [
  ['kids', 'Kids'],
  ['characters', 'Characters'],
  ['brushing', 'Brushing'],
  ['test', 'Test'],
  ['devices', 'Devices']
];

export default function ParentArea({ onExit }) {
  const [unlocked, setUnlocked] = useState(api.parentUnlocked);
  const [tab, setTab] = useState('kids');
  const [fullScreen, setFullScreen] = useState(null); // a test brush/build takes over the screen

  if (!unlocked) return <PinGate onUnlocked={() => setUnlocked(true)} onCancel={onExit} />;
  if (fullScreen) return fullScreen;

  // Any parent call that comes back "locked" (session timed out) shows the PIN again.
  const onLocked = () => setUnlocked(false);

  return (
    <div className="parent-area">
      <UpdateBanner />
      <header className="parent-header">
        <h1>Parents</h1>
        <button className="btn" onClick={onExit}>Done</button>
      </header>
      <nav className="tabs">
        {TABS.map(([key, label]) => (
          <button key={key} className={tab === key ? 'tab active' : 'tab'} onClick={() => setTab(key)}>{label}</button>
        ))}
      </nav>
      <main className="parent-main">
        {tab === 'kids' && <KidsTab onLocked={onLocked} />}
        {tab === 'characters' && <CharactersTab onLocked={onLocked} />}
        {tab === 'brushing' && <BrushingTab onLocked={onLocked} />}
        {tab === 'test' && <TestTab onLocked={onLocked} show={setFullScreen} />}
        {tab === 'devices' && <DevicesTab onLocked={onLocked} />}
      </main>
    </div>
  );
}

function PinGate({ onUnlocked, onCancel }) {
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await api.unlockParent(pin);
      onUnlocked();
    } catch (e) {
      setError(e.message);
      setPin('');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="center-screen">
      <form className="card narrow" onSubmit={submit}>
        <h2>🔒 Parents only</h2>
        <label>Parent PIN
          <input type="password" inputMode="numeric" autoFocus value={pin} onChange={(e) => setPin(e.target.value)} autoComplete="off" />
        </label>
        <button className="btn primary" disabled={busy || !pin}>Open</button>
        <button type="button" className="btn link" onClick={onCancel}>Back</button>
        {error && <p className="error">{error}</p>}
      </form>
    </div>
  );
}
