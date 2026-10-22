// scripts/state/events.js
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { computerId, stateDir } from '../lib/paths.js';
import { sign } from './signing.js';
import { scanContent } from './secret-scan.js';
import { canonicalJson } from '../lib/canonical.js';
import { git } from './git.js';
import { STATE_BRANCH } from './clone.js';
import { CODE_ALPHABET, SETUP_TITLES, SETUP_LABEL, CONFIRM_ALL_LABEL, BASELINE_LABEL, baselineLine, TRUST_LABEL, trustLine, UNINSTALL_LABEL, uninstallLine, isLineName } from './card-lines.js';
import { carriesFigures, CARRIES_BASELINE } from '../lib/measures-clicks.js';
import { LANES, FEATURE_STEPS, PAUSED_FOR, REPORT_OUTCOMES, SLUG, HASH } from '../lib/build-loop.js';
import { CARD, CARD_KINDS, PUT_OFF } from '../lib/front-desk.js';
import { SETUP_QUESTION_ID } from '../lib/setup-clicks.js';

export const PLAIN_KINDS = [
  'request', 'ruling', 'level', 'glossary', 'idea', 'rejection', 'card', 'card-answer',
  'setting', 'dispatch', 'merge', 'note', 'blocker', 'risk', 'decision',
  'work', 'feature', 'question', 'report', 'incident', 'amendment', 'reversal', 'asked', 'gate-asks',
  'lineage-hold',
];
export const PROTECTED_KINDS = ['confirmation', 'approval', 'review', 'action', 'shown'];
const KINDS = new Set([...PLAIN_KINDS, ...PROTECTED_KINDS]);
const MAX_RETRIES = 3;

const ACTIONS = ['lift-stop', 'runbook', 'ci-push', 'approve-work', 'answer', 'amend', 'lift-incident', 'incident-fix', 'setup', 'setup-answer', 'confirm-all', 'baseline', 'trust', 'uninstall'];
// The fields each action carries beyond the card's question and the label clicked.
const ACTION_OWN = {
  'lift-stop': [],
  runbook: ['step', 'sha'],
  'ci-push': ['branch', 'sha'],
  'approve-work': ['work', 'lane', 'hash', 'shownFirst'],
  answer: ['questionId', 'questionHash'],
  amend: ['work', 'hash'],
  'lift-incident': ['incident'],
  'incident-fix': ['incident', 'pr'],
  // A setup step's click: the run the card was shown for (so a click on one folder's card can't
  // stand for another's), the step and the full SHA-256 of the list of changes its card showed.
  setup: ['runId', 'step', 'hash'],
  // The director's answer to a question a setup step asked (ruling R30): the run and step it was
  // asked for, the question's id within the step, and the option clicked as `label` or, on a card
  // that takes one, the text typed as `text`; the other is null.
  'setup-answer': ['runId', 'step', 'questionId', 'text'],
  // The director's Confirm all on setup's card of the rules found in a project (ruling R35): the
  // full hash of the list the card's line names, and the ids of the rulings the click recorded from
  // it, one per rule listed, each confirmed by its own confirmation.
  'confirm-all': ['hash', 'ids'],
  // The baseline card's click: the full hash of the figures it read back. Its question is the
  // card's set line alone, so the click carries no figure. It is kept in
  // <wheelhouseHome()>/measures/clicks/ and never written to the state (writeEvent refuses it).
  baseline: ['hash'],
  // The director's Trust it on a trust card (ruling R80): the other computer's id, when its key was
  // added to the profile, the key's fingerprint and its full SHA-256 (ruling R107). Its question is
  // the card's set line alone. It is kept in <wheelhouseHome()>/trust/ and never written to the
  // state (writeEvent refuses it).
  trust: ['computer', 'at', 'fingerprint', 'keyHash'],
  // The director's Remove it on uninstall's card (ruling R90): the project its line names (the
  // project's slug, or the folder's own name when none is registered there) and the full SHA-256 of
  // the list uninstall puts back. Its question is the card's set line alone. It is kept in
  // <wheelhouseHome()>/setup/clicks/, as a setup click is, where the helper reads it.
  uninstall: ['project', 'hash'],
};
const ACTION_KEYS = ['action', 'question', 'label', ...new Set(Object.values(ACTION_OWN).flat())];
// Labels that ask for more, put the card off or hand the front desk the director's own words: a click on one is never an answer.
const NOT_AN_ANSWER = PUT_OFF;

