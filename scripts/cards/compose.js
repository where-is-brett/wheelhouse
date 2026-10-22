// scripts/cards/compose.js
// Writes every question card the director sees from one input: its parts (the question, what it
// is, why it is the director's, what happens meanwhile, its options and its recommendation), the
// set line the prompt record signs against, and the reply code. The chat's text is built from the
// parts by `textOf`, in the order of design section 23.4, and the options carry the recommendation
// and what each means. The card's text and its set line come from the same target, so a card can't
// read as one decision and sign another.
// The front desk asks only what this returns (`cli.js card`), never a card it wrote itself. The
// baseline card is composed by the helper and comes to the front desk from `scripts/measures/cli.js`;
// a trust card is composed by the session start, which hands it to the front desk as it is, and
// uninstall's card by the helper, for setup's playbook to ask as it is.
import {
  approvalLine, confirmLine, LIFT_STOP, runbookLine, ciPushLine, approveWorkLine, answerLine, amendLine,
  liftIncidentLine, incidentFixLine, setupLine, confirmAllLine, baselineLine, trustLine, uninstallLine, isLineName, dayOf, replyCode, replyCodeLine, setLineOf, SET_LINES,
  RUNBOOK_TITLES, SETUP_TITLES, SETUP_LABEL, CONFIRM_ALL_LABEL, CORRECT_SOME_LABEL, BASELINE_LABEL, BASELINE_HEADER, TRUST_LABEL, UNINSTALL_LABEL, ID, LANES, QUESTION_ID,
} from '../state/card-lines.js';
import { CARD, CARD_KINDS, KEEP_AS_IS, PUT_OFF } from '../lib/front-desk.js';
import { SUGGEST, SHOW_ME, NOT_NOW, TO_KNOW_MORE, TO_CHANGE_IT, WHAT_CHANGED, SUGGEST_SAYS } from '../lib/calm-words.js';
import { CONFIRMABLE_KINDS } from '../state/events.js';
import { glossaryOf, termsIn } from '../frontdesk/glossary.js';
import { BUILD_QUESTION_OPTIONS } from '../protection/windows-builds.js';
import { baselineWording } from '../lib/measures-clicks.js';

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
  setup: 'Setup',
  'confirm-all': 'Rules found',
  baseline: BASELINE_HEADER,
  trust: 'Trust',
  uninstall: 'Uninstall',
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
  setup: SETUP_LABEL,
  'confirm-all': CONFIRM_ALL_LABEL,
  baseline: BASELINE_LABEL,
  trust: TRUST_LABEL,
  uninstall: UNINSTALL_LABEL,
});

// The kinds whose set line has no reply code (ruling R36): a setup step goes ahead only on the
// director's click on the card itself, never on a reply, so a code would make a shown record that
// is never spent. Setup's card of the rules found (confirm-all, ruling R35) is one too, and so is a
// trust card (ruling R80): another computer is trusted only by the click on the card itself; and so
// is uninstall's card (ruling R90), which goes ahead only on the click on the card itself.
export const NO_REPLY_CODE = Object.freeze(['setup', 'confirm-all', 'trust', 'uninstall']);

// The buttons a kind's card offers after its deciding label, in the order they are shown, where it
// isn't the usual Suggest a change…, Show me and Not now (design section 23.4). STOP is lifted or it
// isn't, and the kinds answered only in setup's or the session start's own chat take no change to
// suggest. The baseline card reads figures back, so there is nothing to show; a trust card has
// nothing to show, nor has uninstall's card, whose whole list `cli.js uninstall status` gives. The
// card of the rules found offers its second answer in place of Show me (ruling R35). Explain more
// is offered by none: the director asks why in the typed answer.
const OFFERED_AFTER = Object.freeze({
  'lift-stop': Object.freeze([SHOW_ME, NOT_NOW]),
  setup: Object.freeze([SHOW_ME, NOT_NOW]),
  'confirm-all': Object.freeze([CORRECT_SOME_LABEL, NOT_NOW]),
  baseline: Object.freeze([NOT_NOW]),
  trust: Object.freeze([NOT_NOW]),
  uninstall: Object.freeze([NOT_NOW]),
});
const USUAL_AFTER = Object.freeze([SUGGEST, SHOW_ME, NOT_NOW]);

// What an answer card says happens while the director decides.
export const MEANWHILE = 'that feature waits; the others carry on';
// The checks line of a level 4 question's card when the build didn't say what answering does to the checks (ruling F18).
export const CHECKS_UNSAID = 'The build didn\'t say. Ask me why and I\'ll find out before you answer.';

// A confirm card for a proposal offers Keep as is in place of Show me (ruling F48); learning.js
// holds the proposal back for TURNED_DOWN_DAYS after it.
export { KEEP_AS_IS };

