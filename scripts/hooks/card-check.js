// scripts/hooks/card-check.js
// Refuses a question card in the wrong form before the director sees it (design section 23.4). A
// card's plain lines (the question, what it is, why it is the director's, what happens meanwhile)
// are followed by the line that says more is there for the asking, "To know more, just ask." (for
// a question with four options of its own, the line that says a change is typed). A card with a set
// line has that one line, its own reply code line (none for a kind the composer gives no code, such
// as setup's, a trust card's or uninstall's) and nothing after it, and plain lines that between them name what the set
// line names (for a trust card, the computer it trusts; for uninstall's, the project) and no other
// pull request or commit. Given the question object, its options are checked too: two to four, one
// recommended, and none Explain more. The prompt record is what refuses a wrong click, so this
// only informs: it refuses nothing it can't read, and a failure of its own lets the card through.
// A card that doesn't come from scripts/cards/compose.js can fail it; one that does cannot.
// In any folder, a card that reads as the baseline card (any of its fixed words however written, or
// its header with the private note's figures) is refused unless it is the very card the helper
// composed and recorded as shown, word for word: a reworded copy would carry the figures without
// the words that keep them out of the state, and an ordinary card using the baseline card's words
// would have its answer dropped. In a project's folder, or one being set up, any other card holding
// the figures waiting for the click is refused too, saying to leave them out; elsewhere no record of
// an answer is written, so that is let be. A card merely headed Baseline is not refused.
import tools from '../../adapters/claude-code/tools.js';
import { runAndExit, answer, projectOf, beingSetUp } from './kit.js';
import { looksLikeBaseline, holdsFigures, cardHash, readShown, cardText, sweepStale } from '../lib/measures-clicks.js';
import { whatProblem, NO_REPLY_CODE } from '../cards/compose.js';
import { TO_KNOW_MORE, TO_CHANGE_IT } from '../lib/calm-words.js';
import { CARD } from '../lib/front-desk.js';
import {
  setLinesOf, replyCode, replyCodeLine, runbookLine, LIFT_STOP, RUNBOOK_TITLES, SETUP_TITLES, ID, LANES, TRUST_LINE, UNINSTALL_LINE, KEEP_CONTROL_LINE, USAGE_LINE, PREMIUM_LINE,
} from '../state/card-lines.js';
import { startedAsScript } from '../lib/started-as-script.js';

const SHA12 = '([0-9a-f]{12})';
// The plain lines a card needs before its last: the question, why it is the director's and what happens meanwhile. A
// question that is the same words as `what` (an answer, setup's kinds) carries them once, so a card with a question of its own has one more.
const LEAD_LINES = 3;
const EXPLAIN_MORE = 'Explain more';
const RECOMMENDED = 'Recommended:';
const REPLY_CODE = 'Reply code:';