const isSlug = (x) => typeof x === 'string' && SLUG.test(x);
const isText = (x) => typeof x === 'string' && x !== '';
const isPlain = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);

// What a click that sets something going must carry (design section 9).
function checkAction(data) {
  const bad = (why) => { throw new Error(`An action event ${why}`); };
  if (!data || typeof data !== 'object' || Array.isArray(data)) bad('needs data');
  if (Object.keys(data).some((k) => !ACTION_KEYS.includes(k))) bad('has a field it should not');
  if (!ACTIONS.includes(data.action)) bad('names an action Wheelhouse does not know');
  // A setup answer typed in has no label: its own check below asks for one of the two.
  const labelled = typeof data.label === 'string' || (data.action === 'setup-answer' && data.label === null);
  if (typeof data.question !== 'string' || !labelled) bad('needs the question and the label');
  // A field that belongs to another action is refused here, before the action's own checks.
  const own = ACTION_OWN[data.action];
  if (Object.keys(data).some((k) => !['action', 'question', 'label'].includes(k) && !own.includes(k))) {
    // The runbook's older message about a branch stays what it was.
    if (!(data.action === 'runbook' && data.branch !== undefined)) bad('carries a field that belongs to another action');
  }
  if (data.action === 'runbook') {
    if (!Number.isInteger(data.step) || data.step < 1 || data.step > 5) bad('needs a runbook step from 1 to 5');
    if (data.branch !== undefined) bad('has a branch it should not');
    if (data.sha !== undefined && !/^[0-9a-f]{12}$/.test(data.sha)) bad('has a commit that is not twelve hex characters');
    if (data.step === 3 && data.sha === undefined) bad('needs the commit for step 3');
  } else if (data.action === 'ci-push') {
    if (typeof data.branch !== 'string' || data.branch === '') bad('needs a branch');
    if (typeof data.sha !== 'string' || !/^[0-9a-f]{40}$/.test(data.sha)) bad('needs the full commit');
    if (data.step !== undefined) bad('has a step it should not');
  } else if (data.action === 'approve-work') {
    if (!isSlug(data.work)) bad('needs the work, named by a short slug');
    if (!LANES.includes(data.lane)) bad('needs the work\'s lane');
    if (typeof data.hash !== 'string' || !HASH.test(data.hash)) bad('needs the hash of the document approved');
    if (typeof data.shownFirst !== 'boolean') bad('needs to say whether the director is to see it before it merges');
  } else if (data.action === 'answer') {
    if (typeof data.questionId !== 'string' || !questionIdOf(data.questionId)) bad('needs the question it answers');
    if (typeof data.questionHash !== 'string' || !HASH.test(data.questionHash)) bad('needs the hash of the question it answers');
    if (NOT_AN_ANSWER.includes(data.label)) bad('has a label that is not an answer');
  } else if (data.action === 'amend') {
    if (!isSlug(data.work)) bad('needs the work, named by a short slug');
    if (typeof data.hash !== 'string' || !HASH.test(data.hash)) bad('needs the hash of the change');
  } else if (data.action === 'lift-incident') {
    if (!isSlug(data.incident)) bad('needs the incident, named by a short slug');
  } else if (data.action === 'incident-fix') {
    if (!isSlug(data.incident)) bad('needs the incident, named by a short slug');
    if (!Number.isInteger(data.pr) || data.pr < 1) bad('needs the pull request number');
  } else if (data.action === 'setup') {
    if (typeof data.runId !== 'string' || !/^run-[0-9a-f]{10}$/.test(data.runId)) bad('needs the setup run its card was shown for');
    if (!Object.hasOwn(SETUP_TITLES, data.step) || !Number.isInteger(data.step)) bad(`needs a setup step from 1 to ${Object.keys(SETUP_TITLES).length}`);
    if (typeof data.hash !== 'string' || !/^[0-9a-f]{64}$/.test(data.hash)) bad('needs the full hash of the list of changes its card showed');
    if (data.label !== SETUP_LABEL) bad(`needs the ${SETUP_LABEL} label`);
  } else if (data.action === 'setup-answer') {
    if (typeof data.runId !== 'string' || !/^run-[0-9a-f]{10}$/.test(data.runId)) bad('needs the setup run its card was asked for');
    if (!Object.hasOwn(SETUP_TITLES, data.step) || !Number.isInteger(data.step)) bad(`needs a setup step from 1 to ${Object.keys(SETUP_TITLES).length}`);
    if (typeof data.questionId !== 'string' || !SETUP_QUESTION_ID.test(data.questionId)) bad('needs the id of the question it answers');
    const given = (x) => typeof x === 'string' && x !== '';
    const one = (given(data.label) && data.text === null) || (data.label === null && given(data.text));
    if (!one) bad('needs a label or a typed text, one of them, with the other null');
    if (NOT_AN_ANSWER.includes(data.label)) bad('has a label that is not an answer');
  } else if (data.action === 'confirm-all') {
    if (typeof data.hash !== 'string' || !/^[0-9a-f]{64}$/.test(data.hash)) bad('needs the full hash of the list of rules its card showed');
    if (!Array.isArray(data.ids) || data.ids.length === 0 || !data.ids.every(isText) || new Set(data.ids).size !== data.ids.length) {
      bad('needs the ids of the rulings it confirmed, each once');
    }
    if (data.label !== CONFIRM_ALL_LABEL) bad(`needs the ${CONFIRM_ALL_LABEL} label`);
  } else if (data.action === 'baseline') {
    if (typeof data.hash !== 'string' || !/^[0-9a-f]{64}$/.test(data.hash)) bad('needs the full hash of the figures its card read back');
    if (data.label !== BASELINE_LABEL) bad(`needs the ${BASELINE_LABEL} label`);
    if (data.question !== baselineLine(data.hash)) bad('carries only the baseline card\'s set line as its question');
  } else if (data.action === 'trust') {
    if (typeof data.computer !== 'string' || !/^[0-9a-f]{8}$/.test(data.computer)) bad('needs the id of the computer it trusts');
    if (typeof data.at !== 'string' || Number.isNaN(Date.parse(data.at))) bad('needs when that computer\'s key was added');
    if (typeof data.fingerprint !== 'string' || !/^[0-9a-f]{12}$/.test(data.fingerprint)) bad('needs the fingerprint of the key it trusts');
    if (typeof data.keyHash !== 'string' || !/^[0-9a-f]{64}$/.test(data.keyHash) || !data.keyHash.startsWith(data.fingerprint)) {
      bad('needs the full hash of the key it trusts, which its fingerprint starts');
    }
    if (data.label !== TRUST_LABEL) bad(`needs the ${TRUST_LABEL} label`);
    if (data.question !== trustLine(data.computer, data.at, data.fingerprint)) bad('carries only the trust card\'s set line as its question');
  } else if (data.action === 'uninstall') {
    if (!isLineName(data.project)) bad('needs the project it removes Wheelhouse from');
    if (typeof data.hash !== 'string' || !/^[0-9a-f]{64}$/.test(data.hash)) bad('needs the full hash of the list its card showed');
    if (data.label !== UNINSTALL_LABEL) bad(`needs the ${UNINSTALL_LABEL} label`);
    if (data.question !== uninstallLine(data.project, data.hash)) bad('carries only uninstall\'s card\'s set line as its question');
  } else if (data.step !== undefined || data.branch !== undefined || data.sha !== undefined) {
    bad('carries no step, branch or commit');
  }
}

