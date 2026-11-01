// scripts/host/local/move.js
// A project in git alone moving to a host (spec 9). One card starts it; it waits for running runs, and the dispatcher holds new
// work meanwhile. Each step is journalled in `move.json` beside the home and is safe to repeat, so a move broken off carries on
// from where it stopped. The private record is a repository of its own, and only named branches and tags are pushed, so none of
// it goes up. The record moves straight after the push, ahead of spec 9's order, since the helper's connection and its own route
// for the project-files change read the record, and work stays held until the end. The home then stays, read-only, for 30 days, and a level-4 card offers to remove it.
import fs from 'node:fs';
import path from 'node:path';
import { readProject, writeProject } from '../../lib/projects.js';
import { run as realRun } from '../../lib/run.js';
import { STATE_BRANCH } from '../../state/record.js';
import { PROFILE_BRANCH } from '../../profile/store.js';
import { localChanges } from './changes.js';
import { FOLDER_REMOTE, OWN_CHANGES_LINE, folderFree } from './folder.js';
import { gitRoute, homeBranch, homeDir, projectFolder } from './home.js';

export const HOME_DAYS = 30;
export const MOVE_NOW = 'Move it';
export const NOT_NOW = 'Not now';
export const TRY_AGAIN = 'Try again';
export const KEEP_HOME = 'Keep it';
export const REMOVE_HOME = 'Remove it';
export const MOVE_WORK = 'move';
// Where an `origin` of the director's own goes, so nothing of theirs is lost.
export const OWN_ORIGIN = 'before-wheelhouse';
export const HOSTS = Object.freeze({ github: 'GitHub', gitlab: 'GitLab' });
export const MOVING_LINE = 'This project is moving to a host, so nothing goes into its private copy until it has';

const STEPS = ['host', 'push', 'record', 'changes', 'files', 'folder', 'protection', 'lock'];
const DAY_MS = 24 * 60 * 60 * 1000;
// A move's work is held from here until it is done.
const HOLDING = ['moving', 'failed'];
const HOME_WHAT = 'this project\'s home';
const FOLDER_WHAT = 'the project\'s folder';
const ownLine = (name) => [STATE_BRANCH, PROFILE_BRANCH, 'wheelhouse-lock'].includes(name) || name.startsWith('wheelhouse/');

