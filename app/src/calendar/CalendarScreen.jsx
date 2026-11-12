import { useEffect, useMemo, useRef, useState } from 'react';
import { Sheet } from '../lists/ui.jsx';
import { timeText, whoText } from '../reminders/data.js';
import EventEditor, { newEvent } from './EventEditor.jsx';
import { holidaysBetween } from './holidays.js';
import { refreshContacts } from '../contacts/data.js';
import {
  useCalendar, refreshCalendar, fetchDays, deleteEvent, changeDate,
  todayDay, addDays, fromDay, daysBetween, monthStart, addMonths, dayTitle, shortDay, whenText,
  repeatText, remindText, eventColor, eventTitle, ageOn, itemKey, showsFor, MONTHS, BIRTHDAY_COLOR
} from './data.js';

const SHOW_KEY = 'ft.calendar.show';
const COLLAPSE_KEY = 'ft.calendar.collapsed';
const LETTERS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
const HOLIDAY_COLOR = '#2ec27e';
const ALWAYS_DAYS = 7; // the agenda shows every one of these days, even with nothing on
const AGENDA_DAYS = 60; // and then the days with something on, this far at a time

const readJson = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } };
const writeJson = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* fine */ } };

// Today's date, kept right when the app is left open past midnight.
function useToday() {
  const [today, setToday] = useState(todayDay);
  useEffect(() => {
    const check = () => setToday(todayDay());
    const tick = setInterval(check, 60 * 1000);
    document.addEventListener('visibilitychange', check);
    return () => {
      clearInterval(tick);
      document.removeEventListener('visibilitychange', check);
    };
  }, []);
  return today;
}

