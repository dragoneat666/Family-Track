import { useEffect, useRef, useState } from 'react';

// A panel that slides up over the screen. Tapping outside it, its Done
// button or the phone's Back button closes it.
export function Sheet({ title, onClose, children, closeLabel = 'Done', wide }) {
  return (
    <div className="sheet-backdrop" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={wide ? 'sheet wide' : 'sheet'} role="dialog" aria-label={title}>
        <div className="sheet-head">
          <h3>{title}</h3>
          <button data-back className={closeLabel === 'Done' ? 'btn primary small' : 'btn small'} onClick={onClose}>{closeLabel}</button>
        </div>
        <div className="sheet-body stack">{children}</div>
      </div>
    </div>
  );
}

// A column of rows that can be dragged into a new order by their ≡ handle.
// ids: current order. onOrder(ids) is called once, when a drag ends.
export function Reorder({ ids, onOrder, children }) {
  const [drag, setDrag] = useState(null); // { id, order } while dragging
  const box = useRef(null);
  const live = useRef(null);
  const order = drag?.order || ids;

  useEffect(() => {
    if (!drag) return undefined;
    const move = (e) => {
      const { id } = live.current;
      // Where among the other rows the finger is now.
      const others = [...box.current.children].filter((el) => el.dataset.id !== id);
      let at = others.findIndex((el) => {
        const r = el.getBoundingClientRect();
        return e.clientY < r.top + r.height / 2;
      });
      if (at < 0) at = others.length;
      const next = live.current.order.filter((x) => x !== id);
      next.splice(at, 0, id);
      if (next.join() !== live.current.order.join()) {
        live.current = { id, order: next };
        setDrag(live.current);
      }
    };
    const end = () => {
      const done = live.current;
      live.current = null;
      setDrag(null);
      if (done && done.order.join() !== ids.join()) onOrder(done.order);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', end);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', end);
      window.removeEventListener('pointercancel', end);
    };
  }, [!!drag]);

  function start(e, id) {
    e.preventDefault();
    live.current = { id, order: ids.slice() };
    setDrag(live.current);
  }

  return (
    <div className="reorder" ref={box}>
      {order.map((id) => (
        <div key={id} data-id={id} className={drag?.id === id ? 'reorder-row dragging' : 'reorder-row'}>
          <button type="button" className="reorder-handle" aria-label="Drag to move" onPointerDown={(e) => start(e, id)}>≡</button>
          {children(id)}
        </div>
      ))}
    </div>
  );
}

// What's going on with the connection, when it's worth saying.
export function SyncNote({ v }) {
  // Changes normally go out in a blink: only mention it when they don't.
  const [slow, setSlow] = useState(false);
  const busy = v.pending > 0;
  useEffect(() => {
    if (!busy) return setSlow(false);
    const t = setTimeout(() => setSlow(true), 3000);
    return () => clearTimeout(t);
  }, [busy]);
  if (v.online && !(busy && slow)) return null;
  const waiting = v.pending ? ` ${v.pending} change${v.pending === 1 ? '' : 's'} will be sent when it's back.` : '';
  return (
    <div className="sync-note">
      {v.online ? `Sending ${v.pending} change${v.pending === 1 ? '' : 's'}…` : `📴 Can't reach the server. Your lists still work here.${waiting}`}
    </div>
  );
}