// What the buttons that put a card off or steer it do, and what Keep as is does.
const PUT_OFF_SAYS = Object.freeze({
  [NOT_NOW]: 'Leave this waiting; nothing changes yet.',
  [SHOW_ME]: 'I show you what it looks like, then ask again.',
  [SUGGEST]: SUGGEST_SAYS,
  [KEEP_AS_IS]: 'Things stay as they are, and this isn\'t asked again for a while.',
});

// The question a kind's card asks when its input gives none (design section 23.3). A kind with no
// entry here asks its `what`: an answer, a product question and each of setup's kinds.
const ASKS = Object.freeze({
  approval: (t) => `Put pull request #${t.pr} live?`,
  confirm: () => 'Confirm this?',
  'lift-stop': () => 'Lift STOP?',
  'ci-push': () => 'Push this change to the checks?',
  runbook: (t) => `${RUNBOOK_TITLES[t.step]}?`,
  'approve-work': () => 'Approve this work as written?',
  amend: () => 'Change the approved work to this?',
  'lift-incident': () => 'End the incident?',
  'incident-fix': () => 'Merge this fix?',
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
// Whether a card's options are a build-command question's own: the design's labels, in order
// (design section 12.2), whatever words the card puts them in. Their Not now is a put-off button
// that records no answer, so the card stays waiting.
const buildOptions = (list) => list.length === BUILD_QUESTION_OPTIONS.length
  && list.every((o, i) => o.label === BUILD_QUESTION_OPTIONS[i].label);
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
  if (kind === 'setup') {
    if (!Number.isInteger(t.step) || !Object.hasOwn(SETUP_TITLES, t.step) || !HEX.test(t.hash)) {
      bad(`needs a setup step from 1 to ${Object.keys(SETUP_TITLES).length} and the hash of its list of changes`);
    }
    return setupLine(t.step, t.hash);
  }
  if (kind === 'confirm-all') {
    if (!isCount(t.count) || !HEX.test(t.hash)) bad('needs how many rules it lists and the hash of that list');
    return confirmAllLine(t.hash, t.count);
  }
  if (kind === 'baseline') {
    if (!HEX.test(t.hash)) bad('needs the hash of the figures it reads back');
    return baselineLine(t.hash);
  }
  if (kind === 'trust') {
    if (typeof t.computer !== 'string' || !/^[0-9a-f]{8}$/.test(t.computer) || dayOf(t.at) === null || typeof t.fingerprint !== 'string' || !/^[0-9a-f]{12}$/.test(t.fingerprint)) {
      bad('needs the other computer\'s id, when its key was added and the key\'s twelve-character fingerprint');
    }
    return trustLine(t.computer, t.at, t.fingerprint);
  }
  if (kind === 'uninstall') {
    if (!isLineName(t.project) || !HEX.test(t.hash)) bad('needs the project, on one line, and the hash of the list uninstall puts back');
    return uninstallLine(t.project, t.hash);
  }
  // incident-fix
  if (!slug(t.incident) || !isCount(t.pr)) bad('needs an incident id and a pull request number');
  return incidentFixLine(t.incident, t.pr);
}

// The first part must name what the set line names, for every kind that names something: the
// pull request (and the incident), the work, the incident, the runbook step's title, the branch,
// the ruling's words, setup's step, the computer a trust card trusts, the project uninstall removes
// Wheelhouse from. It names no other pull request or commit than the set line's (the project's own
// name aside, which may look like one).
// An answer card, a lift-STOP card, a baseline card and a product question name nothing more:
// a baseline card's first part is the figures themselves, which may hold any words or numbers.
// Returns what is wrong with `what` as a clause that follows "the first part", or null when it is
// right. The card check judges a card by this too, from the set line alone: with `abbreviated`,
// the target's commit is the twelve characters the set line holds, so a longer name for the same
// commit still counts as it.
export function whatProblem(kind, what, target, { abbreviated = false } = {}) {
  if (kind === 'question' || kind === 'baseline' || !isPlain(target)) return null;
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
  if (kind === 'setup') need = [new RegExp(`\\bstep ${target.step}(?![0-9])`, 'i').test(what), `step ${target.step}`];
  if (kind === 'confirm-all') need = [new RegExp(`(?<![0-9])${target.count} rules?\\b`, 'i').test(what), `how many rules it lists, ${target.count}`];
  if (kind === 'trust') need = [nameId(target.computer), `the computer ${target.computer}`];
  if (kind === 'uninstall') need = [nameId(target.project), `the project ${target.project}`];
  if (need !== null && !need[0]) return `must name ${need[1]}, as its set line does`;
  const commit = target.sha ?? target.hash;
  if (typeof commit !== 'string') return null;
  const scanned = kind === 'uninstall' ? what.split(String(target.project)).join(' ') : what;
  for (const token of scanned.match(/\b[0-9a-f]{7,64}\b/g) ?? []) {
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

// The buttons a card offers, each { label, says }, in the order they are shown (design section
// 23.4). `build` says the card answers a build-command question (one that names its `commands`). A
// confirm card for a proposal (its `target`) offers Keep as is in place of Show me. A question's
// own options come first, then Suggest a change… unless it has four of its own.
function offered(kind, given, { build = false, target } = {}) {
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
    const own = kind === 'answer' && build && buildOptions(list);
    for (const o of list) if (PUT_OFF.includes(o.label) && !own) fail(kind, 'options', `must not use ${o.label}, a button that puts a card off`);
    return [...list, ...(list.length < CARD.options ? [{ label: SUGGEST, says: PUT_OFF_SAYS[SUGGEST] }] : [])];
  }
  const deciding = DECIDING[kind];
  const proposal = kind === 'confirm' && isProposal(target?.event);
  const after = OFFERED_AFTER[kind] ?? USUAL_AFTER.map((label) => (proposal && label === SHOW_ME ? KEEP_AS_IS : label));
  const allowed = [deciding, ...after];
  for (const o of list) if (!allowed.includes(o.label)) fail(kind, 'options', `can't describe ${o.label}; the card offers ${allowed.join(', ')}`);
  for (const must of kind === 'confirm-all' ? [deciding, CORRECT_SOME_LABEL] : [deciding]) {
    if (!list.some((o) => o.label === must)) fail(kind, 'options', `must describe ${must}`);
  }
  return allowed.map((label) => ({ label, says: list.find((o) => o.label === label)?.says ?? PUT_OFF_SAYS[label] }));
}

// Whether a card's question has only its own options to offer, with a change left to the typed
// answer: an answer or a product question that offers no Suggest a change….
const typesChange = (kind, labels) => (kind === 'answer' || kind === 'question') && !labels.includes(SUGGEST);

// The chat's text from a card's parts, in the order of design section 23.4: the question; what it
// is (once, where the question is the same words); why it is the director's; what happens
// meanwhile; the checks line of a level 4 card; what changed on a revised card; the line that says
// more is there for the asking, or, for a question with four options of its own, that a change is
// typed; then the set line and the reply code, each on a line of its own. No part has a label.
export function textOf(parts) {
  const labels = parts.options.map((o) => o.label);
  return [
    parts.ask,
    ...(parts.what === parts.ask ? [] : [parts.what]),
    parts.why,
    parts.meanwhile,
    ...(parts.checks === undefined ? [] : [parts.checks]),
    ...(parts.changed === undefined ? [] : [`${WHAT_CHANGED} ${parts.changed}`]),
    typesChange(parts.kind, labels) ? TO_CHANGE_IT : TO_KNOW_MORE,
    ...(parts.line === null ? [] : [parts.line]),
    ...(parts.code === null ? [] : [replyCodeLine(parts.code)]),
  ].join('\n');
}

// Composes one card from its input. Returns { question, card }: `question` is one entry of
// AskUserQuestion's questions, `card` is the event data the state keeps. Throws, naming the
// part, when the input can't make a card the prompt record would read as the input says.
// `because` is a clause after "because" ("the checks passed"); a trailing full stop is dropped.
// `what` must name what the set line names (see sameThing), and so must the card's plain lines
// together. `ask` (optional) is the question as a heading, on one line; a kind with no `ask` asks
// the words ASKS gives, or its `what`. `size` (optional) is a few words such as "Small feature";
// `optional` (optional) is the whole minutes an optional card takes. `revises` (optional) is the id
// of the card a revised proposal replaces, and then `changed` says in one line what changed.
// `glossary` (optional) is the glossary whose terms found in the card's words become the card's
// concepts when `concepts` isn't given; it defaults to the starter's. `event` (optional) is the id of the record
// the card is made from, which the card keeps so it is made once: a card with no set line (a
// lineage hold's) is tied to its record by it, as an answer card is by its line.
export function composeCard(input) {
  const kind = input?.kind;
  if (!CARD_KINDS.includes(kind)) throw new Error('A card needs its kind to be one the front desk knows');
  const { level } = input;
  if (![1, 2, 3, 4].includes(level)) fail(kind, 'level', 'must be 1, 2, 3 or 4');
  // Removing Wheelhouse removes the gate, so uninstall's card is level 4 (ruling R90).
  if (kind === 'uninstall' && level !== 4) fail(kind, 'level', 'must be 4: it removes the checks that guard the project');
  const what = words(kind, 'what', input.what);
  const why = words(kind, 'why', input.why);
  const because = words(kind, 'because', input.because);
  const meanwhile = words(kind, 'meanwhile', input.meanwhile);
  const ask = input.ask === undefined ? undefined : words(kind, 'ask', input.ask);
  const size = input.size === undefined ? undefined : words(kind, 'size', input.size);
  if (input.optional !== undefined && !isCount(input.optional)) fail(kind, 'optional', 'must be whole minutes, from 1');
  if (input.revises !== undefined && !(typeof input.revises === 'string' && /^\S+$/.test(input.revises))) fail(kind, 'revises', 'must be the id of the card it replaces');
  if (input.revises === undefined && input.changed !== undefined) fail(kind, 'changed', 'belongs to a revised card only');
  const changed = input.revises === undefined ? undefined : words(kind, 'changed', input.changed);
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
  if (input.event !== undefined && !(typeof input.event === 'string' && /^\S+$/.test(input.event))) fail(kind, 'event', 'must be the id of the record the card is made from');

  const line = kind === 'question' ? null : lineFor(kind, input.target);
  sameThing(kind, what, input.target);
  const build = Array.isArray(input.commands) && input.commands.length > 0;
  const buttons = offered(kind, input.options, { build, target: input.target });
  if (!buttons.some((b) => b.label === recommend)) fail(kind, 'recommend', `must be one of the card's options: ${buttons.map((b) => b.label).join(', ')}`);

  const code = line === null || NO_REPLY_CODE.includes(kind) ? null : replyCode(line);
  const target = isPlain(input.target) ? input.target : {};
  const asked = ask ?? (Object.hasOwn(ASKS, kind) ? ASKS[kind](target) : what);
  const parts = {
    kind,
    header: HEADERS[kind],
    ask: asked,
    what,
    small: [size, why].filter(Boolean).join(' · '),
    recommendation: `${recommend}, because ${clause(because)}.`,
    options: buttons.map((b) => ({ label: b.label, says: b.says, recommended: b.label === recommend })),
    why,
    meanwhile,
    ...(checks === undefined ? {} : { checks }),
    ...(changed === undefined ? {} : { changed }),
    line,
    code,
    ...(input.optional === undefined ? {} : { optional: input.optional }),
    ...(input.revises === undefined ? {} : { revises: input.revises }),
  };
  // The card's plain lines name what the set line names between them, and no other pull request or commit.
  const plain = [asked, what, why, meanwhile, ...(checks === undefined ? [] : [checks]), ...(changed === undefined ? [] : [`${WHAT_CHANGED} ${changed}`])];
  const named = whatProblem(kind, plain.join(' '), input.target);
  if (named !== null) fail(kind, 'text', named);
  // What the director reads as explanation: the card's words, its options' meanings and its recommendation.
  const explained = [...plain, ...buttons.map((b) => b.says), parts.recommendation];
  const text = textOf(parts);
  if (text.length > CARD.chars) fail(kind, 'text', `would pass ${CARD.chars} characters (it is ${text.length})`);
  if (setLineOf(text) !== line) fail(kind, 'target', 'does not give a set line the prompt record reads');
  const descriptions = buttons.map((b) => (b.label === recommend ? `Recommended: ${bare(b.says)}, because ${clause(because)}.` : b.says));
  // The baseline card's own words belong to it alone: on another card they would read as the
  // private note's figures, and the card check and the prompt record would treat it as one.
  if (kind !== 'baseline' && baselineWording([text, ...descriptions].join('\n'))) fail(kind, 'text', 'must not use the baseline card\'s words');

  const question = {
    question: text,
    header: HEADERS[kind],
    options: buttons.map((b, i) => ({ label: b.label, description: descriptions[i] })),
    multiSelect: false,
  };
  const card = {
    question: text,
    header: question.header,
    options: buttons.map((b) => b.label),
    // What each button says, as AskUserQuestion shows it, so the card can be asked again as composed.
    descriptions,
    kind,
    level,
    line,
    code,
    // Every part of the card, so the pane draws them separately and the text can be built from them again (textOf).
    parts,
    ...(input.revises === undefined ? {} : { revises: input.revises }),
    // The option recommended, so the delegation review can tell a choice made as recommended.
    recommend,
    ...(input.importance === undefined ? {} : { importance: input.importance }),
    ...(topic === undefined ? {} : { topic }),
    concepts: [...(input.concepts ?? termsIn(explained.join('\n'), input.glossary ?? glossaryOf({})))],
    ...(input.event === undefined ? {} : { event: input.event }),
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
    // A build-command question's commands, so its own Not now is offered (see offered).
    ...(Array.isArray(data.commands) && data.commands.length > 0 ? { commands: data.commands } : {}),
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
