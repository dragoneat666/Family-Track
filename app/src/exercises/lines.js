// Everything an exercise partner can say, in the order a grown-up records it. Exercises
// refer to lines by key; a line nobody recorded falls back to the device's
// own voice (where there is one) or a tick.

const NUMBERS = [
  'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten',
  'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen', 'Twenty',
  'Twenty-one', 'Twenty-two', 'Twenty-three', 'Twenty-four', 'Twenty-five',
  'Twenty-six', 'Twenty-seven', 'Twenty-eight', 'Twenty-nine', 'Thirty'
];
export const MAX_COUNT = NUMBERS.length;
export const numberLine = (n) => `n${n}`;

export const LINE_GROUPS = [
  {
    title: '⭐ Hug & Starfish',
    lines: [
      { key: 'starfish_start', text: 'Lie down like a starfish.' },
      { key: 'chest_right', text: 'Right arm on your chest.' },
      { key: 'chest_left', text: 'Left arm on your chest.' },
      { key: 'top_right', text: 'Right arm on top.' },
      { key: 'top_left', text: 'Left arm on top.' },
      { key: 'leg_right', text: 'Cross your right leg over.' },
      { key: 'leg_left', text: 'Cross your left leg over.' },
      { key: 'sit_up', text: 'Sit up and tuck your head.' },
      { key: 'hold', text: 'Hold it!' },
      { key: 'lie_back', text: 'Lie back down. Starfish!' },
      { key: 'other_side', text: 'Other side!' },
      { key: 'done', text: 'All done! Great job!' }
    ]
  },
  {
    title: '🔢 Counting',
    lines: NUMBERS.map((text, i) => ({ key: numberLine(i + 1), text }))
  }
];

export const ALL_LINES = LINE_GROUPS.flatMap((g) => g.lines);
export const lineText = (key) => ALL_LINES.find((l) => l.key === key)?.text ?? key;

// Voice effects the app adds while playing a partner's lines.
export const EFFECTS = [
  { key: 'none', name: 'Just my voice' },
  { key: 'robot', name: 'Robot leader (deep and metallic)' },
  { key: 'radio', name: 'Radio (crackly walkie-talkie)' },
  { key: 'deep', name: 'Giant (deep and slow)' },
  { key: 'high', name: 'Sparkly (higher, with a shimmer)' },
  { key: 'echo', name: 'Echo (big cave)' }
];