// The work a question id names (`q-<work>-<n>`), or null when it is not one.
function questionIdOf(id) {
  const m = /^q-([a-z0-9-]+)-([0-9]+)$/.exec(id);
  return m && isSlug(m[1]) ? { work: m[1], n: Number(m[2]) } : null;
}

// What the build loop's plain records must carry. Each guards the shape; what the
// records mean is read from them by the views and by the foreman.
const PLAIN_SHAPES = {
  work: { must: ['id', 'title', 'lane', 'visible', 'dependsOn'], may: ['doc', 'place', 'parent'] },
  feature: { must: ['work', 'step'], may: ['worktree', 'branch', 'session', 'plan', 'files', 'brief', 'slice', 'pausedFor'] },
  // `checks`: what answering it does to the checks, one line, for a level 4 question's card.
  question: { must: ['id', 'work', 'what', 'why', 'options', 'recommendation', 'level'], may: ['commands', 'checks'] },
  report: { must: ['work', 'outcome', 'summary', 'rulings'], may: ['pr', 'provenance'] },
  incident: { must: ['id', 'what'], may: [] },
  amendment: { must: ['work', 'change', 'hash'], may: [] },
  // `event`: the id of the record a card without a set line was made from (a lineage hold), so it is made once.
  // `parts`: the card's parts as the composer gives them; `revises`: the id of the card a revised proposal replaces.
  card: { must: ['question', 'header', 'options', 'kind', 'level'], may: ['descriptions', 'line', 'code', 'recommend', 'importance', 'topic', 'concepts', 'event', 'parts', 'revises'] },
  // The director undid something decided at level 2.
  reversal: { must: ['topic', 'what'], may: ['of'] },
  // The cards a visit handed out, by their card events' ids, so a card shown and dismissed is not offered again.
  asked: { must: ['cards'], may: [] },
  // The click the merge gate waits for (ruling R117): the director's approval of a pull request's
  // head, or their CI push of the update merge `sha` to `branch`, made from the head `from` when the
  // host gave it (ruling F78), so a pushed update can be told from one not yet pushed. Recorded by
  // the foreman's merge.
  'gate-asks': { must: ['work', 'pr', 'ask', 'sha'], may: ['branch', 'from'] },
  // A session start held the project's edits and commands because the installed upstream skills
  // differ from Wheelhouse's manifest (ruling R146): when, and which upstreams and paths. An
  // upstream of null is the manifest itself, which could not be read. The front desk's card.
  'lineage-hold': { must: ['at', 'mismatches'], may: [] },
};
const UPSTREAM_NAME = /^[a-z0-9-]{1,64}$/;
const GATE_ASKS = ['approval', 'ci-push'];

