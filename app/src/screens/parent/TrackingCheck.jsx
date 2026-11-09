import { useEffect, useRef, useState } from 'react';
import { api, canUseCamera } from '../../api.js';
import { openCamera, startTracker } from '../../brush/tracker.js';
import { drawOverlay } from '../../brush/overlay.js';
import { SPOTS, suggest } from '../../brush/tuning.js';

// A guided ~30-second check of the brushing detection: hold still, move the
// head, move the phone, then brush. Shows how much of each counted as
// brushing and sends only the numbers (never any picture) to the server, so
// the detection can be tuned from real use. Done by a kid, it can also set
// that kid's own setting for where they brush (standing or sitting).
const PHASES = [
  { key: 'still', seconds: 6, text: 'Hold still and look at the camera.', want: false },
  { key: 'head', seconds: 8, text: 'Move your head around. No brushing.', want: false },
  { key: 'phone', seconds: 8, text: 'Keep your head still and move the phone around.', want: false },
  { key: 'brush', seconds: 12, text: 'Now brush your teeth for real.', want: true }
];
const LABELS = { still: 'Holding still', head: 'Moving head', phone: 'Moving phone', brush: 'Brushing' };
const SETTLE_MS = 1000; // ignore the first second of each step while you switch

export default function TrackingCheck({ onExit }) {
  const [kids, setKids] = useState(null);
  const [who, setWho] = useState(null); // { kidId, spot } once picked
  const [kidId, setKidId] = useState('');
  const [spot, setSpot] = useState('standing');

  useEffect(() => {
    api.get('/api/parent/profiles')
      .then((all) => setKids(all.filter((p) => !p.isParent)))
      .catch(() => setKids([]));
  }, []);

  if (who) return <Check kid={(kids || []).find((k) => k.id === who.kidId) ?? null} spot={who.spot} onExit={onExit} />;

  return (
    <div className="center-screen">
      <div className="card stack narrow">
        <h2>📏 Tracking check</h2>
        <p className="muted">About 30 seconds. Set the phone or tablet where it'll really be, and stand or sit where they really brush.</p>
        <label>Who's doing it?
          <select value={kidId} onChange={(e) => setKidId(e.target.value)} disabled={!kids}>
            <option value="">Just me (a grown-up)</option>
            {(kids || []).map((k) => <option key={k.id} value={k.id}>{k.emoji} {k.name}</option>)}
          </select>
        </label>
        <label>Where?
          <select value={spot} onChange={(e) => setSpot(e.target.value)}>
            {Object.entries(SPOTS).map(([k, s]) => <option key={k} value={k}>{s.emoji} {s.label}</option>)}
          </select>
        </label>
        {kidId && <p className="muted small">Afterwards you can save a setting just for them when brushing {SPOTS[spot].short}.</p>}
        <div className="row wrap">
          <button className="btn primary" onClick={() => setWho({ kidId: Number(kidId) || null, spot })}>Start</button>
          <button data-back className="btn link" onClick={onExit}>Cancel</button>
        </div>
      </div>
    </div>
  );
}

