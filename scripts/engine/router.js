// scripts/engine/router.js
// The card router (Archon design, section 8.3): each ask from the engine is answered by the fixed table, answered by
// its recommendation where a delegation lowered it, or becomes a card; a provider's usage limit is only a Logbook line.
// Cards keep to the director's cards a day (a target, not a hard cap): what holds up all work, and All stop, ignore it.
// It decides nothing a model would, and silence is never consent: an ask with no answer the table or a delegation
// gives waits for the director.
//
// A card is one of two shapes, so the signing that already exists signs it:
//   { approval: { pr, sha, what, why, ... } }   an approval of visible work, signed as any pull request's approval;
//   { question: { what, why, options, recommendation, level, engine } }   an answer card, signed by its question line.
// `engine` keeps what goes back: { runId, ask, options: { [label]: optionId } }.

// The first number of the engine's question ids, `q-<work>-<n>`: above any feature's own count, below the foreman's.
export const ENGINE_QUESTIONS = 500000;
export const SUGGEST_LABEL = 'Suggest a change…';

const isPlain = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
const isText = (x) => typeof x === 'string' && x.trim() !== '';
const FULL_SHA = /^[0-9a-f]{40}$/;

// The words an ask's kind is put in, when the ask brings none of its own.
const WHAT = {
  question: 'The build has a question it can\'t settle itself.',
  approval: 'A change is ready for you to look at before it is added.',
  blocked: 'The build stopped: it can\'t go on without you.',
  trouble: 'Something went wrong with the build.',
};
const WHY = {
  3: 'It is a level 3 decision, which is yours.',
  4: 'It is a level 4 decision: it touches money, security, personal data or something that can\'t be undone.',
};

// Whether the ask's answer holds up all work (the main line red with no hold, a run that lost its owner).
const holdsAll = (ask) => ask?.holdsAll === true || ask?.labels?.holds === 'all';

// What to do with one ask (an `ask` EngineEvent as the adapter gives it). `levels` are the project's level records by
// topic ({ [topic]: { value } }), from which a delegation lowers a level-3 ask to level 2.
//   -> { answer: { choice, words? }, line, level } | { card: { approval } | { question }, importance } | { line }
export function routeAsk(ask, { levels = {} } = {}) {
  if (!isPlain(ask)) return { line: 'The engine sent something that isn\'t a question; nothing was done with it.' };
  const level = [1, 2, 3, 4].includes(ask.level) ? ask.level : 3;
  const optionIds = new Set((ask.options ?? []).map((o) => o?.id));
  if (ask.kind === 'usage-limit') return { line: ask.line ?? 'The AI provider\'s usage limit was reached; the build carries on by itself once it resets.' };
  // The engine's own asks, answered by the fixed table, which the adapter keeps.
  if (isText(ask.answer) && optionIds.has(ask.answer) && level <= 2) {
    return { answer: { choice: ask.answer }, line: ask.line ?? `The build's question was answered by the standing rule (level ${level}).`, level };
  }
  if (ask.card === false && !isText(ask.answer)) return { line: ask.line ?? 'The build noted something; nothing waits for you.' };
  // A pack ask at level 3 that a delegation lowered to level 2 is answered by its recommendation.
  const lowered = level === 3 && isText(ask.topic) && levels?.[ask.topic]?.value === 2;
  if (lowered && isText(ask.recommend) && optionIds.has(ask.recommend)) {
    return { answer: { choice: ask.recommend }, line: `The build's question was answered as recommended, under your delegation for ${ask.topic}.`, level: 2 };
  }
  return { card: cardOf(ask, level), importance: importanceOf(ask, level) };
}

// The order cards come in (section 8.3): All stop or an incident, then level 4, then what holds up all work, then
// level 3, then the rest. Lower comes first.
function importanceOf(ask, level) {
  if (ask.kind === 'all-stop' || ask.kind === 'incident') return 0;
  if (level === 4) return 1;
  if (holdsAll(ask)) return 2;
  if (level === 3) return 3;
  return 4;
}

