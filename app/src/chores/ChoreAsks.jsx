import { useEffect, useRef, useState } from 'react';
import { api } from '../api.js';
import { notify } from '../notify.js';
import { Sheet } from '../lists/ui.jsx';
import { CheckOff } from './ChoresScreen.jsx';
import { weekdayOf } from './money.js';

// When a reminder linked to a chore is marked Done (here, or from the
// phone's notification while the app was closed), the server keeps a
// question for that grown-up: check the chore off too? This shows them one
// at a time, whatever screen a grown-up is on.
export const checkChoreAsks = () => window.dispatchEvent(new Event('ft:chore-asks'));

export default function ChoreAsks() {
  const [asks, setAsks] = useState([]);
  const [kids, setKids] = useState(null);
  const [error, setError] = useState('');
  const busy = useRef(false);
  const [hidden, setHidden] = useState([]); // closed without answering: back when the app is opened again

  // sendFirst: a notification's Done this phone hasn't told the server about
  // yet goes first (so its question is there).
  async function load({ sendFirst = false } = {}) {
    if (busy.current) return;
    busy.current = true;
    try {
      if (sendFirst && notify.available) await notify.sync();
      const r = await api.get('/api/chores/asks');
      setAsks(r.asks);
      if (r.asks.length && !kids) setKids((await api.get('/api/chores')).kids);
    } catch { /* no server right now: next time */ }
    busy.current = false;
  }

  useEffect(() => {
    load({ sendFirst: true });
    const onVisible = () => { if (document.visibilityState === 'visible') { setHidden([]); load({ sendFirst: true }); } };
    const onAsk = () => load();
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('ft:chore-asks', onAsk);
    // (A notification's Done tapped while the app is open.)
    const t = setInterval(() => { if (document.visibilityState === 'visible') load(); }, 60 * 1000);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('ft:chore-asks', onAsk);
      clearInterval(t);
    };
  }, []);

  const a = asks.find((x) => !hidden.includes(x.id));
  if (!a || !kids) return null;

  async function answer(body) {
    setError('');
    try {
      await api.post(`/api/chores/asks/${a.id}`, body);
      setAsks((x) => x.filter((y) => y.id !== a.id));
      window.dispatchEvent(new Event('ft:chores-changed'));
    } catch (e) {
      setError(e.message);
    }
  }

  const c = a.chore;
  const when = a.day === new Date().toLocaleDateString('en-CA') ? '' : ` (${weekdayOf(a.day)})`;
  return (
    <Sheet key={a.id} title={`⏰ ${a.reminderTitle} is done`} onClose={() => setHidden((h) => [...h, a.id])} closeLabel="Later">
      {a.by && <p className="muted">{a.by} marked it done.</p>}
      {c.full ? (
        <>
          <p><b>{c.name}</b> {c.offWeek ? "isn't on this week" : `is already checked off ${c.times === 1 ? 'for this week' : `all ${c.times} times this week`}`}.</p>
          <div className="row"><button className="btn primary" onClick={() => answer({ skip: true })}>OK</button></div>
        </>
      ) : (
        <>
          <p>Check off <b>{c.name}</b>{when} too? Tick who did it.</p>
          {error && <p className="error">{error}</p>}
          <CheckOff chore={c} kids={kids} saveLabel="✓ Check it off" onSave={(picked) => answer({ kids: picked })}
            extra={<button className="btn" onClick={() => answer({ skip: true })}>Not this time</button>} />
        </>
      )}
    </Sheet>
  );
}