// The kind a set line is, and the target the composer would have made it from, so the card
// check and the composer judge a first part by one function. The commit stays the twelve
// characters the line holds.
function targetOf(line) {
  let m;
  if (line === LIFT_STOP) return { kind: 'lift-stop', target: {} };
  if ((m = new RegExp(`^Approve pull request #([1-9][0-9]*) at commit ${SHA12}$`).exec(line))) return { kind: 'approval', target: { pr: Number(m[1]), sha: m[2] } };
  if ((m = /^Confirm [a-z-]+ \S+: "(.*)"$/.exec(line))) return { kind: 'confirm', target: { event: { data: { words: m[1] } } } };
  if ((m = new RegExp(`^Push the CI change on (\\S+) at commit ${SHA12} with your own sign-in$`).exec(line))) return { kind: 'ci-push', target: { branch: m[1], sha: m[2] } };
  for (const step of Object.keys(RUNBOOK_TITLES).map(Number)) {
    if (!line.startsWith(runbookLine(step))) continue;
    return { kind: 'runbook', target: { step, sha: new RegExp(`, to commit ${SHA12}$`).exec(line)?.[1] } };
  }
  if ((m = new RegExp(`^Approve (${ID}) \\((?:${LANES}) lane\\) as written, ${SHA12}`).exec(line))) return { kind: 'approve-work', target: { work: m[1], hash: m[2] } };
  if (/^Answer question /.test(line)) return { kind: 'answer', target: {} };
  if ((m = new RegExp(`^Change the approved (${ID}) to this, ${SHA12}$`).exec(line))) return { kind: 'amend', target: { work: m[1], hash: m[2] } };
  if ((m = new RegExp(`^End incident (${ID}) and let merges carry on$`).exec(line))) return { kind: 'lift-incident', target: { incident: m[1] } };
  if ((m = new RegExp(`^Merge pull request #([1-9][0-9]*) as the fix for incident (${ID})$`).exec(line))) return { kind: 'incident-fix', target: { incident: m[2], pr: Number(m[1]) } };
  if ((m = new RegExp(`^Set up step ([0-9]{1,2}) as listed, ${SHA12}$`).exec(line)) && Object.hasOwn(SETUP_TITLES, m[1])) return { kind: 'setup', target: { step: Number(m[1]), hash: m[2] } };
  if ((m = new RegExp(`^Confirm all ([1-9][0-9]*) rules? as listed, ${SHA12}$`).exec(line))) return { kind: 'confirm-all', target: { count: Number(m[1]), hash: m[2] } };
  if ((m = TRUST_LINE.exec(line))) return { kind: 'trust', target: { computer: m[1], fingerprint: m[3] } };
  if ((m = UNINSTALL_LINE.exec(line))) return { kind: 'uninstall', target: { project: m[1], hash: m[2] } };
  if ((m = KEEP_CONTROL_LINE.exec(line))) return { kind: 'keep-control-files', target: { work: m[1], hash: m[2] } };
  if ((m = USAGE_LINE.exec(line))) return { kind: 'usage', target: { to: m[1], at: m[2] } };
  if ((m = PREMIUM_LINE.exec(line))) return { kind: 'premium', target: { at: m[1] } };
  return null;
}

// What is wrong with one question's form, each as a clause that follows "the card"; an empty
// list when it is right. `question` is the question's text, or the question object as
// AskUserQuestion takes it ({ question, header, options }), whose options are then checked too.
// The hook refuses on any, and the mod's side pane shows the same.
export function cardProblems(question) {
  const object = question !== null && typeof question === 'object' ? question : null;
  const text = typeof question === 'string' ? question : typeof object?.question === 'string' ? object.question : '';
  const lines = text === '' ? [] : text.split(new RegExp('\\r\\n|[\\n\\r\\v\\f\\u0085\\u2028\\u2029]'));
  const problems = [];

  const set = setLinesOf(text);
  const line = set.length === 1 ? set[0] : null;
  // The plain lines run to the set line, or the reply code line where there is none.
  const end = lines.findIndex((l) => set.includes(l) || l.startsWith(REPLY_CODE));
  const region = end < 0 ? lines : lines.slice(0, end);
  const plain = region.filter((l) => l.trim() !== '');
  const last = plain.at(-1);
  if (region.length > plain.length) problems.push('has an empty line, and every line before its set line holds words');
  if (last !== TO_KNOW_MORE && last !== TO_CHANGE_IT) problems.push(`lacks its "${TO_KNOW_MORE}" line`);
  else if (plain.length - 1 < LEAD_LINES) problems.push(`has ${plain.length - 1} plain ${plain.length - 1 === 1 ? 'line' : 'lines'} before "${last}", and needs at least ${LEAD_LINES}: its question, why it is yours and what happens meanwhile`);

  if (object !== null && Array.isArray(object.options)) {
    const labels = object.options.map((o) => (typeof o === 'string' ? o : o?.label));
    const recommended = object.options.filter((o) => typeof o?.description === 'string' && o.description.startsWith(RECOMMENDED)).length;
    if (recommended === 0) problems.push('names no recommended option');
    else if (recommended > 1) problems.push(recommended === 2 ? 'names two recommended options' : `names ${recommended} recommended options`);
    if (labels.includes(EXPLAIN_MORE)) problems.push(`offers ${EXPLAIN_MORE}, which is not one of a card's options`);
    // AskUserQuestion shows a question with two to four options only; any other count never reaches the director.
    if (labels.length < CARD.fewestOptions || labels.length > CARD.options) problems.push(`offers ${labels.length} ${labels.length === 1 ? 'option' : 'options'}, and a card offers ${CARD.fewestOptions} to ${CARD.options}`);
  }

  if (set.length === 0) return problems;
  if (set.length > 1) return [...problems, `carries ${set.length} set lines, and a card carries one set line`];
  const found = targetOf(line);
  const expected = replyCodeLine(replyCode(line));
  const codes = lines.filter((l) => l.startsWith(REPLY_CODE));
  if (found !== null && NO_REPLY_CODE.includes(found.kind)) {
    if (codes.length > 0) problems.push(`carries a reply code line, and ${/^[aeiou]/.test(found.kind) ? 'an' : 'a'} ${found.kind} card has none: only a click on the card counts`);
  } else if (codes.length === 0) problems.push(`carries a set line without its reply code line, "${expected}"`);
  else if (codes.some((c) => c !== expected)) problems.push(`carries the wrong reply code line for its set line: it should be "${expected}"`);
  else if (codes.length > 1) problems.push('carries its reply code line more than once');

  // Nothing but its reply code line may follow the set line: a line there would be read by the prompt record beside it.
  const after = lines.slice(lines.indexOf(line) + 1, lines.at(-1) === '' ? -1 : undefined);
  if (after.some((l) => !l.startsWith(REPLY_CODE))) problems.push('has a line after its set line other than its reply code line');

  // Every plain line together must name what the set line names, and no other pull request or commit.
  const why = found === null ? null : whatProblem(found.kind, plain.join(' ').trim(), found.target, { abbreviated: true });
  if (why !== null) problems.push(`has words that ${why}`);
  return problems;
}

