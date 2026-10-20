// scripts/hooks/card-check.js
// Refuses a question card in the wrong form before the director sees it. A card has its five
// labelled parts; a card with a set line has that one line, its own reply code line (none for a
// kind the composer gives no code, such as setup's, a trust card's or uninstall's), and a first part
// that names what the set line names (for a trust card, the computer it trusts; for uninstall's, the
// project) and no other pull request or commit. The prompt record is what refuses a wrong click, so
// this only informs: it refuses nothing it can't read, and a failure of its own lets the card through. A card that doesn't come from
// scripts/cards/compose.js can fail it; one that does cannot.
// In any folder, a card that reads as the baseline card (any of its fixed words however written, or
// its header with the private note's figures) is refused unless it is the very card the helper
// composed and recorded as shown, word for word: a reworded copy would carry the figures without
// the words that keep them out of the state, and an ordinary card using the baseline card's words
// would have its answer dropped. In a project's folder, or one being set up, any other card holding
// the figures waiting for the click is refused too, saying to leave them out; elsewhere no record of
// an answer is written, so that is let be. A card merely headed Baseline is not refused.
import { runAndExit, answer, projectOf, beingSetUp } from './kit.js';
import { looksLikeBaseline, holdsFigures, cardHash, readShown, cardText, sweepStale } from '../lib/measures-clicks.js';
import { PART_LABELS, whatProblem, NO_REPLY_CODE } from '../cards/compose.js';
import {
  setLinesOf, replyCode, replyCodeLine, runbookLine, LIFT_STOP, RUNBOOK_TITLES, SETUP_TITLES, ID, LANES, TRUST_LINE, UNINSTALL_LINE,
} from '../state/card-lines.js';
import { startedAsScript } from '../lib/started-as-script.js';

const SHA12 = '([0-9a-f]{12})';
const FIVE = PART_LABELS.slice(0, 5);
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
  return null;
}

// What is wrong with one question's form, each as a clause that follows "the card"; an empty
// list when it is right. The hook refuses on any, and the mod's side pane shows the same.
export function cardProblems(question) {
  const text = typeof question === 'string' ? question : '';
  const lines = text.split(new RegExp('\\r\\n|[\\n\\r\\v\\f\\u0085\\u2028\\u2029]'));
  const problems = [];
  const starts = FIVE.map((label) => lines.findIndex((l) => l.startsWith(label)));
  FIVE.forEach((label, i) => {
    if (starts[i] < 0) problems.push(`lacks its "${label}" part`);
    else if (lines[starts[i]].slice(label.length).trim() === '') problems.push(`has nothing after "${label}"`);
  });

  const set = setLinesOf(text);
  if (set.length === 0) return problems;
  if (set.length > 1) return [...problems, `carries ${set.length} set lines, and a card carries one set line`];
  const line = set[0];
  const found = targetOf(line);
  const expected = replyCodeLine(replyCode(line));
  const codes = lines.filter((l) => l.startsWith(REPLY_CODE));
  if (found !== null && NO_REPLY_CODE.includes(found.kind)) {
    if (codes.length > 0) problems.push(`carries a reply code line, and ${/^[aeiou]/.test(found.kind) ? 'an' : 'a'} ${found.kind} card has none: only a click on the card counts`);
  } else if (codes.length === 0) problems.push(`carries a set line without its reply code line, "${expected}"`);
  else if (codes.some((c) => c !== expected)) problems.push(`carries the wrong reply code line for its set line: it should be "${expected}"`);
  else if (codes.length > 1) problems.push('carries its reply code line more than once');

  // The first part runs from its label to the next part, the set line or the reply code line.
  if (starts[0] >= 0) {
    const first = [lines[starts[0]].slice(FIVE[0].length)];
    for (const l of lines.slice(starts[0] + 1)) {
      if (PART_LABELS.some((label) => l.startsWith(label)) || l === line || l.startsWith(REPLY_CODE)) break;
      first.push(l);
    }
    const why = found === null ? null : whatProblem(found.kind, first.join(' ').trim(), found.target, { abbreviated: true });
    if (why !== null) problems.push(`has a first part that ${why}`);
  }
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
  if (input.tool_name !== 'AskUserQuestion') return undefined;
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
    return cardProblems(q.question).map((problem) => `${name} ${problem}.`);
  });
  if (faults.length === 0) return undefined;
  return answer.deny(`The director has not seen this card, which is not in the form their cards take. ${faults.join(' ')} ${REFUSAL_END}`);
}

if (startedAsScript(import.meta.url)) {
  await runAndExit(decide, { failClosed: false, event: 'PreToolUse' });
}
