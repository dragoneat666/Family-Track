import { useEffect, useState } from 'react';
import { api } from '../../api.js';
import { useParentCall } from './useParentCall.js';

// Each kid at a glance: brushed today?, how far along their build is, and a
// button to hand over the next piece when the camera didn't count a brush.
export default function OverviewTab({ onAuthLost }) {
  const { error, call } = useParentCall(onAuthLost);
  const [kids, setKids] = useState(null);
  const [msg, setMsg] = useState('');

  async function load() {
    const k = await call(() => api.get('/api/parent/overview'));
    if (k) setKids(k);
  }
  useEffect(() => { load(); }, []);

  async function givePiece(k) {
    const c = k.character;
    const extra = c.unlockedToday ? `\n\nThey already got a piece today; this gives one more.` : '';
    if (!window.confirm(`Give ${k.profile.name} the next piece of ${c.name} (${c.nextPiece})?\n\nUse this when they brushed but the camera didn't count it. It also marks today as brushed.${extra}`)) return;
    const r = await call(() => api.post(`/api/parent/profiles/${k.profile.id}/give-piece`));
    if (r) {
      setMsg(`${k.profile.name} got the ${r.piece.name}. It's waiting for them to build.`);
      load();
    }
  }

  return (
    <div className="stack">
      {error && <p className="error">{error}</p>}
      {msg && <p className="muted">{msg}</p>}
      {kids && !kids.length && <p className="muted">No kid accounts yet. Add them under Accounts.</p>}
      <div className="overview-grid">
        {kids?.map((k) => (
          <div key={k.profile.id} className="card overview-card" style={{ '--c': k.profile.color }}>
            <div className="row">
              <span className="settings-avatar">{k.profile.emoji}</span>
              <h3>{k.profile.name}</h3>
            </div>
            <div className={k.brushedToday ? 'overview-status good' : 'overview-status'}>
              {k.brushedToday ? '🪥 Brushed today ✓' : `🪥 Not brushed yet today${k.lastBrushed ? ` · last ${k.lastBrushed}` : ''}`}
            </div>
            {k.character?.total != null ? (
              <>
                <div className="small">{k.character.name}: {k.character.placed} of {k.character.total} pieces placed
                  {k.character.unlocked > k.character.placed && ` (${k.character.unlocked - k.character.placed} waiting)`}</div>
                <div className="progress"><i style={{ width: `${(k.character.placed / Math.max(1, k.character.total)) * 100}%` }} /></div>
                {k.character.nextPiece && (
                  <button className="btn small" onClick={() => givePiece(k)}>🎁 Give next piece ({k.character.nextPiece})</button>
                )}
              </>
            ) : (
              <div className="muted small">{k.character ? `${k.character.name} is getting ready…` : 'Not building anything yet'}</div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
