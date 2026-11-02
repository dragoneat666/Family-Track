import { useEffect, useState } from 'react';
import { api } from '../api.js';
import UpdateBanner from '../UpdateBanner.jsx';

// "Who are you?" — first sign-in on a device, or switching from Settings.
//   grown-up account: their own PIN (or pick one, if it was made without)
//   kid account:      any grown-up's PIN, unless a grown-up is the one switching
export default function WhoAreYou({ current, onSignedIn, onBack }) {
  const [accounts, setAccounts] = useState(null);
  const [picked, setPicked] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api.get('/api/accounts').then(setAccounts).catch((e) => setError(e.message));
  }, []);

  function mode(a) {
    if (a.isParent) return a.needsPin ? 'new' : 'own';
    return current?.isParent ? 'none' : 'adult';
  }

  async function pick(a) {
    setError('');
    if (mode(a) === 'none') {
      try {
        onSignedIn(await api.signIn({ profileId: a.id }));
      } catch (e) {
        setError(e.message);
      }
      return;
    }
    setPicked(a);
  }

  if (picked) {
    return <PinStep account={picked} mode={mode(picked)} onSignedIn={onSignedIn} onCancel={() => setPicked(null)} />;
  }

  const adults = accounts?.filter((a) => a.isParent) ?? [];
  const kids = accounts?.filter((a) => !a.isParent) ?? [];
  return (
    <div className="center-screen">
      <UpdateBanner />
      <h1 className="logo">Who are you?</h1>
      {current && !current.isParent && <p className="muted">Switching needs a grown-up's PIN.</p>}
      {error && <p className="error">{error}</p>}
      {!accounts && !error && <div className="spinner" />}
      {kids.length > 0 && (
        <div className="profile-grid">
          {kids.map((a) => <AccountTile key={a.id} account={a} onClick={() => pick(a)} />)}
        </div>
      )}
      {adults.length > 0 && (
        <div className="profile-grid small">
          {adults.map((a) => <AccountTile key={a.id} account={a} onClick={() => pick(a)} />)}
        </div>
      )}
      {onBack && <button className="btn link" onClick={onBack}>Back</button>}
    </div>
  );
}

function AccountTile({ account, onClick }) {
  return (
    <button className={`profile-tile ${account.isParent ? 'adult' : ''}`} style={{ '--c': account.color }} onClick={onClick}>
      <span className="profile-emoji">{account.emoji}</span>
      <span>{account.name}</span>
      {account.isParent && <span className="tile-note">🔒 grown-up</span>}
    </button>
  );
}

function PinStep({ account, mode, onSignedIn, onCancel }) {
  const [pin, setPin] = useState('');
  const [pin2, setPin2] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setError('');
    if (mode === 'new' && pin !== pin2) return setError("The PINs don't match");
    setBusy(true);
    try {
      const body = mode === 'new' ? { profileId: account.id, newPin: pin } : { profileId: account.id, pin };
      onSignedIn(await api.signIn(body));
    } catch (err) {
      setError(err.message);
      setPin('');
      setBusy(false);
    }
  }

  const title = {
    own: `Hi ${account.name}! Enter your PIN.`,
    new: `Hi ${account.name}! Pick a PIN (4–8 digits). You'll use it to sign in.`,
    adult: `A grown-up's PIN, please, to sign in as ${account.name}.`
  }[mode];

  return (
    <div className="center-screen">
      <form className="card narrow" onSubmit={submit}>
        <div className="pin-avatar" style={{ '--c': account.color }}>{account.emoji}</div>
        <p className="pin-title">{title}</p>
        <input type="password" inputMode="numeric" autoFocus value={pin} onChange={(e) => setPin(e.target.value)}
          autoComplete={mode === 'new' ? 'new-password' : 'off'} placeholder="PIN" />
        {mode === 'new' && (
          <input type="password" inputMode="numeric" value={pin2} onChange={(e) => setPin2(e.target.value)}
            autoComplete="new-password" placeholder="PIN again" />
        )}
        <button className="btn primary" disabled={busy || !pin}>{busy ? 'One sec…' : mode === 'new' ? 'Set PIN and sign in' : 'Sign in'}</button>
        <button type="button" className="btn link" onClick={onCancel}>Back</button>
        {error && <p className="error">{error}</p>}
      </form>
    </div>
  );
}
