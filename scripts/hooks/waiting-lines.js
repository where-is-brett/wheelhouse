// scripts/hooks/waiting-lines.js
// The lines the board-context hook builds from the desk's waiting view: the cards due, the decisions waiting, the stuck and helm
// notes, the approvals with no card, and the cards decided since the First Mate's last turn. They are in a module of their own,
// which the hook loads only when the view holds something to say (scripts/hooks/board-context.js), so a prompt with nothing
// waiting doesn't load the cards, the board and the decisions behind them.
import { readTailEntries } from './kit.js';
import { stoppedQuestion } from './stopped-question.js';
import { answeredWords, subjectOf, NOTE_LEAD } from '../cards/answered.js';
import { SINCE_LEAD, SINCE_TAIL } from '../cards/panel-words.js';
import { chatCopy, approveWorkLine, answerLine } from '../state/card-lines.js';
import { isOpen } from '../desk/is-open.js';
import { heldBackLine } from '../board/model.js';
import { existingCard } from '../cards/visit.js';
import { approvalCandidates, controlFilesDue, gateAsksDue, holdsDue, premiumFailuresDue } from '../cards/build-loop.js';
import { questionProblem } from '../cards/compose.js';
import { stopState } from '../lib/stop.js';
import { CARD } from '../lib/front-desk.js';
import { isDecisionCard } from '../decisions/pending.js';
import { typedRepliesIn } from '../decisions/switch.js';
import { parseReply } from '../decisions/reply.js';
import { isBuildQuestion } from '../protection/windows-builds.js';
import { decisionsLead, DECISIONS_TAIL, DECISIONS_TAIL_OFF, STOPPED_LEAD, outcomesSince } from './board-context.js';

const HOUR_MS = 60 * 60 * 1000;
// The most cards one line names; the rest are on the board.
const NOTE_CARDS = 6;
const STOPPED_TAIL = 'Never say a card was closed without an answer.';
const isRecord = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

// How many cards `cli.js cards` would hand out now, from the views the desk's waiting view gives: the waiting cards no
// visit has handed out, and the open questions from the build that no waiting card asks yet and
// that the composer can make a card of, which it makes cards of first; then the cards the build
// loop's records call for (scripts/cards/build-loop.js): each click the merge gate waits for whose
// card is to be made or asked again, each lineage hold with no card, and each control-file
// record with no card. Whether a pull request
// has moved on is the host's to say, which `cli.js cards` asks and this doesn't, so until the
// gate's next record this may count a gate card that `cards` then doesn't give. At most one call's worth. Under STOP,
// the one Lift STOP card.
export async function cardsToAsk(desk, at) {
  if (stopState().on) return 1;
  const got = await desk.read('waiting');
  return got?.ok === true && isRecord(got.data?.views) ? cardsDue(got.data.views, at) : 0;
}

// The count cardsToAsk gives, from the views given (with STOP off).
export function cardsDue(views, at) {
  const waiting = Array.isArray(views.waiting) ? views.waiting.filter(isRecord) : [];
  // With typed replies on, a decision is shown as a chat message, so it is no card to ask (see decisionsLine); off, it is a card.
  const typed = typedRepliesIn(views.settings);
  const fresh = new Set(waiting.filter((card) => (card.asked === null || card.asked === undefined) && !heldBackLine(card.data?.line, views) && !(typed && isDecisionCard(card.data))).map((card) => card.id));
  const questions = Object.entries(isRecord(views.questions) ? views.questions : {})
    .filter(([id, entry]) => isRecord(entry) && !entry.answer && entry.joins === undefined && existingCard({ waiting }, answerLine(id)) === null && !heldBackLine(answerLine(id), views)
      && (!typed || isBuildQuestion(entry.question?.data)) && questionProblem(entry.question?.data, { recorded: true }) === null).length;
  const gate = gateAsksDue(views, at);
  for (const due of gate) if (due.again !== undefined) fresh.add(due.again);
  const made = gate.filter((due) => due.make).length + holdsDue(views).length + controlFilesDue(views).length + premiumFailuresDue(views).length;
  return Math.min(CARD.questions, fresh.size + questions + made);
}