function cardOf(ask, level) {
  const context = isPlain(ask.context) ? ask.context : {};
  const what = isText(ask.reason) ? ask.reason : isText(context.reason) ? context.reason : isText(context.question) ? context.question : WHAT[ask.kind] ?? WHAT.question;
  const why = WHY[Math.max(3, level)];
  const pr = Number.isInteger(ask.setLine?.pr) ? ask.setLine.pr : Number(ask.setLine?.pr);
  const sha = ask.setLine?.head;
  const options = (ask.options ?? []).filter((o) => isText(o?.id) && isText(o?.label));
  if (ask.kind === 'approval' && Number.isInteger(pr) && pr > 0 && FULL_SHA.test(sha ?? '')) {
    const approve = options.find((o) => o.id === ask.recommend) ?? options.find((o) => /approve/i.test(o.id)) ?? options[0];
    return {
      approval: {
        pr, sha, level, what, why, preview: ask.preview ?? null,
        engine: { runId: ask.runId, ask: ask.id, approve: approve?.id ?? null, options: Object.fromEntries(options.map((o) => [o.label, o.id])) },
      },
    };
  }
  // The recommendation first; an ask with none recommends the first option, or stopping for one nobody recognised.
  const recommended = options.find((o) => o.id === ask.recommend) ?? options[0];
  const ordered = recommended ? [recommended, ...options.filter((o) => o !== recommended)] : [];
  return {
    question: {
      what, why, level,
      options: ordered.map((o) => ({ label: o.label, says: o.says ?? `The build goes on with "${o.label}".` })),
      recommendation: recommended?.label ?? null,
      preview: ask.preview ?? null,
      engine: { runId: ask.runId, ask: ask.id, options: Object.fromEntries(options.map((o) => [o.label, o.id])) },
    },
  };
}

// The calendar day of `at` (a Date or text), as text, on this computer's clock: the budget's day, the director's own.
export function dayOf(at) {
  const d = new Date(at);
  const two = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}`;
}

// Which waiting cards to show now. `cards` are [{ importance, ... }] waiting in the order they came; `shownToday` how
// many budgeted cards were shown today already. Importance 0 and 2 (All stop or an incident, and what holds up all
// work) ignore the budget; the rest fill it in order of importance.
export function cardBudget({ cards = [], cardsPerDay = 3, shownToday = 0 } = {}) {
  const ordered = cards.map((card, index) => ({ card, index })).sort((a, b) => (a.card.importance ?? 4) - (b.card.importance ?? 4) || a.index - b.index);
  const show = [];
  let room = Math.max(0, cardsPerDay - shownToday);
  let wait = 0;
  for (const { card } of ordered) {
    if (card.importance === 0 || card.importance === 2) show.push(card);
    else if (room > 0) {
      show.push(card);
      room -= 1;
    } else wait += 1;
  }
  return { show, wait };
}

// Approvals of visible work waiting together, as one card (Approve all, Show me, Suggest a change…, Not now), when the
// director has chosen to bundle them. Each approval is still signed for its own pull request and head.
export function bundleApprovals(cards = []) {
  const approvals = cards.filter((c) => isPlain(c?.card?.approval));
  if (approvals.length < 2) return cards;
  const rest = cards.filter((c) => !approvals.includes(c));
  const bundle = {
    importance: Math.min(...approvals.map((c) => c.importance ?? 3)),
    card: { bundle: approvals.map((c) => c.card.approval) },
  };
  return [bundle, ...rest];
}

// The engine answer for a label the director chose on a card: { choice } for an option, { words } for Suggest a
// change… with their words, or null for a label that answers nothing (Not now, Show me).
export function answerFor(engine, label, words) {
  if (!isPlain(engine)) return null;
  if (label === SUGGEST_LABEL) return isText(words) ? { ask: engine.ask, words: words.trim() } : null;
  const choice = engine.options?.[label];
  return isText(choice) ? { ask: engine.ask, choice } : null;
}
