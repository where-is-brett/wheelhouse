// scripts/setup/local.js
// Setup for a project that stays on this computer (spec 10). A folder with no GitHub or GitLab remote is kept here with no
// question: its other remotes are left as they are and nothing is sent to them. Step 3 then gives the folder a first commit
// where it has none, makes the home, gives the folder its one remote and registers the project. There is no sign-in, host
// tool, own app, protection or lock branch. The finder and the first check are the check runner's, on the Bosun's first tick.
import fs from 'node:fs';
import path from 'node:path';
import { homeDir, isBranchName, makeHome, gitRoute } from '../host/local/home.js';
import { addFolderRemote, FOLDER_REMOTE } from '../host/local/folder.js';
import { identityOf } from '../host/local/merge.js';
import { engineDir, projectsDir, stateDir } from '../lib/paths.js';
import { projectForFolder, writeProject } from '../lib/projects.js';
import { STATE_BRANCH, openProjectRecord, openSettings } from '../state/record.js';
import { PROFILE_BRANCH } from '../profile/store.js';
import { parseRemote, hostWords } from '../host/gitlab-base.js';
import { readJournal } from '../lib/setup-run.js';
import { SETUP_LABEL } from '../state/card-lines.js';
import { setupGit, reaching } from './git.js';
import { newId } from './journal.js';

export const KEEP_HERE = 'Keep it on this computer';
export const PUT_ON_GITHUB = 'Put it on GitHub';
export const KEPT_LINE = 'Your project stays on this computer. Nothing goes online.';
export const FIRST_CHECK_LINE = 'Wheelhouse finds your tests and runs them here for the first time.';
export const STARTED_LINE = (branch) => `Git starts in this folder, with a first commit on ${branch}.`;
const FIRST_COMMIT = 'Start the project';
const MOST_BRANCHES = 4;
// Wheelhouse's own branches of a hosted project, never a project's main line.
const NOT_MAIN = [STATE_BRANCH, 'wheelhouse-lock', PROFILE_BRANCH];
const HEAD_REF = /^ref:\s*refs\/heads\/(\S+)$/;

export const projectFile = (project) => path.join(stateDir(project), '..', 'project.json');
export const repoOfLocal = (project) => `local/${project}`;
export const mirrorOf = (project) => path.join(engineDir(), 'mirrors', `${project}.git`);

