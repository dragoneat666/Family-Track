import { useEffect, useState } from 'react';
import { App as CapApp } from '@capacitor/app';
import { api, isNative } from '../api.js';
import { PuzzleLevelPicker, PUZZLE_LEVELS } from './PuzzleLevel.jsx';
import { useExercises } from '../exercises/useExercises.js';
import { PartnerPicker } from '../exercises/Exercises.jsx';
import { Sheet } from '../lists/ui.jsx';
import AccountsTab from './parent/AccountsTab.jsx';
import DevicesTab from './parent/DevicesTab.jsx';
import NotifyStatus from './NotifyStatus.jsx';

export default function Settings({ account, onBack, onSwitch, onChangeServer, onAuthLost }) {
  const [showing, setShowing] = useState(null); // 'accounts' | 'devices'
  const [deviceName, setDeviceName] = useState('');
  const [version, setVersion] = useState('');
  const [currentPin, setCurrentPin] = useState('');
  const [newPin, setNewPin] = useState('');
  const [msg, setMsg] = useState('');
  const [error, setError] = useState('');

  const [puzzleLevel, setPuzzleLevel] = useState(null);
  const exercises = useExercises(account.isParent ? null : account);

  useEffect(() => {
    api.get('/api/me').then((me) => setDeviceName(me.deviceName)).catch(() => {});
    if (!account.isParent) api.get(`/api/kids/${account.id}/state`).then((s) => setPuzzleLevel(s.puzzleLevel || 'easy')).catch(() => {});
    if (isNative) CapApp.getInfo().then((i) => setVersion(`${i.version} (${i.build})`)).catch(() => {});
  }, []);

  async function run(fn, done) {
    setError('');
    setMsg('');
    try {
      await fn();
      setMsg(done);
    } catch (e) {
      setError(e.message);
    }
  }

  function pickLevel(level) {
    const before = puzzleLevel;
    setPuzzleLevel(level);
    run(() => api.put(`/api/kids/${account.id}/puzzle`, { level }).catch((e) => {
      setPuzzleLevel(before);
      throw e;
    }), `Puzzle set to ${PUZZLE_LEVELS.find((l) => l.key === level).name} ✓`);
  }

  function saveDevice(e) {
    e.preventDefault();
    run(() => api.put('/api/me/device', { name: deviceName }), 'Device name saved ✓');
  }

  function changePin(e) {
    e.preventDefault();
    run(async () => {
      await api.put('/api/me/pin', { currentPin, newPin });
      setCurrentPin('');
      setNewPin('');
    }, 'PIN changed ✓');
  }

  return (
    <div className="settings-screen">
      <header className="parent-header">
        <h1>Settings</h1>
        <button data-back className="btn" onClick={onBack}>Done</button>
      </header>
      <main className="parent-main stack">
        <div className="card row spread">
          <div className="row">
            <span className="settings-avatar" style={{ '--c': account.color }}>{account.emoji}</span>
            <div>
              <b>{account.name}</b>
              <div className="muted small">{account.isParent ? 'Grown-up' : 'Kid'} account on this device</div>
            </div>
          </div>
          <button className="btn primary" onClick={onSwitch}>Switch account</button>
        </div>
        {!account.isParent && <p className="muted small">Switching to someone else needs a grown-up's PIN.</p>}

        {!account.isParent && puzzleLevel && (
          <div className="card stack">
            <h3>🧩 Building puzzle</h3>
            <PuzzleLevelPicker value={puzzleLevel} onChange={pickLevel} />
          </div>
        )}

        {!account.isParent && exercises.loaded && (
          <div className="card stack">
            <h3>🏃 My exercise partner</h3>
            {exercises.partners.length > 0
              ? <PartnerPicker kid={exercises} />
              : <p className="muted">Finish building a character to unlock an exercise partner!</p>}
            {exercises.partners.length > 0 && <p className="muted small">Finish building more characters to unlock more partners.</p>}
          </div>
        )}

        {account.isParent && (
          <div className="card stack">
            <h3>Family</h3>
            <div className="row wrap">
              <button className="btn" onClick={() => setShowing('accounts')}>👥 Accounts</button>
              <button className="btn" onClick={() => setShowing('devices')}>📱 Devices</button>
            </div>
            <p className="muted small">Who is in the family, and which phones and tablets are signed in.</p>
          </div>
        )}

        {account.isParent && (
          <form className="card stack" onSubmit={changePin}>
            <h3>Change my PIN</h3>
            <div className="row wrap">
              <input type="password" inputMode="numeric" placeholder="Current PIN" value={currentPin} onChange={(e) => setCurrentPin(e.target.value)} autoComplete="off" />
              <input type="password" inputMode="numeric" placeholder="New PIN (4–8 digits)" value={newPin} onChange={(e) => setNewPin(e.target.value)} autoComplete="new-password" />
              <button className="btn" disabled={!newPin}>Change</button>
            </div>
          </form>
        )}

        {account.isParent && (
          <form className="card stack" onSubmit={saveDevice}>
            <h3>This device</h3>
            <div className="row">
              <input value={deviceName} onChange={(e) => setDeviceName(e.target.value)} placeholder="e.g. Kitchen tablet" />
              <button className="btn">Save</button>
            </div>
            {isNative && (
              <p className="muted small">Server: {api.serverUrl} · <button type="button" className="btn link small" onClick={onChangeServer}>change</button></p>
            )}
          </form>
        )}

        {account.isParent && <NotifyStatus />}

        {msg && <p className="muted">{msg}</p>}
        {error && <p className="error">{error}</p>}
        {version && <p className="muted small">Family Track {version}</p>}
      </main>
      {showing === 'accounts' && <Sheet wide title="Accounts" onClose={() => setShowing(null)}><AccountsTab onAuthLost={onAuthLost} /></Sheet>}
      {showing === 'devices' && <Sheet wide title="Devices" onClose={() => setShowing(null)}><DevicesTab onAuthLost={onAuthLost} /></Sheet>}
    </div>
  );
}
