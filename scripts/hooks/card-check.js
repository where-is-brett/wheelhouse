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
// A decision (an answer card or a product question, scripts/decisions/pending.js) is shown as a chat message, never through the
// question picker: the picker is refused for one, saying to print `decision show <n>`. On Stop, in a front-desk session, every
// "Decision needed" block in the First Mate's last message must be exactly one waiting decision's text (checkShown), or the
// turn is sent back with the reason. A decision's shape (`shapeProblems` in scripts/cards/compose.js) is judged before it is recorded, by
// `cli.js ask` and `act question`, so one on the record has passed. That check blocks by design and fails open: a record that can't be read lets the message go.
// Before the form check, in a project's folder, two more refusals (one card, one answer): a question whose card the
// director has already decided is refused with what counted and where, and, for the front desk with a live pane beside
// it, a card the pane gives buttons to is held back unless the director asked for it in the chat. A call that goes
// through notes the cards it is open on. Both inform and fail open. A question that is a card the state holds (matched by its
// question's words) must also be that card as `cli.js cards` printed it: the same question, header and option labels in the
// same order, else it is refused saying what differs. An answer to a hand-trimmed copy can't be matched to the card, so
// the director's click would record nothing. A question matching no card is left as it was.
// In any folder, a card that reads as the baseline card (any of its fixed words however written, or
// its header with the private note's figures) is refused unless it is the very card the helper
// composed and recorded as shown, word for word: a reworded copy would carry the figures without
// the words that keep them out of the state, and an ordinary card using the baseline card's words
// would have its answer dropped. In a project's folder, or one being set up, any other card holding
// the figures waiting for the click is refused too, saying to leave them out; elsewhere no record of
// an answer is written, so that is let be. A card merely headed Baseline is not refused.
import tools from '../../adapters/claude-code/tools.js';
import { runAndExit, answer, projectOf, beingSetUp, readTailEntries } from './kit.js';
import { looksLikeBaseline, holdsFigures, cardHash, readShown, cardText, sweepStale } from '../lib/measures-clicks.js';
import { whatProblem, NO_REPLY_CODE } from '../cards/compose.js';
import { TO_KNOW_MORE, TO_CHANGE_IT, SUGGEST, SHOW_ME, NOT_NOW, SEND_BACK } from '../lib/calm-words.js';
import { CARD } from '../lib/front-desk.js';
import {
  chatCopy, setLinesOf, setLineOf, replyCode, replyCodeLine, runbookLine, isLiftStopLine, RUNBOOK_TITLES, SETUP_TITLES, ID, LANES, TRUST_LINE, TAKEOVER_LINE, SEAT_TAKEOVER_LINE, PAIR_LINE, UNINSTALL_LINE, KEEP_CONTROL_LINE, USAGE_LINE, PREMIUM_LINE, RELEASE_LINE, UPDATE_HELPER_LINE, UPDATE_LINE,
} from '../state/card-lines.js';
import { startedAsScript } from '../lib/started-as-script.js';
import { cardOutcomes } from '../state/views.js';
import { listEvents } from '../state/events.js';
import { readEnrolled } from '../state/signing.js';
import { stopState } from '../lib/stop.js';
import { stateDir } from '../lib/paths.js';
import { subjectOf, answeredWords } from '../cards/answered.js';
import { PANE_LEAD, paneLine } from '../cards/panel-words.js';
import { paneLive, takeHere, markOpen, HOLD_FOR_PANE } from '../lib/session-files.js';
import { sessionRole } from '../lib/role.js';
import { refreshSeat } from '../lib/first-mate-seat.js';
import { cardButtons } from '../cards/buttons.js';
import { standing } from './prompt-record.js';
import { isDecisionCard, readDecisions } from '../decisions/pending.js';
import { decisionText, blocksIn } from '../decisions/message.js';
import { startedByScript, typedRepliesOn } from '../decisions/answer.js';

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
  if (isLiftStopLine(line)) return { kind: 'lift-stop', target: {} };
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
  if ((m = TAKEOVER_LINE.exec(line))) return { kind: 'take-over', target: { holder: m[1], counter: Number(m[2]) } };
  if ((m = SEAT_TAKEOVER_LINE.exec(line))) return { kind: 'take-over', target: { session: m[1], since: m[2] } };
  if ((m = PAIR_LINE.exec(line))) return { kind: 'pair', target: { client: m[1], fingerprint: m[2] } };
  if ((m = UNINSTALL_LINE.exec(line))) return { kind: 'uninstall', target: { project: m[1], hash: m[2] } };
  if ((m = KEEP_CONTROL_LINE.exec(line))) return { kind: 'keep-control-files', target: { work: m[1], hash: m[2] } };
  if ((m = USAGE_LINE.exec(line))) return { kind: 'usage', target: { to: m[1], at: m[2] } };
  if ((m = PREMIUM_LINE.exec(line))) return { kind: 'premium', target: { at: m[1] } };
  if ((m = RELEASE_LINE.exec(line))) return { kind: 'release', target: { previous: m[1], release: m[2], commit: m[3] } };
  if ((m = UPDATE_HELPER_LINE.exec(line))) return { kind: 'update-helper', target: { card: m[1] } };
  if ((m = UPDATE_LINE.exec(line))) return { kind: 'update', target: { from: m[1], to: m[2], put: m[3] } };
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

