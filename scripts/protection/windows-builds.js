// scripts/protection/windows-builds.js
// Build commands on Windows (design section 12.2): the level each computer runs a
// feature's build commands at and the director's grants of them, read from the state
// views, and the words of their cards. Ask is the default, and anything that can't be
// read is Ask.
import { isBuildCommand } from '../gate/guardrails.js';
import { unattendedBuildsLine } from '../state/card-lines.js';
import { GUARDED_LINE } from '../lib/platform-lines.js';

export const LEVELS = ['ask', 'guarded', 'unattended'];

// The local git commands that count as build commands, beside the configuration's buildCommands.
export const GIT_LOCAL = ['git status', 'git diff', 'git log', 'git show', 'git add', 'git commit', 'git restore', 'git rm', 'git mv'];

// The setting is kept per computer: its key names the computer it holds on.
export const settingKey = (computer) => `windowsBuildCommands:${computer}`;

// The options on a build-command question.
export const BUILD_QUESTION_LABELS = { once: 'Allow this time', feature: 'Allow for this feature', notNow: 'Not now' };
const WHATEVER_YOUR_ACCOUNT_CAN = 'For as long as this lasts, the builder can do whatever your account can.';
// The options as the feature session's ask writes them, in the design's words. The session never writes its own.
export const BUILD_QUESTION_OPTIONS = Object.freeze([
  { label: BUILD_QUESTION_LABELS.once, says: `For the builder's next run only. ${WHATEVER_YOUR_ACCOUNT_CAN}` },
  { label: BUILD_QUESTION_LABELS.feature, says: `Until the feature ends. This is the dangerous level, Unattended, for one feature. ${WHATEVER_YOUR_ACCOUNT_CAN}` },
  { label: BUILD_QUESTION_LABELS.notNow, says: 'The feature waits, and the foreman raises it with your next briefing.' },
].map((o) => Object.freeze(o)));

// Whether `command` is a build command of the configuration's `buildCommands`, or local git:
// one of them, or one of them with more words after it (`npm run build` is `npm run`'s), and
// one an allow rule can hold.
export function isConfiguredBuildCommand(command, buildCommands) {
  if (!isBuildCommand(command)) return false;
  const known = [...GIT_LOCAL, ...(Array.isArray(buildCommands) ? buildCommands.filter(isBuildCommand) : [])];
  return known.some((k) => command === k || command.startsWith(`${k} `));
}

// The level in force on `computer`. `views` are the project's state views; `locked` is whether
// the project is Locked (lockedByPath); `guardedReady` is whether this computer's self-test passed.
// The accepted value counts only when its event was written on this computer and its latest
// confirmation was signed by this computer's key, naming this computer. Unattended counts
// only from a click on its own card, and never in a Locked project; Guarded only once the
// self-test passes. A plain event back to Ask, newer than the accepted value, is in force at once.
export function buildsLevel({ views, computer, locked, guardedReady }) {
  const key = settingKey(computer);
  const settings = views?.settings;
  const entry = settings && Object.hasOwn(settings, key) ? settings[key] : null;
  if (!entry || entry.computer !== computer || entry.confirmedOn !== computer) return 'ask';
  const unconfirmed = Array.isArray(views.unconfirmed) ? views.unconfirmed : [];
  if (unconfirmed.some((u) => u?.kind === 'setting' && u.key === key && u.data?.value === 'ask')) return 'ask';
  if (entry.value === 'unattended') {
    return locked !== true && entry.line === unattendedBuildsLine(entry.id, computer) ? 'unattended' : 'ask';
  }
  if (entry.value === 'guarded') return guardedReady === true && entry.line === null ? 'guarded' : 'ask';
  return 'ask';
}

