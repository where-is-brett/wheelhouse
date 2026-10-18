// scripts/briefing/text.js
// The arrival briefing in words, in design section 5.2's order: anything not in effect until the
// director confirms it first, then what waits on them (numbered), what changed for users,
// progress, what to watch, and usage last. When nothing waits, one line says so. Parts with
// nothing in them are left out. Every entry is one plain line (oneLine), with no Markdown links.
//
// A briefing longer than its words is cut entry by entry from the end of its parts, the part
// showing the most entries first (on a tie, the later part), each cut part ending "and N more".
// Words are counted as the text split on white space. A usage line longer than the limit on its
// own is left out, and with a limit too small for even the cut parts, usage goes, then whole parts
// from the last, so no briefing passes its words.
import { oneLine } from '../board/model.js';
import { BRIEFING_WORDS } from '../lib/core-numbers.js';

const NOTHING = 'Nothing needs you.';
const NOTHING_ELSE = 'Nothing else needs you.';
const TO_BOARD = 'Ask for the board.';
const UNWORDED = 'The briefing couldn\'t be put into words this time.';

const isRecord = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const entries = (value) => (Array.isArray(value) ? value.map((v) => oneLine(v)).filter(Boolean) : []);
const wordsIn = (text) => text.split(/\s+/).filter(Boolean).length;

// A part as it is cut so far: its heading, its first `shown` entries, then "and N more".
function partLines(part) {
  const shown = part.items.slice(0, part.shown).map((item, i) => (part.numbered ? `${i + 1}. ${item}` : `- ${item}`));
  const more = part.items.length - part.shown;
  return [part.heading, ...shown, ...(more > 0 ? [`and ${more} more`] : [])];
}
// A part with no entries isn't shown, so it has no words.
const partWords = (part) => (part.items.length === 0 ? 0 : partLines(part).reduce((sum, line) => sum + wordsIn(line), 0));

// briefingParts(briefing, { words }) -> { text, shownWatch }: the briefing as text, within `words`
// (the standard length when `words` isn't a positive whole number), and how many of `watch`'s
// entries the text shows. Unusual use comes first in `watch`, so the caller marks as raised only
// `raise.slice(0, shownWatch)`, the items the director was really told.
export function briefingParts(briefing, options) {
  try {
    const words = isRecord(options) ? options.words : undefined;
    return write(isRecord(briefing) ? briefing : {}, Number.isInteger(words) && words > 0 ? words : BRIEFING_WORDS.standard);
  } catch {
    return { text: UNWORDED, shownWatch: 0 };
  }
}

// briefingText(briefing, { words }) -> the text alone.
export function briefingText(briefing, options) {
  return briefingParts(briefing, options).text;
}

function write(b, limit) {
  const first = entries(b.first);
  const waiting = entries(b.waiting);
  const parts = [
    { heading: 'Not in effect until you confirm:', items: first },
    { heading: 'Waiting on you:', items: waiting, numbered: true },
    { heading: 'Changed for users:', items: entries(b.changed) },
    { heading: 'Progress:', items: entries(b.progress) },
    { heading: 'To watch:', items: entries(b.watch) },
  ].map((part) => ({ ...part, shown: part.items.length, hidden: false }));
  const watch = parts.at(-1);
  // Nothing waiting is one line in the waiting part's place.
  let nothing = waiting.length === 0 ? (first.length > 0 ? NOTHING_ELSE : NOTHING) : '';
  // A usage line longer than the whole briefing may be is left out.
  let usage = typeof b.usage === 'string' ? oneLine(b.usage) : '';
  if (wordsIn(usage) > limit) usage = '';

  const counted = parts.map(partWords);
  let total = wordsIn(nothing) + wordsIn(usage) + counted.reduce((sum, n) => sum + n, 0);
  while (total > limit) {
    let pick = -1;
    for (let i = 0; i < parts.length; i += 1) {
      if (parts[i].shown > 0 && (pick === -1 || parts[i].shown >= parts[pick].shown)) pick = i;
    }
    if (pick === -1) break;
    parts[pick].shown -= 1;
    const now = partWords(parts[pick]);
    total += now - counted[pick];
    counted[pick] = now;
  }
  // Only a very small limit is still passed with every entry cut: then usage goes, then whole
  // parts from the last, then the nothing-waiting line.
  if (total > limit) {
    total -= wordsIn(usage);
    usage = '';
  }
  for (let i = parts.length - 1; i >= 0 && total > limit; i -= 1) {
    if (parts[i].items.length === 0) continue;
    parts[i].hidden = true;
    total -= counted[i];
  }
  if (total > limit) nothing = '';

  const blocks = parts.filter((part) => part.items.length > 0 && !part.hidden).map((part) => ({ at: parts.indexOf(part), text: partLines(part).join('\n') }));
  if (nothing) blocks.push({ at: 1, text: nothing });
  blocks.sort((a, c) => a.at - c.at);
  const text = blocks.map((block) => block.text);
  if (usage) text.push(usage);
  return {
    // With every part gone, the board still has what was cut.
    text: text.length > 0 ? text.join('\n\n') : (parts.some((part) => part.hidden) ? TO_BOARD : NOTHING).split(' ').slice(0, limit).join(' '),
    shownWatch: watch.hidden ? 0 : watch.shown,
  };
}
