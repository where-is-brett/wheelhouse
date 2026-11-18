// scripts/setup/render-cards.js
// Setup's cards as the director reads them, on a pretend computer: the one card, Customise, then every step to the
// last (step 10, the health check), each card in full and in order, through the real engine (scripts/setup/engine.js),
// the real steps 2 to 10 and the real prompt record, which keeps each answer as a click on the card does. Step 3's
// Go ahead is carried out as its apply would leave the computer (connectAsStepThree): the project on a pretend host,
// the folder connected to it, the project's record and, on Narrow, its key in a stand-in store. Every other step's
// Go ahead is taken as done. Nothing is reached on the network and nothing outside a scratch folder is read or
// written: the programs the steps run are stand-ins (`fakeRun`), git alone real and kept to the scratch folder, and
// the Wheelhouse home, the Claude Code folder and the user's home are made for the run.
//
//   node scripts/setup/render-cards.js [a|b|b'|c|d|e|f|g|h|i|all] [--desktop]
//
// The paths:
//   a   a company's GitLab, on Windows, no real users, GitLab's tool left out, git holding no key, Use my git as it is chosen
//   b   the same, with Narrow chosen
//   b'  the same, with GitLab's tool to be fetched and Quick chosen; the fetch fails, so the connection is asked again
//   c   the public GitLab, on Windows
//   d   GitHub, on Windows
//   e   a company's GitLab on a Mac, with GitLab's tool in
//   f   a project on a company's GitLab, pasted by its address on the join question, on a Mac: the address names the host, so no GitLab card is asked
//   g   the same address, for a project with no Wheelhouse settings in it: the question is asked again saying so and what to do, and a new product on the company's GitLab is chosen
//   h   an address pasted with a sign-in name and password in it: not kept, asked again saying so, then kept on this computer
//   i   path a with a long user name and project name, and Copilot's command line installed: Copilot is chosen on the builder question and is signed in
// --desktop answers as the Desktop app can: a card whose question is the same as an earlier card's shows the
// earlier one, so the answer that comes back is the one given there. It also asks each card with its first line reworded, as a
// model that doesn't copy a card word for word may, through the card check hook's swap (scripts/hooks/card-check.js): the
// director is shown what comes out, and a card not swapped back, or swapped for another card, ends the run.
//
// renderPath(name, { desktop }) gives { cards, end, said, heard }: each card as { step, id, kind, card, answer }, how
// the run ended ({ step, how, why? }), what setup said along the way, and after how many cards each line was said.
// printCards gives the cards as text, each line said in its place among them.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { SETUP_TITLES } from '../state/card-lines.js';
import { DEFAULT_GITLAB } from '../host/gitlab-base.js';
import { startedAsScript } from '../lib/started-as-script.js';
import { run as realRun } from '../lib/run.js';

// The public GitLab's name as its card offers it.
const PUBLIC_GITLAB = new URL(DEFAULT_GITLAB).hostname;
const HERE = fileURLToPath(import.meta.url);
const T0 = new Date('2026-11-16T03:00:00.000Z');
export const COMPANY_ADDRESS = 'https://gitlab.example.com';
// A project's page on that GitLab, as the director pastes it on the join question.
export const PASTED_ADDRESS = `${COMPANY_ADDRESS}/a-director/cafe-menu`;
// The same page with a sign-in name and password written into it (joined here so no file holds one whole).
export const HELD_ADDRESS = `https://${['ann', 'render-only'].join(':')}@gitlab.example.com/a-director/cafe-menu`;
// The director's account on the pretend host, and the project step 3 makes there.
const USER = 'a-director';
const PROJECT_ID = 41;
// Where Copilot's command line is on the pretend Windows computer.
const COPILOT_BIN = 'C:\\Program Files\\Copilot';

