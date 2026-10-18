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
import { CODE_ALPHABET } from './card-lines.js';

export const PLAIN_KINDS = [
  'request', 'ruling', 'level', 'glossary', 'idea', 'rejection', 'card', 'card-answer',
  'setting', 'dispatch', 'merge', 'note', 'blocker', 'risk', 'decision',
];
export const PROTECTED_KINDS = ['confirmation', 'approval', 'review', 'action', 'shown'];
const KINDS = new Set([...PLAIN_KINDS, ...PROTECTED_KINDS]);
const MAX_RETRIES = 3;

const ACTIONS = ['lift-stop', 'runbook', 'ci-push'];
const ACTION_KEYS = ['action', 'step', 'branch', 'sha', 'question', 'label'];

// What a click that sets something going must carry (design section 9).
function checkAction(data) {
  const bad = (why) => { throw new Error(`An action event ${why}`); };
  if (!data || typeof data !== 'object' || Array.isArray(data)) bad('needs data');
  if (Object.keys(data).some((k) => !ACTION_KEYS.includes(k))) bad('has a field it should not');
  if (!ACTIONS.includes(data.action)) bad('names an action Wheelhouse does not know');
  if (typeof data.question !== 'string' || typeof data.label !== 'string') bad('needs the question and the label');
  if (data.action === 'runbook') {
    if (!Number.isInteger(data.step) || data.step < 1 || data.step > 5) bad('needs a runbook step from 1 to 5');
    if (data.branch !== undefined) bad('has a branch it should not');
    if (data.sha !== undefined && !/^[0-9a-f]{12}$/.test(data.sha)) bad('has a commit that is not twelve hex characters');
    if (data.step === 3 && data.sha === undefined) bad('needs the commit for step 3');
  } else if (data.action === 'ci-push') {
    if (typeof data.branch !== 'string' || data.branch === '') bad('needs a branch');
    if (typeof data.sha !== 'string' || !/^[0-9a-f]{40}$/.test(data.sha)) bad('needs the full commit');
    if (data.step !== undefined) bad('has a step it should not');
  } else if (data.step !== undefined || data.branch !== undefined || data.sha !== undefined) {
    bad('carries no step, branch or commit');
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
