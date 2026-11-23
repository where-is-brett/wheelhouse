// scripts/decisions/message.js
// A decision as the plain chat message the First Mate prints (design section 6.2). It reads the same in any client, in
// the terminal, in the digest and quoted in an alert. The text is built from the decision alone, so `decision show <n>`
// and the Stop check (scripts/hooks/card-check.js, checkShown) both produce the very same words.
//
// Decision needed (<n>): <the question, one line>   (holds up: <what waits on it>)
// <why now: one or two lines>
//
// A. <option>. <what it says>. <what it costs>. <whether it can be undone>
// B. <option> (recommended). ...
// Recommended because: <two or three lines, in product terms>
//
// Meanwhile: <what the agent does while it waits>
// (public project only) This project is public. Add "private" after your letter ("<n> B private") to ...
// Reply <n> A, <n> B, "why <n>", or "<n>: your own words".
//
// On an agent whose hooks only read, nothing in its chat records a typed reply, so the director answers in Wheelhouse's own
// window: the decision is printed without the private line, and its last line is windowReplyLine's instead.
//
// The cost and the undo line are printed when the option has them; step 3 of the director's way of working makes them
// required.

export const LEAD = 'Decision needed';
export const RECOMMENDED = '(recommended)';

// The letters the options go by, in order: A to D.
export const LETTERS = Object.freeze(['A', 'B', 'C', 'D']);

const flat = (x) => (typeof x === 'string' ? x.replace(/\s+/g, ' ').trim() : '');
// A piece of a sentence without its closing full stop, so the pieces can be joined with ". ".
const bare = (x) => flat(x).replace(/[.!?]+$/, '');

// The line for one option: "A. Use weekly (recommended). It sends one email a week. Costs two days. Can be undone."
export function optionLine(option, index, recommend) {
  const label = bare(option.label);
  const head = `${LETTERS[index]}. ${label}${option.label === recommend ? ` ${RECOMMENDED}` : ''}`;
  const pieces = [option.says, option.cost, option.undo].map(bare).filter((piece) => piece !== '' && piece !== label);
  return `${[head, ...pieces].join('. ')}.`;
}

// The reply line: every letter with the decision's number, why, and the director's own words.
export function replyLine(n, count) {
  const letters = LETTERS.slice(0, count).map((letter) => `${n} ${letter}`).join(', ');
  return `Reply ${letters}, "why ${n}", or "${n}: your own words".`;
}

// The reply line where the director answers in Wheelhouse's own window, which the First Mate opens with `decision confirm <n>`.
export function windowReplyLine(n) {
  return `Reply in Wheelhouse's own window, which opens for decision ${n}: click the option you choose there. To hear more first, close the window and say "why ${n}" here.`;
}

// The line that offers "private", on a public project's decision only (design section 6.6): the answer is then kept in the
// private record and no file goes into the project. It sits just above the Reply line.
export function privateLine(n) {
  return `This project is public. Add "private" after your letter ("${n} B private") to keep this answer out of the project's files.`;
}

// decisionText({ n, question, work, why, options, recommend, because, meanwhile, canPrivate }, { window }) -> the message.
// `canPrivate` is true for a decision on a public project (or one whose visibility isn't known), which adds the private line.
// `window` is true where the director answers in Wheelhouse's own window, which takes no "private" and no words of their own.
export function decisionText(decision, { window = false } = {}) {
  const options = Array.isArray(decision.options) ? decision.options.slice(0, LETTERS.length) : [];
  const holdsUp = flat(decision.holds) !== '' ? flat(decision.holds) : flat(decision.work) === '' ? 'nothing else' : flat(decision.work);
  return [
    `${LEAD} (${decision.n}): ${flat(decision.question)}   (holds up: ${holdsUp})`,
    flat(decision.why),
    '',
    ...options.map((option, i) => optionLine(option, i, decision.recommend)),
    `Recommended because: ${bare(decision.because)}.`,
    '',
    `Meanwhile: ${flat(decision.meanwhile)}`,
    ...(decision.canPrivate === true && !window ? [privateLine(decision.n)] : []),
    window ? windowReplyLine(decision.n) : replyLine(decision.n, options.length),
  ].join('\n');
}

// Every "Decision needed" block in a message, each as the text from its first line to its Reply line. A block that
// never reaches a Reply line runs to the end of the message.
// A line is read past the Markdown that may wrap it (quote marks, a heading, a bullet or number, bold, a code fence), so a block
// dressed up that way is still found, and still has to equal the printed text to pass.
const MARKS = /^\s*(?:(?:>\s?)+|#{1,6}\s+|[-*+]\s+|\d+[.)]\s+|\*\*|__|`{1,3}|~{3})*\s*/;
const plain = (line) => line.replace(MARKS, '');

export function blocksIn(text) {
  const lines = String(text ?? '').split(/\r\n|[\n\r]/);
  const blocks = [];
  for (let i = 0; i < lines.length; i += 1) {
    if (!new RegExp(`^${LEAD}\\b`).test(plain(lines[i]))) continue;
    let end = i;
    while (end < lines.length && !/^Reply\b/.test(plain(lines[end]))) end += 1;
    blocks.push(lines.slice(i, Math.min(end + 1, lines.length)).join('\n'));
    i = end;
  }
  return blocks;
}
