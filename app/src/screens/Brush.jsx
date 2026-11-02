import { useEffect, useRef, useState } from 'react';
import { api } from '../api.js';
import { openCamera, startTracker } from '../brush/tracker.js';

// The brushing session. The countdown only moves while the camera sees the
// kid actually brushing; otherwise it simply waits. In test mode (from the
// parent area) nothing is saved and the tracking numbers are always shown.

const ZONES = [
  { key: 'tl', label: 'Top teeth', side: 'left' },
  { key: 'tr', label: 'Top teeth', side: 'right' },
  { key: 'br', label: 'Bottom teeth', side: 'right' },
  { key: 'bl', label: 'Bottom teeth', side: 'left' }
];
const CHEERS = ['You\'re doing great!', 'Little circles!', 'Keep it up!', 'Sparkly teeth coming up!', 'Nice and gentle!', 'Brush brush brush!'];
const GRACE_MS = 900; // a short stop doesn't pause right away

export default function Brush({ profile, testMode = false, onExit }) {
  const videoRef = useRef(null);
  const overlayRef = useRef(null);
  const statusRef = useRef({ faceVisible: false, brushing: false });
  const timesRef = useRef({ brushed: 0, paused: 0, last: 0, notBrushingSince: 0 });
  const stopRef = useRef(() => {});
  const finishedRef = useRef(false);

  const [settings, setSettings] = useState(null);
  const [phase, setPhase] = useState('starting'); // starting | brushing | done | error
  const [error, setError] = useState('');
  const [brushedMs, setBrushedMs] = useState(0);
  const [pause, setPause] = useState('starting'); // null | 'starting' | 'face' | 'motion'
  const [status, setStatus] = useState(null);
  const [cheer, setCheer] = useState(0);
  const [result, setResult] = useState(null);

  const mainMs = (settings?.mainSeconds ?? 120) * 1000;
  const frontMs = (settings?.frontSeconds ?? 15) * 1000;
  const totalMs = mainMs + frontMs;
  // Parents trying things out (test mode or the test kid) get the numbers and a skip button.
  const practice = testMode || !!profile?.isTest;
  const showInfo = practice || settings?.showTrackingInfo;

  useEffect(() => {
    let cancelled = false;
    let stream = null;
    let stopTracker = null;
    let wakeLock = null;
    let timer = null;

    (async () => {
      try {
        const s = await api.get('/api/settings');
        if (cancelled) return;
        setSettings(s);
        try {
          stream = await openCamera();
        } catch {
          throw new Error('The camera is needed for brushing. Ask a grown-up to allow the camera for this app.');
        }
        if (cancelled) return;
        const video = videoRef.current;
        video.srcObject = stream;
        await video.play().catch(() => {});
        stopTracker = await startTracker(video, {
          sensitivity: s.sensitivity,
          onUpdate: (st) => {
            statusRef.current = st;
            setStatus(st);
            drawOverlay(overlayRef.current, st, testMode || !!profile?.isTest || s.showTrackingInfo);
          }
        });
        if (cancelled) return;
        wakeLock = await navigator.wakeLock?.request('screen').catch(() => null);
        timesRef.current.last = performance.now();
        setPhase('brushing');
        timer = setInterval(() => tick(s), 200);
      } catch (e) {
        if (!cancelled) {
          setError(e.message || 'Something went wrong starting the camera.');
          setPhase('error');
        }
      }
    })();

    stopRef.current = () => {
      clearInterval(timer);
      stopTracker?.();
      stream?.getTracks().forEach((t) => t.stop());
      wakeLock?.release?.().catch(() => {});
    };
    const cheerTimer = setInterval(() => setCheer((c) => c + 1), 7000);
    return () => {
      cancelled = true;
      clearInterval(cheerTimer);
      stopRef.current();
    };
  }, []);

  function tick(s) {
    const t = timesRef.current;
    const now = performance.now();
    const dt = Math.min(now - t.last, 1000);
    t.last = now;
    const st = statusRef.current;
    let reason = null;
    if (!st.faceVisible) {
      reason = 'face';
    } else if (!st.brushing) {
      t.notBrushingSince ||= now;
      if (now - t.notBrushingSince > GRACE_MS) reason = 'motion';
    } else {
      t.notBrushingSince = 0;
    }
    if (reason) t.paused += dt;
    else t.brushed += dt;
    setPause(reason);
    setBrushedMs(t.brushed);
    if (t.brushed >= (s.mainSeconds + s.frontSeconds) * 1000) finish(true);
  }

  async function finish(completed) {
    if (finishedRef.current) return;
    finishedRef.current = true;
    stopRef.current();
    const t = timesRef.current;
    if (testMode) {
      setResult({ completed, test: true });
      setPhase('done');
      return;
    }
    if (!completed && t.brushed < 10000) return onExit(false);
    try {
      const r = await api.post(`/api/kids/${profile.id}/brush`, {
        completed,
        secondsBrushed: t.brushed / 1000,
        secondsPaused: t.paused / 1000
      });
      if (!completed) return onExit(false);
      setResult(r);
    } catch (e) {
      setResult({ completed, error: e.message });
    }
    setPhase('done');
  }

  function stopEarly() {
    if (practice || window.confirm('Stop brushing? You need to finish to earn a piece.')) finish(false);
  }

  function skipAhead() {
    timesRef.current.brushed = Math.min(timesRef.current.brushed + 30000, totalMs - 1000);
  }

  if (phase === 'error') {
    return (
      <div className="center-screen">
        <div className="card narrow">
          <h2>Uh oh</h2>
          <p>{error}</p>
          <button className="btn primary" onClick={() => onExit(false)}>Back</button>
        </div>
      </div>
    );
  }

  if (phase === 'done') return <BrushResult result={result} testMode={testMode} onExit={onExit} />;

  const inFront = brushedMs >= mainMs;
  const zoneIndex = Math.min(3, Math.floor(brushedMs / (mainMs / 4)));
  const zone = inFront ? { key: 'front', label: 'Front teeth' } : ZONES[zoneIndex];
  const remaining = Math.max(0, Math.ceil((totalMs - brushedMs) / 1000));
  const pct = Math.min(1, brushedMs / totalMs);
  const R = 46;

  let message;
  if (phase === 'starting') message = 'Getting the camera ready…';
  else if (pause === 'face') message = "👀 I can't see you! Look at the camera.";
  else if (pause === 'motion') message = '⏸ Keep that brush moving!';
  else if (inFront) message = 'Close your teeth, big smile, and brush the fronts!';
  else message = CHEERS[cheer % CHEERS.length];

  return (
    <div className={`brush-screen ${pause && phase === 'brushing' ? 'is-paused' : ''}`}>
      <div className="brush-camera">
        <div className="mirror">
          <video ref={videoRef} playsInline muted autoPlay />
          <canvas ref={overlayRef} className="overlay" />
        </div>
        <svg className="ring" viewBox="0 0 100 100">
          <circle cx="50" cy="50" r={R} className="ring-track" />
          <circle cx="50" cy="50" r={R} className="ring-fill" strokeDasharray={2 * Math.PI * R}
            strokeDashoffset={2 * Math.PI * R * (1 - pct)} transform="rotate(-90 50 50)" />
        </svg>
      </div>

      <div className="brush-side">
        {testMode && <div className="test-banner">Test mode — nothing is saved</div>}
        {profile?.isTest && <div className="test-banner">Test kid — a new piece every time</div>}
        <div className="time">{Math.floor(remaining / 60)}:{String(remaining % 60).padStart(2, '0')}</div>
        <MouthMap zone={zone.key} />
        <div className="zone-label">
          {zone.label}{zone.side && <> on <b>this side</b> {zone.side === 'left' ? '👈' : '👉'}</>}
        </div>
        <div className={`brush-message ${pause ? 'warn' : ''}`}>{message}</div>
        {showInfo && status && (
          <div className="tracking-info">
            face {status.faceVisible ? '✓' : '✗'} · movement {status.score.toFixed(1)} / needs {status.threshold}
            · {status.stepMs.toFixed(0)} ms per check
          </div>
        )}
        <div className="brush-buttons">
          {practice && <button className="btn" onClick={skipAhead}>Skip 30 s</button>}
          <button className="btn link" onClick={stopEarly}>Stop</button>
        </div>
      </div>
    </div>
  );
}

