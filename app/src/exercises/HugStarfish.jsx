import { useEffect, useRef, useState } from 'react';
import { FigureScene, STARFISH, resolvePose } from '../three/figure.js';
import { PartnerScene } from '../three/partnerScene.js';
import { api } from '../api.js';
import { VoicePlayer } from './voice.js';
import { MAX_COUNT, numberLine } from './lines.js';
import { PARTS, canStarfish, clipFor, segments } from './partnerMoves.js';

const DEFAULTS = { wait: 5, hold: 10, rounds: 4 };
const SIT = (50 * Math.PI) / 180;
const TUCK = (40 * Math.PI) / 180;
const cap = (s) => s[0].toUpperCase() + s.slice(1);

// Hug & Starfish: one arm on the chest, the other on top, cross the leg on
// the same side as the top arm, sit up with the head tucked and hold, then
// lie back out into a starfish. Next round, the other arm goes on top.
function buildSteps(rounds) {
  const steps = [{ line: 'starfish_start', text: 'Lie down like a starfish', pose: STARFISH, wait: true }];
  for (let r = 0; r < rounds; r++) {
    const top = r % 2 === 0 ? 'left' : 'right';
    const under = top === 'left' ? 'right' : 'left';
    const T = cap(top)[0];
    const U = cap(under)[0];
    const round = { round: r + 1, top };
    if (r > 0) steps.push({ ...round, line: 'other_side', text: 'Other side!' });
    steps.push(
      { ...round, part: 0, line: `chest_${under}`, text: `${cap(under)} arm on your chest`, pose: { [`arm${U}`]: 'under' }, glow: [`arm${U}`], wait: true },
      { ...round, part: 1, line: `top_${top}`, text: `${cap(top)} arm on top`, pose: { [`arm${T}`]: 'over' }, glow: [`arm${T}`], wait: true },
      { ...round, part: 2, line: `leg_${top}`, text: `Cross your ${top} leg over`, pose: { [`leg${T}`]: 'over', [`leg${U}`]: 'straight' }, glow: [`leg${T}`], wait: true },
      { ...round, part: 3, line: 'sit_up', text: 'Sit up and tuck your head', pose: { spine: SIT, neck: TUCK }, glow: ['body', 'head'], wait: true },
      { ...round, line: 'hold', text: 'Hold it!', count: true },
      { ...round, line: 'lie_back', text: 'Lie back down… starfish!', pose: STARFISH, wait: true }
    );
  }
  steps.push({ line: 'done', text: 'All done! Great job!', done: true });
  return steps;
}

// Where the figure should be at a step: every pose change up to it, in order.
const poseAt = (steps, i) => steps.slice(0, i + 1).reduce((p, s) => (s.pose ? { ...p, ...s.pose } : p), STARFISH);

const STOP = Symbol('stop');
const delay = (ms) => new Promise((r) => setTimeout(r, ms));

// The built-in figure made of shapes: used when the kid has no partner yet
// (or theirs has no Hug & Starfish animations).
class FigureActor {
  constructor(container) {
    this.figure = new FigureScene(container);
  }
  step(steps, i) {
    this.figure.setPose(resolvePose(poseAt(steps, i)), 1.3);
    this.figure.highlight(steps[i].glow || []);
  }
  rest() {
    this.figure.setPose(resolvePose(STARFISH), 1);
    this.figure.highlight([]);
  }
  finish() {
    this.figure.highlight([]);
  }
  pause() {}
  destroy() {
    this.figure.destroy();
  }
}

// The kid's partner, acting out each step with the animations made for it.
// "Get into position" plays one part per step, stopping at the pause marks.
class PartnerActor {
  constructor(scene, partner) {
    this.scene = scene;
    this.partner = partner;
  }
  part(side, n) {
    const name = clipFor(this.partner, 'in', side);
    const parts = segments(this.partner.marks?.[name], this.scene.duration(name), PARTS.starfish.length);
    return { name, from: parts[n][0], to: parts[n][1] };
  }
  starfish(side) {
    this.scene.show(clipFor(this.partner, 'in', side), 0);
  }
  step(steps, i) {
    const s = steps[i];
    const sc = this.scene;
    if (s.part != null) {
      const p = this.part(s.top, s.part);
      sc.show(p.name, p.from);
      return sc.playTo(p.to);
    } else if (s.count) {
      const name = clipFor(this.partner, 'in', s.top);
      sc.show(name, sc.duration(name));
    } else if (s.line === 'lie_back') {
      const out = clipFor(this.partner, 'out', s.top);
      if (out) {
        sc.show(out, 0);
        return sc.playTo(sc.duration(out));
      }
      // No lie-back animation: play getting into position backwards.
      const name = clipFor(this.partner, 'in', s.top);
      sc.show(name, sc.duration(name));
      return sc.playTo(0);
    } else if (s.done) {
      const cheer = this.partner.uses?.cheer;
      if (cheer) sc.loop(cheer);
    } else {
      // Starting out, or between rounds: a starfish, ready for the next side.
      const next = steps.slice(i).find((x) => x.part === 0);
      this.starfish(next?.top ?? 'left');
    }
  }
  rest() {
    this.starfish('left');
  }
  finish() {}
  pause(on) {
    this.scene.frozen = on;
  }
  destroy() {
    this.scene.destroy();
  }
}

