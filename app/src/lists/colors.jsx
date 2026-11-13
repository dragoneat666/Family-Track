// The colors a list can have (server/src/lists.js LIST_COLORS has the same
// names). Each is a strong color for the card's edge and a soft one for its
// background, light and dark.
export const LIST_COLORS = [
  ['red', 'Red', '#e5484d'],
  ['orange', 'Orange', '#f76b15'],
  ['yellow', 'Yellow', '#e2a300'],
  ['green', 'Green', '#30a46c'],
  ['teal', 'Teal', '#12a594'],
  ['blue', 'Blue', '#0090ff'],
  ['purple', 'Purple', '#8e4ec6'],
  ['pink', 'Pink', '#d6409f'],
  ['brown', 'Brown', '#a07553'],
  ['gray', 'Gray', '#8b8d98']
];

const BY_NAME = new Map(LIST_COLORS.map(([k, , hex]) => [k, hex]));

// Style for something tinted with a list's color (null: the standard look).
export function listTint(color) {
  const hex = BY_NAME.get(color);
  return hex ? { '--list-color': hex } : undefined;
}

// A row of color dots to pick from (or none).
export function ColorPicker({ value, onChange }) {
  return (
    <div className="color-picker" role="radiogroup" aria-label="Color">
      <button type="button" role="radio" aria-checked={!value} className={`color-dot none${!value ? ' on' : ''}`} onClick={() => onChange(null)} aria-label="No color">∅</button>
      {LIST_COLORS.map(([k, name, hex]) => (
        <button type="button" key={k} role="radio" aria-checked={value === k} className={`color-dot${value === k ? ' on' : ''}`}
          style={{ background: hex }} onClick={() => onChange(k)} aria-label={name} />
      ))}
    </div>
  );
}
