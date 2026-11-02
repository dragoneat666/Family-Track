import { useEffect, useState } from 'react';
import { api } from '../../api.js';
import { useParentCall } from './useParentCall.js';

// Each kid at a glance: brushed today?, and how far along their build is.
export default function OverviewTab({ onAuthLost }) {
  const { error, call } = useParentCall(onAuthLost);
  const [kids, setKids] = useState(null);

  useEffect(() => {
    call(() => api.get('/api/parent/overview')).then((k) => k && setKids(k));
  }, []);

  return (
    <div className="stack">
      {error && <p className="error">{error}</p>}
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