// What each path is: the computer, the host and the way the director picks, and how the cards are answered.
export const PATHS = Object.freeze({
  a: { title: 'A company\'s GitLab on Windows, no real users, GitLab\'s tool left out, git holding no key, Use my git as it is chosen', platform: 'win32', host: 'GitLab', where: 'company', way: 'Use my git as it is', glab: 'unavailable' },
  b: { title: 'A company\'s GitLab on Windows, no real users, GitLab\'s tool left out, Narrow chosen', platform: 'win32', host: 'GitLab', where: 'company', way: 'Narrow', glab: 'unavailable' },
  'b\'': { title: 'A company\'s GitLab on Windows, no real users, GitLab\'s tool to be fetched but not to be had, Quick chosen', platform: 'win32', host: 'GitLab', where: 'company', tool: 'fetch', way: 'Quick', glab: 'unavailable' },
  c: { title: 'The public GitLab on Windows', platform: 'win32', host: 'GitLab', where: 'public', glab: 'unavailable' },
  d: { title: 'GitHub on Windows', platform: 'win32', host: 'GitHub', gh: 'in' },
  e: { title: 'A company\'s GitLab on a Mac, GitLab\'s tool in', platform: 'darwin', host: 'GitLab', where: 'company', glab: 'in' },
  f: { title: 'A project on a company\'s GitLab pasted by its address on the join question, on a Mac', platform: 'darwin', host: 'GitLab', where: 'pasted', glab: 'in', join: PASTED_ADDRESS },
  g: { title: 'The same address for a project with no Wheelhouse settings: found missing at step 3\'s apply, asked again, GitLab chosen and refused for the name, then kept on this computer', platform: 'darwin', host: 'GitLab', where: 'company', glab: 'in', join: PASTED_ADDRESS, miss: true, missAtApply: true, reask: ['GitLab', 'Keep it on this computer'] },
  h: { title: 'An address pasted with a sign-in name and password in it: not kept, asked again saying so, then kept on this computer', platform: 'darwin', host: 'Keep it on this computer', glab: 'in', join: HELD_ADDRESS, miss: true, reask: ['Keep it on this computer'] },
  i: { title: 'A company\'s GitLab on Windows with a long user name and project name, Use my git as it is chosen, Copilot\'s command line installed and chosen on the builder question, and Copilot signed in', platform: 'win32', host: 'GitLab', where: 'company', way: 'Use my git as it is', glab: 'unavailable', agent: 'Copilot', folderName: 'wheelhouse-t6-17-11-2026', userName: 'firstname.lastname-longer' },
});

// ---- The pretend computer ----

const world = () => JSON.parse(fs.readFileSync(path.join(process.env.WHEELHOUSE_HOME, 'render-world.json'), 'utf8'));

// The programs the steps run, answered as the path's computer would: every tool in at a good version, but for a host
// tool the path leaves out, which is not found; git holds no key and no proxy; nothing is signed in.
export function fakeRun(w) {
  const missing = new Set([...(w.glab === 'in' ? [] : ['glab']), ...(w.gh === 'in' ? [] : ['gh'])]);
  const win = w.platform === 'win32';
  return async (file, args = [], options = {}) => {
    const name = path.win32.basename(String(file)).replace(/\.exe$/i, '');
    const answer = (stdout, code = 0) => ({ code, stdout, stderr: '' });
    // Once step 3 has connected the folder, git is the real one, kept to the scratch folder, and the host answers.
    if (w.connected) {
      const hosted = await connectedAnswer(w, name, args, options);
      if (hosted !== null) return hosted;
    }
    if (name === 'which' || name === 'where') {
      if (missing.has(args[0])) return answer('', 1);
      return answer(win ? `C:\\Program Files\\${args[0]}\\${args[0]}.exe\r\n` : `/usr/bin/${args[0]}\n`);
    }
    if (missing.has(name)) throw Object.assign(new Error(`${name} is not found`), { code: 'ENOENT' });
    if (name === 'xcode-select' && args[0] === '-p') return answer('/Library/Developer/CommandLineTools\n');
    if (args[0] === '--version' || args[0] === 'version') return answer(name === 'node' ? 'v22.3.0\n' : `${name} version 2.60.0\n`);
    if (name === 'git' && args.includes('config')) return answer('', 1);
    if ((name === 'glab' || name === 'gh') && args[0] === 'auth') return answer('', 1);
    if (name === 'glab' && args[0] === 'config') return answer('', 1);
    if (name === 'tmutil') return answer('', 1);
    return answer('');
  };
}

// ---- The pretend host, once step 3 has connected the folder ----

// git, with the computer's own git settings shut out and, for a command that reaches the host, the host's address sent
// to the scratch copy of the project (only there, so the folder's settings that setup reads stay as the computer's).
const REACHES = new Set(['fetch', 'push', 'pull', 'ls-remote', 'clone']);
function scratchGit(connected, args, options = {}) {
  let at = 0;
  while (at < args.length && String(args[at]).startsWith('-')) at += ['-c', '-C'].includes(args[at]) ? 2 : 1;
  // `ls-remote --get-url` only says the address git would use, and the as-is route's look at the director's settings asks it, so
  // it is never sent to the scratch copy.
  const reaches = REACHES.has(args[at]) && !args.includes('--get-url');
  const given = options.env ?? {};
  const env = {
    ...given, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: given.GIT_CONFIG_GLOBAL ?? connected.gitConfig, GIT_TERMINAL_PROMPT: '0',
    // Setup lets git reach over https only; the scratch copy of the host is a local folder.
    ...(reaches ? { GIT_ALLOW_PROTOCOL: 'https:file' } : {}),
  };
  const to = reaches && connected.hostAddress !== '' ? ['-c', `url.${pathToFileURL(connected.hostRoot).href}/.insteadOf=${connected.hostAddress}/`] : [];
  return realRun('git', [...to, ...args], { ...options, env, platform: process.platform });
}

