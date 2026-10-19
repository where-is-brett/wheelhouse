// scripts/protection/windows-builds.js
// Build commands on Windows (design section 12.2): the level each computer runs a
// feature's build commands at, read from the state views, and the words of its cards.
// Ask is the default, and anything that can't be read is Ask.
import { unattendedBuildsLine } from '../state/card-lines.js';

export const LEVELS = ['ask', 'guarded', 'unattended'];

// The local git commands that count as build commands, beside the configuration's buildCommands.
export const GIT_LOCAL = ['git status', 'git diff', 'git log', 'git show', 'git add', 'git commit', 'git restore', 'git rm', 'git mv'];

// The setting is kept per computer: its key names the computer it holds on.
export const settingKey = (computer) => `windowsBuildCommands:${computer}`;

// The options on a build-command question.
export const BUILD_QUESTION_LABELS = { once: 'Allow this time', feature: 'Allow for this feature', notNow: 'Not now' };

// The level in force on `computer`. `views` are the project's state views; `locked` is whether
// the project is Locked (lockedByPath); `guardedReady` is whether this computer's self-test passed.
// The accepted value counts only when its event was written on this computer. Unattended counts
// only from a click on its own card, and never in a Locked project; Guarded only once the
// self-test passes. A plain event back to Ask, newer than the accepted value, is in force at once.
export function buildsLevel({ views, computer, locked, guardedReady }) {
  const key = settingKey(computer);
  const settings = views?.settings;
  const entry = settings && Object.hasOwn(settings, key) ? settings[key] : null;
  if (!entry || entry.computer !== computer) return 'ask';
  const unconfirmed = Array.isArray(views.unconfirmed) ? views.unconfirmed : [];
  if (unconfirmed.some((u) => u?.kind === 'setting' && u.key === key && u.data?.value === 'ask')) return 'ask';
  if (entry.value === 'unattended') {
    return locked !== true && entry.line === unattendedBuildsLine(entry.id, computer) ? 'unattended' : 'ask';
  }
  if (entry.value === 'guarded') return guardedReady === true && entry.line === null ? 'guarded' : 'ask';
  return 'ask';
}

const UNATTENDED_RISK = 'Builders on this computer will run their tests and build steps without asking you, and with nothing to hold them. '
  + 'A builder writes the code these steps run, so one that goes wrong, or is misled by something it reads, could read your passwords and sign-ins on this computer, '
  + 'change Wheelhouse\'s own safety checks, or send your files anywhere, and nothing would ask you first. Reviews, the merge gate and STOP still hold.';
const GUARDED_SAYS = 'Build commands run at low integrity on this Windows computer: they can\'t change files outside the project, but can still use the network.';
const KEEP_ASKING = { name: 'keep-asking', label: 'Keep asking', says: 'A builder asks you before it runs a build command, as now.' };

// The card that turns Unattended on. Use Guarded is offered, and recommended, only where this
// computer's self-test passed.
export function UNATTENDED_CARD({ guardedReady } = {}) {
  const offered = guardedReady === true;
  return {
    what: 'Let builders on this Windows computer run their tests and build steps with no prompt and no sandbox, in this project.',
    why: 'While you are away, a builder stops at its first build command until you answer.',
    risk: UNATTENDED_RISK,
    options: [
      KEEP_ASKING,
      { name: 'turn-on', label: 'Turn on (dangerous)', says: 'Build commands run unattended on this computer until you turn it off. For as long as it lasts, a builder can do whatever your account can.' },
      ...(offered ? [{ name: 'guarded', label: 'Use Guarded', says: GUARDED_SAYS }] : []),
    ],
    recommend: offered ? 'guarded' : 'keep-asking',
  };
}

// The card that turns Guarded on, from this computer's self-test (Task 6 produces it):
// `writesHeld`, the runner was refused a write outside the worktree; `readsHeld`, it was
// refused a read of the helper's keys folder. Null where the write wasn't refused, since
// Guarded is offered only where it works.
export function GUARDED_CARD(selfTest) {
  if (selfTest?.writesHeld !== true) return null;
  const reads = selfTest.readsHeld === true
    ? 'The self-test found a build couldn\'t read the helper\'s keys folder.'
    : 'The self-test found a build could still read the helper\'s keys folder.';
  return {
    what: 'Run build commands on this Windows computer through Wheelhouse\'s runner, at low integrity.',
    why: 'Builders run their tests and build steps without asking you, and Windows stops them changing files outside the project.',
    risk: `The self-test found Windows stopped a build changing files outside the project. ${reads} `
      + 'It is not a sandbox: a build can still use the network, and read files Wheelhouse doesn\'t label. '
      + 'A command that fetches new code, such as npm install, still asks.',
    options: [
      { name: 'confirm', label: 'Confirm', says: GUARDED_SAYS },
      KEEP_ASKING,
    ],
    recommend: 'confirm',
  };
}
