import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { notify } from '../notify.js';

const clock = (ms) => {
  if (!ms) return 'not yet';
  const d = new Date(ms);
  const time = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  return d.toDateString() === new Date().toDateString() ? time : `${d.toLocaleDateString([], { month: 'short', day: 'numeric' })}, ${time}`;
};

// Settings (Android app only): are reminders and pins working on this phone?
// Shows what Android allows, when the phone last heard from the server, and
// a short list of what the notification side did lately (shown at its time,
// put back after a restart, a Done button tapped…). "Send to the server"
// saves that list there, for working out a problem.
export default function NotifyStatus() {
  const [status, setStatus] = useState(null);
  const [open, setOpen] = useState(false);
  const [msg, setMsg] = useState('');

  const load = () => notify.status().then(setStatus);
  useEffect(() => { load(); }, []);
  if (!notify.available || !status) return null;

  async function allow() {
    await notify.allow();
    load();
  }
  async function send() {
    setMsg('');
    try {
      await api.post('/api/parent/notify-log', { status, userAgent: navigator.userAgent });
      setMsg('Saved on the server ✓');
    } catch (e) {
      setMsg(e.message);
    }
  }

  const ok = status.notifications === 'granted';
  const log = [...(status.log || [])].reverse();
  return (
    <div className="card stack">
      <h3>🔔 Reminders and pins on this phone</h3>
      {ok
        ? <div className="overview-status good">Notifications are allowed ✓</div>
        : (
          <div className="stack">
            <div className="overview-status">Notifications are turned off, so reminders and pins can't show.</div>
            {status.notifications === 'prompt'
              ? <button className="btn primary" onClick={allow}>Allow notifications</button>
              : <p className="muted small">Turn them on in Android Settings → Apps → Family Track → Notifications.</p>}
          </div>
        )}
      {status.restricted && <p className="error small">Android is holding Family Track back in the background (battery set to Restricted), so reminders can be late or missed. Change it in Android Settings → Apps → Family Track → Battery.</p>}
      {!status.exactAlarms && <p className="muted small">Android isn't letting this app ring exactly on time, so reminders can be a few minutes late.</p>}
      <p className="muted small">
        Showing now: {status.showing} · waiting for their time: {status.alarms}<br />
        Last heard from the server: {clock(status.lastFetch?.at)} · background check last ran: {clock(status.lastWorker)}
      </p>
      <div className="row wrap">
        <button className="btn small" onClick={() => { setOpen(!open); load(); }}>{open ? 'Hide' : 'What happened lately'}</button>
        {open && <button className="btn small" onClick={send}>Send to the server</button>}
        {msg && <span className="muted small">{msg}</span>}
      </div>
      {open && (
        <div className="notify-log">
          {!log.length && <p className="muted small">Nothing yet.</p>}
          {log.map((l, n) => <div key={n}><span className="muted">{clock(l.t)}</span> {l.m}</div>)}
        </div>
      )}
    </div>
  );
}
