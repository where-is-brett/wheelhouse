// scripts/cards/visit.js
// Chooses the cards to ask when the director visits: the waiting cards never yet asked, most
// important first, at most four, so each card is asked once and the rest stay on the board.
// Also finds the waiting card that already carries a set line, and the card the board numbers n.
import { CARD } from '../lib/front-desk.js';
import { numberedWaiting } from '../board/model.js';
import { QUESTION_ID } from '../state/card-lines.js';

// How important a card is, as a number: the higher, the sooner the director sees it. The one
// place the order lives. "Above level 3" is a rank over LEVEL_3: STOP or an incident, level 4,
// or a question that holds up all work.
export const IMPORTANCE = Object.freeze({ STOP_OR_INCIDENT: 4, LEVEL_4: 3, HOLDS_UP_ALL: 2, LEVEL_3: 1, REST: 0 });

const isRecord = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
// The kinds that are STOP or an incident, or the emergency steps the director runs for one.
const EMERGENCY_KINDS = ['lift-stop', 'lift-incident', 'incident-fix', 'runbook'];

// The open question an answer card asks, from its set line and the build loop's questions view,
// or null when the card isn't an answer card or its question is answered or unknown.
function openQuestionOf(card, views) {
  if (card?.data?.kind !== 'answer' || !isRecord(views?.questions)) return null;
  const id = new RegExp(`^Answer question (${QUESTION_ID})$`).exec(String(card.data.line ?? ''))?.[1];
  const entry = id === undefined ? undefined : views.questions[id];
  return isRecord(entry) && !entry.answer ? entry.question?.data ?? null : null;
}

// Whether all other work that isn't finished waits, directly or through other work, on this
// work. Work is finished when its report says merged or closed; blocked work is not.
function holdsUpAll(id, views) {
  const work = isRecord(views?.work) ? views.work : {};
  const reports = isRecord(views?.reports) ? views.reports : {};
  const open = (w) => isRecord(work[w]) && !['merged', 'closed'].includes(reports[w]?.data?.outcome);
  if (!open(id)) return false;
  const waitsOn = (w, seen = new Set()) => {
    seen.add(w);
    const deps = Array.isArray(work[w].work?.data?.dependsOn) ? work[w].work.data.dependsOn : [];
    return deps.some((d) => d === id || (open(d) && !seen.has(d) && waitsOn(d, seen)));
  };
  return Object.keys(work).filter((w) => w !== id && open(w)).every((w) => waitsOn(w));
}

// The card's rank, one of IMPORTANCE's values; higher is more important. It is read from the
// card's kind and level and the build loop's views, never from the card's words. Only an
// answer card to a question still open can hold up all work: the question's work is unfinished
// and every other unfinished work depends on it.
export function importanceOf(card, views) {
  const data = card?.data;
  if (EMERGENCY_KINDS.includes(data?.kind)) return IMPORTANCE.STOP_OR_INCIDENT;
  if (data?.level === 4) return IMPORTANCE.LEVEL_4;
  const work = openQuestionOf(card, views)?.work;
  if (typeof work === 'string' && holdsUpAll(work, views)) return IMPORTANCE.HOLDS_UP_ALL;
  return data?.level === 3 ? IMPORTANCE.LEVEL_3 : IMPORTANCE.REST;
}

// The card as AskUserQuestion takes it. A card written before cards kept their button words
// shows each button's label in their place.
function asQuestion(card) {
  const { question, header, options, descriptions } = card.data;
  return {
    question,
    header,
    options: options.map((label, i) => ({ label, description: descriptions?.[i] ?? label })),
    multiSelect: false,
  };
}

const waitingOf = (views) => (Array.isArray(views?.waiting) ? views.waiting.filter(isRecord) : []);

// The composer's own importance for a card, to order cards of one rank; none counts as 0.
const ownImportance = (card) => (Number.isFinite(card.data?.importance) ? card.data.importance : 0);

// The next visit's cards: those never asked (`asked` null), most important first. Within one
// rank the composer's own importance decides (higher first), then the oldest, then the id.
// At most CARD.questions; `left` counts the ones not taken. A card put off stays on the board,
// so the director can still ask for it. The order doesn't depend on the clock.
export function cardsForVisit(views, _visit = {}) {
  const ranked = waitingOf(views).filter((c) => c.asked === null || c.asked === undefined)
    .map((card) => ({ card, rank: importanceOf(card, views) }))
    .sort((a, b) => b.rank - a.rank || ownImportance(b.card) - ownImportance(a.card)
      || (a.card.at < b.card.at ? -1 : a.card.at > b.card.at ? 1 : 0) || (a.card.id < b.card.id ? -1 : 1))
    .map(({ card }) => card);
  const chosen = ranked.slice(0, CARD.questions);
  return { questions: chosen.map(asQuestion), ids: chosen.map((c) => c.id), left: ranked.length - chosen.length };
}

// The id of the waiting card that already carries this set line, or null: composing a card again
// gives that card back, not a new one. A card put off with Not now is still waiting. Of two with
// one line, the oldest.
export function existingCard(views, line) {
  if (typeof line !== 'string' || line === '') return null;
  return waitingOf(views).find((c) => c.data?.line === line)?.id ?? null;
}

// The waiting card the board numbers n, to ask again, or null: there is no such number, or it
// names a question from the build that no card has asked yet. `events` are the events the board
// was built from; the board leaves out a build question that a card, even an answered one, names.
export function askAgain(views, n, { events = [] } = {}) {
  if (!Number.isInteger(n)) return null;
  const item = numberedWaiting(views, events).find((i) => i.n === n);
  const card = item?.card === undefined ? undefined : waitingOf(views).find((c) => c.id === item.card);
  return card ? asQuestion(card) : null;
}
