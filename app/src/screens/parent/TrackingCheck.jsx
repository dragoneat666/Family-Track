import { useEffect, useRef, useState } from 'react';
import { api, canUseCamera } from '../../api.js';
import { openCamera, startTracker } from '../../brush/tracker.js';
import { drawOverlay } from '../../brush/overlay.js';

// A guided ~30-second check of the brushing detection: hold still, move the
// head, move the phone, then brush. Shows how much of each counted as
// brushing and sends only the numbers (never any picture) to the server, so
// the detection can be tuned from real use.
const PHASES = [
  { key: 'still', seconds: 6, text: 'Hold still and look at the camera.', want: false },
  { key: 'head', seconds: 8, text: 'Move your head around. No brushing.', want: false },
  { key: 'phone', seconds: 8, text: 'Keep your head still and move the phone around.', want: false },
  { key: 'brush', seconds: 12, text: 'Now brush your teeth for real.', want: true }
];
const LABELS = { still: 'Holding still', head: 'Moving head', phone: 'Moving phone', brush: 'Brushing' };
const SETTLE_MS = 1000; // ignore the first second of each step while you switch

export default function TrackingCheck({ onExit }) {
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
        eyes: avg('eyesAligned'),
        faceSeen: s.length ? Math.round((100 * s.filter((x) => x.detected).length) / s.length) : 0
      };
    });
    setSummary(rows);
    setStage('done');
    try {
      await api.post('/api/parent/tracking-log', { sensitivity, userAgent: navigator.userAgent, summary: rows, samples });
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
          <button className="btn primary" onClick={onExit}>Back</button>
        </div>
      </div>
    );
  }

  if (stage === 'done') {
    return (
      <div className="center-screen">
        <div className="card stack" style={{ maxWidth: 560, width: '100%' }}>
          <h2>Tracking check results</h2>
          <table className="history">
            <tbody>
              <tr className="muted small"><td>Step</td><td>Counted as brushing</td><td>Should be</td><td>Face seen</td></tr>
              {summary.map((r) => {
                const good = r.want ? r.counted >= 60 : r.counted <= 15;
                return (
                  <tr key={r.key}>
                    <td>{LABELS[r.key]}</td>
                    <td><b>{r.counted}%</b> {good ? '✅' : '⚠️'}</td>
                    <td className="muted">{r.want ? 'most of it' : 'almost none'}</td>
                    <td className="muted">{r.faceSeen}%</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="muted small">{sent}</p>
          <button className="btn primary" onClick={onExit}>Done</button>
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
            mouth {live.mouth.toFixed(1)} · eyes {live.eyes.toFixed(1)} · counts {live.score.toFixed(1)} / needs {live.threshold}
          </div>
        )}
        <button className="btn link" onClick={onExit}>Cancel</button>
      </div>
    </div>
  );
}
