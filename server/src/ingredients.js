// Reading a recipe's ingredient lines ("1 1/2 cups flour, sifted") into an
// amount, a unit, the thing itself and a note, so the app can scale the
// amounts and the grocery list gets "flour", not the whole line.
//
// It only has to be good enough: the line as written is always kept, and an
// ingredient it can't read just isn't scaled.

const FRACTIONS = { '¼': 0.25, '½': 0.5, '¾': 0.75, '⅓': 1 / 3, '⅔': 2 / 3, '⅛': 0.125, '⅜': 0.375, '⅝': 0.625, '⅞': 0.875, '⅕': 0.2, '⅙': 1 / 6 };

// Each unit as it's shown, then the ways it gets written.
const UNITS = [
  ['cup', 'cups', 'c', 'c.', 'cup'],
  ['tbsp', 'tablespoons', 'tablespoon', 'tbsp', 'tbsp.', 'tbs', 'tbl', 'tbls', 'T'],
  ['tsp', 'teaspoons', 'teaspoon', 'tsp', 'tsp.', 't'],
  ['oz', 'ounces', 'ounce', 'oz', 'oz.'],
  ['fl oz', 'fluid ounces', 'fluid ounce', 'fl oz', 'fl. oz.', 'fl.oz.'],
  ['lb', 'pounds', 'pound', 'lbs', 'lb', 'lbs.', 'lb.'],
  ['g', 'grams', 'gram', 'g', 'gr'],
  ['kg', 'kilograms', 'kilogram', 'kg'],
  ['ml', 'milliliters', 'millilitres', 'milliliter', 'millilitre', 'ml', 'mL'],
  ['l', 'liters', 'litres', 'liter', 'litre', 'l', 'L'],
  ['quart', 'quarts', 'quart', 'qt', 'qt.'],
  ['pint', 'pints', 'pint', 'pt', 'pt.'],
  ['gallon', 'gallons', 'gallon', 'gal'],
  ['pinch', 'pinches', 'pinch'],
  ['dash', 'dashes', 'dash'],
  ['clove', 'cloves', 'clove'],
  ['can', 'cans', 'can'],
  ['jar', 'jars', 'jar'],
  ['package', 'packages', 'package', 'pkg', 'pkg.', 'packet', 'packets'],
  ['stick', 'sticks', 'stick'],
  ['slice', 'slices', 'slice'],
  ['bunch', 'bunches', 'bunch'],
  ['head', 'heads', 'head'],
  ['sprig', 'sprigs', 'sprig'],
  ['handful', 'handfuls', 'handful'],
  ['piece', 'pieces', 'piece']
];
const UNIT_OF = new Map();
for (const [shown, ...ways] of UNITS) {
  for (const w of ways) {
    // "T" and "t" are tablespoon and teaspoon; everything else ignores case.
    UNIT_OF.set(w.length === 1 && /[Tt]/.test(w) ? w : w.toLowerCase(), shown);
  }
}
const unitOf = (w) => UNIT_OF.get(w) ?? (w.length > 1 ? UNIT_OF.get(w.toLowerCase()) : undefined);

// A number at the start: 2, 1.5, 1/2, 1 1/2, ½, 1½, 1-½.
const NUM = String.raw`(?:\d+\s*[-\s]\s*\d+\/\d+|\d+\/\d+|\d*(?:[.,]\d+)?\s*[¼½¾⅓⅔⅛⅜⅝⅞⅕⅙]|\d+(?:[.,]\d+)?)`;
const AMOUNT = new RegExp(String.raw`^(${NUM})(?:\s*(?:-|–|to)\s*(${NUM}))?\s*`);