const moveFile = (project) => path.join(projectFolder(project), 'move.json');
function journal(project) {
  try {
    const kept = JSON.parse(fs.readFileSync(moveFile(project), 'utf8'));
    return kept !== null && typeof kept === 'object' ? kept : null;
  } catch {
    return null;
  }
}
function keep(project, kept) {
  const file = moveFile(project);
  const part = `${file}.${process.pid}`;
  fs.writeFileSync(part, `${JSON.stringify(kept, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(part, file);
}

// The project's move as it stands, or null when none is asked for or under way.
export function readMove(project) {
  const kept = journal(project);
  return kept === null || kept.state === 'none' ? null : kept;
}
export const holdsWork = (project) => HOLDING.includes(journal(project)?.state);

const each = (dir, fn) => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const at = path.join(dir, entry.name);
    if (entry.isDirectory()) each(at, fn);
    if (!entry.isSymbolicLink()) fn(at, entry.isDirectory());
  }
};
function retireHome(project) {
  const home = homeDir(project);
  each(home, (at, dir) => fs.chmodSync(at, dir ? 0o500 : 0o400));
  fs.chmodSync(home, 0o500);
}
function openTree(dir) {
  fs.chmodSync(dir, 0o700);
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const at = path.join(dir, entry.name);
    if (entry.isDirectory()) openTree(at);
    else if (!entry.isSymbolicLink()) fs.chmodSync(at, 0o600);
  }
}
// Gives the home back its write permission, so that it can be removed.
export function unlockHome(project) {
  if (fs.existsSync(homeDir(project))) openTree(homeDir(project));
}
// The same for any moved project's home at or under `dir`, as `dir` is removed whole: a project's folder, or everything of Wheelhouse's.
export function unlockHomesIn(dir) {
  const below = (at) => {
    try {
      return fs.readdirSync(at).map((name) => path.join(at, name));
    } catch {
      return [];
    }
  };
  for (const at of [dir, ...below(dir), ...below(path.join(dir, 'projects'))]) {
    const home = path.join(at, 'home.git');
    if (fs.existsSync(home)) openTree(home);
  }
}

// Each step of the move, safe to repeat. `move` holds { project, target, kept, save, ways, git, say, now }.
const DOING = {
  async host({ project, kept, save, ways, say }) {
    const { folder } = readProject(project);
    kept.target = await ways.connect({
      project, host: kept.host, private: kept.private, folder, say, ours: kept.repo ?? null,
      made: (repo) => { kept.repo = repo; save(); },
    });
  },
  // Every branch of the project's, by name. Nothing else in the home goes: not its changes' places, and none of Wheelhouse's own.
  async record({ project, kept, ways }) {
    writeProject(project, kept.target);
    await ways.moved();
  },
  async push({ project, kept, ways, git }) {
    const { target } = kept;
    const to = ways.reach(target);
    const home = git(homeDir(project), { list: 'own', what: HOME_WHAT, ...to });
    const names = (await home.must(['for-each-ref', '--format=%(refname:lstrip=2)', 'refs/heads'], 'The project\'s lines of work could not be read')).split('\n').filter((n) => n !== '' && !ownLine(n));
    // The main line goes first, so a new repository takes it as its default branch.
    const send = (refspecs) => home.must(['push', '--quiet', target.remoteUrl, ...refspecs], 'The project could not be sent there');
    const main = homeBranch(project);
    await send([`refs/heads/${main}:refs/heads/${main}`]);
    await send([...names.filter((n) => n !== main).map((n) => `refs/heads/${n}:refs/heads/${n}`), 'refs/tags/*:refs/tags/*']);
  },
  // A change that became a pull request is noted first, so one broken off here is never opened twice.
  async changes({ project, kept, save, ways, git, now }) {
    const hosted = await ways.adapter();
    const changes = localChanges({ project, git, now, ...(ways.write ? { write: ways.write } : {}) });
    const open = changes.openChanges();
    const there = open.length === 0 ? [] : await hosted.openRequests();
    for (const change of open) {
      kept.changes[change.n] ??= there.find((r) => r.branch === change.branch)?.number
        ?? (await hosted.openPr({ head: change.branch, base: change.base, title: change.title, body: change.body })).number;
      save();
      await ways.carry({ n: change.n, number: kept.changes[change.n], head: change.head, branch: change.branch });
      await changes.closeChange(change.n);
    }
    await ways.carried(kept.changes);
  },
  async files({ kept, ways }) {
    const got = await ways.files(kept.target);
    if (got?.ok !== true) throw new Error(got?.refused ?? 'The project\'s files could not be changed');
  },
  // The folder gains `origin` and loses `wheelhouse`. An `origin` of the director's own stays, under another name.
  async folder({ kept, ways, git, say, branch }) {
    const { target } = kept;
    const { folder } = target;
    const here = git(folder, { reach: 'local', what: FOLDER_WHAT });
    const named = await here.call(['config', '--get', 'remote.origin.url']);
    const own = named.code === 0 ? String(named.stdout).trim() : null;
    if (own !== null && own !== target.remoteUrl) {
      await here.must(['remote', 'rename', 'origin', OWN_ORIGIN], `This folder's own origin could not be set aside, so it was left as it is. Rename it, then try again`);
      say(`This folder pointed at ${own} as origin. That is now named ${OWN_ORIGIN}, and Wheelhouse sends nothing to it.`);
    }
    await here.must(['config', 'remote.origin.url', target.remoteUrl], 'The folder could not be pointed at the host');
    await here.must(['config', '--replace-all', 'remote.origin.fetch', '+refs/heads/*:refs/remotes/origin/*'], 'The folder could not be pointed at the host');
    const to = ways.reach(target);
    await git(folder, { what: FOLDER_WHAT, ...to }).must(['fetch', '--quiet', '--no-tags', '--no-recurse-submodules', 'origin'], 'The folder could not read the host');
    if (!(await here.ok(['config', '--get', `branch.${branch}.remote`]))) {
      await here.must(['config', `branch.${branch}.remote`, 'origin'], 'The folder could not be pointed at the host');
      await here.must(['config', `branch.${branch}.merge`, `refs/heads/${branch}`], 'The folder could not be pointed at the host');
    }
    if (await here.ok(['config', '--get', `remote.${FOLDER_REMOTE}.url`])) await here.must(['remote', 'remove', FOLDER_REMOTE], 'The folder could not let go of its old remote');
    const newest = `refs/remotes/origin/${branch}`;
    const free = await folderFree({ folder, branch, git });
    if (!free || !(await here.ok(['merge', '--ff-only', '--no-overwrite-ignore', '--quiet', newest]))) say(OWN_CHANGES_LINE);
  },
  async protection({ kept, ways, say }) {
    const got = await ways.protect(kept.target);
    if (typeof got?.line === 'string') say(got.line);
  },
  async lock({ kept, ways }) {
    await ways.lock(kept.target);
  },
};

