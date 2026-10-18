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
import { LANES, FEATURE_STEPS, REPORT_OUTCOMES, SLUG, HASH } from '../lib/build-loop.js';

export const PLAIN_KINDS = [
  'request', 'ruling', 'level', 'glossary', 'idea', 'rejection', 'card', 'card-answer',
  'setting', 'dispatch', 'merge', 'note',
  'work', 'feature', 'question', 'report', 'incident', 'amendment',
];
export const PROTECTED_KINDS = ['confirmation', 'approval', 'review', 'action'];
const KINDS = new Set([...PLAIN_KINDS, ...PROTECTED_KINDS]);
const MAX_RETRIES = 3;

const ACTIONS = ['lift-stop', 'runbook', 'ci-push', 'approve-work', 'answer', 'amend', 'lift-incident', 'incident-fix'];
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
};
const ACTION_KEYS = ['action', 'question', 'label', ...new Set(Object.values(ACTION_OWN).flat())];
// Labels that ask for more, or put the card off: a click on one is never an answer.
const NOT_AN_ANSWER = ['Explain more', 'Not now'];

const isSlug = (x) => typeof x === 'string' && SLUG.test(x);
const isText = (x) => typeof x === 'string' && x !== '';
const isPlain = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);

// What a click that sets something going must carry (design section 9).
function checkAction(data) {
  const bad = (why) => { throw new Error(`An action event ${why}`); };
  if (!data || typeof data !== 'object' || Array.isArray(data)) bad('needs data');
  if (Object.keys(data).some((k) => !ACTION_KEYS.includes(k))) bad('has a field it should not');
  if (!ACTIONS.includes(data.action)) bad('names an action Wheelhouse does not know');
  if (typeof data.question !== 'string' || typeof data.label !== 'string') bad('needs the question and the label');
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
  feature: { must: ['work', 'step'], may: ['worktree', 'branch', 'session', 'plan', 'files', 'brief', 'slice'] },
  question: { must: ['id', 'work', 'what', 'why', 'options', 'recommendation', 'level'], may: [] },
  report: { must: ['work', 'outcome', 'summary', 'rulings'], may: ['pr', 'provenance'] },
  incident: { must: ['id', 'what'], may: [] },
  amendment: { must: ['work', 'change', 'hash'], may: [] },
};

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

export function makeEvent({ kind, data, now = () => new Date() }) {
  if (!KINDS.has(kind)) throw new Error('Unknown event kind');
  if (kind === 'action') checkAction(data);
  if (kind === 'review') checkReview(data);
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
async function pushWithRetry(dir, push, env) {
  let result = { ok: false };
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      result = await push(dir, STATE_BRANCH);
    } catch {
      return { ok: false };
    }
    if (result.ok) return { ok: true };
    if (result.rejected !== 'non-fast-forward' || attempt === MAX_RETRIES) break;
    const pulled = await git(dir, ['pull', '--rebase', 'origin', STATE_BRANCH], env);
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

export async function writeEvent({ project, event, push, env }) {
  if (!KINDS.has(event.kind)) throw new Error('Unknown event kind');
  if (PROTECTED_KINDS.includes(event.kind) && !event.sig) {
    throw new Error(`A ${event.kind} event must be signed before it is written`);
  }
  const dir = stateDir(project);
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
  const pushed = await pushWithRetry(dir, push, env);
  return pushed.refused
    ? { path: file, pushed: false, refused: pushed.refused }
    : { path: file, pushed: pushed.ok };
}

// Pulls, then pushes anything not yet pushed. Resolves with whether the pull
// went through and how many commits the remote still lacks.
export async function syncState({ project, push, env }) {
  const dir = stateDir(project);
  const pulled = await git(dir, ['pull', '--rebase', 'origin', STATE_BRANCH], env);
  if (pulled.code !== 0) await git(dir, ['rebase', '--abort'], env);
  await pushWithRetry(dir, push, env);
  const ahead = await git(dir, ['rev-list', '--count', `refs/remotes/origin/${STATE_BRANCH}..HEAD`], env);
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