const REFUSAL_END = 'Ask each question again exactly as `cli.js card` or `cli.js cards` returns it; do not write or change a card by hand.';

const BASELINE_REFUSAL = 'reads as the baseline card but is not the card the helper composed: ask it exactly as `cli.js baseline` gave it, or give the figures again for a new card';
const FIGURES_REFUSAL = 'holds the figures from the director\'s private note, which only the card `cli.js baseline` gives may show: leave them out';

// What is wrong with the questions as to the baseline: each that reads as the baseline card, or
// holds the figures waiting for the click anywhere it shows them (its question, header, options'
// labels and descriptions), and isn't the card the helper recorded as shown, still in date at `now`.
// With `figures` false (a folder whose answers are recorded nowhere), only the first counts.
function baselineFaults(questions, now, { figures = true } = {}) {
  sweepStale(now);
  const shown = readShown({ now });
  return questions.flatMap((q, i) => {
    if (typeof q?.question !== 'string') return [];
    const text = cardText(q);
    const card = looksLikeBaseline(text, q.header, { now });
    if (!card && !(figures && holdsFigures(text, { now }))) return [];
    if (shown !== null && cardHash(q) === shown.card) return [];
    return [`Question ${i + 1} ${card ? BASELINE_REFUSAL : FIGURES_REFUSAL}.`];
  });
}

export async function decide(input, { projectOf: find = projectOf, dir, now = () => new Date() } = {}) {
  if (input.tool_name !== tools.ask) return undefined;
  const questions = input.tool_input?.questions;
  if (!Array.isArray(questions)) return undefined;
  const inProject = Boolean(find(input.cwd, { dir }));
  const recorded = inProject || beingSetUp(input.cwd) !== null;
  const baseline = baselineFaults(questions, now, { figures: recorded });
  if (baseline.length > 0) return answer.deny(`The director has not seen this card. ${baseline.join(' ')}`);
  if (!inProject) return undefined;
  const faults = questions.flatMap((q, i) => {
    if (typeof q?.question !== 'string') return [];
    const name = typeof q.header === 'string' && q.header !== '' ? `Question ${i + 1} ("${q.header}")` : `Question ${i + 1}`;
    return cardProblems(q).map((problem) => `${name} ${problem}.`);
  });
  if (faults.length === 0) return undefined;
  return answer.deny(`The director has not seen this card, which is not in the form their cards take. ${faults.join(' ')} ${REFUSAL_END}`);
}

if (startedAsScript(import.meta.url)) {
  await runAndExit(decide, { failClosed: false, event: 'PreToolUse' });
}
