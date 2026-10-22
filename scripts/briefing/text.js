// scripts/briefing/text.js
// The arrival briefing in words (design section 23.5): the verdict first, the same sentence as the
// pane's, then when the last briefing was ("Since 09:10, about 5 hours"); then, in section 5.2's
// order, anything not in effect until the director confirms it, what waits on them (numbered, each
// with its one line and its recommendation, an optional one marked with its time), what changed
// for users, progress and what to watch, each label in sentence case and "+2" on the ones with
// something new since the last briefing. A part with nothing in it has no label: the empty ones
// are folded into one italic line. The foot is usage, "Ask me anything." and the full board.
// Every entry is plain lines (oneLine), with no Markdown links.
//
// A briefing longer than its words is cut entry by entry from the end of its parts, the part
// showing the most entries first (on a tie, the later part), each cut part ending "and N more".
// Words are counted as the text split on white space. The folded line of empty parts goes before
// any entry is cut. A usage line longer than the limit on its own is left out, and with a limit too
// small for even the cut parts, usage goes, then the closing lines, then whole parts from the last,
// then when the last briefing was, then the verdict, so no briefing passes its words.
import { oneLine } from '../board/model.js';
import { BRIEFING_WORDS } from '../lib/core-numbers.js';
import {
  verdict as verdictOf, optionalMark, recommends, foldedParts, ASK_ME_ANYTHING, FULL_BOARD, USAGE_ON_TRACK, ASK_FOR_THE_BOARD,
} from '../lib/calm-words.js';

const UNWORDED = 'The briefing couldn\'t be put into words this time.';
// A line break that stays a line break in Markdown.
const BREAK = '  \n';

const isRecord = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const entries = (value) => (Array.isArray(value) ? value.map((v) => oneLine(v)).filter(Boolean) : []);
const wordsIn = (text) => text.split(/\s+/).filter(Boolean).length;

// A waiting entry: a card's title (with its optional mark), its one line and its recommendation,
// or the words alone for an entry that is only words. At `detail` 1 the line is left out, at 2 the
// recommendation too, so a card can stay in a short briefing with only its title.
function waitingText(value, detail = 0) {
  if (!isRecord(value)) return oneLine(value);
  const title = oneLine(value.title);
  if (title === '') return '';
  const minutes = Number.isInteger(value.optional) && value.optional > 0 ? ` · ${optionalMark(value.optional)}` : '';
  const recommendation = oneLine(value.recommendation);
  return [`${title}${minutes}`, detail < 1 ? oneLine(value.line) : '', recommendation === '' || detail > 1 ? '' : recommends(recommendation)].filter(Boolean).join(BREAK);
}

// A part as it is cut so far: its heading, its first `shown` entries, then "and N more". An entry
// of several lines has its later lines under its first.
function partLines(part) {
  const shown = part.items.slice(0, part.shown).map((item, i) => {
    const lead = part.numbered ? `${i + 1}. ` : '- ';
    return `${lead}${item.replace(/\n/g, `\n${' '.repeat(lead.length)}`)}`;
  });
  const more = part.items.length - part.shown;
  return [part.heading, ...shown, ...(more > 0 ? [`and ${more} more`] : [])];
}
// A part with no entries isn't shown, so it has no words.
const partWords = (part) => (part.items.length === 0 ? 0 : partLines(part).reduce((sum, line) => sum + wordsIn(line), 0));

// briefingParts(briefing, { words }) -> { text, shownWatch }: the briefing as text, within `words`
// (the standard length when `words` isn't a positive whole number), and how many of `watch`'s
// entries the text shows. The weekly lines, then unusual use, come first in `watch`, so the caller
// marks as raised only the unusual items within `shownWatch`, the items the director was really told.
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

// A part's label, with "+2" when that many of its entries are new since the last briefing.
const labelled = (label, plus) => `${label}${Number.isInteger(plus) && plus > 0 ? ` (+${plus})` : ''}:`;

