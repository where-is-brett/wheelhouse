// tests/scripts/setup/host.test.js
// Setup's step 3, the host and the connection: its questions (real users, Locked, the host, the
// connection), its list, the sign-in, the repositories and profile, the narrow connection on GitHub
// (a fake device sign-in and installation) and on GitLab (a fake API refusing the project key, and
// a fake system box), protection read back, and the project's record and state clone. Nothing real
// is signed in, created or pushed: `gh`, `glab`, the browser and the box are fakes, and git runs for
// real only against bare remotes in temporary folders. Every home is a scratch folder.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  hostStep, signIn, makeRepos, connectionCard, appFor, wheelhouseApp, wheelhouseAppOffered, narrowOffered, switchOnAsDirector,
  directorGitlabApi, directorGitEnv, productOf, repoName, slugFor, REAL_USERS, LEVELS, HOST_LABELS, WAYS, NO_APP_LISTED, OWN_APP_WAIT_MS, SIGN_UP,
  PROFILE_REPO, APP_FILE, KEY_NAME, INSTALL_WAIT_MS, STOPPED, NEW_PRODUCT, fromOtherComputer, quickLaunched, repoNamed, ORGS_UNREAD, launchedIn,
  checkOutJoined, findInstallation,
} from '../../../scripts/setup/host.js';
import { installationCovers } from '../../../scripts/host/connection.js';
import { writeProject } from '../../../scripts/lib/projects.js';
import { setupGit } from '../../../scripts/setup/git.js';
import { questionsStep } from '../../../scripts/setup/questions.js';
import { rulesStep } from '../../../scripts/setup/rules.js';
import { stepsFor, joinedRepo, onRunList, JOINING_STEPS, SETUP_STEPS } from '../../../scripts/lib/setup-run.js';
import { eventPath } from '../../../scripts/state/events.js';
import { cloneState } from '../../../scripts/state/clone.js';
import { STEPS, planHash } from '../../../scripts/setup/steps.js';
import { startRun, addChanges, findRun, readJournal } from '../../../scripts/setup/journal.js';
import { readKey, writeKey } from '../../../scripts/host/keys.js';
import { NOT_PUBLISHED } from '../../../scripts/setup/computers.js';
import { readProject } from '../../../scripts/lib/projects.js';
import { profileRemote } from '../../../scripts/profile/store.js';
import { stateDir, profileDir, wheelhouseHome, computerId } from '../../../scripts/lib/paths.js';
import { run as realRun } from '../../../scripts/lib/run.js';
import { composeCard } from '../../../scripts/cards/compose.js';
import { setLineOf, setupLine } from '../../../scripts/state/card-lines.js';
import { QUICK_LINE } from '../../../scripts/lib/host-lines.js';
import { QUICK_LINE as BOARD_QUICK_LINE } from '../../../scripts/board/health.js';
import { FREE_PLAN_LINE } from '../../../scripts/host/protection.js';
import { g } from '../../helpers/git-fixture.js';
import { tempFolder, withHome } from '../../helpers/homes.js';

const NOW = new Date('2026-10-20T03:00:00.000Z');
const USER = 'a-director';
const CLIENT_ID = 'Iv1.wheelhouse0001';
const ACCESS = 'ghu_accesskeyfortests0001';
const DIRECTOR_GITLAB = 'glpat-directors-own-token-0001';
const PASTED = 'glpat-pasted-into-the-box-0001';

// ---- A stand-in host: what `gh` and `glab` answer, with each repository a bare remote ----

async function seedBare(dir, readme) {
  fs.mkdirSync(path.dirname(dir), { recursive: true });
  const made = await realRun('git', ['init', '--bare', '-q', '-b', 'main', dir]);
  if (made.code !== 0) throw new Error('git init --bare failed');
  if (!readme) return;
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'wh-seed-'));
  try {
    await g(work, 'init', '-q', '-b', 'main');
    fs.writeFileSync(path.join(work, 'README.md'), '# made by the host\n');
    await g(work, 'add', 'README.md');
    await g(work, 'commit', '-q', '-m', 'Initial commit');
    await g(work, 'push', '-q', dir, 'main');
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
}