export function decisionsLine(views, pending) {
  const typed = typedRepliesIn(isRecord(views) ? views.settings : undefined);
  const listed = (Array.isArray(pending) ? pending : []).filter(isRecord);
  const waiting = isRecord(views) ? views.waiting : [];
  const cards = Array.isArray(waiting) ? waiting.filter(isRecord) : [];
  // Off, a question with no card yet is counted by the cards line instead, as it always was.
  const toCome = !typed ? 0 : Object.entries(isRecord(views?.questions) ? views.questions : {})
    .filter(([id, entry]) => isRecord(entry) && !entry.answer && entry.joins === undefined && existingCard({ waiting: cards }, answerLine(id)) === null
      && !isBuildQuestion(entry.question?.data) && questionProblem(entry.question?.data, { recorded: true }) === null).length;
  if (listed.length === 0 && toCome === 0) return null;
  const said = listed.map((d) => `${d.n}. ${d.question}`).join('; ');
  return [listed.length === 0 ? null : decisionsLead(said), toCome === 0 ? null : `Decisions not shown yet: ${toCome}.`, typed ? DECISIONS_TAIL : DECISIONS_TAIL_OFF].filter(Boolean).join(' ');
}

// `typed` is the director's own words in this prompt. A decision that reply answers is left out, as the prompt hook records it
// beside this hook in the same turn, and the line would otherwise show it as waiting.
export async function decisionLineOf(desk, typed) {
  const got = await desk.read('waiting');
  if (got?.ok !== true || !isRecord(got.data?.views)) return null;
  const pending = Array.isArray(got.data.decisions?.pending) ? got.data.decisions.pending : [];
  const reply = typeof typed === 'string' && typedRepliesIn(got.data.views.settings) ? parseReply(typed, pending) : { kind: 'none' };
  return decisionsLine(got.data.views, reply.kind === 'answer' ? pending.filter((d) => d.n !== reply.n) : pending);
}

// The most stuck messages one line names.
const STUCK_NOTES = 3;

// A feature session's own plain message that it is stuck (the note `act stuck-note` records), told once: those recorded since the
// First Mate's last turn began, or in the last day when there was none. Null when there are none.
export async function stuckLine(desk, since, at) {
  const from = Number.isFinite(Date.parse(since)) ? Date.parse(since) : at.getTime() - 24 * HOUR_MS;
  const got = await desk.read('waiting', { stuck: true });
  const notes = (Array.isArray(got?.data?.stuck) ? got.data.stuck : [])
    .filter((e) => isRecord(e) && typeof e.work === 'string' && typeof e.words === 'string' && Date.parse(e.recorded) > from)
    .slice(0, STUCK_NOTES);
  if (notes.length === 0) return null;
  return notes.map((e) => `${e.work} is stuck: its session says "${e.words.replace(/\s+/g, ' ').trim()}" (sent ${e.at}).`).join(' ');
}

// The most works the approval line names.
const ORPHAN_NAMED = 3;

// The works `cli.js cards` would make an approval card for (scripts/cards/build-loop.js: approvalCandidates) that no card in the
// waiting view asks about, in the view's order. A card counts whether or not it was asked, but only for the work's current
// document: its line is matched whole, in both wordings (with the show-first tail and plain), as `cards` matches it. A view it
// can't read gives none.
export function orphanedApprovals(views) {
  if (!isRecord(views) || !isRecord(views.work)) return [];
  const cards = Array.isArray(views.waiting) ? views.waiting.filter(isRecord) : [];
  const lines = new Set(cards.map((c) => c.data?.line).filter((l) => typeof l === 'string'));
  try {
    return approvalCandidates(views, isOpen)
      .filter(({ id, data }) => !lines.has(approveWorkLine(id, data.lane, data.doc.hash, { shownFirst: true })) && !lines.has(approveWorkLine(id, data.lane, data.doc.hash)))
      .map(({ id }) => id);
  } catch {
    return [];
  }
}

// The line that tells the desk to make the approval cards those works lack. `cli.js cards` makes a missing approval card and hands it out.
export function orphanLine(works) {
  if (!Array.isArray(works) || works.length === 0) return null;
  const named = works.slice(0, ORPHAN_NAMED).join(', ');
  const rest = works.length - ORPHAN_NAMED;
  return `Waiting for the director's approval with no card: ${named}${rest > 0 ? ` and ${rest} more` : ''}. Run \`cli.js cards\`: it makes each one's approval card. Ask the cards it hands out this turn.`;
}

export async function orphanLineOf(desk) {
  if (stopState().on) return null;
  const got = await desk.read('waiting');
  if (got?.ok !== true || !isRecord(got.data?.views)) return null;
  return orphanLine(orphanedApprovals(got.data.views));
}

// The most helm notes one line names: the newest, since the oldest were recorded first.
const HELM_NOTES = 5;

