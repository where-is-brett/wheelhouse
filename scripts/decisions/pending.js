// scripts/decisions/pending.js
// The decisions that wait for the director, worked out from the record. A decision is an answer card the composer made
// (scripts/cards/compose.js: the card for a question from the build) that no answer has
// decided: not a typed reply (a signed decision-answer), nor a click, nor a reply code. A card the director clicks
// through the question picker stays a click-only kind: setup, confirm-all, trust, takeover, uninstall, keep-control,
// usage, premium and start-goal are never decisions, and neither is a build-command question, which grants commands and
// stays on the picker.
//
// Numbers count up from 1 within a project. A number is never reused while any decision waits, so a late reply to an old
// number meets "already answered" and never a different decision; they go back to 1 only once no decision waits and a new
// one is raised. Nothing here expires: no decision is ever answered by the passing of time.
import { QUESTION_ID } from '../state/card-lines.js';
import { cardOutcomes } from '../state/views.js';
import { listEvents } from '../state/events.js';
import { readEnrolled, verify } from '../state/signing.js';
import { stateDir } from '../lib/paths.js';
import { PUT_OFF } from '../lib/front-desk.js';
import { BUILD_QUESTION_LABELS } from '../protection/windows-builds.js';

// The card kind a decision is made from: an answer card, the card for a question an agent raised (its set line is
// "Answer question q-..."). A product question and the many cards Wheelhouse raises about itself share the `question` kind
// and are acted on by the click that answers them, so they stay on the question picker.
export const DECISION_KINDS = Object.freeze(['answer']);