export const DECIDED_LEAD = 'The director has already answered: ';
export const DECISION_IN_CHAT = 'A decision is shown as a message in the chat, not through the question picker. Run `decision list`, then print each decision exactly as `decision show <n>` prints it, and ask nothing else for it. The director answers by typing.';
export { PANE_LEAD };

// The cards the questions are, as `standing` matches them: for each question, { card } while it waits or
// { card, stale } once decided; a question matching no card is left out. Throws when the state can't be read.
const allOutcomes = (project, outcomes) => (outcomes ?? (() => cardOutcomes(listEvents(stateDir(project), { report: () => {} }), readEnrolled())))(project);

function cardsOf(questions, project, outcomes) {
  const all = allOutcomes(project, outcomes);
  const clicks = questions.map((q) => ({ question: q?.question }));
  const found = standing(clicks, all);
  return clicks.map((click) => found.get(click) ?? null);
}

// What differs between a question asked and the card it matches, as printed (`asQuestion`: the state's question, in
// the chat's words or whole, its header and its option labels in order); an empty list when it is exactly that card.
function printedProblems(q, card) {
  const { question, header, options } = card.data;
  const problems = [];
  if (q.question !== question && q.question !== chatCopy(question)) problems.push('its question is not worded as printed');
  if (q.header !== header) problems.push(`its header is "${q.header}", and the card's is "${header}"`);
  const asked = Array.isArray(q.options) ? q.options.map((o) => (typeof o === 'string' ? o : o?.label)) : [];
  const printed = Array.isArray(options) ? options : [];
  if (asked.join('\n') !== printed.join('\n')) {
    const left = printed.filter((l) => !asked.includes(l));
    const added = asked.filter((l) => !printed.includes(l));
    const same = left.length === 0 && added.length === 0;
    problems.push(`its options are ${asked.map((l) => `"${l}"`).join(', ') || 'none'}, and the card's are ${printed.map((l) => `"${l}"`).join(', ')}`
      + (left.length > 0 ? ` (left out: ${left.map((l) => `"${l}"`).join(', ')})` : '')
      + (added.length > 0 ? ` (not the card's: ${added.map((l) => `"${l}"`).join(', ')})` : '')
      + (same ? ' (the order differs; keep the order printed)' : ''));
  }
  return problems;
}

// The waiting card a question matching no card reads as reworded: it has two or more of the card's option labels, or its header and one label (headers are
// per kind, so a header alone is not enough). Null when it overlaps none.
// The buttons nearly every card ends with say nothing about which card it is, so they don't count as shared.
const COMMON = [SUGGEST, SHOW_ME, NOT_NOW, SEND_BACK];
function rewordedOf(q, open) {
  const labels = (Array.isArray(q.options) ? q.options : []).map((o) => (typeof o === 'string' ? o : o?.label)).filter((l) => typeof l === 'string');
  return open.find((o) => {
    const { header, options } = o.card.data;
    const shared = Array.isArray(options) ? options.filter((l) => labels.includes(l) && !COMMON.includes(l)).length : 0;
    return shared >= 2 || (shared >= 1 && typeof header === 'string' && header !== '' && q.header === header);
  }) ?? null;
}

const PRINTED_END = 'A card is asked exactly as `cli.js cards` printed it: pass the `questions` JSON it gave, word for word, with every option in its order.';

const plural = (n, one, many) => (n === 1 ? one : many);

// The deny for cards the director has decided already, or for cards the live pane answers, or undefined; and the
// ids a call that goes through is open on. Hooks inform and fail open: any failure here lets the questions through.
function decidedDeny(found, at) {
  const decided = found.filter((f) => f?.stale);
  if (decided.length === 0) return undefined;
  const lines = decided.map((f) => `${subjectOf(f.stale.card)}: ${answeredWords(f.stale, at)}`);
  return `${DECIDED_LEAD}${lines.join('; ')}. Ask none of them again, and say so in one plain line. Ask the cards still waiting with \`again <n>\`.`;
}