// Runs the steps: say the line, then wait (or count), then the next one.
// Pausing stops the clock; back/next jump straight to a step.
class Routine {
  constructor({ player, actor, onChange }) {
    Object.assign(this, { player, actor, onChange });
    this.paused = false;
    this.token = null;
  }

  go(steps, index, settings) {
    this.player.stopAll();
    const token = {};
    this.token = token;
    this.run(steps, index, settings, token).catch((e) => { if (e !== STOP) console.error(e); });
  }

  stop() {
    this.token = null;
    this.player.stopAll();
  }

  check(token) {
    if (this.token !== token) throw STOP;
  }

  // Waits ms of un-paused time, measured on the real clock so seconds stay
  // seconds.
  async sleep(ms, token) {
    let left = ms;
    let last = performance.now();
    while (left > 0) {
      this.check(token);
      await delay(Math.min(left, 50));
      const now = performance.now();
      if (!this.paused) left -= now - last;
      last = now;
    }
    this.check(token);
  }

  async run(steps, i, { wait, hold }, token) {
    for (; i < steps.length; i++) {
      const step = steps[i];
      this.onChange({ index: i, phase: 'say' });
      // The partner moves while the line is said and the countdown runs; the
      // next step waits for the move to finish so none get cut short.
      let moved = false;
      Promise.resolve(this.actor.step(steps, i)).finally(() => { moved = true; });
      while (this.paused) await this.sleep(100, token);
      await this.player.play(step.line);
      this.check(token);
      if (step.count) {
        for (let n = 1; n <= hold; n++) {
          await this.sleep(1000, token);
          this.onChange({ index: i, phase: 'count', count: n });
          this.player.stopAll();
          this.player.play(numberLine(n));
        }
        await this.sleep(1000, token);
      } else if (step.wait) {
        for (let s = wait; s > 0; s--) {
          this.onChange({ index: i, phase: 'wait', left: s });
          await this.sleep(1000, token);
        }
      } else if (!step.done) {
        await this.sleep(600, token);
      }
      while (!moved && !step.done) await this.sleep(50, token);
    }
    this.actor.finish();
    this.onChange({ index: steps.length - 1, phase: 'finished' });
    this.token = null;
  }
}