function checkPlain(kind, data) {
  const bad = (why) => { throw new Error(`A ${kind} event ${why}`); };
  if (!isPlain(data)) bad('needs data');
  const { must, may } = PLAIN_SHAPES[kind];
  if (Object.keys(data).some((k) => !must.includes(k) && !may.includes(k))) bad('has a field it should not');
  for (const k of must) if (data[k] === undefined) bad(`needs its ${k}`);
  const text = (k) => { if (!isText(data[k])) bad(`needs ${k} to be text`); };
  const optionalText = (k) => { if (data[k] !== undefined && !isText(data[k])) bad(`has a ${k} that is not text`); };
  const slug = (k) => { if (!isSlug(data[k])) bad(`needs ${k} to be a short slug (lower-case letters, digits and hyphens, at most 40)`); };
  const pr = () => { if (data.pr !== undefined && (!Number.isInteger(data.pr) || data.pr < 1)) bad('has a pull request number that is not one'); };
  if (kind === 'work') {
    slug('id');
    text('title');
    if (!LANES.includes(data.lane)) bad('needs its lane to be quick, small, feature or bug');
    if (typeof data.visible !== 'boolean') bad('needs visible to be true or false');
    if (!Array.isArray(data.dependsOn) || !data.dependsOn.every(isSlug)) bad('needs dependsOn to be a list of work ids');
    if (data.doc !== undefined && !(isPlain(data.doc) && Object.keys(data.doc).length === 2 && isText(data.doc.path) && typeof data.doc.hash === 'string' && HASH.test(data.doc.hash))) {
      bad('has a doc that is not a path and a hash');
    }
    if (data.place !== undefined && !Number.isFinite(data.place)) bad('has a place that is not a number');
    if (data.parent !== undefined) slug('parent');
  } else if (kind === 'feature') {
    slug('work');
    if (!FEATURE_STEPS.includes(data.step)) bad('needs its step to be one the build loop knows');
    for (const k of ['worktree', 'branch', 'session', 'plan', 'brief']) optionalText(k);
    if (data.files !== undefined && !(Array.isArray(data.files) && data.files.every(isText))) bad('has files that are not a list of paths');
    if (data.pausedFor !== undefined && !(data.step === 'paused' && PAUSED_FOR.includes(data.pausedFor))) bad('has a pausedFor that is not why a paused feature waits');
    if (data.slice !== undefined) {
      const s = data.slice;
      if (!(isPlain(s) && Object.keys(s).length === 2 && Number.isInteger(s.n) && Number.isInteger(s.m) && s.n >= 1 && s.n <= s.m)) bad('has a slice that is not n of m');
    }
  } else if (kind === 'question') {
    slug('work');
    const named = typeof data.id === 'string' ? questionIdOf(data.id) : null;
    if (!named || named.work !== data.work) bad('needs its id to be q-<work>-<n>');
    for (const k of ['what', 'why', 'recommendation']) text(k);
    const options = data.options;
    if (!Array.isArray(options) || options.length === 0 || !options.every((o) => isPlain(o) && Object.keys(o).length === 2 && isText(o.label) && typeof o.says === 'string')) {
      bad('needs options, each with a label and what it says');
    }
    if (![1, 2, 3, 4].includes(data.level)) bad('needs its level to be 1, 2, 3 or 4');
    // A build-command question names the commands it asks for.
    if (data.commands !== undefined && !(Array.isArray(data.commands) && data.commands.length > 0 && data.commands.every(isText))) {
      bad('has commands that are not a list of commands');
    }
    if (data.checks !== undefined && (!isText(data.checks) || /[\r\n\v\f\u0085\u2028\u2029]/.test(data.checks))) bad('has checks that are not one line of text');
  } else if (kind === 'report') {
    slug('work');
    if (!REPORT_OUTCOMES.includes(data.outcome)) bad('needs its outcome to be merged, closed or blocked');
    pr();
    text('summary');
    if (!Array.isArray(data.rulings) || !data.rulings.every((x) => typeof x === 'string')) bad('needs its rulings to be a list of text');
    if (data.provenance !== undefined && !isPlain(data.provenance)) bad('has a provenance that is not an object');
  } else if (kind === 'incident') {
    slug('id');
    text('what');
  } else if (kind === 'amendment') {
    slug('work');
    text('change');
    if (typeof data.hash !== 'string' || !HASH.test(data.hash)) bad('needs the hash of the changed document');
  } else if (kind === 'card') {
    // The question and its header as AskUserQuestion takes them; composing keeps them within CARD's limits.
    text('question');
    text('header');
    if (!CARD_KINDS.includes(data.kind)) bad('needs its kind to be one the front desk knows');
    if (!Array.isArray(data.options) || data.options.length < 2 || data.options.length > CARD.options || !data.options.every(isText)) {
      bad(`needs two to ${CARD.options} options, each text`);
    }
    if (![1, 2, 3, 4].includes(data.level)) bad('needs its level to be 1, 2, 3 or 4');
    if (data.descriptions !== undefined && !(Array.isArray(data.descriptions) && data.descriptions.length === data.options.length && data.descriptions.every(isText))) {
      bad('has descriptions that are not one text for each option');
    }
    for (const k of ['line', 'code']) if (data[k] !== undefined && data[k] !== null && !isText(data[k])) bad(`has a ${k} that is neither text nor null`);
    if (data.importance !== undefined && !Number.isFinite(data.importance)) bad('has an importance that is not a number');
    optionalText('topic');
    optionalText('recommend');
    optionalText('event');
    optionalText('revises');
    // The card's parts, as the composer gives them (scripts/cards/compose.js): the pane draws them and the chat's text is built from them.
    if (data.parts !== undefined && !(isPlain(data.parts) && ['ask', 'what', 'why', 'meanwhile'].every((k) => isText(data.parts[k])) && Array.isArray(data.parts.options))) {
      bad('has parts that are not a question, what, why, meanwhile and options');
    }
    if (data.concepts !== undefined && !(Array.isArray(data.concepts) && data.concepts.every(isText))) bad('has concepts that are not a list of text');
  } else if (kind === 'reversal') {
    text('topic');
    text('what');
    optionalText('of');
  } else if (kind === 'asked') {
    if (!Array.isArray(data.cards) || data.cards.length === 0 || data.cards.length > CARD.questions || !data.cards.every(isText)) {
      bad(`needs cards to be a list of one to ${CARD.questions} card ids`);
    }
  } else if (kind === 'gate-asks') {
    slug('work');
    if (!Number.isInteger(data.pr) || data.pr < 1) bad('needs the pull request number');
    if (!GATE_ASKS.includes(data.ask)) bad('needs ask to be approval or ci-push');
    if (typeof data.sha !== 'string' || !/^[0-9a-f]{40}$/.test(data.sha)) bad('needs the full commit');
    if (data.ask === 'ci-push' && !isText(data.branch)) bad('needs the branch the CI push is for');
    if (data.ask !== 'ci-push' && data.branch !== undefined) bad('has a branch it should not');
    if (data.from !== undefined && (data.ask !== 'ci-push' || typeof data.from !== 'string' || !/^[0-9a-f]{40}$/.test(data.from))) {
      bad('has a from that is not the full head a CI push\'s update was made from');
    }
  } else if (kind === 'lineage-hold') {
    if (typeof data.at !== 'string' || Number.isNaN(Date.parse(data.at))) bad('needs at to be a time');
    const one = (m) => isPlain(m) && Object.keys(m).length === 2 && isText(m.path)
      && (m.upstream === null || (typeof m.upstream === 'string' && UPSTREAM_NAME.test(m.upstream)));
    if (!Array.isArray(data.mismatches) || data.mismatches.length === 0 || !data.mismatches.every(one)) {
      bad('needs mismatches, each an upstream (or null) and a path');
    }
  }
}