const BUILD_LABELS = Object.values(BUILD_QUESTION_LABELS).filter((l) => !PUT_OFF.includes(l));
const isPlain = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
const flat = (x) => (typeof x === 'string' ? x.replace(/\s+/g, ' ').trim() : '');
const byOrder = (a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

// Whether a card's data is a decision: an answer card that is not a build-command question.
export function isDecisionCard(data) {
  if (!isPlain(data) || !DECISION_KINDS.includes(data.kind)) return false;
  // The card's own options, without the buttons that put it off or steer it, which the composer adds to a short list.
  const labels = (Array.isArray(data.options) ? data.options : []).filter((l) => !PUT_OFF.includes(l));
  return !(labels.length === BUILD_LABELS.length && BUILD_LABELS.every((l, i) => labels[i] === l));
}

// The options a decision offers: the card's own, without the buttons that put a card off or steer it.
function optionsOf(data) {
  const parts = Array.isArray(data.parts?.options) ? data.parts.options.filter(isPlain) : null;
  const listed = parts ?? (Array.isArray(data.options) ? data.options.map((label) => ({ label })) : []);
  return listed.filter((o) => typeof o.label === 'string' && !PUT_OFF.includes(o.label))
    .map((o) => ({
      label: o.label,
      says: typeof o.says === 'string' ? o.says : o.label,
      ...(typeof o.cost === 'string' ? { cost: o.cost } : {}),
      ...(typeof o.undo === 'string' ? { undo: o.undo } : {}),
    }));
}

// The reason after "because" in a card's recommendation, for a card made before its parts kept it.
function becauseOf(data) {
  if (typeof data.parts?.because === 'string') return data.parts.because;
  const m = /, because (.*?)\.?$/.exec(flat(data.parts?.recommendation));
  return m === null ? flat(data.parts?.recommendation) : m[1];
}

// What the question's work is called, or null: an answer card names its question in its set line, and the question names the work.
function workOf(data, events) {
  const id = new RegExp(`^Answer question (${QUESTION_ID})$`).exec(String(data.line ?? ''))?.[1];
  if (id === undefined) return null;
  const asked = events.filter((e) => e.kind === 'question' && e.data?.id === id).sort(byOrder).at(-1);
  const work = asked?.data?.work;
  if (typeof work !== 'string') return null;
  const titled = events.filter((e) => e.kind === 'work' && e.data?.id === work).sort(byOrder).at(-1)?.data?.title;
  const title = flat(titled);
  return title !== '' && title.length <= 80 ? title : work;
}

function decisionOf(card, n, events) {
  const data = card.data;
  const parts = isPlain(data.parts) ? data.parts : {};
  return {
    n,
    id: card.id,
    question: flat(parts.ask ?? String(data.question ?? '').split('\n')[0]),
    code: typeof data.code === 'string' ? data.code : null,
    options: optionsOf(data),
    recommend: typeof data.recommend === 'string' ? data.recommend : null,
    work: workOf(data, events),
    holds: flat(parts.holds),
    why: flat(parts.why),
    because: becauseOf(data),
    meanwhile: flat(parts.meanwhile),
    raisedAt: card.at,
    line: typeof data.line === 'string' ? data.line : null,
    text: data.question,
  };
}

// decisionsFrom(events, enrolled) -> { pending, answered, next }
//   pending:  the waiting decisions, oldest first, each as decisionOf gives it
//   answered: the decisions of the current numbering that an answer closed, each { n, id, text, at, label, words, where }
//   next:     the number the next decision raised will have
export function decisionsFrom(events, enrolled) {
  const all = Array.isArray(events) ? events : [];
  const cards = all.filter((e) => e.kind === 'card' && isDecisionCard(e.data)).sort(byOrder);
  if (cards.length === 0) return { pending: [], answered: [], next: 1 };
  const outcomes = new Map(cardOutcomes(all, enrolled).map((o) => [o.card.id, o]));
  const typed = all.filter((e) => e.kind === 'decision-answer' && verify(e, enrolled)).sort(byOrder);
  // A card a later card revises is closed by it, not answered.
  const revisedAt = new Map(cards.filter((c) => typeof c.data.revises === 'string').map((c) => [c.data.revises, c.at]));

  const steps = [];
  for (const card of cards) {
    steps.push({ at: card.at, order: 0, card, raise: true });
    const decided = outcomes.get(card.id)?.decided ?? null;
    const typedAnswer = typed.find((e) => e.data.question === card.data.question && byOrder(card, e) < 0);
    const closedAt = [decided?.at, revisedAt.get(card.id)].filter((t) => typeof t === 'string').sort()[0];
    if (closedAt !== undefined) {
      const revised = decided === null || revisedAt.get(card.id) === closedAt;
      steps.push({ at: closedAt, order: 1, card, raise: false, answered: !revised, decided, typedAnswer });
    }
  }
  steps.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : a.order - b.order || (a.card.id < b.card.id ? -1 : 1)));

  const waiting = new Map();
  const numbered = new Map();
  let counter = 0;
  let epoch = 0;
  for (const step of steps) {
    if (step.raise) {
      if (waiting.size === 0) {
        counter = 0;
        epoch += 1;
      }
      counter += 1;
      numbered.set(step.card.id, { n: counter, epoch, answer: null });
      waiting.set(step.card.id, step.card);
    } else if (waiting.delete(step.card.id) && step.answered) {
      const answer = step.typedAnswer;
      numbered.get(step.card.id).answer = {
        at: step.at,
        label: answer?.data.label ?? step.decided?.label ?? null,
        words: answer?.data.words ?? '',
        where: step.decided?.where ?? 'chat',
      };
    }
  }

  const pending = [...waiting.values()].map((card) => decisionOf(card, numbered.get(card.id).n, all));
  const answered = cards.filter((c) => numbered.get(c.id).epoch === epoch && numbered.get(c.id).answer !== null)
    .map((c) => ({ n: numbered.get(c.id).n, id: c.id, text: c.data.question, code: typeof c.data.code === 'string' ? c.data.code : null, options: optionsOf(c.data), ...numbered.get(c.id).answer }));
  return { pending, answered, next: counter + 1 };
}

const quiet = { report: () => {} };

// The record of a project, read here, for a hook (which runs outside the sandbox).
export function readDecisions(project, { events, enrolled } = {}) {
  const held = events ?? listEvents(stateDir(project), quiet);
  return decisionsFrom(held, enrolled ?? readEnrolled());
}

// pendingDecisions(project) -> the waiting decisions, each { n, question, code, options, recommend, work, raisedAt, ... }.
export const pendingDecisions = (project, deps) => readDecisions(project, deps).pending;

// decisionNumber(project) -> the number the next decision raised will have.
export const decisionNumber = (project, deps) => readDecisions(project, deps).next;