export default function HugStarfish({ kid, grownUp, onExit }) {
  const holder = useRef(null);
  const routine = useRef(null);
  const player = useRef(null);
  const [now, setNow] = useState(null); // { index, phase, count, left }
  const [paused, setPaused] = useState(false);
  const [voiceReady, setVoiceReady] = useState(false);
  const [actorReady, setActorReady] = useState(false);
  const settings = { ...DEFAULTS, ...(kid.settings.starfish || {}) };
  const [steps, setSteps] = useState(() => buildSteps(settings.rounds));
  const partner = canStarfish(kid.partner) ? kid.partner : null;

  useEffect(() => {
    player.current = new VoicePlayer();
    routine.current = new Routine({ player: player.current, actor: null, onChange: setNow });
    let wakeLock = null;
    navigator.wakeLock?.request('screen').then((l) => { wakeLock = l; }).catch(() => {});
    return () => {
      routine.current.stop();
      player.current.destroy();
      wakeLock?.release?.().catch(() => {});
    };
  }, []);

  // The partner (or the shape figure), once we know who the kid picked.
  useEffect(() => {
    if (!kid.loaded) return;
    let actor = null;
    let gone = false;
    setActorReady(false);
    (async () => {
      if (partner) {
        const scene = new PartnerScene(holder.current);
        try {
          await scene.load(api.url(`/api/characters/${partner.id}/exercise.glb?v=${partner.version}`), api.authHeaders());
          actor = new PartnerActor(scene, partner);
        } catch (e) {
          console.error(e);
          scene.destroy();
        }
      }
      if (gone) return actor?.destroy();
      actor ??= new FigureActor(holder.current);
      actor.rest();
      routine.current.actor = actor;
      setActorReady(true);
    })();
    return () => {
      gone = true;
      routine.current.stop();
      actor?.destroy();
    };
  }, [kid.loaded, partner?.id, partner?.version, JSON.stringify(partner?.marks), JSON.stringify(partner?.uses)]);

  // Load the partner's voice lines whenever the partner changes.
  useEffect(() => {
    if (!kid.loaded) return;
    setVoiceReady(false);
    player.current.load(kid.partner).finally(() => setVoiceReady(true));
  }, [kid.loaded, kid.partner?.id, kid.partner?.effect, JSON.stringify(kid.partner?.lines)]);

  function change(key, value) {
    kid.save({ settings: { starfish: { ...settings, [key]: value } } });
  }

  async function start() {
    await player.current.resume();
    const s = buildSteps(settings.rounds);
    setSteps(s);
    setPaused(false);
    routine.current.paused = false;
    routine.current.go(s, 0, settings);
  }

  function jump(i) {
    routine.current.paused = false;
    setPaused(false);
    routine.current.go(steps, Math.max(0, Math.min(steps.length - 1, i)), settings);
  }

  function togglePause() {
    routine.current.paused = !paused;
    routine.current.actor?.pause(!paused);
    if (!paused) player.current.stopAll();
    setPaused(!paused);
  }

  function stop() {
    routine.current.stop();
    routine.current.actor?.pause(false);
    routine.current.actor?.rest();
    setNow(null);
  }

  const running = now && now.phase !== 'finished';
  const step = now ? steps[now.index] : null;
  const rounds = steps.filter((s) => s.line === 'hold').length;

  return (
    <div className="exercise-screen starfish-screen">
      <header className="build-header">
        <button className="btn" onClick={onExit}>← Back</button>
        <div className="build-title">⭐ Hug &amp; Starfish</div>
        {kid.partner && <span className="coach-chip">With {kid.partner.name}</span>}
      </header>

      <div className="starfish-body">
        <div className="starfish-stage" ref={holder} />

        <div className="starfish-panel">
          {!now && (
            <>
              <p className="starfish-say">Ready?</p>
              <Stepper label="Get in place" unit="s" value={settings.wait} min={1} max={30} onChange={(v) => change('wait', v)} locked={!grownUp} />
              <Stepper label="Hold" unit="s" value={settings.hold} min={1} max={MAX_COUNT} onChange={(v) => change('hold', v)} locked={!grownUp} />
              <Stepper label="Rounds" value={settings.rounds} min={1} max={20} onChange={(v) => change('rounds', v)} locked={!grownUp} />
              <p className="muted small">
                {settings.rounds > 1 ? 'The top arm switches every round, starting with the left.' : 'Left arm on top.'}
                {!grownUp && ' A grown-up can change these.'}
              </p>
              <button className="btn big primary" onClick={start} disabled={!voiceReady || !actorReady}>
                {voiceReady && actorReady ? 'Start' : `Getting ${kid.partner?.name ?? 'ready'}…`}
              </button>
            </>
          )}

          {now && (
            <>
              {step?.round && <p className="starfish-round">Round {step.round} of {rounds} · {step.top} arm on top</p>}
              <p className="starfish-say">{now.phase === 'finished' ? '🎉 All done! Great job!' : step?.text}</p>
              <div className={`starfish-big ${now.phase}`}>
                {now.phase === 'count' && now.count}
                {now.phase === 'wait' && <>⏳ {now.left}</>}
              </div>
              {running ? (
                <div className="row wrap starfish-controls">
                  <button className="btn" onClick={() => jump(now.index - 1)} aria-label="Back a step">⏮</button>
                  <button className="btn primary" onClick={togglePause}>{paused ? '▶ Keep going' : '⏸ Pause'}</button>
                  <button className="btn" onClick={() => jump(now.index + 1)} aria-label="Next step">⏭</button>
                  <button className="btn danger" onClick={stop}>Stop</button>
                </div>
              ) : (
                <div className="row wrap starfish-controls">
                  <button className="btn big primary" onClick={start}>Again</button>
                  <button className="btn big" onClick={stop}>Done</button>
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