// moveToHost({ project, host, private, say, ways, git, stopped, now }) -> { ok } | { waiting: 'runs' | 'stop' } | { failedAt, line }.
// `ways` are the helper's: running(), connect(...) -> the project's new record, moved(), adapter(), reach(record) -> { env, reach },
// carry({ n, number, head, branch }), carried({ [n]: number }), files(record), protect(record), lock(record), and `write` for a
// signed record, if it has its own way.
export async function moveToHost({ project, host, private: isPrivate = true, say = () => {}, ways, run = realRun, git = gitRoute({ run }), stopped = () => false, now = () => new Date() }) {
  const before = journal(project);
  const record = readProject(project);
  // A record already this move's, cut off before the journal said so, is that step done.
  const ours = record?.host === before?.target?.host && record?.repo === before?.target?.repo;
  if (before?.state === 'moved' || (record?.host !== 'local' && !ours)) return { failedAt: 'start', line: 'This project is already on a host' };
  const kept = { cards: 0, ...before, state: 'moving', host: before?.host ?? host, private: before?.private ?? isPrivate, done: before?.done ?? {}, changes: before?.changes ?? {} };
  const save = () => keep(project, kept);
  save();
  if (ways.running().length > 0) return { waiting: 'runs' };
  const branch = homeBranch(project);
  for (const step of STEPS) {
    if (kept.done[step] === true) continue;
    if (stopped()) return { waiting: 'stop' };
    try {
      await DOING[step]({ project, kept, save, ways, git, say, now, branch });
    } catch (error) {
      return { failedAt: step, line: error instanceof Error ? error.message : 'the helper didn\'t say why' };
    }
    kept.done[step] = true;
    save();
  }
  retireHome(project);
  kept.state = 'moved';
  kept.at = now().toISOString();
  save();
  return { ok: true };
}

export function moveCard(host) {
  const name = HOSTS[host];
  return {
    work: MOVE_WORK,
    level: 3,
    what: `Put this project on ${name}? Your code goes online, in a private repository on your ${name} account. Wheelhouse waits for running work and starts none meanwhile, sends every line of work there, and turns each open change into a pull request. Your folder then points at ${name}.`,
    why: 'Your code leaving this computer is yours to decide. Your private record stays here.',
    options: [
      { label: MOVE_NOW, says: `The project moves to ${name}. You may be asked to sign in.` },
      { label: NOT_NOW, says: 'Nothing changes, and the project stays on this computer.' },
    ],
    recommendation: MOVE_NOW,
  };
}

function failedCard(host, line, recorded) {
  const name = HOSTS[host];
  return {
    work: MOVE_WORK,
    level: 3,
    what: `The move to ${name} stopped: ${line}`,
    why: 'New work stays held until the move is finished or set aside, and which it is is yours to decide.',
    options: [
      { label: TRY_AGAIN, says: 'The move carries on from where it stopped.' },
      { label: NOT_NOW, says: recorded ? 'Work stays held, and you are asked again tomorrow, as the project has already moved.' : 'Work goes on here, and nothing moved. A later move starts from there.' },
    ],
    recommendation: TRY_AGAIN,
  };
}

export function homeCard() {
  return {
    work: MOVE_WORK,
    level: 4,
    what: `The private copy this project was kept in before it moved has been read-only for ${HOME_DAYS} days. Remove it?`,
    why: 'Removing it can\'t be undone, and it is the last copy of how the project stood on the day it moved.',
    options: [
      { label: KEEP_HOME, says: 'It stays on this computer, and you won\'t be asked again.' },
      { label: REMOVE_HOME, says: 'It is removed from this computer. Your project on the host and your private record stay.' },
    ],
    recommendation: KEEP_HOME,
  };
}