export function number(s) {
  s = s.trim().replace(',', '.');
  let m = s.match(/^(\d+)\s*[-\s]?\s*(\d+)\/(\d+)$/);
  if (m) return Number(m[1]) + Number(m[2]) / Number(m[3]);
  m = s.match(/^(\d+)\/(\d+)$/);
  if (m) return Number(m[2]) ? Number(m[1]) / Number(m[2]) : null;
  m = s.match(/^(\d*(?:\.\d+)?)\s*([¼½¾⅓⅔⅛⅜⅝⅞⅕⅙])$/);
  if (m) return Number(m[1] || 0) + FRACTIONS[m[2]];
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

// A heading among the ingredients or steps: "For the sauce:", "Topping:".
export const isHeading = (line) => /^[^.!?]{1,48}:$/.test(line.trim()) || /^#+\s*\S/.test(line.trim());
export const headingText = (line) => line.trim().replace(/^#+\s*/, '').replace(/:$/, '').trim();

// One ingredient line → { text, qty, qty2, unit, name, note }. qty is null
// when there's no amount to scale ("salt to taste").
export function parseIngredient(line) {
  const text = line.replace(/\s+/g, ' ').trim();
  let rest = text.replace(/^[-•*]\s*/, '');
  let qty = null;
  let qty2 = null;
  let unit = '';
  const m = rest.match(AMOUNT);
  if (m) {
    qty = number(m[1]);
    qty2 = m[2] ? number(m[2]) : null;
    rest = rest.slice(m[0].length);
    // "1 (15 oz) can beans": the size goes in the note.
    let size = '';
    const sized = rest.match(/^(\([^)]*\))\s*/);
    if (sized) {
      size = sized[1];
      rest = rest.slice(sized[0].length);
    }
    const u = rest.match(/^([A-Za-z]+\.?(?:\s?[Oo]z\.?)?)(?=\s|$)\s*/);
    if (u) {
      const word = u[1].replace(/\s+/g, ' ');
      const shown = unitOf(word) ?? unitOf(word.replace(/\.$/, ''));
      if (shown) {
        unit = shown;
        rest = rest.slice(u[0].length).replace(/^of\s+/i, '');
      }
    }
    if (size) rest = `${rest} ${size}`.trim();
  }
  // "flour, sifted" / "butter (softened)": the note isn't part of what to buy.
  let name = rest;
  let note = '';
  const comma = name.search(/,|\s\(/);
  if (comma > 0) {
    note = name.slice(comma).replace(/^,\s*/, '').trim();
    name = name.slice(0, comma).trim();
  }
  if (qty == null) unit = '';
  return { text, qty, qty2, unit, name: name || text, note };
}

// The ingredients written one per line (headings on their own line) →
// [{ section } | ingredient].
export function parseIngredients(lines) {
  const out = [];
  for (const raw of lines) {
    const line = String(raw ?? '').replace(/\s+/g, ' ').trim();
    if (!line) continue;
    if (isHeading(line)) out.push({ section: headingText(line).slice(0, 80) });
    else out.push(parseIngredient(line.slice(0, 200)));
  }
  return out;
}

// "PT1H15M", "1 hour 15 minutes", "75 min", "75" → minutes (or null).
export function minutes(v) {
  if (v == null || v === '') return null;
  if (typeof v === 'number') return Number.isFinite(v) && v > 0 ? Math.round(v) : null;
  const s = String(v).trim();
  let m = s.match(/^P(?:(\d+)D)?T?(?:(\d+(?:\.\d+)?)H)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+(?:\.\d+)?)S)?$/i);
  if (m && (m[1] || m[2] || m[3] || m[4])) {
    const t = Number(m[1] || 0) * 1440 + Number(m[2] || 0) * 60 + Number(m[3] || 0) + Number(m[4] || 0) / 60;
    return t > 0 ? Math.round(t) : null;
  }
  let total = 0;
  let found = false;
  for (const [, n, what] of s.matchAll(/(\d+(?:\.\d+)?)\s*(d|day|days|h|hr|hrs|hour|hours|m|min|mins|minute|minutes)\b/gi)) {
    found = true;
    const w = what.toLowerCase();
    total += Number(n) * (w.startsWith('d') ? 1440 : w.startsWith('h') ? 60 : 1);
  }
  if (found) return total > 0 ? Math.round(total) : null;
  return /^\d+$/.test(s) && Number(s) > 0 ? Number(s) : null;
}
