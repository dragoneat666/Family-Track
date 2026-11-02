import { useEffect, useState } from 'react';
import { api } from '../../api.js';
import { useParentCall } from './useParentCall.js';

export default function DevicesTab({ onLocked }) {
  const { error, call } = useParentCall(onLocked);
  const [devices, setDevices] = useState([]);
  const [pin, setPin] = useState('');
  const [msg, setMsg] = useState('');

  async function load() {
    const d = await call(() => api.get('/api/parent/devices'));
    if (d) setDevices(d);
  }
  useEffect(() => { load(); }, []);

  async function remove(d) {
    if (!window.confirm(`Remove "${d.name}"? It will need the parent PIN to be set up again.`)) return;
    if (await call(() => api.del(`/api/parent/devices/${d.id}`))) load();
  }

  async function changePin(e) {
    e.preventDefault();
    if (await call(() => api.put('/api/parent/pin', { pin }))) {
      setPin('');
      setMsg('PIN changed ✓');
    }
  }

  return (
    <div className="stack">
      {error && <p className="error">{error}</p>}
      <div className="card">
        <h3>Devices set up with this server</h3>
        <table className="history">
          <tbody>
            {devices.map((d) => (
              <tr key={d.id}>
                <td>{d.name}{d.isThisDevice && ' (this one)'}</td>
                <td className="muted">last used {d.lastSeenAt ? d.lastSeenAt.slice(0, 16) : 'never'}</td>
                <td>{!d.isThisDevice && <button className="btn small danger" onClick={() => remove(d)}>Remove</button>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <form className="card stack" onSubmit={changePin}>
        <h3>Change parent PIN</h3>
        <div className="row">
          <input type="password" inputMode="numeric" placeholder="New PIN (4–8 digits)" value={pin} onChange={(e) => setPin(e.target.value)} />
          <button className="btn primary" disabled={!pin}>Change</button>
        </div>
        {msg && <p className="muted">{msg}</p>}
      </form>
    </div>
  );
}