// state: { signedIn: { github, gitlab }, loginWorks, repos: { 'owner/name': { id } } }
function standIn(state = {}) {
  const root = tempFolder('wh-host-');
  const w = { signedIn: { github: true, gitlab: true }, loginWorks: true, repos: {}, calls: [], nextId: 40, ...state };
  w.root = root;
  w.hostUrl = ({ repo }) => path.join(root, `${repo}.git`);
  const answer = (stdout, code = 0, stderr = '') => ({ code, stdout, stderr });
  w.add = async (repo, { readme = true } = {}) => {
    w.nextId += 1;
    w.repos[repo] = { id: w.nextId };
    await seedBare(w.hostUrl({ repo }), readme);
    return w.repos[repo];
  };
  w.run = async (file, args = [], options = {}) => {
    const name = path.basename(file).replace(/\.exe$/, '');
    if (name === 'git' && w.gitFails?.(args)) return answer('', 1, 'refused by the test');
    if (name !== 'gh' && name !== 'glab') return realRun(file, args, options);
    const host = name === 'gh' ? 'github' : 'gitlab';
    w.calls.push({ tool: name, args: [...args], env: options.env });
    if (args[0] === 'auth' && args[1] === 'status') {
      if (!w.signedIn[host]) return answer('', 1, 'You are not logged into any hosts');
      return answer('', 0, args.includes('--show-token') ? `gitlab.com\n  ✓ Logged in to gitlab.com as ${USER}\n  ✓ Token found: ${DIRECTOR_GITLAB}\n` : 'Logged in');
    }
    if (args[0] === 'auth' && args[1] === 'login') {
      options.onOutput?.('! First copy your one-time code: AB12-CD34\n');
      if (w.loginWorks) w.signedIn[host] = true;
      return answer('');
    }
    if (args[0] === 'api' && args[1] === 'user') {
      if (!w.signedIn[host]) return answer('', 1, 'HTTP 401');
      return answer(JSON.stringify(host === 'github' ? { login: USER } : { username: USER }));
    }
    if (args[0] === 'api' && args[1].startsWith('repos/')) {
      const repo = args[1].slice('repos/'.length);
      const found = w.repos[repo];
      return found ? answer(JSON.stringify({ full_name: repo, id: found.id, default_branch: 'main' })) : answer('', 1, 'gh: Not Found (HTTP 404)');
    }
    if (args[0] === 'api' && args[1].startsWith('apps/')) {
      const app = w.apps?.[args[1].slice('apps/'.length)];
      if (!app) return answer('', 1, 'gh: Not Found (HTTP 404)');
      return answer(JSON.stringify({ slug: app.slug, client_id: app.clientId, owner: { login: app.owner, type: app.org ? 'Organization' : 'User' }, permissions: app.permissions }));
    }
    if (args[0] === 'api' && args[1].startsWith('user/memberships/orgs')) return w.orgsFail ? answer('', 1, 'gh: Server Error (HTTP 502)') : answer(JSON.stringify(w.memberships ?? []));
    if (args[0] === 'repo' && args[1] === 'create') {
      await w.add(args[2], { readme: args.includes('--add-readme') });
      return answer(`https://github.com/${args[2]}\n`);
    }
    return answer('', 1, 'unknown command');
  };
  // GitLab's API with the director's sign-in: projects by path or number, made private, and project
  // keys, refused when `refuseKeys`.
  w.api = {
    keys: [],
    async get(p) {
      if (p.startsWith('/groups?')) return { status: 200, body: (w.groups ?? []).map((full_path) => ({ full_path })) };
      const key = decodeURIComponent(p.replace(/^\/projects\//, ''));
      const [repo, found] = Object.entries(w.repos).find(([r, v]) => r === key || String(v.id) === key) ?? [];
      return found ? { status: 200, body: { id: found.id, path_with_namespace: repo, default_branch: 'main' } } : { status: 404, body: null };
    },
    async post(p, body) {
      w.calls.push({ api: 'post', path: p, body });
      if (p === '/projects') {
        const made = await w.add(`${USER}/${body.path}`, { readme: body.initialize_with_readme === true });
        return { status: 201, body: { id: made.id, path_with_namespace: `${USER}/${body.path}` } };
      }
      if (p.endsWith('/access_tokens')) {
        if (w.keyAnswer === 'unreachable') throw new Error('Could not reach GitLab');
        if (w.keyAnswer !== undefined) return { status: w.keyAnswer, body: { message: 'no' } };
        if (w.refuseKeys) return { status: 403, body: { message: 'forbidden' } };
        w.api.keys.push(body);
        return { status: 201, body: { id: 900 + w.api.keys.length, token: `glpat-project-key-${w.api.keys.length}`, expires_at: body.expires_at } };
      }
      return { status: 404, body: null };
    },
    async put() { return { status: 404, body: null }; },
    async delete() { return { status: 404, body: null }; },
  };
  return w;
}

// ---- A fake GitHub for the device sign-in and the app's installation ----

// `reach` is the list of repositories the installation reaches; a test adds to it as the director
// would tick one.
// `app` is the app installed, on `account`; `flowOff` how many times GitHub first answers that its
// device flow is switched off. `others` are the app's installations on other accounts, each
// { id, account, reach, installedAfter } (`installedAfter` counted in looks, as above).
function github({ installedAfter = 1, reach = [], onSignedIn = () => {}, app = { clientId: CLIENT_ID, slug: 'wheelhouse-test' }, flowOff = 0, account = USER, others = [] } = {}) {
  const calls = [];
  let pending = 1;
  let installLooks = 0;
  let codes = 0;
  const reply = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
  const fetch = async (url, init = {}) => {
    calls.push({ url, auth: init.headers?.Authorization ?? null });
    if (url === 'https://github.com/login/device/code') {
      codes += 1;
      if (codes <= flowOff) return reply(200, { error: 'device_flow_disabled' });
      return reply(200, { device_code: 'dev-1', user_code: 'WXYZ-1234', verification_uri: 'https://github.com/login/device', interval: 1, expires_in: 900 });
    }
    if (url === 'https://github.com/login/oauth/access_token') {
      if (pending-- > 0) return reply(200, { error: 'authorization_pending' });
      onSignedIn();
      return reply(200, { access_token: ACCESS, expires_in: 28800, refresh_token: 'ghr_renewalkeyfortests1', refresh_token_expires_in: 15811200 });
    }
    if (url.startsWith('https://api.github.com/user/installations?')) {
      installLooks += 1;
      const ours = (id, login) => ({ id, client_id: app.clientId, app_slug: app.slug, account: { login, type: 'User' } });
      return reply(200, {
        installations: [
          { id: 5, client_id: 'Iv1.someoneelse', app_slug: 'other', account: { login: account } },
          ...(installLooks > installedAfter ? [ours(77, account)] : []),
          ...others.filter((o) => installLooks > (o.installedAfter ?? 0)).map((o) => ours(o.id, o.account)),
        ],
      });
    }
    const listing = /^https:\/\/api\.github\.com\/user\/installations\/(\d+)\/repositories/.exec(url);
    if (listing) {
      const id = Number(listing[1]);
      const other = others.find((o) => o.id === id);
      if (id !== 77 && !other) return reply(404, {});
      return reply(200, { repositories: (id === 77 ? reach : other.reach).map((full_name) => ({ full_name })) });
    }
    return reply(404, {});
  };
  return { fetch, calls, reach };
}

function appFile(dir, app = { clientId: CLIENT_ID, slug: 'wheelhouse-test', owner: 'wheelhouse-org' }) {
  const file = path.join(dir, 'app.json');
  fs.writeFileSync(file, JSON.stringify(app));
  return file;
}

const NO_APP = path.join(os.tmpdir(), 'wh-no-such-app.json');

// ---- The step, driven ----

const ctxFor = (folder, extra = {}) => ({ folder, step: 3, now: () => NOW, platform: 'darwin', userHome: folder, answers: {}, ...extra });
const said = (label) => ({ label, text: null, at: NOW.toISOString() });

// Plans the step, answering each question with the label `pick(id, card)` gives, until it lists its
// changes. Gives the list, the answers and the questions asked, in order.
async function answerAll(step, ctx, pick) {
  const answers = { ...(ctx.answers ?? {}) };
  const asked = [];
  for (let i = 0; i < 8; i += 1) {
    const got = await step.plan({ ...ctx, answers });
    if (!got.ask) return { ...got, answers, asked };
    asked.push(got.ask);
    answers[`3.${got.ask.id}`] = said(pick(got.ask.id, got.ask.card));
  }
  throw new Error('the step kept asking');
}

const choose = ({ realUsers = REAL_USERS.no, locked = LEVELS.standard, host = HOST_LABELS.github, way = WAYS.quick } = {}) => (id) => {
  if (id === 'real-users') return realUsers;
  if (id === 'locked') return locked;
  if (id === 'host') return host;
  if (id.startsWith('connection-')) return way;
  throw new Error(`asked ${id}`);
};

// Applies the step's list as the engine does, each change recorded in the journal as it is made,
// with what it says kept in order.
async function applyStep(step, folder, changes, extra = {}) {
  const run = startRun({ folder, now: () => NOW });
  const lines = [];
  const ctx = ctxFor(folder, {
    runId: run.id,
    say: (line) => { lines.push(line); },
    record: (made) => addChanges(run.id, (Array.isArray(made) ? made : [made]).map((c) => ({ ...c, step: 3 }))),
    ...extra,
  });
  await step.apply(ctx, changes);
  return { lines, run: findRun(folder) };
}

const productFolder = (name = 'Shop') => {
  const folder = fs.realpathSync.native(tempFolder('wh-proj '));
  const product = path.join(folder, name);
  fs.mkdirSync(path.join(product, '.claude'), { recursive: true });
  fs.writeFileSync(path.join(product, 'notes.txt'), 'the director\'s own notes\n');
  fs.writeFileSync(path.join(product, '.claude', 'settings.json'), '{"enabledPlugins":{"wheelhouse@wheelhouse":true}}\n');
  return product;
};

const withOrigin = async (folder, url) => {
  await g(folder, 'init', '-q', '-b', 'main');
  await g(folder, 'remote', 'add', 'origin', url);
};

const stepFor = (w, extra = {}) => hostStep({
  run: w.run, appFile: NO_APP, hostUrl: w.hostUrl, findGit: async () => ({ ok: true, path: 'git' }), gitlab: async () => w.api,
  open: async () => {}, sleep: async () => {}, ...extra,
});

// ---- The tests ----

test('step 3 is long, waits for step 2, and plans without failing while git and the host tool are missing', async () => {
  await withHome(async () => {
    const step = STEPS.find((s) => s.n === 3);
    assert.equal(step.long, true);
    assert.deepEqual(step.after, [2]);
    assert.deepEqual(step.asksDuring, [2], 'its questions are asked while step 2\'s installers run (ruling R54)');
    const folder = productFolder();
    const nothingHere = async () => { throw Object.assign(new Error('spawn gh ENOENT'), { code: 'ENOENT' }); };
    const bare = hostStep({ run: nothingHere, appFile: NO_APP });
    const planned = await answerAll(bare, ctxFor(folder), choose());
    assert.deepEqual(planned.changes[0], { kind: 'host', target: 'github', action: 'sign-in' });
    assert.ok(planned.changes.every((c) => !JSON.stringify(c).includes('undefined')));
  });
});

test('the plan asks about real users, then Locked on a Mac only, then the host, then the connection; Locked takes Quick away', async () => {
  await withHome(async () => {
    const folder = productFolder('Zoë app');
    const w = standIn();
    const step = stepFor(w);
    const mac = await answerAll(step, ctxFor(folder), choose({ realUsers: REAL_USERS.yes, locked: LEVELS.locked, way: WAYS.own }));
    assert.deepEqual(mac.asked.map((a) => a.id.replace(/-[0-9a-f]{10}$/, '')), ['real-users', 'locked', 'host', 'connection']);
    assert.match(mac.asked[0].card.what, /Does Zoe-app have real users/);
    const connection = mac.asked[3].card;
    assert.deepEqual(connection.options.map((o) => o.label), [WAYS.own], 'Locked: no Quick');
    assert.equal(mac.answers['3.real-users'].label, REAL_USERS.yes, 'step 4 reads this answer');
    assert.equal(mac.answers['3.locked'].label, LEVELS.locked, 'step 4 reads this answer');
    // Each question composes as a question card, with no set line.
    for (const a of mac.asked) {
      const { question } = composeCard({ ...a.card, kind: 'question' });
      assert.equal(setLineOf(question.question), null);
    }
    // On Windows, Locked is not offered: the connection comes after the host.
    const win = await answerAll(step, ctxFor(folder, { platform: 'win32' }), choose({ realUsers: REAL_USERS.yes }));
    assert.deepEqual(win.asked.map((a) => a.id.replace(/-[0-9a-f]{10}$/, '')), ['real-users', 'host', 'connection']);
    assert.ok(win.asked[2].card.options.some((o) => o.label === WAYS.quick));
    // Standard on a Mac keeps Quick.
    const standard = await answerAll(step, ctxFor(folder), choose({ realUsers: REAL_USERS.yes, locked: LEVELS.standard }));
    assert.ok(standard.asked[3].card.options.some((o) => o.label === WAYS.quick));
    assert.equal(repoName(folder), 'Zoe-app');
  });
});

test('the Wheelhouse app is not offered while it is not registered', async () => {
  assert.deepEqual(JSON.parse(fs.readFileSync(APP_FILE, 'utf8')), { clientId: null, slug: null, owner: null });
  assert.equal(wheelhouseApp(), null);
  assert.equal(wheelhouseAppOffered(), false);
  assert.equal(appFor({ views: () => null }), null, 'no app of their own is recorded, and Wheelhouse\'s is not registered');
  assert.equal(narrowOffered('github'), true);
  assert.equal(narrowOffered('gitlab'), true);
  assert.deepEqual(connectionCard({ host: 'github', where: `${USER}/shop on GitHub` }).options.map((o) => o.label), [WAYS.own, WAYS.quick]);
  const registered = appFile(tempFolder('wh-app-'));
  assert.equal(wheelhouseAppOffered({ appFile: registered }), true);
  assert.deepEqual(appFor({ appFile: registered, views: () => null }), { clientId: CLIENT_ID, slug: 'wheelhouse-test', owner: 'wheelhouse-org', own: false });
});

test('on GitHub the card offers the Wheelhouse app, their own app and Quick, and a Locked project is never offered Quick', async () => {
  const registered = appFile(tempFolder('wh-app-'));
  const labels = (card) => card.options.map((o) => o.label);
  const where = `${USER}/shop on GitHub`;
  const open = connectionCard({ host: 'github', where, appFile: registered });
  assert.deepEqual(labels(open), [WAYS.wheelhouse, WAYS.own, WAYS.quick]);
  assert.equal(open.recommend, WAYS.wheelhouse);
  assert.match(open.what, /a-director\/shop on GitHub/);
  assert.ok(open.options.find((o) => o.label === WAYS.quick).says.startsWith(QUICK_LINE), 'Quick carries its cost');
  assert.equal(BOARD_QUICK_LINE, QUICK_LINE, 'the board says the same line');
  assert.deepEqual(labels(connectionCard({ host: 'github', where, appFile: registered, locked: true })), [WAYS.wheelhouse, WAYS.own]);
  assert.deepEqual(labels(connectionCard({ host: 'gitlab', where })), [WAYS.narrow, WAYS.quick]);
  assert.deepEqual(labels(connectionCard({ host: 'gitlab', where, locked: true })), [WAYS.narrow]);
  for (const card of [open, connectionCard({ host: 'github', where, appFile: registered, locked: true }), connectionCard({ host: 'gitlab', where })]) {
    composeCard({ ...card, kind: 'question' });
  }
  // A Locked GitLab project is not asked: Narrow is all there is.
  await withHome(async () => {
    const folder = productFolder();
    await withOrigin(folder, `https://gitlab.com/${USER}/shop.git`);
    const w = standIn();
    const planned = await answerAll(stepFor(w), ctxFor(folder), choose({ realUsers: REAL_USERS.yes, locked: LEVELS.locked }));
    assert.deepEqual(planned.asked.map((a) => a.id), ['real-users', 'locked']);
    assert.deepEqual(planned.changes.find((c) => c.action === 'connection'), { kind: 'host', target: 'gitlab', action: 'connection', mode: 'narrow', locked: true });
  });
});

test('a Locked project with only their own app on offer still gets the card', async () => {
  await withHome(async () => {
    const folder = productFolder();
    await withOrigin(folder, `https://github.com/${USER}/shop.git`);
    const w = standIn();
    await w.add(`${USER}/shop`);
    const step = stepFor(w);
    const planned = await answerAll(step, ctxFor(folder), choose({ realUsers: REAL_USERS.yes, locked: LEVELS.locked, way: WAYS.own }));
    const card = planned.asked.at(-1).card;
    // Their own app is made at apply, from the card's Go ahead.
    assert.deepEqual(planned.changes.find((c) => c.action === 'own-app'), { kind: 'host', target: 'github', action: 'own-app', account: USER, name: `Wheelhouse ${USER}` });
    assert.deepEqual(card.options.map((o) => o.label), [WAYS.own], 'their own app, agreed to on the card, never by default');
    assert.match(card.what, /Quick is not offered/);
    const { question } = composeCard({ ...card, kind: 'question' });
    assert.deepEqual(question.options.map((o) => o.label), [WAYS.own, 'Explain more']);
    // A list naming no app is refused by apply too, before it makes anything.
    const list = [{ kind: 'host', target: 'github', action: 'connection', mode: 'narrow', locked: true }, { kind: 'file', target: 'x', action: 'project', repo: `${USER}/shop` }];
    await assert.rejects(applyStep(step, folder, list, { answers: planned.answers }), { message: NO_APP_LISTED });
    assert.deepEqual(readJournal().runs.flatMap((r) => r.changes), []);
    assert.ok(!w.calls.some((c) => c.args?.[0] === 'auth' && c.args[1] === 'login'));
  });
});

test('an existing sign-in is used with no browser step', async () => {
  await withHome(async () => {
    const w = standIn();
    const lines = [];
    assert.deepEqual(await signIn({ host: 'github', run: w.run, say: (l) => lines.push(l) }), { signedIn: true, user: USER });
    assert.ok(!w.calls.some((c) => c.args[1] === 'login'), 'no browser step');
    assert.deepEqual(lines, []);
    const folder = productFolder();
    const planned = await answerAll(stepFor(w), ctxFor(folder), choose());
    assert.ok(!planned.changes.some((c) => c.action === 'sign-in'));
    assert.doesNotMatch(planned.card.what, /sign in/);
    assert.equal(planned.director, 'One click');
    // Not signed in: the list and the card say so, with the sign-up page; the sign-in says its code.
    const out = standIn({ signedIn: { github: false, gitlab: false } });
    const fresh = await answerAll(stepFor(out), ctxFor(folder), choose());
    assert.deepEqual(fresh.changes[0], { kind: 'host', target: 'github', action: 'sign-in' });
    assert.ok(fresh.card.what.includes(SIGN_UP.github), fresh.card.what);
    assert.match(fresh.director, /sign-in in the browser/);
    const got = await signIn({ host: 'github', run: out.run, say: (l) => lines.push(l) });
    assert.deepEqual(got, { signedIn: true, user: USER });
    const login = out.calls.find((c) => c.args[1] === 'login');
    assert.deepEqual(login.args, ['auth', 'login', '--hostname', 'github.com', '--git-protocol', 'https', '--web']);
    assert.ok(lines[0].includes(SIGN_UP.github));
    assert.match(lines[1], /Type AB12-CD34 on GitHub's page/);
    // A sign-in not finished stops the step, said plainly.
    const stuck = standIn({ signedIn: { github: false }, loginWorks: false });
    await assert.rejects(signIn({ host: 'github', run: stuck.run }), /could not sign in to GitHub/);
  });
});

test('a new product gets a private repository; an existing one gets none', async () => {
  await withHome(async () => {
    const w = standIn();
    const folder = productFolder();
    const step = stepFor(w);
    const planned = await answerAll(step, ctxFor(folder), choose());
    assert.deepEqual(planned.changes.slice(0, 2), [
      { kind: 'host', target: 'github', action: 'repository', name: 'Shop', repo: `${USER}/Shop`, private: true },
      { kind: 'folder', target: folder, action: 'connect', branch: 'main' },
    ]);
    assert.equal(planHash((await answerAll(step, ctxFor(folder), choose())).changes), planHash(planned.changes), 'the same world, the same list');
    const hash = planHash(planned.changes);
    const { question } = composeCard({ ...planned.card, target: { step: 3, hash } });
    assert.equal(setLineOf(question.question), setupLine(3, hash));
    assert.match(question.question, /a private repository a-director\/Shop on GitHub with a README/);
    assert.doesNotMatch(question.question, /:\/\/|\.git\b/, 'repositories named as owner/name on GitHub, never an address');

    const { run, lines } = await applyStep(step, folder, planned.changes, { answers: planned.answers });
    const create = w.calls.filter((c) => c.args?.[0] === 'repo');
    assert.deepEqual(create.map((c) => c.args), [
      ['repo', 'create', `${USER}/Shop`, '--private', '--add-readme'],
      ['repo', 'create', `${USER}/${PROFILE_REPO}`, '--private', '--description', 'Wheelhouse\'s profile: settings and backups, kept by Wheelhouse'],
    ]);
    // The folder is connected in place: its own files kept, the repository's README written out,
    // its branch main at the repository's first commit.
    const remote = w.hostUrl({ repo: `${USER}/Shop` });
    assert.equal(fs.readFileSync(path.join(folder, 'notes.txt'), 'utf8'), 'the director\'s own notes\n');
    assert.ok(fs.existsSync(path.join(folder, '.claude', 'settings.json')));
    assert.equal(fs.readFileSync(path.join(folder, 'README.md'), 'utf8'), '# made by the host\n');
    assert.equal(await g(folder, 'rev-parse', 'HEAD'), await g(remote, 'rev-parse', 'main'));
    assert.equal(await g(folder, 'symbolic-ref', '--short', 'HEAD'), 'main');
    assert.equal(await g(folder, 'config', '--get', 'remote.origin.url'), remote);
    assert.match(await g(folder, 'status', '--porcelain'), /\?\? notes\.txt/);
    // Its record, then its state clone, whose branch did not become the default.
    const slug = slugFor(`${USER}/Shop`);
    assert.deepEqual(readProject(slug), { folder, remoteUrl: remote, host: 'github', repo: `${USER}/Shop`, connection: { host: 'github', mode: 'quick', project: `${USER}/Shop` } });
    assert.ok(fs.existsSync(path.join(stateDir(slug), '.git')));
    assert.notEqual(await g(remote, 'rev-parse', 'refs/heads/wheelhouse-state'), '');
    assert.equal(await g(remote, 'symbolic-ref', 'HEAD'), 'refs/heads/main');
    // Each change in the journal, in the order made.
    assert.deepEqual(run.changes.map((c) => [c.kind, c.target.replace(wheelhouseHome(), '~').replace(folder, '<folder>')]), [
      ['host', `github:${USER}/Shop`],
      ['folder', path.join('<folder>', '.git')],
      ['host', `github:${USER}/${PROFILE_REPO}`],
      ['file', path.join('~', 'profile.json')],
      ['folder', path.join('~', 'profile')],
      ['file', path.join('~', 'projects', slug, 'project.json')],
      ['folder', path.join('~', 'projects', slug, 'state')],
      // This computer's key, put in the profile last (ruling R79).
      ['host', `github:${USER}/${PROFILE_REPO}:enrolments/${computerId()}.json`],
    ]);
    assert.deepEqual(run.changes[0].after, { repository: `${USER}/Shop`, private: true, made: true });
    assert.match(lines.at(-1), /Connected: a-director\/Shop on GitHub, Quick/);
    // Applied again (a retry), nothing new is made.
    const again = await applyStep(step, folder, planned.changes, { answers: planned.answers });
    assert.deepEqual(again.run.changes.filter((c) => c.kind === 'host'), []);
    assert.equal(w.calls.filter((c) => c.args?.[0] === 'repo').length, 2);

    // An existing product keeps its repository: none is made.
    const old = productFolder('old');
    await withOrigin(old, `git@github.com:${USER}/old.git`);
    await w.add(`${USER}/old`);
    const before = w.calls.length;
    const existing = await answerAll(step, ctxFor(old), choose());
    assert.ok(!existing.changes.some((c) => c.action === 'repository' || c.action === 'connect' || c.action === 'profile-repository'));
    assert.match(existing.card.what, /a-director\/old on GitHub, kept as it is/);
    await applyStep(step, old, existing.changes, { answers: existing.answers });
    assert.ok(!w.calls.slice(before).some((c) => c.args?.[0] === 'repo'));
    assert.equal(readProject(slugFor(`${USER}/old`)).remoteUrl, w.hostUrl({ repo: `${USER}/old` }));
    assert.equal(await g(old, 'config', '--get', 'remote.origin.url'), `git@github.com:${USER}/old.git`, 'the folder\'s own address is left as it is');
  });
});

test('step 3 lists this computer\'s key and puts it in the profile, pushed by its exact commit with the director\'s sign-in; a failed push stops the step and a fresh Go ahead publishes it (ruling R79)', async () => {
  await withHome(async () => {
    const w = standIn();
    const folder = productFolder();
    const pushes = [];
    // A call's own arguments, after the publish's no-hooks settings (ruling R106).
    const callOf = (args) => (args[0] === '-c' && args[2] === '-c' ? args.slice(4) : args);
    const run = async (file, args, options = {}) => {
      if (path.basename(file).replace(/\.exe$/, '') === 'git' && callOf(args)[0] === 'push') pushes.push({ args: [...args], env: options.env, cwd: options.cwd });
      return w.run(file, args, options);
    };
    const step = stepFor(w, { run });
    const planned = await answerAll(step, ctxFor(folder), choose());
    assert.deepEqual(planned.changes.at(-1), { kind: 'host', target: 'github', action: 'enrolment', computer: computerId(), fingerprint: null });
    assert.match(planned.card.what, /the project's record and state branch; this computer's key in your profile; protection/);
    // The profile's push is refused: the step stops, saying so, with the change recorded.
    w.gitFails = (args) => callOf(args)[0] === 'push' && String(args.at(-1)).endsWith(':refs/heads/wheelhouse-profile');
    await assert.rejects(applyStep(step, folder, planned.changes, { answers: planned.answers }), { message: NOT_PUBLISHED });
    const profileRemoteUrl = w.hostUrl({ repo: `${USER}/${PROFILE_REPO}` });
    const file = `enrolments/${computerId()}.json`;
    assert.equal((await realRun('git', ['cat-file', '-e', `wheelhouse-profile:${file}`], { cwd: profileRemoteUrl })).code !== 0, true);
    const branch = await g(profileDir(), 'rev-parse', 'refs/heads/wheelhouse-profile');
    assert.equal(await g(profileDir(), 'status', '--porcelain'), '');
    // A fresh Go ahead: published on the profile's tip, by the commit's own SHA, with the director's sign-in.
    w.gitFails = undefined;
    pushes.length = 0;
    const { run: journal } = await applyStep(step, folder, planned.changes, { answers: planned.answers });
    const tip = await g(profileRemoteUrl, 'rev-parse', 'wheelhouse-profile');
    const pushed = pushes.filter((p) => p.args.at(-1).endsWith(':refs/heads/wheelhouse-profile'));
    assert.deepEqual(pushed.map((p) => p.args), [[
      '-c', 'core.hooksPath=/dev/null', '-c', 'core.fsmonitor=false', 'push', '--no-verify', '--porcelain', profileRemoteUrl, `${tip}:refs/heads/wheelhouse-profile`,
    ]]);
    assert.notEqual(pushed[0].cwd, profileDir(), 'from a scratch repository, never the helper\'s profile clone');
    // Reaching the stand-in host's path, the one setup named, a local path is allowed (ruling R111).
    assert.deepEqual(pushed[0].env, { GIT_NO_REPLACE_OBJECTS: '1', ...directorGitEnv({ host: 'github', gitPath: 'git' }), GIT_ALLOW_PROTOCOL: 'https:file' });
    const own = JSON.parse(await g(profileRemoteUrl, 'show', `wheelhouse-profile:${file}`));
    assert.deepEqual(Object.keys(own), ['computer', 'publicKey', 'at']);
    assert.equal(own.computer, computerId());
    assert.equal(own.at, NOW.toISOString());
    // The helper's own branch never carries it.
    assert.equal(await g(profileDir(), 'rev-parse', 'refs/heads/wheelhouse-profile'), branch);
    assert.equal(await g(profileDir(), 'status', '--porcelain'), '');
    assert.deepEqual(journal.changes.filter((c) => c.target.endsWith(file)).map((c) => [c.kind, c.before]), [['host', null]]);
  });
});

test('a hook declared in the product folder\'s git config stops step 3, named, before git runs there with the director\'s sign-in (ruling R109)', async () => {
  await withHome(async () => {
    const w = standIn();
    const folder = productFolder();
    const mark = path.join(path.dirname(folder), 'hook-ran');
    await g(folder, 'init', '-q', '-b', 'main');
    await g(folder, 'config', 'hook.planted.event', 'reference-transaction');
    await g(folder, 'config', 'hook.planted.command', `echo ran >> "${mark}"`);
    const gits = [];
    const run = async (file, args, options = {}) => {
      if (path.basename(file).replace(/\.exe$/, '') === 'git') gits.push({ args: [...args], env: options.env, cwd: options.cwd });
      return w.run(file, args, options);
    };
    const step = stepFor(w, { run });
    const planned = await answerAll(step, ctxFor(folder), choose());
    await assert.rejects(applyStep(step, folder, planned.changes, { answers: planned.answers }), /setup doesn't allow \(hook\.planted\.event, hook\.planted\.command\)/);
    assert.equal(fs.existsSync(mark), false);
    assert.equal((await realRun('git', ['config', '--get', 'remote.origin.url'], { cwd: folder })).code !== 0, true, 'nothing was done in the folder');
    // Every git call step 3 made shut out git's global and system config, with hooks off.
    assert.ok(gits.length > 0);
    for (const c of gits) {
      assert.equal(c.env.GIT_CONFIG_NOSYSTEM, '1', c.args.join(' '));
      assert.equal(c.env.GIT_CONFIG_GLOBAL, '/dev/null');
    }
  });
});

test('the longest Go-ahead card composes within the card\'s length, for each host and way', async () => {
  await withHome(async () => {
    const folder = productFolder('A product whose folder has a very long name indeed, Zoë');
    const registered = appFile(tempFolder('wh-app-'));
    for (const [host, way] of [[HOST_LABELS.github, WAYS.wheelhouse], [HOST_LABELS.github, WAYS.own], [HOST_LABELS.github, WAYS.quick], [HOST_LABELS.gitlab, WAYS.narrow]]) {
      const w = standIn({ signedIn: { github: false, gitlab: false } });
      const planned = await answerAll(stepFor(w, { appFile: registered }), ctxFor(folder), choose({ realUsers: REAL_USERS.yes, host, way }));
      const hash = planHash(planned.changes);
      const { question } = composeCard({ ...planned.card, target: { step: 3, hash } });
      assert.equal(setLineOf(question.question), setupLine(3, hash), `${host} ${way}`);
      for (const a of planned.asked) composeCard({ ...a.card, kind: 'question' });
    }
  });
});

test('STOP stops the step between its parts, with what it made still recorded', async () => {
  await withHome(async () => {
    const w = standIn();
    const folder = productFolder();
    const step = stepFor(w);
    const planned = await answerAll(step, ctxFor(folder), choose());
    await assert.rejects(applyStep(step, folder, planned.changes, { answers: planned.answers, stopped: () => true }), /STOP came on/);
    assert.deepEqual(readJournal().runs.flatMap((r) => r.changes), [], 'stopped before anything was made');
    // STOP coming on after the repositories: they stay recorded; no record or state clone follows.
    let looks = 0;
    await assert.rejects(applyStep(step, folder, planned.changes, { answers: planned.answers, stopped: () => (looks += 1) > 3 }), /STOP came on/);
    const made = readJournal().runs.flatMap((r) => r.changes);
    assert.ok(made.some((c) => c.target === `github:${USER}/Shop`));
    assert.ok(!made.some((c) => c.target.endsWith('project.json')));
  });
});

test('a new product whose name is taken by a repository setup did not make is refused, plainly', async () => {
  await withHome(async () => {
    const w = standIn();
    await w.add(`${USER}/Shop`);
    const folder = productFolder();
    const step = stepFor(w);
    const planned = await answerAll(step, ctxFor(folder), choose());
    await assert.rejects(applyStep(step, folder, planned.changes, { answers: planned.answers }), /a-director\/Shop on GitHub already exists/);
    assert.equal(fs.existsSync(path.join(folder, '.git')), false);
  });
});

test('the profile repository is made once, and profile.json written in the shape the profile reads', async () => {
  await withHome(async () => {
    const w = standIn();
    const folder = productFolder();
    const step = stepFor(w);
    const planned = await answerAll(step, ctxFor(folder), choose());
    assert.deepEqual(planned.changes.filter((c) => c.action?.startsWith('profile')).map((c) => c.action), ['profile-repository', 'profile', 'profile-clone']);
    await applyStep(step, folder, planned.changes, { answers: planned.answers });
    const profileRepo = `${USER}/${PROFILE_REPO}`;
    assert.deepEqual(profileRemote(), {
      remoteUrl: w.hostUrl({ repo: profileRepo }), host: 'github', repo: profileRepo, connection: { host: 'github', mode: 'quick', project: profileRepo },
    });
    assert.ok(fs.existsSync(path.join(profileDir(), '.git')));
    assert.notEqual(await g(w.hostUrl({ repo: profileRepo }), 'rev-parse', 'refs/heads/wheelhouse-profile'), '');
    // A second product finds the profile: nothing more is made.
    const second = productFolder('second');
    await withOrigin(second, `https://github.com/${USER}/second.git`);
    await w.add(`${USER}/second`);
    const next = await answerAll(step, ctxFor(second), choose());
    assert.ok(!next.changes.some((c) => c.action?.startsWith('profile')));
    // A second computer: the account has the profile repository, this computer no profile.json.
    // It is used, not made again.
    fs.rmSync(path.join(wheelhouseHome(), 'profile.json'));
    fs.rmSync(profileDir(), { recursive: true, force: true });
    const third = await answerAll(step, ctxFor(second), choose());
    assert.ok(third.changes.some((c) => c.action === 'profile-repository'));
    const made = await makeRepos({ host: 'github', owner: USER, name: 'second', isNew: false, run: w.run, hostUrl: w.hostUrl });
    assert.deepEqual(made.map((c) => c.kind), ['file', 'folder'], 'no host change: the repository was there');
    assert.equal(w.calls.filter((c) => c.args?.[0] === 'repo' && c.args[2] === profileRepo).length, 1);
    assert.equal(profileRemote().repo, profileRepo);
  });
});

test('narrow on GitHub: the code and the Install page are said, the installation is found and kept, and its reach is read back', async () => {
  await withHome(async () => {
    const w = standIn();
    await w.add(`${USER}/shop`);
    const folder = productFolder('shop');
    await withOrigin(folder, `https://github.com/${USER}/shop.git`);
    // The director ticks only the project on the Install page, then the profile on the settings page.
    const gh = github({ reach: [`${USER}/shop`] });
    const opened = [];
    const open = async (url) => {
      opened.push(url);
      if (url === 'https://github.com/settings/installations/77') gh.reach.push(`${USER}/${PROFILE_REPO}`, `${USER}/next`);
    };
    const registered = appFile(tempFolder('wh-app-'));
    const step = stepFor(w, { appFile: registered, fetch: gh.fetch, open });
    const planned = await answerAll(step, ctxFor(folder), choose({ realUsers: REAL_USERS.yes, locked: LEVELS.standard, way: WAYS.wheelhouse }));
    assert.deepEqual(planned.changes.find((c) => c.action === 'connection').app, { clientId: CLIENT_ID, slug: 'wheelhouse-test', own: false });
    assert.match(planned.director, /a code typed on GitHub, Authorise, and two ticks on the Install page/);
    const { lines, run } = await applyStep(step, folder, planned.changes, { answers: planned.answers });
    assert.match(lines[0], /^Type WXYZ-1234 at https:\/\/github\.com\/login\/device, then click Authorise$/);
    assert.match(lines[1], /tick a-director\/shop on GitHub and a-director\/wheelhouse-profile on GitHub \(not All repositories\)/);
    assert.match(lines[2], /can't reach a-director\/wheelhouse-profile on GitHub yet/);
    assert.match(lines[3], /The app can reach a-director\/shop on GitHub and a-director\/wheelhouse-profile on GitHub/);
    assert.deepEqual(opened, ['https://github.com/login/device', 'https://github.com/apps/wheelhouse-test/installations/new', 'https://github.com/settings/installations/77']);
    const keys = readKey('github-app');
    assert.equal(keys.clientId, CLIENT_ID, 'renewing needs the client ID');
    assert.equal(keys.installationId, 77, 'the reach check needs the installation');
    assert.equal(keys.accessToken, ACCESS);
    const record = readProject(slugFor(`${USER}/shop`));
    assert.deepEqual(record.connection, { host: 'github', mode: 'narrow', project: `${USER}/shop`, installationId: 77 });
    assert.equal(profileRemote().connection.mode, 'narrow');
    // No key in the journal or anything said.
    const kept = JSON.stringify(run) + lines.join('\n');
    assert.ok(!kept.includes(ACCESS) && !kept.includes('ghr_'), 'no key is kept in the journal or said');
    assert.ok(run.changes.some((c) => c.kind === 'host' && c.target === 'key github-app'));
    // Setup's own git and host calls used the director's sign-in, never the app's key.
    assert.ok(w.calls.every((c) => !c.env?.GH_TOKEN));

    // A later project: no new code, only a tick on the app's settings page.
    await w.add(`${USER}/next`);
    gh.reach.splice(0, gh.reach.length, `${USER}/shop`, `${USER}/${PROFILE_REPO}`);
    const next = productFolder('next');
    await withOrigin(next, `https://github.com/${USER}/next.git`);
    opened.length = 0;
    const later = await answerAll(step, ctxFor(next), choose({ realUsers: REAL_USERS.yes, locked: LEVELS.standard, way: WAYS.wheelhouse }));
    assert.equal(later.changes.find((c) => c.action === 'connection').appKeys, 'installed');
    assert.match(later.director, /a tick on the app's settings page/);
    assert.match(later.card.what, /tick this project on its settings page/);
    const codes = gh.calls.filter((c) => c.url === 'https://github.com/login/device/code').length;
    const second = await applyStep(step, next, later.changes, { answers: later.answers });
    assert.equal(gh.calls.filter((c) => c.url === 'https://github.com/login/device/code').length, codes, 'no new code sign-in');
    assert.deepEqual(opened, ['https://github.com/settings/installations/77']);
    assert.match(second.lines[0], /can't reach a-director\/next on GitHub yet/);
    assert.match(second.lines.at(-2), /The app can reach a-director\/next on GitHub and a-director\/wheelhouse-profile on GitHub/);
  });
});

test('a refused GitLab project key falls back to the system\'s box, never the chat', async () => {
  await withHome(async () => {
    const w = standIn({ refuseKeys: true });
    await w.add(`${USER}/shop`);
    const folder = productFolder('shop');
    await withOrigin(folder, `https://gitlab.com/${USER}/shop.git`);
    const opened = [];
    const boxes = [];
    const step = stepFor(w, {
      open: async (url) => { opened.push(url); },
      askSecret: async (box, platform) => { boxes.push({ box, platform }); return `${PASTED}\n`; },
    });
    const planned = await answerAll(step, ctxFor(folder), choose({ way: WAYS.narrow }));
    assert.match(planned.card.what, /Developer project keys for the project and profile/);
    assert.match(planned.card.what, /"pipelines must succeed" only where there is a pipeline/);
    const { lines, run } = await applyStep(step, folder, planned.changes, { answers: planned.answers });
    const project = w.repos[`${USER}/shop`].id;
    const profile = w.repos[`${USER}/${PROFILE_REPO}`].id;
    for (const id of [project, profile]) assert.deepEqual(readKey(`gitlab-project-${id}`), { kind: 'pasted-token', token: PASTED, expiresAt: null });
    assert.equal(boxes.length, 1, 'one box, for both');
    assert.equal(boxes[0].platform, 'darwin');
    assert.match(boxes[0].box.prompt, /never the chat/);
    assert.ok(opened[0].startsWith('https://gitlab.com/-/user_settings/personal_access_tokens'), opened[0]);
    assert.ok(lines.some((l) => /paste it into the box your computer shows: never into the chat/.test(l)));
    const kept = JSON.stringify(run) + lines.join('\n') + JSON.stringify(w.calls);
    assert.ok(!kept.includes(PASTED) && !kept.includes(DIRECTOR_GITLAB), 'no token is kept, said or passed in an argument');
    assert.deepEqual(readProject(slugFor(`${USER}/shop`)).connection, { host: 'gitlab', mode: 'narrow', project: `${USER}/shop`, baseUrl: 'https://gitlab.com', projectId: project });
  });
  // Where GitLab makes it: a Developer's key for each, with nothing for the director to do.
  await withHome(async () => {
    const keyed = standIn();
    await keyed.add(`${USER}/shop`);
    const other = productFolder('shop');
    await withOrigin(other, `https://gitlab.com/${USER}/shop.git`);
    const keyStep = stepFor(keyed, { askSecret: async () => { throw new Error('no box should open'); } });
    const plannedKeyed = await answerAll(keyStep, ctxFor(other), choose({ way: WAYS.narrow }));
    await applyStep(keyStep, other, plannedKeyed.changes, { answers: plannedKeyed.answers });
    assert.deepEqual(keyed.api.keys.map((k) => [k.name, k.access_level, k.scopes]), [[KEY_NAME, 30, ['api', 'write_repository']], [KEY_NAME, 30, ['api', 'write_repository']]]);
    assert.equal(readKey(`gitlab-project-${keyed.repos[`${USER}/shop`].id}`).kind, 'project-key');
  });
});

test('the director\'s GitLab sign-in is read by the helper alone and sent only in a request\'s header', async () => {
  await withHome(async () => {
    const w = standIn();
    const sent = [];
    const fetch = async (url, init) => {
      sent.push({ url, init });
      return { status: 200, text: async () => '{"id":1}' };
    };
    const api = await directorGitlabApi({ run: w.run, fetch });
    await api.get('/projects/1');
    assert.equal(sent[0].init.headers.Authorization, `Bearer ${DIRECTOR_GITLAB}`);
    assert.deepEqual(w.calls.at(-1).args, ['auth', 'status', '--hostname', 'gitlab.com', '--show-token']);
    assert.ok(w.calls.every((c) => !(c.args ?? []).join(' ').includes(DIRECTOR_GITLAB)), 'never in an argument');
    const out = standIn({ signedIn: { gitlab: false } });
    await assert.rejects(directorGitlabApi({ run: out.run, fetch }), /glab is not signed in/);
    // git's environment: the director's tool as its credential helper, never a key.
    const env = directorGitEnv({ host: 'gitlab', gitPath: '/usr/bin/git', env: { PATH: '/bin' }, platform: 'darwin' });
    assert.equal(env.GIT_CONFIG_VALUE_1, '!"glab" auth git-credential');
    assert.equal(env.PATH, '/usr/bin:/bin');
    assert.equal(directorGitEnv({ host: 'github', gitPath: 'C:\\Program Files\\Git\\cmd\\git.exe', env: { Path: 'C:\\Windows' }, platform: 'win32' }).Path, 'C:\\Program Files\\Git\\cmd;C:\\Windows');
  });
});

// A GitLab API that keeps protected branches and the project's pipeline rule, for protection.
function gitlabProtection({ pipelines }) {
  const branches = {};
  const project = { id: 41, default_branch: 'main', only_allow_merge_if_pipeline_succeeds: false };
  const level = (n) => [{ access_level: n, access_level_description: { 0: 'No one', 30: 'Developers + Maintainers', 40: 'Maintainers' }[n] }];
  const puts = [];
  return {
    puts,
    async get(p) {
      if (/\/protected_branches\//.test(p)) {
        const b = branches[decodeURIComponent(p.split('/').at(-1))];
        return b ? { status: 200, body: b } : { status: 404, body: null };
      }
      if (/\/pipelines\?/.test(p)) return { status: 200, body: pipelines ? [{ id: 1 }] : [] };
      return { status: 200, body: project };
    },
    async post(p, body) {
      branches[body.name] = { push_access_levels: level(body.push_access_level), merge_access_levels: level(body.merge_access_level), allow_force_push: body.allow_force_push };
      return { status: 201, body: {} };
    },
    async put(p, body) {
      puts.push(body);
      Object.assign(project, body);
      return { status: 200, body: project };
    },
    async delete() { return { status: 204, body: null }; },
  };
}

test('GitLab pipelines must succeed only where a pipeline exists', async () => {
  const none = gitlabProtection({ pipelines: false });
  const quiet = await switchOnAsDirector({ host: 'gitlab', repo: 41, api: none });
  assert.deepEqual(none.puts, [], 'no pipeline: the rule is left off');
  assert.equal(quiet.on, true);
  assert.equal(quiet.askPipelines, true, 'the director is asked instead');
  assert.match(quiet.line, /no checks yet/);
  const piped = gitlabProtection({ pipelines: true });
  const ruled = await switchOnAsDirector({ host: 'gitlab', repo: 41, api: piped });
  assert.deepEqual(piped.puts, [{ only_allow_merge_if_pipeline_succeeds: true }]);
  assert.equal(ruled.askPipelines, false);
  assert.match(ruled.line, /requires pipelines to pass/);
});

test('protection is read back and said as it is', async () => {
  // GitHub took the rulesets without error, but reading them back shows none: said as not on.
  const calls = [];
  const answers = {
    'GET repos/o/r': { default_branch: 'main', private: false, owner: { type: 'User', login: 'o' } },
    'GET repos/o/r/rulesets': [],
    'POST graphql': { data: { repository: { ref: { target: { statusCheckRollup: null } } } } },
    'POST repos/o/r/rulesets': {},
  };
  const run = async (file, args, options) => {
    calls.push({ file, args, env: options?.env });
    const key = `${args[3]} ${args[1]}`;
    return Object.hasOwn(answers, key) ? { code: 0, stdout: JSON.stringify(answers[key]), stderr: '' } : { code: 1, stdout: '', stderr: 'HTTP 404' };
  };
  const got = await switchOnAsDirector({ host: 'github', repo: 'o/r', run });
  assert.deepEqual(got, { available: true, on: false, line: "GitHub's protection is available but not switched on for this project yet." });
  assert.ok(calls.every((c) => c.env && Object.keys(c.env).length === 0), 'the director\'s own sign-in: no key given');
  // GitHub's free plan on a private repository: said plainly, not as switched on.
  const free = {
    'GET repos/o/r': { default_branch: 'main', private: true, owner: { type: 'User', login: 'o' } },
    'GET user': { login: 'o', plan: { name: 'free' } },
  };
  const freeRun = async (file, args) => {
    const key = `${args[3]} ${args[1]}`;
    return Object.hasOwn(free, key) ? { code: 0, stdout: JSON.stringify(free[key]), stderr: '' } : { code: 1, stdout: '', stderr: 'HTTP 404' };
  };
  assert.deepEqual(await switchOnAsDirector({ host: 'github', repo: 'o/r', run: freeRun }), { available: false, on: false, line: FREE_PLAN_LINE });
});

test('the connection question names the repository, so an answer for one remote is never used for another', async () => {
  await withHome(async () => {
    const w = standIn();
    const folder = productFolder('shop');
    await withOrigin(folder, `https://github.com/${USER}/shop.git`);
    const step = stepFor(w);
    const first = await answerAll(step, ctxFor(folder), choose());
    const id = first.asked.at(-1).id;
    assert.match(first.asked.at(-1).card.what, /a-director\/shop on GitHub/);
    await g(folder, 'remote', 'set-url', 'origin', `https://github.com/${USER}/other.git`);
    const again = await step.plan(ctxFor(folder, { answers: first.answers }));
    assert.ok(again.ask, 'asked again');
    assert.notEqual(again.ask.id, id);
    assert.match(again.ask.card.what, /a-director\/other on GitHub/);
    // A folder with history of its own but no address is left as it is.
    const lone = productFolder('lone');
    await g(lone, 'init', '-q', '-b', 'main');
    await g(lone, 'add', 'notes.txt');
    await g(lone, 'commit', '-q', '-m', 'mine');
    assert.throws(() => productOf(lone), /its own git history but no GitHub or GitLab address/);
  });
});

// ---- The profile's account, the Install page's wait, retries, refusals and their own app ----

test('the profile repository goes on the director\'s own account, never the product\'s organisation or group', async () => {
  for (const [host, url, repo] of [
    ['github', 'https://github.com/acme/app.git', 'acme/app'],
    ['gitlab', 'https://gitlab.com/acme/team/app.git', 'acme/team/app'],
  ]) {
    await withHome(async () => {
      const w = standIn();
      await w.add(repo);
      const folder = productFolder('app');
      await withOrigin(folder, url);
      const step = stepFor(w);
      const planned = await answerAll(step, ctxFor(folder), choose());
      assert.equal(planned.changes.find((c) => c.action === 'profile-repository').repo, `${USER}/${PROFILE_REPO}`, host);
      await applyStep(step, folder, planned.changes, { answers: planned.answers });
      assert.equal(profileRemote().repo, `${USER}/${PROFILE_REPO}`, host);
      assert.ok(w.repos[`${USER}/${PROFILE_REPO}`], `${host}: made on the director's account`);
      assert.ok(!Object.keys(w.repos).some((r) => r.startsWith('acme/') && r.endsWith(PROFILE_REPO)), `${host}: none in the organisation`);
      assert.equal(readProject(slugFor(repo)).repo, repo);
    });
  }
});

// A clock the step reads, which its waits move on.
function clock(start = NOW) {
  let at = start.getTime();
  return { now: () => new Date(at), move: (ms) => { at += ms; }, sleep: async (ms) => { at += ms; } };
}

test('the Install page has its whole wait from when it opens, however long the code took', async () => {
  await withHome(async () => {
    const w = standIn();
    await w.add(`${USER}/shop`);
    const folder = productFolder('shop');
    await withOrigin(folder, `https://github.com/${USER}/shop.git`);
    const time = clock();
    // The director takes 9 minutes over the code; the app is installed 7 minutes after its page opens.
    const gh = github({ installedAfter: 84, reach: [`${USER}/shop`, `${USER}/${PROFILE_REPO}`], onSignedIn: () => time.move(9 * 60 * 1000) });
    const step = stepFor(w, { appFile: appFile(tempFolder('wh-app-')), fetch: gh.fetch, sleep: time.sleep });
    const planned = await answerAll(step, ctxFor(folder), choose({ realUsers: REAL_USERS.yes, locked: LEVELS.standard, way: WAYS.wheelhouse }));
    const { lines } = await applyStep(step, folder, planned.changes, { answers: planned.answers, now: time.now });
    assert.match(lines.at(-2), /The app can reach/);
    assert.equal(readKey('github-app').installationId, 77);
    assert.ok(INSTALL_WAIT_MS > 7 * 60 * 1000 && INSTALL_WAIT_MS < 9 * 60 * 1000 + 7 * 60 * 1000);
  });
});

test('a retry after the Install page timed out goes straight to the Install page, with no second code', async () => {
  await withHome(async () => {
    const w = standIn();
    await w.add(`${USER}/shop`);
    const folder = productFolder('shop');
    await withOrigin(folder, `https://github.com/${USER}/shop.git`);
    const time = clock();
    const gh = github({ installedAfter: Infinity, reach: [`${USER}/shop`, `${USER}/${PROFILE_REPO}`] });
    const opened = [];
    const registered = appFile(tempFolder('wh-app-'));
    const step = stepFor(w, { appFile: registered, fetch: gh.fetch, sleep: time.sleep, open: async (url) => { opened.push(url); } });
    const planned = await answerAll(step, ctxFor(folder), choose({ realUsers: REAL_USERS.yes, locked: LEVELS.standard, way: WAYS.wheelhouse }));
    await assert.rejects(applyStep(step, folder, planned.changes, { answers: planned.answers, now: time.now }), /The app was not installed after 8 minutes/);
    assert.equal(readKey('github-app').installationId, undefined, 'the keys are kept, with no installation');
    // Planned again: no code this time, only the Install page.
    const again = await answerAll(step, ctxFor(folder, { now: time.now }), choose({ realUsers: REAL_USERS.yes, locked: LEVELS.standard, way: WAYS.wheelhouse }));
    assert.equal(again.changes.find((c) => c.action === 'connection').appKeys, 'signed-in');
    assert.equal(again.director, 'One click, then two ticks on the app\'s Install page');
    assert.match(again.card.what, /as signed in already: tick the project and profile on its Install page/);
    const codes = gh.calls.filter((c) => c.url === 'https://github.com/login/device/code').length;
    opened.length = 0;
    // Installed once the page has opened: setup looks first, then opens it.
    const installed = github({ installedAfter: 1, reach: [`${USER}/shop`, `${USER}/${PROFILE_REPO}`] });
    const retry = stepFor(w, { appFile: registered, fetch: installed.fetch, sleep: time.sleep, open: async (url) => { opened.push(url); } });
    const { lines } = await applyStep(retry, folder, again.changes, { answers: again.answers, now: time.now });
    assert.equal(codes, 1);
    assert.equal(installed.calls.filter((c) => c.url === 'https://github.com/login/device/code').length, 0, 'no second code sign-in');
    assert.deepEqual(opened, ['https://github.com/apps/wheelhouse-test/installations/new']);
    assert.match(lines[0], /On the app's Install page/);
    assert.equal(readKey('github-app').installationId, 77);
  });
});

test('an existing product whose repository is empty is refused before its state branch could become the default', async () => {
  await withHome(async () => {
    const w = standIn();
    await w.add(`${USER}/empty`, { readme: false });
    const folder = productFolder('empty');
    await withOrigin(folder, `https://github.com/${USER}/empty.git`);
    const step = stepFor(w);
    const planned = await answerAll(step, ctxFor(folder), choose());
    await assert.rejects(applyStep(step, folder, planned.changes, { answers: planned.answers }),
      /a-director\/empty on GitHub has no branch of the product's yet, so Wheelhouse's state branch would become its default: push the product's main branch to it first/);
    assert.deepEqual(readJournal().runs.flatMap((r) => r.changes), [], 'nothing was made');
    assert.equal((await realRun('git', ['ls-remote', '--heads', w.hostUrl({ repo: `${USER}/empty` })])).stdout, '');
    // With the product's branch pushed, it goes ahead, and main stays the default.
    const work = tempFolder('wh-push-');
    await g(work, 'init', '-q', '-b', 'main');
    fs.writeFileSync(path.join(work, 'app.txt'), 'app\n');
    await g(work, 'add', 'app.txt');
    await g(work, 'commit', '-q', '-m', 'app');
    await g(work, 'push', '-q', w.hostUrl({ repo: `${USER}/empty` }), 'main');
    await applyStep(step, folder, planned.changes, { answers: planned.answers });
    assert.equal(await g(w.hostUrl({ repo: `${USER}/empty` }), 'symbolic-ref', 'HEAD'), 'refs/heads/main');
  });
});

test('STOP is read once the code sign-in returns, and while the browser sign-in waits', async () => {
  await withHome(async () => {
    const w = standIn();
    await w.add(`${USER}/shop`);
    const folder = productFolder('shop');
    await withOrigin(folder, `https://github.com/${USER}/shop.git`);
    let stop = false;
    const gh = github({ reach: [`${USER}/shop`], onSignedIn: () => { stop = true; } });
    const opened = [];
    const step = stepFor(w, { appFile: appFile(tempFolder('wh-app-')), fetch: gh.fetch, open: async (url) => { opened.push(url); } });
    const planned = await answerAll(step, ctxFor(folder), choose({ realUsers: REAL_USERS.yes, locked: LEVELS.standard, way: WAYS.wheelhouse }));
    await assert.rejects(applyStep(step, folder, planned.changes, { answers: planned.answers, stopped: () => stop }), { message: STOPPED });
    assert.equal(readKey('github-app'), null, 'no keys kept after STOP');
    assert.deepEqual(opened, ['https://github.com/login/device'], 'the Install page was not opened');
    // The browser sign-in: its program is given a signal that STOP aborts, and the step stops.
    const out = standIn({ signedIn: { github: false } });
    let signal = null;
    const run = async (file, args, options) => {
      if (args[1] === 'login') signal = options.signal;
      return out.run(file, args, options);
    };
    await assert.rejects(signIn({ host: 'github', run, stopped: () => true }), { message: STOPPED });
    assert.ok(signal instanceof AbortSignal);
  });
});

test('a retry finishes what an attempt left: the README written out, the profile clone made, .git recorded once', async () => {
  await withHome(async () => {
    const w = standIn();
    const folder = productFolder();
    const step = stepFor(w);
    const planned = await answerAll(step, ctxFor(folder), choose());
    await applyStep(step, folder, planned.changes, { answers: planned.answers });
    // As if the attempt had stopped after the reset, before the README was written out.
    fs.rmSync(path.join(folder, 'README.md'));
    const { run } = await applyStep(step, folder, planned.changes, { answers: planned.answers });
    assert.equal(fs.readFileSync(path.join(folder, 'README.md'), 'utf8'), '# made by the host\n');
    assert.ok(!run.changes.some((c) => c.target === path.join(folder, '.git')), '.git is not recorded again');
    // A README the director removes after their own first commit stays removed.
    await g(folder, 'rm', '-q', 'README.md');
    await g(folder, 'commit', '-q', '-m', 'no readme');
    await applyStep(step, folder, planned.changes, { answers: planned.answers });
    assert.equal(fs.existsSync(path.join(folder, 'README.md')), false);
    // A profile clone left part-way is listed by a later plan, and made.
    fs.rmSync(profileDir(), { recursive: true, force: true });
    const second = productFolder('second');
    await withOrigin(second, `https://github.com/${USER}/second.git`);
    await w.add(`${USER}/second`);
    const next = await answerAll(step, ctxFor(second), choose());
    assert.deepEqual(next.changes.filter((c) => c.action?.startsWith('profile')).map((c) => c.action), ['profile-clone']);
    await applyStep(step, second, next.changes, { answers: next.answers });
    assert.ok(fs.existsSync(path.join(profileDir(), '.git')));
    assert.deepEqual((await answerAll(step, ctxFor(second), choose())).changes.filter((c) => c.action?.startsWith('profile')), []);
  });
});

test('a folder whose git has an unborn branch of another name ends up on main', async () => {
  await withHome(async () => {
    const w = standIn();
    const folder = productFolder();
    await g(folder, 'init', '-q', '-b', 'master');
    const step = stepFor(w);
    const planned = await answerAll(step, ctxFor(folder), choose());
    await applyStep(step, folder, planned.changes, { answers: planned.answers });
    assert.equal(await g(folder, 'symbolic-ref', '--short', 'HEAD'), 'main');
    assert.equal(await g(folder, 'rev-parse', '--abbrev-ref', 'main@{upstream}'), 'origin/main');
  });
});

test('only a GitLab refusal opens the token page: a project not found or GitLab not reached stops plainly', async () => {
  for (const [answer, message] of [[404, /could not find the project/], [500, /HTTP 500/], ['unreachable', /Could not reach GitLab/]]) {
    await withHome(async () => {
      const w = standIn({ keyAnswer: answer });
      await w.add(`${USER}/shop`);
      const folder = productFolder('shop');
      await withOrigin(folder, `https://gitlab.com/${USER}/shop.git`);
      const opened = [];
      const step = stepFor(w, { open: async (url) => { opened.push(url); }, askSecret: async () => { throw new Error('no box should open'); } });
      const planned = await answerAll(step, ctxFor(folder), choose({ way: WAYS.narrow }));
      await assert.rejects(applyStep(step, folder, planned.changes, { answers: planned.answers }), message, String(answer));
      assert.deepEqual(opened, [], `${answer}: no token page`);
    });
  }
});

test('a new product\'s repository name never ends in a dash or a dot', () => {
  assert.equal(repoName(`/x/${'a'.repeat(49)} b`), 'a'.repeat(49));
  assert.equal(repoName(`/x/${'a'.repeat(48)}..b`), 'a'.repeat(48));
  assert.equal(repoName('/x/--Shop--'), 'Shop');
  assert.equal(repoName('/x/***'), 'product');
});

// ---- Their own GitHub App (Task 8b) ----

const OWN = { clientId: 'Iv23li.ownapp0001', slug: 'wheelhouse-a-director', owner: USER };
const MANIFEST_PERMISSIONS = { contents: 'write', pull_requests: 'write', issues: 'write', metadata: 'read' };

// The profile as the helper's routes give it, in memory: `accept` stands for the director's Confirm.
function memoryProfile(settings = {}) {
  const writes = [];
  const state = { settings: { ...settings }, unconfirmed: [] };
  return {
    writes,
    write: async ({ kind, data }) => {
      writes.push({ kind, data });
      state.unconfirmed.push({ kind, id: `ev-${writes.length}`, key: data.key, data });
      return { ok: true, id: `ev-${writes.length}`, pushed: true };
    },
    views: async () => structuredClone(state),
  };
}

test('narrow on GitHub is always offered, through their own app when Wheelhouse\'s is not registered', async () => {
  await withHome(async () => {
    const folder = productFolder();
    const w = standIn();
    const step = stepFor(w);
    const planned = await answerAll(step, ctxFor(folder), choose({ realUsers: REAL_USERS.yes, locked: LEVELS.standard, way: WAYS.own }));
    assert.deepEqual(planned.asked.at(-1).card.options.map((o) => o.label), [WAYS.own, WAYS.quick]);
    assert.equal(planned.asked.at(-1).card.recommend, WAYS.own, 'narrow is recommended for a product with real users');
    // A Go ahead, not a wait: their own app is made on the director's account at apply.
    assert.equal(planned.wait, undefined);
    assert.deepEqual(planned.changes.find((c) => c.action === 'own-app'), { kind: 'host', target: 'github', action: 'own-app', account: USER, name: `Wheelhouse ${USER}` });
    assert.deepEqual(planned.changes.find((c) => c.action === 'connection').app, { own: true, account: USER, name: `Wheelhouse ${USER}` });
    assert.match(planned.card.what, /your own GitHub App Wheelhouse a-director on a-director, filled in from Wheelhouse's: tick Enable Device Flow, click Create/);
    assert.match(planned.director, /Enable Device Flow ticked and Create clicked on GitHub, a code typed on GitHub/);
    const hash = planHash(planned.changes);
    composeCard({ ...planned.card, target: { step: 3, hash } });
    // Not signed in yet: the account is named once the director is.
    const out = standIn({ signedIn: { github: false, gitlab: false } });
    const unnamed = await answerAll(stepFor(out), ctxFor(folder), choose({ realUsers: REAL_USERS.yes, locked: LEVELS.standard, way: WAYS.own }));
    assert.deepEqual(unnamed.changes.find((c) => c.action === 'own-app'), { kind: 'host', target: 'github', action: 'own-app', account: null, name: null });
    composeCard({ ...unnamed.card, target: { step: 3, hash: planHash(unnamed.changes) } });
  });
});

test('their own app is made from the filled-in page, its device flow ticked, signed in, installed and recorded in the profile', async () => {
  await withHome(async () => {
    const w = standIn({ apps: {} });
    await w.add(`${USER}/shop`);
    const folder = productFolder('shop');
    await withOrigin(folder, `https://github.com/${USER}/shop.git`);
    const gh = github({ app: OWN, flowOff: 1, reach: [`${USER}/shop`, `${USER}/${PROFILE_REPO}`] });
    const opened = [];
    // The director clicks Create on the filled-in page.
    const open = async (url) => {
      opened.push(url);
      if (url.startsWith('https://github.com/settings/apps/new?')) w.apps[OWN.slug] = { ...OWN, permissions: MANIFEST_PERMISSIONS };
    };
    const profile = memoryProfile();
    const step = stepFor(w, { fetch: gh.fetch, open, profileRoutes: profile, views: () => null });
    const planned = await answerAll(step, ctxFor(folder), choose({ realUsers: REAL_USERS.yes, locked: LEVELS.standard, way: WAYS.own }));
    const { lines, run } = await applyStep(step, folder, planned.changes, { answers: planned.answers });
    assert.match(lines[0], /GitHub's form for your app Wheelhouse a-director is filled in: tick Enable Device Flow, then click Create GitHub App/);
    assert.match(lines[1], /^Tick Enable Device Flow on your app's page/);
    assert.match(lines[2], /^Type WXYZ-1234 at https:\/\/github\.com\/login\/device/);
    assert.match(lines[3], /tick a-director\/shop on GitHub and a-director\/wheelhouse-profile on GitHub/);
    assert.match(new URL(opened[0]).searchParams.get('public'), /^false$/);
    assert.deepEqual(opened.slice(1), [
      'https://github.com/settings/apps/wheelhouse-a-director', 'https://github.com/login/device', 'https://github.com/apps/wheelhouse-a-director/installations/new',
    ]);
    assert.equal(readKey('github-app').clientId, OWN.clientId, 'the sign-in\'s keys are for their app');
    assert.equal(readKey('github-app').installationId, 77);
    // Recorded in the profile once connected, with its value before, for uninstall.
    assert.deepEqual(profile.writes.map((x) => x.data.value), [OWN]);
    const kept = run.changes.find((c) => c.target === 'profile own-github-app');
    assert.deepEqual([kept.kind, kept.before, kept.after], ['host', null, OWN]);
    assert.ok(run.changes.findIndex((c) => c.target === 'key github-app') < run.changes.indexOf(kept));
    // Read back when it was found, and again before its code sign-in.
    assert.ok(w.calls.filter((c) => c.args?.[1] === `apps/${OWN.slug}`).length >= 2);
    assert.equal(profileRemote().connection.mode, 'narrow');
  });
});

test('a second computer uses the app the profile records, and refuses its code sign-in once its permissions grew', async () => {
  await withHome(async () => {
    const w = standIn({ apps: { [OWN.slug]: { ...OWN, permissions: MANIFEST_PERMISSIONS } } });
    await w.add(`${USER}/shop`);
    await w.add(`${USER}/${PROFILE_REPO}`, { readme: false });
    const folder = productFolder('shop');
    await withOrigin(folder, `https://github.com/${USER}/shop.git`);
    const confirmed = { settings: { 'own-github-app': { key: 'own-github-app', value: OWN } }, unconfirmed: [] };
    const gh = github({ app: OWN, reach: [`${USER}/shop`, `${USER}/${PROFILE_REPO}`] });
    const profile = memoryProfile(confirmed.settings);
    const step = stepFor(w, { fetch: gh.fetch, profileRoutes: profile, views: () => confirmed, appFile: appFile(tempFolder('wh-app-')) });
    const planned = await answerAll(step, ctxFor(folder), choose({ realUsers: REAL_USERS.yes, locked: LEVELS.standard, way: WAYS.own }));
    assert.deepEqual(planned.changes.find((c) => c.action === 'connection').app, { ...OWN, own: true });
    assert.ok(!planned.changes.some((c) => c.action === 'own-app'), 'nothing to make or record');
    // Its owner widened it on GitHub since: the sign-in stops before any code, naming what grew.
    w.apps[OWN.slug].permissions = { ...MANIFEST_PERMISSIONS, workflows: 'write', administration: 'read' };
    await assert.rejects(applyStep(step, folder, planned.changes, { answers: planned.answers }), /asks for more than Wheelhouse's: Workflows \(write\), Administration \(read\)/);
    assert.equal(gh.calls.filter((c) => c.url === 'https://github.com/login/device/code').length, 0);
    assert.equal(readKey('github-app'), null);
    // Set back: it signs in, and nothing more is recorded in the profile.
    w.apps[OWN.slug].permissions = MANIFEST_PERMISSIONS;
    await applyStep(step, folder, planned.changes, { answers: planned.answers });
    assert.equal(readKey('github-app').clientId, OWN.clientId);
    assert.deepEqual(profile.writes, []);
    // An app the profile records for another account than the project's: the step waits, saying why.
    const other = productFolder('app');
    await withOrigin(other, 'https://github.com/acme/app.git');
    await w.add('acme/app');
    const elsewhere = await answerAll(step, ctxFor(other), choose({ realUsers: REAL_USERS.yes, locked: LEVELS.standard, way: WAYS.own }));
    assert.equal(elsewhere.changes, undefined);
    assert.match(elsewhere.why, /Your own GitHub App, wheelhouse-a-director, belongs to a-director, .* so it can't reach acme\/app on GitHub/);
    // A second app of their own waits for a later update (rulings R58, R83): the line says what to choose there.
    assert.match(elsewhere.why, /choose the Wheelhouse app or Quick for it$/);
  });
});

test('their accepted app hidden by a newer change waiting is never made again: step 3 waits with a line naming the change (ruling R84)', async () => {
  await withHome(async () => {
    const w = standIn({ apps: { [OWN.slug]: { ...OWN, permissions: MANIFEST_PERMISSIONS } } });
    await w.add(`${USER}/shop`);
    const folder = productFolder('shop');
    await withOrigin(folder, `https://github.com/${USER}/shop.git`);
    const stray = { clientId: 'Iv23li.stray0001', slug: 'helpful-app', owner: 'mallory' };
    const waiting = (value) => ({
      settings: { 'own-github-app': { key: 'own-github-app', value: OWN } },
      unconfirmed: [{ kind: 'setting', id: 'ev-9', key: 'own-github-app', data: { key: 'own-github-app', value } }],
    });
    for (const [value, words] of [
      [stray, /holds your own GitHub App, wheelhouse-a-director on a-director, but a newer change to it waits for your Confirm \(helpful-app on mallory\), so step 3 waits rather than make another app/],
      [null, /a newer change to it waits for your Confirm \(no app of your own\)/],
      [OWN, /Your own GitHub App, wheelhouse-a-director on a-director, waits for your Confirm again in your profile/],
    ]) {
      const views = waiting(value);
      const step = stepFor(w, { profileRoutes: memoryProfile(views.settings), views: () => views });
      const planned = await answerAll(step, ctxFor(folder), choose({ realUsers: REAL_USERS.yes, locked: LEVELS.standard, way: WAYS.own }));
      assert.equal(planned.changes, undefined, 'no Go ahead, so no app is made');
      assert.equal(planned.wait, OWN_APP_WAIT_MS);
      assert.match(planned.why, words);
    }
    // With nothing accepted, a change waiting is a first record not confirmed yet: made or found by its name, as before.
    const first = { settings: {}, unconfirmed: [{ kind: 'setting', id: 'ev-1', key: 'own-github-app', data: { key: 'own-github-app', value: OWN } }] };
    const planned = await answerAll(stepFor(w, { profileRoutes: memoryProfile(), views: () => first }), ctxFor(folder), choose({ realUsers: REAL_USERS.yes, locked: LEVELS.standard, way: WAYS.own }));
    assert.ok(planned.changes.some((c) => c.action === 'own-app'));
  });
});

test('their own app on an organisation is made there only by an owner, and reaches the project but not the profile', async () => {
  await withHome(async () => {
    const acme = { clientId: 'Iv23li.acmeapp0001', slug: 'wheelhouse-acme', owner: 'acme', org: true, permissions: MANIFEST_PERMISSIONS };
    const w = standIn({ apps: {}, memberships: [{ role: 'member', state: 'active', organization: { login: 'acme' } }] });
    await w.add('acme/app');
    const folder = productFolder('app');
    await withOrigin(folder, 'https://github.com/acme/app.git');
    const gh = github({ app: acme, account: 'acme', reach: ['acme/app'] });
    const opened = [];
    const open = async (url) => {
      opened.push(url);
      if (url.startsWith('https://github.com/organizations/acme/settings/apps/new?')) w.apps[acme.slug] = acme;
    };
    const profile = memoryProfile();
    const step = stepFor(w, { fetch: gh.fetch, open, profileRoutes: profile, views: () => null });
    const planned = await answerAll(step, ctxFor(folder), choose({ realUsers: REAL_USERS.yes, locked: LEVELS.standard, way: WAYS.own }));
    assert.deepEqual(planned.changes.find((c) => c.action === 'own-app'), { kind: 'host', target: 'github', action: 'own-app', account: 'acme', name: 'Wheelhouse acme' });
    // A member, not an owner: refused before its page opens.
    await assert.rejects(applyStep(step, folder, planned.changes, { answers: planned.answers }), /Only an owner of acme on GitHub can make or install a GitHub App there/);
    assert.ok(!opened.some((u) => u.includes('/apps/')));
    // An owner: the organisation's page; the profile on their own account is reached Quick.
    w.memberships = [{ role: 'admin', state: 'active', organization: { login: 'acme' } }];
    const { lines } = await applyStep(step, folder, planned.changes, { answers: planned.answers });
    assert.ok(opened.some((u) => u.startsWith('https://github.com/organizations/acme/settings/apps/new?')));
    assert.match(lines.find((l) => l.includes('Install page')), /tick acme\/app on GitHub \(not All repositories\)/);
    assert.equal(profileRemote().connection.mode, 'quick');
    assert.deepEqual(readProject(slugFor('acme/app')).connection, { host: 'github', mode: 'narrow', project: 'acme/app', installationId: 77 });
    assert.deepEqual(profile.writes.map((x) => x.data.value), [{ clientId: acme.clientId, slug: acme.slug, owner: 'acme' }]);
  });
});

// ---- A recorded app held to GitHub's owner, and one app's keys per computer ----

test('a recorded app whose owner on GitHub is not the record\'s is refused at use, before any code or key', async () => {
  await withHome(async () => {
    // A writer recorded its own app, asking for no more than the manifest, naming the director as owner.
    const theirs = { clientId: 'Iv23li.mallory0001', slug: 'helpful-app', owner: 'mallory' };
    const w = standIn({ apps: { [theirs.slug]: { ...theirs, permissions: MANIFEST_PERMISSIONS } } });
    await w.add(`${USER}/shop`);
    const folder = productFolder('shop');
    await withOrigin(folder, `https://github.com/${USER}/shop.git`);
    const lying = { settings: { 'own-github-app': { key: 'own-github-app', value: { ...theirs, owner: USER } } }, unconfirmed: [] };
    const gh = github({ app: theirs, reach: [`${USER}/shop`, `${USER}/${PROFILE_REPO}`] });
    // Its waits move a clock, so a step that went on would fail fast, not wait.
    const time = clock();
    const step = stepFor(w, { fetch: gh.fetch, sleep: time.sleep, profileRoutes: memoryProfile(lying.settings), views: () => lying });
    const planned = await answerAll(step, ctxFor(folder), choose({ realUsers: REAL_USERS.yes, locked: LEVELS.standard, way: WAYS.own }));
    await assert.rejects(applyStep(step, folder, planned.changes, { answers: planned.answers, now: time.now }), /GitHub says the app helpful-app belongs to mallory, not a-director as recorded/);
    assert.equal(gh.calls.filter((c) => c.url === 'https://github.com/login/device/code').length, 0, 'no code');
    assert.equal(readKey('github-app'), null, 'no keys');
    // Also when this computer already keeps keys for it with an installation: refused at use.
    writeKey('github-app', { clientId: theirs.clientId, accessToken: ACCESS, installationId: 77 });
    await assert.rejects(applyStep(step, folder, planned.changes, { answers: planned.answers, now: time.now }), /belongs to mallory/);
  });
});

test('apply refuses a recorded app on another account than the project\'s, whatever the plan said', async () => {
  await withHome(async () => {
    const w = standIn({ apps: { [OWN.slug]: { ...OWN, permissions: MANIFEST_PERMISSIONS } } });
    await w.add('acme/app');
    const folder = productFolder('app');
    await withOrigin(folder, 'https://github.com/acme/app.git');
    const step = stepFor(w, { profileRoutes: memoryProfile(), views: () => null });
    const list = [
      { kind: 'host', target: 'github', action: 'connection', mode: 'narrow', locked: false, app: { ...OWN, own: true } },
      { kind: 'file', target: 'x', action: 'project', repo: 'acme/app' },
    ];
    await assert.rejects(applyStep(step, folder, list), /Your own GitHub App, wheelhouse-a-director, belongs to a-director, .* so it can't reach acme\/app on GitHub/);
    assert.deepEqual(readJournal().runs.flatMap((r) => r.changes), [], 'refused before anything was made');
  });
});

test('one app\'s keys per computer: a project on another app waits, and apply never overwrites keys that serve one', async () => {
  await withHome(async () => {
    const registered = appFile(tempFolder('wh-app-'));
    const w = standIn({ apps: { [OWN.slug]: { ...OWN, permissions: MANIFEST_PERMISSIONS } } });
    await w.add(`${USER}/shop`);
    await w.add('acme/app');
    const shop = productFolder('shop');
    await withOrigin(shop, `https://github.com/${USER}/shop.git`);
    const acme = productFolder('app');
    await withOrigin(acme, 'https://github.com/acme/app.git');
    const pick = (way) => choose({ realUsers: REAL_USERS.yes, locked: LEVELS.standard, way });
    const plain = stepFor(w, { appFile: registered, profileRoutes: memoryProfile(), views: () => null });
    const waits = async (folder, way, step = plain) => {
      const planned = await answerAll(step, ctxFor(folder), pick(way));
      assert.equal(planned.changes, undefined, `${way}: no Go ahead`);
      assert.equal(planned.wait, OWN_APP_WAIT_MS);
      return planned.why;
    };
    const keys = (clientId) => ({ clientId, accessToken: ACCESS, installationId: 77 });

    // The Wheelhouse app serves an earlier project; this one chose their own app.
    writeKey('github-app', keys(CLIENT_ID));
    assert.match(await waits(shop, WAYS.own), /keeps one GitHub App's keys, and they serve your other projects through the Wheelhouse app, so a-director\/shop on GitHub can't be connected through your own app/);
    // The same app again is no wait: a later project needs a tick, not new keys.
    assert.ok((await answerAll(plain, ctxFor(shop), pick(WAYS.wheelhouse))).changes);

    // Their own app (recorded and confirmed) serves an earlier project; this one chose Wheelhouse's.
    writeKey('github-app', keys(OWN.clientId));
    const confirmed = { settings: { 'own-github-app': { key: 'own-github-app', value: OWN } }, unconfirmed: [] };
    const recorded = stepFor(w, { appFile: registered, profileRoutes: memoryProfile(confirmed.settings), views: () => confirmed });
    assert.match(await waits(shop, WAYS.wheelhouse, recorded), /through your own app wheelhouse-a-director, so a-director\/shop on GitHub can't be connected through the Wheelhouse app/);

    // Their own app made for an earlier project and not confirmed yet; this project is on an
    // organisation, whose app would be another (an org-owned app after a narrow profile too).
    assert.match(await waits(acme, WAYS.own), /through another GitHub App, so acme\/app on GitHub can't be connected through your own app/);
    // Their own app, unconfirmed, for this same account: found by its name, the same app, no wait.
    assert.ok((await answerAll(plain, ctxFor(shop), pick(WAYS.own))).changes);

    // Apply refuses with the same reason, whatever list it is given, and leaves the keys alone.
    writeKey('github-app', keys(CLIENT_ID));
    const time = clock();
    const gh = github({ app: OWN, reach: [`${USER}/shop`] });
    const step = stepFor(w, { appFile: registered, fetch: gh.fetch, sleep: async (ms) => { time.move(ms); }, profileRoutes: memoryProfile(confirmed.settings), views: () => null });
    const list = [
      { kind: 'host', target: 'github', action: 'connection', mode: 'narrow', locked: false, app: { ...OWN, own: true } },
      { kind: 'file', target: 'x', action: 'project', repo: `${USER}/shop` },
    ];
    await assert.rejects(applyStep(step, shop, list, { now: time.now }), /keeps one GitHub App's keys, and they serve your other projects through the Wheelhouse app/);
    assert.equal(readKey('github-app').clientId, CLIENT_ID, 'the keys serving the earlier project are as they were');
    assert.equal(gh.calls.filter((c) => c.url === 'https://github.com/login/device/code').length, 0);
  });
});

// ---- A later project, on the same account or another (rulings R82, R83) ----

// The first project, a-director/shop, connected narrow through the Wheelhouse app, whose
// installation 77 is on the director's own account; `others` are the app's installations on other
// accounts, which a test may add to as the director would install it. What the browser opens is
// noted, and `onOpen` acts as the director does there.
async function firstNarrowProject({ others = [] } = {}) {
  const w = standIn();
  await w.add(`${USER}/shop`);
  const folder = productFolder('shop');
  await withOrigin(folder, `https://github.com/${USER}/shop.git`);
  const gh = github({ reach: [`${USER}/shop`, `${USER}/${PROFILE_REPO}`], others });
  const opened = [];
  const world = { w, gh, others, opened, folder, onOpen: async () => {} };
  const open = async (url) => {
    opened.push(url);
    await world.onOpen(url);
  };
  world.step = stepFor(w, { appFile: appFile(tempFolder('wh-app-')), fetch: gh.fetch, open });
  world.pick = choose({ realUsers: REAL_USERS.yes, locked: LEVELS.standard, way: WAYS.wheelhouse });
  const planned = await answerAll(world.step, ctxFor(folder), world.pick);
  await applyStep(world.step, folder, planned.changes, { answers: planned.answers });
  opened.length = 0;
  world.codes = () => gh.calls.filter((c) => c.url === 'https://github.com/login/device/code').length;
  // A later project in its own folder, its repository on the stand-in host.
  world.later = async (repo) => {
    await w.add(repo);
    const next = productFolder(repo.split('/')[1]);
    await withOrigin(next, `https://github.com/${repo}.git`);
    return next;
  };
  // The repositories installationCovers asked GitHub about, by installation.
  world.asked = () => gh.calls.map((c) => /\/user\/installations\/(\d+)\/repositories/.exec(c.url)?.[1]).filter(Boolean).map(Number);
  return world;
}

test('a later project on GitHub opens the app\'s page and reads the tick back', async () => {
  await withHome(async () => {
    const first = await firstNarrowProject();
    const { gh, opened } = first;
    const next = await first.later(`${USER}/next`);
    first.onOpen = async (url) => { if (url === 'https://github.com/settings/installations/77') gh.reach.push(`${USER}/next`); };
    const codes = first.codes();
    const planned = await answerAll(first.step, ctxFor(next), first.pick);
    assert.equal(planned.changes.find((c) => c.action === 'connection').appKeys, 'installed');
    assert.match(planned.card.what, /the Wheelhouse app, as signed in already: tick this project on its settings page if it is not ticked/);
    assert.match(planned.director, /a tick on the app's settings page/);
    const { lines } = await applyStep(first.step, next, planned.changes, { answers: planned.answers });
    assert.equal(first.codes(), codes, 'no new code sign-in');
    assert.deepEqual(opened, ['https://github.com/settings/installations/77'], 'the installation\'s settings page, never the Install page');
    assert.match(lines[0], /^The app can't reach a-director\/next on GitHub yet: tick it on the page that opens, then click Save$/);
    assert.match(lines.at(-2), /^The app can reach a-director\/next on GitHub and a-director\/wheelhouse-profile on GitHub/);
    assert.deepEqual(readProject(slugFor(`${USER}/next`)).connection, { host: 'github', mode: 'narrow', project: `${USER}/next`, installationId: 77 });
    assert.deepEqual(readKey('github-app').installations, { [USER]: 77 });
  });
});

test('a later project on another account with the app installed there uses that account\'s installation, and the first project keeps its own (ruling R83)', async () => {
  await withHome(async () => {
    // The app is installed on acme too (installation 88), not yet reaching acme/app.
    const first = await firstNarrowProject({ others: [{ id: 88, account: 'acme', reach: ['acme/website'] }] });
    const { gh, opened, others } = first;
    assert.deepEqual(readKey('github-app').installations, { [USER]: 77, acme: 88 }, 'every installation of the app kept by its account');
    assert.equal(readKey('github-app').installationId, 77, 'the first one kept as installationId');
    // findInstallation picks the account's own installation, whatever the case of its login.
    const { accessToken } = readKey('github-app');
    const app = { clientId: CLIENT_ID, slug: 'wheelhouse-test' };
    assert.equal(await findInstallation({ accessToken, app, account: 'ACME', fetch: gh.fetch }), 88);
    assert.equal(await findInstallation({ accessToken, app, account: USER, fetch: gh.fetch }), 77);
    assert.equal(await findInstallation({ accessToken, app, account: 'globex', fetch: gh.fetch }), null, 'never another account\'s installation');
    await assert.rejects(findInstallation({ accessToken, app, fetch: gh.fetch }), /needs the account/);

    const next = await first.later('acme/app');
    first.onOpen = async (url) => { if (url === 'https://github.com/settings/installations/88') others[0].reach.push('acme/app'); };
    const planned = await answerAll(first.step, ctxFor(next), first.pick);
    assert.equal(planned.changes.find((c) => c.action === 'connection').appKeys, 'installed');
    gh.calls.length = 0;
    const { lines } = await applyStep(first.step, next, planned.changes, { answers: planned.answers });
    assert.deepEqual(opened, ['https://github.com/settings/installations/88'], 'acme\'s installation\'s settings page, where acme/app can be ticked');
    assert.match(lines[0], /can't reach acme\/app on GitHub yet/);
    assert.match(lines.at(-2), /The app can reach acme\/app on GitHub and a-director\/wheelhouse-profile on GitHub/);
    // acme/app was read against 88 only, the profile against 77 only.
    assert.ok(first.asked().includes(88) && first.asked().includes(77));
    const record = readProject(slugFor('acme/app'));
    assert.equal(record.connection.installationId, 88, 'the project record carries its installation');
    // installationCovers reads the record's installation; the first project's is untouched and still used for it.
    const shop = readProject(slugFor(`${USER}/shop`));
    assert.equal(shop.connection.installationId, 77);
    gh.calls.length = 0;
    assert.deepEqual(await installationCovers(record.connection, { fetch: gh.fetch, now: () => NOW }), { covered: true });
    assert.deepEqual(await installationCovers(shop.connection, { fetch: gh.fetch, now: () => NOW }), { covered: true });
    assert.deepEqual(first.asked(), [88, 77]);
    assert.deepEqual(readKey('github-app').installations, { [USER]: 77, acme: 88 });
    assert.equal(readKey('github-app').installationId, 77);
  });
});

test('a later project on an account the app is not installed on gets the Install page, and the tick is read back (ruling R83)', async () => {
  await withHome(async () => {
    const first = await firstNarrowProject();
    const { opened, others } = first;
    const next = await first.later('acme/app');
    const codes = first.codes();
    // The director installs it on acme but leaves acme/app unticked, then ticks it on the settings page.
    first.onOpen = async (url) => {
      if (url === 'https://github.com/apps/wheelhouse-test/installations/new') others.push({ id: 88, account: 'acme', reach: [] });
      if (url === 'https://github.com/settings/installations/88') others[0].reach.push('acme/app');
    };
    const planned = await answerAll(first.step, ctxFor(next), first.pick);
    assert.equal(planned.changes.find((c) => c.action === 'connection').appKeys, 'other-account');
    assert.match(planned.card.what, /the Wheelhouse app, as signed in already: install it on acme and tick this project on its Install page, not All repositories/);
    assert.match(planned.director, /a tick on the app's Install page for the project's account/);
    composeCard({ ...planned.card, target: { step: 3, hash: planHash(planned.changes) } });
    const { lines } = await applyStep(first.step, next, planned.changes, { answers: planned.answers });
    assert.equal(first.codes(), codes, 'no new code sign-in: the access key works across the app\'s installations');
    assert.deepEqual(opened, ['https://github.com/apps/wheelhouse-test/installations/new', 'https://github.com/settings/installations/88']);
    assert.match(lines[0], /^On the app's Install page, install it on acme: choose Only select repositories, tick acme\/app on GitHub \(not All repositories\), then click Install$/);
    assert.match(lines[1], /can't reach acme\/app on GitHub yet/);
    assert.match(lines.at(-2), /The app can reach acme\/app on GitHub and a-director\/wheelhouse-profile on GitHub/);
    assert.equal(readProject(slugFor('acme/app')).connection.installationId, 88);
    assert.deepEqual(readKey('github-app').installations, { [USER]: 77, acme: 88 });
    assert.equal(readProject(slugFor(`${USER}/shop`)).connection.installationId, 77);
  });
});

test('a key file and project record written before installations were kept per account still work for their project', async () => {
  await withHome(async () => {
    const first = await firstNarrowProject();
    const { gh, others } = first;
    // As an earlier Wheelhouse left them: the installation only as installationId, none in the record.
    const { installations, ...old } = readKey('github-app');
    writeKey('github-app', old);
    const shop = readProject(slugFor(`${USER}/shop`));
    const { installationId, ...oldConnection } = shop.connection;
    writeProject(slugFor(`${USER}/shop`), { ...shop, connection: oldConnection });
    gh.calls.length = 0;
    assert.deepEqual(await installationCovers(oldConnection, { fetch: gh.fetch, now: () => NOW }), { covered: true });
    assert.deepEqual(first.asked(), [77]);
    // Such keys read as installed; a later project on another account finds out from GitHub which
    // account each installation is on, so the old record goes on finding its own.
    const next = await first.later('acme/app');
    first.onOpen = async (url) => { if (url === 'https://github.com/apps/wheelhouse-test/installations/new') others.push({ id: 88, account: 'acme', reach: ['acme/app'] }); };
    const planned = await answerAll(first.step, ctxFor(next), first.pick);
    assert.equal(planned.changes.find((c) => c.action === 'connection').appKeys, 'installed');
    await applyStep(first.step, next, planned.changes, { answers: planned.answers });
    assert.deepEqual(readKey('github-app').installations, { [USER]: 77, acme: 88 });
    assert.equal(readKey('github-app').installationId, 77);
    gh.calls.length = 0;
    assert.deepEqual(await installationCovers(oldConnection, { fetch: gh.fetch, now: () => NOW }), { covered: true });
    assert.deepEqual(first.asked(), [77], 'the old record\'s project read against its own account\'s installation');
  });
});

// ---- A second computer joining a project (ruling R77) ----

const INSTALLED = '{"enabledPlugins":{"wheelhouse@wheelhouse":true}}\n';
const COMMITTED = `${JSON.stringify({ enabledPlugins: { 'wheelhouse@wheelhouse': true, 'superpowers@wheelhouse': true }, sandbox: { enabled: true } }, null, 2)}\n`;

// A project the first computer set up, on the stand-in host: its main branch with the project's
// files, and its state branch, holding a `phase` setting when one is given.
async function seedProject(w, repo, { phase = null } = {}) {
  w.nextId += 1;
  w.repos[repo] = { id: w.nextId };
  const dir = w.hostUrl({ repo });
  fs.mkdirSync(path.dirname(dir), { recursive: true });
  await realRun('git', ['init', '--bare', '-q', '-b', 'main', dir]);
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'wh-seed-'));
  try {
    await g(work, 'init', '-q', '-b', 'main');
    fs.mkdirSync(path.join(work, '.claude'));
    fs.writeFileSync(path.join(work, 'README.md'), '# Cafe menu\n');
    fs.writeFileSync(path.join(work, 'CLAUDE.md'), '# Cafe menu\n');
    fs.writeFileSync(path.join(work, '.claude', 'settings.json'), COMMITTED);
    fs.writeFileSync(path.join(work, '.claude', 'wheelhouse.json'), '{"v":1}\n');
    await g(work, 'add', '-A');
    await g(work, 'commit', '-q', '-m', 'Set up Wheelhouse');
    await g(work, 'push', '-q', dir, 'main');
    await g(work, 'checkout', '-q', '--orphan', 'wheelhouse-state');
    await g(work, 'rm', '-rqf', '.');
    fs.writeFileSync(path.join(work, 'README.md'), '# Wheelhouse state\n');
    if (phase !== null) {
      const event = { v: 1, id: '0f1e2d3c-0000-4000-8000-000000000001', at: '2026-10-19T00:00:00.000Z', computer: 'c-first', kind: 'setting', data: { key: 'phase', value: phase } };
      fs.mkdirSync(path.dirname(path.join(work, eventPath(event))), { recursive: true });
      fs.writeFileSync(path.join(work, eventPath(event)), JSON.stringify(event));
    }
    await g(work, 'add', '-A');
    await g(work, 'commit', '-q', '-m', 'Start the state branch');
    await g(work, 'push', '-q', dir, 'wheelhouse-state');
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
}

// A product's folder as step 1 leaves it on a fresh computer: nothing but its .claude/, with the
// install's settings and step 2's local settings.
const emptyFolder = (name = 'Cafe Menu') => {
  const folder = path.join(fs.realpathSync.native(tempFolder('wh-proj ')), name);
  fs.mkdirSync(path.join(folder, '.claude'), { recursive: true });
  fs.writeFileSync(path.join(folder, '.claude', 'settings.json'), INSTALLED);
  fs.writeFileSync(path.join(folder, '.claude', 'settings.local.json'), '{"permissions":{"allow":["Bash(setup:*)"]}}\n');
  return folder;
};

const joining = ({ join = fromOtherComputer('Cafe-Menu'), typed = null, way = WAYS.quick, host = HOST_LABELS.github } = {}) => (id) => {
  if (id === 'join' || id.startsWith('join-')) return typed ?? join;
  if (id === 'host') return host;
  if (id.startsWith('connection-')) return way;
  throw new Error(`asked ${id}`);
};

// answerAll, with a typed answer given as text.
async function answerJoin(step, ctx, pick) {
  const answers = { ...(ctx.answers ?? {}) };
  const asked = [];
  for (let i = 0; i < 8; i += 1) {
    const got = await step.plan({ ...ctx, answers });
    if (!got.ask) return { ...got, answers, asked };
    asked.push(got.ask);
    const value = pick(got.ask.id, got.ask.card);
    const typed = got.ask.typed && !got.ask.card.options.some((o) => o.label === value);
    answers[`3.${got.ask.id}`] = typed ? { label: null, text: value, at: NOW.toISOString() } : said(value);
  }
  throw new Error('the step kept asking');
}

// Applies the list in the given run, as the engine does.
async function applyIn(step, folder, runId, changes, extra = {}) {
  const lines = [];
  await step.apply(ctxFor(folder, {
    runId,
    say: (line) => { lines.push(line); },
    record: (made) => addChanges(runId, (Array.isArray(made) ? made : [made]).map((c) => ({ ...c, step: 3 }))),
    ...extra,
  }), changes);
  return lines;
}

const cloneStateFor = (slug, remoteUrl) => cloneState({ project: slug, remoteUrl, env: {} });

const joinedOf = (folder) => findRun(folder).changes.filter((c) => c.kind === 'answer' && c.after && Object.hasOwn(c.after, 'joined')).map((c) => c.after);

test('step 3 asks whether this computer is joining only in a folder holding nothing but step 1\'s install, recommending by profile.json', async () => {
  await withHome(async () => {
    const w = standIn();
    const step = stepFor(w);
    const folder = emptyFolder();
    const first = (await step.plan(ctxFor(folder))).ask;
    assert.equal(first.id, 'join');
    assert.equal(first.typed, true, 'an owner/name may be typed');
    assert.deepEqual(first.card.options.map((o) => o.label), [NEW_PRODUCT, 'Cafe-Menu, from my other computer']);
    assert.equal(first.card.recommend, fromOtherComputer('Cafe-Menu'), 'no profile.json: the other computer');
    assert.match(first.card.what, /owner\/name/);
    composeCard({ ...first.card, kind: 'question' });
    // With profile.json on this computer, it is still asked, recommending a new product.
    const profileJson = path.join(wheelhouseHome(), 'profile.json');
    fs.mkdirSync(wheelhouseHome(), { recursive: true });
    fs.writeFileSync(profileJson, '{}\n');
    assert.equal((await step.plan(ctxFor(folder))).ask.card.recommend, NEW_PRODUCT);
    fs.rmSync(profileJson);
    // A new product: the usual questions follow, and a repository is made.
    const fresh = await answerJoin(step, ctxFor(folder), (id) => (id === 'join' ? NEW_PRODUCT : choose()(id)));
    assert.deepEqual(fresh.asked.map((a) => a.id.replace(/-[0-9a-f]{10}$/, '')), ['join', 'real-users', 'host', 'connection']);
    assert.ok(fresh.changes.some((c) => c.action === 'repository'));
    assert.ok(!fresh.changes.some((c) => c.action === 'join'));
    // A folder with any other file in it, or with an origin, is an existing product: not asked.
    fs.writeFileSync(path.join(folder, 'notes.txt'), 'mine\n');
    assert.equal((await step.plan(ctxFor(folder))).ask.id, 'real-users');
    const connected = emptyFolder('Cafe Menu');
    await withOrigin(connected, `https://github.com/${USER}/Cafe-Menu.git`);
    assert.equal((await step.plan(ctxFor(connected))).ask.id, 'real-users');
    // The system's own files don't count.
    const tidy = emptyFolder('Cafe Menu');
    fs.writeFileSync(path.join(tidy, '.DS_Store'), '');
    assert.equal((await step.plan(ctxFor(tidy))).ask.id, 'join');
    assert.equal(repoNamed(' cafe-co/Cafe-Menu.git '), 'cafe-co/Cafe-Menu');
    assert.equal(repoNamed('Cafe-Menu'), 'Cafe-Menu');
    for (const bad of ['', 'a b', '../x', 'o/..', 'https://github.com/o/x']) assert.equal(repoNamed(bad), null, bad);
  });
});

test('a second computer joins from an empty folder: the project found on an organisation, checked out in place with its committed settings, the profile and state joined, and its run a joining one', async () => {
  await withHome(async () => {
    const w = standIn({ memberships: [{ state: 'active', role: 'member', organization: { login: 'cafe-co' } }] });
    await w.add(`${USER}/${PROFILE_REPO}`, { readme: false }); // the first computer made it
    await w.add(`${USER}/Cafe-Menu`); // the same name on their own account, without Wheelhouse's records
    await seedProject(w, 'cafe-co/Cafe-Menu');
    const step = stepFor(w);
    const folder = emptyFolder();
    const planned = await answerJoin(step, ctxFor(folder), joining());
    // Neither the real-users nor the Locked question (a Mac here): the first computer's.
    assert.deepEqual(planned.asked.map((a) => a.id.replace(/-[0-9a-f]{10}$/, '')), ['join', 'host', 'connection']);
    assert.deepEqual(planned.changes.slice(0, 2), [
      { kind: 'host', target: 'github', action: 'join', name: 'Cafe-Menu' },
      { kind: 'folder', target: folder, action: 'checkout' },
    ]);
    assert.ok(!planned.changes.some((c) => c.action === 'repository'), 'nothing is made for the product');
    assert.deepEqual(planned.changes.find((c) => c.action === 'connection'), { kind: 'host', target: 'github', action: 'connection', mode: 'quick', locked: false });
    assert.equal(planned.asked.at(-1).card.recommend, WAYS.own, 'a narrow way until the phase is known, never Quick');
    const text = composeCard({ ...planned.card, target: { step: 3, hash: planHash(planned.changes) } }).question.question;
    assert.match(text, /Cafe-Menu found on your GitHub account or organisations, the one holding Wheelhouse's records, and checked out into this folder/);
    assert.doesNotMatch(text, /protection/, 'the first computer\'s step 7 switched it on');

    const run = startRun({ folder, now: () => NOW });
    const lines = await applyIn(step, folder, run.id, planned.changes, { answers: planned.answers });
    // Checked out in place: the project's main, the committed settings in place of the install's,
    // this computer's own local settings kept.
    const remote = w.hostUrl({ repo: 'cafe-co/Cafe-Menu' });
    assert.equal(await g(folder, 'rev-parse', 'HEAD'), await g(remote, 'rev-parse', 'main'));
    assert.equal(await g(folder, 'symbolic-ref', '--short', 'HEAD'), 'main');
    assert.equal(await g(folder, 'config', '--get', 'remote.origin.url'), remote);
    assert.equal(await g(folder, 'rev-parse', '--abbrev-ref', 'main@{upstream}'), 'origin/main');
    assert.equal(fs.readFileSync(path.join(folder, '.claude', 'settings.json'), 'utf8'), COMMITTED);
    assert.equal(fs.readFileSync(path.join(folder, '.claude', 'settings.local.json'), 'utf8'), '{"permissions":{"allow":["Bash(setup:*)"]}}\n');
    assert.equal(fs.readFileSync(path.join(folder, 'README.md'), 'utf8'), '# Cafe menu\n');
    // Recorded as made: joining first, then the repository found, the folder's .git, the install's
    // settings with its text as the value before, the profile, the state clone and the record.
    const changes = findRun(folder).changes;
    assert.deepEqual(joinedOf(folder), [{ joined: 'Cafe-Menu' }, { joined: 'cafe-co/Cafe-Menu', found: true }]);
    const settingsChange = changes.find((c) => c.kind === 'file' && c.target === path.join(folder, '.claude', 'settings.json'));
    assert.deepEqual([settingsChange.before, settingsChange.after], [INSTALLED, COMMITTED]);
    const order = changes.map((c) => `${c.kind} ${c.target.replace(wheelhouseHome(), '~').replace(folder, '<folder>')}`);
    assert.deepEqual(order.filter((o) => !o.startsWith('answer')), [
      `folder ${path.join('<folder>', '.git')}`, `file ${path.join('<folder>', '.claude', 'settings.json')}`,
      `file ${path.join('~', 'profile.json')}`, `folder ${path.join('~', 'profile')}`,
      `folder ${path.join('~', 'projects', 'cafe-co__Cafe-Menu', 'state')}`, `file ${path.join('~', 'projects', 'cafe-co__Cafe-Menu', 'project.json')}`,
      // A joining computer publishes its key too, so the first computer can trust it (ruling R79).
      `host github:${USER}/${PROFILE_REPO}:enrolments/${computerId()}.json`,
    ]);
    assert.ok(order.indexOf('answer step 3') === 0, 'joining is recorded before anything is done');
    // The profile found, not made; nothing made on the host at all.
    assert.equal(profileRemote().repo, `${USER}/${PROFILE_REPO}`);
    assert.deepEqual(w.calls.filter((c) => c.args?.[0] === 'repo'), []);
    // The project's record and its state.
    const slug = slugFor('cafe-co/Cafe-Menu');
    assert.deepEqual(readProject(slug), { folder, remoteUrl: remote, host: 'github', repo: 'cafe-co/Cafe-Menu', connection: { host: 'github', mode: 'quick', project: 'cafe-co/Cafe-Menu' } });
    assert.ok(fs.existsSync(path.join(stateDir(slug), '.git')));
    assert.match(lines.at(-1), /Connected: cafe-co\/Cafe-Menu on GitHub, Quick/);
    // The run is a joining computer's: steps 1, 2, 3, 6, 7, 8 and 9.
    const after = findRun(folder);
    assert.equal(joinedRepo(after), 'cafe-co/Cafe-Menu');
    assert.equal(stepsFor(after), JOINING_STEPS);
    assert.deepEqual(stepsFor(after).map((s) => s.n), [1, 2, 3, 6, 7, 8, 9]);
    // Planned again, the folder is joined for good: no question, and the list names the repository
    // found (ruling R102). Applied, nothing is checked out or recorded twice. The old list, naming
    // the bare name, is refused.
    const again = await answerJoin(step, ctxFor(folder, { runId: run.id }), joining());
    assert.deepEqual(again.asked.map((a) => a.id.replace(/-[0-9a-f]{10}$/, '')), ['host', 'connection']);
    assert.deepEqual(again.changes.find((c) => c.action === 'join'), { kind: 'host', target: 'github', action: 'join', name: 'cafe-co/Cafe-Menu' });
    await assert.rejects(applyIn(step, folder, run.id, planned.changes, { answers: planned.answers }), /checked out to cafe-co\/Cafe-Menu from your other computer/);
    const count = findRun(folder).changes.filter((c) => c.kind === 'folder' && c.target.endsWith('.git')).length;
    await applyIn(step, folder, run.id, again.changes, { answers: again.answers });
    assert.equal(findRun(folder).changes.filter((c) => c.kind === 'folder' && c.target.endsWith('.git')).length, count);
  });
});

test('none or several found are refused saying to type owner/name, the question asks again, and a typed owner/name is used', async () => {
  await withHome(async () => {
    const w = standIn({ memberships: [{ state: 'active', role: 'admin', organization: { login: 'cafe-co' } }] });
    await w.add(`${USER}/${PROFILE_REPO}`, { readme: false });
    await seedProject(w, `${USER}/Cafe-Menu`);
    await seedProject(w, 'cafe-co/Cafe-Menu');
    const step = stepFor(w);
    const folder = emptyFolder();
    const run = startRun({ folder, now: () => NOW });
    const ctx = ctxFor(folder, { runId: run.id });
    const planned = await answerJoin(step, ctx, joining());
    await assert.rejects(applyIn(step, folder, run.id, planned.changes, { answers: planned.answers }),
      /^Error: More than one repository named Cafe-Menu holds Wheelhouse's records \(a-director\/Cafe-Menu, cafe-co\/Cafe-Menu\), so nothing was checked out: type the one you mean as owner\/name on step 3's question, which asks again$/);
    assert.deepEqual(joinedOf(folder).at(-1), { joined: 'Cafe-Menu', missed: [`${USER}/Cafe-Menu`, 'cafe-co/Cafe-Menu'] });
    assert.equal(fs.existsSync(path.join(folder, '.git')), false, 'nothing checked out');
    assert.equal(stepsFor(findRun(folder)), JOINING_STEPS, 'the run stays joining, and step 3 can run again');
    // Asked again, under an id naming what was missed, saying so; the typed owner/name is used.
    const again = await step.plan({ ...ctx, answers: planned.answers });
    assert.match(again.ask.id, /^join-[0-9a-f]{10}$/);
    assert.match(again.ask.card.what, /^More than one Cafe-Menu holds Wheelhouse's records: a-director\/Cafe-Menu, cafe-co\/Cafe-Menu\./);
    const typed = await answerJoin(step, { ...ctx, answers: planned.answers }, joining({ typed: 'cafe-co/Cafe-Menu' }));
    assert.deepEqual(typed.changes.find((c) => c.action === 'join'), { kind: 'host', target: 'github', action: 'join', name: 'cafe-co/Cafe-Menu' });
    assert.match(typed.card.what, /cafe-co\/Cafe-Menu found on your GitHub/);
    await applyIn(step, folder, run.id, typed.changes, { answers: typed.answers });
    assert.equal(joinedRepo(findRun(folder)), 'cafe-co/Cafe-Menu');
    assert.equal(await g(folder, 'config', '--get', 'remote.origin.url'), w.hostUrl({ repo: 'cafe-co/Cafe-Menu' }));
  });
  await withHome(async () => {
    // None: a repository of the name without Wheelhouse's records doesn't count.
    const w = standIn();
    await w.add(`${USER}/Cafe-Menu`);
    const step = stepFor(w);
    const folder = emptyFolder();
    const run = startRun({ folder, now: () => NOW });
    const ctx = ctxFor(folder, { runId: run.id });
    const planned = await answerJoin(step, ctx, joining());
    await assert.rejects(applyIn(step, folder, run.id, planned.changes, { answers: planned.answers }),
      /^Error: Setup found no repository Cafe-Menu holding Wheelhouse's records on your GitHub account or your organisations, so nothing was checked out: type the project's owner\/name on step 3's question, which asks again$/);
    assert.deepEqual(joinedOf(folder).at(-1), { joined: 'Cafe-Menu', missed: 'none' });
    // Typed text that names no repository asks again at once, saying so.
    const first = (await step.plan({ ...ctx, answers: planned.answers })).ask;
    const answers = { ...planned.answers, [`3.${first.id}`]: { label: null, text: 'the cafe one', at: NOW.toISOString() } };
    const next = (await step.plan({ ...ctx, answers })).ask;
    assert.notEqual(next.id, first.id);
    assert.match(next.card.what, /^"the cafe one" is not a repository's name\./);
    // A new product, chosen now: the run is not a joining one any more once its apply starts.
    const fresh = await answerJoin(step, { ...ctx, answers }, (id) => (id.startsWith('join') ? NEW_PRODUCT : choose()(id)));
    assert.ok(fresh.changes.some((c) => c.action === 'repository'));
    await w.add(`${USER}/${PROFILE_REPO}`, { readme: false });
    fs.rmSync(w.hostUrl({ repo: `${USER}/Cafe-Menu` }), { recursive: true });
    delete w.repos[`${USER}/Cafe-Menu`];
    await applyIn(step, folder, run.id, fresh.changes, { answers: fresh.answers });
    assert.deepEqual(joinedOf(folder).at(-1), { joined: null });
    assert.equal(stepsFor(findRun(folder)), SETUP_STEPS);
  });
});

test('a launched project refuses Quick at apply, before anything is connected or registered, and its card is asked again without Quick', async () => {
  await withHome(async () => {
    const w = standIn();
    await w.add(`${USER}/${PROFILE_REPO}`, { readme: false });
    await seedProject(w, `${USER}/Cafe-Menu`, { phase: 'launched' });
    const step = stepFor(w);
    const folder = emptyFolder();
    const run = startRun({ folder, now: () => NOW });
    const ctx = ctxFor(folder, { runId: run.id });
    const planned = await answerJoin(step, ctx, joining());
    assert.ok(planned.asked.at(-1).card.options.some((o) => o.label === WAYS.quick), 'the phase is not known before the state is here');
    await assert.rejects(applyIn(step, folder, run.id, planned.changes, { answers: planned.answers }), { message: quickLaunched(`${USER}/Cafe-Menu`) });
    const slug = slugFor(`${USER}/Cafe-Menu`);
    assert.equal(readProject(slug), null, 'nothing registered');
    assert.ok(fs.existsSync(path.join(stateDir(slug), '.git')), 'the state cloned, which said so');
    // Planned again: the connection question again, with no Quick, saying why.
    const again = await step.plan({ ...ctx, answers: planned.answers });
    assert.match(again.ask.id, /^connection-/);
    assert.notEqual(again.ask.id, planned.asked.at(-1).id);
    assert.deepEqual(again.ask.card.options.map((o) => o.label), [WAYS.own]);
    assert.match(again.ask.card.what, /It is launched, and a launched product needs a narrow connection, so Quick is not offered/);
  });
  // On GitLab a launched project is not asked at all: Narrow is all there is.
  await withHome(async () => {
    const w = standIn();
    await seedProject(w, `${USER}/Cafe-Menu`, { phase: 'launched' });
    const slug = slugFor(`${USER}/Cafe-Menu`);
    await cloneStateFor(slug, w.hostUrl({ repo: `${USER}/Cafe-Menu` }));
    const step = stepFor(w);
    const folder = emptyFolder();
    const planned = await answerJoin(step, ctxFor(folder), joining({ typed: `${USER}/Cafe-Menu`, host: HOST_LABELS.gitlab }));
    assert.deepEqual(planned.asked.map((a) => a.id), ['join', 'host']);
    assert.equal(planned.changes.find((c) => c.action === 'connection').mode, 'narrow');
  });
});

test('no card of step 4 or 5 comes on a computer whose answer is joining: they wait for the project, and its apply records joining first', async () => {
  await withHome(async () => {
    const w = standIn({ signedIn: { github: false }, loginWorks: false });
    await seedProject(w, `${USER}/Cafe-Menu`);
    const step = stepFor(w);
    const folder = emptyFolder();
    const run = startRun({ folder, now: () => NOW });
    const planned = await answerJoin(step, ctxFor(folder, { runId: run.id }), joining());
    // Between the answer and step 3's apply, steps 4 and 5 have no project to ask about: they wait.
    for (const other of [questionsStep(), rulesStep({ env: {} })]) {
      const got = await other.plan({ folder, step: other.n, runId: run.id, now: () => NOW, userHome: folder, platform: 'darwin', answers: planned.answers });
      assert.ok(got.wait > 0 && !got.ask && !got.changes, `step ${other.n}`);
    }
    assert.equal(stepsFor(findRun(folder)), SETUP_STEPS, 'not yet recorded');
    // Step 3's apply records joining before anything else, here before a sign-in that fails.
    await assert.rejects(applyIn(step, folder, run.id, planned.changes, { answers: planned.answers }), /could not sign in to GitHub/);
    assert.deepEqual(joinedOf(folder), [{ joined: 'Cafe-Menu' }]);
    for (const n of [4, 5, 10]) assert.equal(onRunList(findRun(folder), n), false, `step ${n}`);
  });
});

// ---- A joining folder stays joined (ruling R102) ----

// STOP comes on once the project is checked out into the folder, so an attempt ends right after it.
const stopAfterCheckout = (folder) => () => fs.existsSync(path.join(folder, 'README.md'));

test('a retry after the repository was found checks that repository and never searches again, whatever the organisation listing does', async () => {
  await withHome(async () => {
    const w = standIn({ memberships: [{ state: 'active', role: 'member', organization: { login: 'cafe-co' } }] });
    await w.add(`${USER}/${PROFILE_REPO}`, { readme: false });
    await seedProject(w, 'cafe-co/Cafe-Menu');
    const step = stepFor(w);
    const folder = emptyFolder();
    const run = startRun({ folder, now: () => NOW });
    const ctx = ctxFor(folder, { runId: run.id });
    const planned = await answerJoin(step, ctx, joining());
    await assert.rejects(applyIn(step, folder, run.id, planned.changes, { answers: planned.answers, stopped: stopAfterCheckout(folder) }), { message: STOPPED });
    assert.equal(await g(folder, 'config', '--get', 'remote.origin.url'), w.hostUrl({ repo: 'cafe-co/Cafe-Menu' }));
    // The organisation listing now fails: the retry doesn't need it.
    w.orgsFail = true;
    const again = await answerJoin(step, ctx, joining());
    assert.ok(!again.asked.some((a) => a.id.startsWith('join')), 'the join question is not asked again');
    assert.equal(again.changes.find((c) => c.action === 'join').name, 'cafe-co/Cafe-Menu');
    assert.notEqual(planHash(again.changes), planHash(planned.changes), 'the list, and its hash, name the repository found');
    await applyIn(step, folder, run.id, again.changes, { answers: again.answers });
    assert.equal(w.calls.filter((c) => c.args?.[1]?.startsWith('user/memberships/orgs')).length, 1, 'listed once, on the first attempt only');
    assert.equal(readProject(slugFor('cafe-co/Cafe-Menu')).folder, folder);
    assert.equal(joinedRepo(findRun(folder)), 'cafe-co/Cafe-Menu');
  });
});

test('a failed organisation listing refuses, never reading as none found', async () => {
  await withHome(async () => {
    const w = standIn({ orgsFail: true });
    await seedProject(w, 'cafe-co/Cafe-Menu');
    const step = stepFor(w);
    const folder = emptyFolder();
    const run = startRun({ folder, now: () => NOW });
    const ctx = ctxFor(folder, { runId: run.id });
    const planned = await answerJoin(step, ctx, joining());
    await assert.rejects(applyIn(step, folder, run.id, planned.changes, { answers: planned.answers }), { message: ORGS_UNREAD });
    assert.ok(!joinedOf(folder).some((j) => j.missed !== undefined), 'nothing recorded as missed');
    // So the question is not asked again: the same list, for a fresh Go ahead.
    const again = await step.plan({ ...ctx, answers: planned.answers });
    assert.equal(planHash(again.changes), planHash(planned.changes));
    assert.equal(fs.existsSync(path.join(folder, '.git')), false);
  });
});

test('a folder checked out to a joined repository can never become a full run, in this run or another', async () => {
  await withHome(async () => {
    const w = standIn();
    await w.add(`${USER}/${PROFILE_REPO}`, { readme: false });
    await seedProject(w, `${USER}/Cafe-Menu`);
    const step = stepFor(w);
    const folder = emptyFolder();
    const run = startRun({ folder, now: () => NOW });
    const ctx = ctxFor(folder, { runId: run.id });
    const planned = await answerJoin(step, ctx, joining());
    await assert.rejects(applyIn(step, folder, run.id, planned.changes, { answers: planned.answers, stopped: stopAfterCheckout(folder) }), { message: STOPPED });
    // Every join answer saying A new product changes nothing: the question isn't asked, and the
    // list joins the repository the folder is checked out to.
    const fresh = Object.fromEntries(['join', ...planned.asked.map((a) => a.id)].map((id) => [`3.${id}`, said(id.startsWith('join') ? NEW_PRODUCT : planned.answers[`3.${id}`].label)]));
    const replanned = await answerJoin(step, { ...ctx, answers: fresh }, joining());
    assert.equal(replanned.changes.find((c) => c.action === 'join').name, `${USER}/Cafe-Menu`);
    assert.ok(!replanned.changes.some((c) => c.action === 'repository'));
    // A list of a product of its own (as an old card might hold) is refused, and records nothing.
    const own = planned.changes.filter((c) => c.action !== 'join' && c.action !== 'checkout')
      .map((c) => (c.action === 'project' ? { ...c, repo: `${USER}/Cafe-Menu` } : c));
    const before = findRun(folder).changes.length;
    await assert.rejects(applyIn(step, folder, run.id, own, { answers: planned.answers }), /checked out to a-director\/Cafe-Menu from your other computer/);
    assert.equal(findRun(folder).changes.length, before, 'no { joined: null }');
    assert.equal(stepsFor(findRun(folder)), JOINING_STEPS);
    // Another run in the same folder joins it too, without asking.
    const other = startRun({ folder, now: () => NOW });
    const there = await answerJoin(step, ctxFor(folder, { runId: other.id }), joining());
    assert.ok(!there.asked.some((a) => a.id.startsWith('join')));
    assert.equal(there.changes.find((c) => c.action === 'join').name, `${USER}/Cafe-Menu`);
  });
});

test('a retry never checks out over files added to the folder since the first attempt', async () => {
  await withHome(async () => {
    const w = standIn();
    await w.add(`${USER}/${PROFILE_REPO}`, { readme: false });
    await seedProject(w, `${USER}/Cafe-Menu`);
    const step = stepFor(w);
    const folder = emptyFolder();
    const run = startRun({ folder, now: () => NOW });
    const ctx = ctxFor(folder, { runId: run.id });
    const planned = await answerJoin(step, ctx, joining({ typed: `${USER}/Cafe-Menu` }));
    // The first attempt stops after the remote is added, before the checkout.
    w.gitFails = (args) => args[0] === 'fetch';
    await assert.rejects(applyIn(step, folder, run.id, planned.changes, { answers: planned.answers }), /could not fetch the project/);
    w.gitFails = null;
    for (const [file, text] of [['README.md', 'mine\n'], [path.join('.claude', 'wheelhouse.json'), '{"mine":true}\n']]) {
      fs.writeFileSync(path.join(folder, file), text);
      const again = await answerJoin(step, ctx, joining());
      await assert.rejects(applyIn(step, folder, run.id, again.changes, { answers: again.answers }), /now holds files beside step 1's install/);
      assert.equal(fs.readFileSync(path.join(folder, file), 'utf8'), text, 'left as it was');
      fs.rmSync(path.join(folder, file));
    }
    const again = await answerJoin(step, ctx, joining());
    await applyIn(step, folder, run.id, again.changes, { answers: again.answers });
    assert.equal(fs.readFileSync(path.join(folder, 'README.md'), 'utf8'), '# Cafe menu\n');
  });
});

test('a joining computer\'s card says its own app is made, or found in its profile, and a state that can\'t be read counts as launched', async () => {
  await withHome(async () => {
    const w = standIn();
    const planned = await answerJoin(stepFor(w), ctxFor(emptyFolder()), joining({ way: WAYS.own }));
    assert.match(planned.card.what, /your own GitHub App, made, or found in your profile/);
    assert.doesNotMatch(planned.card.what, /click Create/);
    assert.match(planned.director, /if your app is not in your profile/);
  });
  assert.equal(launchedIn('..'), true, 'fails closed');
});

// The stand-in host answering https addresses, as the real host does: a git call naming
// https://github.com/<repo>.git reaches the bare repository for <repo>. Each git call's arguments
// are kept in `gits`.
const overHttps = (w, gits) => async (file, args = [], options = {}) => {
  if (path.basename(file).replace(/\.exe$/, '') !== 'git') return w.run(file, args, options);
  gits.push([...args]);
  let served = false;
  const local = args.map((a) => {
    const repo = /^https:\/\/github\.com\/(.+)\.git$/.exec(a)?.[1];
    if (repo === undefined) return a;
    served = true;
    return w.hostUrl({ repo });
  });
  return w.run(file, local, served ? { ...options, env: { ...options.env, GIT_ALLOW_PROTOCOL: 'https:file' } } : options);
};

test('a folder whose origin is an ssh address of the same repository is fetched by its https address, never by origin, when connected and when joined (ruling R111)', async () => {
  await withHome(async () => {
    const w = standIn();
    const https = ({ repo }) => `https://github.com/${repo}.git`;
    const env = directorGitEnv({ host: 'github', gitPath: 'git' });
    // This computer's profile first, so only the product's repository is reached below.
    await w.add(`${USER}/${PROFILE_REPO}`, { readme: false });
    await makeRepos({ host: 'github', owner: USER, name: 'unused', isNew: false, run: w.run, hostUrl: w.hostUrl });
    const gits = [];

    // A new product's folder, already pointed at its repository over ssh by the director.
    const folder = productFolder();
    await withOrigin(folder, `git@github.com:${USER}/Shop.git`);
    // Fetched by origin, setup's git would go over ssh, which it never uses.
    const byOrigin = await setupGit({ env, cwd: folder })(['fetch', '-q', 'origin', 'main']);
    assert.notEqual(byOrigin.code, 0);
    assert.match(byOrigin.stderr, /transport 'ssh' not allowed/);
    await makeRepos({ host: 'github', owner: USER, name: 'Shop', isNew: true, folder, run: overHttps(w, gits), env, hostUrl: https });
    assert.equal(await g(folder, 'rev-parse', 'HEAD'), await g(w.hostUrl({ repo: `${USER}/Shop` }), 'rev-parse', 'main'));
    assert.equal(await g(folder, 'rev-parse', '--abbrev-ref', 'main@{upstream}'), 'origin/main');
    assert.equal(await g(folder, 'config', '--get', 'remote.origin.url'), `git@github.com:${USER}/Shop.git`, 'origin is left as the director set it');
    assert.deepEqual(gits.filter((a) => a[0] === 'fetch'), [['fetch', '-q', `https://github.com/${USER}/Shop.git`, '+refs/heads/main:refs/remotes/origin/main']]);

    // A joining computer's folder, pointed at the project over ssh.
    await seedProject(w, 'cafe-co/Cafe-Menu');
    const joined = emptyFolder();
    await withOrigin(joined, 'git@github.com:cafe-co/Cafe-Menu.git');
    gits.length = 0;
    await checkOutJoined({
      folder: joined, repo: 'cafe-co/Cafe-Menu', remoteUrl: https({ repo: 'cafe-co/Cafe-Menu' }), branch: 'main', gitPath: 'git', env, run: overHttps(w, gits), record: () => {},
    });
    assert.equal(await g(joined, 'rev-parse', 'HEAD'), await g(w.hostUrl({ repo: 'cafe-co/Cafe-Menu' }), 'rev-parse', 'main'));
    assert.equal(fs.readFileSync(path.join(joined, '.claude', 'settings.json'), 'utf8'), COMMITTED);
    assert.deepEqual(gits.filter((a) => a[0] === 'fetch'), [['fetch', '-q', 'https://github.com/cafe-co/Cafe-Menu.git', '+refs/heads/main:refs/remotes/origin/main']]);
  });
});