// moveWatch({ project, ways, card, answerOf, note, now, stopped, run, git }) -> { ask(host, { private }), tick() }: the card, the move
// taken a step on at each tick, and the home's card. `card(data)` raises a question, `answerOf(id)` the label chosen, and
// `note(words)` writes to the Logbook.
export function moveWatch({ project, ways, card, answerOf, note, now = () => new Date(), stopped = () => false, run = realRun, git = gitRoute({ run }) }) {
  async function raise(kept, data) {
    const cards = (kept.cards ?? 0) + 1;
    const id = `q-${MOVE_WORK}-${cards}`;
    await card({ id, ...data });
    return { ...kept, cards, card: id };
  }

  async function ask(host, { private: isPrivate = true } = {}) {
    const kept = journal(project);
    if (['asked', 'moved', ...HOLDING].includes(kept?.state)) return { asked: false };
    if (readProject(project)?.host !== 'local') return { asked: false };
    keep(project, { ...(await raise({ ...kept, done: kept?.done ?? {}, changes: kept?.changes ?? {} }, moveCard(host))), state: 'asked', host, private: isPrivate });
    return { asked: true };
  }

  async function step(kept) {
    const got = await moveToHost({ project, host: kept.host, private: kept.private, say: note, ways, run, git, stopped, now });
    if (got.waiting === 'runs' && journal(project).said !== 'runs') {
      keep(project, { ...journal(project), said: 'runs' });
      await note('The move waits for running work to finish.');
    }
    if (got.failedAt === 'start') {
      // The project reached a host some other way, so nothing is left to hold work for.
      if (HOLDING.includes(journal(project)?.state)) keep(project, { ...journal(project), state: 'none' });
      await note(`The move stopped: ${got.line}`);
    }
    if (got.failedAt === undefined || got.failedAt === 'start') return;
    keep(project, { ...(await raise(journal(project), failedCard(journal(project).host, got.line, journal(project).done.record === true))), state: 'failed', line: got.line });
  }

  async function homeTick(kept) {
    if (kept.home === undefined && Date.parse(now()) - Date.parse(kept.at) >= HOME_DAYS * DAY_MS) {
      keep(project, { ...(await raise(kept, homeCard())), home: 'asked' });
      return;
    }
    if (kept.home !== 'asked') return;
    const label = answerOf(kept.card);
    if (label === KEEP_HOME) keep(project, { ...kept, home: 'kept' });
    if (label === REMOVE_HOME) {
      unlockHome(project);
      fs.rmSync(homeDir(project), { recursive: true, force: true });
      keep(project, { ...kept, home: 'removed' });
    }
  }

  async function tick() {
    const kept = journal(project);
    if (kept === null || kept.state === 'none' || kept.state === 'paused') return;
    if (kept.state === 'moved') {
      await homeTick(kept);
      return;
    }
    if (kept.state === 'asked') {
      const label = answerOf(kept.card);
      if (label === NOT_NOW) keep(project, { ...kept, state: Object.keys(kept.done).length > 0 ? 'paused' : 'none' });
      if (label === MOVE_NOW && !stopped()) await step(kept);
      return;
    }
    if (kept.state === 'failed') {
      const label = answerOf(kept.card);
      if (label === TRY_AGAIN && !stopped()) await step(kept);
      if (label === NOT_NOW && kept.done.record === true) {
        if (kept.retryAt === undefined) keep(project, { ...kept, retryAt: new Date(Date.parse(now()) + DAY_MS).toISOString() });
        else if (Date.parse(now()) >= Date.parse(kept.retryAt)) keep(project, { ...(await raise(kept, failedCard(kept.host, kept.line, true))), retryAt: undefined });
      } else if (label === NOT_NOW) {
        // Work goes on here, so what was sent is sent again by a later move. The repository stays the one made.
        keep(project, { ...kept, state: 'paused', done: kept.done.host === true ? { host: true } : {} });
      }
      return;
    }
    if (!stopped()) await step(kept);
  }

  return { ask, tick };
}