// What the pretend host answers to a call of its web API: the director's account, the project (its default branch
// main), the main line's protection as step 3 left it, approval rules refused, and an empty list for anything else.
function hostAnswer(connected, method, url) {
  const p = url.replace(/^https:\/\/[^/]+(\/api\/v4)?/, '').replace(/\?.*$/, '');
  const project = { id: PROJECT_ID, path_with_namespace: `${USER}/cafe-menu`, full_name: `${USER}/cafe-menu`, default_branch: 'main', visibility: 'private', private: true };
  if (p === '/user') return { status: 200, body: { id: 7, username: USER, login: USER, name: 'A Director', commit_email: 'director@example.com' } };
  if (/^\/(projects|repos)\/[^/]+(\/[^/]+)?$/.test(p) && method === 'GET') return { status: 200, body: project };
  if (/\/protected_branches/.test(p)) {
    return connected.protected
      ? { status: 200, body: { name: 'main', push_access_levels: [{ access_level: 0 }], merge_access_levels: [{ access_level: 30 }], allow_force_push: false } }
      : { status: 404, body: null };
  }
  if (/\/approval_rules/.test(p)) return { status: 403, body: null };
  return { status: 200, body: [] };
}

// The host's answer to a program, or null for the stand-in's own answer.
async function connectedAnswer(w, name, args, options) {
  const answer = (stdout, code = 0) => ({ code, stdout, stderr: '' });
  if (name === 'git' && args[0] !== '--version' && args[0] !== 'version') return scratchGit(w.connected, args, options);
  if (name === 'curl') {
    const config = String(options.input ?? '');
    const field = (key) => {
      const line = config.split('\n').map((l) => l.trim()).find((l) => new RegExp(`^${key}\\s*=`).test(l));
      return line ? line.replace(/^[^=]+=\s*/, '').replace(/^"|"$/g, '') : null;
    };
    const got = hostAnswer(w.connected, (field('request') ?? 'GET').toUpperCase(), field('url') ?? '');
    const at = args.indexOf('--write-out');
    const format = at >= 0 ? String(args[at + 1]) : '';
    const tail = format.replace('%{http_code}', String(got.status)).replace('%{http_connect}', '0').replace(/\\n/g, '\n');
    return answer(`${got.body === null ? '' : JSON.stringify(got.body)}${tail}`);
  }
  if ((name === 'glab' || name === 'gh') && args[0] === 'auth') return answer('Logged in\n');
  if ((name === 'glab' || name === 'gh') && args[0] === 'api') {
    const target = String(args.slice(1).find((a) => /^\/?(projects|repos|user)/.test(a)) ?? '');
    const method = String(args[args.findIndex((a) => a === '--method' || a === '-X') + 1] ?? 'GET');
    const got = hostAnswer(w.connected, args.includes('--method') || args.includes('-X') ? method.toUpperCase() : 'GET', `/${target.replace(/^\//, '')}`);
    return got.status === 200 ? answer(JSON.stringify(got.body)) : answer('', 1);
  }
  return null;
}

// Step 3's Go ahead, as its apply leaves the computer: the project on the pretend host with the host's README, this
// folder connected to it on main, the company's GitLab named in the folder's git settings, the project's record and
// private record, and on Narrow the project's own key kept (on the public GitLab, the pasted token). Gives the world's `connected`.
async function connectAsStepThree({ folder, scratch, changes }) {
  const { writeProject } = await import('../lib/projects.js');
  const { projectSlug, stateDir } = await import('../lib/paths.js');
  const { writeKey } = await import('../host/keys.js');
  const { nameGitlabHost } = await import('./host.js');
  const connection = changes.find((c) => c.action === 'connection');
  const host = connection.target;
  const base = connection.base ?? DEFAULT_GITLAB;
  const via = changes.find((c) => c.action === 'sign-in')?.via ?? null;
  const repo = `${USER}/cafe-menu`;
  const hostAddress = host === 'github' ? 'https://github.com' : base;
  const hostRoot = path.join(scratch, 'host');
  const bare = path.join(hostRoot, `${repo}.git`);
  const gitConfig = path.join(scratch, 'gitconfig');
  fs.writeFileSync(gitConfig, '[user]\n\tname = A Director\n\temail = director@example.com\n[init]\n\tdefaultBranch = main\n');
  const connected = { host, hostAddress, hostRoot, gitConfig, protected: via === 'setup-token' };
  const git = async (cwd, ...args) => {
    const got = await scratchGit(connected, args, { cwd });
    if (got.code !== 0) throw new Error(`git ${args[0]} failed in the render's scratch folder: ${got.stderr}`);
  };
  const seed = path.join(scratch, 'seed');
  fs.mkdirSync(path.dirname(bare), { recursive: true });
  fs.mkdirSync(seed);
  await git(scratch, 'init', '-q', '--bare', bare);
  await git(seed, 'init', '-q', '-b', 'main');
  fs.writeFileSync(path.join(seed, 'README.md'), '# Cafe Menu\n');
  // A project joined was set up with Wheelhouse on another computer, so its last commit holds the settings file.
  if (world().join && !world().miss) {
    fs.mkdirSync(path.join(seed, '.claude'), { recursive: true });
    fs.writeFileSync(path.join(seed, '.claude', 'wheelhouse.json'), '{"v":1,"criticalAreas":[],"ciFiles":[],"mcpServers":[],"webDomains":[]}\n');
    await git(seed, 'add', '.claude/wheelhouse.json');
  }
  await git(seed, 'add', 'README.md');
  await git(seed, 'commit', '-q', '-m', 'Initial commit');
  await git(seed, 'push', '-q', bare, 'main');
  const remoteUrl = `${hostAddress}/${repo}.git`;
  await git(folder, 'init', '-q', '-b', 'main');
  await git(folder, 'remote', 'add', 'origin', remoteUrl);
  await git(folder, 'fetch', '-q', 'origin', 'main');
  await git(folder, 'checkout', '-q', '-B', 'main', 'origin/main');
  const naming = changes.find((c) => c.action === 'gitlab-hosts');
  if (naming) nameGitlabHost({ folder, entry: naming.host, record: () => {} });
  const mode = connection.mode;
  const record = {
    folder, remoteUrl, host, repo,
    connection: {
      host, mode, project: repo,
      ...(connection.backend === 'cli' || connection.backend === 'rest' ? { backend: connection.backend } : {}),
      ...(via === 'narrow-key' || via === 'setup-token' ? { directorSignIn: via } : {}),
      ...(via === 'setup-token' ? { setupAuthor: { name: 'A Director', email: 'director@example.com' } } : {}),
      ...(host === 'gitlab' ? { baseUrl: base, ...(mode === 'narrow' ? { projectId: PROJECT_ID } : {}) } : {}),
    },
  };
  const slug = projectSlug(USER, 'cafe-menu');
  writeProject(slug, record);
  fs.mkdirSync(stateDir(slug), { recursive: true });
  await git(stateDir(slug), 'init', '-q', '-b', 'main');
  // The public GitLab's free plan makes no project key, so step 3 there keeps the token the director pasted.
  if (host === 'gitlab' && mode === 'narrow') writeKey(`gitlab-project-${PROJECT_ID}`, base === DEFAULT_GITLAB ? { kind: 'pasted-token', token: 'glpat-render-pasted-token', expiresAt: '2026-12-17' } : { kind: 'project-key', token: 'glpat-render-project-key', expiresAt: '2027-11-16' });
  return connected;
}

