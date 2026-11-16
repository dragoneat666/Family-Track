// Reading a recipe out of a video's caption (TikTok, or one pasted from
// Instagram / Facebook): free text, written any old way. It finds the name,
// the ingredients and the steps as best it can; the recipe then opens in
// the editor to be checked before it's saved, so it only has to be close.

import { AMOUNT_START } from './ingredients.js';

const ING_HEAD = /^(?:ingredients?|what you(?:'|’)?ll need|what you need|you(?:'|’)?ll need|you will need|shopping list)\b\s*[:：-]?\s*(.*)$/i;
const STEP_HEAD = /^(?:instructions?|directions?|method|steps?|how to make(?: it)?|how to|how(?=\s*[:：])|preparation)\b\s*[:：-]?\s*(.*)$/i;
const NUMBERED = /^(?:step\s*)?(\d{1,2})\s*[.):-]\s*(.+)$/i;
const SERVES = /\b(?:serves|servings?:?|makes)\s*(\d{1,3})\b|\b(\d{1,3})\s*servings\b/i;
// "~450 cal | 37g protein": about the recipe, not an ingredient.
const NUTRITION = /\b\d+\s*(?:k?cals?|calories)\b|\b\d+\s*g\s*(?:of\s+)?(?:protein|carbs?|fat|fiber|sugar)\b/i;
// A bulleted line (in the caption as written).
const BULLET = /^\s*[•·*▪◦‣●○■□✓✔➤►\-–—]/;
const URL_RE = /\bhttps?:\/\/[^\s<>"')]+/gi;
// A line that's only "follow for more" and the like.
const CHATTER = /^(?:follow|like|save|share|comment|subscribe|tag)\b.*(?:more|recipes?|friend|later|this)\b|^link in (?:my )?bio\b|^full recipe\b/i;

// Leading bullets, emoji and dashes: everything before the first letter,
// number or fraction (and a quote or bracket).
const leading = /^[^\p{L}\p{N}"'(“‘[]+/u;
const emoji = /[\p{Extended_Pictographic}\u{1F1E6}-\u{1F1FF}\u{FE0F}\u{200D}\u{20E3}]/gu;

const tidy = (line) => line.replace(leading, '').replace(/\s+/g, ' ').trim();
const plain = (line) => tidy(line.replace(emoji, ' ')).replace(/[\s:：,-]+$/, '');

// Split one long paragraph at its headings ("… Ingredients: 2 cups …").
function unrun(text) {
  return text
    .replace(/\s+(?=(?:ingredients?|instructions?|directions?|method|steps?)\s*[:：])/gi, '\n')
    .replace(/\s+(?=(?:step\s*)?\d{1,2}[.)]\s+\p{L})/giu, '\n');
}

// A short line after a run of ingredients that ends in ":" ("Sauce:",
// "For the topping:") is a heading inside the ingredients.
const subHeading = (line) => line.length <= 40 && (/[:：]$/.test(line) || /^for the\b/i.test(line)) && !AMOUNT_START.test(line);

const looksLikeIngredient = (line) => line.length <= 120 && AMOUNT_START.test(line);

export function captionRecipe(raw, { site = '' } = {}) {
  const links = [...new Set(String(raw || '').match(URL_RE) || [])];
  let text = String(raw || '').replace(URL_RE, ' ').replace(/\r/g, '');
  const tags = [];
  text = text.replace(/(^|\s)#([\p{L}\p{N}_]+)/gu, () => ' '); // hashtags go
  text = text.replace(/(^|\s)@[\w.]+/g, ' '); // and so do @mentions
  // "½" read off a screen often comes out as "%" ("%c broth").
  text = text.replace(/(^|[\s•·;,(+])%(?=\s?\p{L})/gmu, '$1½');
  if (!text.includes('\n')) text = unrun(text);

  const lines = text.split('\n').map((l) => l.trim());
  const out = { title: '', description: [], ingredients: [], steps: [], notes: [], servings: null };
  let mode = 'intro'; // intro | ingredients | steps | after
  let sawHeadings = false;
  let last = ''; // what the line before was: 'ingredient', 'intro', …

  for (const rawLine of lines) {
    const line = tidy(rawLine);
    if (!line) {
      continue;
    }
    if (CHATTER.test(plain(line))) continue;
    if (NUTRITION.test(line) && line.length <= 80) {
      out.description.push(line);
      continue;
    }
    const serves = SERVES.exec(line);
    if (serves && !out.servings) out.servings = Number(serves[1] || serves[2]);
    if (serves && plain(line).length <= serves[0].length + 12) continue; // just "Serves 4"

    const ing = ING_HEAD.exec(plain(line));
    if (ing) {
      // A short line just before "Ingredients" is usually the name.
      if (mode === 'intro' && last === 'intro') {
        const before = out.description.length ? out.description.pop() : out.title;
        if (before && before.length <= 60 && !/[.!?]$/.test(before)) {
          if (out.description.length || before !== out.title) out.description.unshift(out.title);
          out.title = plain(before);
        } else if (before && before !== out.title) out.description.push(before);
      }
      mode = 'ingredients';
      sawHeadings = true;
      if (ing[1]) out.ingredients.push(...splitInline(ing[1]));
      continue;
    }
    const step = STEP_HEAD.exec(plain(line));
    if (step && (step[1] || plain(line).length < 30)) {
      mode = 'steps';
      sawHeadings = true;
      if (step[1]) out.steps.push(...splitSteps(step[1]));
      continue;
    }

    const numbered = NUMBERED.exec(line);
    if (mode === 'ingredients') {
      if (numbered && !looksLikeIngredient(numbered[2]) && out.ingredients.length) {
        mode = 'steps';
        out.steps.push(numbered[2].trim());
      } else if (subHeading(plain(line))) {
        out.ingredients.push(`${plain(line).replace(/^for the\s+/i, '').replace(/[:：]$/, '')}:`.replace(/^./, (c) => c.toUpperCase()));
      } else {
        out.ingredients.push(...splitInline(line));
      }
      continue;
    }
    if (mode === 'steps') {
      out.steps.push(numbered ? numbered[2].trim() : line);
      continue;
    }

    // No heading yet: guess from the line itself.
    if (looksLikeIngredient(line) && !numbered) {
      out.ingredients.push(...splitInline(line));
      if (mode === 'intro') mode = 'loose';
      last = 'ingredient';
      continue;
    }
    if (mode === 'loose' && last === 'ingredient' && (BULLET.test(rawLine) || (line.length <= 50 && !/[.!?]$/.test(line) && /,|\+|\band\b/.test(line)))) {
      // "• Smoked paprika, garlic powder + pepper": more of the list.
      out.ingredients.push(line);
      continue;
    }
    if (numbered && !(mode === 'intro' && !out.title && isNamey(numbered[2]))) {
      out.steps.push(numbered[2].trim());
      last = 'step';
    } else if (!out.title && mode === 'intro') {
      out.title = plain(numbered ? numbered[2] : line);
      last = 'intro';
    } else if (mode === 'intro') {
      out.description.push(line);
      last = 'intro';
    } else {
      // Text after loose ingredients: a step if it reads like one.
      (out.ingredients.length && /^[\p{Lu}]/u.test(line) && line.length > 25 ? out.steps : out.notes).push(line);
      last = 'other';
    }
  }

  // A name: the first line, cut down if it's a whole sentence or more.
  let title = out.title || plain(out.description.shift() || '');
  // "A RECIPE A DAY - DAY 21: Mini Hash Brown Quiches" → the bit after the colon.
  const parts = title.split(/[:：]\s+/);
  const afterColon = parts.pop();
  const words = afterColon.split(/\s+/).length;
  if (parts.length && words >= 2 && words <= 8 && /^\p{Lu}/u.test(afterColon) && (/\d/.test(parts.join(' ')) || parts.join(' ').split(/\s+/).length >= 3)) title = afterColon;
  title = title.replace(/^(?:[a-z]{1,2}\s+)?\d{1,2}[.)]\s+(?=\p{Lu})/u, ''); // "3. MAPLE…" (and an emoji read as letters)
  if (/\p{Lu}{3}/u.test(title) && !/\p{Ll}/u.test(title)) title = titleCase(title);
  if (title.length > 70) title = (title.match(/^(.{10,70}?)[.!?|•]/u)?.[1] || title.slice(0, 60).replace(/\s+\S*$/, '')).trim();
  title = title.replace(/[\s.!?,:-]+$/, '');
  if (!title || ING_HEAD.test(title)) title = site ? `Recipe from ${site}` : 'New recipe';

  return {
    title: title.slice(0, 120),
    description: out.description.join('\n').slice(0, 1000),
    servings: out.servings,
    ingredients: out.ingredients.map((l) => l.replace(/[,;]$/, '').replace(/^(\d+)(?=[a-z]{3,})/i, '$1 ')).filter(Boolean),
    steps: out.steps.filter(Boolean),
    notes: out.notes.join('\n'),
    tags,
    links,
    found: out.ingredients.length > 0 || out.steps.length > 0,
    headings: sawHeadings
  };
}

// A numbered line that's a name, not a step: "3. MAPLE BBQ PORK".
const isNamey = (text) => text.length <= 60 && !/[.!?]$/.test(text) && !/\p{Ll}/u.test(text);

// "MAPLE BBQ PORK & CHEESY POTATOES" → "Maple BBQ Pork & Cheesy Potatoes"
// (a word with no vowels stays as it is).
const SMALL = new Set(['and', 'or', 'of', 'the', 'with', 'in', 'on', 'a', 'an', 'to', 'for']);
function titleCase(text) {
  return text.toLowerCase().split(/(\s+)/).map((w, i) => {
    if (!/\p{L}/u.test(w)) return w;
    if (!/[aeiouy]/.test(w)) return w.toUpperCase();
    if (i > 0 && SMALL.has(w)) return w;
    return w.replace(/\p{L}/u, (c) => c.toUpperCase());
  }).join('');
}

// "2 cups flour, 1 tsp salt, 3 eggs" on one line → three. A comma inside
// an ingredient ("1 onion, diced") stays when what follows has no amount.
function splitInline(line) {
  const parts = line.split(/\s*[,;•|]\s*/);
  if (parts.length < 2) return [line];
  const out = [];
  for (const p of parts) {
    if (!p) continue;
    if (out.length && !AMOUNT_START.test(p) && !/^(?:salt|pepper|oil|water)\b/i.test(p)) out[out.length - 1] += `, ${p}`;
    else out.push(p);
  }
  return out;
}

// One long "Method: Mix it. Bake for 20 minutes. Let it cool." → sentences.
function splitSteps(text) {
  return text.length > 160 ? text.split(/(?<=[.!])\s+(?=\p{Lu})/u).map((s) => s.trim()).filter(Boolean) : [text];
}

