// A partner's voice library: lines with the words they say (voice:
// [{ key, text, version, seconds }]). Counting uses the lines n1…n30. A line
// with nothing recorded is spoken by the device's own voice (where there is
// one) or is a tick.

const NUMBERS = [
  'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten',
  'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen', 'Twenty',
  'Twenty-one', 'Twenty-two', 'Twenty-three', 'Twenty-four', 'Twenty-five',
  'Twenty-six', 'Twenty-seven', 'Twenty-eight', 'Twenty-nine', 'Thirty'
];
export const MAX_COUNT = NUMBERS.length;
export const numberLine = (n) => `n${n}`;
export const isNumberLine = (key) => /^n([1-9]|[12]\d|30)$/.test(key);

// Every counting line, recorded or not.
export const numberLines = (voice = []) => NUMBERS.map((text, i) => {
  const key = numberLine(i + 1);
  return voice.find((l) => l.key === key) ?? { key, text, version: null, seconds: null };
});

// The lines that aren't counting, in library order.
export const wordLines = (voice = []) => voice.filter((l) => !isNumberLine(l.key));

export function lineWords(voice, key) {
  const l = voice?.find((x) => x.key === key);
  if (l?.text) return l.text;
  return isNumberLine(key) ? NUMBERS[Number(key.slice(1)) - 1] : '';
}

// Voice effects the app adds while playing a partner's lines.
export const EFFECTS = [
  { key: 'none', name: 'Just my voice' },
  { key: 'robot', name: 'Robot leader (deep and metallic)' },
  { key: 'radio', name: 'Radio (crackly walkie-talkie)' },
  { key: 'deep', name: 'Giant (deep and slow)' },
  { key: 'high', name: 'Sparkly (higher, with a shimmer)' },
  { key: 'echo', name: 'Echo (big cave)' }
];