// What a review must carry: the pull request and the commit. The gate reads the
// verdict and the commit strictly; this guards the shape only. The strict shape
// (a full 40-hex commit, CLEAN or FINDINGS, a count) is built in
// scripts/hooks/report-check.js, and the gate's readers check the commit and
// verdict themselves.
function checkReview(data) {
  const bad = (why) => { throw new Error(`A review event ${why}`); };
  if (!data || typeof data !== 'object' || Array.isArray(data)) bad('needs data');
  if (!Number.isInteger(data.pr) || data.pr < 1) bad('needs a pull request number');
  if (typeof data.commit !== 'string' || data.commit === '') bad('needs the commit');
  if (data.verdict !== undefined && typeof data.verdict !== 'string') bad('has a verdict that is not text');
  if (data.findings !== undefined && (!Number.isInteger(data.findings) || data.findings < 0)) bad('has a count of findings that is not a count');
  for (const k of ['check', 'claudeCode', 'model']) if (data[k] !== undefined && typeof data[k] !== 'string') bad(`has a ${k} that is not text`);
}

// What a shown record must carry: the reply code, the question put to the director
// and the labels of the options offered (two to six).
function checkShown(data) {
  const bad = (why) => { throw new Error(`A shown event ${why}`); };
  if (!data || typeof data !== 'object' || Array.isArray(data)) bad('needs data');
  if (typeof data.code !== 'string' || data.code.length !== 4 || [...data.code].some((c) => !CODE_ALPHABET.includes(c))) {
    bad('needs a code of four letters or digits from the code alphabet');
  }
  if (typeof data.question !== 'string' || data.question === '') bad('needs the question');
  if (!Array.isArray(data.options) || data.options.length < 2 || data.options.length > 6) bad('needs two to six options');
  if (data.options.some((o) => typeof o !== 'string' || o === '')) bad('has an option that is not text');
}