// The id the Lift All stop question goes by in the hold, since it is not a card in the state.
const LIFT_ID = 'lift-stop';
const isLiftQuestion = (q) => typeof q?.question === 'string' && isLiftStopLine(setLineOf(q.question));

function oneCardCheck(input, project, { now, outcomes, paneLive: live, takeHere: take, holdForPane, role, stop }) {
  const questions = input.tool_input.questions;
  const at = now();
  const found = cardsOf(questions, project, outcomes);
  const decided = decidedDeny(found, at);
  if (decided !== undefined) return { deny: decided };
  // The picker is for a decision only while typed replies are off, so on it a decision is answered by typing instead.
  if (typedRepliesOn(project) && found.some((f) => f && !f.stale && isDecisionCard(f.card.data))) return { deny: DECISION_IN_CHAT };
  // The Lift All stop question is composed on each visit and never recorded as a card, so the state can't say it is
  // decided: STOP being off is what says so.
  const lifts = questions.map(isLiftQuestion);
  if (lifts.includes(true) && !stop().on) {
    const others = lifts.includes(false);
    return { deny: `All stop is already lifted, so that question is not asked. Say so in one plain line, and ask nothing about it again.${others ? ' Ask only the others.' : ''}` };
  }
  const open = allOutcomes(project, outcomes).filter((o) => o.decided === null && typeof o.card?.data?.question === 'string');
  const wrong = questions.flatMap((q, i) => {
    const f = found[i];
    if (typeof q?.question !== 'string') return [];
    if (!f) {
      const card = rewordedOf(q, open);
      return card === null ? [] : [`Question ${i + 1} is a waiting card reworded: ${printedProblems(q, card.card).join('; ')}.`];
    }
    const problems = printedProblems(q, f.card);
    return problems.length === 0 ? [] : [`Question ${i + 1} is a card, but ${problems.join('; ')}.`];
  });
  if (wrong.length > 0) return { deny: `The director has not seen this card. ${wrong.join(' ')} ${PRINTED_END}` };
  const waiting = found.filter(Boolean);
  const session = input.session_id;
  const pane = (f) => cardButtons(f.card.data).buttons.some((b) => b.does === 'record' || b.does === 'turn');
  // Each question the live pane answers with its own buttons: a card with buttons, and Lift All stop (the pane's Lift STOP).
  const heldAt = questions.map((_, i) => lifts[i] || (found[i] ? pane(found[i]) : false));
  const held = [...waiting.filter(pane).map((f) => f.card.id), ...(lifts.includes(true) ? [LIFT_ID] : [])];
  if (held.length > 0 && holdForPane && role({ sessionId: session, cwd: input.cwd }) === 'front-desk'
    && live(session, at.getTime()) && !take(session, held, at.getTime())) {
    return { deny: paneLine(held.length, { others: heldAt.includes(false) }) };
  }
  return { open: waiting.map((f) => f.card.id) };
}

// Only the repeat refusal, for an agent whose question tool the form check and the pane hold don't apply to: a
// question whose card the director has already decided (in the chat, the panel or anywhere else) is refused with what
// counted and where. It signs nothing and fails open.
export async function decideRepeat(input, { projectOf: find = projectOf, dir, now = () => new Date(), outcomes } = {}) {
  if (input.tool_name !== tools.ask) return undefined;
  const questions = input.tool_input?.questions;
  if (!Array.isArray(questions)) return undefined;
  try {
    const placed = find(input.cwd, { dir });
    if (!placed) return undefined;
    const deny = decidedDeny(cardsOf(questions, placed.project, outcomes), now());
    return deny === undefined ? undefined : answer.deny(deny);
  } catch {
    return undefined;
  }
}

// --- Decisions shown in the chat ---

// What the First Mate's turn ended on: the hook's own field, else the text of the last assistant entry of the transcript's tail.
function lastMessageOf(input) {
  if (typeof input.last_assistant_message === 'string') return input.last_assistant_message;
  const entries = readTailEntries(input.transcript_path);
  const last = Array.isArray(entries) ? entries.findLast((e) => e?.type === 'assistant' && e.isSidechain !== true && Array.isArray(e.message?.content)
    && e.message.content.some((b) => b?.type === 'text' && typeof b.text === 'string' && b.text !== '')) : undefined;
  return last === undefined ? '' : last.message.content.filter((b) => b?.type === 'text' && typeof b.text === 'string').map((b) => b.text).join('\n');
}

