// Money is kept in cents.

// 150 -> "$1.50", -500 -> "−$5.00"
export const money = (cents) => `${cents < 0 ? '−' : ''}$${(Math.abs(cents) / 100).toFixed(2)}`;

// What a grown-up typed ("1", "$2.50", "0.75") -> cents, or null if it isn't an amount.
export function parseMoney(text) {
  const t = String(text ?? '').replace(/[$,\s]/g, '');
  if (!/^\d*(\.\d{0,2})?$/.test(t) || !/\d/.test(t)) return null;
  const c = Math.round(Number(t) * 100);
  return c > 0 ? c : null;
}

export const dollarsText = (cents) => (cents % 100 ? (cents / 100).toFixed(2) : String(cents / 100));

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const fromDay = (day) => { const [y, m, d] = day.split('-').map(Number); return new Date(y, m - 1, d); };

// "2026-11-17" -> "Tue"
export const weekdayOf = (day) => DAYS[fromDay(day).getDay()];
// "2026-11-17" -> "Nov 17"
export const dateText = (day) => { const d = fromDay(day); return `${MONTHS[d.getMonth()]} ${d.getDate()}`; };
// The week starting on Sunday `day`: "Nov 16 – 22" (or "Nov 30 – Dec 6").
export function weekText(day) {
  const a = fromDay(day);
  const b = new Date(a);
  b.setDate(a.getDate() + 6);
  return a.getMonth() === b.getMonth()
    ? `${MONTHS[a.getMonth()]} ${a.getDate()} – ${b.getDate()}`
    : `${MONTHS[a.getMonth()]} ${a.getDate()} – ${MONTHS[b.getMonth()]} ${b.getDate()}`;
}
// A server time ("2026-11-17 14:05:00", UTC) -> "Nov 17".
export function whenText(at) {
  const d = new Date(`${String(at).replace(' ', 'T')}Z`);
  return Number.isNaN(d.getTime()) ? '' : `${MONTHS[d.getMonth()]} ${d.getDate()}`;
}