// What the board and the session start show of the level on `computer`: `level`, as buildsLevel
// reads it, and `lockedUnattended`, whether the project is Locked and its setting would read as
// Unattended were it not. Both come only through buildsLevel's reading, never the raw value, and
// anything that can't be read shows nothing: Ask, and no Locked line.
export function buildsShown({ views, computer, locked, guardedReady } = {}) {
  try {
    const level = buildsLevel({ views, computer, locked, guardedReady });
    const lockedUnattended = locked === true && buildsLevel({ views, computer, locked: false, guardedReady }) === 'unattended';
    return { level, lockedUnattended };
  } catch {
    return { level: 'ask', lockedUnattended: false };
  }
}

// What each Allow click grants, by its label.
const SCOPES = new Map([[BUILD_QUESTION_LABELS.once, 'run'], [BUILD_QUESTION_LABELS.feature, 'feature']]);
const isPlain = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);

// Whether a question is a build-command question as the feature CLI writes it: commands an allow
// rule can hold, and the design's options, word for word and in order, recommending Allow this
// time at level 3. The session can write its questions file by hand, so a line with other words,
// another recommendation or another level is no build-command question, and no click on it grants.
export function isBuildQuestion(q) {
  return isPlain(q)
    && Array.isArray(q.commands) && q.commands.length > 0 && q.commands.every(isBuildCommand)
    && Array.isArray(q.options) && q.options.length === BUILD_QUESTION_OPTIONS.length
    && q.options.every((o, i) => isPlain(o) && Object.keys(o).length === 2
      && o.label === BUILD_QUESTION_OPTIONS[i].label && o.says === BUILD_QUESTION_OPTIONS[i].says)
    && q.recommendation === BUILD_QUESTION_LABELS.once
    && q.level === 3;
}

// The director's grants of build commands to the feature `work` on `computer`, one for each
// verified answer (views.questions counts only signed clicks) to a build-command question
// (isBuildQuestion), made on this computer: signed by its key and naming it (views.js keeps
// no computer for an answer whose signer is another). Allow this time is for one
// run (scope `run`) until its question id is in `used`, the waker's record of the run grants
// it has given; anything but a list or a set there counts every run grant as used. Allow for
// this feature lasts the feature's life. Either ends when the feature closes, with a report
// at or after the click, or with a click from before the feature's current life began (work
// closed and queued again keeps its question ids and answers), and nothing is granted to a
// feature the views don't hold. The commands are the question's; featureAllowRules gives a
// rule only for those still configured.
export function buildGrants({ views, work, used, computer }) {
  const life = isPlain(views?.features) && Object.hasOwn(views.features, work) ? views.features[work] : null;
  const feature = isPlain(life) ? life.data : null;
  if (!isPlain(feature) || feature.step === 'closed' || typeof computer !== 'string' || typeof life.began !== 'string') return [];
  const report = isPlain(views.reports) && Object.hasOwn(views.reports, work) ? views.reports[work] : null;
  const ran = used instanceof Set ? used : Array.isArray(used) ? new Set(used) : null;
  const questions = isPlain(views.questions) ? views.questions : {};
  const grants = [];
  for (const [questionId, entry] of Object.entries(questions)) {
    const data = entry?.question?.data;
    const answer = entry?.answer;
    if (!isBuildQuestion(data) || data.work !== work) continue;
    if (!isPlain(answer) || answer.computer !== computer || typeof answer.at !== 'string') continue;
    const scope = SCOPES.get(answer.label);
    if (scope === undefined) continue;
    if (answer.at < life.began || (typeof report?.at === 'string' && report.at >= answer.at)) continue;
    if (scope === 'run' && (ran === null || ran.has(questionId))) continue;
    grants.push({ questionId, commands: [...data.commands], scope });
  }
  return grants;
}

const UNATTENDED_RISK = 'Builders on this computer will run their tests and build steps without asking you, and with nothing to hold them. '
  + 'A builder writes the code these steps run, so one that goes wrong, or is misled by something it reads, could read your passwords and sign-ins on this computer, '
  + 'change Wheelhouse\'s own safety checks, or send your files anywhere, and nothing would ask you first. Reviews, the merge gate and STOP still hold.';
const GUARDED_SAYS = GUARDED_LINE;
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