export function makeEvent({ kind, data, now = () => new Date() }) {
  if (!KINDS.has(kind)) throw new Error('Unknown event kind');
  if (kind === 'action') checkAction(data);
  if (kind === 'review') checkReview(data);
  if (kind === 'shown') checkShown(data);
  if (Object.hasOwn(PLAIN_SHAPES, kind)) checkPlain(kind, data);
  const event = {
    v: 1,
    id: crypto.randomUUID(),
    at: now().toISOString(),
    computer: computerId(),
    kind,
    data,
  };
  return PROTECTED_KINDS.includes(kind) ? sign(event) : event;
}

// The kinds a confirmation can make take effect (design section 9).
export const CONFIRMABLE_KINDS = ['ruling', 'level', 'setting'];

// The sha256 of an event's canonical JSON without its signature: what a
// confirmation names, so it confirms that exact event and no other.
export function eventHash(event) {
  const { sig, ...unsigned } = event ?? {};
  return crypto.createHash('sha256').update(canonicalJson(unsigned)).digest('hex');
}

// The sha256 of a record's data in canonical JSON: what an answer names, so it answers the question as shown.
export function dataHash(data) {
  return crypto.createHash('sha256').update(canonicalJson(data)).digest('hex');
}

// The kind and data of a confirmation of `event`, for makeEvent to sign.
export function confirmationFor(event) {
  if (!CONFIRMABLE_KINDS.includes(event?.kind)) throw new Error('Only a ruling, a level or a setting can be confirmed');
  return { kind: 'confirmation', data: { confirms: event.id, confirmsHash: eventHash(event) } };
}