// Step 3's Go ahead for a product kept on this computer, as its apply leaves it: git started in the folder with a first commit
// on main, and the project's record and private record opened, with no host.
async function keepAsStepThree({ folder, scratch, changes }) {
  const { writeProject } = await import('../lib/projects.js');
  const { stateDir } = await import('../lib/paths.js');
  const home = changes.find((c) => c.action === 'home');
  const project = path.basename(path.dirname(home.target));
  const connected = { host: 'local', hostAddress: '', hostRoot: path.join(scratch, 'host'), gitConfig: path.join(scratch, 'gitconfig'), protected: false };
  fs.writeFileSync(connected.gitConfig, '[user]\n\tname = A Director\n\temail = director@example.com\n[init]\n\tdefaultBranch = main\n');
  const git = async (cwd, ...args) => {
    const got = await scratchGit(connected, args, { cwd });
    if (got.code !== 0) throw new Error(`git ${args[0]} failed in the render's scratch folder: ${got.stderr}`);
  };
  await git(folder, 'init', '-q', '-b', 'main');
  fs.writeFileSync(path.join(folder, 'README.md'), '# Cafe Menu\n');
  await git(folder, 'add', 'README.md');
  await git(folder, 'commit', '-q', '-m', 'First commit');
  fs.mkdirSync(path.dirname(home.target), { recursive: true });
  const cloned = await realRun('git', ['clone', '-q', '--bare', '--no-hardlinks', folder, home.target], { env: { GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: connected.gitConfig }, platform: process.platform });
  if (cloned.code !== 0) throw new Error(`git clone failed in the render's scratch folder: ${cloned.stderr}`);
  const repo = `local/${project}`;
  writeProject(project, { folder, remoteUrl: null, host: 'local', repo, connection: { host: 'local', mode: 'none', project: repo } });
  fs.mkdirSync(stateDir(project), { recursive: true });
  await git(stateDir(project), 'init', '-q', '-b', 'main');
  return connected;
}

const settles = (n) => ({ n, title: SETUP_TITLES[n], plan: async () => ({ settled: { record: {} } }), apply: async () => [] });

