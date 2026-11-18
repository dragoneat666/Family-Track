import { weekStartOf, addWeeks, onWeek, nextDay, fromDay } from './data.js';

const MAX_EVERY = 12;
const SHORT_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const SHORT_DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const dateWords = (d) => `${SHORT_DAYS[d.getDay()]}, ${SHORT_MONTHS[d.getMonth()]} ${d.getDate()}`;

// Every week, or every 2 weeks or more and which week it starts: for
// reminders and for chores on set days. value: { everyWeeks, weekOf } (the
// Sunday of a week it's on); days: the days picked, for "Next: Mon, Nov 23".
export default function WeeksPicker({ everyWeeks = 1, weekOf = null, days, onChange }) {
  const thisWeek = weekStartOf();
  const n = everyWeeks || 1;
  // Which of the next n weeks is its first: 0 = this week.
  const ahead = Math.max(0, [...Array(n).keys()].find((k) => onWeek(addWeeks(thisWeek, k), n, weekOf)) ?? 0);

  const setEvery = (every) => onChange(every === 1 ? { everyWeeks: 1, weekOf: null } : { everyWeeks: every, weekOf: weekOf || thisWeek });
  const weekWords = (k) => {
    if (k === 0) return 'Starting this week';
    if (k === 1) return 'Starting next week';
    return `Starting the week of ${SHORT_MONTHS[fromDay(addWeeks(thisWeek, k)).getMonth()]} ${fromDay(addWeeks(thisWeek, k)).getDate()}`;
  };
  const next = nextDay(days, n, n > 1 ? addWeeks(thisWeek, ahead) : null);

  return (
    <div className="stack weeks-pick">
      <div className="row wrap">
        <select value={n} onChange={(e) => setEvery(Number(e.target.value))} aria-label="How many weeks">
          {[...Array(MAX_EVERY).keys()].map((i) => i + 1).map((k) => (
            <option key={k} value={k}>{k === 1 ? 'Every week' : k === 2 ? 'Every other week' : `Every ${k} weeks`}</option>
          ))}
        </select>
        {n > 1 && (
          <select value={ahead} onChange={(e) => onChange({ everyWeeks: n, weekOf: addWeeks(thisWeek, Number(e.target.value)) })} aria-label="Which week it starts">
            {[...Array(n).keys()].map((k) => <option key={k} value={k}>{weekWords(k)}</option>)}
          </select>
        )}
      </div>
      {n > 1 && next && <span className="muted small">Next: {dateWords(next)}</span>}
    </div>
  );
}
