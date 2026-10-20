// scripts/setup/computers.js
// Each computer's key in the director's profile, so their other computers can trust it (design
// section 15, rulings R79 to R81, Review Focus 5).
//
// Step 3 lists this computer's enrolment (enrolmentChange) and its apply publishes it
// (publishEnrolment): `enrolments/<computer>.json`, holding { computer, publicKey, at }, on the
// profile's branch. Every computer publishes, the first too, so a later one can trust it.
//
// The commit is made with `git commit-tree` on the profile's tip as just fetched, with the file
// added to that tree, in a scratch bare repository of setup's own (ruling R106), never the helper's
// profile clone, and pushed by its exact SHA with the director's own sign-in (directorGitEnv, as
// ruling R42 pushes the setup commit), never a force-push. Every git call there runs with hooks and
// the file-system monitor switched off, so nothing an agent could write runs with that sign-in. The
// helper's branch never carries a commit its profile push rules refuse (PROFILE_CHANGE in
// scripts/host/helper.js), so a push here that fails leaves nothing behind that could stop a later
// profile push. Where the profile's branch moved on meanwhile, the commit is made again on its new
// tip, a few times at most.
//
// Recorded as a `host` change, just before the push: its value before is the file the profile held
// (its text, or past MAX_ENROLMENT_BYTES its SHA-256 and size), or null. An enrolment already holding this computer's key is left as it is, with the
// day it was added, so the other computers' cards keep naming the same day.
//
// The last uninstall on this computer takes its enrolment back out the same way (withdrawEnrolment,
// ruling R87), only while the file still holds the key setup published.
//
// Nothing here trusts anything: another computer's key counts on this one only after the
// director's Trust it on the card the session start shows (scripts/lib/trust-clicks.js).
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { run as realRun } from '../lib/run.js';
import { setupGit, reaching } from './git.js';
import { computerId, wheelhouseHome } from '../lib/paths.js';
import { PROFILE_BRANCH } from '../profile/store.js';
import { ownKey, makeSigningKey } from '../state/signing.js';
import { enrolmentOf, enrolmentPath, fingerprint, MAX_ENROLMENT_BYTES } from '../lib/trust-clicks.js';
import { newId } from './journal.js';

// The commit's author: setup's own, never the director's name or address.
const AUTHOR = ['-c', 'user.name=Wheelhouse setup', '-c', 'user.email=setup@wheelhouse.invalid', '-c', 'commit.gpgsign=false'];
const ATTEMPTS = 3;

export const NOT_PUBLISHED = 'This computer\'s key could not be put in your profile, so your other computers can\'t trust it yet: a fresh Go ahead on step 3 tries again';
export const KEY_CHANGED = 'This computer\'s key is not the one step 3\'s card named, so it was not put in your profile: ask for step 3\'s card again';

// This computer's key, made when there is none yet: { computer, publicKey }, or null.
function keyHere() {
  let own = ownKey();
  if (own === null) {
    try {
      own = makeSigningKey();
    } catch {
      own = ownKey();
    }
  }
  return own;
}

// The change step 3 lists for this computer's enrolment: its id and, when it has a key already,
// the key's fingerprint, which the card names.
export function enrolmentChange({ host }) {
  const own = ownKey();
  return { kind: 'host', target: host, action: 'enrolment', computer: computerId(), fingerprint: own === null ? null : fingerprint(own.publicKey) };
}

// What step 3's card says of it: short, as step 3's card is the longest setup has. The key's
// fingerprint is in the list, so the card's hash covers it, but not in the card's words, where
// twelve hex characters would read as a commit.
export const ENROLMENT_PART = 'this computer\'s key in your profile';

// git in the scratch repository runs no hooks and asks no file-system monitor (ruling R106).
const NO_HOOKS = ['-c', 'core.hooksPath=/dev/null', '-c', 'core.fsmonitor=false'];
const FETCHED = 'refs/fetched/profile';
// The longest `before` recorded as it is; a longer one is recorded by its hash and size.
const BEFORE_CHARS = MAX_ENROLMENT_BYTES;

// What a change records of the file the profile held before: its text, or past the cap, its
// SHA-256 and size, so a large planted file never fills the journal.
const beforeOf = (text) => (text === null || text.length <= BEFORE_CHARS ? text
  : { sha256: crypto.createHash('sha256').update(text).digest('hex'), bytes: Buffer.byteLength(text) });