// The steps for the engine: the real steps 2 to 10 on the pretend computer, read afresh from the world on each call.
async function realSteps() {
  const { toolsStep } = await import('./tools.js');
  const { hostStep, directorKey, directorGitlabApi } = await import('./host.js');
  const { questionsStep } = await import('./questions.js');
  const { rulesStep } = await import('./rules.js');
  const { computerStep, lockedStep } = await import('./computer.js');
  const { projectFilesStep } = await import('./project-files.js');
  const { notifyStep } = await import('./notify.js');
  const { healthStep } = await import('./health.js');
  const { useKeyStore, writeKey, deleteKey } = await import('../host/keys.js');
  // The computer's own store of keys is a stand-in that holds nothing: keys are kept in the scratch Wheelhouse home.
  useKeyStore({ readKey: async () => null, storeKey: async (name, value) => writeKey(name, value), deleteKey: async (name) => deleteKey(name) });
  // The key the director's git holds once step 3 has had them make one (Use my git as it is); none before.
  directorKey.borrow = async () => (world().connected ? { key: 'glpat-render-directors-key' } : null);
  const tools = () => {
    const w = world();
    return toolsStep({ engine: null, run: fakeRun(w), fetch: async () => { throw new Error('nothing is fetched here'); }, pluginRoot: w.pluginRoot, env: {} });
  };
  const host = () => {
    const w = world();
    return hostStep({
      run: fakeRun(w), fetch: async () => { throw new Error('nothing is fetched here'); }, curlExists: () => true,
      certificateProbe: async () => 'trusted', views: () => ({}),
      findGit: async () => ({ ok: true, found: true, path: w.platform === 'win32' ? 'C:\\Program Files\\Git\\cmd\\git.exe' : '/usr/bin/git' }),
      via: { run: fakeRun(w), curl: null, platform: w.platform },
    });
  };
  const fresh = (made, n) => ({
    n, title: SETUP_TITLES[n], long: made().long, after: made().after, asksDuring: made().asksDuring,
    plan: (ctx) => made().plan(ctx), apply: (ctx, changes) => made().apply(ctx, changes),
  });
  const git = () => ({ ok: true, found: true, path: world().platform === 'win32' ? 'C:\\Program Files\\Git\\cmd\\git.exe' : '/usr/bin/git' });
  const via = () => ({ run: fakeRun(world()), curl: 'curl', proxy: null, caFile: null, platform: world().platform });
  const node = () => (world().platform === 'win32' ? 'C:\\Program Files\\nodejs\\node.exe' : '/usr/local/bin/node');
  const address = () => 'http://127.0.0.1:47800';
  const scratchHome = () => process.env.WHEELHOUSE_HOME;
  const made = {
    5: () => rulesStep({ env: {} }),
    // Another agent's command line, where the path has one: found in a folder on the pretend computer's PATH.
    6: () => computerStep({
      run: fakeRun(world()), port: 47801,
      env: world().agent === undefined ? {} : { PATH: COPILOT_BIN },
      ...(world().agent === undefined ? {} : { exists: (file) => file === path.win32.join(COPILOT_BIN, 'copilot.exe') }),
    }),
    7: () => projectFilesStep({
      run: fakeRun(world()), findGit: async () => git(), keyVia: via(), address, node: node(), env: {},
      gitlab: ({ baseUrl }) => directorGitlabApi({ run: fakeRun(world()), baseUrl, via: via() }),
      best: async () => 'front-desk-model', claude: () => 'claude',
    }),
    8: () => lockedStep({ run: fakeRun(world()), dir: path.join(scratchHome(), 'managed'), mdmPlist: path.join(scratchHome(), 'no-mdm.plist'), nodePath: node(), address }),
    9: () => notifyStep({ pushResult: () => null }),
    10: () => healthStep({ run: fakeRun(world()), findGit: async () => git(), via: via() }),
  };
  return Object.keys(SETUP_TITLES).map(Number).sort((a, b) => a - b).map((n) => {
    if (n === 2) return fresh(tools, 2);
    if (n === 3) return fresh(host, 3);
    if (n === 4) return questionsStep();
    if (made[n]) return fresh(made[n], n);
    return settles(n);
  });
}

// The engine loads its steps from a module's STEPS: this one's, once the world is laid out.
export let STEPS = [];
if (process.env.WHEELHOUSE_RENDER_STEPS === '1') STEPS = await realSteps();

// ---- Answering ----

// The label the director picks on a card, by the path: the way the path names where the card offers it, else the
// recommendation; the company's address typed where a card asks for it.
function choose(p, { id, card }, { stepTwoDone }) {
  const labels = card.options.map((o) => o.label);
  const recommended = recommendedOf(card) ?? labels[0];
  const pick = (want) => labels.find((l) => l === want) ?? null;
  if (id === 'one-card' || /^plan-/.test(id)) return { label: stepTwoDone.customised ? 'Go ahead' : 'Customise' };
  // The builder question, where another agent's command line is installed: the path's agent.
  if (id === 'agent' && p.agent !== undefined) return { label: pick(p.agent) };
  if (id === 'real-users') return { label: pick('Not yet') };
  // A project kept on this computer: no backup folder is named, so no window or typed path is asked for.
  if (/^backup/.test(id)) return { label: pick('Not now, keep building') };
  // A pasted address on the join question; once it missed, the question asked again is answered as any join question is, with the path's host.
  if (id === 'join' && p.join) return { text: p.join };
  // The question asked again after a miss, a refusal or a held answer: the path's answers in turn, the last one standing.
  if (/^join-/.test(id) && p.reask) {
    const label = p.reask[Math.min(stepTwoDone.reasked, p.reask.length - 1)];
    stepTwoDone.reasked += 1;
    return { label: pick(label) };
  }
  if (id === 'host' || /^join/.test(id)) return { label: pick(p.host) };
  if (/^gitlab-where/.test(id)) return { label: pick(p.where === 'company' ? 'My company\'s GitLab' : PUBLIC_GITLAB) };
  if (/^host-tool-/.test(id) && p.tool === 'fetch') return { label: labels.find((l) => l.startsWith('Fetch')) ?? recommended };
  if (/^gitlab-address/.test(id)) return { text: COMPANY_ADDRESS };
  if (/^connection/.test(id) && p.way) {
    const way = labels.find((l) => l.startsWith(p.way));
    if (way) return { label: way };
  }
  return { label: recommended };
}

