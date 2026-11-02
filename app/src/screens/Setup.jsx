import { useEffect, useState } from 'react';
import { api, isNative } from '../api.js';

// First launch on a device: point it at the server and prove it's a parent
// setting it up (or create the parent PIN if the server is brand new).
export default function Setup({ onDone }) {
  const [server, setServer] = useState(api.serverUrl);
  const [status, setStatus] = useState(null); // { setUp } once the server answers
  const [pin, setPin] = useState('');
  const [pin2, setPin2] = useState('');
  const [deviceName, setDeviceName] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function check() {
    setError('');
    setBusy(true);
    try {
      if (isNative) api.setServerUrl(server.trim());
      setStatus(await api.get('/api/status'));
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    if (!isNative) check();
  }, []);

  async function submit(e) {
    e.preventDefault();
    setError('');
    if (!status.setUp && pin !== pin2) return setError("The PINs don't match");
    setBusy(true);
    try {
      const body = { pin, deviceName: deviceName || 'Device' };
      const { token } = await api.post(status.setUp ? '/api/devices/register' : '/api/setup', body);
      api.setToken(token);
      onDone();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="center-screen">
      <div className="card narrow">
        <h1 className="logo">Family Track</h1>
        {!status ? (
          <>
            <p>Which server should this device use?</p>
            {isNative && (
              <label>Server address
                <input value={server} onChange={(e) => setServer(e.target.value)} inputMode="url" autoCapitalize="off"
                  placeholder="http://<server IP>:14200" />
              </label>
            )}
            <button className="btn primary" disabled={busy || (isNative && !server.trim())} onClick={check}>{busy ? 'Checking…' : 'Connect'}</button>
          </>
        ) : (
          <form onSubmit={submit}>
            <p>{status.setUp
              ? 'Enter the parent PIN to add this device.'
              : 'New server! Pick a parent PIN (4–8 digits). Kids should not know it.'}</p>
            <label>Name for this device
              <input value={deviceName} onChange={(e) => setDeviceName(e.target.value)} placeholder="e.g. Kid's tablet" />
            </label>
            <label>Parent PIN
              <input type="password" inputMode="numeric" value={pin} onChange={(e) => setPin(e.target.value)} autoComplete="off" />
            </label>
            {!status.setUp && (
              <label>PIN again
                <input type="password" inputMode="numeric" value={pin2} onChange={(e) => setPin2(e.target.value)} autoComplete="off" />
              </label>
            )}
            <button className="btn primary" disabled={busy || !pin}>{busy ? 'One sec…' : 'Set up'}</button>
          </form>
        )}
        {error && <p className="error">{error}</p>}
      </div>
    </div>
  );
}