// Publishes this computer's enrolment in the profile (`profile`, as profile.json gives it), with git
// at `gitPath` run with `env`, the director's own sign-in. Everything runs in a scratch bare
// repository setup makes under <wheelhouseHome()>/setup/ and removes afterwards (ruling R106): the
// helper's profile clone, its hooks, its config and its refs are never touched, and every call
// has hooks and the file-system monitor switched off, git's global and system config shut out, and
// a setting in the scratch's own config not on setup's allowed list refused (scripts/setup/git.js).
// `listed` is the change step 3's card named. Gives { published, at, commit? }.
export async function publishEnrolment({ profile, listed = null, gitPath = 'git', env = {}, run = realRun, record = () => {}, now = () => new Date() }) {
  const own = keyHere();
  if (own === null) throw new Error(NOT_PUBLISHED);
  if (typeof listed?.computer === 'string' && listed.computer !== own.computer) throw new Error(KEY_CHANGED);
  if (typeof listed?.fingerprint === 'string' && listed.fingerprint !== fingerprint(own.publicKey)) throw new Error(KEY_CHANGED);
  const parent = path.join(wheelhouseHome(), 'setup');
  fs.mkdirSync(parent, { recursive: true });
  const dir = fs.mkdtempSync(path.join(parent, 'publish-'));
  // Global and system config shut out, and a hook the scratch's own config declares refused, as
  // every git call setup makes (ruling R109, scripts/setup/git.js); https only, with a local path
  // too only when the profile's address is one (R111).
  const call = setupGit({ run, gitPath, env: reaching({ GIT_NO_REPLACE_OBJECTS: '1', ...env }, profile.remoteUrl), cwd: dir });
  const git = (args, input) => call([...NO_HOOKS, ...args], input === undefined ? {} : { input });
  const must = async (args, input) => {
    const got = await git(args, input);
    if (got.code !== 0) throw new Error(NOT_PUBLISHED);
    return got.stdout.trim();
  };
  try {
    await must(['init', '-q', '--bare']);
    const file = enrolmentPath(own.computer);
    const at = now().toISOString();
    const text = `${JSON.stringify({ computer: own.computer, publicKey: own.publicKey, at }, null, 2)}\n`;
    let recorded = false;
    for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
      await must(['fetch', '-q', '--no-tags', profile.remoteUrl, `+refs/heads/${PROFILE_BRANCH}:${FETCHED}`]);
      const tip = await must(['rev-parse', '--verify', '-q', `${FETCHED}^{commit}`]);
      const held = await git(['cat-file', 'blob', `${tip}:${file}`]);
      const before = held.code === 0 ? held.stdout : null;
      const kept = before === null ? null : enrolmentOf(before, own.computer);
      if (kept !== null && kept.publicKey === own.publicKey) return { published: false, at: kept.at };
      const commit = await commitOn({ tip, computer: own.computer, text, must });
      if (!recorded) {
        record({ id: newId('chg'), kind: 'host', target: `${profile.host}:${profile.repo}:${file}`, before: beforeOf(before), after: text });
        recorded = true;
      }
      const pushed = await git(['push', '--no-verify', '--porcelain', profile.remoteUrl, `${commit}:refs/heads/${PROFILE_BRANCH}`]);
      if (pushed.code === 0) return { published: true, at, commit };
      const line = String(pushed.stdout ?? '').split('\n').find((l) => l.startsWith('!'));
      if (!line || !/\((?:non-fast-forward|fetch first|failed to update ref|incorrect old value provided)\)/.test(line)) break;
    }
    throw new Error(NOT_PUBLISHED);
  } finally {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch { /* left for the system to clear: it holds only the profile's public files */ }
  }
}

// A commit on `tip` whose tree is the tip's with enrolments/<computer>.json holding `text`, made
// from objects alone: no branch, index or working tree changes.
async function commitOn({ tip, computer, text, must }) {
  const blob = await must(['hash-object', '-w', '--stdin'], text);
  const entries = async (treeish) => (await must(['ls-tree', '-z', treeish])).split('\0').filter(Boolean);
  const top = await entries(`${tip}^{tree}`);
  const folder = top.find((e) => /^040000 tree [0-9a-f]+\tenrolments$/.test(e));
  const inside = folder === undefined ? [] : await entries(folder.split(/[ \t]/)[2]);
  const name = `${computer}.json`;
  const sub = await must(['mktree', '-z'], `${[...inside.filter((e) => e.split('\t')[1] !== name), `100644 blob ${blob}\t${name}`].join('\0')}\0`);
  const tree = await must(['mktree', '-z'], `${[...top.filter((e) => e.split('\t')[1] !== 'enrolments'), `040000 tree ${sub}\tenrolments`].join('\0')}\0`);
  return must([...AUTHOR, 'commit-tree', tree, '-p', tip, '-m', `Add the key of computer ${computer}`]);
}