const bareLabel = (label) => String(label).replace(/ \(Recommended\)$/, '');

// The option a card recommends: the composer starts its description with "Recommended:".
export const recommendedOf = (card) => card.options.find((o) => /^Recommended:/.test(o.description ?? ''))?.label ?? null;

// ---- Running a path ----

export async function renderPath(name, { desktop = false, keep = false } = {}) {
  const p = PATHS[name];
  if (!p) throw new Error(`There is no path ${name}: choose one of ${Object.keys(PATHS).join(', ')}`);
  const scratch = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'wh-render-')));
  const home = path.join(scratch, 'wh');
  const user = path.join(scratch, p.userName ?? 'user');
  const config = path.join(user, 'claude config');
  const folder = path.join(user, 'Projects', p.folderName ?? 'Cafe Menu');
  for (const dir of [home, config, folder]) fs.mkdirSync(dir, { recursive: true });
  // A computer with Copilot signed in: its home holds a config with a signed-in user (only the key names are read).
  if (p.agent !== undefined) {
    fs.mkdirSync(path.join(user, '.copilot'), { recursive: true });
    fs.writeFileSync(path.join(user, '.copilot', 'config.json'), JSON.stringify({ loggedInUsers: [{ host: 'https://github.com', login: 'a-director' }] }));
    // The director's own Claude Code settings, the longest a step 6 card has to say about them: a longer history kept, an older
    // minimum version, and their own usage counting variables, which setup leaves as they are.
    const { telemetryEnv } = await import('../telemetry/env.js');
    fs.mkdirSync(path.join(user, '.claude'), { recursive: true });
    fs.writeFileSync(path.join(user, '.claude', 'settings.json'), JSON.stringify({
      cleanupPeriodDays: 365, minimumVersion: '2.0.0', env: Object.fromEntries(Object.keys(telemetryEnv(47801)).map((name) => [name, 'their-own-value'])),
    }));
  }
  const env = { WHEELHOUSE_HOME: process.env.WHEELHOUSE_HOME, CLAUDE_CONFIG_DIR: process.env.CLAUDE_CONFIG_DIR, WHEELHOUSE_RENDER_STEPS: process.env.WHEELHOUSE_RENDER_STEPS };
  // The pretend computer has no proxy: this computer's own proxy settings are put aside for the run.
  for (const k of Object.keys(process.env)) if (/proxy/i.test(k)) { env[k] = process.env[k]; delete process.env[k]; }
  process.env.WHEELHOUSE_HOME = home;
  process.env.CLAUDE_CONFIG_DIR = config;
  process.env.WHEELHOUSE_RENDER_STEPS = '1';
  fs.writeFileSync(path.join(home, 'render-world.json'), JSON.stringify({ ...p, pluginRoot: path.dirname(path.dirname(path.dirname(HERE))) }));
  const cards = [];
  const said = [];
  // Where each line was said: after how many cards.
  const heard = [];
  const tell = (line) => { said.push(line); heard.push(cards.length); };
  let end = null;
  try {
    const { setupRoutes } = await import('./engine.js');
    const { decide } = await import('../hooks/prompt-record.js');
    const { makeSigningKey, enrol } = await import('../state/signing.js');
    const { markStep, readJournal, addChanges } = await import('./journal.js');
    const { computer, publicKey } = makeSigningKey();
    enrol({ computer, publicKey, enrolledAt: '2026-11-16T00:00:00.000Z' });
    // A fresh copy of this module for the engine, so its STEPS are made with the world in place.
    const stepsModule = path.join(scratch, 'steps.mjs');
    fs.writeFileSync(stepsModule, `export { STEPS } from ${JSON.stringify(`${pathToFileURL(HERE).href}?${path.basename(scratch)}`)};\n`);
    let clock = T0.getTime();
    const now = () => new Date(clock);
    const routes = setupRoutes({ now, userHome: user, platform: p.platform, stepsModule });
    const client = {
      prState: async () => ({ ok: false }),
      state: { write: async (body) => ({ ok: true, id: body.id }), record: async (body) => ({ ok: true, id: body.event?.id }) },
      profile: { record: async () => ({ ok: true }) },
    };
    const state = { customised: false, reasked: 0, missed: false };
    // What the director's click returns: on the Desktop app, a card whose question an earlier card had shows that earlier
    // card, so the answer is the one given there.
    const answer = async (step, ask) => {
      const { id, card } = ask;
      if (desktop) {
        const { decide: swap } = await import('../hooks/card-check.js');
        const words = card.question.split('\n');
        const shortened = words[0].replace(/ \S+(\??)$/, '$1');
        const asked = { ...card, question: [shortened === words[0] ? `${words[0]} (reworded)` : shortened, ...words.slice(1)].join('\n') };
        const out = await swap({ cwd: folder, hook_event_name: 'PreToolUse', tool_name: 'AskUserQuestion', tool_input: { questions: [asked] } }, { now });
        const shown = out?.hookSpecificOutput?.updatedInput?.questions?.[0];
        if (shown === undefined) throw new Error(`card ${id}, reworded, was not swapped back by the card check`);
        if (shown.question !== card.question) throw new Error(`card ${id} came out of the card check as another card ("${shown.question.split('\n')[0]}")`);
      }
      let got = choose(p, { id, card }, { stepTwoDone: state });
      let stale = false;
      if (desktop) {
        const earlier = cards.find((c) => c.card.question === card.question && c.answer !== undefined && JSON.stringify(c.card) !== JSON.stringify(card));
        if (earlier) {
          got = earlier.answer;
          stale = true;
        }
      }
      if (id.startsWith('plan-') && (got.label === 'Customise' || got.label === 'Change a choice')) state.customised = true;
      cards.push({ step, id, kind: 'question', card, answer: got, ...(stale ? { stale: true } : {}) });
      const value = got.text ?? card.options.find((o) => bareLabel(o.label) === got.label)?.label ?? got.label;
      clock += 1000;
      await decide({
        cwd: folder, hook_event_name: 'PostToolUse', tool_name: 'AskUserQuestion',
        tool_input: { questions: [card] }, tool_response: { answers: { [card.question]: value } },
      }, { client, now: () => new Date(clock - 500) });
    };
    const plan = (step) => routes['/setup/plan']({ folder, step, ...(desktop ? { desktop: true } : {}) });
    const runId = () => readJournal().runs.find((r) => r.folder === folder)?.id;
    // The one card and Customise, until a Go ahead holds; asked again after a miss at step 3, until the plan's new Go ahead holds.
    const oneCard = async () => {
      for (let turn = 0; ; turn += 1) {
        if (turn > 20) { end = { step: 0, how: 'loop', why: 'the one card kept coming back' }; return false; }
        const got = await plan(0);
        if (got.done) return true;
        if (got.ask) await answer(0, got.ask);
        else if (got.asks) for (const ask of got.asks) await answer(ask.step, ask);
      }
    };
    if (!(await oneCard())) return { cards, end, said, heard };
    // Every step to the last, in the order setup asks them: step 9 waits for step 10. Step 2's Go ahead is taken as
    // done, with its fetch of a tool that can't be had refused, as on the computer; step 3's is carried out as its apply
    // leaves the computer; every later one is taken as done.
    const seen = new Map();
    for (const n of [1, 2, 3, 4, 5, 6, 7, 8, 10, 9]) {
      // A computer joining a project runs steps 1, 2, 3, 6, 7, 8 and 9 only.
      if (p.join && !p.miss && [4, 5, 10].includes(n)) continue;
      for (let turn = 0; ; turn += 1) {
        const got = await plan(n);
        if (got.done) break;
        // Step 9 on the Desktop app waits while the director's screen is locked, then sends the test and asks if it arrived.
        if (got.wait !== undefined && n === 9 && turn < 4) { tell(`setup waited ${Math.round(got.wait / 60000)} minutes for the phone test`); clock += got.wait; continue; }
        if (got.wait !== undefined) { end = { step: n, how: 'pause', why: got.why }; return { cards, end, said, heard }; }
        if (got.ok === false || got.error !== undefined) { end = { step: n, how: 'failed', why: got.error ?? got.why ?? JSON.stringify(got) }; return { cards, end, said, heard }; }
        if (got.ask) {
          const key = `${n}.${got.ask.id}`;
          seen.set(key, (seen.get(key) ?? 0) + 1);
          if (seen.get(key) > 2 || turn > 12) { end = { step: n, how: 'loop', why: `${key} was asked again with its answer given` }; return { cards, end, said, heard }; }
          await answer(n, got.ask);
          continue;
        }
        cards.push({ step: n, id: `go-ahead-${n}`, kind: 'go-ahead', card: got.card, covered: got.covered === true });
        if (n === 2) {
          const w = world();
          if (w.glab === 'unavailable' && got.changes.some((c) => c.action === 'fetch' && c.tool === 'glab')) tell('GitLab\'s own tool could not be fetched on this computer, so Wheelhouse will work with GitLab without it');
        }
        if (n === 3) {
          const w = world();
          // The project pasted holds no Wheelhouse settings: step 3's apply signs in, looks, and stops, so the miss comes after the
          // Go ahead and the sign-in, said as the apply says it, and the question is asked again.
          if (p.missAtApply && !state.missed) {
            state.missed = true;
            const { joinMissLine } = await import('./host.js');
            const at = new URL(COMPANY_ADDRESS).host;
            const { consentIn } = await import('./choices.js');
            const { answersFor } = await import('./clicks.js');
            const standing = consentIn(runId(), answersFor(runId()));
            tell(joinMissLine({ host: 'gitlab', wanted: `${USER}/cafe-menu`, found: [], at, user: USER }));
            addChanges(runId(), [{ id: `chg-render-miss-${clock}`, step: 3, kind: 'answer', target: 'step 3', before: null, after: { joined: `${USER}/cafe-menu`, missed: 'none', host: 'gitlab', user: USER, withdraws: { at: standing.at, id: standing.id }, address: true, at } }]);
            // The Go ahead given before the miss no longer holds: the one card is asked again, then every step from where setup stopped.
            if (!(await oneCard())) return { cards, end, said, heard };
            continue;
          }
          // A new product made under the name of a project that exists fails as the real apply fails.
          if (p.missAtApply && got.changes.some((c) => c.action === 'repository')) {
            end = { step: 3, how: 'failed', why: `${USER}/cafe-menu already exists on GitLab and wasn't set up with Wheelhouse, so setup won't use it for a new product: rename this folder, then start setup again from it` };
            return { cards, end, said, heard };
          }
          // A product kept on this computer connects to no host.
          if (got.changes.some((c) => c.action === 'home')) {
            w.connected = await keepAsStepThree({ folder, scratch, changes: got.changes });
            // As step 3's apply records the project's home it makes, so step 4 reads the product as new.
            const kept = got.changes.find((c) => c.action === 'home');
            addChanges(runId(), [{ id: `chg-render-home-${clock}`, step: 3, kind: 'folder', target: kept.target, before: null, after: { home: true, branch: kept.branch } }]);
          }
          else if (got.changes.some((c) => c.action === 'connection')) w.connected = await connectAsStepThree({ folder, scratch, changes: got.changes });
          fs.writeFileSync(path.join(home, 'render-world.json'), JSON.stringify(w));
          // A project joined, not made: the run records the repository it checked out, so it reads as a joining run.
          if (p.join) addChanges(runId(), [{ id: `chg-render-joined-${clock}`, step: 3, kind: 'answer', target: 'step 3', before: null, after: p.miss ? { joined: null } : { joined: `${USER}/cafe-menu`, found: true } }]);
        }
        clock += 1000;
        markStep(runId(), n, 'doneAt', { now });
        // The health check's board turns green, as the finish records it once the session's trials pass.
        if (n === 10) addChanges(runId(), [{ id: `chg-render-green-${clock}`, step: 10, kind: 'answer', target: 'step 10', before: null, after: { green: now().toISOString() } }]);
        break;
      }
    }
    end = { step: 10, how: 'finished' };
    return { cards, end, said, heard };
  } catch (error) {
    // A card refused as it went out (the same words as another card, say) ends the run with the cards so far.
    return { cards, end: { step: null, how: 'refused', why: error instanceof Error ? error.message : String(error) }, said, heard };
  } finally {
    for (const [k, v] of Object.entries(env)) if (v === undefined) delete process.env[k]; else process.env[k] = v;
    if (!keep) fs.rmSync(scratch, { recursive: true, force: true });
  }
}

