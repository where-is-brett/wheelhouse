// scripts/cards/visit.js
// Chooses the cards to ask when the director visits: the waiting cards never yet asked, most
// important first, at most four, so each card is asked once and the rest stay on the board.
// Also finds the waiting card that already carries a set line, and the card the board numbers n.
import { CARD } from '../lib/front-desk.js';
import { numberedWaiting } from '../board/model.js';
import { ID, QUESTION_ID } from '../state/card-lines.js';

// How important a card is, as a number: the higher, the sooner the director sees it. The one
// place the order lives. "Above level 3" is a rank over LEVEL_3: STOP or an incident, level 4,
// or a question that holds up all work.
export const IMPORTANCE = Object.freeze({ STOP_OR_INCIDENT: 4, LEVEL_4: 3, HOLDS_UP_ALL: 2, LEVEL_3: 1, REST: 0 });

const isRecord = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
const INCIDENT_KINDS = ['lift-stop', 'lift-incident', 'incident-fix'];
// The kinds that decide one piece of work, and the set line's words that name it.
const WORK_LINES = [
  ['approve-work', new RegExp(`^Approve (${ID}) \\(`)],
  ['amend', new RegExp(`^Change the approved (${ID}) to this`)],
];

// Whether a card's words name an incident that is open: a whole word, not part of a longer id.
function namesOpenIncident(card, views) {
  const open = Array.isArray(views?.incidents?.open) ? views.incidents.open : [];
  const text = String(card.data?.question ?? '');
  return open.some((i) => typeof i?.id === 'string' && new RegExp(`(?<![A-Za-z0-9-])${i.id.replace(/[^a-z0-9-]/g, '')}(?![A-Za-z0-9-])`).test(text));
}

// The work a card decides, from its kind and set line, or null.
function workOf(card, views) {
  const line = typeof card.data?.line === 'string' ? card.data.line : '';
  if (card.data?.kind === 'answer') {
    const id = new RegExp(`^Answer question (${QUESTION_ID})$`).exec(line)?.[1];
    return id === undefined ? null : views.questions?.[id]?.question?.data?.work ?? null;
  }
  const found = WORK_LINES.find(([kind]) => kind === card.data?.kind);
  return found ? found[1].exec(line)?.[1] ?? null : null;
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

// The card's rank, one of IMPORTANCE's values; higher is more important. `views` are the state
// views, for the build loop's work, reports and open incidents.
export function importanceOf(card, views) {
  const data = card?.data;
  if (INCIDENT_KINDS.includes(data?.kind) || namesOpenIncident(card, views)) return IMPORTANCE.STOP_OR_INCIDENT;
  if (data?.level === 4) return IMPORTANCE.LEVEL_4;
  const work = workOf(card, views);
  if (work !== null && holdsUpAll(work, views)) return IMPORTANCE.HOLDS_UP_ALL;
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

// The next visit's cards: those never asked (`asked` null), most important first and the oldest
// first among equals, at most CARD.questions. `left` counts the ones not taken. A card put off
// stays on the board, so the director can still ask for it. The order doesn't depend on the clock.
export function cardsForVisit(views, _visit = {}) {
  const ranked = waitingOf(views).filter((c) => c.asked === null || c.asked === undefined)
    .map((card) => ({ card, rank: importanceOf(card, views) }))
    .sort((a, b) => b.rank - a.rank || (a.card.at < b.card.at ? -1 : a.card.at > b.card.at ? 1 : 0) || (a.card.id < b.card.id ? -1 : 1))
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
