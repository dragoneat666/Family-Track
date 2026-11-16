import { useEffect, useMemo, useRef, useState } from 'react';
import { cutPicture, cellOf } from './jigsaw.js';
import { scenePicture } from './picture.js';

// Putting a background together: its picture cut into jigsaw pieces (one
// unlocked per brush, like a character's). Waiting pieces sit next to the
// frame; drag one close to where it goes and it clicks in. Easy shows the
// picture faintly in the frame; hard hands pieces out turned (tap one to
// turn it). character: as the server sends it; onPlace(pieceId) saves one.
export default function ScenePuzzle({ character, level = 'easy', test, onPlace, onExit, footer }) {
  const svgRef = useRef(null);
  const holderRef = useRef(null);
  const [pic, setPic] = useState(null); // { url, w, h }
  const [error, setError] = useState('');
  const [box, setBox] = useState({ w: 1, h: 1 });
  const [moves, setMoves] = useState({}); // pieceId -> { x, y, rot } (offset from its home)
  const [placedHere, setPlacedHere] = useState({}); // placed on this screen, before the server says so
  const [dragging, setDragging] = useState(null); // { id } while a piece is held
  const drag = useRef(null); // the hold itself (events can come faster than renders)
  const movesRef = useRef({});
  movesRef.current = moves;
  const [said, setSaid] = useState(null);
  const sayTimer = useRef(null);

  useEffect(() => {
    let live = true;
    scenePicture(character).then((p) => live && setPic(p)).catch((e) => live && setError(e.message || 'The picture would not load.'));
    return () => { live = false; clearTimeout(sayTimer.current); };
  }, [character.id, character.version]);

  useEffect(() => {
    const el = holderRef.current;
    if (!el) return undefined;
    const ro = new ResizeObserver(() => setBox({ w: el.clientWidth || 1, h: el.clientHeight || 1 }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const shapes = useMemo(() => (pic ? cutPicture(pic.w, pic.h, character.id) : []), [pic, character.id]);
  const shapeOf = (p) => {
    const { row, col } = cellOf(p.nodeName);
    return shapes.find((s) => s.row === row && s.col === col);
  };
  const isPlaced = (p) => p.placed || placedHere[p.id];
  const waiting = character.pieces.filter((p) => p.unlocked && !isPlaced(p));
  const complete = character.pieces.length > 0 && character.pieces.every(isPlaced);

  // Where the waiting pieces start: beside the frame (to the right on a wide
  // screen, below on a tall one), turned on hard.
  const layout = useMemo(() => {
    if (!pic) return null;
    const cw = pic.w / 3;
    const ch = pic.h / 3;
    const pad = Math.min(cw, ch) * 0.3;
    const cellW = cw + pad * 2;
    const cellH = ch + pad * 2;
    const n = Math.max(1, waiting.length);
    const wide = box.w / box.h > (pic.w / pic.h) * 1.05;
    const per = wide ? Math.max(1, Math.ceil(n / 3)) : Math.min(n, 3); // columns of the tray
    const rows = Math.ceil(n / per);
    const gap = pad;
    const trayX = wide ? pic.w + gap : 0;
    const trayY = wide ? 0 : pic.h + gap;
    const spots = waiting.map((p, i) => ({
      id: p.id,
      x: trayX + (i % per) * cellW + pad,
      y: trayY + Math.floor(i / per) * cellH + pad
    }));
    const vbW = wide ? trayX + per * cellW : Math.max(pic.w, per * cellW);
    const vbH = wide ? Math.max(pic.h, rows * cellH) : trayY + rows * cellH;
    const m = gap / 2;
    return { spots, viewBox: complete ? `${-m} ${-m} ${pic.w + 2 * m} ${pic.h + 2 * m}` : `${-m} ${-m} ${vbW + 2 * m} ${vbH + 2 * m}`, snap: Math.min(cw, ch) * 0.3 };
  }, [pic, box.w, box.h, waiting.map((p) => p.id).join(','), complete]);

  // A waiting piece without a spot yet (just arrived, or the screen turned)
  // goes to its tray spot.
  useEffect(() => {
    if (!layout) return;
    setMoves((was) => {
      const next = {};
      for (const s of layout.spots) {
        const p = character.pieces.find((x) => x.id === s.id);
        const shape = shapeOf(p);
        if (!shape) continue;
        const rot = level === 'hard' ? turnFor(p.id) : 0;
        next[s.id] = was[s.id] && !was[s.id].tray ? was[s.id] : { x: s.x - shape.box.x, y: s.y - shape.box.y, rot, tray: true };
      }
      return next;
    });
  }, [layout]);

  function say(text, good) {
    clearTimeout(sayTimer.current);
    setSaid(text && { text, good });
    if (text) sayTimer.current = setTimeout(() => setSaid(null), 3500);
  }

  const toSvg = (e) => {
    const svg = svgRef.current;
    const pt = svg.createSVGPoint();
    pt.x = e.clientX;
    pt.y = e.clientY;
    return pt.matrixTransform(svg.getScreenCTM().inverse());
  };

  function down(e, p) {
    if (drag.current) return;
    e.preventDefault();
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* fine */ }
    const at = toSvg(e);
    const m = movesRef.current[p.id];
    drag.current = { id: p.id, pointerId: e.pointerId, sx: at.x, sy: at.y, ox: m.x, oy: m.y, moved: false };
    setDragging({ id: p.id });
  }

  // Follows the finger; returns where the piece is now.
  function follow(e) {
    const d = drag.current;
    const at = toSvg(e);
    const dx = at.x - d.sx;
    const dy = at.y - d.sy;
    d.moved = d.moved || Math.hypot(dx, dy) > (pic.w / 3) * 0.04;
    const was = movesRef.current[d.id];
    if (!d.moved) return was;
    const now = { ...was, x: d.ox + dx, y: d.oy + dy, tray: false };
    movesRef.current = { ...movesRef.current, [d.id]: now };
    setMoves(movesRef.current);
    return now;
  }

  function move(e) {
    if (drag.current?.pointerId === e.pointerId) follow(e);
  }

  function up(e) {
    const d = drag.current;
    if (!d || e.pointerId !== d.pointerId) return;
    const m = follow(e);
    const id = d.id;
    drag.current = null;
    setDragging(null);
    if (!d.moved) {
      if (level === 'hard') setMoves((was) => ({ ...was, [id]: { ...was[id], rot: (was[id].rot + 90) % 360 } }));
      return;
    }
    const near = Math.abs(m.x) < layout.snap && Math.abs(m.y) < layout.snap;
    if (!near) return;
    if (m.rot % 360 !== 0) {
      say('Right spot! Tap the piece to turn it.', false);
      return;
    }
    setPlacedHere((was) => ({ ...was, [id]: true }));
    setMoves((was) => {
      const next = { ...was };
      delete next[id];
      return next;
    });
    say(waiting.length > 1 ? '🎉 It fits!' : null, true);
    onPlace?.(id);
  }

  const clip = (id) => `scene-${character.id}-${id}`;
  const easy = level === 'easy';

  let hint = said?.text || '';
  if (!hint && pic) {
    if (complete) hint = `🎉 You finished ${character.name}!`;
    else if (!waiting.length) hint = 'Brush your teeth to unlock the next piece!';
    else if (level === 'hard') hint = 'Drag a piece into the picture. Tap it to turn it!';
    else hint = waiting.length > 1 ? 'Drag the pieces into the picture!' : 'Drag the piece into the picture!';
  }

  const placedPieces = character.pieces.filter(isPlaced);
  const floating = waiting.filter((p) => moves[p.id]).sort((a, b) => (a.id === dragging?.id) - (b.id === dragging?.id));

  return (
    <div className="build-screen scene-puzzle">
      <header className="build-header">
        <button data-back className="btn" onClick={onExit}>← Back</button>
        <div className="build-title">
          {character.name}
          <span className="small"> · {placedPieces.length} / {character.pieces.length}</span>
          {test && <span className="test-pill">Test</span>}
        </div>
      </header>
      <div className="build-stage scene-stage" ref={holderRef}>
        {!pic && !error && <div className="stage-msg"><div className="spinner" />Loading…</div>}
        {error && <div className="stage-msg error">{error}</div>}
        {pic && layout && (
          <svg ref={svgRef} viewBox={layout.viewBox} preserveAspectRatio="xMidYMid meet"
            onPointerMove={move} onPointerUp={up} onPointerCancel={up}>
            <defs>
              {shapes.length > 0 && character.pieces.map((p) => {
                const s = shapeOf(p);
                return s && <clipPath key={p.id} id={clip(p.id)}><path d={s.path} /></clipPath>;
              })}
            </defs>
            <rect className="scene-frame" x={0} y={0} width={pic.w} height={pic.h} />
            {easy && !complete && <image href={pic.url} width={pic.w} height={pic.h} opacity={0.22} />}
            {!complete && character.pieces.map((p) => {
              const s = shapeOf(p);
              return s && !isPlaced(p) && <path key={p.id} d={s.path} className="scene-slot" style={{ opacity: easy ? 1 : 0.35 }} />;
            })}
            {complete
              ? <image href={pic.url} width={pic.w} height={pic.h} />
              : placedPieces.map((p) => <image key={p.id} href={pic.url} width={pic.w} height={pic.h} clipPath={`url(#${clip(p.id)})`} />)}
            {!complete && floating.map((p) => {
              const s = shapeOf(p);
              const m = moves[p.id];
              if (!s || !m) return null;
              const cx = s.box.x + s.box.w / 2;
              const cy = s.box.y + s.box.h / 2;
              return (
                <g key={p.id} className={`scene-piece${dragging?.id === p.id ? ' lifted' : ''}`}
                  transform={`translate(${m.x} ${m.y}) rotate(${m.rot} ${cx} ${cy})`}
                  onPointerDown={(e) => down(e, p)}>
                  <image href={pic.url} width={pic.w} height={pic.h} clipPath={`url(#${clip(p.id)})`} />
                  <path d={s.path} className="scene-edge" />
                </g>
              );
            })}
          </svg>
        )}
      </div>
      <footer className="build-footer">
        <div className={`hint${said ? (said.good ? ' good' : ' oops') : ''}`}>{hint}</div>
        {complete && footer}
      </footer>
    </div>
  );
}

// Hard: how a piece arrives turned (always the same for a piece).
const turnFor = (id) => [90, 180, 270][id % 3];