// The cards as text, in order: each card's step, question, header, options with their descriptions, and the recommendation.
export function printCards(name, { cards, end, said, heard = [] }) {
  // Each line said goes after the card it followed, as the director reads them in turn.
  const sayAfter = (n) => said.forEach((line, i) => { if ((heard[i] ?? cards.length) === n) lines.push(`Said: ${line}`, ''); });
  const lines = [`## Path ${name}: ${PATHS[name].title}`, ''];
  sayAfter(0);
  cards.forEach((c, i) => {
    const recommended = recommendedOf(c.card);
    lines.push(`### Card ${i + 1} (step ${c.step}${c.kind === 'go-ahead' ? ', Go-ahead card' : ''}${c.covered ? ', covered by the Go ahead' : ''})`);
    lines.push(`Header: ${c.card.header}`);
    lines.push(...c.card.question.split('\n'));
    for (const o of c.card.options) lines.push(`- ${o.label}: ${o.description}`);
    lines.push(`Recommended: ${recommended ?? 'none'}`);
    if (c.answer) lines.push(`Answer: ${c.answer.text ?? c.answer.label}${c.stale ? ' (the earlier card\'s, as the Desktop app shows it)' : ''}`);
    lines.push('');
    sayAfter(i + 1);
  });
  lines.push(`End: step ${end?.step}, ${end?.how}${end?.why ? `: ${end.why}` : ''}`, '');
  return lines.join('\n');
}

if (startedAsScript(import.meta.url) && process.env.WHEELHOUSE_RENDER_STEPS !== '1') {
  const which = process.argv[2] && process.argv[2] !== '--desktop' ? process.argv[2] : 'all';
  const desktop = process.argv.includes('--desktop');
  for (const name of which === 'all' ? Object.keys(PATHS) : [which]) {
    process.stdout.write(printCards(name, await renderPath(name, { desktop })));
  }
}