export const NOT_WITHDRAWN = 'This computer\'s key could not be taken out of your profile: uninstall\'s plan, asked for again, tries again';

// Takes this computer's enrolment back out of the profile, as the last uninstall on this computer
// does (rulings R79, R87), with the director's own sign-in, the way publishEnrolment put it in: a
// commit made from objects alone on the profile's tip as just fetched, in a scratch bare repository
// setup makes and removes, pushed by its exact SHA, never forced, made again on a new tip a few
// times at most. `target` is the host change step 3 recorded (`<host>:<owner/name>:enrolments/
// <computer>.json`) and `after` the text it published: the file is taken out only while it still
// holds that key, so a key the computer published since, or another's, stays. Gives { put: true }
// (taken out, or gone already), or { put: false, why } when it holds another key; throws
// NOT_WITHDRAWN when git or the push fails.
export async function withdrawEnrolment({ profile, target, after, gitPath = 'git', env = {}, run = realRun }) {
  const file = /^[^:]+:[^:]+:(enrolments\/[0-9a-f]{8}\.json)$/.exec(String(target))?.[1];
  if (file === undefined) throw new Error('That is not a computer\'s enrolment in the profile');
  const computer = path.basename(file, '.json');
  const parent = path.join(wheelhouseHome(), 'setup');
  fs.mkdirSync(parent, { recursive: true });
  const dir = fs.mkdtempSync(path.join(parent, 'withdraw-'));
  const call = setupGit({ run, gitPath, env: reaching({ GIT_NO_REPLACE_OBJECTS: '1', ...env }, profile.remoteUrl), cwd: dir });
  const git = (args, input) => call([...NO_HOOKS, ...args], input === undefined ? {} : { input });
  const must = async (args, input) => {
    const got = await git(args, input);
    if (got.code !== 0) throw new Error(NOT_WITHDRAWN);
    return got.stdout.trim();
  };
  const keyOf = (text) => (typeof text === 'string' ? enrolmentOf(text, computer)?.publicKey ?? null : null);
  try {
    await must(['init', '-q', '--bare']);
    for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
      await must(['fetch', '-q', '--no-tags', profile.remoteUrl, `+refs/heads/${PROFILE_BRANCH}:${FETCHED}`]);
      const tip = await must(['rev-parse', '--verify', '-q', `${FETCHED}^{commit}`]);
      const held = await git(['cat-file', 'blob', `${tip}:${file}`]);
      if (held.code !== 0) return { put: true };
      const ours = held.stdout === after || (keyOf(after) !== null && keyOf(held.stdout) === keyOf(after));
      if (!ours) return { put: false, why: 'it holds another key since setup, so it stays' };
      const commit = await commitWithout({ tip, computer, must });
      const pushed = await git(['push', '--no-verify', '--porcelain', profile.remoteUrl, `${commit}:refs/heads/${PROFILE_BRANCH}`]);
      if (pushed.code === 0) return { put: true };
      const line = String(pushed.stdout ?? '').split('\n').find((l) => l.startsWith('!'));
      if (!line || !/\((?:non-fast-forward|fetch first|failed to update ref|incorrect old value provided)\)/.test(line)) break;
    }
    throw new Error(NOT_WITHDRAWN);
  } finally {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch { /* left for the system to clear: it holds only the profile's public files */ }
  }
}

// A commit on `tip` whose tree is the tip's without enrolments/<computer>.json (and without the
// folder, once nothing is left in it), made from objects alone.
async function commitWithout({ tip, computer, must }) {
  const entries = async (treeish) => (await must(['ls-tree', '-z', treeish])).split('\0').filter(Boolean);
  const top = await entries(`${tip}^{tree}`);
  const folder = top.find((e) => /^040000 tree [0-9a-f]+\tenrolments$/.test(e));
  const inside = (folder === undefined ? [] : await entries(folder.split(/[ \t]/)[2])).filter((e) => e.split('\t')[1] !== `${computer}.json`);
  const rest = top.filter((e) => e.split('\t')[1] !== 'enrolments');
  const kept = inside.length === 0 ? rest : [...rest, `040000 tree ${await must(['mktree', '-z'], `${inside.join('\0')}\0`)}\tenrolments`];
  const tree = await must(['mktree', '-z'], kept.length === 0 ? '' : `${kept.join('\0')}\0`);
  return must([...AUTHOR, 'commit-tree', tree, '-p', tip, '-m', `Take out the key of computer ${computer}`]);
}