// The notes a piece's crew left of what the director did at its helm, told once: those recorded since the First Mate's last turn
// began, or in the last day when there was none. Each is a record's text and so data, kept to one line with its control
// characters taken out. Null when there are none.
export async function helmNoteLine(desk, since, at) {
  const from = Number.isFinite(Date.parse(since)) ? Date.parse(since) : at.getTime() - 24 * HOUR_MS;
  const got = await desk.read('waiting', { helmNotes: true });
  const notes = (Array.isArray(got?.data?.helmNotes) ? got.data.helmNotes : [])
    .filter((e) => isRecord(e) && typeof e.work === 'string' && typeof e.text === 'string' && Date.parse(e.recorded) > from)
    .map((e) => ({ work: e.work, text: e.text.replace(/[\p{Cc}\p{Cf}\u2028\u2029]+/gu, ' ').replace(/\s+/g, ' ').trim() }))
    .filter((e) => e.text !== '')
    .slice(-HELM_NOTES);
  if (notes.length === 0) return null;
  return notes.map((e) => `While you had the helm of ${e.work}: ${e.text}`).join('\n');
}

// The two lines, in the order they go into the context: [since, stopped], each a string or null. `since` is when the
// First Mate's last turn began (the prompt before this one); `open` is what the session's open.json held. A card the
// stopped line names is left out of the since line.
export async function cardNotes({ project, input, since, at, desk, open }) {
  // The decided cards, the card events and the board's numbers all come through the desk (design section 4.4): the hook
  // reads neither the state nor the keys itself.
  const from = Date.parse(since);
  const got = await desk.read('waiting', { outcomes: { since: outcomesSince(since, at) } });
  const data = isRecord(got?.data) ? got.data : {};
  const decided = Array.isArray(data.outcomes) ? data.outcomes.filter((o) => isRecord(o) && isRecord(o.card) && isRecord(o.decided)) : [];
  const events = Array.isArray(data.cards) ? data.cards.filter((e) => isRecord(e) && typeof e.id === 'string') : [];
  const numbers = new Map();
  for (const item of Array.isArray(data.numbered) ? data.numbered : []) if (typeof item.card === 'string') numbers.set(item.card, item.n);
  const outcomes = [
    ...decided,
    ...events.filter((e) => numbers.has(e.id) && !decided.some((o) => o.card.id === e.id)).map((card) => ({ card, decided: null })),
  ];
  const firstLine = (text) => String(text ?? '').split('\n')[0];
  const tail = readTailEntries(input.transcript_path);
  const questions = stoppedQuestion(tail, { prompt: input.prompt });
  // The cards whose hidden line the mod appended is already in the transcript's tail: the chat said them.
  const tailText = Array.isArray(tail) ? JSON.stringify(tail) : '';
  const noted = (id) => tailText.includes(NOTE_LEAD) && tailText.includes(`(card ${id})`);
  const named = new Map();
  if (questions !== null) {
    for (const text of questions) {
      const lines = [firstLine(text), firstLine(chatCopy(text))];
      const mine = outcomes.filter((o) => typeof o.card.data?.question === 'string' && lines.some((l) => l === firstLine(o.card.data.question) || l === firstLine(chatCopy(o.card.data.question))));
      const found = mine.filter((o) => o.decided === null).at(-1) ?? mine.at(-1);
      if (found !== undefined) named.set(found.card.id, found);
    }
    for (const id of open?.cards ?? []) {
      const found = outcomes.find((o) => o.card.id === id);
      if (found !== undefined) named.set(id, found);
    }
  }
  let stopped = null;
  if (named.size > 0) {
    const parts = [...named.values()].slice(0, NOTE_CARDS).map((o) => {
      if (o.decided !== null) return `${subjectOf(o.card)}: ${answeredWords(o, at)}`;
      const n = numbers.get(o.card.id);
      return `${subjectOf(o.card)}: still waiting${n === undefined ? '' : `, card ${n}`}`;
    });
    stopped = `${STOPPED_LEAD}${parts.join('; ')}. ${STOPPED_TAIL}`;
  }
  const fresh = Number.isFinite(from)
    ? outcomes.filter((o) => o.decided !== null && o.decided.where !== 'chat' && Date.parse(o.decided.at) > from && !named.has(o.card.id) && !noted(o.card.id))
      .sort((a, b) => Date.parse(a.decided.at) - Date.parse(b.decided.at)).slice(0, NOTE_CARDS)
    : [];
  const told = fresh.length === 0 ? null : `${SINCE_LEAD}${fresh.map((o) => `${subjectOf(o.card)}: ${answeredWords(o, at)}`).join('; ')}. ${SINCE_TAIL}`;
  return [told, stopped];
}
