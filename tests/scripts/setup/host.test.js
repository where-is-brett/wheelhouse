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
  directorGitlabApi, directorGitEnv, productOf, repoName, slugFor, REAL_USERS, LEVELS, HOST_LABELS, WAYS, OWN_APP_LATER, SIGN_UP,
  PROFILE_REPO, APP_FILE, KEY_NAME,
} from '../../../scripts/setup/host.js';
import { STEPS, planHash } from '../../../scripts/setup/steps.js';
import { startRun, addChanges, findRun, readJournal } from '../../../scripts/setup/journal.js';
import { readKey } from '../../../scripts/host/keys.js';
import { readProject } from '../../../scripts/lib/projects.js';
import { profileRemote } from '../../../scripts/profile/store.js';
import { stateDir, profileDir, wheelhouseHome } from '../../../scripts/lib/paths.js';
import { run as realRun } from '../../../scripts/lib/run.js';
import { composeCard } from '../../../scripts/cards/compose.js';
import { setLineOf, setupLine } from '../../../scripts/state/card-lines.js';
import { QUICK_LINE } from '../../../scripts/board/health.js';
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
function github({ installedAfter = 1, reach = [] } = {}) {
  const calls = [];
  let pending = 1;
  let installLooks = 0;
  const reply = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
  const fetch = async (url, init = {}) => {
    calls.push({ url, auth: init.headers?.Authorization ?? null });
    if (url === 'https://github.com/login/device/code') {
      return reply(200, { device_code: 'dev-1', user_code: 'WXYZ-1234', verification_uri: 'https://github.com/login/device', interval: 1, expires_in: 900 });
    }
    if (url === 'https://github.com/login/oauth/access_token') {
      if (pending-- > 0) return reply(200, { error: 'authorization_pending' });
      return reply(200, { access_token: ACCESS, expires_in: 28800, refresh_token: 'ghr_renewalkeyfortests1', refresh_token_expires_in: 15811200 });
    }
    if (url.startsWith('https://api.github.com/user/installations?')) {
      installLooks += 1;
      return reply(200, { installations: installLooks > installedAfter ? [{ id: 77, client_id: CLIENT_ID, app_slug: 'wheelhouse-test' }] : [{ id: 5, client_id: 'Iv1.someoneelse', app_slug: 'other' }] });
    }
    if (url.startsWith('https://api.github.com/user/installations/77/repositories')) {
      return reply(200, { repositories: reach.map((full_name) => ({ full_name })) });
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
  assert.equal(appFor(), null, 'no app of their own is recorded before Task 8b, and Wheelhouse\'s is not registered');
  assert.equal(narrowOffered('github'), true);
  assert.equal(narrowOffered('gitlab'), true);
  assert.deepEqual(connectionCard({ host: 'github', where: `${USER}/shop on GitHub` }).options.map((o) => o.label), [WAYS.own, WAYS.quick]);
  const registered = appFile(tempFolder('wh-app-'));
  assert.equal(wheelhouseAppOffered({ appFile: registered }), true);
  assert.deepEqual(appFor({ appFile: registered }), { clientId: CLIENT_ID, slug: 'wheelhouse-test', owner: 'wheelhouse-org', own: false });
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
    assert.deepEqual(card.options.map((o) => o.label), [WAYS.own], 'their own app, agreed to on the card, never by default');
    assert.match(card.what, /Quick is not offered/);
    const { question } = composeCard({ ...card, kind: 'question' });
    assert.deepEqual(question.options.map((o) => o.label), [WAYS.own, 'Explain more']);
    assert.deepEqual(planned.changes.find((c) => c.action === 'connection'), { kind: 'host', target: 'github', action: 'connection', mode: 'narrow', locked: true, app: 'own-new' });
    // Making their own app is Task 8b's: until then the step stops before it makes anything.
    await assert.rejects(applyStep(step, folder, planned.changes, { answers: planned.answers }), { message: OWN_APP_LATER });
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
    assert.deepEqual(record.connection, { host: 'github', mode: 'narrow', project: `${USER}/shop` });
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
    assert.equal(later.changes.find((c) => c.action === 'connection').reuse, true);
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