// The family calendar, full screen: a month at the top (it folds up to one
// week), and below it what's on, day by day, from the day picked.
// open: { event, occ } when a notification about one was tapped.
export default function CalendarScreen({ account, onExit, onAuthLost, open }) {
  const { data, offline } = useCalendar();
  const today = useToday();
  const [focus, setFocus] = useState(open?.occ || today);
  const [month, setMonth] = useState(monthStart(open?.occ || today));
  const [collapsed, setCollapsed] = useState(() => readJson(COLLAPSE_KEY, false));
  const [show, setShow] = useState(() => ({ hide: [], holidays: true, ...readJson(SHOW_KEY, {}) }));
  const [sheet, setSheet] = useState(open?.event ? { view: { event: open.event, occ: open.occ } } : null);
  const [extra, setExtra] = useState(null); // days further back than what's kept on the device
  const [agendaDays, setAgendaDays] = useState(AGENDA_DAYS);
  const agendaRef = useRef(null);

  useEffect(() => {
    const refresh = () => refreshCalendar().catch((e) => e.status === 401 && onAuthLost?.());
    refresh();
    const onVisible = () => { if (!document.hidden) refresh(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, []);

  const gridStart = addDays(month, -fromDay(month).getDay());
  // Looking at days before what's kept: fetch them (not kept).
  useEffect(() => {
    if (!data) return;
    const from = gridStart < focus ? gridStart : focus;
    if (from >= data.from || (extra && from >= extra.from && from <= extra.to)) return;
    let gone = false;
    fetchDays(from, addDays(from, 120)).then((x) => !gone && setExtra(x), () => {});
    return () => { gone = true; };
  }, [data?.from, gridStart, focus]);

  const pickDay = (day) => {
    setFocus(day);
    if (monthStart(day) !== month) setMonth(monthStart(day));
    setAgendaDays(AGENDA_DAYS);
    agendaRef.current?.scrollTo?.({ top: 0 });
  };
  const goMonth = (n) => {
    const m = addMonths(month, n);
    pickDay(m === monthStart(today) ? today : m);
  };
  const setCollapse = (v) => { setCollapsed(v); writeJson(COLLAPSE_KEY, v); };
  const setShowing = (v) => { setShow(v); writeJson(SHOW_KEY, v); };

  // Everything known, by event and date, from what's kept and anything fetched.
  const known = useMemo(() => {
    const events = new Map();
    const items = new Map();
    for (const src of [extra, data].filter(Boolean)) {
      for (const e of src.events) events.set(e.id, e);
      for (const it of src.items) items.set(itemKey(it), it);
    }
    return { events, items: [...items.values()] };
  }, [data, extra]);
  const people = data?.people || [];

  // How far the days known about reach from the day picked.
  const coverTo = !data ? focus
    : focus >= data.from ? data.to
      : extra && focus >= extra.from ? (extra.to >= data.from ? data.to : extra.to) : focus;
  const hidden = new Set(show.hide);
  const only = people.filter((p) => !hidden.has(p.id)).map((p) => p.id);

  // What's on each day from..to, in order: all day first, then by time.
  function itemsOn(from, to) {
    const list = known.items.filter((it) => {
      const ev = known.events.get(it.event);
      return ev && it.startDay <= to && it.endDay >= from && (!hidden.size || showsFor(ev, only));
    });
    if (show.holidays) list.push(...holidaysBetween(from, to));
    const byDay = new Map();
    for (const it of list) {
      const first = it.startDay < from ? from : it.startDay;
      const last = it.endDay > to ? to : it.endDay;
      for (let d = first; d <= last; d = addDays(d, 1)) {
        if (!byDay.has(d)) byDay.set(d, []);
        byDay.get(d).push(it);
      }
    }
    const rank = (it, d) => (it.holiday ? 0 : it.allDay || it.startDay < d ? 1 : 2);
    for (const [d, its] of byDay) {
      its.sort((a, b) => rank(a, d) - rank(b, d) || String(a.startTime).localeCompare(String(b.startTime)) || a.title.localeCompare(b.title));
    }
    return byDay;
  }

  const gridEnd = addDays(gridStart, 41);
  const gridItems = useMemo(() => itemsOn(gridStart, gridEnd), [known, gridStart, show]);
  const agendaTo = (() => {
    const end = addDays(focus, agendaDays);
    return end < coverTo ? end : coverTo;
  })();
  const agendaItems = useMemo(() => itemsOn(focus, agendaTo), [known, focus, agendaTo, show]);
  const agenda = [];
  for (let d = focus, n = 0; d <= agendaTo; d = addDays(d, 1), n++) {
    if (n < ALWAYS_DAYS || agendaItems.has(d)) agenda.push(d);
  }

  if (!data) {
    return (
      <div className="cal-screen">
        <header className="cal-header"><button data-back className="btn" onClick={onExit}>← Home</button></header>
        {offline
          ? <p className="sync-note cal-note">Can't reach the server, and the calendar hasn't been loaded on this device yet.</p>
          : <div className="spinner" />}
      </div>
    );
  }

  const viewing = sheet?.view && known.items.find((it) => it.event === sheet.view.event && it.occ === sheet.view.occ);
  const viewingEvent = viewing && known.events.get(viewing.event);
  const y = Number(month.slice(0, 4));
  return (
    <div className="cal-screen">
      <header className="cal-header">
        <button data-back className="btn" onClick={onExit}>← Home</button>
        <button className="cal-month-name" onClick={() => pickDay(today)} title="Back to today">
          {MONTHS[Number(month.slice(5, 7)) - 1]}{y !== Number(today.slice(0, 4)) ? ` ${y}` : ''}
        </button>
        <button className="btn small" onClick={() => goMonth(-1)} aria-label="Month before">‹</button>
        <button className="btn small" onClick={() => goMonth(1)} aria-label="Month after">›</button>
      </header>
      {offline && <p className="sync-note cal-note">📴 Can't reach the server: this is the calendar from last time.</p>}

      <MonthGrid
        month={month} start={gridStart} focus={focus} today={today} items={gridItems} people={people}
        events={known.events} collapsed={collapsed} onPick={pickDay}
      />
      <button className="cal-fold" onClick={() => setCollapse(!collapsed)} aria-label={collapsed ? 'Show the whole month' : 'Show just this week'}>
        <span />
      </button>

      <div className="cal-agenda" ref={agendaRef}>
        {agenda.map((d) => (
          <section key={d} className="cal-day">
            <h3 className={`cal-day-bar${d === today ? ' today' : ''}`}>{dayTitle(d, today)}</h3>
            {agendaItems.get(d)?.map((it) => (
              <AgendaRow
                key={itemKey(it)} it={it} day={d} ev={known.events.get(it.event)} people={people}
                onOpen={() => !it.holiday && setSheet({ view: { event: it.event, occ: it.occ } })}
              />
            )) || <p className="cal-nothing">Nothing planned</p>}
          </section>
        ))}
        {agendaTo < coverTo && (
          <button className="btn cal-more" onClick={() => setAgendaDays(agendaDays + AGENDA_DAYS)}>Show later</button>
        )}
        {agendaTo >= coverTo && !known.items.length && (
          <div className="card stack cal-empty">
            <b>Nothing on the calendar yet.</b>
            <p className="muted">
              Tap <b>+ Add</b> for appointments, practice, school things and birthdays. They can repeat (every week,
              every other week, every month…) and remind grown-ups on their phones beforehand.
            </p>
          </div>
        )}
      </div>

      <nav className="cal-bottom">
        <button className="cal-bottom-btn" onClick={() => pickDay(today)}><span>📅</span>Today</button>
        <button className="cal-bottom-btn add" disabled={offline} onClick={() => setSheet({ edit: newEvent(focus < today ? today : focus) })}>
          <span>＋</span>Add
        </button>
        <button className={`cal-bottom-btn${hidden.size || !show.holidays ? ' on' : ''}`} onClick={() => setSheet({ show: true })}>
          <span>👥</span>{hidden.size ? `${only.length} of ${people.length}` : 'Show'}
        </button>
      </nav>

      {viewing && viewingEvent && (
        <EventSheet
          it={viewing} ev={viewingEvent} people={people} offline={offline} today={today}
          onClose={() => setSheet(null)}
          onEdit={() => setSheet({ edit: viewingEvent })}
          onEditDate={() => setSheet({ edit: viewingEvent, date: viewing })}
        />
      )}
      {sheet?.edit && (
        <EventEditor
          key={sheet.edit.id || 'new'} start={sheet.edit} date={sheet.date} people={people} me={account.id}
          offline={offline} onClose={() => setSheet(null)}
          onSaved={(day) => { setSheet(null); if (day) pickDay(day); }}
        />
      )}
      {sheet?.show && <ShowSheet people={people} show={show} onChange={setShowing} onClose={() => setSheet(null)} />}
    </div>
  );
}

// The month, Sunday first, with a dot under a day for each thing on it.
function MonthGrid({ month, start, focus, today, items, people, events, collapsed, onPick }) {
  let days = Array.from({ length: 42 }, (_, i) => addDays(start, i));
  if (monthStart(days[35]) !== month) days = days.slice(0, 35);
  if (collapsed) {
    const week = Math.max(0, Math.min(days.length / 7 - 1, Math.floor(daysBetween(start, focus) / 7)));
    days = days.slice(week * 7, week * 7 + 7);
  }
  const color = (it) => (it.holiday ? HOLIDAY_COLOR : eventColor(events.get(it.event), people));
  return (
    <div className="cal-grid" role="grid">
      {LETTERS.map((l, i) => <span key={i} className="cal-grid-head">{l}</span>)}
      {days.map((d) => {
        const its = items.get(d) || [];
        const cls = ['cal-cell'];
        if (monthStart(d) !== month) cls.push('other');
        if (d === today) cls.push('today');
        if (d === focus) cls.push('focus');
        return (
          <button key={d} className={cls.join(' ')} onClick={() => onPick(d)} aria-label={dayTitle(d, today)}>
            <span className="cal-num">{Number(d.slice(8))}</span>
            <span className="cal-dots">
              {its.slice(0, 3).map((it) => <i key={itemKey(it)} style={{ background: color(it) }} />)}
              {its.length > 3 && <b>+</b>}
            </span>
          </button>
        );
      })}
    </div>
  );
}

const initials = (name) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('');

// One thing on one day: the time on the left, a coloured card on the right.
function AgendaRow({ it, ev, day, people, onOpen }) {
  let time = 'All Day', small = '';
  if (!it.allDay && !it.holiday) {
    if (day === it.startDay) {
      time = timeText(it.startTime);
      small = it.endDay !== it.startDay ? `→ ${shortDay(it.endDay)}` : it.endTime !== it.startTime ? timeText(it.endTime) : '';
    } else if (day === it.endDay) {
      time = 'Until';
      small = timeText(it.endTime);
    }
  } else if (it.endDay !== it.startDay) {
    small = `Day ${daysBetween(it.startDay, day) + 1} of ${daysBetween(it.startDay, it.endDay) + 1}`;
  }

  let card;
  if (it.holiday) {
    card = (
      <div className="cal-card holiday" style={{ '--c': HOLIDAY_COLOR }}>
        <span className="cal-card-title">{it.emoji} {it.title}</span>
        <span className="cal-card-sub">Holiday</span>
      </div>
    );
  } else if (ev.kind === 'birthday') {
    const who = people.find((p) => p.id === ev.people[0]);
    const age = ageOn(ev, it.startDay);
    card = (
      <button className="cal-card birthday" onClick={onOpen} style={{ '--c': BIRTHDAY_COLOR }}>
        <span className="cal-avatar">{who ? who.emoji : initials(it.title)}</span>
        <span className="cal-card-text">
          <span className="cal-card-title">{it.title}</span>
          <span className="cal-card-sub">Birthday 🎂{age ? ` · turns ${age}` : ''}</span>
        </span>
      </button>
    );
  } else {
    const faces = ev.people.map((id) => people.find((p) => p.id === id)?.emoji).filter(Boolean).join('');
    const sub = [it.place && `📍 ${it.place}`, faces, ev.repeat && '🔁', ev.grownupsOnly && '🔒'].filter(Boolean).join('  ');
    card = (
      <button className="cal-card" onClick={onOpen} style={{ '--c': eventColor(ev, people) }}>
        <span className="cal-card-title">{it.title}</span>
        {sub && <span className="cal-card-sub">{sub}</span>}
      </button>
    );
  }
  return (
    <div className="cal-row">
      <span className="cal-time"><b>{time}</b>{small && <small>{small}</small>}</span>
      {card}
    </div>
  );
}

// What one date of an event is, and what can be done with it.
function EventSheet({ it, ev, people, offline, today, onClose, onEdit, onEditDate }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const repeats = !!ev.repeat && ev.kind !== 'birthday';
  const names = ev.people.map((id) => people.find((p) => p.id === id)).filter(Boolean);
  const adults = people.filter((p) => p.isParent);
  const age = ageOn(ev, it.startDay);

  async function act(fn, question) {
    if (question && !window.confirm(question)) return;
    setBusy(true);
    setError('');
    try {
      await fn();
      onClose();
    } catch (e) {
      setError(e.message);
      setBusy(false);
    }
  }

  return (
    <Sheet title={eventTitle(ev, it)} onClose={onClose}>
      <div className="cal-detail" style={{ '--c': eventColor(ev, people) }}>
        <b>{whenText(it, today)}</b>
        {ev.kind === 'birthday' && <span>🎂 {age ? `Turns ${age}` : 'Every year'}</span>}
        {repeats && <span>🔁 {repeatText(ev.repeat, ev.startDay)}{it.changed ? ' (this date was changed)' : ''}</span>}
        {it.place && <span>📍 {it.place}</span>}
        {ev.kind !== 'birthday' && <span>👥 {names.length ? names.map((p) => `${p.emoji} ${p.name}`).join(', ') : 'Whole family'}</span>}
        {it.note && <span className="cal-detail-note">{it.note}</span>}
        {ev.remind?.length > 0 && (
          <span>⏰ {ev.remind.map((m) => remindText(m, it.allDay)).join(', ')} · to {whoText(ev.remindWho, adults)}</span>
        )}
        {ev.grownupsOnly && <span>🔒 Grown-ups only: the kids don't see it</span>}
        {ev.contactId && <span>📇 From Contacts: changing the name or date here changes the contact too</span>}
      </div>
      {error && <p className="error">{error}</p>}
      {offline && <p className="sync-note">Can't reach the server, so this can't be changed right now.</p>}
      <button className="btn primary" disabled={busy || offline} onClick={onEdit}>{repeats ? 'Change all of them' : 'Change'}</button>
      {repeats && (
        <>
          <button className="btn" disabled={busy || offline} onClick={onEditDate}>Change just {shortDay(it.occ)}</button>
          <button className="btn" disabled={busy || offline} onClick={() => act(() => changeDate(ev.id, it.occ, { skip: true }), `Skip ${eventTitle(ev, it)} on ${shortDay(it.occ)}? The other dates stay.`)}>
            Skip {shortDay(it.occ)}
          </button>
          {it.changed && (
            <button className="btn" disabled={busy || offline} onClick={() => act(() => changeDate(ev.id, it.occ, { reset: true }))}>
              Put {shortDay(it.occ)} back like the others
            </button>
          )}
        </>
      )}
      <button
        className="btn danger" disabled={busy || offline}
        onClick={() => act(
          () => deleteEvent(ev.id).then(() => ev.contactId && refreshContacts().catch(() => {})),
          ev.contactId ? `Take ${ev.title}'s birthday off the calendar? Their contact stays, without a birthday.`
            : repeats ? `Delete every date of "${ev.title}"?` : `Delete "${eventTitle(ev, it)}"?`
        )}
      >
        {repeats ? 'Delete all of them' : 'Delete'}
      </button>
    </Sheet>
  );
}

// Whose things the calendar shows, and holidays.
function ShowSheet({ people, show, onChange, onClose }) {
  const hide = new Set(show.hide);
  const toggle = (id) => onChange({ ...show, hide: hide.has(id) ? show.hide.filter((x) => x !== id) : [...show.hide, id] });
  return (
    <Sheet title="Show on the calendar" onClose={onClose}>
      <div className="stack cal-show">
        {people.map((p) => (
          <label key={p.id} className="inline check">
            <input type="checkbox" checked={!hide.has(p.id)} onChange={() => toggle(p.id)} />
            {p.emoji} {p.name}
          </label>
        ))}
        <span className="muted small">Things for the whole family always show.</span>
        <label className="inline check">
          <input type="checkbox" checked={show.holidays} onChange={(e) => onChange({ ...show, holidays: e.target.checked })} />
          🎉 Holidays
        </label>
        <span className="muted small">Just on this device.</span>
      </div>
    </Sheet>
  );
}
