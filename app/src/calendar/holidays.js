// US holidays, worked out for any year, shown on the calendar as all-day
// cards (they can be hidden under Show). Nothing is stored for them.

const pad = (n) => String(n).padStart(2, '0');
const day = (y, m, d) => `${y}-${pad(m + 1)}-${pad(d)}`;

// The nth weekday (0 = Sunday) of a month, or the last one (n = -1).
function nth(y, m, weekday, n) {
  if (n < 0) {
    const last = new Date(y, m + 1, 0).getDate();
    return last - ((new Date(y, m, last).getDay() - weekday + 7) % 7);
  }
  return 1 + ((weekday - new Date(y, m, 1).getDay() + 7) % 7) + (n - 1) * 7;
}

// Easter Sunday (the Gregorian "computus").
function easter(y) {
  const a = y % 19, b = Math.floor(y / 100), c = y % 100;
  const d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31) - 1;
  return [month, ((h + l - 7 * m + 114) % 31) + 1];
}

function holidaysOf(y) {
  const [em, ed] = easter(y);
  return [
    [day(y, 0, 1), "New Year's Day", '🎆'],
    [day(y, 0, nth(y, 0, 1, 3)), 'Martin Luther King Jr. Day', '🕊️'],
    [day(y, 1, 14), "Valentine's Day", '💘'],
    [day(y, 1, nth(y, 1, 1, 3)), "Presidents' Day", '🇺🇸'],
    [day(y, 2, 17), "St. Patrick's Day", '☘️'],
    [day(y, em, ed), 'Easter', '🐣'],
    [day(y, 4, nth(y, 4, 0, 2)), "Mother's Day", '💐'],
    [day(y, 4, nth(y, 4, 1, -1)), 'Memorial Day', '🇺🇸'],
    [day(y, 5, nth(y, 5, 0, 3)), "Father's Day", '👔'],
    [day(y, 5, 19), 'Juneteenth', '✊'],
    [day(y, 6, 4), 'Independence Day', '🎇'],
    [day(y, 8, nth(y, 8, 1, 1)), 'Labor Day', '🛠️'],
    [day(y, 9, nth(y, 9, 1, 2)), 'Columbus Day', '🇺🇸'],
    [day(y, 9, 31), 'Halloween', '🎃'],
    [day(y, 10, 11), 'Veterans Day', '🎖️'],
    [day(y, 10, nth(y, 10, 4, 4)), 'Thanksgiving', '🦃'],
    [day(y, 11, 24), 'Christmas Eve', '🎄'],
    [day(y, 11, 25), 'Christmas', '🎄'],
    [day(y, 11, 31), "New Year's Eve", '🥂']
  ];
}

// The holidays from..to (days, inclusive), as calendar items.
export function holidaysBetween(from, to) {
  const out = [];
  for (let y = Number(from.slice(0, 4)); y <= Number(to.slice(0, 4)); y++) {
    for (const [d, title, emoji] of holidaysOf(y)) {
      if (d >= from && d <= to) out.push({ holiday: true, event: `h-${title}`, occ: d, title, emoji, allDay: true, startDay: d, endDay: d });
    }
  }
  return out;
}
