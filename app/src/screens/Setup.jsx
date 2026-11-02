import { useState } from 'react';
import { api } from '../api.js';

// App only: which server to talk to.
export function ServerAddress({ onDone }) {
  const [server, setServer] = useState(api.serverUrl);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function connect(e) {
    e.preventDefault();
    setError('');
    setBusy(true);
    const before = api.serverUrl;
    try {
      api.setServerUrl(server.trim());
      await api.get('/api/status');
      onDone();
    } catch (err) {
      api.setServerUrl(before);
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="center-screen">
      <form className="card narrow" onSubmit={connect}>
        <h1 className="logo">Family Track</h1>
        <p>Which server should this device use?</p>
        <label>Server address
          <input value={server} onChange={(e) => setServer(e.target.value)} inputMode="url" autoCapitalize="off"
            placeholder="http://<server IP>:14200" />
        </label>
        <button className="btn primary" disabled={busy || !server.trim()}>{busy ? 'Checking…' : 'Connect'}</button>
        {error && <p className="error">{error}</p>}
      </form>
    </div>
  );
}

// Brand-new server: make the first grown-up account.
export function FirstAccount({ onDone }) {
  const [name, setName] = useState('');
  const [pin, setPin] = useState('');
  const [pin2, setPin2] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setError('');
    if (pin !== pin2) return setError("The PINs don't match");
    setBusy(true);
    try {
      const r = await api.post('/api/setup', { name, pin, deviceName: 'First device' });
      api.setToken(r.token);
      onDone(r.account);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="center-screen">
      <form className="card narrow" onSubmit={submit}>
        <h1 className="logo">Family Track</h1>
        <p>Welcome! First, make your own grown-up account. You can add everyone else after.</p>
        <label>Your name
          <input value={name} onChange={(e) => setName(e.target.value)} autoFocus />
        </label>
        <label>Pick a PIN (4–8 digits)
          <input type="password" inputMode="numeric" value={pin} onChange={(e) => setPin(e.target.value)} autoComplete="new-password" />
        </label>
        <label>PIN again
          <input type="password" inputMode="numeric" value={pin2} onChange={(e) => setPin2(e.target.value)} autoComplete="new-password" />
        </label>
        <button className="btn primary" disabled={busy || !name.trim() || !pin}>{busy ? 'One sec…' : 'Create my account'}</button>
        {error && <p className="error">{error}</p>}
      </form>
    </div>
  );
}
