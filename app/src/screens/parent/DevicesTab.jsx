import { useEffect, useState } from 'react';
import { api } from '../../api.js';
import { useParentCall } from './useParentCall.js';

// Every phone, tablet and browser that has signed in, and who's on it.
export default function DevicesTab({ onAuthLost }) {
  const { error, call } = useParentCall(onAuthLost);
  const [devices, setDevices] = useState([]);

  async function load() {
    const d = await call(() => api.get('/api/parent/devices'));
    if (d) setDevices(d);
  }
  useEffect(() => { load(); }, []);

  async function remove(d) {
    if (!window.confirm(`Sign out "${d.name}"? Someone will have to sign in on it again.`)) return;
    if (await call(() => api.del(`/api/parent/devices/${d.id}`))) load();
  }

  return (
    <div className="stack">
      {error && <p className="error">{error}</p>}
      <div className="card">
        <h3>Signed-in devices</h3>
        <p className="muted small">Rename a device in its own Settings. Change your PIN in Settings (⚙️).</p>
        <table className="history">
          <tbody>
            {devices.map((d) => (
              <tr key={d.id}>
                <td>{d.name}{d.isThisDevice && ' (this one)'}</td>
                <td>{d.accountName ? `${d.accountEmoji} ${d.accountName}` : <span className="muted">nobody signed in</span>}</td>
                <td className="muted">last used {d.lastSeenAt ? d.lastSeenAt.slice(0, 16) : 'never'}</td>
                <td>{!d.isThisDevice && <button className="btn small danger" onClick={() => remove(d)}>Sign out</button>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