function Check({ kid, spot, onExit }) {
  const videoRef = useRef(null);
  const overlayRef = useRef(null);
  const samplesRef = useRef([]);
  const phaseRef = useRef({ index: -1, startedAt: 0 });
  const [stage, setStage] = useState('starting'); // starting | countdown | running | done | error
  const [phaseIndex, setPhaseIndex] = useState(-1);
  const [left, setLeft] = useState(3);
  const [live, setLive] = useState(null);
  const [summary, setSummary] = useState(null);
  const [sent, setSent] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    let stream = null;
    let stop = null;
    let timer = null;
    let cancelled = false;
    (async () => {
      try {
        if (!canUseCamera) throw new Error('The tracking check needs the camera, so it only works in the Android app.');
        const settings = await api.get('/api/settings');
        stream = await openCamera();
        if (cancelled) return;
        videoRef.current.srcObject = stream;
        await videoRef.current.play().catch(() => {});
        // Always the shared setting here, so checks can be compared.
        stop = await startTracker(videoRef.current, {
          sensitivity: settings.sensitivity,
          onUpdate: (st) => {
            setLive(st);
            drawOverlay(overlayRef.current, st, true);
            const p = phaseRef.current;
            if (p.index >= 0 && performance.now() - p.startedAt > SETTLE_MS) {
              samplesRef.current.push({ phase: PHASES[p.index].key, ...st.sample });
            }
          }
        });
        if (cancelled) return;
        setStage('countdown');
        const startAt = performance.now() + 3000;
        timer = setInterval(() => {
          const now = performance.now();
          if (now < startAt) {
            setLeft(Math.ceil((startAt - now) / 1000));
            return;
          }
          // Which step are we in?
          let t = now - startAt;
          let i = 0;
          while (i < PHASES.length && t >= PHASES[i].seconds * 1000) t -= PHASES[i++].seconds * 1000;
          if (i >= PHASES.length) {
            clearInterval(timer);
            stop?.();
            stream?.getTracks().forEach((tr) => tr.stop());
            finish(settings.sensitivity);
            return;
          }
          if (phaseRef.current.index !== i) {
            phaseRef.current = { index: i, startedAt: now };
            setPhaseIndex(i);
            setStage('running');
          }
          setLeft(Math.ceil((PHASES[i].seconds * 1000 - t) / 1000));
        }, 200);
      } catch (e) {
        if (!cancelled) {
          setError(e.message || 'Could not start the camera.');
          setStage('error');
        }
      }
    })();
    return () => {
      cancelled = true;
      clearInterval(timer);
      stop?.();
      stream?.getTracks().forEach((tr) => tr.stop());
    };
  }, []);

  async function finish(sensitivity) {
    const samples = samplesRef.current;
    const rows = PHASES.map((p) => {
      const s = samples.filter((x) => x.phase === p.key);
      const avg = (k) => (s.length ? s.reduce((a, x) => a + x[k], 0) / s.length : 0);
      return {
        key: p.key,
        want: p.want,
        checks: s.length,
        counted: s.length ? Math.round((100 * s.filter((x) => x.brushing).length) / s.length) : 0,
        mouth: avg('mouthAligned'),
        moving: avg('moving'),
        faceSeen: s.length ? Math.round((100 * s.filter((x) => x.detected).length) / s.length) : 0
      };
    });
    setSummary(rows);
    setStage('done');
    try {
      await api.post('/api/parent/tracking-log', { sensitivity, userAgent: navigator.userAgent, kidId: kid?.id ?? null, spot, summary: rows, samples });
      setSent('Numbers sent to the server for tuning (no pictures) ✓');
    } catch (e) {
      setSent(`Couldn't send the numbers: ${e.message}`);
    }
  }

  if (stage === 'error') {
    return (
      <div className="center-screen">
        <div className="card narrow">
          <h2>Can't run the check</h2>
          <p>{error}</p>
          <button data-back className="btn primary" onClick={onExit}>Back</button>
        </div>
      </div>
    );
  }

  if (stage === 'done') {
    return (
      <div className="center-screen">
        <div className="card stack" style={{ maxWidth: 560, width: '100%' }}>
          <h2>Tracking check results</h2>
          <p className="muted small">With the setting everyone shares now (under Brushing):</p>
          <ResultTable rows={summary.map((r) => ({ key: r.key, want: r.want, counted: r.counted, faceSeen: r.faceSeen }))} />
          {kid && <OwnSetting kid={kid} spot={spot} samples={samplesRef.current} />}
          <p className="muted small">{sent}</p>
          <button data-back className="btn primary" onClick={onExit}>Done</button>
        </div>
      </div>
    );
  }

  const phase = PHASES[phaseIndex];
  return (
    <div className="brush-screen">
      <div className="brush-camera">
        <div className="mirror">
          <video ref={videoRef} playsInline muted autoPlay />
          <canvas ref={overlayRef} className="overlay" />
        </div>
      </div>
      <div className="brush-side">
        <div className="test-banner">Tracking check — step {Math.max(1, phaseIndex + 1)} of {PHASES.length}</div>
        {stage === 'starting' && <div className="brush-message">Getting the camera ready…</div>}
        {stage === 'countdown' && <div className="brush-message">Starting in {left}… First: {PHASES[0].text}</div>}
        {stage === 'running' && (
          <>
            <div className="zone-label">{phase.text}</div>
            <div className="time">{left}</div>
          </>
        )}
        {live && (
          <div className={`brush-message ${live.brushing ? '' : 'warn'}`}>
            {live.brushing ? 'Counts as brushing' : live.faceVisible ? 'Not counting' : "Can't see your face"}
          </div>
        )}
        {live && (
          <div className="tracking-info">
            mouth {live.mouth.toFixed(1)} · face moving {live.moving.toFixed(2)} · counts {live.score.toFixed(1)} / needs {live.threshold}
            {live.sample?.d ? ` · face ${Math.round(live.sample.d)}` : ''}
          </div>
        )}
        <button data-back className="btn link" onClick={onExit}>Cancel</button>
      </div>
    </div>
  );
}

function ResultTable({ rows }) {
  return (
    <table className="history">
      <tbody>
        <tr className="muted small"><td>Step</td><td>Counted as brushing</td><td>Should be</td>{rows[0]?.faceSeen != null && <td>Face seen</td>}</tr>
        {rows.map((r) => {
          const good = r.want ? r.counted >= 60 : r.counted <= 15;
          return (
            <tr key={r.key}>
              <td>{LABELS[r.key]}</td>
              <td><b>{r.counted}%</b> {good ? '✅' : '⚠️'}</td>
              <td className="muted">{r.want ? 'most of it' : 'almost none'}</td>
              {r.faceSeen != null && <td className="muted">{r.faceSeen}%</td>}
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

// Works out the best setting for this kid from the check and offers to save it.
function OwnSetting({ kid, spot, samples }) {
  const [best] = useState(() => suggest(samples));
  const [saved, setSaved] = useState('');
  const where = SPOTS[spot].short;

  async function save() {
    setSaved('Saving…');
    try {
      await api.put(`/api/parent/profiles/${kid.id}/brush-tuning/${spot}`, { threshold: best.threshold, d: best.d });
      setSaved(`Saved ✓ ${kid.name} now uses this when brushing ${where}.`);
    } catch (e) {
      setSaved(`Couldn't save: ${e.message}`);
    }
  }

  if (!best) {
    return (
      <div className="stack">
        <h3>Just for {kid.name}</h3>
        <p className="small">No setting tells their brushing apart from moving around well enough this time.
          Try again closer to the camera, with more light, or brushing a bit bigger.</p>
      </div>
    );
  }
  const r = best.result;
  return (
    <div className="stack">
      <h3>Just for {kid.name}, {where}</h3>
      <p className="muted small">With a setting of {best.threshold} (the shared “normal” is 8), this check would have gone:</p>
      <ResultTable rows={PHASES.map((p) => ({ key: p.key, want: p.want, counted: r[p.key] ?? 0 }))} />
      {kid.brushTuning?.[spot] && <p className="muted small">This replaces their {where} setting of {kid.brushTuning[spot].threshold}.</p>}
      <div className="row wrap">
        <button className="btn primary" onClick={save} disabled={!!saved && !saved.startsWith('Couldn')}>Use this for {kid.name} {where}</button>
      </div>
      {saved && <p className="small">{saved}</p>}
    </div>
  );
}
