import { useEffect, useState } from 'react';
import { api } from '../../api.js';
import { useParentCall } from './useParentCall.js';

export default function BrushingTab({ onAuthLost }) {
  const { error, call } = useParentCall(onAuthLost);
  const [settings, setSettings] = useState(null);
  const [sessions, setSessions] = useState([]);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    call(() => api.get('/api/settings')).then((s) => s && setSettings(s));
    call(() => api.get('/api/parent/brush-sessions')).then((s) => s && setSessions(s));
  }, []);

  async function save(e) {
    e.preventDefault();
    const s = await call(() => api.put('/api/parent/settings', settings));
    if (s) {
      setSettings(s);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    }
  }

  const set = (k) => (e) => setSettings({ ...settings, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });

  return (
    <div className="stack">
      {error && <p className="error">{error}</p>}
      {settings && (
        <form className="card stack" onSubmit={save}>
          <h3>Brushing rules</h3>
          <label className="inline">Main brushing (seconds)
            <input type="number" min="30" max="600" value={settings.mainSeconds} onChange={set('mainSeconds')} />
          </label>
          <label className="inline">Front teeth after (seconds)
            <input type="number" min="0" max="120" value={settings.frontSeconds} onChange={set('frontSeconds')} />
          </label>
          <label className="inline">New piece every … days of brushing
            <input type="number" min="1" max="14" value={settings.daysPerPiece} onChange={set('daysPerPiece')} />
          </label>
          <label className="inline">How much movement counts as brushing
            <select value={settings.sensitivity} onChange={set('sensitivity')}>
              <option value="low">A lot (strict)</option>
              <option value="normal">Normal</option>
              <option value="high">A little (easy)</option>
            </select>
          </label>
          <label className="inline check">
            <input type="checkbox" checked={settings.showTrackingInfo} onChange={set('showTrackingInfo')} />
            Show tracking numbers on the kids' brushing screen (for tuning)
          </label>
          <button className="btn primary">{saved ? 'Saved ✓' : 'Save'}</button>
        </form>
      )}

      <div className="card">
        <h3>Recent brushing</h3>
        {!sessions.length && <p className="muted">Nothing yet.</p>}
        <table className="history">
          <tbody>
            {sessions.map((s) => (
              <tr key={s.id}>
                <td>{s.date}</td>
                <td>{s.profileName}</td>
                <td>{s.completed ? '✅' : '⏹️ stopped'}</td>
                <td>{fmt(s.secondsBrushed)} brushing{s.secondsPaused ? `, ${fmt(s.secondsPaused)} paused` : ''}</td>
                <td>{s.unlockedPiece ? `🧩 ${s.unlockedPiece}` : ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

const fmt = (sec) => `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
