// scripts/cards/compose.js
// Writes every question card the director sees from one input: the five plain-language parts,
// the set line the prompt record signs against, and the reply code. The card's text and its
// set line come from the same target, so a card can't read as one decision and sign another.
// The front desk asks only what this returns (`cli.js card`), never a card it wrote itself.
import {
  approvalLine, confirmLine, LIFT_STOP, runbookLine, ciPushLine, approveWorkLine, answerLine, amendLine,
  liftIncidentLine, incidentFixLine, replyCode, replyCodeLine, setLineOf, SET_LINES, RUNBOOK_TITLES, ID, LANES, QUESTION_ID,
} from '../state/card-lines.js';
import { CARD, CARD_KINDS, PUT_OFF } from '../lib/front-desk.js';
import { CONFIRMABLE_KINDS } from '../state/events.js';
import { glossaryOf, termsIn } from '../frontdesk/glossary.js';

// The labels the five parts start with, in order, then the one for a level 4 card.
export const PART_LABELS = Object.freeze([
  'What this is:', "Why it's coming to you:", 'Options:', 'My recommendation:', 'While you decide:', 'What this does to the checks:',
]);

// The kind in plain words, at most CARD.header characters; the director reads these.
export const HEADERS = Object.freeze({
  approval: 'Approval',
  confirm: 'Confirm',
  'lift-stop': 'Lift STOP',
  'ci-push': 'Push checks',
  runbook: 'Emergency',
  'approve-work': 'Approve work',
  answer: 'Question',
  amend: 'Change work',
  'lift-incident': 'End incident',
  'incident-fix': 'Incident fix',
  question: 'Question',
});

// The label whose click decides a kind, as the prompt record accepts it. An answer card's
// deciding labels are its question's own options, and a product question has none.
export const DECIDING = Object.freeze({
  approval: 'Approve',
  confirm: 'Confirm',
  'lift-stop': 'Lift STOP',
  'ci-push': 'Push it',
  runbook: 'Do it',
  'approve-work': 'Approve',
  amend: 'Change it',
  'lift-incident': 'End it',
  'incident-fix': 'Merge the fix',
});

// What an answer card says happens while the director decides.
export const MEANWHILE = 'that feature waits; the others carry on';
// The checks line of a level 4 question's card when the build didn't say what answering does to the checks (ruling F18).
// A card with four options of its own has no Explain more button, so the line also says it can be typed.
export const CHECKS_UNSAID = 'The build didn\'t say. Choose or type Explain more and I\'ll find out before you answer.';

// The option a confirm card for a proposal offers in place of Show me (ruling F48): it decides
// the card, signs nothing, and holds the proposal back for a while (learning.js, TURNED_DOWN_DAYS).
export const KEEP_AS_IS = 'Keep as is';

// What the buttons that put a card off do, and what Keep as is does.
const PUT_OFF_SAYS = Object.freeze({
  'Not now': 'Leave this waiting; nothing changes yet.',
  'Explain more': 'I explain it in plainer words, with an everyday example, and ask again.',
  'Show me': 'I show you what it looks like, then ask again.',
  [KEEP_AS_IS]: 'Things stay as they are, and this isn\'t asked again for a while.',
});

// Whether a confirm card's event is a proposal Wheelhouse made, not something the director asked
// for: a setting or a level carrying `because`, its one-line reason (learning, the delegation review).
export const isProposal = (event) => isPlain(event) && (event.kind === 'setting' || event.kind === 'level')
  && typeof event.data?.because === 'string' && event.data.because.trim() !== '';

const HEX = /^[0-9a-f]{12,64}$/;
const BREAK = /[\r\n\v\f\u0085\u2028\u2029]/;
// The set lines without their line anchors: a part holding one anywhere is refused.
const SET_FRAGMENTS = SET_LINES.map((p) => new RegExp(p.source.replace(/^\^/, '').replace(/\$$/, '')));

const isPlain = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
const flat = (x) => (typeof x === 'string' ? x.replace(/\s+/g, ' ').trim() : x);
const isCount = (x) => Number.isInteger(x) && x >= 1;
const bare = (text) => text.replace(/[.!?]+$/, '');
// A reason read as a clause after "because": no closing full stop, and its first word in lower case unless it is a name or acronym.
const clause = (text) => bare(text).replace(/^([A-Z])(?=[a-z])/, (c) => c.toLowerCase());

function fail(kind, part, why) {
  throw new Error(`A ${kind} card ${why === undefined ? `needs its ${part}` : `${part} ${why}`}`);
}

