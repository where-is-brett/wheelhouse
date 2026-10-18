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

export const PLAIN_KINDS = [
  'request', 'ruling', 'level', 'glossary', 'idea', 'rejection', 'card', 'card-answer',
  'setting', 'dispatch', 'merge', 'note',
];
export const PROTECTED_KINDS = ['confirmation', 'approval', 'review'];
const KINDS = new Set([...PLAIN_KINDS, ...PROTECTED_KINDS]);
const MAX_RETRIES = 3;

export function makeEvent({ kind, data, now = () => new Date() }) {
  if (!KINDS.has(kind)) throw new Error('Unknown event kind');
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

export async function writeEvent({ project, event, push, env }) {
  if (!KINDS.has(event.kind)) throw new Error('Unknown event kind');
  if (PROTECTED_KINDS.includes(event.kind) && !event.sig) {
    throw new Error(`A ${event.kind} event must be signed before it is written`);
  }
  const dir = stateDir(project);
  const relative = eventPath(event);
  const file = path.join(dir, relative);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  try {
    fs.writeFileSync(file, `${JSON.stringify(event, null, 2)}\n`, { flag: 'wx' });
  } catch (error) {
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
    const names = found.join(', ');
    throw new Error(`The event file ${path.basename(file)} was refused because it matched: ${names}`);
  }
  const added = await git(dir, ['add', '--', relative], env);
  const committed = added.code === 0 && (await git(dir, ['commit', '-m', `${event.kind} ${event.id}`, '--', relative], env)).code === 0;
  if (!committed) {
    await git(dir, ['reset', '-q', '--', relative], env);
    fs.rmSync(file, { force: true });
    throw new Error(`The event file ${path.basename(file)} could not be committed`);
  }
  const pushed = await pushWithRetry(dir, push, env);
  return pushed.refused
    ? { path: file, pushed: false, refused: pushed.refused }
    : { path: file, pushed: pushed.ok };
}

// Pulls, then pushes anything not yet pushed.
export async function syncState({ project, push, env }) {
  const dir = stateDir(project);
  const pulled = await git(dir, ['pull', '--rebase', 'origin', STATE_BRANCH], env);
  if (pulled.code !== 0) await git(dir, ['rebase', '--abort'], env);
  await pushWithRetry(dir, push, env);
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
