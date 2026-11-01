// scripts/delegation/offer.js
// The one click (delegated decisions design, section 11.1). After an answer that earns it, one line offers to keep it as
// a rule: a like question was answered the same way before, or the answer left the recommendation. A script finds the
// pattern and composes the rule, and nothing changes until the director's signed click. It is offered rarely: at most
// OFFER_SITTING a sitting, and a declined offer stays quiet as a learnt proposal does.
import { composeRule } from './composer.js';
import { OFFER_SITTING, RULE_WORDS_MOST, SITTING_GAP_HOURS } from './limits.js';
import { alike, normaliseWords } from './words.js';
import { turnedDown } from '../frontdesk/learning.js';
import { answerLine, confirmWords } from '../state/card-lines.js';
import { SUGGEST } from '../lib/calm-words.js';

const HOUR_MS = 60 * 60 * 1000;
const BREAK = /[\r\n\v\f\u0085\u2028\u2029]/;
const CONFIRM_RULE = /^Confirm rule (\S+): "/;

const isPlain = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
const list = (x) => (Array.isArray(x) ? x : []);
const ms = (iso) => Date.parse(iso);
const instant = (now) => new Date(typeof now === 'function' ? now() : now ?? Date.now()).getTime();
const questionsOf = (views) => Object.entries(isPlain(views?.questions) ? views.questions : {});

// The director's words on a question's card, typed with Suggest a change…, with when: the latest, or null.
function typedOn(outcomes, id) {
  const line = answerLine(id);
  const typed = outcomes.filter(({ card }) => card.data?.line === line).flatMap(({ answers }) => answers)
    .filter((a) => a.data?.label === SUGGEST && typeof a.data?.text === 'string' && a.data.text.trim() !== '')
    .sort((a, b) => ms(a.at) - ms(b.at));
  return typed.at(-1) ?? null;
}

// When this sitting began: the first click of the run of clicks up to `now` with no gap over SITTING_GAP_HOURS. A sitting
// is the director's time at the desk, which no record names, so it is read from the clicks themselves.
export function sittingSince({ views, outcomes, now }) {
  const nowMs = instant(now);
  const clicks = [...outcomes.flatMap(({ answers }) => answers.map((a) => a.at)), ...questionsOf(views).map(([, q]) => q?.answer?.at)]
    .map(ms).filter((t) => Number.isFinite(t) && t <= nowMs).sort((a, b) => b - a);
  let since = nowMs;
  for (const click of clicks) {
    if (since - click > SITTING_GAP_HOURS * HOUR_MS) break;
    since = click;
  }
  return new Date(since).toISOString();
}

// Why an answer earns an offer: 'typed' or 'left' where it left the recommendation, 'like' where a like question on any
// piece was answered the same way before, or null. `views` gives the questions.
function earnedBy({ id, question, answer, views }) {
  if (answer.words !== undefined) return 'typed';
  if (answer.label !== question.recommendation) return 'left';
  const same = questionsOf(views).some(([other, q]) => other !== id && q?.answer?.at < answer.at && q.answer.changed !== true
    && alike(q.question?.data, question) && normaliseWords(q.answer.label) === normaliseWords(answer.label));
  return same ? 'like' : null;
}

// answersToOffer({ views, outcomes, sitting }) -> [{ id, work, question, answer, why, at }], the newest first: this
// sitting's answers that earn an offer. `answer` is { label } clicked or { words } typed. A joiner's answer is its lead's,
// a blind card's answer stays out as it does of what is learnt, and a build command's grant is the click on its own card.
export function answersToOffer({ views, outcomes, sitting }) {
  const blind = new Set(outcomes.filter(({ card }) => card.data?.blind === true).map(({ card }) => card.data.line));
  const out = [];
  for (const [id, q] of questionsOf(views)) {
    const question = q?.question?.data;
    if (!isPlain(question) || question.joins !== undefined || q.joins !== undefined || question.commands !== undefined) continue;
    if (typeof question.key !== 'string' || q.answer?.changed === true || blind.has(answerLine(id))) continue;
    const typed = typedOn(outcomes, id);
    const clicked = typeof q.answer?.label === 'string' ? q.answer : null;
    const words = typed !== null && (clicked === null || ms(typed.at) >= ms(clicked.at));
    const answer = words ? { words: typed.data.text.trim() } : clicked === null ? null : { label: clicked.label };
    const at = words ? typed.at : clicked?.at;
    if (answer === null || ms(at) < ms(sitting)) continue;
    const why = earnedBy({ id, question, answer: { ...answer, at }, views });
    if (why !== null) out.push({ id, work: question.work, question, answer, why, at });
  }
  return out.sort((a, b) => ms(b.at) - ms(a.at));
}

// Whether two rules keep the same answer, whatever scope each was composed with: a decline is of the answer, so a piece
// with other paths doesn't bring it back.
const sameAnswer = (a, b) => JSON.stringify([a.words, a.literal]) === JSON.stringify([b.words, b.literal]);

// Whether an offer of `rule` is held back: one like it still waits on its card, or was turned down in the last while.
function heldBack({ events, outcomes, rule, nowMs }) {
  const offers = new Map(events.filter((e) => e.kind === 'rule').map((e) => [e.id, e]));
  return outcomes.some(({ card, answers, decided }) => {
    const offer = offers.get(CONFIRM_RULE.exec(card.data?.line ?? '')?.[1]);
    return offer !== undefined && sameAnswer(offer.data, rule) && (decided === null || turnedDown(answers, nowMs));
  });
}

// offerDue({ events, answer, sitting, now, views, outcomes, facts, project }) -> rule | null. `answer` is what
// answersToOffer gave, `sitting` when this sitting began and `facts` the change's. Null where the composer refuses, which
// covers level 4, where this sitting has had its offer, where the rule is in force or held back, and where its scope is
// too wide for one line to show.
export function offerDue({ events, answer, sitting, now = () => new Date(), views, outcomes, facts, project }) {
  const all = list(events).filter(isPlain);
  if (all.filter((e) => e.kind === 'rule' && ms(e.at) >= ms(sitting)).length >= OFFER_SITTING) return null;
  const work = views?.work?.[answer?.work]?.work?.data;
  const rule = composeRule({
    answer: answer?.answer, card: { kind: 'question', level: answer?.question?.level, options: answer?.question?.options }, facts,
    lane: work?.lane, project, workLevel: work?.level, now: () => new Date(instant(now)),
  });
  if (rule === null || Object.hasOwn(isPlain(views?.rules) ? views.rules : {}, rule.id)) return null;
  const reading = confirmWords({ kind: 'rule', data: rule });
  if (reading.length > RULE_WORDS_MOST || BREAK.test(reading)) return null;
  return heldBack({ events: all, outcomes, rule, nowMs: instant(now) }) ? null : rule;
}