// A part of the card's words: some text on one line that doesn't read as a set line.
function words(kind, part, value) {
  if (typeof value !== 'string' || value.trim() === '') fail(kind, part);
  const text = value.trim();
  if (BREAK.test(text)) fail(kind, part, 'must be on one line');
  if (SET_FRAGMENTS.some((p) => p.test(text))) fail(kind, part, 'must not hold a line the prompt record reads as a set line');
  return text;
}

// The set line a target gives, or a refusal naming what is wrong with the target.
function lineFor(kind, target) {
  const bad = (why) => fail(kind, 'target', why);
  const t = isPlain(target) ? target : null;
  if (kind === 'lift-stop') return LIFT_STOP;
  if (t === null) bad('is needed to give the set line');
  const slug = (x) => typeof x === 'string' && new RegExp(`^${ID}$`).test(x);
  if (kind === 'approval') {
    if (!isCount(t.pr) || !HEX.test(t.sha)) bad('needs a pull request number and a commit of at least twelve lowercase hex characters');
    return approvalLine(t.pr, t.sha);
  }
  if (kind === 'confirm') {
    const e = t.event;
    if (!isPlain(e) || !CONFIRMABLE_KINDS.includes(e.kind) || typeof e.id !== 'string' || e.id === '' || /\s/.test(e.id)
      || !isPlain(e.data) || typeof e.data.words !== 'string' || e.data.words === '' || BREAK.test(e.data.words)) {
      bad('needs a ruling, level or setting event with an id and its words');
    }
    return confirmLine(e);
  }
  if (kind === 'ci-push') {
    if (typeof t.branch !== 'string' || t.branch === '' || /\s/.test(t.branch) || !HEX.test(t.sha)) bad('needs a branch and a commit of at least twelve lowercase hex characters');
    return ciPushLine(t.branch, t.sha);
  }
  if (kind === 'runbook') {
    if (!Object.hasOwn(RUNBOOK_TITLES, t.step)) bad('needs a runbook step from 1 to 5');
    if (t.sha !== undefined && !HEX.test(t.sha)) bad('has a commit that is not at least twelve lowercase hex characters');
    if (t.step === 3 && t.sha === undefined) bad('needs the commit step 3 puts the product back to');
    return runbookLine(t.step, t.sha);
  }
  if (kind === 'approve-work') {
    if (!slug(t.work) || !LANES.split('|').includes(t.lane) || !HEX.test(t.hash)) bad('needs a work id, a lane and a document hash');
    return approveWorkLine(t.work, t.lane, t.hash, { shownFirst: t.shownFirst === true });
  }
  if (kind === 'answer') {
    if (typeof t.questionId !== 'string' || !new RegExp(`^${QUESTION_ID}$`).test(t.questionId)) bad('needs the question id, such as q-export-csv-1');
    return answerLine(t.questionId);
  }
  if (kind === 'amend') {
    if (!slug(t.work) || !HEX.test(t.hash)) bad('needs a work id and a document hash');
    return amendLine(t.work, t.hash);
  }
  if (kind === 'lift-incident') {
    if (!slug(t.incident)) bad('needs an incident id');
    return liftIncidentLine(t.incident);
  }
  // incident-fix
  if (!slug(t.incident) || !isCount(t.pr)) bad('needs an incident id and a pull request number');
  return incidentFixLine(t.incident, t.pr);
}

