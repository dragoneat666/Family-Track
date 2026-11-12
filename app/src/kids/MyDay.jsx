import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { timeText } from '../reminders/data.js';
import { holidaysBetween } from '../calendar/holidays.js';
import { todayDay, addDays, fromDay, daysBetween, WEEKDAYS, MONTHS, ageOn, itemKey } from '../calendar/data.js';
import { Photo } from '../recipes/Photo.jsx';

// What a kid sees of the calendar: My Day on their home screen (today's
// things and their reminders, with Done, and what's for dinner) and My Week
// (the next seven days).
// Their own things, the whole family's, everyone's birthdays and holidays;
// never grown-ups-only ones (the server leaves those out for kids). The
// last answer is kept on the tablet, so it still shows with no server.

const WEEK = 7;
const REFRESH_MS = 5 * 60 * 1000;

const keyFor = (profile) => `ft.myday.${api.serverUrl}|${profile.id}`;
const read = (key) => { try { return JSON.parse(localStorage.getItem(key)); } catch { return null; } };

function useMyDay(profile) {
  const key = keyFor(profile);
  const [data, setData] = useState(() => read(key));
  const [today, setToday] = useState(todayDay);

  async function load() {
    const day = todayDay();
    setToday(day);
    try {
      const [cal, rem] = await Promise.all([
        api.get(`/api/calendar?from=${day}&to=${addDays(day, WEEK - 1)}`, { timeout: 8000 }),
        api.get('/api/reminders/today', { timeout: 8000 })
      ]);
      // (Dinner is extra: no planner on the server yet is fine.)
      const meals = await api.get(`/api/meals?from=${day}&to=${addDays(day, WEEK - 1)}`, { timeout: 8000 }).then((r) => r.meals, () => null);
      const d = { day, events: cal.events, items: cal.items, people: cal.people, reminders: rem.reminders, meals };
      try { localStorage.setItem(key, JSON.stringify(d)); } catch { /* fine */ }
      setData(d);
    } catch { /* no server right now: what's kept */ }
  }

  useEffect(() => {
    load();
    const tick = setInterval(load, REFRESH_MS);
    const onVisible = () => { if (!document.hidden) load(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(tick);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [profile.id]);

  return { data, today, reload: load };
}

// What's on one day for this kid, in order: all day first, then by time.
function dayItems(data, day, profile) {
  const events = new Map((data?.events || []).map((e) => [e.id, e]));
  const list = (data?.items || []).filter((it) => {
    const ev = events.get(it.event);
    return ev && it.startDay <= day && it.endDay >= day
      && (ev.kind === 'birthday' || !ev.people.length || ev.people.includes(profile.id));
  }).map((it) => ({ ...it, ev: events.get(it.event) }));
  list.push(...holidaysBetween(day, day));
  const rank = (it) => (it.holiday ? 0 : it.ev?.kind === 'birthday' ? 1 : it.allDay || it.startDay < day ? 2 : 3);
  return list.sort((a, b) => rank(a) - rank(b) || String(a.startTime).localeCompare(String(b.startTime)) || a.title.localeCompare(b.title));
}

const dayName = (day, today) => {
  const n = daysBetween(today, day);
  return n === 0 ? 'Today' : n === 1 ? 'Tomorrow' : WEEKDAYS[fromDay(day).getDay()];
};
const dateText = (day) => {
  const d = fromDay(day);
  return `${MONTHS[d.getMonth()]} ${d.getDate()}`;
};

function Thing({ it, day }) {
  if (it.holiday) {
    return <li className="myday-thing holiday"><span className="myday-when">{it.emoji}</span><b>{it.title}</b></li>;
  }
  if (it.ev.kind === 'birthday') {
    const age = ageOn(it.ev, it.startDay);
    return (
      <li className="myday-thing birthday">
        <span className="myday-when">🎂</span>
        <b>{it.title}'s birthday{age ? ` (turns ${age})` : ''}</b>
      </li>
    );
  }
  const when = it.allDay || (it.startDay < day && it.endDay > day) ? 'All day'
    : it.startDay < day ? `Until ${timeText(it.endTime)}` : timeText(it.startTime);
  return (
    <li className="myday-thing">
      <span className="myday-when">{when}</span>
      <span className="myday-what"><b>{it.title}</b>{it.place && <small>📍 {it.place}</small>}</span>
    </li>
  );
}

// A reminder for this kid today. Done only when it's time, and only if
// they're one of the people who can say it's done.
function ReminderRow({ r, onDone }) {
  const [busy, setBusy] = useState(false);
  const [, redraw] = useState(0);
  const due = r.at <= Date.now();
  // Show Done when its time comes.
  useEffect(() => {
    if (due || !r.canDone) return undefined;
    const t = setTimeout(() => redraw((n) => n + 1), Math.min(r.at - Date.now() + 500, 2 ** 31 - 1));
    return () => clearTimeout(t);
  }, [due, r.at, r.canDone]);
  async function done(e) {
    e.stopPropagation();
    setBusy(true);
    try {
      await api.post('/api/reminders/done', { id: r.id, occ: r.occ });
      await onDone();
    } catch { /* try again */ }
    setBusy(false);
  }
  return (
    <li className={`myday-thing reminder${r.done ? ' done' : due ? ' late' : ''}`}>
      <span className="myday-when">{r.time}</span>
      <span className="myday-what"><b>⏰ {r.title}</b>{r.note && <small>{r.note}</small>}</span>
      {r.done && <span className="myday-tick">✓</span>}
      {!r.done && due && r.canDone && <button className="btn primary myday-done" disabled={busy} onClick={done}>Done</button>}
    </li>
  );
}

// What's for dinner that day ("Not picked yet" when nothing's planned).
function Dinner({ data, day }) {
  if (!data?.meals) return null;
  const dinner = data.meals.filter((m) => m.day === day && m.slot === 'dinner');
  return (
    <div className={`myday-dinner${dinner.length ? '' : ' none'}`}>
      {dinner.find((m) => m.thumb) ? <Photo src={dinner.find((m) => m.thumb).thumb} className="myday-dinner-photo" /> : <span className="myday-dinner-icon">🍽️</span>}
      <span><small>Dinner</small><b>{dinner.length ? dinner.map((m) => m.title).join(' + ') : 'Not picked yet'}</b></span>
    </div>
  );
}

// Things and reminders in one list, by time (all-day things first).
function Rows({ things, reminders, day, reload, empty }) {
  const at = (it) => (it.holiday || it.ev?.kind === 'birthday' || it.allDay || it.startDay < day ? '' : it.startTime);
  const rows = [
    ...things.map((it) => ({ t: at(it), el: <Thing key={itemKey(it)} it={it} day={day} /> })),
    ...reminders.map((r) => ({ t: r.occ.slice(11), el: <ReminderRow key={`r${r.id}-${r.occ}`} r={r} onDone={reload} /> }))
  ].sort((a, b) => a.t.localeCompare(b.t));
  return (
    <ul className="myday-list">
      {rows.map((r) => r.el)}
      {!rows.length && <li className="myday-empty">{empty}</li>}
    </ul>
  );
}

// The card on a kid's home screen. Tapping it opens My Week.
export function MyDayCard({ profile, onWeek }) {
  const { data, today, reload } = useMyDay(profile);
  const things = dayItems(data, today, profile);
  const reminders = data?.day === today ? data.reminders : [];
  const tomorrow = dayItems(data, addDays(today, 1), profile).filter((it) => !it.holiday);
  return (
    <section className="myday-card" onClick={onWeek} role="button" tabIndex={0}>
      <header className="myday-head">
        <span className="myday-title">📅 My Day</span>
        <span className="myday-date">{WEEKDAYS[fromDay(today).getDay()]}, {dateText(today)}</span>
      </header>
      {!data && <p className="myday-empty">Getting your day…</p>}
      {data && (
        <Rows things={things} reminders={reminders} day={today} reload={reload} empty="Nothing planned today" />
      )}
      <Dinner data={data} day={today} />
      {tomorrow.length > 0 && (
        <p className="myday-next">Tomorrow: {tomorrow.slice(0, 2).map((it) => (it.ev?.kind === 'birthday' ? `🎂 ${it.title}` : it.title)).join(', ')}{tomorrow.length > 2 ? '…' : ''}</p>
      )}
      <span className="myday-more">My week →</span>
    </section>
  );
}

// The next seven days, today first.
export function MyWeek({ profile, onExit }) {
  const { data, today, reload } = useMyDay(profile);
  const days = Array.from({ length: WEEK }, (_, i) => addDays(today, i));
  return (
    <div className="kid-page myweek" style={{ '--c': profile.color }}>
      <header className="kid-page-header">
        <button data-back className="btn" onClick={onExit}>← Back</button>
        <h1>📅 My Week</h1>
      </header>
      {!data && <div className="spinner" />}
      {data && (
        <div className="myweek-days">
          {days.map((d) => {
            const things = dayItems(data, d, profile);
            const reminders = d === today && data.day === today ? data.reminders : [];
            const weekday = fromDay(d).getDay();
            const cls = ['myweek-day'];
            if (d === today) cls.push('today');
            if (weekday === 0 || weekday === 6) cls.push('weekend');
            return (
              <section key={d} className={cls.join(' ')}>
                <h2><span>{dayName(d, today)}</span><small>{dayName(d, today) === WEEKDAYS[weekday] ? dateText(d) : `${WEEKDAYS[weekday]}, ${dateText(d)}`}</small></h2>
                <Rows things={things} reminders={reminders} day={d} reload={reload} empty="Nothing planned" />
                <Dinner data={data} day={d} />
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