function write(b, limit) {
  const first = entries(b.first);
  const given = Array.isArray(b.waiting) ? b.waiting : [];
  const waitingAt = (detail) => given.map((value) => waitingText(value, detail)).filter(Boolean);
  const waiting = waitingAt(0);
  const plus = isRecord(b.plus) ? b.plus : {};
  const parts = [
    { heading: labelled('Not in effect until you confirm'), items: first },
    { heading: labelled('Waiting on you', plus.waiting), items: waiting, numbered: true },
    { heading: labelled('Changed for users', plus.changed), items: entries(b.changed) },
    { heading: labelled('Progress'), items: entries(b.progress) },
    { heading: labelled('To watch'), items: entries(b.watch) },
  ].map((part) => ({ ...part, shown: part.items.length, hidden: false }));
  const watch = parts.at(-1);
  // The verdict opens the briefing; without one of its own it is worked out from what waits.
  let verdict = oneLine(b.verdict) || verdictOf({ waiting: waiting.length, broken: 0 });
  let since = oneLine(b.since);
  // The parts with nothing in them (the first part, rare, is left out silently) fold into one line.
  let folded = foldedParts([
    ...(parts[2].items.length === 0 ? ['briefingChanged'] : []),
    ...(parts[3].items.length === 0 ? ['briefingProgress'] : []),
    ...(parts[4].items.length === 0 ? ['briefingWatch'] : []),
  ]);
  // A usage line longer than the whole briefing may be is left out.
  let usage = typeof b.usage === 'string' ? oneLine(b.usage) : '';
  if (usage !== '' && b.onTrack === true) usage = `${usage} ${USAGE_ON_TRACK}`;
  if (wordsIn(usage) > limit) usage = '';
  let ask = `${ASK_ME_ANYTHING} ${FULL_BOARD}`;

  const waitingPart = parts[1];
  let detail = 0;
  const counted = parts.map(partWords);
  const fixed = () => wordsIn(verdict) + wordsIn(since) + wordsIn(folded) + wordsIn(usage) + wordsIn(ask);
  let total = fixed() + counted.reduce((sum, n) => sum + n, 0);
  // The folded line is the first to go, then entries are cut.
  if (total > limit) {
    total -= wordsIn(folded);
    folded = '';
  }
  // The other parts are cut first. The waiting cards are the last thing cut: each sheds its line,
  // then its recommendation, before any card is cut whole.
  while (total > limit) {
    let pick = -1;
    for (let i = 0; i < parts.length; i += 1) {
      if (i !== 1 && parts[i].shown > 0 && (pick === -1 || parts[i].shown >= parts[pick].shown)) pick = i;
    }
    if (pick === -1) {
      if (detail < 2 && waitingPart.items.length > 0) {
        detail += 1;
        waitingPart.items = waitingAt(detail);
        const now = partWords(waitingPart);
        total += now - counted[1];
        counted[1] = now;
        continue;
      }
      if (waitingPart.shown === 0) break;
      pick = 1;
    }
    parts[pick].shown -= 1;
    const now = partWords(parts[pick]);
    total += now - counted[pick];
    counted[pick] = now;
  }
  // Only a very small limit is still passed with every entry cut: then usage goes, then the
  // closing lines, then whole parts from the last, then when the last briefing was, then the verdict.
  if (total > limit) {
    total -= wordsIn(usage);
    usage = '';
  }
  if (total > limit) {
    total -= wordsIn(ask);
    ask = '';
  }
  for (const i of [4, 3, 2, 0, 1]) {
    if (total <= limit || parts[i].items.length === 0) continue;
    parts[i].hidden = true;
    total -= counted[i];
  }
  if (total > limit) {
    total -= wordsIn(since);
    since = '';
  }
  if (total > limit) {
    total -= wordsIn(verdict);
    verdict = '';
  }

  const text = [verdict, since, ...parts.filter((part) => part.items.length > 0 && !part.hidden).map((part) => partLines(part).join('\n')), folded, usage, ask].filter(Boolean);
  return {
    // With every part gone, the board still has what was cut.
    text: text.length > 0 ? text.join('\n\n') : ASK_FOR_THE_BOARD.split(' ').slice(0, limit).join(' '),
    shownWatch: watch.hidden ? 0 : watch.shown,
  };
}
