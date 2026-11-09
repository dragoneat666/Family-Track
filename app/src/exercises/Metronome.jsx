import { useEffect, useRef, useState } from 'react';
import { Metronome as Engine } from './metronomeEngine.js';

const MIN = 20;
const MAX = 240;
const STEP = 5;

// Clap along to a steady beat. The speed goes up or down by 5 and is
// remembered on this device for each kid.
export default function Metronome({ profile, onExit }) {
  const key = `ft.metronome.${profile?.id ?? 'family'}`;
  const saved = load(key);
  const [bpm, setBpm] = useState(saved.bpm ?? 60);
  const [running, setRunning] = useState(false);
  const [beat, setBeat] = useState({ n: 0, seconds: 0 });
  const engine = useRef(null);
  const light = useRef(null);

  useEffect(() => {
    engine.current = new Engine();
    let wakeLock = null;
    let frame;
    const tick = () => {
      const h = engine.current?.heard();
      if (h) {
        light.current?.classList.toggle('on', h.since < 0.12);
        const seconds = Math.floor(h.elapsed);
        setBeat((b) => (b.n === h.n && b.seconds === seconds ? b : { n: h.n, seconds }));
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    navigator.wakeLock?.request('screen').then((l) => { wakeLock = l; }).catch(() => {});
    return () => {
      cancelAnimationFrame(frame);
      engine.current.destroy();
      engine.current = null;
      wakeLock?.release?.().catch(() => {});
    };
  }, []);

  useEffect(() => {
    engine.current.setBpm(bpm);
    localStorage.setItem(key, JSON.stringify({ bpm }));
  }, [bpm]);

  async function toggle() {
    const m = engine.current;
    if (m.running) {
      m.stop();
      light.current?.classList.remove('on');
      setRunning(false);
    } else {
      setBeat({ n: 0, seconds: 0 });
      await m.start();
      setRunning(true);
    }
  }

  const change = (d) => setBpm((b) => Math.min(MAX, Math.max(MIN, b + d)));

  return (
    <div className="exercise-screen">
      <header className="build-header">
        <button data-back className="btn" onClick={onExit}>← Back</button>
        <div className="build-title">🥁 Metronome</div>
      </header>

      <div className="metronome">
        <div className="metronome-light" ref={light}>
          <span className="metronome-count">{running ? beat.n || '' : '👏'}</span>
        </div>
        <p className="metronome-hint">{running ? 'Clap on every tick!' : 'Press Start, then clap on every tick.'}</p>

        <div className="metronome-speed">
          <button className="btn big" onClick={() => change(-STEP)} disabled={bpm <= MIN} aria-label="Slower">−</button>
          <div className="metronome-bpm">
            <b>{bpm}</b>
            <span>beats a minute</span>
          </div>
          <button className="btn big" onClick={() => change(STEP)} disabled={bpm >= MAX} aria-label="Faster">+</button>
        </div>

        <button className={running ? 'btn big danger metronome-go' : 'btn big primary metronome-go'} onClick={toggle}>
          {running ? 'Stop' : 'Start'}
        </button>

        <p className="muted metronome-time">{running ? clock(beat.seconds) : ''}</p>
      </div>
    </div>
  );
}

function load(key) {
  try {
    return JSON.parse(localStorage.getItem(key)) || {};
  } catch {
    return {};
  }
}

function clock(s) {
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
