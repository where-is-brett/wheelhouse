// scripts/setup/computers.js
// Each computer's key in the director's profile, so their other computers can trust it (design
// section 15, rulings R79 to R81, Review Focus 5).
//
// Step 3 lists this computer's enrolment (enrolmentChange) and its apply publishes it
// (publishEnrolment): `enrolments/<computer>.json`, holding { computer, publicKey, at }, on the
// profile's branch. Every computer publishes, the first too, so a later one can trust it.
//
// The commit is made with `git commit-tree` on the profile's tip as just fetched, with the file
// added to that tree, outside the helper's own `wheelhouse-profile` branch, and pushed by its exact
// SHA with the director's own sign-in (directorGitEnv, as ruling R42 pushes the setup commit), never
// a force-push; then the branch is fetched again. The helper's branch never carries a commit its
// profile push rules refuse (PROFILE_CHANGE in scripts/host/helper.js), so a push here that fails
// leaves nothing behind that could stop a later profile push. Where the profile's branch moved on
// meanwhile, the commit is made again on its new tip, a few times at most.
//
// Recorded as a `host` change, just before the push: its value before is the file the profile held
// (its text), or null. An enrolment already holding this computer's key is left as it is, with the
// day it was added, so the other computers' cards keep naming the same day.
//
// Nothing here trusts anything: another computer's key counts on this one only after the
// director's Trust it on the card the session start shows (scripts/lib/trust-clicks.js).
import { run as realRun, withoutGitVars } from '../lib/run.js';
import { computerId, profileDir } from '../lib/paths.js';
import { PROFILE_BRANCH } from '../profile/store.js';
import { ownKey, makeSigningKey } from '../state/signing.js';
import { enrolmentOf, enrolmentPath, fingerprint } from '../lib/trust-clicks.js';
import { newId } from './journal.js';

const TRACKING = `refs/remotes/origin/${PROFILE_BRANCH}`;
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

// Publishes this computer's enrolment in the profile (`profile`, as profile.json gives it), with git
// at `gitPath` run with `env`, the director's own sign-in, in the profile's clone. `listed` is the
// change step 3's card named. Gives { published, at, commit? }.
export async function publishEnrolment({ profile, listed = null, gitPath = 'git', env = {}, run = realRun, record = () => {}, now = () => new Date() }) {
  const own = keyHere();
  if (own === null) throw new Error(NOT_PUBLISHED);
  if (typeof listed?.computer === 'string' && listed.computer !== own.computer) throw new Error(KEY_CHANGED);
  if (typeof listed?.fingerprint === 'string' && listed.fingerprint !== fingerprint(own.publicKey)) throw new Error(KEY_CHANGED);
  const dir = profileDir();
  const git = (args, input) => run(gitPath, args, {
    cwd: dir, env: { GIT_NO_REPLACE_OBJECTS: '1', ...env }, baseEnv: withoutGitVars(), timeoutMs: 5 * 60 * 1000, ...(input === undefined ? {} : { input }),
  });
  const must = async (args, input) => {
    const got = await git(args, input);
    if (got.code !== 0) throw new Error(NOT_PUBLISHED);
    return got.stdout.trim();
  };
  const fetchTip = async () => {
    await must(['fetch', '-q', '--no-tags', profile.remoteUrl, `+refs/heads/${PROFILE_BRANCH}:${TRACKING}`]);
    return must(['rev-parse', '--verify', '-q', `${TRACKING}^{commit}`]);
  };
  const file = enrolmentPath(own.computer);
  const at = now().toISOString();
  const text = `${JSON.stringify({ computer: own.computer, publicKey: own.publicKey, at }, null, 2)}\n`;
  let recorded = false;
  for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
    const tip = await fetchTip();
    const held = await git(['cat-file', 'blob', `${tip}:${file}`]);
    const before = held.code === 0 ? held.stdout : null;
    const kept = before === null ? null : enrolmentOf(before, own.computer);
    if (kept !== null && kept.publicKey === own.publicKey) return { published: false, at: kept.at };
    const commit = await commitOn({ tip, computer: own.computer, text, must });
    if (!recorded) {
      record({ id: newId('chg'), kind: 'host', target: `${profile.host}:${profile.repo}:${file}`, before, after: text });
      recorded = true;
    }
    const pushed = await git(['push', '--no-verify', '--porcelain', profile.remoteUrl, `${commit}:refs/heads/${PROFILE_BRANCH}`]);
    if (pushed.code === 0) {
      await git(['fetch', '-q', '--no-tags', profile.remoteUrl, `+refs/heads/${PROFILE_BRANCH}:${TRACKING}`]);
      return { published: true, at, commit };
    }
    const line = String(pushed.stdout ?? '').split('\n').find((l) => l.startsWith('!'));
    if (!line || !/\((?:non-fast-forward|fetch first|failed to update ref|incorrect old value provided)\)/.test(line)) break;
  }
  throw new Error(NOT_PUBLISHED);
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