// events/<YYYY>/<MM>/<at, colons as hyphens>_<computer>_<kind>_<4 hex from the id>.json
export function eventPath(event) {
  const [year, month] = event.at.split('-');
  const tail = String(event.id).replace(/[^0-9a-f]/gi, '').padEnd(4, '0').slice(0, 4).toLowerCase();
  const name = `${event.at.replaceAll(':', '-')}_${event.computer}_${event.kind}_${tail}.json`;
  return path.join('events', year, month, name);
}

// Pushes, pulling and retrying when the remote moved on. Never throws.
async function pushWithRetry(dir, push, env, branch = STATE_BRANCH) {
  let result = { ok: false };
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      result = await push(dir, branch);
    } catch {
      return { ok: false };
    }
    if (result.ok) return { ok: true };
    if (result.rejected !== 'non-fast-forward' || attempt === MAX_RETRIES) break;
    const pulled = await git(dir, ['pull', '--rebase', 'origin', branch], env);
    if (pulled.code !== 0) {
      await git(dir, ['rebase', '--abort'], env);
      break;
    }
  }
  return result.refused ? { ok: false, refused: result.refused } : { ok: false };
}

// Makes the folder and returns the ones it had to make, deepest first.
function madeFolders(folder) {
  const made = [];
  for (let at = folder; !fs.existsSync(at); at = path.dirname(at)) made.push(at);
  fs.mkdirSync(folder, { recursive: true });
  return made;
}

// Removes those folders if nothing is left in them.
function removeEmpty(folders) {
  for (const folder of folders) {
    try {
      fs.rmdirSync(folder);
    } catch {
      return;
    }
  }
}

// Every string a value holds, keys included, at any depth.
function stringsIn(value, out = []) {
  if (typeof value === 'string') out.push(value);
  else if (Array.isArray(value)) for (const v of value) stringsIn(v, out);
  else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      out.push(k);
      stringsIn(v, out);
    }
  }
  return out;
}

// Whether an event carries the baseline card, its click or the private note's figures: they stay
// in <wheelhouseHome()>/measures/ and never enter the state or the profile. A record reads as the
// baseline card by any of its fixed words however written, or by its header with the figures; it
// holds the figures while they wait, in date at `now`, for the director's click
// (scripts/lib/measures-clicks.js).
export function carriesBaseline(event, { now = () => new Date() } = {}) {
  const data = event?.data;
  if (event?.kind === 'action' && data?.action === 'baseline') return true;
  if (data?.kind === 'baseline') return true;
  return carriesFigures(stringsIn(data).join('\n'), data?.header, { now });
}

// The words the state refuses a trust click with: it is kept on the computer it trusts on.
export const TRUST_KEPT_HERE = 'A trust click is kept on the computer it was made on, never in the state';

