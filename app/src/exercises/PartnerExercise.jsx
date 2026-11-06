import { useEffect, useRef, useState } from 'react';
import { PartnerScene } from '../three/partnerScene.js';
import { api } from '../api.js';
import { VoicePlayer } from './voice.js';
import { MAX_COUNT, lineWords } from './lines.js';
import { ScriptPlayer } from './scriptPlayer.js';
import { buildTimeline, settingsFor, previousStart, nextStart, repeatRange } from './timeline.js';

// One of the partner's exercises, played from its script: the partner acts out
// each scene, says its line, and the words go on the screen; then it waits for
// the kid or counts while they hold.
export default function PartnerExercise({ kid, exercise, grownUp, onExit }) {
  const partner = kid.partner;
  const script = exercise.script;
  const holder = useRef(null);
  const player = useRef(null);
  const voice = useRef(null);
  const [frame, setFrame] = useState(null);
  const [state, setState] = useState('ready'); // ready | playing | paused | finished
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState('');
  const settings = settingsFor(exercise, kid.settings[exercise.slug]);

  useEffect(() => {
    const v = new VoicePlayer();
    voice.current = v;
    const scene = new PartnerScene(holder.current);
    const p = new ScriptPlayer({
      scene, voice: v,
      onFrame: (s) => setFrame(s),
      onEnd: () => setState('finished')
    });
    player.current = p;
    let gone = false;
    let wakeLock = null;
    navigator.wakeLock?.request('screen').then((l) => { wakeLock = l; }).catch(() => {});
    Promise.all([
      scene.load(api.url(`/api/characters/${partner.id}/exercise.glb?v=${partner.version}`), api.authHeaders()),
      v.load(partner)
    ]).then(() => {
      if (gone) return;
      p.setTimeline(buildTimeline(script, settings, (k) => v.duration(k), (k) => lineWords(partner.voice, k)), false);
      setLoaded(true);
    }).catch((e) => { if (!gone) setError(e.message || `${partner.name} would not load.`); });
    return () => {
      gone = true;
      p.destroy();
      v.destroy();
      scene.destroy();
      wakeLock?.release?.().catch(() => {});
    };
  }, [partner.id, partner.version, exercise.id]);

  // New settings = a new timeline (before starting).
  useEffect(() => {
    if (loaded && state === 'ready') player.current.setTimeline(buildTimeline(script, settings, (k) => voice.current.duration(k), (k) => lineWords(partner.voice, k)), false);
  }, [loaded, settings.wait, settings.hold, settings.rounds]);

  function change(key, value) {
    kid.save({ settings: { [exercise.slug]: { ...settings, [key]: value } } });
  }

  async function start() {
    await voice.current.resume();
    player.current.seek(0);
    player.current.play();
    setState('playing');
  }

  function jump(to) {
    const p = player.current;
    if (to >= p.tl.total - 1e-3) {
      p.pause();
      p.seek(p.tl.total);
      setState('finished');
      p.idle();
      return;
    }
    p.seek(to);
    player.current.play();
    setState('playing');
  }

  function togglePause() {
    if (state === 'paused') {
      player.current.play();
      setState('playing');
    } else {
      player.current.pause();
      setState('paused');
    }
  }

  function stop() {
    player.current.pause();
    player.current.seek(0);
    setState('ready');
  }

  const p = player.current;
  const tl = p?.tl;
  const uses = (then) => script.scenes.some((s) => s.then === then && s.seconds == null);
  const repeats = !!repeatRange(script);
  const running = state === 'playing' || state === 'paused';

  return (
    <div className="exercise-screen starfish-screen">
      <header className="build-header">
        <button className="btn" onClick={onExit}>← Back</button>
        <div className="build-title">{exercise.emoji} {exercise.name}</div>
        <span className="coach-chip">With {partner.name}</span>
      </header>

      <div className="starfish-body">
        <div className="starfish-stage" ref={holder} />

        <div className="starfish-panel">
          {error && <p className="error">{error}</p>}
          {state === 'ready' && (
            <>
              <p className="starfish-say">Ready?</p>
              {uses('wait') && <Stepper label="Get in place" unit="s" value={settings.wait} min={1} max={60} onChange={(v) => change('wait', v)} locked={!grownUp} />}
              {uses('count') && <Stepper label="Hold" unit="s" value={settings.hold} min={1} max={MAX_COUNT} onChange={(v) => change('hold', v)} locked={!grownUp} />}
              {repeats && <Stepper label="Rounds" value={settings.rounds} min={1} max={20} onChange={(v) => change('rounds', v)} locked={!grownUp} />}
              {!grownUp && (uses('wait') || uses('count') || repeats) && <p className="muted small">A grown-up can change these.</p>}
              <button className="btn big primary" onClick={start} disabled={!loaded}>
                {loaded ? 'Start' : error ? 'Not ready' : `Getting ${partner.name} ready…`}
              </button>
            </>
          )}

          {state !== 'ready' && frame && (
            <>
              {frame.seg.round && tl.rounds > 1 && <p className="starfish-round">Round {frame.seg.round} of {tl.rounds}</p>}
              <p className="starfish-say">{state === 'finished' ? `🎉 ${frame.words || 'All done!'}` : frame.words}</p>
              <div className={`starfish-big ${frame.phase}`}>
                {state !== 'finished' && frame.phase === 'count' && frame.count}
                {state !== 'finished' && frame.phase === 'wait' && <>⏳ {frame.left}</>}
              </div>
              {running ? (
                <div className="row wrap starfish-controls">
                  <button className="btn" onClick={() => jump(previousStart(tl, p.time))} aria-label="Back a step">⏮</button>
                  <button className="btn primary" onClick={togglePause}>{state === 'paused' ? '▶ Keep going' : '⏸ Pause'}</button>
                  <button className="btn" onClick={() => jump(nextStart(tl, p.time))} aria-label="Next step">⏭</button>
                  <button className="btn danger" onClick={stop}>Stop</button>
                </div>
              ) : (
                <div className="row wrap starfish-controls">
                  <button className="btn big primary" onClick={start}>Again</button>
                  <button className="btn big" onClick={onExit}>Done</button>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function Stepper({ label, value, unit = '', min, max, onChange, locked }) {
  return (
    <div className="stepper">
      <span className="stepper-label">{label}</span>
      {!locked && <button className="btn" onClick={() => onChange(Math.max(min, value - 1))} disabled={value <= min}>−</button>}
      <b className="stepper-value">{value}{unit && ` ${unit}`}</b>
      {!locked && <button className="btn" onClick={() => onChange(Math.min(max, value + 1))} disabled={value >= max}>+</button>}
    </div>
  );
}