// The first part must name what the set line names, for every kind that names something: the
// pull request (and the incident), the work, the incident, the runbook step's title, the branch,
// the ruling's words. It names no other pull request or commit than the set line's. An answer
// card, a lift-STOP card and a product question name nothing more.
// Returns what is wrong with `what` as a clause that follows "the first part", or null when it is
// right. The card check judges a card by this too, from the set line alone: with `abbreviated`,
// the target's commit is the twelve characters the set line holds, so a longer name for the same
// commit still counts as it.
export function whatProblem(kind, what, target, { abbreviated = false } = {}) {
  if (kind === 'question' || !isPlain(target)) return null;
  const lower = what.replace(/\s+/g, ' ').toLowerCase();
  const names = (text) => lower.includes(String(text).replace(/\s+/g, ' ').toLowerCase());
  // An id or a branch is a whole word: "ci-fix" is not named by "ci-fix-2", but is by "ci-fix.".
  const nameId = (id) => new RegExp(`(?<![A-Za-z0-9._/-])${String(id).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![A-Za-z0-9_/-]|\\.[A-Za-z0-9])`, 'i').test(what);
  if (target.pr !== undefined) {
    const named = [...what.matchAll(/#(\d+)(?!\d)/g)].map((m) => Number(m[1]));
    if (!named.includes(target.pr) || named.some((n) => n !== target.pr)) {
      return `must name pull request #${target.pr}, and no other, as its set line does`;
    }
  }
  let need = null; // [whether the first part names it, what it is]
  if (kind === 'incident-fix' || kind === 'lift-incident') need = [nameId(target.incident), `incident ${target.incident}`];
  if (kind === 'approve-work' || kind === 'amend') need = [nameId(target.work), `the work ${target.work}`];
  if (kind === 'runbook') need = [names(RUNBOOK_TITLES[target.step]), `the step's title, "${RUNBOOK_TITLES[target.step]}"`];
  if (kind === 'ci-push') need = [nameId(target.branch), `the branch ${target.branch}`];
  if (kind === 'confirm') need = [names(target.event.data.words), `the words being confirmed, "${target.event.data.words}"`];
  if (need !== null && !need[0]) return `must name ${need[1]}, as its set line does`;
  const commit = target.sha ?? target.hash;
  if (typeof commit !== 'string') return null;
  for (const token of what.match(/\b[0-9a-f]{7,64}\b/g) ?? []) {
    const looksLikeOne = /[0-9]/.test(token) && (/[a-f]/.test(token) || token.length >= 12);
    const same = commit.startsWith(token) || (abbreviated && token.startsWith(commit));
    if (looksLikeOne && !same) return `names commit ${token}, not the commit its set line names`;
  }
  return null;
}

function sameThing(kind, what, target) {
  const why = whatProblem(kind, what, target);
  if (why !== null) fail(kind, 'what', why);
}

// The buttons a card offers, each { label, says }, in the order they are shown. A confirm card for
// a proposal offers Keep as is in place of Show me.
function offered(kind, given, target) {
  if (!Array.isArray(given) || given.length === 0) fail(kind, 'options');
  const seen = new Set();
  const list = given.map((o) => {
    if (!isPlain(o)) fail(kind, 'options', 'must each be a label and what it says');
    const label = words(kind, 'options', o.label);
    if (seen.has(label)) fail(kind, 'options', `names ${label} twice`);
    seen.add(label);
    // A put-off button may leave out what it says: the card then uses the usual words.
    const optional = (PUT_OFF.includes(label) || label === KEEP_AS_IS) && kind !== 'answer' && kind !== 'question';
    return { label, says: optional && o.says === undefined ? undefined : words(kind, 'options', o.says) };
  });
  if (kind === 'answer' || kind === 'question') {
    if (list.length > CARD.options) fail(kind, 'options', `must be at most ${CARD.options}: a question's own options are never dropped`);
    for (const o of list) if (PUT_OFF.includes(o.label)) fail(kind, 'options', `must not use ${o.label}, a button that puts a card off`);
    return [...list, ...(list.length < CARD.options ? [{ label: 'Explain more', says: PUT_OFF_SAYS['Explain more'] }] : [])];
  }
  const deciding = DECIDING[kind];
  const proposal = kind === 'confirm' && isProposal(target?.event);
  const allowed = [deciding, ...PUT_OFF.map((label) => (proposal && label === 'Show me' ? KEEP_AS_IS : label))];
  for (const o of list) if (!allowed.includes(o.label)) fail(kind, 'options', `can't describe ${o.label}; the card offers ${allowed.join(', ')}`);
  if (!list.some((o) => o.label === deciding)) fail(kind, 'options', `must describe ${deciding}`);
  return allowed.map((label) => ({ label, says: list.find((o) => o.label === label)?.says ?? PUT_OFF_SAYS[label] }));
}

// Composes one card from its input. Returns { question, card }: `question` is one entry of
// AskUserQuestion's questions, `card` is the event data the state keeps. Throws, naming the
// part, when the input can't make a card the prompt record would read as the input says.
// `because` is a clause after "because" ("the checks passed"); a trailing full stop is dropped.
// `what` must name what the set line names (see sameThing). `glossary` (optional) is the glossary
// whose terms found in the five parts and the checks line become the card's concepts when
// `concepts` isn't given; it defaults to the starter's.
export function composeCard(input) {
  const kind = input?.kind;
  if (!CARD_KINDS.includes(kind)) throw new Error('A card needs its kind to be one the front desk knows');
  const { level } = input;
  if (![1, 2, 3, 4].includes(level)) fail(kind, 'level', 'must be 1, 2, 3 or 4');
  const what = words(kind, 'what', input.what);
  const why = words(kind, 'why', input.why);
  const because = words(kind, 'because', input.because);
  const meanwhile = words(kind, 'meanwhile', input.meanwhile);
  const recommend = words(kind, 'recommend', input.recommend);
  let checks;
  if (level === 4) checks = words(kind, 'checks', input.checks);
  else if (input.checks !== undefined) fail(kind, 'checks', 'belongs to a level 4 card only');
  if (input.importance !== undefined && !Number.isFinite(input.importance)) fail(kind, 'importance', 'must be a number');
  const topic = input.topic === undefined ? undefined : words(kind, 'topic', input.topic);
  if (input.concepts !== undefined && !(Array.isArray(input.concepts) && input.concepts.every((c) => typeof c === 'string' && c !== ''))) {
    fail(kind, 'concepts', 'must be a list of terms');
  }
  if (kind === 'question' && input.target !== undefined) fail(kind, 'target', 'is not needed: a product question has no set line');

  const line = kind === 'question' ? null : lineFor(kind, input.target);
  sameThing(kind, what, input.target);
  const buttons = offered(kind, input.options, input.target);
  if (!buttons.some((b) => b.label === recommend)) fail(kind, 'recommend', `must be one of the card's options: ${buttons.map((b) => b.label).join(', ')}`);

  const code = line === null ? null : replyCode(line);
  // What the director reads as explanation: the five parts and the checks line, not the set line or the code.
  const explained = [
    `${PART_LABELS[0]} ${what}`,
    `${PART_LABELS[1]} ${why}`,
    `${PART_LABELS[2]} ${buttons.map((b) => `${b.label}: ${bare(b.says)}`).join('; ')}`,
    `${PART_LABELS[3]} ${recommend}, because ${clause(because)}.`,
    `${PART_LABELS[4]} ${meanwhile}`,
    ...(checks === undefined ? [] : [`${PART_LABELS[5]} ${checks}`]),
  ];
  const text = [...explained, ...(line === null ? [] : [line, replyCodeLine(code)])].join('\n');
  if (text.length > CARD.chars) fail(kind, 'text', `would pass ${CARD.chars} characters (it is ${text.length})`);
  if (setLineOf(text) !== line) fail(kind, 'target', 'does not give a set line the prompt record reads');

  const question = {
    question: text,
    header: HEADERS[kind],
    options: buttons.map((b) => ({ label: b.label, description: b.label === recommend ? `Recommended: ${b.says}` : b.says })),
    multiSelect: false,
  };
  const card = {
    question: text,
    header: question.header,
    options: buttons.map((b) => b.label),
    // What each button says, as AskUserQuestion shows it, so the card can be asked again as composed.
    descriptions: question.options.map((o) => o.description),
    kind,
    level,
    line,
    code,
    // The option recommended, so the delegation review can tell a choice made as recommended.
    recommend,
    ...(input.importance === undefined ? {} : { importance: input.importance }),
    ...(topic === undefined ? {} : { topic }),
    concepts: [...(input.concepts ?? termsIn(explained.join('\n'), input.glossary ?? glossaryOf({})))],
  };
  return { question, card };
}

// The input for the answer card to a question the build recorded, `data` as its question event
// holds it: its words, its own options with what each says, and its own recommendation (ruling
// F10). `work` names the work, by its title or its id. A level 4 question's card says what
// answering does to the checks, in the question's own words, or that the build didn't say (ruling F18).
export function answerInput(data, work) {
  if (!isPlain(data) || !Array.isArray(data.options)) throw new Error('its record can\'t be read');
  return {
    kind: 'answer',
    level: data.level,
    what: flat(data.what),
    why: flat(data.why),
    options: data.options.map((o) => ({ label: o?.label, says: flat(o?.says) || o?.label })),
    recommend: data.recommendation,
    because: `the session building ${work} recommends it`,
    meanwhile: MEANWHILE,
    ...(data.level === 4 ? { checks: flat(data.checks) || CHECKS_UNSAID } : {}),
    target: { questionId: data.id },
  };
}

// Why no answer card could be made of a question from the build, as the composer refuses it, or
// null when one can. The card is judged naming the work by its id, as the front desk names it when
// the work's title won't fit, so the build's ask commands refuse what no card could carry.
export function questionProblem(data) {
  try {
    composeCard(answerInput(data, data?.work));
    return null;
  } catch (error) {
    return error.message;
  }
}
