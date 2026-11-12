import { useEffect, useState } from 'react';
import { Sheet } from '../lists/ui.jsx';
import { phoneContacts } from './phone.js';

// Check with my phone: fills in what either side is missing, then shows
// what it did, what differs (pick which is right), linked contacts no longer
// on the phone, and family contacts found on the phone by their number.
// only: just these contact ids (one contact's Check with my phone).
export function PhoneCheck({ contacts, only, onClose }) {
  const [r, setR] = useState(null);
  const [error, setError] = useState('');
  const [settled, setSettled] = useState({}); // key -> 'app' | 'phone' | 'linked' | 'skipped' | 'busy'

  useEffect(() => {
    phoneContacts.check(contacts, { only }).then(setR, (e) => setError(e.message));
  }, []);

  async function act(key, fn, done) {
    setSettled((s) => ({ ...s, [key]: 'busy' }));
    try {
      await fn();
      setSettled((s) => ({ ...s, [key]: done }));
    } catch (e) {
      setSettled((s) => ({ ...s, [key]: undefined }));
      setError(e.message);
    }
  }

  const nothing = r && !r.toApp.length && !r.toPhone.length && !r.diffs.length && !r.gone.length && !r.matches.length && !r.failed.length;
  return (
    <Sheet title="Check with my phone" onClose={onClose}>
      {!r && !error && (
        <div className="stack">
          <div className="spinner" />
          <p className="muted">Checking with this phone's contacts…</p>
        </div>
      )}
      {error && <p className="error">{error}</p>}
      {nothing && <p>✓ Everything matches this phone's contacts.</p>}
      {r && (
        <>
          {r.toApp.length > 0 && (
            <section className="stack tight">
              <b>Filled in here from your phone</b>
              {r.toApp.map(({ c, what }) => <p key={c.id} className="con-check-line">{c.name}: {what}</p>)}
            </section>
          )}
          {r.toPhone.length > 0 && (
            <section className="stack tight">
              <b>Saved to your phone</b>
              {r.toPhone.map(({ c, what }) => <p key={c.id} className="con-check-line">{c.name}: {what}</p>)}
            </section>
          )}
          {r.diffs.length > 0 && (
            <section className="stack tight">
              <b>Different on your phone: which is right?</b>
              {r.diffs.map((d) => {
                const key = `${d.id}-${d.field}`;
                const s = settled[key];
                return (
                  <div key={key} className="con-check-diff">
                    <span><b>{d.name}</b> · {d.field === 'address' ? 'Address' : 'Birthday'}</span>
                    <div className="con-check-choices">
                      <button className={`btn${s === 'app' ? ' primary' : ''}`} disabled={!!s}
                        onClick={() => act(key, () => phoneContacts.settle(d, 'app'), 'app')}>
                        <small>Family Track</small><span className="pre">{d.appText}</span>
                      </button>
                      <button className={`btn${s === 'phone' ? ' primary' : ''}`} disabled={!!s}
                        onClick={() => act(key, () => phoneContacts.settle(d, 'phone'), 'phone')}>
                        <small>Your phone</small><span className="pre">{d.phoneText}</span>
                      </button>
                    </div>
                    {s === 'app' && <span className="muted small">✓ Saved to your phone</span>}
                    {s === 'phone' && <span className="muted small">✓ Changed here</span>}
                  </div>
                );
              })}
            </section>
          )}
          {r.matches.length > 0 && (
            <section className="stack tight">
              <b>Found on your phone</b>
              <span className="muted small">Link them, and they'll be checked with your phone from now on.</span>
              {r.matches.map((m) => {
                const s = settled[`m${m.c.id}`];
                return (
                  <div key={m.c.id} className="con-check-diff">
                    <span><b>{m.c.name}</b> is "{m.phoneName}" on your phone ({m.number})</span>
                    {!s || s === 'busy' ? (
                      <div className="row">
                        <button className="btn primary" disabled={s === 'busy'} onClick={() => act(`m${m.c.id}`, () => phoneContacts.link(m.c, m.key), 'linked')}>🔗 Link</button>
                        <button className="btn" disabled={s === 'busy'} onClick={() => setSettled((x) => ({ ...x, [`m${m.c.id}`]: 'skipped' }))}>Not them</button>
                      </div>
                    ) : <span className="muted small">{s === 'linked' ? '✓ Linked: check again to fill in anything missing' : 'Left alone'}</span>}
                  </div>
                );
              })}
            </section>
          )}
          {r.gone.length > 0 && (
            <section className="stack tight">
              <b>Not on your phone any more</b>
              {r.gone.map((c) => {
                const s = settled[`g${c.id}`];
                return (
                  <div key={c.id} className="row spread">
                    <span>{c.name}</span>
                    {s === 'linked'
                      ? <span className="muted small">✓ Unlinked</span>
                      : <button className="btn small" disabled={s === 'busy'} onClick={() => act(`g${c.id}`, () => phoneContacts.unlink(c), 'linked')}>Unlink</button>}
                  </div>
                );
              })}
            </section>
          )}
          {r.failed.length > 0 && (
            <section className="stack tight">
              <b>Couldn't check</b>
              {r.failed.map(({ c, message }) => <p key={c.id} className="con-check-line">{c.name}: {message}</p>)}
            </section>
          )}
        </>
      )}
    </Sheet>
  );
}

// Add a family contact to this phone's contacts (into its Google account
// when there is one), under a name of the grown-up's choosing, and link it.
export function AddToPhone({ c, onClose }) {
  const [name, setName] = useState(c.name);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(null);
  const [error, setError] = useState('');
  const what = [
    c.phones.length && `${c.phones.length} ${c.phones.length === 1 ? 'number' : 'numbers'}`,
    c.emails?.length && `${c.emails.length} ${c.emails.length === 1 ? 'email' : 'emails'}`,
    c.address && 'address', c.birthday && 'birthday'
  ].filter(Boolean);

  async function add() {
    setBusy(true);
    setError('');
    try {
      setDone({ account: await phoneContacts.add(c, name.trim() || c.name) });
    } catch (e) {
      setError(e.message);
      setBusy(false);
    }
  }

  return (
    <Sheet title="Add to my phone's contacts" onClose={onClose} closeLabel={done ? 'Done' : 'Cancel'}>
      {done ? (
        <p>✓ Added to your phone's contacts{done.account ? ` (${done.account})` : ''}, and linked.</p>
      ) : (
        <>
          <label>
            Name on your phone
            <input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} />
          </label>
          <p className="muted small">
            With {what.length ? what.join(', ') : 'just the name'}. It goes into your Google account if this phone has one, so it
            shows up wherever your Google contacts do.
          </p>
          {error && <p className="error">{error}</p>}
          <button className="btn primary" disabled={busy} onClick={add}>📲 Add to my phone</button>
        </>
      )}
    </Sheet>
  );
}