// Every remote address the folder's git settings name, `origin` first, read from its own files, since git itself may not be
// here yet.
export function remotesOf(folder) {
  let text = '';
  try {
    text = fs.readFileSync(path.join(folder, '.git', 'config'), 'utf8');
  } catch {
    return [];
  }
  const found = [...text.matchAll(/^\s*\[remote\s+"([^"]+)"\]\s*$([\s\S]*?)(?=^\s*\[|(?![\s\S]))/gm)]
    .map(([, name, section]) => ({ name, url: /^\s*url\s*=\s*(.+?)\s*$/m.exec(section)?.[1] ?? null }))
    .filter((r) => r.url !== null && r.name !== FOLDER_REMOTE);
  return [...found.filter((r) => r.name === 'origin'), ...found.filter((r) => r.name !== 'origin')].map((r) => r.url);
}

// The branch the folder's HEAD names, born or not, or null.
export function headBranch(folder) {
  try {
    const name = HEAD_REF.exec(fs.readFileSync(path.join(folder, '.git', 'HEAD'), 'utf8').trim())?.[1] ?? null;
    return isBranchName(name) ? name : null;
  } catch {
    return null;
  }
}

function looseBranches(dir, prefix = '') {
  let entries = [];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries.flatMap((e) => (e.isDirectory() ? looseBranches(path.join(dir, e.name), `${prefix}${e.name}/`) : e.isFile() ? [`${prefix}${e.name}`] : []));
}

// The folder's branches that could be its main line, the one it is on first, read from its files.
export function branchesOf(folder) {
  const git = path.join(folder, '.git');
  let packed = '';
  try {
    packed = fs.readFileSync(path.join(git, 'packed-refs'), 'utf8');
  } catch { /* none packed */ }
  const names = [...looseBranches(path.join(git, 'refs', 'heads')), ...[...packed.matchAll(/^[0-9a-f]{40,64} refs\/heads\/(\S+)$/gm)].map((m) => m[1])];
  const usable = [...new Set(names)].filter((b) => isBranchName(b) && !NOT_MAIN.includes(b)).sort();
  const on = headBranch(folder);
  return usable.includes(on) ? [on, ...usable.filter((b) => b !== on)] : usable;
}

// The main line, where it needs no asking: the only branch, or main, or master. Null gives one card of up to four.
export function chooseBranch(branches) {
  if (branches.length === 1) return branches[0];
  return ['main', 'master'].find((b) => branches.includes(b)) ?? null;
}

export function branchAsk(name, branches, id) {
  const offered = branches.slice(0, MOST_BRANCHES);
  return {
    id,
    card: {
      level: 2,
      what: `Which line of ${name} is the main version?`,
      why: 'Wheelhouse puts finished work on it, and the others stay as they are.',
      options: offered.map((b, i) => ({ label: b, says: i === 0 ? 'The line this folder is on now.' : 'Another line in this folder.' })),
      recommend: offered[0],
      because: 'it is the line this folder is on',
      meanwhile: 'Nothing runs until your Go ahead on the plan.',
    },
  };
}

// What the plan says of remotes that aren't GitHub or GitLab, which stay as they are: one line, or null.
export function othersLine(others) {
  if (others.length === 0) return null;
  let where;
  try {
    where = hostWords(parseRemote(others[0]));
  } catch {
    where = 'another address';
  }
  return `This folder also points at ${where}, which Wheelhouse leaves as it is and sends nothing to. If that is a company GitLab, name it in the project settings.`;
}

// The Customise card of a folder with a history and no GitHub or GitLab remote.
export function keptAsk(name, others) {
  const line = othersLine(others);
  return {
    id: 'kept',
    line: line === null ? KEPT_LINE : `${KEPT_LINE} ${line}`,
    card: {
      level: 2,
      what: `Keep ${name} on this computer, or put it on GitHub too?`,
      why: 'It needs no account here, and it can move later in one click.',
      options: [
        { label: KEEP_HERE, says: 'Nothing goes online.' },
        { label: PUT_ON_GITHUB, says: 'Setup makes a private repository on your GitHub account, and sends your project there.' },
      ],
      recommend: KEEP_HERE,
      because: 'it needs no account, and it can move later in one click',
      meanwhile: 'Nothing runs until your Go ahead on the plan.',
    },
  };
}

// Where the run's answers keep the project: 'local', 'github', 'gitlab' or null, while no answer says.
export function chosenHost(answers = {}) {
  const joins = Object.keys(answers ?? {}).filter((k) => /^3\.join(?:-|$)/.test(k));
  const labels = [answers?.['3.kept'], answers?.['3.host'], ...joins.map((k) => answers[k])].map((a) => a?.label);
  if (labels.includes(KEEP_HERE)) return 'local';
  if (labels.includes(PUT_ON_GITHUB) || labels.includes('GitHub')) return 'github';
  return labels.includes('GitLab') ? 'gitlab' : null;
}

// The project's name on this computer: the folder's, with a suffix where another project has it.
export function localName(folder, base) {
  const here = projectForFolder(folder);
  if (here?.record.host === 'local') return here.project;
  for (let n = 1; ; n += 1) {
    const name = n === 1 ? base : `${base}-${n}`;
    if (!fs.existsSync(path.join(projectsDir(), name))) return name;
  }
}

// Whether setup gave this folder its history (`git init`, or a first commit), in a run uninstall hasn't closed: its own files
// then go in setup's first commit, as a new product's do.
export function startedBySetup(folder) {
  const target = path.join(folder, '.git');
  return readJournal().runs.filter((r) => typeof r?.closedAt !== 'string').flatMap((r) => r?.changes ?? [])
    .some((c) => c?.kind === 'folder' && c.target === target && c.after?.started === true);
}

// What step 3 does for a project kept here, in order.
export function localSteps({ folder, project, branch, noGit, noCommit, locked }) {
  return [
    ...(noGit ? [{ kind: 'folder', target: folder, action: 'git-init', branch }] : []),
    ...(noCommit ? [{ kind: 'folder', target: folder, action: 'first-commit', branch }] : []),
    { kind: 'file', target: projectFile(project), action: 'project', repo: repoOfLocal(project) },
    { kind: 'folder', target: stateDir(project), action: 'state', repo: repoOfLocal(project) },
    { kind: 'folder', target: homeDir(project), action: 'home', branch },
    { kind: 'git-config', target: folder, key: ['remote', FOLDER_REMOTE, 'url'], action: 'folder-remote', after: mirrorOf(project) },
    { kind: 'check', target: project, action: 'first-check' },
    { kind: 'host', target: 'local', action: 'connection', mode: 'none', locked },
  ];
}

export function localCard({ changes, branch, others }) {
  const parts = [
    ...(changes.some((c) => c.action === 'git-init') ? [`git starts in this folder, on ${branch}`] : []),
    ...(changes.some((c) => c.action === 'first-commit') ? [`a first commit on ${branch}`] : []),
    'a private copy of the project\'s history on this computer, which only Wheelhouse\'s helper changes',
    'the project\'s record, kept on this computer',
    FIRST_CHECK_LINE.replace(/\.$/, '').replace(/^W/, 'w'),
  ];
  const line = othersLine(others);
  return {
    kind: 'setup',
    level: 3,
    what: `Setup step 3, where the project is kept: ${KEPT_LINE} ${parts.join('; ')}.${line === null ? '' : ` ${line}`}`,
    why: 'Agents work from that copy, so nothing they do reaches the main version without your checks.',
    options: [
      { label: SETUP_LABEL, says: 'Setup does what is listed.' },
      { label: 'Not now', says: 'Nothing is made yet.' },
    ],
    recommend: SETUP_LABEL,
    because: 'the next steps need the project in place',
    meanwhile: 'Nothing is made yet.',
  };
}

// An empty tree's commit, the first of a folder with none. What the folder already holds is left as it is, and goes in setup's
// commit at step 7. The branch moves by plumbing, so nothing the director staged is touched.
async function firstCommit({ folder, branch, git, run, gitPath }) {
  const must = async (args, options) => {
    const got = await git(args, options);
    if (got.code !== 0) throw new Error('git could not start this project\'s history');
    return String(got.stdout).trim();
  };
  const tree = await must(['mktree'], { input: '' });
  const env = await identityOf(folder, gitRoute({ run }));
  const commit = await setupGit({ run, gitPath, env, cwd: folder, workTree: folder })(['commit-tree', '--no-gpg-sign', tree, '-m', FIRST_COMMIT]);
  if (commit.code !== 0) throw new Error('git could not start this project\'s history');
  await must(['update-ref', `refs/heads/${branch}`, String(commit.stdout).trim(), '']);
}

// Step 3's apply for a project kept here. The project's record comes first, so a retry finds the same name; each of the rest
// is safe to repeat.
export async function applyLocal({ ctx, changes, run, gitPath, say, halt }) {
  const { folder, record } = { folder: ctx.folder, record: ctx.record };
  const home = changes.find((c) => c.action === 'home');
  const project = path.basename(path.dirname(home.target));
  const { branch } = home;
  const repo = repoOfLocal(project);
  const connection = changes.find((c) => c.action === 'connection');
  const git = setupGit({ run, gitPath, env: reaching({}, null), cwd: folder, workTree: folder });
  const dotGit = path.join(folder, '.git');
  if (changes.some((c) => c.action === 'git-init')) {
    record({ id: newId('chg'), kind: 'folder', target: dotGit, before: fs.existsSync(dotGit) ? { origin: null } : null, after: { started: true, branch } });
    if ((await git(['init', '-q', '-b', branch])).code !== 0) throw new Error('git could not start in this folder');
  }
  if (changes.some((c) => c.action === 'first-commit')) {
    if (!changes.some((c) => c.action === 'git-init')) record({ id: newId('chg'), kind: 'folder', target: dotGit, before: { origin: null }, after: { started: true, branch } });
    if ((await git(['rev-parse', '-q', '--verify', `refs/heads/${branch}^{commit}`])).code !== 0) await firstCommit({ folder, branch, git, run, gitPath });
  }
  halt();
  const kept = { folder, remoteUrl: null, host: 'local', repo, connection: { host: 'local', mode: 'none', project: repo, ...(connection.locked ? { locked: true } : {}) } };
  const file = projectFile(project);
  let before = null;
  try {
    before = fs.readFileSync(file, 'utf8');
  } catch { /* first time */ }
  record({ id: newId('chg'), kind: 'file', target: file, before, after: `${JSON.stringify(kept, null, 2)}\n` });
  writeProject(project, kept);
  record({ id: newId('chg'), kind: 'folder', target: stateDir(project), before: fs.existsSync(stateDir(project)) ? {} : null, after: { record: true } });
  await openProjectRecord(project, { run });
  await openSettings({ run });
  halt();
  const route = gitRoute({ run });
  record({ id: newId('chg'), kind: 'folder', target: home.target, before: fs.existsSync(home.target) ? {} : null, after: { home: true, branch } });
  await makeHome({ project, folder, branch, git: route });
  const remote = changes.find((c) => c.action === 'folder-remote');
  record({ id: newId('chg'), kind: 'git-config', target: folder, key: remote.key, before: null, after: remote.after });
  await addFolderRemote({ folder, mirror: remote.after, git: route });
  say(KEPT_LINE);
  return [];
}
