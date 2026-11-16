// Tidying text read off the screen (screen.js) before it's made into a
// recipe: the apps' own bits that get read too (counts, times, buttons), and
// for screenshots, what's around the caption.

// The apps' own bits: counts, times, buttons.
const NOISE = /^(?:[\d.,]+\s*[kKmM]?|\d{1,2}:\d{2}(?::\d{2})?|\d+\s*[smhdw]|\d{1,3}\s*%|reply|replies|see translation|translate with ai|more|less|follow|following|like|likes|share|send|save|saved|comment|comments|remix|sponsored|suggested for you|search|home|reels|friends|inbox|profile|for you|explore|live|add comment.*|add a comment.*|liked by .*|view all .* comments|view replies.*|original audio.*|.*· original audio|see more|\.\.\.\s*more|…\s*more)$/i;

// The row of counts under a video (likes, comments, shares: "257K Q950
// 3,473 132K"; the icons get read as a letter now and then).
const COUNT = /^[^\p{L}\p{N}]*[QOCcoa@©]?[\d.,]+[KkMm]?[^\p{L}\p{N}]*$/u;
const isCounts = (line) => {
  const words = line.trim().split(/\s+/);
  return words.length >= 2 && words.every((w) => COUNT.test(w)) && /\d/.test(line);
};

// The date under a caption ("September 27", "2 days ago"): the caption ends
// there, and what's after it is the next video.
const MONTH = '(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\\.?';
const DATE = new RegExp(`^(?:${MONTH}\\s+\\d{1,2}(?:,?\\s+\\d{4})?|\\d{1,2}\\s+${MONTH}(?:,?\\s+\\d{4})?|\\d+\\s*(?:s|m|h|d|w|mins?|minutes?|hours?|days?|weeks?)\\s+ago|yesterday|today|\\d{4}-\\d{1,2}-\\d{1,2}|\\d{1,2}/\\d{1,2}(?:/\\d{2,4})?)$`, 'i');

// One screenshot's text: keep only the caption, if it can tell where it is.
function onePicture(text) {
  let lines = text.split('\n').map((l) => l.trim());
  const firstText = lines.findIndex((l) => l && !NOISE.test(l));
  const date = lines.findIndex((l, i) => i > firstText && DATE.test(l));
  if (date > 0) lines = lines.slice(0, date);
  const counts = lines.findIndex(isCounts);
  let caption = false;
  if (counts >= 0 && counts < lines.length - 1) {
    lines = lines.slice(counts + 1);
    caption = true;
  }
  lines = lines.filter((l) => !l || (!NOISE.test(l) && !isCounts(l)));
  // A caption starts with the account's name: "somecook This is…".
  if (caption) {
    const i = lines.findIndex(Boolean);
    if (i >= 0) lines[i] = lines[i].replace(/^[a-z0-9._]{3,30}\s+(?=[\p{Lu}\p{N}"“])/u, '');
  }
  // "… #easyrecipes less" at the end of an opened caption.
  for (let i = lines.length - 1; i >= 0; i--) {
    if (!lines[i]) continue;
    lines[i] = lines[i].replace(/\s+(?:less|see less)$/i, '');
    break;
  }
  return lines.join('\n');
}

// shots: from screenshots (where the app's layout around the caption is
// known); otherwise read as a video played.
export function cleanScreenText(text, { shots = false } = {}) {
  const pictures = String(text || '').split('\f');
  const out = (shots ? pictures.map(onePicture) : pictures.map((p) => p.split('\n').map((l) => l.trim()).filter((l) => !l || !NOISE.test(l)).join('\n')))
    .join('\n\n');
  return out.replace(/\n{3,}/g, '\n\n').trim();
}