const trimmed = (text) => text.split(/\r\n|[\n\r]/).map((l) => l.trimEnd()).join('\n').trim();

// checkShown(lastMessage, pending) -> { ok: true } | { ok: false, reason }. Every "Decision needed" block in the message must equal
// one waiting decision's text exactly, as `decision show <n>` prints it.
export function checkShown(lastMessage, pending) {
  const waiting = Array.isArray(pending) ? pending : [];
  for (const block of blocksIn(lastMessage)) {
    if (waiting.some((d) => trimmed(block) === trimmed(decisionText(d)))) continue;
    const named = Number(/^Decision needed \(([1-9][0-9]*)\)/.exec(block)?.[1]);
    const meant = waiting.find((d) => d.n === named) ?? (waiting.length === 1 ? waiting[0] : undefined);
    if (meant !== undefined) return { ok: false, reason: `Show decision ${meant.n} exactly as printed: run \`decision show ${meant.n}\` and copy its text word for word, with nothing added inside it.` };
    return { ok: false, reason: waiting.length === 0
      ? 'No decision is waiting, so a "Decision needed" block is not shown. Take it out; a decision is raised through the intake, and `decision list` says what waits.'
      : `That "Decision needed" block is not a waiting decision. Waiting: ${waiting.map((d) => d.n).join(', ')}. Show one exactly as \`decision show <n>\` prints it.` };
  }
  return { ok: true };
}

// The Stop check: a front-desk session's last message with a decision block that is not a waiting decision's exact text is sent
// back. A turn already sent back once is let go, and any failure lets the message through.
export async function decideStop(input, { projectOf: find = projectOf, dir, role = sessionRole, env = process.env, decisions } = {}) {
  try {
    if (input.stop_hook_active === true || startedByScript(env)) return undefined;
    const message = lastMessageOf(input);
    const found = find(input.cwd, { dir });
    const holder = found && role({ sessionId: input.session_id, env, cwd: input.cwd }) === 'front-desk';
    if (holder) refreshSeat(found.project, input.session_id);
    if (blocksIn(message).length === 0 || !holder) return undefined;
    const checked = checkShown(message, (decisions ?? readDecisions(found.project)).pending);
    return checked.ok ? undefined : answer.block(checked.reason);
  } catch {
    return undefined;
  }
}

export async function decide(input, {
  projectOf: find = projectOf, dir, now = () => new Date(), outcomes, paneLive: live = paneLive, takeHere: take = takeHere,
  markOpen: open = markOpen, holdForPane = HOLD_FOR_PANE, role = sessionRole, stop = stopState, env = process.env, decisions,
} = {}) {
  if (input.hook_event_name === 'Stop') return decideStop(input, { projectOf: find, dir, role, env, decisions });
  if (input.tool_name !== tools.ask) return undefined;
  const questions = input.tool_input?.questions;
  if (!Array.isArray(questions)) return undefined;
  const inProject = Boolean(find(input.cwd, { dir }));
  const recorded = inProject || beingSetUp(input.cwd) !== null;
  const baseline = baselineFaults(questions, now, { figures: recorded });
  if (baseline.length > 0) return answer.deny(`The director has not seen this card. ${baseline.join(' ')}`);
  if (!inProject) return undefined;
  let open_ = null;
  try {
    const checked = oneCardCheck(input, find(input.cwd, { dir }).project, { now, outcomes, paneLive: live, takeHere: take, holdForPane, role, stop });
    if (checked.deny !== undefined) return answer.deny(checked.deny);
    open_ = checked.open;
  } catch {
    // The state can't be read: the questions are asked as they were.
  }
  const faults = questions.flatMap((q, i) => {
    if (typeof q?.question !== 'string') return [];
    const name = typeof q.header === 'string' && q.header !== '' ? `Question ${i + 1} ("${q.header}")` : `Question ${i + 1}`;
    return cardProblems(q).map((problem) => `${name} ${problem}.`);
  });
  if (faults.length === 0) {
    // The call goes through: note the cards it is open on, so a stopped question can be told about later.
    try {
      if (open_ !== null && open_.length > 0) open(input.session_id, open_, now().getTime());
    } catch {
      // Nothing is noted.
    }
    return undefined;
  }
  return answer.deny(`The director has not seen this card, which is not in the form their cards take. ${faults.join(' ')} ${REFUSAL_END}`);
}

if (startedAsScript(import.meta.url)) {
  await runAndExit(decide, { failClosed: false, event: 'PreToolUse' });
}
