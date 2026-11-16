import { useEffect, useMemo, useState } from 'react';
import { cutPicture, cellOf } from './jigsaw.js';
import { scenePicture } from './picture.js';

// A background as a small picture: the pieces put in so far, the rest as
// empty shapes (all of it when it's finished, or when showAll).
export default function SceneThumb({ character, showAll, className = '' }) {
  const [pic, setPic] = useState(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let live = true;
    scenePicture(character).then((p) => live && setPic(p)).catch(() => live && setFailed(true));
    return () => { live = false; };
  }, [character.id, character.version]);
  const shapes = useMemo(() => (pic ? cutPicture(pic.w, pic.h, character.id) : []), [pic, character.id]);

  if (failed) return <span className={`char-emoji ${className}`}>🖼️</span>;
  if (!pic) return <div className="spinner" />;
  const all = showAll || character.complete || (character.pieces || []).every((p) => p.placed);
  const placed = (character.pieces || []).filter((p) => p.placed);
  const id = (p) => `thumb-${character.id}-${p.id}`;
  return (
    <svg className={`scene-thumb ${className}`} viewBox={`0 0 ${pic.w} ${pic.h}`} preserveAspectRatio="xMidYMid meet">
      {all ? <image href={pic.url} width={pic.w} height={pic.h} /> : (
        <>
          <defs>
            {placed.map((p) => {
              const { row, col } = cellOf(p.nodeName);
              const s = shapes.find((x) => x.row === row && x.col === col);
              return s && <clipPath key={p.id} id={id(p)}><path d={s.path} /></clipPath>;
            })}
          </defs>
          <rect className="scene-frame" width={pic.w} height={pic.h} />
          {shapes.map((s) => <path key={`${s.row},${s.col}`} d={s.path} className="scene-slot" />)}
          {placed.map((p) => <image key={p.id} href={pic.url} width={pic.w} height={pic.h} clipPath={`url(#${id(p)})`} />)}
        </>
      )}
    </svg>
  );
}