// `dir` and `branch` name another clone of events, such as the profile's; by default
// the project's state clone and its state branch. An event carrying the baseline card is refused.
export async function writeEvent({ project, event, push, env, dir = stateDir(project), branch = STATE_BRANCH, now = () => new Date() }) {
  if (!KINDS.has(event.kind)) throw new Error('Unknown event kind');
  if (carriesBaseline(event, { now })) throw new Error(CARRIES_BASELINE);
  if (event.kind === 'action' && event.data?.action === 'trust') throw new Error(TRUST_KEPT_HERE);
  if (PROTECTED_KINDS.includes(event.kind) && !event.sig) {
    throw new Error(`A ${event.kind} event must be signed before it is written`);
  }
  const relative = eventPath(event);
  const file = path.join(dir, relative);
  const made = madeFolders(path.dirname(file));
  try {
    fs.writeFileSync(file, `${JSON.stringify(event, null, 2)}\n`, { flag: 'wx' });
  } catch (error) {
    removeEmpty(made);
    if (error.code === 'EEXIST') throw new Error(`The event file ${path.basename(file)} already exists`);
    throw error;
  }
  // The file's text and every decoded string in it: a key after a newline or
  // tab sits behind \n or \t in the file.
  let found;
  try {
    found = scanContent(fs.readFileSync(file, 'utf8'));
  } catch {
    found = ['unreadable'];
  }
  if (found.length > 0) {
    fs.rmSync(file, { force: true });
    removeEmpty(made);
    const names = found.join(', ');
    throw new Error(`The event file ${path.basename(file)} was refused because it matched: ${names}`);
  }
  const added = await git(dir, ['add', '--', relative], env);
  const committed = added.code === 0 && (await git(dir, ['commit', '-m', `${event.kind} ${event.id}`, '--', relative], env)).code === 0;
  if (!committed) {
    await git(dir, ['reset', '-q', '--', relative], env);
    fs.rmSync(file, { force: true });
    removeEmpty(made);
    throw new Error(`The event file ${path.basename(file)} could not be committed`);
  }
  const pushed = await pushWithRetry(dir, push, env, branch);
  return pushed.refused
    ? { path: file, pushed: false, refused: pushed.refused }
    : { path: file, pushed: pushed.ok };
}

// Pulls, then pushes anything not yet pushed. Resolves with whether the pull
// went through and how many commits the remote still lacks. `dir` and `branch`
// as for writeEvent; `pull`, when given, is a clone's own pull ({ code }), as the profile's is.
export async function syncState({ project, push, pull, env, dir = stateDir(project), branch = STATE_BRANCH }) {
  const pulled = pull ? await pull() : await git(dir, ['pull', '--rebase', 'origin', branch], env);
  if (pulled.code !== 0) await git(dir, ['rebase', '--abort'], env);
  await pushWithRetry(dir, push, env, branch);
  const ahead = await git(dir, ['rev-list', '--count', `refs/remotes/origin/${branch}..HEAD`], env);
  const count = Number.parseInt(ahead.stdout.trim(), 10);
  // A count that cannot be read is taken as "something is still unpushed".
  return { pulled: pulled.code === 0, unpushed: ahead.code === 0 && Number.isInteger(count) ? count : 1 };
}

const reported = new Set();

function jsonFiles(folder) {
  let entries;
  try {
    entries = fs.readdirSync(folder, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries.flatMap((e) => {
    const full = path.join(folder, e.name);
    if (e.isDirectory()) return jsonFiles(full);
    return e.name.endsWith('.json') ? [full] : [];
  });
}

export function listEvents(dir, { report = (msg) => console.warn(msg), skipped = [] } = {}) {
  const events = [];
  for (const file of jsonFiles(path.join(dir, 'events'))) {
    try {
      const event = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (!event || typeof event.id !== 'string' || typeof event.at !== 'string' || typeof event.kind !== 'string') {
        throw new Error('not an event');
      }
      events.push(event);
    } catch {
      skipped.push(file);
      if (!reported.has(file)) {
        reported.add(file);
        report(`Skipped a damaged event file: ${file}`);
      }
    }
  }
  return events.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}