// Teeth map, drawn as seen in the mirror: the kid's left is on the left.
function MouthMap({ zone }) {
  const on = (k) => (zone === k ? 'tooth-zone active' : 'tooth-zone');
  return (
    <svg className="mouth-map" viewBox="0 0 200 120">
      <rect x="10" y="8" width="88" height="46" rx="20" className={on('tl')} />
      <rect x="102" y="8" width="88" height="46" rx="20" className={on('tr')} />
      <rect x="10" y="66" width="88" height="46" rx="20" className={on('bl')} />
      <rect x="102" y="66" width="88" height="46" rx="20" className={on('br')} />
      {zone === 'front' && <rect x="62" y="8" width="76" height="104" rx="24" className="tooth-zone active" />}
    </svg>
  );
}

function drawOverlay(canvas, st, show) {
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  if (!show || !st.region) {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    return;
  }
  if (canvas.width !== st.videoWidth) {
    canvas.width = st.videoWidth;
    canvas.height = st.videoHeight;
  }
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.lineWidth = 4;
  ctx.strokeStyle = st.brushing ? '#3ddc84' : st.faceVisible ? '#ffcc00' : '#ff5555';
  ctx.strokeRect(st.region.x, st.region.y, st.region.w, st.region.h);
}

function BrushResult({ result, testMode, onExit }) {
  if (testMode) {
    return (
      <div className="center-screen">
        <div className="card narrow result">
          <div className="result-emoji">{result.completed ? '✅' : '⏹️'}</div>
          <h2>{result.completed ? 'Test brushing finished' : 'Test stopped'}</h2>
          <p>Nothing was saved and no pieces were unlocked.</p>
          <button className="btn primary" onClick={() => onExit(false)}>Back</button>
        </div>
      </div>
    );
  }
  if (result.error) {
    return (
      <div className="center-screen">
        <div className="card narrow result">
          <div className="result-emoji">⭐</div>
          <h2>Great brushing!</h2>
          <p>But I couldn't tell the server: {result.error}</p>
          <button className="btn primary" onClick={() => onExit(false)}>OK</button>
        </div>
      </div>
    );
  }
  const c = result.state?.character;
  let note = 'Great job!';
  if (c?.status === 'ready') {
    if (c.complete || !c.nextPiece) note = `You have all of ${c.name}'s pieces!`;
    else if (c.unlockedToday) note = "You already got today's piece. A new one tomorrow!";
    else note = 'Keep brushing every day to earn the next piece!';
  }
  return (
    <div className="center-screen">
      <div className="card narrow result celebrate">
        <div className="result-emoji">{result.unlockedPiece ? '🎉' : '⭐'}</div>
        <h2>Sparkly teeth!</h2>
        {result.unlockedPiece ? (
          <>
            <p>You unlocked a new piece: <b>{result.unlockedPiece.name}</b></p>
            <button className="btn primary big" onClick={() => onExit(true)}>Build it now!</button>
            <button className="btn link" onClick={() => onExit(false)}>Later</button>
          </>
        ) : (
          <>
            <p>{note}</p>
            <button className="btn primary big" onClick={() => onExit(false)}>OK</button>
          </>
        )}
      </div>
    </div>
  );
}
