// tests/scripts/setup/host.test.js
// Setup's step 3, the host and the connection: its questions (real users, Locked, the host, the
// connection), its list, the sign-in, the repository, the narrow connection on GitHub
// (a fake device sign-in and installation) and on GitLab (a fake API refusing the project key, and
// a fake system box), protection read back, and the project's record and state clone. Nothing real
// is signed in, created or pushed: `gh`, `glab`, the browser and the box are fakes, and git runs for
// real only against bare remotes in temporary folders. Every home is a scratch folder.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  hostStep, cardFor, signIn, makeRepos, connectionCard, stricterCard, stricterWay, STRICTER, appFor, wheelhouseApp, wheelhouseAppOffered, narrowOffered, switchOnAsDirector,
  directorGitlabApi, directorKey, signInStatus, directorGitEnv, productOf, repoName, slugFor, REAL_USERS, LEVELS, HOST_LABELS, WAYS, NO_APP_LISTED, OWN_APP_WAIT_MS, SIGN_UP,
  APP_FILE, KEY_NAME, INSTALL_WAIT_MS, STOPPED, NEW_PRODUCT, fromOtherComputer, quickLaunched, repoNamed, pinOf, joinMissLine, ORGS_UNREAD, launchedIn,
  checkOutJoined, findInstallation, CERTIFICATE_GIVEN, reachLine, askAdministrationKey, setupTokenApi, SETUP_TOKEN_KEPT,
  madeWithSetupToken, findJoined, keyGitlabApi, keyGitEnv, againCard, asIsReachEnv, reachFailureKind, ownSignInFailure, holdsState, SIGN_IN_TARGET, ASIS_SETTINGS_UNREAD, asIsSettingLine, ASIS_NO_ADDRESS,
} from '../../../scripts/setup/host.js';
import { trialGitEnv, trialAdapter } from '../../../scripts/setup/health.js';
import { installationCovers } from '../../../scripts/host/connection.js';
import { caFile, probeCertificate, CERTIFICATE_NOT_IN_STORE } from '../../../scripts/host/company-ca.js';
import { applyCompanyCa } from '../../../scripts/setup/tools.js';
import { writeProject } from '../../../scripts/lib/projects.js';
import { setupGit } from '../../../scripts/setup/git.js';
import { questionsStep } from '../../../scripts/setup/questions.js';
import { rulesStep } from '../../../scripts/setup/rules.js';
import { stepsFor, joinedRepo, onRunList, JOINING_STEPS, SETUP_STEPS } from '../../../scripts/lib/setup-run.js';
import { eventPath } from '../../../scripts/state/events.js';
import { STEPS, planHash } from '../../../scripts/setup/steps.js';
import { startRun, addChanges, findRun, readJournal } from '../../../scripts/setup/journal.js';
import { readKey, writeKey } from '../../../scripts/host/keys.js';
import { readProject } from '../../../scripts/lib/projects.js';
import { stateDir, profileDir, wheelhouseHome } from '../../../scripts/lib/paths.js';
import { run as realRun } from '../../../scripts/lib/run.js';
import { guardedRun } from '../../helpers/host-stand-ins.js';
import { makeFakeCurl, makeRoutedCurl, parseConfig } from '../../helpers/fake-curl.js';

// Setup's own runs: git and what the test fakes; any other host tool is refused and noted here.
const hostLog = [];
const hostGuard = guardedRun(realRun, { log: hostLog });
after(() => assert.deepEqual(hostLog, [], 'no host tool ran'));
import { composeCard, isTooLong } from '../../../scripts/cards/compose.js';
import { termsIn, glossaryOf } from '../../../scripts/frontdesk/glossary.js';
import { setLineOf, setupLine } from '../../../scripts/state/card-lines.js';
import { QUICK_LINE, quickLineFor } from '../../../scripts/lib/host-lines.js';
import { QUICK_LINE as BOARD_QUICK_LINE } from '../../../scripts/board/health.js';
import { FREE_PLAN_LINE } from '../../../scripts/host/protection.js';
import { g, LOCAL_PATHS } from '../../helpers/git-fixture.js';
import { KEEP_HERE, PUT_ON_GITHUB, PUT_ON_GITLAB, remotesOf, chosenHost } from '../../../scripts/setup/local.js';
import { homeDir } from '../../../scripts/host/local/home.js';
import { GITLAB_COM, COMPANY_GITLAB, companyAddress, nameGitlabHost, guardAsIsReach } from '../../../scripts/setup/host.js';
import { HELD_SECRET } from '../../../scripts/lib/pasted-address.js';
import { DEFAULT_GITLAB } from '../../../scripts/host/gitlab-base.js';
import { tempFolder, withHome } from '../../helpers/homes.js';
import { useFileKeyStore } from '../../helpers/file-key-store.js';

// Keys are kept in key files under the test's home, not in the computer's own store.
useFileKeyStore();

// No test asks the computer's own store for a key.
directorKey.borrow = async () => null;

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
    // The director's own git settings and a look at a remote through it: stand-ins, so no test reads the developer's own
    // git settings or reaches a real host.
    if (name === 'git' && args[0] === 'config' && args[1] === '--get-urlmatch') return w.directorConfig?.(args) ?? answer('', 1);
    if (name === 'git' && args[0] === 'ls-remote' && args.at(-1) === 'HEAD') return w.lsRemote?.(args) ?? answer('', 128);
    if (name !== 'gh' && name !== 'glab') return hostGuard(file, args, options);
    const host = name === 'gh' ? 'github' : 'gitlab';
    // The tool starts here (step 2's check of a tool makes no request of the host, so it is not among the calls).
    if (args[0] === 'version' && !w.blockedTool) return answer(`${name} version 1.0.0\n`);
    if (args[0] === 'version') return answer('', 1, 'This program is blocked by group policy.');
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
    // A file on a repository's default branch, read from its bare remote.
    const contents = args[0] === 'api' ? /^repos\/(.+?\/[^/]+)\/contents\/(.+)$/.exec(args[1]) : null;
    if (contents) {
      if (!w.repos[contents[1]]) return answer('', 1, 'gh: Not Found (HTTP 404)');
      const shown = await realRun('git', ['cat-file', '-e', `HEAD:${contents[2]}`], { cwd: w.hostUrl({ repo: contents[1] }) });
      return shown.code === 0 ? answer(JSON.stringify({ path: contents[2], type: 'file' })) : answer('', 1, 'gh: Not Found (HTTP 404)');
    }
    if (args[0] === 'api' && args[1].startsWith('repos/')) {
      const repo = args[1].slice('repos/'.length);
      const found = w.repos[repo];
      return found ? answer(JSON.stringify({ full_name: repo, id: found.id, default_branch: 'main', private: 'private' in found ? found.private : true, ...('visibility' in found ? { visibility: found.visibility } : {}) })) : answer('', 1, 'gh: Not Found (HTTP 404)');
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
      // A file on a branch, read from the project's bare remote.
      const file = /^\/projects\/([^/]+)\/repository\/files\/([^?]+)\?ref=(.+)$/.exec(p);
      if (file) {
        const repo = decodeURIComponent(file[1]);
        if (!w.repos[repo]) return { status: 404, body: null };
        const shown = await realRun('git', ['cat-file', '-e', `${decodeURIComponent(file[3])}:${decodeURIComponent(file[2])}`], { cwd: w.hostUrl({ repo }) });
        return shown.code === 0 ? { status: 200, body: { file_path: decodeURIComponent(file[2]) } } : { status: 404, body: null };
      }
      const key = decodeURIComponent(p.replace(/^\/projects\//, ''));
      const [repo, found] = Object.entries(w.repos).find(([r, v]) => r === key || String(v.id) === key) ?? [];
      return found ? { status: 200, body: { id: found.id, path_with_namespace: repo, default_branch: 'main', visibility: found.visibility ?? 'private' } } : { status: 404, body: null };
    },
    async post(p, body) {
      w.calls.push({ api: 'post', path: p, body });
      if (p === '/projects') {
        const made = await w.add(`${USER}/${body.path}`, { readme: body.initialize_with_readme === true });
        return { status: 201, body: { id: made.id, path_with_namespace: `${USER}/${body.path}` } };
      }
      if (p.endsWith('/access_tokens')) {
        if (w.keyAnswer === 'unreachable') throw new Error('Could not reach GitLab');
        if (w.keyAnswer !== undefined) return { status: w.keyAnswer, body: w.keyBody ?? { message: 'no' } };
        if (w.refuseKeys) return { status: 403, body: { message: 'forbidden' } };
        w.api.keys.push(body);
        return { status: 201, body: { id: 900 + w.api.keys.length, token: `glpat-project-key-${w.api.keys.length}`, expires_at: body.expires_at } };
      }
      return { status: 404, body: null };
    },
    async put() { return { status: 404, body: null }; },
    async delete() { return { status: 404, body: null }; },
  };
  // GitLab's API with a pasted personal token: what it says the token is (`pastedSelf`, by default api and
  // write_repository ending in 30 days), and whether its revoke works (`pastedRevoke`).
  w.pasted = { revoked: 0 };
  w.pastedApi = {
    async get(p) {
      if (p !== '/personal_access_tokens/self') return { status: 404, body: null };
      return w.pastedSelf ?? { status: 200, body: { scopes: ['api', 'write_repository'], expires_at: new Date(NOW.getTime() + 30 * 86400000).toISOString().slice(0, 10) } };
    },
    async delete() { w.pasted.revoked += 1; return { status: w.pastedRevoke ?? 204, body: null }; },
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
const said = (label) => (typeof label === 'object' ? { label: null, text: label.text, at: NOW.toISOString() } : { label, text: null, at: NOW.toISOString() });

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

const choose = ({ realUsers = REAL_USERS.no, locked = LEVELS.standard, host = HOST_LABELS.github, way = WAYS.quick } = {}) => (id, card) => {
  if (id === 'real-users') return realUsers;
  if (id === 'locked') return locked;
  if (id === 'host') return host;
  if (id === 'gitlab-where') return GITLAB_COM;
  // On the Mac's card a narrow way sits behind Make it stricter.
  if (id.startsWith('connection-')) return card?.options && !card.options.some((o) => o.label === way) && card.options.some((o) => o.label === STRICTER) ? STRICTER : way;
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
  pastedGitlab: () => w.pastedApi, open: async () => {}, sleep: async () => {}, ...extra,
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
    // Locked takes Quick away, and with no Wheelhouse app their own app is the one way left, so
    // the connection is not asked.
    assert.deepEqual(mac.asked.map((a) => a.id.replace(/-[0-9a-f]{10,}$/, '')), ['real-users', 'locked', 'host']);
    assert.match(mac.asked[0].card.what, /Does Zoe-app have real users/);
    assert.deepEqual(mac.changes.find((c) => c.action === 'connection'), { kind: 'host', target: 'github', action: 'connection', mode: 'narrow', locked: true, backend: 'cli', app: { account: USER, name: `Wheelhouse ${USER}`, own: true } });
    assert.equal(mac.answers['3.real-users'].label, REAL_USERS.yes, 'step 4 reads this answer');
    assert.equal(mac.answers['3.locked'].label, LEVELS.locked, 'step 4 reads this answer');
    // Each question composes as a question card, as the engine composes it, with no set line.
    for (const a of mac.asked) {
      const { question } = composeCard({ ...a.card, kind: 'question', suggest: false });
      assert.equal(setLineOf(question.question), null);
    }
    // On Windows, Locked is not offered: the connection comes after the host.
    const win = await answerAll(step, ctxFor(folder, { platform: 'win32' }), choose({ realUsers: REAL_USERS.yes }));
    assert.deepEqual(win.asked.map((a) => a.id.replace(/-[0-9a-f]{10,}$/, '')), ['real-users', 'host', 'connection']);
    assert.ok(win.asked[2].card.options.some((o) => o.label === WAYS.quick));
    // Standard is what Windows gets even from an old Locked answer: the connection is never made for Locked there.
    const stale = await answerAll(step, ctxFor(folder, { platform: 'win32' }), choose({ realUsers: REAL_USERS.yes, locked: LEVELS.locked, way: WAYS.own }));
    assert.ok(!stale.asked.some((x) => x.id.startsWith('locked')));
    assert.notEqual(stale.changes.find((c) => c.action === 'connection')?.locked, true);
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

test('on a Mac Quick is the default and the narrow ways sit behind Make it stricter, recommended with real users', () => {
  const registered = appFile(tempFolder('wh-app-'));
  const where = `${USER}/shop on GitHub`;
  for (const host of ['github', 'gitlab']) {
    const card = connectionCard({ host, where, platform: 'darwin', appFile: registered });
    assert.deepEqual(card.options.map((o) => o.label), [WAYS.quick, STRICTER]);
    assert.equal(card.recommend, WAYS.quick);
    assert.match(card.options[0].says, /ordinary .* sign-in/);
    assert.doesNotMatch(card.options[0].says, /full .* access|leaked/, 'no alarm on the default');
    assert.match(card.options[1].says, /^A key to this one project only, instead of your whole account; recommended for teams and products with real users\./);
    assert.equal(/30-day token you paste stands in, and it can act as you across GitLab\.$/.test(card.options[1].says), host === 'gitlab');
    assert.equal(connectionCard({ host, where, platform: 'darwin', realUsers: true }).recommend, STRICTER);
    composeCard({ ...card, kind: 'question' });
  }
  // Locked and launched projects keep the narrow ways on the Mac too; with one way, step 3 asks nothing.
  assert.deepEqual(connectionCard({ host: 'github', where, platform: 'darwin', locked: true }).options.map((o) => o.label), [WAYS.own]);
  assert.ok(!connectionCard({ host: 'gitlab', where, platform: 'darwin', launched: true }).options.some((o) => o.label === STRICTER));
  // Where Make it stricter leads: GitLab's key, their own app, or a card while the Wheelhouse app is registered.
  assert.equal(stricterWay({ host: 'gitlab' }), WAYS.narrow);
  assert.equal(stricterWay({ host: 'github' }), WAYS.own);
  assert.equal(stricterWay({ host: 'github', appFile: registered }), null);
  const which = stricterCard({ where, appFile: registered });
  assert.deepEqual(which.options.map((o) => o.label), [WAYS.wheelhouse, WAYS.own]);
  assert.equal(which.recommend, WAYS.wheelhouse);
  composeCard({ ...which, kind: 'question' });
});

test('on Windows a narrow way is recommended, with one plain line on why, and Quick says what it risks', () => {
  const where = `${USER}/shop on GitHub`;
  for (const host of ['github', 'gitlab']) {
    const card = connectionCard({ host, where, platform: 'win32' });
    assert.equal(card.recommend, host === 'github' ? WAYS.own : WAYS.narrow);
    assert.match(card.because, host === 'github' ? /if it leaked, the rest of your account would stay out of reach/ : /if it leaked, only this project would be open\. If GitLab can't make a project key \(some companies switch them off\), a 30-day token stands in instead, and it can act as you in every GitLab project and group you can reach/);
    assert.doesNotMatch(card.because, /Windows/);
    const quick = card.options.find((o) => o.label === WAYS.quick).says;
    assert.ok(quick.startsWith(quickLineFor(host)));
    assert.match(quick, /If that sign-in leaked, it would open all of them\. On Windows any agent's command could read it\.$/);
    assert.doesNotMatch(quick, /own tool/, 'Quick does not say it works only through the host\'s tool');
    composeCard({ ...card, kind: 'question' });
  }
  assert.doesNotMatch(connectionCard({ host: 'github', where, platform: 'win32', locked: true }).because, /Quick/);
});

test('on GitHub the card offers the Wheelhouse app, their own app and Quick, and a Locked project is never offered Quick', async () => {
  const registered = appFile(tempFolder('wh-app-'));
  const labels = (card) => card.options.map((o) => o.label);
  const where = `${USER}/shop on GitHub`;
  const open = connectionCard({ host: 'github', where, appFile: registered });
  assert.deepEqual(labels(open), [WAYS.wheelhouse, WAYS.own, WAYS.quick]);
  assert.equal(open.recommend, WAYS.wheelhouse);
  assert.match(open.what, /a-director\/shop on GitHub/);
  assert.ok(open.options.find((o) => o.label === WAYS.quick).says.startsWith(quickLineFor('github')), 'Quick carries its cost');
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
    assert.deepEqual(planned.changes.find((c) => c.action === 'connection'), { kind: 'host', target: 'gitlab', action: 'connection', mode: 'narrow', locked: true, backend: 'cli' });
  });
});

test('a Locked project with only their own app on offer is not asked, and its Go-ahead card lists the app', async () => {
  await withHome(async () => {
    const folder = productFolder();
    await withOrigin(folder, `https://github.com/${USER}/shop.git`);
    const w = standIn();
    await w.add(`${USER}/shop`);
    const step = stepFor(w);
    const planned = await answerAll(step, ctxFor(folder), choose({ realUsers: REAL_USERS.yes, locked: LEVELS.locked, way: WAYS.own }));
    // One way is no choice, and AskUserQuestion shows no card with one option: step 3 takes it.
    assert.deepEqual(planned.asked.map((a) => a.id), ['real-users', 'locked']);
    assert.deepEqual(connectionCard({ host: 'github', where: `${USER}/shop on GitHub`, locked: true }).options.map((o) => o.label), [WAYS.own]);
    // Their own app is made at apply, from the Go ahead on the card that lists it, never unannounced.
    assert.deepEqual(planned.changes.find((c) => c.action === 'own-app'), { kind: 'host', target: 'github', action: 'own-app', account: USER, name: `Wheelhouse ${USER}` });
    assert.match(planned.card.what, /Your own GitHub App/);
    assert.match(planned.card.what, /click Create/);
    // A list naming no app is refused by apply too, before it makes anything.
    const list = [{ kind: 'host', target: 'github', action: 'connection', mode: 'narrow', locked: true }, { kind: 'file', target: 'x', action: 'project', repo: `${USER}/shop` }];
    await assert.rejects(applyStep(step, folder, list, { answers: planned.answers }), { message: NO_APP_LISTED });
    assert.deepEqual(readJournal().runs.flatMap((r) => r.changes), []);
    assert.ok(!w.calls.some((c) => c.args?.[0] === 'auth' && c.args[1] === 'login'));
  });
});

test('every card step 3 can ask, in every state it is built in, offers two to four options as the engine composes it', async () => {
  // AskUserQuestion shows no question with fewer than two options or more than four: such a card
  // never reaches the director, and setup stalls on it.
  await withHome(async () => {
    const registered = appFile(tempFolder('wh-app-'));
    const seen = new Set();
    // Where the product is: a new one on either host, or a folder already connected to one.
    const places = [[null, HOST_LABELS.github], [null, HOST_LABELS.gitlab], [`https://github.com/${USER}/shop.git`], [`https://gitlab.com/${USER}/shop.git`]];
    for (const app of [NO_APP, registered]) {
      for (const platform of ['darwin', 'win32']) {
        for (const [origin, host] of places) {
          for (const realUsers of [REAL_USERS.yes, REAL_USERS.no]) {
            // Locked is offered on a Mac with real users only.
            for (const locked of platform === 'darwin' && realUsers === REAL_USERS.yes ? [LEVELS.locked, LEVELS.standard] : [LEVELS.standard]) {
              // The connection answered with its first option, or with Make it stricter where offered.
              for (const stricter of [false, true]) {
                const folder = productFolder();
                if (origin !== null) await withOrigin(folder, origin);
                const w = standIn();
                if (origin !== null) await w.add(`${USER}/shop`);
                const pick = (id, card) => {
                  if (!id.startsWith('connection-')) return choose({ realUsers, locked, host })(id, card);
                  const labels = card.options.map((o) => o.label);
                  return stricter && labels.includes(STRICTER) ? STRICTER : labels[0];
                };
                const planned = await answerAll(stepFor(w, { appFile: app }), ctxFor(folder, { platform }), pick);
                for (const a of planned.asked) {
                  const labels = JSON.stringify(a.card.options.map((o) => o.label));
                  seen.add(labels);
                  const { question } = composeCard({ ...a.card, kind: 'question', suggest: false });
                  assert.ok(question.options.length >= 2 && question.options.length <= 4, `${a.id} offers ${labels}`);
                }
              }
            }
          }
        }
      }
    }
    // The connection's cards were reached: Quick with Make it stricter, the narrow ways, and the stricter choice.
    assert.ok([...seen].some((k) => k.includes(STRICTER)));
    assert.ok([...seen].some((k) => k.includes(WAYS.wheelhouse) && !k.includes(WAYS.quick)));
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
    assert.match(question.question, /A private repository a-director\/Shop on GitHub with a README/);
    assert.doesNotMatch(question.question, /:\/\/|\.git\b/, 'repositories named as owner/name on GitHub, never an address');

    const { run, lines } = await applyStep(step, folder, planned.changes, { answers: planned.answers });
    const create = w.calls.filter((c) => c.args?.[0] === 'repo');
    assert.deepEqual(create.map((c) => c.args), [
      ['repo', 'create', `${USER}/Shop`, '--private', '--add-readme'],
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
    // Its record, then its private record on this computer.
    const slug = slugFor(`${USER}/Shop`);
    assert.deepEqual(readProject(slug), { folder, remoteUrl: remote, host: 'github', repo: `${USER}/Shop`, connection: { host: 'github', mode: 'quick', backend: 'cli', project: `${USER}/Shop` } });
    assert.ok(fs.existsSync(path.join(stateDir(slug), '.git')));
    // Each change in the journal, in the order made.
    assert.deepEqual(run.changes.map((c) => [c.kind, c.target.replace(wheelhouseHome(), '~').replace(folder, '<folder>')]), [
      ['host', `github:${USER}/Shop`],
      ['folder', path.join('<folder>', '.git')],
      ['file', path.join('~', 'projects', slug, 'project.json')],
      ['folder', path.join('~', 'projects', slug, 'record')],
    ]);
    assert.deepEqual(run.changes[0].after, { repository: `${USER}/Shop`, private: true, made: true });
    assert.match(lines.at(-1), /Connected: a-director\/Shop on GitHub, Quick/);
    // Applied again (a retry), nothing new is made.
    const again = await applyStep(step, folder, planned.changes, { answers: planned.answers });
    assert.deepEqual(again.run.changes.filter((c) => c.kind === 'host'), []);
    assert.equal(w.calls.filter((c) => c.args?.[0] === 'repo').length, 1);

    // An existing product keeps its repository: none is made.
    const old = productFolder('old');
    await withOrigin(old, `git@github.com:${USER}/old.git`);
    await w.add(`${USER}/old`);
    const before = w.calls.length;
    const existing = await answerAll(step, ctxFor(old), choose());
    assert.ok(!existing.changes.some((c) => c.action === 'repository' || c.action === 'connect'));
    assert.match(existing.card.what, /a-director\/old on GitHub, kept as it is/);
    await applyStep(step, old, existing.changes, { answers: existing.answers });
    assert.ok(!w.calls.slice(before).some((c) => c.args?.[0] === 'repo'));
    assert.equal(readProject(slugFor(`${USER}/old`)).remoteUrl, w.hostUrl({ repo: `${USER}/old` }));
    assert.equal(await g(old, 'config', '--get', 'remote.origin.url'), `git@github.com:${USER}/old.git`, 'the folder\'s own address is left as it is');
  });
});

test('step 3 makes no profile repository', async () => {
  for (const [host, label] of [['github', HOST_LABELS.github], ['gitlab', HOST_LABELS.gitlab]]) {
    await withHome(async () => {
      const w = standIn();
      const folder = productFolder();
      const step = stepFor(w);
      const planned = await answerAll(step, ctxFor(folder), choose({ host: label }));
      assert.ok(!planned.changes.some((c) => /^profile|enrolment/.test(c.action ?? '')), host);
      assert.doesNotMatch(planned.card.what, /profile/, host);
      assert.doesNotMatch(planned.card.what, /key in your/, host);
      await applyStep(step, folder, planned.changes, { answers: planned.answers });
      // Only the product's repository is made; no profile.json, no profile clone.
      assert.deepEqual(Object.keys(w.repos), [`${USER}/Shop`], host);
      assert.equal(fs.existsSync(path.join(wheelhouseHome(), 'profile.json')), false, host);
      assert.equal(fs.existsSync(path.join(wheelhouseHome(), 'profile')), false, host);
      assert.ok(!findRun(folder).changes.some((c) => /profile|enrolments/.test(c.target)), host);
      // The director's settings on this computer: a record with no remote.
      assert.equal(profileDir(), path.join(wheelhouseHome(), 'settings'));
      assert.ok(fs.existsSync(path.join(profileDir(), '.git')), host);
      assert.equal(await g(profileDir(), 'remote'), '', host);
    });
  }
});

test('step 3 opens the record and pushes no state branch', async () => {
  await withHome(async () => {
    const w = standIn();
    const pushes = [];
    const run = async (file, args, options = {}) => {
      if (path.basename(file).replace(/\.exe$/, '') === 'git' && args.includes('push')) pushes.push([...args]);
      return w.run(file, args, options);
    };
    const folder = productFolder();
    const step = stepFor(w, { run });
    const planned = await answerAll(step, ctxFor(folder), choose());
    const slug = slugFor(`${USER}/Shop`);
    assert.deepEqual(planned.changes.at(-1), { kind: 'folder', target: stateDir(slug), action: 'state', repo: `${USER}/Shop` });
    assert.match(planned.card.what, /The project's record, kept on this computer/);
    assert.doesNotMatch(planned.card.what, /state branch/);
    await applyStep(step, folder, planned.changes, { answers: planned.answers });
    assert.deepEqual(pushes, [], 'nothing pushed');
    assert.ok(fs.existsSync(path.join(stateDir(slug), '.git')));
    assert.equal(await g(stateDir(slug), 'remote'), '', 'the record has no remote');
    assert.equal(await g(stateDir(slug), 'symbolic-ref', '--short', 'HEAD'), 'record');
    const remote = w.hostUrl({ repo: `${USER}/Shop` });
    assert.equal(await g(remote, 'for-each-ref', '--format=%(refname)'), 'refs/heads/main', 'the host holds only the product\'s own branch');
    assert.deepEqual(findRun(folder).changes.find((c) => c.target === stateDir(slug)).after, { record: true });
    // Applied again, the record is opened as it is.
    await applyStep(step, folder, planned.changes, { answers: planned.answers });
    assert.equal(await g(stateDir(slug), 'rev-list', '--count', 'HEAD'), '1');
    // An existing product's empty repository is set up too: nothing of Wheelhouse's goes to it.
    await w.add(`${USER}/empty`, { readme: false });
    const empty = productFolder('empty');
    await withOrigin(empty, `https://github.com/${USER}/empty.git`);
    const listed = await answerAll(step, ctxFor(empty), choose());
    await applyStep(step, empty, listed.changes, { answers: listed.answers });
    assert.equal(await g(w.hostUrl({ repo: `${USER}/empty` }), 'for-each-ref'), '');
    assert.ok(fs.existsSync(path.join(stateDir(slugFor(`${USER}/empty`)), '.git')));
  });
});

test('a public repository is set up', async () => {
  for (const [host, label, extra] of [['github', HOST_LABELS.github, { private: false }], ['github', HOST_LABELS.github, { visibility: 'internal' }], ['gitlab', HOST_LABELS.gitlab, { visibility: 'public' }]]) {
    await withHome(async () => {
      const w = standIn();
      const repo = `${USER}/open-shop`;
      await w.add(repo);
      Object.assign(w.repos[repo], extra);
      const folder = productFolder('open-shop');
      await withOrigin(folder, `https://${host}.com/${repo}.git`);
      const step = stepFor(w);
      const planned = await answerAll(step, ctxFor(folder), choose({ host: label }));
      assert.ok(!planned.asked.some((a) => a.id.startsWith('not-private')), `${host}: no card about it`);
      await applyStep(step, folder, planned.changes, { answers: planned.answers });
      assert.equal(readProject(slugFor(repo)).repo, repo, host);
      assert.ok(fs.existsSync(path.join(stateDir(slugFor(repo)), '.git')), host);
      assert.equal(await g(w.hostUrl({ repo }), 'for-each-ref', '--format=%(refname)'), 'refs/heads/main', `${host}: nothing pushed to it`);
    });
  }
  // A public project a second computer joins is joined.
  await withHome(async () => {
    const w = standIn();
    await seedProject(w, `${USER}/Cafe-Menu`, { stateBranch: false });
    w.repos[`${USER}/Cafe-Menu`].private = false;
    const step = stepFor(w);
    const folder = emptyFolder();
    const planned = await answerJoin(step, ctxFor(folder), joining());
    const run = startRun({ folder, now: () => NOW });
    await applyIn(step, folder, run.id, planned.changes, { answers: planned.answers });
    assert.equal(joinedRepo(findRun(folder)), `${USER}/Cafe-Menu`);
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
    // Every git call step 3 made shut out git's global and system config, with hooks off. The one exception is the plan's
    // read of the director's own settings (the credential helper and proxy for the host's address), which is the
    // director's git as it is and writes nothing.
    const fenced = gits.filter((c) => !(c.args[0] === 'config' && c.args[1] === '--get-urlmatch'));
    assert.ok(fenced.length > 0);
    for (const c of fenced) {
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
      for (const a of planned.asked) composeCard({ ...a.card, kind: 'question', suggest: false });
    }
  });
});

test('STOP stops the step between its parts, with what it made still recorded', async () => {
  await withHome(async () => {
    const w = standIn();
    const folder = productFolder();
    const step = stepFor(w);
    const planned = await answerAll(step, ctxFor(folder), choose());
    await assert.rejects(applyStep(step, folder, planned.changes, { answers: planned.answers, stopped: () => true }), /All stop came on/);
    assert.deepEqual(readJournal().runs.flatMap((r) => r.changes), [], 'stopped before anything was made');
    // STOP coming on after the repositories: they stay recorded; no record or state clone follows.
    let looks = 0;
    await assert.rejects(applyStep(step, folder, planned.changes, { answers: planned.answers, stopped: () => (looks += 1) > 3 }), /All stop came on/);
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
    await assert.rejects(applyStep(step, folder, planned.changes, { answers: planned.answers }), (error) => /a-director\/Shop already exists on GitHub and wasn't set up with Wheelhouse, so setup won't use it for a new product: rename this folder, then start setup again from it/.test(error.message) && !/brings it into this folder/.test(error.message));
    assert.equal(fs.existsSync(path.join(folder, '.git')), false);
  });
});

test('narrow on GitHub: the code and the Install page are said, the installation is found and kept, and its reach is read back', async () => {
  await withHome(async () => {
    const w = standIn();
    await w.add(`${USER}/shop`);
    const folder = productFolder('shop');
    await withOrigin(folder, `https://github.com/${USER}/shop.git`);
    // The director ticks the project on the Install page, and a later one on the settings page.
    const gh = github({ reach: [`${USER}/shop`] });
    const opened = [];
    const open = async (url) => {
      opened.push(url);
      if (url === 'https://github.com/settings/installations/77') gh.reach.push(`${USER}/next`);
    };
    const registered = appFile(tempFolder('wh-app-'));
    const step = stepFor(w, { appFile: registered, fetch: gh.fetch, open });
    const planned = await answerAll(step, ctxFor(folder), choose({ realUsers: REAL_USERS.yes, locked: LEVELS.standard, way: WAYS.wheelhouse }));
    assert.deepEqual(planned.changes.find((c) => c.action === 'connection').app, { clientId: CLIENT_ID, slug: 'wheelhouse-test', own: false });
    assert.match(planned.director, /a code typed on GitHub, Authorise, and a tick on the Install page/);
    assert.match(planned.card.what, /tick the project on its Install page, not All repositories/);
    const { lines, run } = await applyStep(step, folder, planned.changes, { answers: planned.answers });
    assert.match(lines[0], /^Type WXYZ-1234 at https:\/\/github\.com\/login\/device, then click Authorise$/);
    assert.match(lines[1], /tick a-director\/shop on GitHub \(not All repositories\)/);
    assert.match(lines[2], /^The app can reach a-director\/shop on GitHub, and nothing else/);
    assert.deepEqual(opened, ['https://github.com/login/device', 'https://github.com/apps/wheelhouse-test/installations/new']);
    const keys = readKey('github-app');
    assert.equal(keys.clientId, CLIENT_ID, 'renewing needs the client ID');
    assert.equal(keys.installationId, 77, 'the reach check needs the installation');
    assert.equal(keys.accessToken, ACCESS);
    const record = readProject(slugFor(`${USER}/shop`));
    assert.deepEqual(record.connection, { host: 'github', mode: 'narrow', project: `${USER}/shop`, backend: 'cli', installationId: 77 });
    // No key in the journal or anything said.
    const kept = JSON.stringify(run) + lines.join('\n');
    assert.ok(!kept.includes(ACCESS) && !kept.includes('ghr_'), 'no key is kept in the journal or said');
    assert.ok(run.changes.some((c) => c.kind === 'host' && c.target === 'key github-app'));
    // Setup's own git and host calls used the director's sign-in, never the app's key.
    assert.ok(w.calls.every((c) => !c.env?.GH_TOKEN));

    // A later project: no new code, only a tick on the app's settings page.
    await w.add(`${USER}/next`);
    gh.reach.splice(0, gh.reach.length, `${USER}/shop`);
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
    assert.match(second.lines.at(-2), /The app can reach a-director\/next on GitHub, and nothing else/);
  });
});

test('a GitLab that forbids a project key (a free plan on gitlab.com) falls back to the system\'s box; a 404 stops plainly', async () => {
  await withHome(async () => {
    const w = standIn({ refuseKeys: true });
    await w.add(`${USER}/shop`);
    const folder = productFolder('shop');
    await withOrigin(folder, `https://gitlab.com/${USER}/shop.git`);
    const opened = [];
    const boxes = [];
    const step = stepFor(w, { open: async (url) => { opened.push(url); }, askSecret: async (box) => { boxes.push(box); return `${PASTED}\n`; } });
    const planned = await answerAll(step, ctxFor(folder), choose({ way: WAYS.narrow }));
    const { lines } = await applyStep(step, folder, planned.changes, { answers: planned.answers });
    assert.equal(boxes.length, 1);
    assert.ok(opened[0].startsWith('https://gitlab.com/-/user_settings/personal_access_tokens'), opened[0]);
    assert.ok(lines.includes(reachLine({ kind: 'gitlab-personal' })), lines.join('\n'));
    assert.equal(readKey(`gitlab-project-${w.repos[`${USER}/shop`].id}`).kind, 'pasted-token');
  });
  await withHome(async () => {
    const w = standIn({ keyAnswer: 404 });
    await w.add(`${USER}/shop`);
    const folder = productFolder('shop');
    await withOrigin(folder, `https://gitlab.com/${USER}/shop.git`);
    const opened = [];
    const step = stepFor(w, { open: async (url) => { opened.push(url); }, askSecret: async () => { throw new Error('no box should open'); } });
    const planned = await answerAll(step, ctxFor(folder), choose({ way: WAYS.narrow }));
    await assert.rejects(applyStep(step, folder, planned.changes, { answers: planned.answers }), /could not find the project/);
    assert.deepEqual(opened, []);
  });
});

test('a pasted personal token is asked what it is: one wider or longer than the cards said is revoked and refused', async () => {
  const far = new Date(NOW.getTime() + 365 * 86400000).toISOString().slice(0, 10);
  const cases = [
    [{ status: 200, body: { scopes: ['api', 'write_repository', 'sudo'], expires_at: new Date(NOW.getTime() + 30 * 86400000).toISOString().slice(0, 10) } }, 204, /can do more than api and write_repository, so it was not kept and setup cancelled it/],
    [{ status: 200, body: { scopes: ['api', 'write_repository'], expires_at: null } }, 204, /ends later than 30 days from now, or never, so it was not kept and setup cancelled it/],
    [{ status: 200, body: { scopes: ['api'], expires_at: far } }, 500, /so it was not kept: delete it on GitLab's Access tokens page/],
  ];
  for (const [self, revoke, words] of cases) {
    await withHome(async () => {
      const w = standIn({ refuseKeys: true });
      w.pastedSelf = self;
      w.pastedRevoke = revoke;
      await w.add(`${USER}/shop`);
      const folder = productFolder('shop');
      await withOrigin(folder, `https://gitlab.com/${USER}/shop.git`);
      const step = stepFor(w, { askSecret: async () => `${PASTED}\n` });
      const planned = await answerAll(step, ctxFor(folder), choose({ way: WAYS.narrow }));
      await assert.rejects(applyStep(step, folder, planned.changes, { answers: planned.answers }), words);
      assert.equal(w.pasted.revoked, 1);
      assert.equal(readKey(`gitlab-project-${w.repos[`${USER}/shop`].id}`), null);
    });
  }
});

test('a pasted personal token GitLab won\'t describe is refused, with word to delete it', async () => {
  for (const [self, words] of [[{ status: 404, body: null }, /HTTP 404\), so it was not kept: delete it on GitLab's Access tokens page/], [{ status: 403, body: null }, /would not let the pasted token say what it can do \(it needs api\), so it was not kept: delete it/], [{ status: 500, body: null }, /HTTP 500\), so it was not kept: delete it/]]) {
    await withHome(async () => {
      const w = standIn({ refuseKeys: true });
      w.pastedSelf = self;
      await w.add(`${USER}/shop`);
      const folder = productFolder('shop');
      await withOrigin(folder, `https://gitlab.com/${USER}/shop.git`);
      const step = stepFor(w, { askSecret: async () => `${PASTED}\n` });
      const planned = await answerAll(step, ctxFor(folder), choose({ way: WAYS.narrow }));
      await assert.rejects(applyStep(step, folder, planned.changes, { answers: planned.answers }), words);
      assert.equal(w.pasted.revoked, 0);
      assert.equal(readKey(`gitlab-project-${w.repos[`${USER}/shop`].id}`), null);
    });
  }
});

test('a made project key says what it reaches, word for word', async () => {
  await withHome(async () => {
    const w = standIn();
    await w.add(`${USER}/shop`);
    const folder = productFolder('shop');
    await withOrigin(folder, `https://gitlab.com/${USER}/shop.git`);
    const step = stepFor(w);
    const planned = await answerAll(step, ctxFor(folder), choose({ way: WAYS.narrow }));
    const { lines } = await applyStep(step, folder, planned.changes, { answers: planned.answers });
    assert.ok(lines.includes(`This key reaches only ${USER}/shop: its code, merge requests and settings API. It can't change the project's protection.`), lines.join('\n'));
  });
});

test('reach lines match the design word for word', () => {
  assert.equal(reachLine({ kind: 'github', repo: 'jo/shop' }), "This key reaches only jo/shop: its code, pull requests and issues. Not your other repositories, and not the repository's settings.");
  assert.equal(reachLine({ kind: 'gitlab-project', repo: 'grp/shop' }), "This key reaches only grp/shop: its code, merge requests and settings API. It can't change the project's protection.");
  assert.equal(reachLine({ kind: 'gitlab-personal' }), "GitLab won't make a key for one project here, so this is a personal key. It can act as you in every GitLab project and group you can reach, until it expires in 30 days.");
  assert.throws(() => reachLine({ kind: 'other' }));
});

test('a narrow GitHub token signs gh in on standard input, and its card says what it reaches', async () => {
  await withHome(async () => {
    const TOKEN = 'github_pat_typed_into_the_box_0001';
    const out = standIn({ signedIn: { github: false } });
    const calls = [];
    const run = async (file, args = [], options = {}) => {
      if (args[0] === 'auth' && args[1] === 'login') calls.push({ args, input: options.input });
      return out.run(file, args, options);
    };
    const opened = [];
    const lines = [];
    await signIn({
      host: 'github', run, say: (l) => lines.push(l), narrow: { owner: USER, name: 'shop' },
      open: async (url) => { opened.push(url); }, askSecret: async () => `${TOKEN}\n`,
    });
    assert.deepEqual(calls[0].args, ['auth', 'login', '--hostname', 'github.com', '--git-protocol', 'https', '--with-token']);
    assert.equal(calls[0].input, `${TOKEN}\n`);
    const url = new URL(opened[0]);
    assert.equal(url.pathname, '/settings/personal-access-tokens/new');
    assert.equal(url.searchParams.get('contents'), 'write');
    assert.equal(url.searchParams.get('administration'), null);
    assert.ok(lines.includes(`This key reaches only ${USER}/shop: its code, pull requests and issues. Not your other repositories, and not the repository's settings.`), lines.join('\n'));
    assert.ok(lines.some((l) => /Only select repositories/.test(l) && l.includes('shop')));
    assert.ok(!lines.join('\n').includes(TOKEN));
  });
});

test('the one-off Administration key is asked for on a short-lived page and never kept', async () => {
  const TOKEN = 'github_pat_administration_0001';
  const opened = [];
  const lines = [];
  const got = await askAdministrationKey({
    owner: 'jo', name: 'shop', say: (l) => lines.push(l), open: async (url) => { opened.push(url); }, askSecret: async () => ` ${TOKEN}\n`, platform: 'darwin',
  });
  assert.equal(got, TOKEN);
  const url = new URL(opened[0]);
  assert.equal(url.searchParams.get('administration'), 'write');
  assert.equal(url.searchParams.get('expires_in'), '1');
  assert.ok(lines.some((l) => /used once and not kept/.test(l)));
  assert.ok(!lines.join('\n').includes(TOKEN));
  await assert.rejects(askAdministrationKey({ owner: 'jo', name: 'shop', say() {}, open: async () => {}, askSecret: async () => '  ', platform: 'darwin' }), /No GitHub key was given/);
});

test('where GitLab makes a Developer key for the project, nothing is left for the director to do', async () => {
  await withHome(async () => {
    const keyed = standIn();
    await keyed.add(`${USER}/shop`);
    const other = productFolder('shop');
    await withOrigin(other, `https://gitlab.com/${USER}/shop.git`);
    const keyStep = stepFor(keyed, { askSecret: async () => { throw new Error('no box should open'); } });
    const plannedKeyed = await answerAll(keyStep, ctxFor(other), choose({ way: WAYS.narrow }));
    await applyStep(keyStep, other, plannedKeyed.changes, { answers: plannedKeyed.answers });
    assert.deepEqual(keyed.api.keys.map((k) => [k.name, k.access_level, k.scopes]), [[KEY_NAME, 30, ['api', 'write_repository']]], 'one key: the project\'s');
    assert.equal(readKey(`gitlab-project-${keyed.repos[`${USER}/shop`].id}`).kind, 'project-key');
  });
});

test('the director\'s GitLab sign-in is read by the helper alone and sent only in a request\'s header', async () => {
  await withHome(async () => {
    const w = standIn();
    const fake = makeFakeCurl([{ body: '{"id":1}' }]);
    const via = { run: fake.run, curl: '/usr/bin/curl', proxy: null, caFile: null, platform: 'linux' };
    const api = await directorGitlabApi({ run: w.run, via });
    await api.get('/projects/1');
    assert.ok(fake.calls[0].config.includes(`Authorization: Bearer ${DIRECTOR_GITLAB}`));
    assert.deepEqual(w.calls.at(-1).args, ['auth', 'status', '--hostname', 'gitlab.com', '--show-token']);
    assert.ok(w.calls.every((c) => !(c.args ?? []).join(' ').includes(DIRECTOR_GITLAB)), 'never in an argument');
    assert.ok(fake.calls.every((c) => !c.args.join(' ').includes(DIRECTOR_GITLAB)), 'nor in curl\'s');
    const out = standIn({ signedIn: { gitlab: false } });
    await assert.rejects(directorGitlabApi({ run: out.run, via }), /glab is not signed in/);
    // git's environment: the director's tool as its credential helper, never a key.
    const env = directorGitEnv({ host: 'gitlab', gitPath: '/usr/bin/git', env: { PATH: '/bin' }, platform: 'darwin' });
    assert.equal(env.GIT_CONFIG_VALUE_1, '!"glab" auth git-credential');
    assert.equal(env.PATH, '/usr/bin:/bin');
    assert.equal(directorGitEnv({ host: 'github', gitPath: 'C:\\Program Files\\Git\\cmd\\git.exe', env: { Path: 'C:\\Windows' }, platform: 'win32' }).Path, 'C:\\Program Files\\Git\\cmd;C:\\Windows');
  });
});

test('with no glab sign-in, the key the director\'s own git holds is used: the API, who is signed in, and the commit author', async () => {
  await withHome(async () => {
    const out = standIn({ signedIn: { gitlab: false } });
    const asked = [];
    const kept = directorKey.borrow;
    directorKey.borrow = async (args) => { asked.push(args); return { username: 'oauth2', key: 'glpat-borrowed-key-0001' }; };
    try {
      const fake = makeFakeCurl([{ body: '{"id":1}' }, { body: JSON.stringify({ id: 9, username: 'dir' }) }, { status: 401 }]);
      const via = { run: fake.run, curl: '/usr/bin/curl', proxy: null, caFile: null, platform: 'linux' };
      const api = await directorGitlabApi({ run: out.run, baseUrl: COMPANY_ORIGIN, via });
      await api.get('/user');
      assert.deepEqual(asked[0], { host: 'git.example.org:8443', base: COMPANY_ORIGIN });
      assert.ok(fake.calls[0].config.includes('Authorization: Bearer glpat-borrowed-key-0001'));
      assert.deepEqual(await signInStatus({ host: 'gitlab', run: out.run, base: COMPANY_ORIGIN, via }), { signedIn: true, user: 'dir' });
      // A key GitLab does not accept is not a sign-in.
      assert.deepEqual(await signInStatus({ host: 'gitlab', run: out.run, base: COMPANY_ORIGIN, via }), { signedIn: false, user: null });
    } finally {
      directorKey.borrow = kept;
    }
    // No key from git either: not signed in, and no call is made.
    const fake = makeFakeCurl([]);
    assert.deepEqual(await signInStatus({ host: 'gitlab', run: out.run, base: COMPANY_ORIGIN, via: { run: fake.run, curl: '/usr/bin/curl', proxy: null } }), { signedIn: false, user: null });
    assert.equal(fake.calls.length, 0);
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

test('a project with real users is switched on to merge by Maintainers, and every gap the read-back found comes back for the director', async () => {
  const plain = gitlabProtection({ pipelines: true });
  // The director's own sign-in: Free (the approval rules are refused) and a list of variables.
  const asFree = (inner, variables) => ({
    ...inner,
    async get(p) {
      if (/\/approval_rules$/.test(p)) return { status: 403, body: {} };
      if (/\/variables\?/.test(p)) return variables;
      return inner.get(p);
    },
  });
  const list = { status: 200, body: [{ key: 'DEPLOY_KEY', value: 'a-value-never-shown', protected: true }, { key: 'DEBUG', value: 'another-value', protected: false }] };
  const got = await switchOnAsDirector({ host: 'gitlab', repo: 41, api: asFree(plain, list), realUsers: true });
  assert.equal(got.on, true);
  assert.deepEqual(got.gaps, [
    "DEBUG is a project secret that a merge request's pipeline could read",
    "DEPLOY_KEY is a project secret that a pipeline on Wheelhouse's own state branch could read",
    "With real users, the project's tests on the host could be faked with Wheelhouse's key; GitLab Premium's approval step would close that",
  ]);
  assert.equal(JSON.stringify(got).includes('never-shown'), false);
  assert.equal(JSON.stringify(got).includes('another-value'), false);
  // Without real users the project merges as before, and the faked-tests line is not said.
  const before = await switchOnAsDirector({ host: 'gitlab', repo: 41, api: asFree(gitlabProtection({ pipelines: true }), { status: 200, body: [] }) });
  assert.deepEqual(before.gaps, []);
  // A list the director's sign-in could not read is said.
  const blind = await switchOnAsDirector({ host: 'gitlab', repo: 41, api: asFree(gitlabProtection({ pipelines: true }), { status: 403, body: {} }) });
  assert.deepEqual(blind.gaps, ["Wheelhouse could not look at the project's secrets, so it cannot say which ones a pipeline could read"]);
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
    // A folder with history of its own but no address stays on this computer.
    const lone = productFolder('lone');
    await g(lone, 'init', '-q', '-b', 'main');
    await g(lone, 'add', 'notes.txt');
    await g(lone, 'commit', '-q', '-m', 'mine');
    assert.deepEqual(productOf(lone), { isNew: false, host: 'local', repo: null, name: 'lone', others: [] });
  });
});

test('an answer to a connection card whose words have since changed is not carried: the card is asked again, saying why', async () => {
  await withHome(async () => {
    const w = standIn();
    const folder = productFolder('shop');
    await withOrigin(folder, `https://github.com/${USER}/shop.git`);
    const step = stepFor(w);
    const first = await answerAll(step, ctxFor(folder), choose());
    const key = `3.${first.asked.at(-1).id}`;
    // The same words: the answer stands.
    assert.equal((await step.plan(ctxFor(folder, { answers: first.answers }))).ask, undefined);
    // An answer given on a card that read otherwise, its words named by another digest.
    const { [key]: given, ...rest } = first.answers;
    const older = { ...rest, [key.replace(/[0-9a-f]{10}$/, '0123456789')]: given };
    const again = await step.plan(ctxFor(folder, { answers: older }));
    assert.ok(again.ask, 'asked again');
    assert.match(again.ask.card.what, /\? Quick works differently now, as its words say, so choose again\.$/);
    // An answer with no time it was given is not taken as the earlier one: the card is asked as it reads.
    const timeless = await step.plan(ctxFor(folder, { answers: { ...older, [key.replace(/[0-9a-f]{10}$/, '0123456789')]: { ...given, at: 'later' } } }));
    assert.equal(timeless.ask.id, first.asked.at(-1).id);
  });
});

// ---- The Install page's wait, retries and their own app ----

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
    const gh = github({ installedAfter: 84, reach: [`${USER}/shop`], onSignedIn: () => time.move(9 * 60 * 1000) });
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
    const gh = github({ installedAfter: Infinity, reach: [`${USER}/shop`] });
    const opened = [];
    const registered = appFile(tempFolder('wh-app-'));
    const step = stepFor(w, { appFile: registered, fetch: gh.fetch, sleep: time.sleep, open: async (url) => { opened.push(url); } });
    const planned = await answerAll(step, ctxFor(folder), choose({ realUsers: REAL_USERS.yes, locked: LEVELS.standard, way: WAYS.wheelhouse }));
    await assert.rejects(applyStep(step, folder, planned.changes, { answers: planned.answers, now: time.now }), /The app was not installed after 8 minutes/);
    assert.equal(readKey('github-app').installationId, undefined, 'the keys are kept, with no installation');
    // Planned again: no code this time, only the Install page.
    const again = await answerAll(step, ctxFor(folder, { now: time.now }), choose({ realUsers: REAL_USERS.yes, locked: LEVELS.standard, way: WAYS.wheelhouse }));
    assert.equal(again.changes.find((c) => c.action === 'connection').appKeys, 'signed-in');
    assert.equal(again.director, 'One click, then a tick on the app\'s Install page');
    assert.match(again.card.what, /as signed in already: tick the project on its Install page/);
    const codes = gh.calls.filter((c) => c.url === 'https://github.com/login/device/code').length;
    opened.length = 0;
    // Installed once the page has opened: setup looks first, then opens it.
    const installed = github({ installedAfter: 1, reach: [`${USER}/shop`] });
    const retry = stepFor(w, { appFile: registered, fetch: installed.fetch, sleep: time.sleep, open: async (url) => { opened.push(url); } });
    const { lines } = await applyStep(retry, folder, again.changes, { answers: again.answers, now: time.now });
    assert.equal(codes, 1);
    assert.equal(installed.calls.filter((c) => c.url === 'https://github.com/login/device/code').length, 0, 'no second code sign-in');
    assert.deepEqual(opened, ['https://github.com/apps/wheelhouse-test/installations/new']);
    assert.match(lines[0], /On the app's Install page/);
    assert.equal(readKey('github-app').installationId, 77);
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

test('a retry finishes what an attempt left: the README written out, the settings opened again, .git recorded once', async () => {
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
    // The settings on this computer, gone since, are opened again by a later project's step.
    fs.rmSync(profileDir(), { recursive: true, force: true });
    const second = productFolder('second');
    await withOrigin(second, `https://github.com/${USER}/second.git`);
    await w.add(`${USER}/second`);
    const next = await answerAll(step, ctxFor(second), choose());
    await applyStep(step, second, next.changes, { answers: next.answers });
    assert.ok(fs.existsSync(path.join(profileDir(), '.git')));
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

test('a group that has switched project keys off also falls back to the system\'s box; any other 400 stops', async () => {
  const switchedOff = { message: '400 Bad request - User does not have permission to create project access token' };
  await withHome(async () => {
    const w = standIn({ keyAnswer: 400, keyBody: switchedOff });
    await w.add(`${USER}/shop`);
    const folder = productFolder('shop');
    await withOrigin(folder, `https://gitlab.com/${USER}/shop.git`);
    const opened = [];
    const boxes = [];
    const step = stepFor(w, { open: async (url) => { opened.push(url); }, askSecret: async (box) => { boxes.push(box); return `${PASTED}\n`; } });
    const planned = await answerAll(step, ctxFor(folder), choose({ way: WAYS.narrow }));
    await applyStep(step, folder, planned.changes, { answers: planned.answers });
    assert.equal(boxes.length, 1);
    assert.ok(opened[0].startsWith('https://gitlab.com/-/user_settings/personal_access_tokens'), opened[0]);
    assert.equal(new URL(opened[0]).searchParams.get('scopes'), 'api,write_repository');
    const kept = readKey(`gitlab-project-${w.repos[`${USER}/shop`].id}`);
    assert.equal(kept.kind, 'pasted-token');
    assert.equal(kept.token, PASTED);
    assert.match(kept.expiresAt, /^\d{4}-\d{2}-\d{2}$/);
  });
  await withHome(async () => {
    const w = standIn({ keyAnswer: 400, keyBody: { message: '400 Bad request - something else' } });
    await w.add(`${USER}/shop`);
    const folder = productFolder('shop');
    await withOrigin(folder, `https://gitlab.com/${USER}/shop.git`);
    const opened = [];
    const step = stepFor(w, { open: async (url) => { opened.push(url); }, askSecret: async () => { throw new Error('no box should open'); } });
    const planned = await answerAll(step, ctxFor(folder), choose({ way: WAYS.narrow }));
    await assert.rejects(applyStep(step, folder, planned.changes, { answers: planned.answers }), /HTTP 400/);
    assert.deepEqual(opened, []);
  });
});

// The question of where a folder with no host's address is kept.
async function step3KeptAsk(step, ctx) {
  const answers = { '3.real-users': said(REAL_USERS.no) };
  return (await step.plan({ ...ctx, answers })).ask;
}

test('a folder with a history is offered GitLab as well as GitHub, and Put it on GitLab plans a GitLab project', async () => {
  await withHome(async () => {
    const w = standIn();
    const folder = productFolder('shop');
    await g(folder, 'init', '-q', '-b', 'main');
    await g(folder, 'add', 'notes.txt');
    await g(folder, 'commit', '-q', '-m', 'Begin');
    const kept = await step3KeptAsk(stepFor(w), ctxFor(folder));
    assert.deepEqual(kept.card.options.map((o) => o.label), [KEEP_HERE, PUT_ON_GITHUB, PUT_ON_GITLAB]);
    const planned = await answerAll(stepFor(w), ctxFor(folder), (id, card) => (id === 'kept' ? PUT_ON_GITLAB : choose()(id, card)));
    assert.equal(planned.changes.find((c) => c.action === 'connection')?.target, 'gitlab');
  });
});

test('a folder with a history put on GitHub sends that history to a new private repository, and no home is made', async () => {
  await withHome(async () => {
    const w = standIn();
    const folder = productFolder('shop');
    await g(folder, 'init', '-q', '-b', 'trunk');
    await g(folder, 'add', 'notes.txt');
    await g(folder, 'commit', '-q', '-m', 'Begin');
    const tip = await g(folder, 'rev-parse', 'HEAD');
    const planned = await answerAll(stepFor(w), ctxFor(folder), (id, card) => (id === 'kept' ? PUT_ON_GITHUB : choose()(id, card)));
    assert.deepEqual(planned.asked.map((a) => a.id).slice(0, 2), ['real-users', 'kept']);
    assert.match(planned.card.what, /with your project's history sent to it/);
    await applyStep(stepFor(w), folder, planned.changes, { answers: planned.answers });
    const repo = `${USER}/shop`;
    assert.equal(await g(w.hostUrl({ repo }), 'rev-parse', 'refs/heads/trunk'), tip);
    assert.equal(readProject(slugFor(repo)).host, 'github');
    assert.equal(await g(folder, 'config', '--get', 'remote.origin.url'), w.hostUrl({ repo }));
    assert.equal(fs.existsSync(homeDir('shop')), false);
  });
});

test('the move\'s host steps make an empty private repository and give the record, keeping the folder where it is', async () => {
  await withHome(async () => {
    const w = standIn();
    const folder = productFolder('shop');
    const named = [];
    const got = await stepFor(w).forProject({ host: 'github', folder, made: (repo) => named.push(repo) });
    const repo = `${USER}/shop`;
    assert.deepEqual(named, [repo]);
    assert.equal(got.repo, repo);
    assert.equal(got.folder, folder);
    assert.equal(got.host, 'github');
    assert.equal(got.connection.mode, 'quick');
    assert.equal(got.remoteUrl, w.hostUrl({ repo }));
    const made = w.calls.find((c) => c.args[0] === 'repo' && c.args[1] === 'create').args;
    assert.ok(made.includes('--private') && !made.includes('--add-readme'), made.join(' '));
    assert.equal(readProject('shop'), null);
  });
});

test('the move\'s host steps refuse a repository of that name they didn\'t make, and carry on with one they did', async () => {
  await withHome(async () => {
    const w = standIn();
    const folder = productFolder('shop');
    const step = stepFor(w);
    await step.forProject({ host: 'github', folder });
    await assert.rejects(step.forProject({ host: 'github', folder }), /already exists/);
    const again = await step.forProject({ host: 'github', folder, ours: `${USER}/shop` });
    assert.equal(again.repo, `${USER}/shop`);
  });
});

test('a push that fails on the way to GitHub leaves the folder as it was, and a fresh Go ahead sends it', async () => {
  await withHome(async () => {
    const w = standIn();
    let failing = true;
    const run = async (file, args, options) => {
      if (failing && args.includes('push')) return { code: 1, stdout: '', stderr: 'refused' };
      return w.run(file, args, options);
    };
    const folder = productFolder('shop');
    await g(folder, 'init', '-q', '-b', 'main');
    await g(folder, 'add', 'notes.txt');
    await g(folder, 'commit', '-q', '-m', 'Begin');
    const pick = (id, card) => (id === 'kept' ? PUT_ON_GITHUB : choose()(id, card));
    const first = await answerAll(stepFor(w, { run }), ctxFor(folder), pick);
    await assert.rejects(applyStep(stepFor(w, { run }), folder, first.changes, { answers: first.answers }), /a fresh Go ahead tries again/);
    assert.deepEqual(remotesOf(folder), [], 'the folder has no address until its history is there');
    failing = false;
    const again = await answerAll(stepFor(w), ctxFor(folder), pick);
    assert.ok(again.changes.some((c) => c.action === 'repository'), 'the same step, again');
    await applyStep(stepFor(w), folder, again.changes, { answers: again.answers });
    const repo = `${USER}/shop`;
    assert.equal(await g(w.hostUrl({ repo }), 'rev-parse', 'refs/heads/main'), await g(folder, 'rev-parse', 'HEAD'));
    assert.equal(await g(folder, 'config', '--get', 'remote.origin.url'), w.hostUrl({ repo }));
  });
});

test('a company remote named in gitlabHosts, with its port, gives that address through setup\'s path', async () => {
  await withHome(async () => {
    const w = standIn({ signedIn: { github: true, gitlab: false } });
    const folder = productFolder('shop');
    fs.writeFileSync(path.join(folder, '.claude', 'wheelhouse.json'), JSON.stringify({ gitlabHosts: ['localhost:8929'] }));
    await withOrigin(folder, `https://localhost:8929/${USER}/shop.git`);
    const found = productOf(folder, { config: { gitlabHosts: ['localhost:8929'] } });
    assert.deepEqual(found, { isNew: false, host: 'gitlab', repo: `${USER}/shop`, name: 'shop', base: 'https://localhost:8929' });
    const planned = await answerAll(stepFor(w), ctxFor(folder), choose({ way: WAYS.quick }));
    const connection = planned.changes.find((c) => c.action === 'connection');
    assert.equal(connection.target, 'gitlab');
    assert.equal(connection.base, 'https://localhost:8929');
    // A company's GitLab with no OAuth application is signed in to with a typed token, not a sign-up page.
    assert.match(planned.card.what, /You sign in to your company's GitLab in your browser if your company has set that up, or else with a token you paste into a box on your screen, never the chat/);
    const glab = w.calls.filter((c) => c.tool === 'glab');
    assert.ok(glab.length > 0);
    for (const c of glab) assert.equal(c.env?.GITLAB_HOST, 'localhost:8929');
    assert.deepEqual(glab[0].args, ['auth', 'status', '--hostname', 'localhost:8929']);
  });
  // Without the setting, the same remote is not a GitLab address setup knows: the plan says what it found.
  await withHome(async () => {
    const w = standIn();
    const folder = productFolder('shop');
    await withOrigin(folder, `https://localhost:8929/${USER}/shop.git`);
    const kept = (await step3KeptAsk(stepFor(w), ctxFor(folder)));
    assert.match(kept.line, /localhost:8929, which Wheelhouse leaves as it is/);
  });
});

test('step 3\'s card for a company\'s GitLab behind its own authority, with the certificate and the typed token, composes', async () => {
  await withHome(async () => {
    const w = standIn({ signedIn: { github: true, gitlab: false } });
    const folder = productFolder('A product whose folder has a very long name indeed, Zoë');
    fs.writeFileSync(path.join(folder, '.claude', 'wheelhouse.json'), JSON.stringify({ gitlabHosts: ['git.example.org:8443'] }));
    await withOrigin(folder, `https://git.example.org:8443/${USER}/a-product-with-a-long-name.git`);
    const step = stepFor(w, { certificateProbe: async () => 'certificate' });
    const planned = await answerAll(step, ctxFor(folder), choose({ realUsers: REAL_USERS.yes, way: WAYS.narrow }));
    assert.ok(planned.changes.some((c) => c.action === 'certificate'));
    assert.equal(planned.changes.find((c) => c.action === 'sign-in').via, 'token');
    // The full wording fits the calm card's length, the shorter one only when the names are longer; both say the same things.
    assert.match(planned.card.what, /Your company's own certificate for https:\/\/git\.example\.org:8443, (?:copied from this computer's certificate store and given to Node\.js, glab and git )?for that address only\. Certificate checks stay on\./);
    assert.match(planned.card.what, /sign in (?:to GitLab )?with a token(?::| you paste)/);
    assert.match(planned.card.what, /into a box on your screen, never the chat/);
    assert.doesNotMatch(planned.card.what, /admin/);
    const { question } = composeCard({ ...planned.card, target: { step: 3, hash: planHash(planned.changes) } });
    assert.ok(question.question.length <= 1200, String(question.question.length));
  });
});

// Step 3's card for a company's GitLab behind its own authority, with the certificate, the typed token, the
// admin's part: it composes whatever the names'
// lengths, and always says the two safety things.
test('step 3\'s card on a company\'s GitLab composes for ordinary and for very long names, joining or not, with the two safety phrases', async () => {
  const lengths = [];
  // Each case with the wording its card is expected to come in: the full one, the tight one (shorter clauses) or the bare
  // one (the address and the names left out), so a fallback that stops being reached shows here.
  const MAC_NEW = process.platform === 'darwin' ? 'tight' : 'full';
  const cases = [
    ['gitlab.acme.com:8443', 'engineering/shop', 'sam', 'full'],
    // On a Mac the sign-in line's exception for an Apple app takes the new product's card over the limit, so it comes in the tight wording there.
    ['gitlab.example.com', 'platform/customer-portal', 'a-director', { joining: 'full', new: MAC_NEW, existing: 'full' }],
    ['git.example.org:8443', `${USER}/a-product-with-a-long-name-to-fill-the-card`, USER, { joining: 'full', new: MAC_NEW, existing: 'full' }],
    [`${'h'.repeat(190)}.example.com:8443`, `${'g'.repeat(100)}/${'p'.repeat(99)}`, 'u'.repeat(200), 'tight'],
    // A host name is at most 253 characters, so the bare wording takes an address with a long path after the host.
    [`${'h'.repeat(190)}.example.com:8443/${'s'.repeat(300)}`, `${'g'.repeat(100)}/${'p'.repeat(99)}`, 'u'.repeat(200), 'bare'],
    ['gitlab.internal.bigcompany.example.com:8443', `${'group-'.repeat(8)}/${'sub-'.repeat(22)}sub/shop`, 'a-well-known-user-with-a-long-name', { joining: 'tight', new: 'tight', existing: 'tight' }],
  ];
  const wording = (what) => (/copied from this computer's certificate store/.test(what) ? 'full' : /certificate for your GitLab's address/.test(what) ? 'bare' : 'tight');
  for (const [hostName, repo, user, expected] of cases) {
    const base = `https://${hostName}`;
    const owner = repo.split('/').slice(0, -1).join('/');
    const name = repo.split('/').at(-1);
    for (const kind of ['joining', 'new', 'existing']) {
      const product = kind === 'joining' ? { isNew: false, joining: true, host: null, repo, name }
        : kind === 'new' ? { isNew: true, host: 'gitlab', name, base } : { isNew: false, host: 'gitlab', repo, name, base };
      const changes = [
        { kind: 'host', target: 'gitlab', action: 'certificate', base },
        { kind: 'host', target: 'gitlab', action: 'sign-in', via: 'token' },
      ];
      const card = cardFor({ host: 'gitlab', changes, product, owner: kind === 'joining' ? null : owner, user, way: WAYS.narrow, app: null, signedIn: false, appKeys: null, base });
      const { question } = composeCard({ ...card, target: { step: 3, hash: planHash(changes) } });
      assert.ok(question.question.length <= 1200, `${kind} ${hostName}: ${question.question.length}`);
      lengths.push(`${kind} ${hostName.length}/${repo.length}/${user.length}: ${question.question.length}`);
      assert.equal(wording(card.what), typeof expected === 'string' ? expected : expected[kind], `${kind} ${hostName.length}: ${card.what}`);
      assert.match(card.what, /for that address only\. Certificate checks stay on\./, `${kind} ${hostName}`);
      assert.match(card.what, /paste (?:it )?into a box (?:that opens )?on your screen, never the chat/, `${kind} ${hostName}`);
      assert.doesNotMatch(card.what, /admin/, 'the card asks nothing of an admin');
      assert.deepEqual(termsIn(card.what.split('\n').filter((part) => /token|certificate/.test(part)).join('\n'), glossaryOf({})), []);
    }
  }
  // GitHub names too: a joining or first computer with very long account and app names still composes.
  for (const joiningNow of [true, false]) {
    const long = 'o'.repeat(200);
    const card = cardFor({
      host: 'github', changes: [{ kind: 'host', target: 'github', action: 'sign-in' }],
      product: joiningNow ? { isNew: false, joining: true, host: null, repo: `${long}/${long}`, name: long } : { isNew: false, host: 'github', repo: `${long}/${long}`, name: long },
      owner: long, user: `${long}-me`, way: WAYS.own, app: { own: true, account: long, name: long }, signedIn: false, appKeys: null, base: 'https://gitlab.com',
    });
    composeCard({ ...card, target: { step: 3, hash: '0'.repeat(64) } });
  }
  assert.ok(lengths.length > 0);
  // Only the length refusal sends the card to a shorter form; any other fault surfaces.
  assert.equal(isTooLong(new Error('A setup card text would pass 1200 characters (it is 1300)')), true);
  assert.equal(isTooLong(new Error('A setup card needs its why')), false);
  assert.throws(() => cardFor({ host: 'gitlab', changes: [], product: null }), TypeError);
});

test('on a company\'s GitLab the typed token is the way offered, and the card asks nothing of an admin', async () => {
  const TYPED = 'glpat-never-on-a-card-0001';
  await withHome(async () => {
    const w = standIn({ signedIn: { github: true, gitlab: false } });
    const folder = productFolder('shop');
    fs.writeFileSync(path.join(folder, '.claude', 'wheelhouse.json'), JSON.stringify({ gitlabHosts: ['localhost:8929'] }));
    await withOrigin(folder, `https://localhost:8929/${USER}/shop.git`);
    const step = stepFor(w, { certificateProbe: async () => 'ok' });
    const planned = await answerAll(step, ctxFor(folder), choose({ way: WAYS.narrow }));
    const signing = planned.changes.find((c) => c.action === 'sign-in');
    assert.equal(signing.via, 'token');
    assert.match(planned.card.what, /or else with a token you paste into a box on your screen, never the chat/);
    assert.match(planned.card.what, /never the chat/);
    // The card says only what the director does: nothing about an application an admin might register.
    assert.doesNotMatch(planned.card.what, /admin|read_user|client_id|openid|permissions/);
    // It composes as a card, and says nothing the glossary would have to put into plain words.
    const { question } = composeCard({ ...planned.card, target: { step: 3, hash: planHash(planned.changes) } });
    assert.ok(question.question.length > 0);
    assert.deepEqual(termsIn(planned.card.what.split('\n').filter((part) => /token/.test(part)).join('\n'), glossaryOf({})), []);
    assert.match(planned.director, /token/);
    assert.doesNotMatch(planned.card.what, new RegExp(TYPED));
    // Where the company has registered an application, the browser way stays.
    const registered = standIn({ signedIn: { github: true, gitlab: false } });
    const base = registered.run;
    registered.run = async (file, args = [], options = {}) => {
      if (path.basename(file) === 'glab' && args[0] === 'config' && args[1] === 'get') return { code: 0, stdout: 'an-application-id\n', stderr: '' };
      return base(file, args, options);
    };
    const browser = await answerAll(stepFor(registered, { certificateProbe: async () => 'ok' }), ctxFor(folder), choose({ way: WAYS.narrow }));
    assert.deepEqual(browser.changes.find((c) => c.action === 'sign-in'), { kind: 'host', target: 'gitlab', action: 'sign-in' });
    assert.match(browser.card.what, /in your browser/);
  });
});

// ---- The company's own certificate (check 71) ----

const COMPANY_ORIGIN = 'https://git.example.org:8443';
const authorityFixture = () => fs.readFileSync(new URL('../../fixtures/certs/ca-valid.pem', import.meta.url), 'utf8');

async function companyProduct() {
  const folder = productFolder('shop');
  fs.writeFileSync(path.join(folder, '.claude', 'wheelhouse.json'), JSON.stringify({ gitlabHosts: ['git.example.org:8443'] }));
  await withOrigin(folder, `${COMPANY_ORIGIN}/${USER}/shop.git`);
  return folder;
}

test('a company GitLab whose certificate is not trusted gets a certificate step first, recorded in the journal, and the step carries on in a fresh process', async () => {
  await withHome(async () => {
    const w = standIn({ signedIn: { github: true, gitlab: false } });
    const folder = await companyProduct();
    const probed = [];
    const calls = [];
    const certificateRun = async (file, args) => {
      calls.push([path.basename(file), ...args]);
      return file === 'security' ? { code: 0, stdout: authorityFixture(), stderr: '' } : { code: 0, stdout: '', stderr: '' };
    };
    const step = stepFor(w, {
      // A staged file (`file`) is tried against GitLab alone, and here it covers GitLab's certificate.
      certificateProbe: async (a) => { if (a.file !== undefined) return 'ok'; probed.push([a.base, a.home]); return answer; },
      trustCertificate: (a) => applyCompanyCa({ ...a, run: certificateRun }),
    });
    let answer = 'certificate';
    const planned = await answerAll(step, ctxFor(folder), choose({ way: WAYS.quick }));
    assert.deepEqual(probed, [[COMPANY_ORIGIN, wheelhouseHome()]]);
    assert.deepEqual(planned.changes[0], { kind: 'host', target: 'gitlab', action: 'certificate', base: COMPANY_ORIGIN });
    assert.match(planned.card.what, /Your company's own certificate for https:\/\/git\.example\.org:8443.*that address only\. Certificate checks stay on/);
    assert.ok(planned.changes.findIndex((c) => c.action === 'certificate') < planned.changes.findIndex((c) => c.action === 'sign-in'));
    assert.ok(!fs.existsSync(caFile(wheelhouseHome())), 'planning changes nothing');

    // Applied: the file, glab's setting for host:port, a journal entry holding the git setting for that
    // address; nothing is signed in, and nothing is pushed (git is not run).
    await assert.rejects(applyStep(step, folder, planned.changes, { answers: planned.answers }), (error) => {
      assert.equal(error.message, CERTIFICATE_GIVEN(COMPANY_ORIGIN));
      return true;
    });
    const file = caFile(wheelhouseHome());
    assert.equal(fs.readFileSync(file, 'utf8'), authorityFixture().replace(/^#.*\n/gm, ''));
    assert.deepEqual(calls.map((c) => c[0]), ['security', 'security', 'glab']);
    assert.deepEqual(calls.at(-1).slice(1), ['config', 'set', 'ca_cert', file, '--host', 'git.example.org:8443']);
    assert.ok(!w.calls.some((c) => c.tool === 'glab' && c.args[0] === 'auth' && c.args[1] === 'login'));
    const entry = findRun(folder).changes.find((c) => c.kind === 'answer' && c.after?.certificate);
    assert.deepEqual(entry.after.certificate, {
      base: COMPANY_ORIGIN, file, glabHost: 'git.example.org:8443', gitConfig: [{ key: `http.${COMPANY_ORIGIN}/.sslCAInfo`, value: file }],
    });

    // Planned again (the fresh process): GitLab is asked with the file, which covers it, so no certificate step.
    probed.length = 0;
    answer = 'ok';
    const again = await answerAll(step, ctxFor(folder), choose({ way: WAYS.quick }));
    assert.deepEqual(probed, [[COMPANY_ORIGIN, wheelhouseHome()]]);
    assert.ok(again.changes.every((c) => c.action !== 'certificate'));
  });
});

test('the certificate step is offered again whenever GitLab still does not trust, after a glab failure or with the file already there', async () => {
  await withHome(async () => {
    const w = standIn({ signedIn: { github: true, gitlab: false } });
    const folder = await companyProduct();
    const calls = [];
    let glabWorks = false;
    const certificateRun = async (file, args) => {
      calls.push([path.basename(file), ...args]);
      if (file === 'security') return { code: 0, stdout: authorityFixture(), stderr: '' };
      return glabWorks ? { code: 0, stdout: '', stderr: '' } : { code: 1, stdout: '', stderr: 'glab: cannot write its configuration' };
    };
    let answer = 'certificate';
    const step = stepFor(w, {
      certificateProbe: async (a) => (a.file !== undefined ? 'ok' : answer),
      trustCertificate: (a) => applyCompanyCa({ ...a, run: certificateRun }),
    });
    const first = await answerAll(step, ctxFor(folder), choose({ way: WAYS.quick }));
    assert.deepEqual(first.changes[0], { kind: 'host', target: 'gitlab', action: 'certificate', base: COMPANY_ORIGIN });

    // glab fails: the step says so, and leaves no file (so nothing says the work is done).
    await assert.rejects(applyStep(step, folder, first.changes, { answers: first.answers }), /glab could not be given the company's certificate for git\.example\.org:8443/);
    assert.ok(!fs.existsSync(caFile(wheelhouseHome())));
    assert.deepEqual(fs.readdirSync(path.dirname(caFile(wheelhouseHome()))), [], 'no staged file is left either');
    assert.equal(findRun(folder).changes.filter((c) => c.after?.certificate).length, 0, 'nothing is journaled as done');

    // The second plan offers the step again, and it now works.
    const second = await answerAll(step, ctxFor(folder), choose({ way: WAYS.quick }));
    assert.deepEqual(second.changes[0], { kind: 'host', target: 'gitlab', action: 'certificate', base: COMPANY_ORIGIN });
    glabWorks = true;
    await assert.rejects(applyStep(step, folder, second.changes, { answers: second.answers }), /Setup has given this computer your company's certificate/);
    assert.ok(fs.existsSync(caFile(wheelhouseHome())));

    // The file is there but GitLab is still not trusted (an authority IT installed since): offered again,
    // with the certificates read again from the store, and the file replaced.
    const old = fs.readFileSync(caFile(wheelhouseHome()), 'utf8');
    const securityBefore = calls.filter((c) => c[0] === 'security').length;
    const third = await answerAll(step, ctxFor(folder), choose({ way: WAYS.quick }));
    assert.deepEqual(third.changes[0], { kind: 'host', target: 'gitlab', action: 'certificate', base: COMPANY_ORIGIN, refresh: true });
    await assert.rejects(applyStep(step, folder, third.changes, { answers: third.answers }), /Setup has given this computer/);
    assert.equal(calls.filter((c) => c[0] === 'security').length, securityBefore + 2, 'the store was read again');
    assert.equal(fs.readFileSync(caFile(wheelhouseHome()), 'utf8'), old);

    // A refresh whose glab step fails leaves the file that was there.
    glabWorks = false;
    await assert.rejects(applyStep(step, folder, third.changes, { answers: third.answers }), /glab could not be given/);
    assert.equal(fs.readFileSync(caFile(wheelhouseHome()), 'utf8'), old);
    assert.deepEqual(fs.readdirSync(path.dirname(caFile(wheelhouseHome()))), ['company.pem']);
  });
});

test('a staged certificate file that GitLab still does not trust is thrown away with a plain line, glab is not run and nothing is journaled; one that passes is kept as before', async () => {
  await withHome(async () => {
    const w = standIn({ signedIn: { github: true, gitlab: false } });
    const folder = await companyProduct();
    const calls = [];
    const certificateRun = async (file, args) => {
      calls.push([path.basename(file), ...args]);
      return file === 'security' ? { code: 0, stdout: authorityFixture(), stderr: '' } : { code: 0, stdout: '', stderr: '' };
    };
    const tried = [];
    let staged = 'certificate';
    const step = stepFor(w, {
      certificateProbe: async (a) => {
        if (a.file === undefined) return 'certificate';
        tried.push(a.file);
        assert.ok(fs.existsSync(a.file), 'the staged file is there to be tried');
        assert.notEqual(a.file, caFile(wheelhouseHome()), 'it is tried before it is put in place');
        return staged;
      },
      trustCertificate: (a) => applyCompanyCa({ ...a, run: certificateRun }),
    });
    const planned = await answerAll(step, ctxFor(folder), choose({ way: WAYS.quick }));

    // The store does not hold the company's authority: a plain line, the staged file gone, no file,
    // glab not run, nothing journaled, and the same card offered again with the same honest result.
    for (let again = 0; again < 2; again += 1) {
      await assert.rejects(applyStep(step, folder, planned.changes, { answers: planned.answers }), (error) => {
        assert.equal(error.message, CERTIFICATE_NOT_IN_STORE);
        assert.match(error.message, /isn't in this computer's system store.*System keychain \(Mac\) or the Local Machine store \(Windows\).*ask for step 3's card again/);
        return true;
      });
    }
    assert.equal(tried.length, 2);
    assert.ok(!fs.existsSync(caFile(wheelhouseHome())));
    assert.deepEqual(fs.readdirSync(path.dirname(caFile(wheelhouseHome()))), [], 'no staged file is left');
    assert.ok(!calls.some((c) => c[0] === 'glab'), 'glab was not run');
    assert.equal(findRun(folder).changes.filter((c) => c.after?.certificate).length, 0, 'nothing is journaled');

    // One that passes: kept, glab told, journaled, as before.
    staged = 'ok';
    await assert.rejects(applyStep(step, folder, planned.changes, { answers: planned.answers }), (error) => {
      assert.equal(error.message, CERTIFICATE_GIVEN(COMPANY_ORIGIN));
      return true;
    });
    assert.ok(fs.existsSync(caFile(wheelhouseHome())));
    assert.ok(calls.some((c) => c[0] === 'glab'));
    assert.equal(findRun(folder).changes.filter((c) => c.after?.certificate).length, 1);
  });
});

test('the probe asks through curl, and gives the company\'s file only where it is there', async () => {
  await withHome(async () => {
    const home = wheelhouseHome();
    const via = (fake, more = {}) => ({ run: fake.run, curl: '/usr/bin/curl', proxy: null, platform: 'darwin', ...more });
    const plain = makeFakeCurl([{ status: 401 }]);
    assert.equal(await probeCertificate({ base: COMPANY_ORIGIN, home, ...via(plain) }), 'ok', 'whatever GitLab then answers');
    assert.equal(plain.calls[0].pairs.find(([k]) => k === 'url')[1], `${COMPANY_ORIGIN}/api/v4/version`);
    assert.equal(plain.calls[0].pairs.some(([k]) => k === 'cacert'), false);
    // The Mac's own store is tried first; the company's file is given once it does not cover the certificate.
    fs.mkdirSync(path.dirname(caFile(home)), { recursive: true });
    fs.writeFileSync(caFile(home), authorityFixture());
    const covered = makeFakeCurl([{ exit: 60 }, { status: 200 }]);
    assert.equal(await probeCertificate({ base: COMPANY_ORIGIN, home, ...via(covered) }), 'ok');
    assert.equal(covered.calls[1].pairs.find(([k]) => k === 'cacert')[1], caFile(home));
    const refused = makeFakeCurl([{ exit: 60 }, { exit: 60 }]);
    assert.equal(await probeCertificate({ base: COMPANY_ORIGIN, home, ...via(refused) }), 'certificate');
    // A named file is tried instead of the company's, whether or not the company's is in place.
    const only = path.join(home, 'staged.pem');
    fs.writeFileSync(only, 'STAGED');
    const named = makeFakeCurl([{ exit: 60 }, { status: 200 }]);
    assert.equal(await probeCertificate({ base: COMPANY_ORIGIN, home, file: only, ...via(named) }), 'ok');
    assert.equal(named.calls[1].pairs.find(([k]) => k === 'cacert')[1], only);
    assert.equal(await probeCertificate({ base: COMPANY_ORIGIN, file: only, ...via(makeFakeCurl([{ exit: 60 }, { exit: 60 }])) }), 'certificate');
  });
});

test('no certificate step is listed when GitLab\'s certificate is trusted, the address is the public service\'s, or the probe cannot tell', async () => {
  for (const [answer, origin, want] of [['ok', COMPANY_ORIGIN, 1], ['unreachable', COMPANY_ORIGIN, 1], ['other', COMPANY_ORIGIN, 1], ['certificate', 'https://gitlab.com', 0]]) {
    await withHome(async () => {
      const w = standIn({ signedIn: { github: true, gitlab: false } });
      const folder = productFolder('shop');
      fs.writeFileSync(path.join(folder, '.claude', 'wheelhouse.json'), JSON.stringify({ gitlabHosts: ['git.example.org:8443'] }));
      await withOrigin(folder, `${origin}/${USER}/shop.git`);
      let probes = 0;
      const step = stepFor(w, { certificateProbe: async () => { probes += 1; return answer; } });
      const planned = await answerAll(step, ctxFor(folder), choose({ way: WAYS.quick }));
      assert.equal(probes, want, `${answer} ${origin}`);
      assert.ok(planned.changes.every((c) => c.action !== 'certificate'), `${answer} ${origin}`);
    });
  }
  // The probe itself: a trusted certificate is 'ok' whatever GitLab then answers; curl's exit codes decide the rest.
  const asked = (answer) => probeCertificate({ base: COMPANY_ORIGIN, run: makeFakeCurl([answer]).run, curl: '/usr/bin/curl', proxy: null, platform: 'linux' });
  assert.equal(await asked({ status: 401 }), 'ok');
  assert.equal(await asked({ exit: 60 }), 'certificate');
  assert.equal(await asked({ exit: 7 }), 'unreachable');
  assert.equal(await asked({ exit: 56, connect: 407 }), 'proxy', 'a proxy that refuses the computer\'s sign-in is not a certificate');
  assert.equal(await asked({ exit: 2 }), 'other');
  assert.equal(await probeCertificate({ base: COMPANY_ORIGIN, run: async () => assert.fail('no curl, nothing run'), curl: null, proxy: null }), 'other');
});

test('setup\'s git carries the company\'s certificate for that address once the file is made, and only then', async () => {
  await withHome(async () => {
    const certificateKey = `http.${COMPANY_ORIGIN}/.sslCAInfo`;
    const pairs = (env) => Object.keys(env).filter((k) => /^GIT_CONFIG_KEY_\d+$/.test(k)).map((k) => [env[k], env[k.replace('KEY', 'VALUE')]]);
    const before = directorGitEnv({ host: 'gitlab', platform: 'darwin', base: COMPANY_ORIGIN });
    assert.ok(!pairs(before).some(([k]) => k === certificateKey));
    fs.mkdirSync(path.dirname(caFile(wheelhouseHome())), { recursive: true });
    fs.writeFileSync(caFile(wheelhouseHome()), authorityFixture());
    const after = directorGitEnv({ host: 'gitlab', platform: 'darwin', base: COMPANY_ORIGIN });
    assert.deepEqual(pairs(after).filter(([k]) => /ssl/i.test(k) && k.startsWith('http.') && !k.startsWith('http.sslVerify')), [[certificateKey, caFile(wheelhouseHome())]]);
    assert.equal(after.GIT_CONFIG_COUNT, String(pairs(after).length));
    assert.equal(after.GIT_CONFIG_GLOBAL, '/dev/null');
    assert.equal(after.GIT_CONFIG_NOSYSTEM, '1');
    // The sign-in helper and the fence are still there, ahead of it.
    assert.ok(pairs(after).some(([k, v]) => k === 'credential.helper' && /auth git-credential/.test(v)));
    assert.deepEqual(pairs(after).find(([k]) => k === 'http.sslVerify'), ['http.sslVerify', 'true']);
    // Not for the public service, GitHub, or a call that names no address.
    for (const given of [{ host: 'gitlab', base: 'https://gitlab.com' }, { host: 'github', base: COMPANY_ORIGIN }, { host: 'gitlab' }]) {
      assert.ok(!pairs(directorGitEnv({ ...given, platform: 'darwin' })).some(([k]) => /sslcainfo|sslbackend/i.test(k)), JSON.stringify(given));
    }
    // On Windows it is the system store.
    const win = directorGitEnv({ host: 'gitlab', platform: 'win32', base: COMPANY_ORIGIN });
    assert.ok(pairs(win).some(([k, v]) => k === `http.${COMPANY_ORIGIN}/.sslBackend` && v === 'schannel'));
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
const MANIFEST_PERMISSIONS = { contents: 'write', pull_requests: 'write', issues: 'write', statuses: 'write', metadata: 'read' };

// The director's settings as the helper's routes give them, in memory.
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
    // On the Mac, Make it stricter leads straight to their own app while Wheelhouse's isn't registered.
    assert.deepEqual(planned.asked.at(-1).card.options.map((o) => o.label), [STRICTER, WAYS.quick], 'the recommended option comes first');
    assert.equal(planned.asked.at(-1).card.recommend, STRICTER, 'stricter is recommended for a product with real users');
    // A Go ahead, not a wait: their own app is made on the director's account at apply.
    assert.equal(planned.wait, undefined);
    assert.deepEqual(planned.changes.find((c) => c.action === 'own-app'), { kind: 'host', target: 'github', action: 'own-app', account: USER, name: `Wheelhouse ${USER}` });
    assert.deepEqual(planned.changes.find((c) => c.action === 'connection').app, { own: true, account: USER, name: `Wheelhouse ${USER}` });
    assert.match(planned.card.what, /Your own GitHub App Wheelhouse a-director on a-director, filled in from Wheelhouse's and kept in your settings on this computer: tick Enable Device Flow and click Create/);
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

test('their own app is made from the filled-in page, its device flow ticked, signed in, installed and recorded in the settings on this computer', async () => {
  await withHome(async () => {
    const w = standIn({ apps: {} });
    await w.add(`${USER}/shop`);
    const folder = productFolder('shop');
    await withOrigin(folder, `https://github.com/${USER}/shop.git`);
    const gh = github({ app: OWN, flowOff: 1, reach: [`${USER}/shop`] });
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
    assert.match(lines[3], /tick a-director\/shop on GitHub \(not All repositories\)/);
    assert.match(new URL(opened[0]).searchParams.get('public'), /^false$/);
    assert.deepEqual(opened.slice(1), [
      'https://github.com/settings/apps/wheelhouse-a-director', 'https://github.com/login/device', 'https://github.com/apps/wheelhouse-a-director/installations/new',
    ]);
    assert.equal(readKey('github-app').clientId, OWN.clientId, 'the sign-in\'s keys are for their app');
    assert.equal(readKey('github-app').installationId, 77);
    // Recorded in the settings once connected, with its value before, for uninstall.
    assert.deepEqual(profile.writes.map((x) => x.data.value), [OWN]);
    const kept = run.changes.find((c) => c.target === 'profile own-github-app');
    assert.deepEqual([kept.kind, kept.before, kept.after], ['host', null, OWN]);
    assert.ok(run.changes.findIndex((c) => c.target === 'key github-app') < run.changes.indexOf(kept));
    // Read back when it was found, and again before its code sign-in.
    assert.ok(w.calls.filter((c) => c.args?.[1] === `apps/${OWN.slug}`).length >= 2);
  });
});

test('a second computer uses the app its settings record, and refuses its code sign-in once its permissions grew', async () => {
  await withHome(async () => {
    const w = standIn({ apps: { [OWN.slug]: { ...OWN, permissions: MANIFEST_PERMISSIONS } } });
    await w.add(`${USER}/shop`);
    const folder = productFolder('shop');
    await withOrigin(folder, `https://github.com/${USER}/shop.git`);
    const confirmed = { settings: { 'own-github-app': { key: 'own-github-app', value: OWN } }, unconfirmed: [] };
    const gh = github({ app: OWN, reach: [`${USER}/shop`] });
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

test('their accepted app hidden by a stray change is proposed again on a card of its own, and once confirmed step 3 goes on with it; a writer never replaces it (ruling R115)', async () => {
  await withHome(async () => {
    const w = standIn({ apps: { [OWN.slug]: { ...OWN, permissions: MANIFEST_PERMISSIONS } } });
    await w.add(`${USER}/shop`);
    const folder = productFolder('shop');
    await withOrigin(folder, `https://github.com/${USER}/shop.git`);
    // The settings as the helper's routes and this computer's views give them: their app confirmed,
    // then a writer's proposal of its own app waiting.
    const KEY = 'own-github-app';
    const stray = { clientId: 'Iv23li.stray0001', slug: 'helpful-app', owner: 'mallory' };
    const state = { settings: { [KEY]: { key: KEY, id: 'ev-0', value: OWN } }, unconfirmed: [] };
    let n = 0;
    const propose = (value) => { n += 1; state.unconfirmed.push({ kind: 'setting', id: `ev-${n}`, key: KEY, data: { key: KEY, value } }); return `ev-${n}`; };
    const writes = [];
    const profile = { write: async ({ kind, data }) => { writes.push(data.value); return { ok: true, id: propose(data.value), pushed: true }; }, views: async () => structuredClone(state) };
    // The director's Confirm of a proposal: it is accepted, and the views list nothing older as waiting.
    const confirm = (id) => {
      const at = state.unconfirmed.findIndex((u) => u.id === id);
      state.settings[KEY] = { key: KEY, id, value: state.unconfirmed[at].data.value };
      state.unconfirmed = state.unconfirmed.slice(at + 1);
    };
    propose(stray);
    const gh = github({ app: OWN, reach: [`${USER}/shop`] });
    const step = stepFor(w, { fetch: gh.fetch, profileRoutes: profile, views: () => structuredClone(state) });
    const pick = choose({ realUsers: REAL_USERS.yes, locked: LEVELS.standard, way: WAYS.own });

    // A card whose one change proposes their accepted app again: no app made, no sign-in.
    const planned = await answerAll(step, ctxFor(folder), pick);
    assert.deepEqual(planned.changes, [{ kind: 'host', target: 'profile own-github-app', action: 'own-app-again', app: OWN, waiting: stray }]);
    assert.match(planned.card.what, /your own GitHub App wheelhouse-a-director on a-director proposed again in your settings on this computer, since a newer change to it waits for your Confirm \(helpful-app on mallory\)/);
    assert.match(planned.card.why, /Confirm that other change only if you made it/);
    assert.equal(planned.director, 'One click, then Confirm on your app\'s card');
    composeCard({ ...planned.card, target: { step: 3, hash: planHash(planned.changes) } });
    // Its apply proposes their app again, recorded first, and stops saying to confirm it, so step 3 is asked again.
    const run = startRun({ folder, now: () => NOW });
    await assert.rejects(applyIn(step, folder, run.id, planned.changes), /Your own GitHub App, wheelhouse-a-director on a-director, is proposed again in your settings on this computer: click Confirm on its card/);
    assert.deepEqual(writes, [OWN]);
    const kept = findRun(folder).changes.filter((c) => c.target === 'profile own-github-app');
    assert.deepEqual(kept.map((c) => [c.before, c.after]), [[OWN, OWN]]);
    assert.equal(gh.calls.length, 0, 'nothing asked of GitHub: no code, no installation');
    assert.equal(readKey('github-app'), null);
    assert.deepEqual(w.calls.filter((c) => c.args?.[0] === 'auth' && c.args[1] === 'login'), [], 'no sign-in');

    // Before the Confirm, step 3 waits on it.
    const waiting = await answerAll(step, ctxFor(folder), pick);
    assert.equal(waiting.changes, undefined);
    assert.match(waiting.why, /waits for your Confirm again in your settings on this computer/);
    // A writer proposes its own app again: the card still proposes only their accepted app.
    propose(stray);
    const twice = await answerAll(step, ctxFor(folder), pick);
    assert.deepEqual(twice.changes.map((c) => c.app), [OWN]);
    // The list as planned, applied after the settings changed (their app no longer accepted): refused, nothing written.
    const saved = state.settings[KEY];
    state.settings[KEY] = { key: KEY, id: 'ev-x', value: stray };
    await assert.rejects(applyIn(step, folder, run.id, twice.changes), /Your settings on this computer have changed since the card/);
    assert.deepEqual(writes, [OWN]);
    state.settings[KEY] = saved;
    await assert.rejects(applyIn(step, folder, run.id, twice.changes), /is proposed again/);
    assert.deepEqual(writes, [OWN, OWN]);
    assert.ok(state.settings[KEY].value === OWN, 'the writer\'s app is never accepted by setup');

    // The director confirms the newest proposal, setup's: step 3 goes on with their original app.
    confirm(state.unconfirmed.at(-1).id);
    const going = await answerAll(step, ctxFor(folder), pick);
    assert.deepEqual(going.changes.find((c) => c.action === 'connection').app, { ...OWN, own: true });
    assert.ok(!going.changes.some((c) => c.action === 'own-app' || c.action === 'own-app-again'), 'no app made');
    await applyIn(step, folder, run.id, going.changes, { answers: going.answers });
    assert.equal(readKey('github-app').clientId, OWN.clientId);
    assert.deepEqual(writes, [OWN, OWN], 'nothing more written to the settings');
  });
  // With nothing accepted, a change waiting is a first record not confirmed yet: made or found by its name, as before.
  await withHome(async () => {
    const w = standIn();
    const folder = productFolder('shop');
    await withOrigin(folder, `https://github.com/${USER}/shop.git`);
    await w.add(`${USER}/shop`);
    const first = { settings: {}, unconfirmed: [{ kind: 'setting', id: 'ev-1', key: 'own-github-app', data: { key: 'own-github-app', value: OWN } }] };
    const planned = await answerAll(stepFor(w, { profileRoutes: memoryProfile(), views: () => first }), ctxFor(folder), choose({ realUsers: REAL_USERS.yes, locked: LEVELS.standard, way: WAYS.own }));
    assert.ok(planned.changes.some((c) => c.action === 'own-app'));
  });
});

test('their own app on an organisation is made there only by an owner, and reaches the project', async () => {
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
    // An owner: the organisation's page.
    w.memberships = [{ role: 'admin', state: 'active', organization: { login: 'acme' } }];
    const { lines } = await applyStep(step, folder, planned.changes, { answers: planned.answers });
    assert.ok(opened.some((u) => u.startsWith('https://github.com/organizations/acme/settings/apps/new?')));
    assert.match(lines.find((l) => l.includes('Install page')), /tick acme\/app on GitHub \(not All repositories\)/);
    assert.deepEqual(readProject(slugFor('acme/app')).connection, { host: 'github', mode: 'narrow', project: 'acme/app', backend: 'cli', installationId: 77 });
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
    const gh = github({ app: theirs, reach: [`${USER}/shop`] });
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
  const gh = github({ reach: [`${USER}/shop`], others });
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
    assert.match(planned.card.what, /The Wheelhouse app, as signed in already: tick this project on its settings page if it is not ticked/);
    assert.match(planned.director, /a tick on the app's settings page/);
    // Said so it is true either way: a legacy or gone installation sends apply to the Install page.
    assert.match(planned.card.what, /or on its Install page if the app is not on a-director yet/);
    composeCard({ ...planned.card, target: { step: 3, hash: planHash(planned.changes) } });
    const { lines } = await applyStep(first.step, next, planned.changes, { answers: planned.answers });
    assert.equal(first.codes(), codes, 'no new code sign-in');
    assert.deepEqual(opened, ['https://github.com/settings/installations/77'], 'the installation\'s settings page, never the Install page');
    assert.match(lines[0], /^The app can't reach a-director\/next on GitHub yet: tick it on the page that opens, then click Save$/);
    assert.match(lines.at(-2), /^The app can reach a-director\/next on GitHub, and nothing else/);
    assert.deepEqual(readProject(slugFor(`${USER}/next`)).connection, { host: 'github', mode: 'narrow', project: `${USER}/next`, backend: 'cli', installationId: 77 });
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
    assert.match(lines.at(-2), /The app can reach acme\/app on GitHub, and nothing else/);
    // acme/app was read against 88, its own account's installation.
    assert.ok(first.asked().includes(88));
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
    assert.match(planned.card.what, /The Wheelhouse app, as signed in already: install it on acme and tick this project on its Install page, not All repositories, or on its settings page if it is there already/);
    assert.match(planned.director, /a tick on the app's Install page for the project's account/);
    composeCard({ ...planned.card, target: { step: 3, hash: planHash(planned.changes) } });
    const { lines } = await applyStep(first.step, next, planned.changes, { answers: planned.answers });
    assert.equal(first.codes(), codes, 'no new code sign-in: the access key works across the app\'s installations');
    assert.deepEqual(opened, ['https://github.com/apps/wheelhouse-test/installations/new', 'https://github.com/settings/installations/88']);
    assert.match(lines[0], /^On the app's Install page, install it on acme: choose Only select repositories, tick acme\/app on GitHub \(not All repositories\), then click Install$/);
    assert.match(lines[1], /can't reach acme\/app on GitHub yet/);
    assert.match(lines.at(-2), /The app can reach acme\/app on GitHub, and nothing else/);
    assert.equal(readProject(slugFor('acme/app')).connection.installationId, 88);
    assert.deepEqual(readKey('github-app').installations, { [USER]: 77, acme: 88 });
    assert.equal(readProject(slugFor(`${USER}/shop`)).connection.installationId, 77);
  });
});

test('a first project on an organisation names the Install page for the organisation alone, and opens it once', async () => {
  await withHome(async () => {
    const w = standIn();
    await w.add('acme/app');
    const folder = productFolder('A product whose folder has a very long name indeed, Zoë');
    await withOrigin(folder, 'https://github.com/acme/app.git');
    const others = [];
    // The app's installation on this fake's own account never comes: each account's is added as the director installs it.
    const gh = github({ installedAfter: Infinity, account: 'nobody', others });
    const opened = [];
    const open = async (url) => {
      opened.push(url);
      if (url === installUrlFor && others.length === 0) others.push({ id: 88, account: 'acme', reach: ['acme/app'] });
    };
    const installUrlFor = 'https://github.com/apps/wheelhouse-test/installations/new';
    const step = stepFor(w, { appFile: appFile(tempFolder('wh-app-')), fetch: gh.fetch, open });
    const planned = await answerAll(step, ctxFor(folder), choose({ realUsers: REAL_USERS.yes, locked: LEVELS.standard, way: WAYS.wheelhouse }));
    assert.match(planned.card.what, /a code on GitHub, then tick the project on its Install page, not All repositories/);
    assert.match(planned.director, /a code typed on GitHub, Authorise, and a tick on the Install page$/);
    composeCard({ ...planned.card, target: { step: 3, hash: planHash(planned.changes) } });
    const { lines } = await applyStep(step, folder, planned.changes, { answers: planned.answers });
    assert.deepEqual(opened.filter((u) => u === installUrlFor).length, 1);
    assert.ok(lines.some((l) => /install it on acme: .*tick acme\/app on GitHub/.test(l)));
    assert.ok(!lines.some((l) => /install it on a-director/.test(l)), 'nothing on the director\'s own account');
    assert.equal(readProject(slugFor('acme/app')).connection.installationId, 88);
    assert.deepEqual(readKey('github-app').installations, { acme: 88 });
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
// files, its .claude/wheelhouse.json (unless `config` is false) saying `launched` when it is given; and, as v0.1.x made one
// (`stateBranch`), its state branch, holding a `phase` setting when one is given.
async function seedProject(w, repo, { phase = null, stateBranch = true, launched = false, config = true } = {}) {
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
    if (config) fs.writeFileSync(path.join(work, '.claude', 'wheelhouse.json'), `${JSON.stringify({ v: 1, ...(launched ? { launched: true } : {}) })}\n`);
    await g(work, 'add', '-A');
    await g(work, 'commit', '-q', '-m', 'Set up Wheelhouse');
    await g(work, 'push', '-q', dir, 'main');
    if (!stateBranch) return;
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

const joining = ({ join = fromOtherComputer('Cafe-Menu'), typed = null, way = WAYS.quick, host = HOST_LABELS.github } = {}) => (id, card) => {
  if (id === 'join' || id.startsWith('join-')) return typed ?? join;
  if (id === 'host') return host;
  if (id === 'gitlab-where') return GITLAB_COM;
  if (id.startsWith('connection-')) return card?.options && !card.options.some((o) => o.label === way) && card.options.some((o) => o.label === STRICTER) ? STRICTER : way;
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

const joinedOf = (folder) => findRun(folder).changes.filter((c) => c.kind === 'answer' && c.after && Object.hasOwn(c.after, 'joined')).map((c) => c.after);

test('step 3 asks whether this computer is joining only in a folder holding nothing but step 1\'s install, recommending keeping it here', async () => {
  await withHome(async () => {
    const w = standIn();
    const step = stepFor(w);
    const folder = emptyFolder();
    const first = (await step.plan(ctxFor(folder))).ask;
    assert.equal(first.id, 'join');
    assert.equal(first.typed, true, 'an owner/name may be typed');
    assert.deepEqual(first.card.options.map((o) => o.label), [KEEP_HERE, HOST_LABELS.github, HOST_LABELS.gitlab, 'Cafe-Menu, already set up on another computer']);
    assert.equal(first.card.recommend, KEEP_HERE, 'an empty folder is most often a new product, and one kept here needs no account');
    assert.match(`${first.card.what} ${first.card.why}`, /owner\/name, like ann\/cafe-menu/);
    composeCard({ ...first.card, kind: 'question' });
    // With profile.json on this computer, it is still asked, with the same recommendation.
    const profileJson = path.join(wheelhouseHome(), 'profile.json');
    fs.mkdirSync(wheelhouseHome(), { recursive: true });
    fs.writeFileSync(profileJson, '{}\n');
    assert.equal((await step.plan(ctxFor(folder))).ask.card.recommend, KEEP_HERE);
    fs.rmSync(profileJson);
    // A new product on GitHub: the usual questions follow, and a repository is made.
    const fresh = await answerJoin(step, ctxFor(folder), (id) => (id === 'join' ? HOST_LABELS.github : choose()(id)));
    assert.deepEqual(fresh.asked.map((a) => a.id.replace(/-[0-9a-f]{10,}$/, '')), ['join', 'real-users', 'connection']);
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
    for (const bad of ['', 'a b', '../x', 'o/..', 'https://gitlab.example.org', 'https://gitlab.example.org/', 'git@gitlab.example.org:', 'https://h/../x']) assert.equal(repoNamed(bad), null, bad);
    // A pasted project address reads as its owner/name, groups too.
    for (const [pasted, named] of [
      ['github.com/ann/cafe-menu', 'ann/cafe-menu'],
      ['www.gitlab.com/team/app', 'team/app'],
      ['https://gitlab.example.org/ann/cafe-menu', 'ann/cafe-menu'],
      ['https://github.com/ann/cafe-menu.git', 'ann/cafe-menu'],
      ['git@gitlab.example.org:ann/cafe-menu.git', 'ann/cafe-menu'],
      ['ssh://git@gitlab.example.org:2222/grp/sub/name.git', 'grp/sub/name'],
      ['https://gitlab.example.org/grp/sub/name/', 'grp/sub/name'],
      // A page of the project in a browser: GitLab's goes on after '/-/', GitHub's after the second part.
      ['https://gitlab.example.com/ann/cafe-menu/-/tree/main', 'ann/cafe-menu'],
      ['https://gitlab.example.com/grp/sub/name/-/merge_requests', 'grp/sub/name'],
      ['https://github.com/ann/cafe-menu/tree/main', 'ann/cafe-menu'],
      ['https://github.com/ann/cafe-menu/pulls', 'ann/cafe-menu'],
      ['https://github.com/ann/cafe-menu.git', 'ann/cafe-menu'],
    ]) assert.equal(repoNamed(pasted), named, pasted);
  });
});

test('a pasted address decides the host and its GitLab: no host card and no which-GitLab card is asked', async () => {
  await withHome(async () => {
    const w = standIn();
    await seedProject(w, `${USER}/Cafe-Menu`);
    const step = stepFor(w);
    const folder = emptyFolder();
    const run = startRun({ folder, now: () => NOW });
    const ctx = ctxFor(folder, { runId: run.id });
    const joinedOn = async (typed) => {
      const got = await answerJoin(step, ctx, (id, card) => {
        if (id === 'host' || id.startsWith('gitlab-')) throw new Error(`asked ${id}`);
        return id === 'join' ? typed : choose()(id, card);
      });
      return { connection: got.changes.find((c) => c.action === 'connection'), join: got.changes.find((c) => c.action === 'join'), card: got.card };
    };
    // GitHub: github.com, with or without https://, and a page of the project, join on GitHub though the run's own answers say GitLab.
    for (const typed of [`https://github.com/${USER}/Cafe-Menu/pulls`, `github.com/${USER}/Cafe-Menu`, `www.github.com/${USER}/Cafe-Menu/tree/main`]) {
      const got = await joinedOn(typed);
      assert.equal(got.connection.target, 'github', typed);
      assert.equal(got.join.name, `${USER}/Cafe-Menu`, typed);
    }
    // The public GitLab.
    const pub = await joinedOn(`https://gitlab.com/${USER}/Cafe-Menu/-/tree/main`);
    assert.equal(pub.connection.target, 'gitlab');
    assert.equal(pub.connection.base ?? 'https://gitlab.com', 'https://gitlab.com');
    assert.equal(pub.join.name, `${USER}/Cafe-Menu`);
    // A company's GitLab: its address is the base.
    const company = await joinedOn(`git@gitlab.company.example:${USER}/Cafe-Menu.git`);
    assert.equal(company.connection.target, 'gitlab');
    assert.equal(company.connection.base, 'https://gitlab.company.example');
    assert.equal(company.join.name, `${USER}/Cafe-Menu`);
    assert.match(company.card.what ?? JSON.stringify(company.card), /company/i);
    assert.equal(chosenHost({ '3.join': { label: null, text: 'github.com/ann/x', at: NOW.toISOString() } }), 'github');
    assert.equal(chosenHost({ '3.join': { label: null, text: 'https://gitlab.company.example/ann/x', at: NOW.toISOString() } }), 'gitlab');
  });
});

test('an address setup cannot read is refused as such, never looked up on the run\'s host', async () => {
  await withHome(async () => {
    const step = stepFor(standIn());
    const folder = emptyFolder();
    const run = startRun({ folder, now: () => NOW });
    const ctx = ctxFor(folder, { runId: run.id });
    for (const bad of ['https://gitlab.example.org:99999/ann/cafe-menu', 'https://git lab.example.org/ann/cafe-menu', 'https://[::1/ann/cafe-menu', 'https://git^lab.example.org/ann/cafe-menu']) {
      const ask = (await step.plan({ ...ctx, answers: { '3.join': { label: null, text: bad, at: NOW.toISOString() } } })).ask;
      assert.notEqual(ask.id, 'join', bad);
      assert.equal(ask.card.what.startsWith(`"${bad.replace('deploy@', '')}" can't be read as an address. Paste the address of the project's page as your browser shows it, such as https://gitlab.example.org/team/cafe-menu. A company GitLab's address can be typed on the company GitLab button's address question instead. Or type owner/name, like ann/cafe-menu, or click a button. `), true, ask.card.what);
    }
  });
});

test('schemeless text is an address only for github.com and gitlab.com; any other dotted first part stays owner/name', async () => {
  // Item 1: GitLab user and group names with dots are common, and are never read as a host to contact.
  for (const name of ['john.smith/cafe-menu', 'my.app/notes', 'first.last/x', 'acme.corp/team/app']) assert.equal(repoNamed(name), name, name);
  assert.equal(repoNamed('www.gitlab.com/ann/cafe-menu'), 'ann/cafe-menu');
  await withHome(async () => {
    const w = standIn();
    const step = stepFor(w);
    const folder = emptyFolder();
    const run = startRun({ folder, now: () => NOW });
    const ctx = ctxFor(folder, { runId: run.id });
    // Typed as a name, it asks the host card as a bare owner/name does, and nothing is contacted for the dotted part.
    const got = await answerJoin(step, ctx, (id, card) => (id === 'join' ? 'john.smith/cafe-menu' : choose()(id, card)));
    assert.equal(got.asked.some((a) => a.id === 'host'), true);
    assert.equal(got.changes.find((c) => c.action === 'join').name, 'john.smith/cafe-menu');
    // And www.gitlab.com is the public GitLab.
    const pub = await answerJoin(step, ctx, (id, card) => {
      if (id === 'host' || id.startsWith('gitlab-')) throw new Error(`asked ${id}`);
      return id === 'join' ? 'www.gitlab.com/ann/cafe-menu' : choose()(id, card);
    });
    assert.equal(pub.changes.find((c) => c.action === 'connection').target, 'gitlab');
    assert.equal(pub.changes.find((c) => c.action === 'connection').base ?? 'https://gitlab.com', 'https://gitlab.com');
  });
});

test('other places to keep code are refused, and only https, ssh and git@ addresses on a real host are read', async () => {
  await withHome(async () => {
    const step = stepFor(standIn());
    const folder = emptyFolder();
    const run = startRun({ folder, now: () => NOW });
    const ctx = ctxFor(folder, { runId: run.id });
    const whatFor = async (text) => (await step.plan({ ...ctx, answers: { '3.join': { label: null, text, at: NOW.toISOString() } } })).ask;
    // Item 2: github.* that is not github.com, and Bitbucket, Azure DevOps and Codeberg.
    for (const other of ['https://github.example.com/ann/x', 'https://bitbucket.org/ann/x', 'https://www.bitbucket.org/ann/x', 'https://dev.azure.com/o/p', 'git@codeberg.org:ann/x.git']) {
      const ask = await whatFor(other);
      assert.notEqual(ask.id, 'join', other);
      assert.equal(ask.card.what.startsWith(`"${other}" is not on github.com or GitLab, the places Wheelhouse works with. Type owner/name, like ann/cafe-menu, or click a button. `), true, ask.card.what);
    }
    // Item 5: http, other schemes, other ssh users, loopback, link-local and bare-IP hosts are unreadable.
    for (const bad of ['http://gitlab.example.org/ann/x', 'ftp://gitlab.example.org/ann/x', 'deploy@gitlab.example.org:ann/x', 'https://localhost/ann/x',
      'https://127.0.0.1/ann/x', 'https://0x7f.1/ann/x', 'https://169.254.169.254/ann/x', 'git@localhost:ann/x', 'https://[::1]/ann/x', 'https://2130706433/ann/x']) {
      const ask = await whatFor(bad);
      assert.notEqual(ask.id, 'join', bad);
      assert.equal(ask.card.what.startsWith(`"${bad.replace('deploy@', '')}" can't be read as an address. Paste the address of the project's page as your browser shows it, such as https://gitlab.example.org/team/cafe-menu. A company GitLab's address can be typed on the company GitLab button's address question instead. Or type owner/name, like ann/cafe-menu, or click a button. `), true, ask.card.what);
      // Item 6: what step 3 refuses is no host for the tools or the plan either.
      assert.equal(chosenHost({ '3.join': { label: null, text: bad, at: NOW.toISOString() } }), null, bad);
    }
    // A host written with hex octets is the loopback or link-local address a URL reader makes of it, and is refused as one.
    for (const hex of ['git@127.0.0.0x1:g/p', 'ssh://git@127.0.0.0x1/g/p', 'git@169.254.169.0xfe:g/p']) {
      const ask = await whatFor(hex);
      assert.notEqual(ask.id, 'join', hex);
      assert.match(ask.card.what, /can't be read as an address/, hex);
      assert.equal(chosenHost({ '3.join': { label: null, text: hex, at: NOW.toISOString() } }), null, hex);
    }
    for (const other of ['https://bitbucket.org/ann/x', 'https://github.example.com/ann/x']) assert.equal(chosenHost({ '3.join': { label: null, text: other, at: NOW.toISOString() } }), null, other);
    assert.equal(chosenHost({ '3.join': { label: null, text: 'ssh://git@gitlab.example.org/ann/x', at: NOW.toISOString() } }), 'gitlab');
    // An address step 3 refuses (a host with no project, or a company host with a root dot) names no host; the newest join answer counts.
    for (const refused of ['https://gitlab.com/', 'https://gitlab.example.org/']) {
      assert.equal(chosenHost({ '3.join': { label: null, text: refused, at: NOW.toISOString() } }), null, refused);
    }
    assert.equal(chosenHost({ '3.join': { label: null, text: 'https://gitlab.com/', at: NOW.toISOString() }, '3.join-abc': { label: null, text: 'github.com/ann/x', at: NOW.toISOString() } }), 'github');
  });
});

test('the join card ends its why line with the address, and says groups after a miss on GitLab', async () => {
  await withHome(async () => {
    const step = stepFor(standIn());
    const folder = emptyFolder();
    const run = startRun({ folder, now: () => NOW });
    const ctx = ctxFor(folder, { runId: run.id });
    // Item 9.
    const first = (await step.plan(ctx)).ask;
    assert.equal(first.card.why.endsWith('Type its owner/name, like ann/cafe-menu, or paste its address.'), true, first.card.why);
    // Item 11: the miss is recorded with its host.
    for (const [host, words] of [['gitlab', 'groups'], ['github', 'organisations']]) {
      const other = startRun({ folder: emptyFolder(), now: () => NOW });
      addChanges(other.id, [{ id: 'chg-1', kind: 'answer', target: 'step 3', before: null, after: { joined: 'Cafe-Menu', missed: 'none', host }, step: 3 }]);
      const next = (await step.plan(ctxFor(other.folder ?? folder, { runId: other.id }))).ask;
      assert.match(next.card.what, new RegExp(`^Setup found no Cafe-Menu set up with Wheelhouse on your account or ${words}\\. `));
    }
    // The hint to paste with https:// is for a bare name that looks like a host, never for text that was already an address.
    for (const [address, hint] of [[false, true], [true, false]]) {
      const other = startRun({ folder: emptyFolder(), now: () => NOW });
      addChanges(other.id, [{ id: 'chg-1', kind: 'answer', target: 'step 3', before: null, after: { joined: 'team.alpha', missed: 'none', host: 'gitlab', ...(address ? { address: true } : {}) }, step: 3 }]);
      const next = (await step.plan(ctxFor(other.folder ?? folder, { runId: other.id }))).ask;
      assert.equal(/paste it with https:\/\/ at the front/.test(next.card.what), hint, next.card.what);
    }
  });
});

test('no token is shown back in any form it is pasted', async () => {
  await withHome(async () => {
    const step = stepFor(standIn());
    const folder = emptyFolder();
    const run = startRun({ folder, now: () => NOW });
    const ctx = ctxFor(folder, { runId: run.id });
    for (const text of ['git clone https://oauth2:glpat-SECRET@gitlab.com/ann/x', 'oauth2:glpat-SECRET@gitlab.com/ann/x', 'https:/oauth2:SECRET@gitlab.com/',
      'https://oauth2:SEC/RET@gitlab.com/', 'https://gitlab.com/ann/f;private_token=SECRET', 'https://SECRET@gitlab.com/ann/x', 'SECRET@gitlab.com/ann/x', 'the cafe one?token=SECRET']) {
      const what = (await step.plan({ ...ctx, answers: { '3.join': { label: null, text, at: NOW.toISOString() } } })).ask?.card.what ?? '';
      assert.equal(/SECRET|SEC\/RET|RET@/.test(what), false, `${text} -> ${what}`);
    }
  });
});

test('a joining pin to a company GitLab names its address on the Go-ahead card, calls glab without the director\'s token variables, and makes no glab call in a look at the choices', async () => {
  await withHome(async () => {
    const w = standIn();
    await seedProject(w, `${USER}/Cafe-Menu`);
    const step = stepFor(w);
    const folder = emptyFolder();
    const run = startRun({ folder, now: () => NOW });
    const ctx = ctxFor(folder, { runId: run.id });
    const typed = `https://gitlab.company.example/${USER}/Cafe-Menu`;
    const pick = (id, card) => (id === 'join' ? typed : choose()(id, card));
    // Item 3.
    const got = await answerJoin(step, ctx, pick);
    assert.match(got.card.what, /a-director\/Cafe-Menu on your company's GitLab at gitlab\.company\.example, brought into this folder once setup finds Wheelhouse's settings in it\./);
    // Item 4, a choices-only look: nothing is run against the pinned host.
    w.calls.length = 0;
    await answerJoin(step, { ...ctx, choicesOnly: true }, pick).catch(() => {});
    assert.deepEqual(w.calls.filter((c) => c.env?.GITLAB_HOST === 'gitlab.company.example'), []);
  });
  // Item 4: glab is run without GITLAB_TOKEN, GITLAB_ACCESS_TOKEN and OAUTH_TOKEN, whichever host it is told.
  const seen = [];
  const run = async (file, args, options = {}) => { seen.push(options.env ?? {}); return { code: 1, stdout: '', stderr: '' }; };
  await signInStatus({ host: 'gitlab', run, base: 'https://gitlab.company.example' });
  await signInStatus({ host: 'gitlab', run });
  assert.equal(seen.length > 0, true);
  for (const env of seen) {
    for (const name of ['GITLAB_TOKEN', 'GITLAB_ACCESS_TOKEN', 'OAUTH_TOKEN']) assert.equal(Object.hasOwn(env, name) && env[name] === undefined, true, name);
  }
  assert.equal(directorGitEnvTokens(), true);
});

const directorGitEnvTokens = () => {
  const env = directorGitEnv({ host: 'gitlab', gitPath: '/usr/bin/git', env: { PATH: '/bin' }, platform: 'darwin' });
  return ['GITLAB_TOKEN', 'GITLAB_ACCESS_TOKEN', 'OAUTH_TOKEN'].every((n) => Object.hasOwn(env, n) && env[n] === undefined);
};

test('a token in a pasted address is not shown back on the card that asks again', async () => {
  await withHome(async () => {
    const step = stepFor(standIn());
    const folder = emptyFolder();
    const run = startRun({ folder, now: () => NOW });
    const ctx = ctxFor(folder, { runId: run.id });
    const typed = (text) => ({ '3.join': { label: null, text, at: NOW.toISOString() } });
    const shown = (await step.plan({ ...ctx, answers: typed('https://oauth2:glpat-SECRET123@gitlab.example.org/') })).ask.card.what;
    assert.equal(shown.includes('SECRET123'), false, shown);
    assert.match(shown, /^"gitlab\.example\.org\/" is not a repository's name\./);
    // A query string, and a user that is not plain git, are not shown back either.
    for (const secret of ['https://gitlab.example.org/?private_token=SECRET456', 'deploy:SECRET789@gitlab.example.org:']) {
      const card = (await step.plan({ ...ctx, answers: typed(secret) })).ask.card.what;
      assert.equal(/SECRET\d+|private_token/.test(card), false, card);
    }
    // An answer kept as nothing because a secret was left in it brings the card back saying why.
    assert.equal((await step.plan({ ...ctx, answers: typed(HELD_SECRET) })).ask.card.what, [
      'What you pasted had a sign-in name, password or token in it, so setup didn\'t keep it.',
      'If it was a real password or token, change it on GitLab or GitHub: it is now in this chat.',
      'Paste the address as your browser shows it on the project\'s page, or type owner/name, like ann/cafe-menu.',
      'Where should Cafe-Menu be kept?',
    ].join('\n'));
    // git@host: is no secret, and stays.
    assert.match((await step.plan({ ...ctx, answers: typed('git@gitlab.example.org:') })).ask.card.what, /^"git@gitlab\.example\.org:" is not/);
  });
});

test('a second computer joins from an empty folder: the project found on an organisation by its .claude/wheelhouse.json, checked out in place with its committed settings, its own record opened, and its run a joining one', async () => {
  await withHome(async () => {
    const w = standIn({ memberships: [{ state: 'active', role: 'member', organization: { login: 'cafe-co' } }] });
    await w.add(`${USER}/Cafe-Menu`); // the same name on their own account, not set up with Wheelhouse
    await seedProject(w, 'cafe-co/Cafe-Menu', { stateBranch: false });
    const step = stepFor(w);
    const folder = emptyFolder();
    const planned = await answerJoin(step, ctxFor(folder), joining());
    // Neither the real-users nor the Locked question (a Mac here): the first computer's.
    assert.deepEqual(planned.asked.map((a) => a.id.replace(/-[0-9a-f]{10,}$/, '')), ['join', 'host', 'connection']);
    assert.deepEqual(planned.changes.slice(0, 2), [
      { kind: 'host', target: 'github', action: 'join', name: 'Cafe-Menu' },
      { kind: 'folder', target: folder, action: 'checkout' },
    ]);
    assert.ok(!planned.changes.some((c) => c.action === 'repository'), 'nothing is made for the product');
    assert.deepEqual(planned.changes.find((c) => c.action === 'connection'), { kind: 'host', target: 'github', action: 'connection', mode: 'quick', locked: false, backend: 'cli' });
    assert.equal(planned.asked.at(-1).card.recommend, STRICTER, 'a narrow way until the phase is known, never Quick');
    const text = composeCard({ ...planned.card, target: { step: 3, hash: planHash(planned.changes) } }).question.question;
    assert.match(text, /Cafe-Menu on your GitHub account or organisations, brought into this folder once setup finds Wheelhouse's settings in it/);
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
    // settings with its text as the value before, the private record and the project's record.
    const changes = findRun(folder).changes;
    assert.deepEqual(joinedOf(folder), [{ joined: 'Cafe-Menu' }, { joined: 'cafe-co/Cafe-Menu', found: true }]);
    const settingsChange = changes.find((c) => c.kind === 'file' && c.target === path.join(folder, '.claude', 'settings.json'));
    assert.deepEqual([settingsChange.before, settingsChange.after], [INSTALLED, COMMITTED]);
    const order = changes.map((c) => `${c.kind} ${c.target.replace(wheelhouseHome(), '~').replace(folder, '<folder>')}`);
    assert.deepEqual(order.filter((o) => !o.startsWith('answer')), [
      `folder ${path.join('<folder>', '.git')}`, `file ${path.join('<folder>', '.claude', 'settings.json')}`,
      `folder ${path.join('~', 'projects', 'cafe-co__Cafe-Menu', 'record')}`, `file ${path.join('~', 'projects', 'cafe-co__Cafe-Menu', 'project.json')}`,
    ]);
    assert.ok(order.indexOf('answer step 3') === 0, 'joining is recorded before anything is done');
    // Nothing made on the host at all.
    assert.deepEqual(w.calls.filter((c) => c.args?.[0] === 'repo'), []);
    // The project's record and its own private record, empty: the first computer's stays there.
    const slug = slugFor('cafe-co/Cafe-Menu');
    assert.deepEqual(readProject(slug), { folder, remoteUrl: remote, host: 'github', repo: 'cafe-co/Cafe-Menu', connection: { host: 'github', mode: 'quick', backend: 'cli', project: 'cafe-co/Cafe-Menu' } });
    assert.ok(fs.existsSync(path.join(stateDir(slug), '.git')));
    assert.equal(await g(stateDir(slug), 'remote'), '');
    assert.deepEqual(fs.readdirSync(stateDir(slug)).filter((n) => n !== '.git'), ['README.md']);
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
    assert.deepEqual(again.asked.map((a) => a.id.replace(/-[0-9a-f]{10,}$/, '')), ['host', 'connection']);
    assert.deepEqual(again.changes.find((c) => c.action === 'join'), { kind: 'host', target: 'github', action: 'join', name: 'cafe-co/Cafe-Menu' });
    await assert.rejects(applyIn(step, folder, run.id, planned.changes, { answers: planned.answers }), /checked out to cafe-co\/Cafe-Menu, already set up on another computer/);
    const count = findRun(folder).changes.filter((c) => c.kind === 'folder' && c.target.endsWith('.git')).length;
    await applyIn(step, folder, run.id, again.changes, { answers: again.answers });
    assert.equal(findRun(folder).changes.filter((c) => c.kind === 'folder' && c.target.endsWith('.git')).length, count);
  });
});

test('none or several found are refused saying to type owner/name, the question asks again, and a typed owner/name is used', async () => {
  await withHome(async () => {
    const w = standIn({ memberships: [{ state: 'active', role: 'admin', organization: { login: 'cafe-co' } }] });
    // One found by its v0.1.x state branch alone, one by its .claude/wheelhouse.json alone.
    await seedProject(w, `${USER}/Cafe-Menu`, { config: false });
    await seedProject(w, 'cafe-co/Cafe-Menu', { stateBranch: false });
    const step = stepFor(w);
    const folder = emptyFolder();
    const run = startRun({ folder, now: () => NOW });
    const ctx = ctxFor(folder, { runId: run.id });
    const planned = await answerJoin(step, ctx, joining());
    await assert.rejects(applyIn(step, folder, run.id, planned.changes, { answers: planned.answers }),
      /^Error: More than one repository named Cafe-Menu is set up with Wheelhouse \(a-director\/Cafe-Menu, cafe-co\/Cafe-Menu\), so nothing was checked out: type the one you mean as owner\/name on step 3's question, which asks again$/);
    assert.deepEqual(joinedOf(folder).at(-1), { joined: 'Cafe-Menu', missed: [`${USER}/Cafe-Menu`, 'cafe-co/Cafe-Menu'], host: 'github', user: USER, withdraws: null });
    assert.equal(fs.existsSync(path.join(folder, '.git')), false, 'nothing checked out');
    assert.ok(stepsFor(findRun(folder)).some((s) => s.n === 4), 'a miss joins nothing: the run has every step again, step 4\'s questions among them, and step 3 can run again');
    // Asked again, under an id naming what was missed, saying so; the typed owner/name is used.
    const again = await step.plan({ ...ctx, answers: planned.answers });
    assert.match(again.ask.id, /^join-[0-9a-f]{10}$/);
    assert.equal(again.ask.endsBatch, true, 'the join card ends its batch, so the cards a joining product skips are not asked with it');
    assert.match(again.ask.card.meanwhile, /Setup has stopped here\. Its tools and your sign-in stay/);
    assert.match(again.ask.card.what, /^More than one Cafe-Menu is set up with Wheelhouse: a-director\/Cafe-Menu, cafe-co\/Cafe-Menu\./);
    const typed = await answerJoin(step, { ...ctx, answers: planned.answers }, joining({ typed: 'cafe-co/Cafe-Menu' }));
    assert.deepEqual(typed.changes.find((c) => c.action === 'join'), { kind: 'host', target: 'github', action: 'join', name: 'cafe-co/Cafe-Menu' });
    assert.match(typed.card.what, /cafe-co\/Cafe-Menu on your GitHub/);
    await applyIn(step, folder, run.id, typed.changes, { answers: typed.answers });
    assert.equal(joinedRepo(findRun(folder)), 'cafe-co/Cafe-Menu');
    assert.equal(await g(folder, 'config', '--get', 'remote.origin.url'), w.hostUrl({ repo: 'cafe-co/Cafe-Menu' }));
  });
  await withHome(async () => {
    // None: a repository of the name not set up with Wheelhouse doesn't count.
    const w = standIn();
    await w.add(`${USER}/Cafe-Menu`);
    const step = stepFor(w);
    const folder = emptyFolder();
    const run = startRun({ folder, now: () => NOW });
    const ctx = ctxFor(folder, { runId: run.id });
    const planned = await answerJoin(step, ctx, joining());
    await assert.rejects(applyIn(step, folder, run.id, planned.changes, { answers: planned.answers }),
      /^Error: Setup found no repository Cafe-Menu set up with Wheelhouse on your GitHub account or your organisations, so nothing was brought in: type the project's owner\/name on step 3's question, which asks again$/);
    assert.deepEqual(joinedOf(folder).at(-1), { joined: 'Cafe-Menu', missed: 'none', host: 'github', user: USER, withdraws: null });
    // A named project (owner/name) not set up with Wheelhouse is not asked for again by the same name: the line says what was
    // not found and the way on, in plain words, on the error and on the card asked again.
    const namedRun = startRun({ folder: emptyFolder(), now: () => NOW });
    const namedCtx = ctxFor(namedRun.folder ?? folder, { runId: namedRun.id });
    const named = await answerJoin(step, namedCtx, joining({ typed: `${USER}/Cafe-Menu` }));
    await assert.rejects(applyIn(step, namedRun.folder ?? folder, namedRun.id, named.changes, { answers: named.answers }),
      new RegExp(`^Error: Setup couldn't bring in ${USER}/Cafe-Menu: nothing was brought in, and setup asks where to keep it again\\.$`));
    const again = (await step.plan({ ...namedCtx, answers: named.answers })).ask;
    assert.match(again.card.what, new RegExp(`^Setup couldn't find Wheelhouse's settings in ${USER}/Cafe-Menu on GitHub`));
    assert.doesNotMatch(again.card.what, /clone|checked out|download a copy|type the project's owner/);
    // Typed text that names no repository asks again at once, saying so.
    const first = (await step.plan({ ...ctx, answers: planned.answers })).ask;
    const answers = { ...planned.answers, [`3.${first.id}`]: { label: null, text: 'the cafe one', at: NOW.toISOString() } };
    const next = (await step.plan({ ...ctx, answers })).ask;
    assert.notEqual(next.id, first.id);
    assert.match(next.card.what, /^"the cafe one" is not a repository's name\. Type owner\/name, like ann\/cafe-menu, or click a button\./);
    // A pasted address with no project in it says it names no project.
    const bare = { ...answers, [`3.${next.id}`]: { label: null, text: 'https://git.example.org/', at: NOW.toISOString() } };
    assert.match((await step.plan({ ...ctx, answers: bare })).ask.card.what,
      /^"https:\/\/git\.example\.org\/" is not a repository's name\. That is the address of the host itself, not of a project: paste the address of the project's page, or type owner\/name, like ann\/cafe-menu, or click a button\./);
    // A new product, chosen now: the run is not a joining one any more once its apply starts.
    const fresh = await answerJoin(step, { ...ctx, answers }, (id) => (id.startsWith('join') ? HOST_LABELS.github : choose()(id)));
    assert.ok(fresh.changes.some((c) => c.action === 'repository'));
    fs.rmSync(w.hostUrl({ repo: `${USER}/Cafe-Menu` }), { recursive: true });
    delete w.repos[`${USER}/Cafe-Menu`];
    await applyIn(step, folder, run.id, fresh.changes, { answers: fresh.answers });
    assert.deepEqual(joinedOf(folder).at(-1), { joined: null });
    assert.equal(stepsFor(findRun(folder)), SETUP_STEPS);
  });
});

test('a launched project refuses Quick at apply, before anything is connected or registered, and its card is asked again without Quick', async () => {
  // Launched as its .claude/wheelhouse.json says, or (set up with v0.1.x) as its state branch's phase says.
  for (const seeded of [{ launched: true, stateBranch: false }, { phase: 'launched' }]) {
    await withHome(async () => {
      const w = standIn();
      await seedProject(w, `${USER}/Cafe-Menu`, seeded);
      const step = stepFor(w);
      const folder = emptyFolder();
      const run = startRun({ folder, now: () => NOW });
      const ctx = ctxFor(folder, { runId: run.id });
      const planned = await answerJoin(step, ctx, joining());
      assert.ok(planned.asked.at(-1).card.options.some((o) => o.label === WAYS.quick), 'whether it is launched is not known before it is checked out');
      await assert.rejects(applyIn(step, folder, run.id, planned.changes, { answers: planned.answers }), { message: quickLaunched(`${USER}/Cafe-Menu`) });
      const slug = slugFor(`${USER}/Cafe-Menu`);
      assert.equal(readProject(slug), null, 'nothing registered');
      assert.equal(fs.existsSync(path.join(stateDir(slug), '.git')), false, 'no record opened');
      if (seeded.phase) {
        assert.deepEqual(joinedOf(folder).at(-1), { joined: `${USER}/Cafe-Menu`, launched: true }, 'the state branch\'s phase, recorded');
        // The state branch was read in a scratch repository: none of its history is in the product's
        // folder, where agents could read it, and the scratch is gone.
        const tip = await g(w.hostUrl({ repo: `${USER}/Cafe-Menu` }), 'rev-parse', 'refs/heads/wheelhouse-state');
        assert.notEqual((await realRun('git', ['cat-file', '-e', `${tip}^{commit}`], { cwd: folder })).code, 0, 'the state branch\'s commits are not in the folder');
        assert.doesNotMatch(fs.existsSync(path.join(folder, '.git', 'FETCH_HEAD')) ? fs.readFileSync(path.join(folder, '.git', 'FETCH_HEAD'), 'utf8') : '', /wheelhouse-state/);
        assert.deepEqual(fs.readdirSync(wheelhouseHome()).filter((name) => name.startsWith('join-')), [], 'the scratch is removed');
      }
      // Planned again: no Quick. With no Wheelhouse app their own app is the one way left, so it is
      // not asked (a card needs two options) and the Go-ahead card lists it.
      const card = connectionCard({ host: 'github', launched: true, realUsers: true, where: `${USER}/Cafe-Menu on GitHub` });
      assert.deepEqual(card.options.map((o) => o.label), [WAYS.own]);
      assert.match(card.what, /It is launched, and a launched product needs a narrow connection, so Quick is not offered/);
      const again = await step.plan({ ...ctx, answers: planned.answers });
      assert.equal(again.ask, undefined);
      assert.equal(again.changes.find((c) => c.action === 'connection').mode, 'narrow');
      assert.match(again.card.what, /Your own GitHub App/);
    });
  }
  // A project not launched joins Quick, with a v0.1.x state branch too.
  await withHome(async () => {
    const w = standIn();
    await seedProject(w, `${USER}/Cafe-Menu`, { phase: 'trying' });
    const step = stepFor(w);
    const folder = emptyFolder();
    const run = startRun({ folder, now: () => NOW });
    const planned = await answerJoin(step, ctxFor(folder, { runId: run.id }), joining());
    await applyIn(step, folder, run.id, planned.changes, { answers: planned.answers });
    assert.equal(readProject(slugFor(`${USER}/Cafe-Menu`)).connection.mode, 'quick');
    assert.equal(launchedIn(slugFor(`${USER}/Cafe-Menu`)), false);
  });
  // On GitLab a launched project is not asked at all: Narrow is all there is.
  await withHome(async () => {
    const w = standIn();
    await seedProject(w, `${USER}/Cafe-Menu`, { launched: true, stateBranch: false });
    const step = stepFor(w);
    const folder = emptyFolder();
    // As an earlier attempt checked it out, saying it is launched.
    fs.writeFileSync(path.join(folder, '.claude', 'wheelhouse.json'), '{"v":1,"launched":true}\n');
    const planned = await answerJoin(step, ctxFor(folder), joining({ typed: `${USER}/Cafe-Menu`, host: HOST_LABELS.gitlab }));
    assert.deepEqual(planned.asked.map((a) => a.id), ['join', 'host', 'gitlab-where']);
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
    await assert.rejects(applyIn(step, folder, run.id, own, { answers: planned.answers }), /checked out to a-director\/Cafe-Menu, already set up on another computer/);
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

test('a joining computer\'s card says its own app is made, or found on GitHub by its name, and a record that can\'t be read counts as launched', async () => {
  await withHome(async () => {
    const w = standIn();
    const planned = await answerJoin(stepFor(w), ctxFor(emptyFolder()), joining({ way: WAYS.own }));
    assert.match(planned.card.what, /Your own GitHub App, made, or found on GitHub by its name/);
    assert.doesNotMatch(planned.card.what, /click Create/);
    assert.match(planned.director, /if your app is not on GitHub yet/);
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
    assert.deepEqual(gits.filter((a) => a[0] === 'fetch'), [['fetch', '-q', '--end-of-options', `https://github.com/${USER}/Shop.git`, '+refs/heads/main:refs/remotes/origin/main']]);

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
    assert.deepEqual(gits.filter((a) => a[0] === 'fetch'), [['fetch', '-q', '--end-of-options', 'https://github.com/cafe-co/Cafe-Menu.git', '+refs/heads/main:refs/remotes/origin/main']]);
  });
});

// ---- The as-is route's git: the director's own, for the calls that reach the host ----

// A scratch home holding a global git config with a credential helper of the director's own, for the length of `fn`.
async function withDirectorsGitConfig(fn, extra = '') {
  const home = fs.realpathSync.native(tempFolder('wh-dirgit-'));
  fs.writeFileSync(path.join(home, '.gitconfig'), `[credential]\n\thelper = directors-own-helper\n${extra}`);
  const was = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE };
  process.env.HOME = home;
  process.env.USERPROFILE = home;
  try {
    return await fn();
  } finally {
    for (const [k, v] of Object.entries(was)) if (v === undefined) delete process.env[k]; else process.env[k] = v;
  }
}

// The stand-in GitLab at https://gitlab.com, answering as overHttps does; each git call's name, environment and (for a call that
// reaches the host) the credential helpers git would use under that environment are kept in `seen`.
const overGitlab = (w, seen, { fail = null } = {}) => async (file, args = [], options = {}) => {
  if (path.basename(file).replace(/\.exe$/, '') !== 'git') return w.run(file, args, options);
  const sub = args.find((a) => !a.startsWith('-'));
  // The as-is guard's own reads (the computer's settings, git's answer for the address) are not the calls under test.
  if (args.includes('--show-scope') || args.includes('--get-url') || args.includes('--get-urlmatch')) return w.run(file, args, options);
  const reaches = ['fetch', 'push', 'ls-remote'].includes(sub);
  if (reaches) {
    const helpers = await hostGuard(file, ['config', '--get-all', 'credential.helper'], options);
    seen.push({ sub, env: options.env, helpers: helpers.stdout.split(/\r?\n/).filter(Boolean) });
    if (fail !== null) return { code: 128, stdout: '', stderr: fail };
  } else {
    seen.push({ sub, env: options.env });
  }
  let served = false;
  const local = args.map((a) => {
    const repo = /^https:\/\/gitlab\.com\/(.+)\.git$/.exec(a)?.[1];
    if (repo === undefined) return a;
    served = true;
    return w.hostUrl({ repo });
  });
  return w.run(file, local, served ? { ...options, env: { ...options.env, GIT_ALLOW_PROTOCOL: 'https:file' } } : options);
};

test('as-is on GitLab with no glab: the new folder is fetched with the director\'s own git settings and credential helper, not setup\'s isolated git', async () => {
  await withHome(async () => withDirectorsGitConfig(async () => {
    const w = standIn({ signedIn: { gitlab: false }, blockedTool: true });
    const hostUrl = ({ repo }) => `https://gitlab.com/${repo}.git`;
    const folder = productFolder();
    const seen = [];
    const env = directorGitEnv({ host: 'gitlab', gitPath: 'git', base: 'https://gitlab.com' });
    const reachEnv = asIsReachEnv({ host: 'gitlab', url: hostUrl({ repo: `${USER}/Shop` }), gitPath: 'git', base: 'https://gitlab.com' });
    await makeRepos({ host: 'gitlab', owner: USER, name: 'Shop', isNew: true, folder, run: overGitlab(w, seen), api: w.api, env, reachEnv, hostUrl, base: 'https://gitlab.com' });
    assert.equal(await g(folder, 'rev-parse', 'HEAD'), await g(w.hostUrl({ repo: `${USER}/Shop` }), 'rev-parse', 'main'), 'the folder is connected');
    const fetch = seen.find((c) => c.sub === 'fetch');
    assert.equal(fetch.env.GIT_CONFIG_GLOBAL, undefined, 'the director\'s global settings are not shut out');
    assert.equal(fetch.env.GIT_CONFIG_NOSYSTEM, undefined, 'nor their system settings');
    assert.equal(fetch.env.GIT_TERMINAL_PROMPT, '0');
    assert.equal(fetch.env.GCM_INTERACTIVE, 'never');
    // Their global file's helper, with whatever their system file lists (a Mac's keychain): setup's glab one is not given.
    assert.ok(fetch.helpers.includes('directors-own-helper'), fetch.helpers.join(', '));
    assert.ok(!fetch.helpers.some((h) => /git-credential|glab/.test(h)), fetch.helpers.join(', '));
    assert.ok(!JSON.stringify(fetch.env).includes('git-credential'), 'no glab helper in the environment');
    // The fence still applies to that call.
    assert.equal(fetch.env.GIT_ALLOW_PROTOCOL, 'https', 'https only');
    assert.ok(Object.entries(fetch.env).some(([k, v]) => /^GIT_CONFIG_KEY_/.test(k) && /^core\.hookspath$/i.test(v)), 'the fence\'s settings are in the call');
    // Calls that touch only the folder keep the isolated environment.
    for (const c of seen.filter((x) => !['fetch', 'push', 'ls-remote'].includes(x.sub))) assert.equal(c.env.GIT_CONFIG_GLOBAL, '/dev/null', c.sub);
  }));
});

// The as-is connect of a new folder under a global git config holding `extra`: what it throws (or null) and the folder.
async function asIsConnectWith(extra, { fail = null, marker = null, publish = null, records = [], gcm = false } = {}) {
  let outcome = null;
  let folder = null;
  let w = null;
  await withHome(async () => withDirectorsGitConfig(async () => {
    w = standIn({ signedIn: { gitlab: false }, blockedTool: true });
    const hostUrl = ({ repo }) => `https://gitlab.com/${repo}.git`;
    folder = productFolder();
    const env = directorGitEnv({ host: 'gitlab', gitPath: 'git', base: 'https://gitlab.com' });
    const reachEnv = asIsReachEnv({ host: 'gitlab', url: hostUrl({ repo: `${USER}/Shop` }), gitPath: 'git', base: 'https://gitlab.com' });
    // The stand-in host's own git calls ran under the same scratch home, so a hook's mark from them is cleared first.
    if (marker !== null) fs.rmSync(marker, { force: true });
    try {
      await makeRepos({ host: 'gitlab', owner: USER, name: 'Shop', isNew: true, folder, run: overGitlab(w, [], { fail }), api: w.api, env, reachEnv, hostUrl, base: 'https://gitlab.com', publish, gcm, record: (c) => records.push(c) });
    } catch (error) {
      outcome = error.message;
    }
  }, extra));
  return { outcome, folder, w };
}

test('as-is connect: a hook defined in the director\'s global git settings does not run', async () => {
  const marker = path.join(fs.realpathSync.native(tempFolder('wh-hookmark-')), 'ran');
  const { outcome, folder, w } = await asIsConnectWith(`[hook "x"]\n\tevent = reference-transaction\n\tcommand = test ! -d .claude || touch ${marker}\n`, { marker });
  assert.equal(outcome, null);
  assert.equal(await g(folder, 'rev-parse', 'HEAD'), await g(w.hostUrl({ repo: `${USER}/Shop` }), 'rev-parse', 'main'), 'it still connects');
  assert.ok(!fs.existsSync(marker), 'the hook did not run');
});

const settingLine = (why) => `A setting in git on this computer (${why}) means Wheelhouse can't safely use your own git, so setup did not reach your repository and sent nothing. Ask me which setting it is: whoever looks after this computer can change it, then a fresh Go ahead tries again. Or choose another way to connect on step 3's card.`;
const noFetch = (folder) => assert.ok(!fs.existsSync(path.join(folder, '.git', 'refs', 'remotes', 'origin', 'main')), 'nothing was fetched');

// What a refusal throws: its line and its detail, kept apart.
async function asIsRefusal(extra) {
  let error = null;
  let folder = null;
  await withHome(async () => withDirectorsGitConfig(async () => {
    const w = standIn({ signedIn: { gitlab: false }, blockedTool: true });
    const hostUrl = ({ repo }) => `https://gitlab.com/${repo}.git`;
    folder = productFolder();
    const env = directorGitEnv({ host: 'gitlab', gitPath: 'git', base: 'https://gitlab.com' });
    const reachEnv = asIsReachEnv({ host: 'gitlab', url: hostUrl({ repo: `${USER}/Shop` }), gitPath: 'git', base: 'https://gitlab.com' });
    try {
      await makeRepos({ host: 'gitlab', owner: USER, name: 'Shop', isNew: true, folder, run: overGitlab(w, []), api: w.api, env, reachEnv, hostUrl, base: 'https://gitlab.com' });
    } catch (e) {
      error = e;
    }
  }, extra));
  return { error, folder };
}

test('as-is connect: a global certificate check turned off for the address, or a resolver override, is refused before any contact, in plain words, with the exact setting as detail', async () => {
  for (const [extra, why, key] of [
    ['[http "https://gitlab.com/"]\n\tsslVerify = false\n', 'it turns certificate checks off for this address', /reads http\.sslVerify as false for https:\/\/gitlab\.com\/.*global file:.*\.gitconfig: http\.https:\/\/gitlab\.com\/\.sslverify false/],
    ['[http "https://gitlab.com/"]\n\tsslVerify =\n', 'it turns certificate checks off for this address', /reads http\.sslVerify as false.*\.gitconfig/],
    ['[http "https://gitlab.com/"]\n\tsslVerify = off\n', 'it turns certificate checks off for this address', /reads http\.sslVerify as false/],
    ['[http]\n\tsslVerify = false\n[http "https://gitlab.com/"]\n\tsslVerify = no\n', 'it turns certificate checks off for this address', /reads http\.sslVerify as false/],
    ['[http]\n\tcurloptResolve = gitlab.com:443:10.0.0.9\n', 'it points this site\'s name at a different server', /http\.curloptresolve = gitlab\.com:443:10\.0\.0\.9; set in global file:.*\.gitconfig/],
  ]) {
    const { error, folder } = await asIsRefusal(extra);
    assert.equal(error.message, settingLine(why), extra);
    assert.ok(!/sslverify|curlopt|http\./i.test(error.message), 'no key name in the director\'s line');
    assert.match(error.detail, key, extra);
    noFetch(folder);
  }
});

test('as-is connect: certificate checks off for another host, or on for this one, still connects', async () => {
  for (const extra of ['[http "https://other.example/"]\n\tsslVerify = false\n', '[http "https://gitlab.com/"]\n\tsslVerify = true\n', '[http]\n\tsslVerify = false\n']) {
    const { outcome, folder, w } = await asIsConnectWith(extra);
    assert.equal(outcome, null, extra);
    assert.equal(await g(folder, 'rev-parse', 'HEAD'), await g(w.hostUrl({ repo: `${USER}/Shop` }), 'rev-parse', 'main'), extra);
  }
});

test('as-is connect: a global address rewrite of the product\'s address is refused in plain words, the key and file in the detail', async () => {
  for (const [extra, key] of [
    ['[url "https://evil.example/"]\n\tinsteadOf = https://gitlab.com/\n', /url\.https:\/\/evil\.example\/\.insteadof = https:\/\/gitlab\.com\/; set in global file:.*\.gitconfig/],
    ['[url "https://evil.example/"]\n\tpushInsteadOf = https://gitlab.com/\n', /pushinsteadof/i],
    [`[remote "https://gitlab.com/${USER}/Shop.git"]\n\turl = https://evil.example/x.git\n`, /remote\.https:\/\/gitlab\.com\/.*\.url = https:\/\/evil\.example\/x\.git/],
  ]) {
    const { error } = await asIsRefusal(extra);
    assert.equal(error.message, settingLine('it points this project\'s address somewhere else, for example to SSH'), extra);
    assert.ok(!/insteadof|pushurl|evil|url\./i.test(error.message));
    assert.match(error.detail, key, extra);
  }
});

test('as-is guard: git that cannot read its settings or answer for the address says the settings could not be read, not a rewrite', async () => {
  const unread = 'Git\'s settings on this computer could not be read, so setup did not reach your repository and sent nothing; a fresh Go ahead tries again, or choose another way to connect on step 3\'s card.';
  const url = 'https://gitlab.com/a/b.git';
  const listing = 'global\0user.name\nx\0';
  const fakeRun = (answers) => async (file, args) => {
    const key = args.includes('--list') ? 'list' : args.includes('--get-urlmatch') ? 'urlmatch' : args.includes('--get-url') ? 'url' : 'other';
    return answers[key] ?? { code: 0, stdout: '', stderr: '' };
  };
  const base = { list: { code: 0, stdout: listing, stderr: '' }, urlmatch: { code: 1, stdout: '', stderr: '' }, url: { code: 0, stdout: `${url}\n`, stderr: '' } };
  const guard = (answers) => guardAsIsReach({ run: fakeRun({ ...base, ...answers }), cwd: tempFolder('wh-guard-'), env: { GIT_CONFIG_COUNT: '0' }, url });
  assert.equal((await guard({})).GIT_CONFIG_COUNT, '1', 'the pin is added when all is well');
  await assert.rejects(guard({ url: { code: 128, stdout: '', stderr: 'fatal: bad' } }), (e) => e.message === unread && /exited 128/.test(e.detail));
  await assert.rejects(guard({ list: { code: 1, stdout: '', stderr: '' } }), (e) => e.message === unread);
  await assert.rejects(guard({ urlmatch: { code: 128, stdout: '', stderr: 'fatal: bad value' } }), (e) => e.message === unread);
  await assert.rejects(guard({ url: { code: 0, stdout: 'ssh://git@gitlab.com/a/b.git\n', stderr: '' } }), (e) => e.message === settingLine('it points this project\'s address somewhere else, for example to SSH') && /ssh:\/\/\[hidden\]@gitlab\.com/.test(e.detail));
  await assert.rejects(guardAsIsReach({ run: fakeRun(base), cwd: tempFolder('wh-guard-'), env: {}, url: '' }), (e) => e.message === 'Setup asked git to reach a repository without naming its address, so it did not reach your repository and sent nothing. This is a fault in Wheelhouse, and a fresh Go ahead won\'t help: tell me and I\'ll report it.');
});

test('as-is connect: a rewrite of some other address, or none, still connects', async () => {
  const { outcome, folder, w } = await asIsConnectWith('[url "https://mirror.example/"]\n\tinsteadOf = https://elsewhere.example/\n');
  assert.equal(outcome, null);
  assert.equal(await g(folder, 'rev-parse', 'HEAD'), await g(w.hostUrl({ repo: `${USER}/Shop` }), 'rev-parse', 'main'));
});

const OTHER_WAY = 'choose another way to connect on step 3\'s card';
test('as-is connect: a fetch that fails on a missing sign-in says what git said, then to ask for git\'s sign-in for the host', async () => {
  const said = 'fatal: could not read Username for \'https://gitlab.com\': terminal prompts disabled\n';
  const { outcome } = await asIsConnectWith('', { fail: said, gcm: true });
  assert.equal(outcome, `Setup could not reach the new repository using git's own sign-in on this computer (git said: fatal: could not read Username for 'https://gitlab.com': terminal prompts disabled). Next: I can open git's sign-in for gitlab.com (its window may take a minute, and may open behind other windows); after you sign in there, setup carries on with step 3. Or ${OTHER_WAY}.`);
  // Where git has no sign-in window of its own, no window is promised, and the other way is recommended.
  const none = await asIsConnectWith('', { fail: said, gcm: false });
  assert.equal(none.outcome, `Setup could not reach the new repository using git's own sign-in on this computer (git said: fatal: could not read Username for 'https://gitlab.com': terminal prompts disabled). Next: git on this computer has no sign-in window of its own that I can open, so sign git in to gitlab.com outside setup, then a fresh Go ahead tries again; or ${OTHER_WAY} (recommended).`);
});

test('as-is connect: a fetch that fails for another reason says what git said, then a fresh Go ahead or the other way, with no sign-in offered', async () => {
  const { outcome } = await asIsConnectWith('', { fail: 'fatal: unable to access \'https://gitlab.com/a/b.git/\': Could not resolve host: gitlab.com\n' });
  assert.equal(outcome, `Setup could not reach the new repository using git's own sign-in on this computer (git said: fatal: unable to access 'https://gitlab.com/a/b.git/': Could not resolve host: gitlab.com). A fresh Go ahead tries again, or ${OTHER_WAY}.`);
});

test('as-is publish: a push that fails says what git said, then the next step by git\'s words', async () => {
  const said = 'remote: You are not allowed to push code to this project.\nTo https://gitlab.com/a/b.git\n ! [remote rejected] main -> main (pre-receive hook declined)\nerror: failed to push some refs to \'https://gitlab.com/a/b.git\'\n';
  const { outcome } = await asIsConnectWith('', { fail: said, publish: 'main' });
  assert.equal(outcome, `Setup could not send your project to its new repository using git's own sign-in on this computer (git said: remote: You are not allowed to push code to this project. ! [remote rejected] main -> main (pre-receive hook declined)). A fresh Go ahead tries again, or ${OTHER_WAY}.`);
  for (const auth of ['remote: HTTP Basic: Access denied\nfatal: Authentication failed for \'https://gitlab.com/a/b.git/\'\n', 'fatal: The requested URL returned error: 403 Forbidden\n']) {
    const signIn = await asIsConnectWith('', { fail: auth, publish: 'main', gcm: true });
    assert.match(signIn.outcome, /^Setup could not send your project to its new repository using git's own sign-in on this computer \(git said: .*\)\. Next: I can open git's sign-in for gitlab\.com \(its window may take a minute, and may open behind other windows\); after you sign in there, setup carries on with step 3\. Or choose another way to connect on step 3's card\.$/, auth);
  }
});

test('as-is connect: a sign-in failure records the address (an answer, no user in it) for git\'s sign-in form, and no other failure does', async () => {
  const records = [];
  await asIsConnectWith('', { fail: 'fatal: could not read Username for \'https://gitlab.com\': terminal prompts disabled\n', records, gcm: true });
  const kept = records.filter((c) => c.target === SIGN_IN_TARGET);
  assert.equal(kept.length, 1);
  assert.equal(kept[0].after.signIn.gcm, true, 'whether git has a window of its own is kept with it');
  assert.equal(kept[0].kind, 'answer');
  assert.equal(kept[0].after.signIn.address, `https://gitlab.com/${USER}/Shop.git`);
  assert.equal(kept[0].after.signIn.base, 'https://gitlab.com', 'the host\'s address is kept beside it');
  assert.equal(kept[0].after.signIn.why, 'sign-in');
  assert.ok(Number.isFinite(Date.parse(kept[0].after.signIn.at)));
  const other = [];
  await asIsConnectWith('', { fail: 'fatal: unable to access: Could not resolve host: gitlab.com\n', records: other });
  assert.equal(other.filter((c) => c.target === SIGN_IN_TARGET).length, 0);
});

test('as-is connect: a new repository git\'s sign-in cannot see means git is signed in as another account, says so, and keeps the address for git\'s sign-in', async () => {
  for (const said of [
    'remote: The project you were looking for could not be found or you don\'t have permission to view it.',
    'remote: Permission to a/b.git denied to someone.',
    'remote: Repository not found.',
  ]) {
    const records = [];
    const { outcome } = await asIsConnectWith('', { fail: `${said}\nfatal: unable to access 'https://gitlab.com/a/b.git/': The requested URL returned error: 403\n`, records });
    assert.ok(outcome.startsWith('Git on this computer is signed in to gitlab.com as a different account from the one setup made the project on (git said: '), outcome);
    assert.ok(outcome.endsWith(` Next: sign git out of gitlab.com, or in as the owning account, outside setup, then say Go ahead on step 3; or ${OTHER_WAY} (recommended).`), outcome);
    assert.ok(!/open git's sign-in/.test(outcome), 'no window is offered for another account');
    assert.ok(!/ask its owner/.test(outcome));
    const kept = records.filter((c) => c.target === SIGN_IN_TARGET);
    assert.equal(kept.length, 1, 'the address is kept for the sign-in card');
    assert.equal(kept[0].after.signIn.why, 'account');
  }
});

test('a joined project git\'s sign-in cannot see is one its owner has not shared: ask its owner, and no sign-in is kept', async () => {
  const records = [];
  const line = ownSignInFailure('reach the project', 'https://gitlab.com/o/p.git', (c) => records.push(c), { base: 'https://gitlab.com', joined: true })('remote: Repository not found.\n');
  assert.match(line, /^Setup could not reach the project using git's own sign-in on this computer \(git said: remote: Repository not found\.\)\. Your git sign-in for gitlab\.com can't see this project; ask its owner to add you, then a fresh Go ahead tries again\. Or choose another way to connect on step 3's card\.$/);
  assert.equal(records.length, 0);
});

test('a look for a joined project\'s state branch that fails on a missing sign-in says so and keeps the address; any other failure reads as no branch', async () => {
  const url = 'https://gitlab.com/o/p.git';
  const fakeFor = (stderr) => async (file, args) => {
    if (args[0] === 'ls-remote' && args.includes('refs/heads/wheelhouse-state')) return { code: 128, stdout: '', stderr };
    if (args.includes('--name-only')) return { code: 0, stdout: '', stderr: '' };
    if (args.includes('--list')) return { code: 0, stdout: 'global\0user.name\nx\0', stderr: '' };
    if (args.includes('--get-urlmatch')) return { code: 1, stdout: '', stderr: '' };
    if (args.includes('--get-url')) return { code: 0, stdout: `${url}\n`, stderr: '' };
    return { code: 0, stdout: '', stderr: '' };
  };
  await withHome(async () => {
    const reachEnv = asIsReachEnv({ host: 'gitlab', url, gitPath: 'git', base: 'https://gitlab.com' });
    const records = [];
    await assert.rejects(
      holdsState({ remoteUrl: url, gitPath: 'git', env: {}, reachEnv, base: 'https://gitlab.com', gcm: true, run: fakeFor('fatal: could not read Username for \'https://gitlab.com\': terminal prompts disabled\n'), record: (c) => records.push(c) }),
      (e) => /^Setup could not look for the project using git's own sign-in on this computer \(git said: .*\)\. Next: I can open git's sign-in for gitlab\.com \(its window/.test(e.message),
    );
    assert.equal(records.length, 1);
    assert.equal(records[0].target, SIGN_IN_TARGET);
    assert.equal(records[0].after.signIn.search, true);
    assert.equal(records[0].after.signIn.address, url);
    // The project is not there for this sign-in, or the network is down: not a branch, as before.
    for (const said of ['remote: Repository not found.\n', 'fatal: unable to access: Could not resolve host: gitlab.com\n']) {
      const none = [];
      assert.equal(await holdsState({ remoteUrl: url, gitPath: 'git', env: {}, reachEnv, base: 'https://gitlab.com', run: fakeFor(said), record: (c) => none.push(c) }), false);
      assert.equal(none.length, 0);
    }
  });
});

test('a sign-in the record could not keep is not offered in the line', () => {
  const line = ownSignInFailure('reach the project', 'https://gitlab.com/o/p.git', () => { throw new Error('disk full'); }, { base: 'https://gitlab.com', gcm: true })('fatal: could not read Username for \'https://gitlab.com\': terminal prompts disabled\n');
  assert.ok(!/open git's sign-in/.test(line), line);
  assert.match(line, /A fresh Go ahead tries again, or choose another way to connect on step 3's card\.$/);
});

test('the account line says what to change outside setup, whatever git has a window for, and keeps the record for its card', () => {
  const records = [];
  const line = ownSignInFailure('reach the new repository', 'https://gitlab.com/o/p.git', (c) => records.push(c), { base: 'https://gitlab.com', gcm: true })('remote: Repository not found.\n');
  assert.match(line, /^Git on this computer is signed in to gitlab\.com as a different account[^]*Next: sign git out of gitlab\.com, or in as the owning account, outside setup, then say Go ahead on step 3; or choose another way to connect on step 3's card \(recommended\)\.$/);
  assert.equal(records.length, 1);
  assert.equal(records[0].after.signIn.why, 'account');
});

test('a joining search skips a candidate git has no sign-in for, and says the sign-in line (keeping its address) only when none is found', async () => {
  const host = 'https://gitlab.com';
  const fakeApi = (configFor) => ({
    get: async (route) => {
      if (route.startsWith('/groups')) return { status: 200, body: [{ full_path: 'team' }] };
      if (route.includes('/repository/files/')) return { status: configFor.some((r) => route.includes(encodeURIComponent(r))) ? 200 : 404, body: {} };
      const repo = decodeURIComponent(route.replace(/^\/projects\//, '').split('?')[0]);
      return { status: 200, body: { path_with_namespace: repo, id: 1, default_branch: 'main', visibility: 'private' } };
    },
  });
  const fakeGit = (unsigned) => async (file, args) => {
    if (args[0] === 'ls-remote' && args.includes('refs/heads/wheelhouse-state')) {
      const address = args[args.indexOf('--end-of-options') + 1];
      return unsigned.some((r) => address.includes(`/${r}.git`)) ? { code: 128, stdout: '', stderr: 'fatal: could not read Username for \'https://gitlab.com\': terminal prompts disabled\n' } : { code: 0, stdout: '', stderr: '' };
    }
    if (args.includes('--name-only')) return { code: 0, stdout: '', stderr: '' };
    if (args.includes('--list')) return { code: 0, stdout: 'global\0user.name\nx\0', stderr: '' };
    if (args.includes('--get-urlmatch')) return { code: 1, stdout: '', stderr: '' };
    if (args.includes('--get-url')) return { code: 0, stdout: `${args.at(-1)}\n`, stderr: '' };
    return { code: 0, stdout: '', stderr: '' };
  };
  await withHome(async () => {
    const url = `${host}/ann/cafe.git`;
    const reachEnv = asIsReachEnv({ host: 'gitlab', url, gitPath: 'git', base: host });
    const search = (unsigned, configFor, records) => findJoined({
      host: 'gitlab', wanted: 'cafe', user: 'ann', run: fakeGit(unsigned), api: fakeApi(configFor), gitPath: 'git', env: {}, reachEnv,
      hostUrl: ({ repo }) => `${host}/${repo}.git`, base: host, gcm: true, record: (c) => records.push(c),
    });
    // One account has no sign-in; the other holds the project: it is found, and nothing is said or kept.
    const found = [];
    const got = await search(['ann/cafe'], ['team/cafe'], found);
    assert.deepEqual(got.map((f) => f.repo), ['team/cafe']);
    assert.equal(found.length, 0);
    // None found: the sign-in line is said once, for the first address, and its record is kept.
    const kept = [];
    await assert.rejects(search(['ann/cafe', 'team/cafe'], [], kept), /^Error: Setup could not look for the project using git's own sign-in[^]*Next: I can open git's sign-in for gitlab\.com/);
    assert.equal(kept.length, 1);
    assert.equal(kept[0].after.signIn.address, `${host}/ann/cafe.git`);
    assert.equal(kept[0].after.signIn.search, true);
  });
});

test('a sign-in is never offered for an address that is not https', async () => {
  const records = [];
  const say = ownSignInFailure('reach the project', 'http://gitlab.example/o/p.git', (c) => records.push(c))('fatal: could not read Username for \'http://gitlab.example\': terminal prompts disabled');
  assert.ok(!/open git's sign-in/.test(say), say);
  assert.equal(records.length, 0);
});

test('reachFailureKind reads the last lines one at a time, and not the words inside an address or a project\'s name', () => {
  const kind = reachFailureKind;
  assert.equal(kind('fatal: could not read Username for \'https://h\': terminal prompts have been disabled'), 'sign-in');
  assert.equal(kind('fatal: could not read Password for \'https://h\': No such device or address'), 'sign-in');
  assert.equal(kind('fatal: Authentication failed for \'https://h/a/b.git/\''), 'sign-in');
  assert.equal(kind('fatal: unable to access \'https://h/a/b.git/\': The requested URL returned error: 403'), 'other');
  assert.equal(kind('error: The requested URL returned error: 403 Forbidden'), 'sign-in');
  assert.equal(kind('fatal: HTTP 403 denied'), 'sign-in');
  assert.equal(kind('HTTP/1.1 401'), 'sign-in');
  assert.equal(kind('fatal: unable to access \'https://h/auth-service.git/\': Could not resolve host: h'), 'other');
  assert.equal(kind('fatal: unable to access \'https://h/login/403/x.git/\': Could not resolve host: h'), 'other');
  assert.equal(kind('fatal: repository \'auth-service.git\' does not exist'), 'other');
  assert.equal(kind('remote: Permission to a/b.git denied to someone.'), 'not-found');
  assert.equal(kind('remote: HTTP Basic: Access denied\nremote: The project you were looking for could not be found or you don\'t have permission to view it.'), 'not-found');
  assert.equal(kind(`fatal: could not read Username for 'https://h': terminal prompts disabled\n${'noise\n'.repeat(40)}`), 'other', 'only the last 16 lines');
  assert.equal(kind(''), 'other');
  assert.equal(kind(undefined), 'other');
});

test('reachFailureKind takes 1 MB of stderr in well under a second, as long lines or as many', () => {
  for (const big of ['x'.repeat(1 << 20), 'permission to '.repeat(75000), `${'a b '.repeat(260000)}\n`, `${'authentication '.repeat(70000)}`, ' denied\n'.repeat(130000), `${'https://h/a'.repeat(95000)}`]) {
    const started = Date.now();
    reachFailureKind(big);
    assert.ok(Date.now() - started < 1000, `took ${Date.now() - started} ms`);
  }
});

test('the as-is guard puts the setting\'s key and the file it is in the detail for the local and worktree files too, and the address settings are looked up inside setup', async () => {
  const url = 'https://gitlab.com/a/b.git';
  const listing = 'global\0user.name\nx\0';
  const seen = [];
  const fakeRun = async (file, args) => {
    seen.push(args);
    if (args.includes('--list')) return { code: 0, stdout: listing, stderr: '' };
    if (args.includes('--get-urlmatch')) return { code: 1, stdout: '', stderr: '' };
    if (args.includes('--get-url')) return { code: 0, stdout: 'ssh://git@gitlab.com/a/b.git\n', stderr: '' };
    if (args.includes('--get-regexp')) return { code: 0, stdout: 'local\tfile:.git/config\turl.ssh://u:pw@evil/.insteadof https://gitlab.com/\nworktree\tfile:.git/config.worktree\tremote.origin.pushurl x\ncommand\t\tfoo.bar baz\n', stderr: '' };
    return { code: 0, stdout: '', stderr: '' };
  };
  await assert.rejects(guardAsIsReach({ run: fakeRun, cwd: tempFolder('wh-guard-'), env: { GIT_CONFIG_COUNT: '0' }, url }), (e) => {
    assert.match(e.detail, /local file:\.git\/config: url\.ssh:\/\/\[hidden\]@evil\/\.insteadof https:\/\/gitlab\.com\//);
    assert.match(e.detail, /worktree file:\.git\/config\.worktree: remote\.origin\.pushurl x/);
    assert.ok(!/foo\.bar|command/.test(e.detail), 'the call\'s own scope is left out');
    assert.ok(!e.detail.includes('git config --show-origin'), 'no command is suggested to the agent');
    // A setting in the project's own git files is the project's to change, not the computer's.
    assert.match(e.message, /^A setting in this project's git settings \(it points this project's address somewhere else, for example to SSH\) means Wheelhouse can't safely use your own git/);
    assert.match(e.message, /you or whoever looks after the project can change it there, then a fresh Go ahead tries again\./);
    assert.ok(!/on this computer|looks after this computer/.test(e.message));
    // The same refusal in the words of git's sign-in, which is opened again rather than tried again by a fresh Go ahead.
    assert.match(e.lineFor({ stop: 'nothing was opened', again: 'I can open its sign-in again' }), /so nothing was opened\..* then I can open its sign-in again\. Or choose another way/);
    return true;
  });
  assert.ok(seen.some((a) => a.includes('--get-regexp') && a.includes('insteadof|pushurl|^remote')));
});

test('a refusal\'s raw git words are scrubbed first and then cut to about 4 KB of their end', async () => {
  const url = 'https://gitlab.com/a/b.git';
  const noisy = `${'e '.repeat(5000)}https://u:secretpw@h/x glpat-abcdefgh1234567 end\n`;
  const fakeRun = async (file, args) => {
    if (args.includes('--list')) return { code: 0, stdout: 'global\0user.name\nx\0', stderr: '' };
    if (args.includes('--get-urlmatch')) return { code: 1, stdout: '', stderr: '' };
    return { code: 128, stdout: '', stderr: noisy };
  };
  await assert.rejects(guardAsIsReach({ run: fakeRun, cwd: tempFolder('wh-guard-'), env: {}, url }), (e) => {
    assert.ok(e.detail.length < 4300, String(e.detail.length));
    assert.ok(e.detail.endsWith('https://[hidden]@h/x [hidden] end'), e.detail.slice(-80));
    assert.ok(/: \u2026e/.test(e.detail) || /: \u2026/.test(e.detail), 'the cut is marked');
    return true;
  });
});

test('the as-is route\'s own failure line ends with a full stop on every kind', () => {
  for (const line of [ASIS_SETTINGS_UNREAD, asIsSettingLine('why'), ASIS_NO_ADDRESS]) assert.ok(line.endsWith('.'), line);
});

test('the as-is route\'s settings refusal names the "different server" for a resolver override', () => {
  assert.match(asIsSettingLine('it points this site\'s name at a different server'), /\(it points this site's name at a different server\)/);
});

test('the routes that are not as-is still fetch with setup\'s isolated git and its own credential helper alone', async () => {
  await withHome(async () => withDirectorsGitConfig(async () => {
    const w = standIn();
    const hostUrl = ({ repo }) => `https://gitlab.com/${repo}.git`;
    const folder = productFolder();
    const seen = [];
    const env = directorGitEnv({ host: 'gitlab', gitPath: 'git', base: 'https://gitlab.com' });
    await makeRepos({ host: 'gitlab', owner: USER, name: 'Shop', isNew: true, folder, run: overGitlab(w, seen), api: w.api, env, hostUrl, base: 'https://gitlab.com' });
    const fetch = seen.find((c) => c.sub === 'fetch');
    assert.equal(fetch.env.GIT_CONFIG_GLOBAL, '/dev/null');
    assert.equal(fetch.env.GIT_CONFIG_NOSYSTEM, '1');
    assert.equal(fetch.helpers.length, 1, 'one helper only');
    assert.match(fetch.helpers[0], /auth git-credential/);
    assert.ok(!fetch.helpers.includes('directors-own-helper'), 'the director\'s own helper is never given to another route');
  }));
});

test('asIsReachEnv carries no helper of setup\'s and refuses to take one', () => {
  const env = asIsReachEnv({ host: 'gitlab', url: 'https://gitlab.com/a/b.git', gitPath: 'git', base: 'https://gitlab.com' });
  assert.ok(!Object.values(env).some((v) => /git-credential/.test(String(v))));
  assert.ok(!Object.entries(env).some(([k, v]) => /^GIT_CONFIG_KEY_/.test(k) && /^credential/i.test(v)), 'no credential setting at all');
  assert.equal(env.GIT_ALLOW_PROTOCOL, 'https');
  assert.equal(env.GIT_CONFIG_GLOBAL, undefined);
});

test('a fetch that fails says what git said, with any sign-in in it hidden', async () => {
  await withHome(async () => {
    const w = standIn();
    const hostUrl = ({ repo }) => `https://gitlab.com/${repo}.git`;
    const folder = productFolder();
    const env = directorGitEnv({ host: 'gitlab', gitPath: 'git', base: 'https://gitlab.com' });
    const said = 'fatal: could not read Username for \'https://oauth2:glpat-abcdefghijkl1234@gitlab.com\': terminal prompts disabled\n';
    await assert.rejects(
      makeRepos({ host: 'gitlab', owner: USER, name: 'Shop', isNew: true, folder, run: overGitlab(w, [], { fail: said }), api: w.api, env, hostUrl, base: 'https://gitlab.com' }),
      (error) => {
        assert.equal(error.message, 'git could not fetch the new repository (git said: fatal: could not read Username for \'https://[hidden]@gitlab.com\': terminal prompts disabled)');
        return true;
      },
    );
  });
});

// ---- Which GitLab (spec 8.11) ----

test('GitLab chosen and a company address typed gives a plan whose connection has that base, and names it in the settings', async () => {
  await withHome(async () => {
    const w = standIn({ signedIn: { github: true, gitlab: false } });
    const folder = productFolder('shop');
    const planned = await answerAll(stepFor(w), ctxFor(folder), (id, card) => {
      if (id === 'gitlab-where') return { text: 'https://git.example.org:8443/' };
      return choose({ host: HOST_LABELS.gitlab, way: WAYS.quick })(id, card);
    });
    const asked = planned.asked.find((a) => a.id === 'gitlab-where');
    assert.equal(asked.typed, true);
    assert.deepEqual(asked.card.options.map((o) => o.label), [GITLAB_COM, COMPANY_GITLAB]);
    composeCard({ ...asked.card, kind: 'question', suggest: false });
    const connection = planned.changes.find((c) => c.action === 'connection');
    assert.equal(connection.target, 'gitlab');
    assert.equal(connection.base, 'https://git.example.org:8443');
    const naming = planned.changes.find((c) => c.action === 'gitlab-hosts');
    assert.equal(naming.host, 'git.example.org:8443');
    assert.equal(planned.changes.find((c) => c.action === 'sign-in').via, 'token');
    composeCard({ ...planned.card, target: { step: 3, hash: '0'.repeat(64) } });
    // Applied, the settings name it (keeping what the file held), so every later reading is the same as for a remote that names it.
    const recorded = [];
    nameGitlabHost({ folder, entry: naming.host, record: (c) => recorded.push(c) });
    const file = path.join(folder, '.claude', 'wheelhouse.json');
    assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')).gitlabHosts, ['git.example.org:8443']);
    assert.equal(recorded.length, 1);
    assert.equal(recorded[0].kind, 'file');
    nameGitlabHost({ folder, entry: naming.host, record: (c) => recorded.push(c) });
    assert.equal(recorded.length, 1, 'named already: nothing more is written');
    assert.equal(productOf(folder, { config: JSON.parse(fs.readFileSync(file, 'utf8')) }).isNew, true);
  });
});

test('GitLab chosen with gitlab.com picked plans the public service, with no settings change', async () => {
  await withHome(async () => {
    const w = standIn();
    const folder = productFolder('shop');
    const planned = await answerAll(stepFor(w), ctxFor(folder), choose({ host: HOST_LABELS.gitlab }));
    assert.ok(planned.asked.some((a) => a.id === 'gitlab-where'));
    assert.equal(planned.changes.find((c) => c.action === 'connection').base, undefined);
    assert.equal(planned.changes.some((c) => c.action === 'gitlab-hosts'), false);
  });
});

test('a typed GitLab address that is not one asks again under a new id, saying why', async () => {
  await withHome(async () => {
    const w = standIn();
    const folder = productFolder('shop');
    const texts = ['gitlab', 'http://git.example.org', 'https://git.example.org/gr$oup/x'];
    const planned = await answerAll(stepFor(w), ctxFor(folder), (id, card) => {
      if (id.startsWith('gitlab-where')) return { text: texts.length > 0 ? texts.shift() : 'git.example.org' };
      return choose({ host: HOST_LABELS.gitlab })(id, card);
    });
    const again = planned.asked.filter((a) => a.id.startsWith('gitlab-where'));
    assert.deepEqual(again.map((a) => a.id), ['gitlab-where', 'gitlab-where-1', 'gitlab-where-2', 'gitlab-where-3']);
    assert.match(again[1].card.what, /"gitlab" is not a GitLab address/);
    assert.match(again[2].card.what, /not https/);
    assert.match(again[3].card.what, /no path/);
    assert.equal(planned.changes.find((c) => c.action === 'connection').base, 'https://git.example.org');
  });
  // Clicking the company button with nothing typed asks for the address.
  await withHome(async () => {
    const folder = productFolder('shop');
    const answers = { '3.real-users': said(REAL_USERS.no), '3.host': said(HOST_LABELS.gitlab), '3.gitlab-where': said(COMPANY_GITLAB) };
    const got = await stepFor(standIn()).plan(ctxFor(folder, { answers }));
    assert.equal(got.ask.id, 'gitlab-address-1');
    assert.match(got.ask.card.what, /What is your company's GitLab address, such as https:\/\/gitlab\.example\.org\? Type it as your answer/);
    composeCard({ ...got.ask.card, kind: 'question', suggest: false });
    // An address typed there is taken directly; a bad one asks again, saying why; Go back returns to the first card.
    const typed = (text) => ({ label: null, text, at: NOW.toISOString() });
    const next = await stepFor(standIn()).plan(ctxFor(folder, { answers: { ...answers, '3.gitlab-address-1': typed('git.example.org/x$') } }));
    assert.equal(next.ask.id, 'gitlab-address-2');
    assert.match(next.ask.card.what, /no path/);
    const back = await stepFor(standIn()).plan(ctxFor(folder, { answers: { ...answers, '3.gitlab-address-1': said('Go back') } }));
    assert.equal(back.ask.id, 'gitlab-where-2');
    const planned = await answerAll(stepFor(standIn()), ctxFor(folder), (id, card) => (id === 'gitlab-where' ? COMPANY_GITLAB : id.startsWith('gitlab-address') ? { text: 'https://git.example.org' } : choose({ host: HOST_LABELS.gitlab })(id, card)));
    assert.equal(planned.changes.find((c) => c.action === 'connection').base, 'https://git.example.org');
  });
});

test('a remote at a host that is not GitHub or the public GitLab is offered on the which-GitLab card, recommended, and chosen it is that company address', async () => {
  await withHome(async () => {
    const w = standIn({ signedIn: { github: true, gitlab: false } });
    const folder = productFolder('shop');
    await g(folder, 'init', '-q', '-b', 'main');
    await g(folder, 'add', 'notes.txt');
    await g(folder, 'commit', '-q', '-m', 'Begin');
    await withOrigin(folder, `https://git.example.org:8443/${USER}/shop.git`);
    const planned = await answerAll(stepFor(w), ctxFor(folder), (id, card) => (id === 'kept' ? PUT_ON_GITLAB : id === 'gitlab-where' ? 'git.example.org:8443' : choose()(id, card)));
    const asked = planned.asked.find((a) => a.id === 'gitlab-where');
    assert.deepEqual(asked.card.options.map((o) => o.label), ['git.example.org:8443', GITLAB_COM, COMPANY_GITLAB]);
    assert.match(asked.card.options[0].description ?? asked.card.options[0].says, /already sends its work/);
    assert.equal(asked.card.recommend ?? asked.card.options.find((o) => o.recommended)?.label, 'git.example.org:8443');
    composeCard({ ...asked.card, kind: 'question', suggest: false });
    assert.equal(planned.changes.find((c) => c.action === 'connection').base, 'https://git.example.org:8443');
    assert.equal(planned.changes.find((c) => c.action === 'gitlab-hosts').host, 'git.example.org:8443');
  });
});

test('companyAddress takes https and a host with an optional port, and nothing else', () => {
  assert.deepEqual(companyAddress('https://Git.Example.org'), { base: 'https://git.example.org', host: 'git.example.org' });
  assert.deepEqual(companyAddress('git.example.org:8443'), { base: 'https://git.example.org:8443', host: 'git.example.org:8443' });
  assert.deepEqual(companyAddress('localhost:8929'), { base: 'https://localhost:8929', host: 'localhost:8929' });
  assert.deepEqual(companyAddress('gitlab.com'), { base: 'https://gitlab.com' });
  for (const bad of ['', 'gitlab', 'http://git.example.org', 'https://git.example.org/a$b', 'git.example.org:99999', 'git example.org', 'user@git.example.org']) {
    assert.equal(typeof companyAddress(bad).why, 'string', bad);
  }
});

test('a group page address is trimmed to its host, and words that are not an address are not quoted back', () => {
  assert.deepEqual(companyAddress('https://git.example.org/group'), { base: 'https://git.example.org', host: 'git.example.org' });
  assert.deepEqual(companyAddress('git.example.org:8443/group'), { base: 'https://git.example.org:8443', host: 'git.example.org:8443' });
  assert.equal(companyAddress('Type something.').why.includes('Type something'), false);
  assert.ok(companyAddress('nothere').why.includes('"nothere"'));
});

test('connection cards name only their own host in Quick, and keep Windows capitalised', () => {
  const win = connectionCard({ host: 'gitlab', where: 'x on GitLab', platform: 'win32' });
  const quick = win.options.find((o) => o.label === WAYS.quick).says;
  assert.ok(quick.includes('full GitLab access') && !quick.includes('GitHub'));
  assert.ok(connectionCard({ host: 'github', where: 'x on GitHub', platform: 'win32' }).options.find((o) => o.label === WAYS.quick).says.includes('full GitHub access'));
  assert.ok(!win.because.includes('Windows'), 'Narrow\'s reason is the same on every computer');
});

test('the kept card\'s Put it on GitLab also asks which GitLab', async () => {
  await withHome(async () => {
    const w = standIn();
    const folder = productFolder('shop');
    await g(folder, 'init', '-q', '-b', 'main');
    await g(folder, 'add', 'notes.txt');
    await g(folder, 'commit', '-q', '-m', 'Begin');
    const planned = await answerAll(stepFor(w), ctxFor(folder), (id, card) => {
      if (id === 'kept') return PUT_ON_GITLAB;
      if (id === 'gitlab-where') return { text: 'git.example.org' };
      return choose()(id, card);
    });
    assert.equal(planned.changes.find((c) => c.action === 'connection').base, 'https://git.example.org');
    assert.equal(planned.changes.find((c) => c.action === 'gitlab-hosts').host, 'git.example.org');
  });
});

test('a project\'s full address typed as the company address is that host and that existing project, never a new one', async () => {
  assert.deepEqual(companyAddress('https://git.example.org/group/sub/shop.git'), { base: 'https://git.example.org', host: 'git.example.org', repo: 'group/sub/shop' });
  assert.equal(typeof companyAddress('https://git.example.org/group/').why, 'undefined');
  await withHome(async () => {
    const w = standIn({ signedIn: { github: true, gitlab: false } });
    const folder = productFolder('shop');
    const planned = await answerAll(stepFor(w), ctxFor(folder), (id, card) => (id === 'gitlab-where' ? { text: 'https://git.example.org/group/sub/shop' } : choose({ host: HOST_LABELS.gitlab })(id, card)));
    assert.equal(planned.changes.some((c) => c.action === 'repository'), false);
    assert.equal(planned.changes.find((c) => c.action === 'connection').base, 'https://git.example.org');
    assert.equal(planned.changes.find((c) => c.action === 'project').repo, 'group/sub/shop');
    assert.equal(planned.changes.find((c) => c.action === 'gitlab-hosts').host, 'git.example.org');
  });
});

test('the chosen company host being the folder\'s own remote\'s host plans that remote\'s existing project, with no repository made', async () => {
  await withHome(async () => {
    const w = standIn({ signedIn: { github: true, gitlab: false } });
    const folder = productFolder('shop');
    await g(folder, 'init', '-q', '-b', 'main');
    await g(folder, 'add', 'notes.txt');
    await g(folder, 'commit', '-q', '-m', 'Begin');
    await withOrigin(folder, 'https://git.example.org/group/sub/shop.git');
    const planned = await answerAll(stepFor(w), ctxFor(folder), (id, card) => (id === 'kept' ? PUT_ON_GITLAB : id === 'gitlab-where' ? 'git.example.org' : choose()(id, card)));
    assert.equal(planned.changes.some((c) => c.action === 'repository'), false);
    assert.equal(planned.changes.find((c) => c.action === 'project').repo, 'group/sub/shop');
    assert.equal(planned.changes.find((c) => c.action === 'connection').base, 'https://git.example.org');
  });
});

// ---- "Use my git as it is": what step 3 finds, what it asks, what it keeps (design sections 4, 6 and 12) ----

const GIT_KEY = 'stand-in-GITKEY0001';
const PUSH_KEY = 'stand-in-PUSHONLY0001';
const FRESH_KEY = 'stand-in-PASTEDKEY0003';

// The system's curl, answering GET /user from a table of what each key is.
function asIsCurl(keys) {
  return makeRoutedCurl(({ url, headers }) => {
    const auth = headers.find((h) => /^(?:authorization|private-token):/i.test(h)) ?? '';
    const key = auth.replace(/^[^:]+:\s*(?:Bearer\s+)?/i, '');
    if (!/\/api\/v4\/user$/.test(url)) return { status: 404, body: {} };
    const known = keys[key];
    if (known === undefined) return { status: 401, body: { message: '401 Unauthorized' } };
    return known === 'push-only' ? { status: 403, body: { message: '403 Forbidden' } } : { status: 200, body: { username: known } };
  });
}
const asIsVia = (curl) => ({ run: curl.run, curl: '/usr/bin/curl', proxy: null, caFile: null, platform: 'darwin' });

// The key the director's own sign-in store holds for the host, and what is stored when the key card replaces it.
function holdsKey(first) {
  const state = { current: first, stored: [] };
  const was = [directorKey.borrow, directorKey.store];
  directorKey.borrow = async () => state.current;
  directorKey.store = async (entry) => { state.stored.push(entry); state.current = { username: entry.username, key: entry.key }; };
  state.restore = () => { [directorKey.borrow, directorKey.store] = was; };
  return state;
}

const gitlabProject = async (w) => {
  await w.add(`${USER}/shop`);
  const folder = productFolder('shop');
  await withOrigin(folder, `https://gitlab.com/${USER}/shop.git`);
  return folder;
};

test('where the key the director\'s store holds passes GET /user, "Use my git as it is" is the default, nothing is asked, and the record keeps the web API as its backend', async () => {
  await withHome(async () => {
    const w = standIn({ signedIn: { gitlab: false }, blockedTool: true });
    const folder = await gitlabProject(w);
    const curl = asIsCurl({ [GIT_KEY]: USER });
    const held = holdsKey({ username: 'oauth2', key: GIT_KEY });
    try {
      const step = stepFor(w, { via: asIsVia(curl), askSecret: async () => { throw new Error('no box should open'); } });
      const planned = await answerAll(step, ctxFor(folder), choose({ way: WAYS.asIs }));
      const card = planned.asked.at(-1).card;
      assert.deepEqual(card.options.map((o) => o.label), [WAYS.asIs, STRICTER], 'it takes Quick\'s place');
      assert.equal(card.recommend, WAYS.asIs);
      assert.ok(!planned.changes.some((c) => c.action === 'sign-in' || c.action === 'key-card'), 'nothing is asked');
      assert.deepEqual(planned.changes.find((c) => c.action === 'connection'), { kind: 'host', target: 'gitlab', action: 'connection', mode: 'as-is', locked: false, backend: 'rest' });
      assert.match(planned.card.what, /your own git as it is/);
      assert.match(planned.card.what, /Wheelhouse pushes with your own git as it is, and uses its key for merge requests\./);
      assert.match(planned.card.what, /That key reaches everything your account can on GitLab\./);
      assert.doesNotMatch(JSON.stringify(planned.card), /\bREST\b|\bcurl\b/i);
      assert.equal(planned.director, 'One click');
      const { lines } = await applyStep(step, folder, planned.changes, { answers: planned.answers });
      assert.deepEqual(readProject(slugFor(`${USER}/shop`)).connection, { host: 'gitlab', mode: 'as-is', project: `${USER}/shop`, baseUrl: 'https://gitlab.com', backend: 'rest' });
      assert.deepEqual(held.stored, [], 'the director\'s key is not stored again');
      assert.ok(lines.some((l) => /your own git as it is/.test(l)), lines.join('\n'));
      // The settings a push trusts were recorded once the director had seen the card that names them, for the project's mirror, the
      // folder a push runs in, which setup made for it.
      const mirror = path.join(stateDir(slugFor(`${USER}/shop`)), '..', 'mirror.git');
      assert.ok(fs.existsSync(path.join(mirror, 'HEAD')), 'the mirror is there');
      const kept = JSON.parse(fs.readFileSync(path.join(wheelhouseHome(), 'host', 'git-settings.json'), 'utf8'));
      assert.deepEqual(Object.keys(kept.folders), [fs.realpathSync(mirror)]);
    } finally {
      held.restore();
    }
  });
});

test('a key that can only push brings the key card: the new key is stored with approve, replacing that one entry', async () => {
  await withHome(async () => {
    const w = standIn({ signedIn: { gitlab: false }, blockedTool: true });
    const folder = await gitlabProject(w);
    const curl = asIsCurl({ [PUSH_KEY]: 'push-only', [FRESH_KEY]: USER });
    const held = holdsKey({ username: 'oauth2', key: PUSH_KEY });
    try {
      const opened = [];
      const box = [];
      const step = stepFor(w, { via: asIsVia(curl), open: async (url) => { opened.push(url); }, askSecret: async (ask) => { box.push(ask); return `${FRESH_KEY}\n`; } });
      const planned = await answerAll(step, ctxFor(folder), choose({ way: WAYS.asIs }));
      assert.deepEqual(planned.changes.find((c) => c.action === 'key-card'), { kind: 'host', target: 'gitlab', action: 'key-card', state: 'push-only' });
      assert.match(planned.card.what, /a new one, which replaces the one your git holds/);
      assert.match(planned.director, /pasted into your computer's box/);
      assert.doesNotMatch(JSON.stringify(planned.card), /\bREST\b|\bcurl\b/i);
      const { lines, run } = await applyStep(step, folder, planned.changes, { answers: planned.answers });
      const page = new URL(opened[0]);
      assert.equal(page.pathname, '/-/user_settings/personal_access_tokens');
      assert.equal(page.searchParams.get('scopes'), 'api,write_repository');
      assert.equal(box.length, 1);
      assert.deepEqual(held.stored, [{ host: 'gitlab.com', base: 'https://gitlab.com', repoPath: `${USER}/shop`, username: 'oauth2', key: FRESH_KEY }], 'only the director\'s own entry for the host, under its own user name');
      assert.ok(lines.includes('This replaces the key your git uses for gitlab.com with the new one, so your pushes keep working.'), lines.join('\n'));
      assert.ok(!lines.join('\n').includes(FRESH_KEY), 'the key is never said');
      assert.ok(!JSON.stringify(run).includes(FRESH_KEY), 'nor kept in the journal');
      assert.equal(readProject(slugFor(`${USER}/shop`)).connection.mode, 'as-is');
    } finally {
      held.restore();
    }
  });
});

test('a key the host refuses (a 401) or none at all, with the tool blocked, brings the same card; a key the host will not accept stops the step', async () => {
  await withHome(async () => {
    for (const [first, state] of [[{ username: 'oauth2', key: 'stand-in-EXPIRED' }, 'refused'], [null, 'none']]) {
      const w = standIn({ signedIn: { gitlab: false }, blockedTool: true });
      const folder = await gitlabProject(w);
      const curl = asIsCurl({ [FRESH_KEY]: USER });
      const held = holdsKey(first);
      try {
        const step = stepFor(w, { via: asIsVia(curl), askSecret: async () => FRESH_KEY });
        const planned = await answerAll(step, ctxFor(folder), choose({ way: WAYS.asIs }));
        assert.equal(planned.changes.find((c) => c.action === 'key-card')?.state, state);
        await applyStep(step, folder, planned.changes, { answers: planned.answers });
        assert.equal(held.stored[0].key, FRESH_KEY);
        assert.equal(held.stored[0].username, first?.username ?? USER, 'the entry git held, else the host\'s own user name');
      } finally {
        held.restore();
      }
    }
    const w = standIn({ signedIn: { gitlab: false }, blockedTool: true });
    const folder = await gitlabProject(w);
    const held = holdsKey(null);
    try {
      const step = stepFor(w, { via: asIsVia(asIsCurl({})), askSecret: async () => 'stand-in-NOT-ACCEPTED' });
      const planned = await answerAll(step, ctxFor(folder), choose({ way: WAYS.asIs }));
      await assert.rejects(applyStep(step, folder, planned.changes, { answers: planned.answers }), /did not accept the key/);
      assert.deepEqual(held.stored, [], 'nothing was stored');
    } finally {
      held.restore();
    }
  });
});

test('a tool that starts and is signed in carries the project on its own backend; an SSH remote that works is enough to offer the director\'s own git', async () => {
  await withHome(async () => {
    const w = standIn({ signedIn: { gitlab: true } });
    w.lsRemote = () => ({ code: 0, stdout: 'abc\tHEAD\n', stderr: '' });
    await w.add(`${USER}/shop`);
    const folder = productFolder('shop');
    await withOrigin(folder, `git@gitlab.com:${USER}/shop.git`);
    const held = holdsKey(null);
    try {
      const step = stepFor(w, { askSecret: async () => { throw new Error('no box should open'); } });
      const planned = await answerAll(step, ctxFor(folder), choose({ way: WAYS.asIs }));
      assert.deepEqual(planned.asked.at(-1).card.options.map((o) => o.label), [WAYS.asIs, STRICTER]);
      assert.equal(planned.changes.find((c) => c.action === 'connection').backend, 'cli');
      assert.ok(!planned.changes.some((c) => c.action === 'key-card'));
      assert.doesNotMatch(planned.card.what, /web API/);
      assert.match(planned.card.what, /GitLab's own tool, signed in already/);
    } finally {
      held.restore();
    }
  });
});

test('with a tool signed in and no key held, Quick stays on the card and "Use my git as it is" is not offered', async () => {
  await withHome(async () => {
    const w = standIn({ signedIn: { gitlab: true } });
    const folder = await gitlabProject(w);
    const held = holdsKey(null);
    try {
      const planned = await answerAll(stepFor(w), ctxFor(folder), choose());
      assert.deepEqual(planned.asked.at(-1).card.options.map((o) => o.label), [WAYS.quick, STRICTER]);
      assert.equal(planned.changes.find((c) => c.action === 'connection').backend, 'cli');
    } finally {
      held.restore();
    }
  });
});

test('a Locked or launched project is never offered the director\'s own git, only the narrow key', () => {
  for (const host of ['github', 'gitlab']) {
    for (const extra of [{ locked: true }, { launched: true }]) {
      const card = connectionCard({ host, platform: 'win32', asIs: true, appFile: APP_FILE, ...extra });
      assert.ok(!card.options.some((o) => o.label === WAYS.asIs || o.label === WAYS.quick), JSON.stringify(card.options.map((o) => o.label)));
    }
  }
  const mac = connectionCard({ host: 'gitlab', platform: 'darwin', asIs: true });
  assert.deepEqual(mac.options.map((o) => o.label), [WAYS.asIs, STRICTER]);
  const windows = connectionCard({ host: 'gitlab', platform: 'win32', asIs: true });
  assert.equal(windows.options[0].label, WAYS.asIs);
  assert.equal(windows.recommend, WAYS.asIs);
  // Recommended, its cost on Windows is said once, in the option, and the reason does not repeat it.
  assert.match(windows.options[0].says, /On Windows any agent's command could ask git for that key/);
  assert.doesNotMatch(windows.because, /Windows/);
  const launched = connectionCard({ host: 'gitlab', platform: 'win32', asIs: true, realUsers: true });
  assert.match(launched.options.find((o) => o.label === WAYS.asIs).says, /On Windows any agent's command could ask git for that key/);
  assert.equal(launched.recommend, WAYS.narrow, 'real users keep the narrow key recommended');
  assert.equal(launched.options[0].label, WAYS.narrow, 'the recommended way comes first');
});

test('a computer with no tool that starts and no curl is told so, as a wait; a proxy password in git\'s settings is told too, and never repeated', async () => {
  await withHome(async () => {
    const w = standIn({ signedIn: { gitlab: false }, blockedTool: true });
    const folder = await gitlabProject(w);
    const held = holdsKey(null);
    try {
      const noCurl = await stepFor(w).plan({ ...ctxFor(folder, { platform: 'win32' }), answers: { '3.real-users': said(REAL_USERS.no) } });
      assert.equal(noCurl.why, 'This computer has no curl Wheelhouse can use, so it can only reach GitLab through GitLab\'s own tool. Ask IT for either.');
      w.directorConfig = (args) => (args[2] === 'http.proxy' ? { code: 0, stdout: 'http://dir:hunter2@proxy.example.org:8080\n', stderr: '' } : { code: 1, stdout: '', stderr: '' });
      const planned = await stepFor(w).plan({ ...ctxFor(folder), answers: { '3.real-users': said(REAL_USERS.no) } });
      assert.ok(planned.ask, 'the connection card is still asked first');
      const answers = { '3.real-users': said(REAL_USERS.no), [`3.${planned.ask.id}`]: said(WAYS.asIs) };
      const after = await stepFor(w, { via: asIsVia(asIsCurl({})) }).plan({ ...ctxFor(folder), answers });
      assert.match(after.why, /Your git settings keep your proxy password in plain text/);
      assert.ok(!JSON.stringify(after).includes('hunter2'));
    } finally {
      held.restore();
    }
  });
});

test('a narrow GitHub connection to a repository that exists signs the tool in with a key for that repository only, and the record says so for step 7', async () => {
  await withHome(async () => {
    const TOKEN = 'github_pat_stand_in_for_the_box_0002';
    const w = standIn({ signedIn: { github: false } });
    await w.add(`${USER}/shop`);
    const folder = productFolder('shop');
    await withOrigin(folder, `https://github.com/${USER}/shop.git`);
    const gh = github({ reach: [`${USER}/shop`] });
    const opened = [];
    const step = stepFor(w, { appFile: appFile(tempFolder('wh-app-')), fetch: gh.fetch, open: async (url) => { opened.push(url); }, askSecret: async () => `${TOKEN}\n` });
    const planned = await answerAll(step, ctxFor(folder), choose({ realUsers: REAL_USERS.yes, locked: LEVELS.standard, way: WAYS.wheelhouse }));
    assert.deepEqual(planned.changes.find((c) => c.action === 'sign-in'), { kind: 'host', target: 'github', action: 'sign-in', via: 'narrow-key' });
    assert.match(planned.card.what, /sign in to GitHub with a key for this project only/);
    assert.match(planned.director, /a key made on GitHub's page and pasted into your computer's box/);
    assert.doesNotMatch(JSON.stringify(planned.card), /\bREST\b|\bcurl\b/i);
    const { lines, run } = await applyStep(step, folder, planned.changes, { answers: planned.answers });
    assert.ok(w.calls.some((c) => c.args[0] === 'auth' && c.args[1] === 'login' && c.args.includes('--with-token')), 'gh is signed in with the key, on standard input');
    assert.ok(!w.calls.some((c) => c.args.includes('--web')), 'not through the browser');
    const page = new URL(opened[0]);
    assert.equal(page.pathname, '/settings/personal-access-tokens/new');
    assert.equal(page.searchParams.get('administration'), null, 'no Administration in the kept key');
    assert.equal(readProject(slugFor(`${USER}/shop`)).connection.directorSignIn, 'narrow-key');
    assert.ok(!(lines.join('\n') + JSON.stringify(run)).includes(TOKEN));
  });
});

test('a narrow GitHub connection for a new product, or one signed in already, keeps the browser sign-in and no mark in the record', async () => {
  await withHome(async () => {
    const w = standIn({ signedIn: { github: true } });
    await w.add(`${USER}/shop`);
    const folder = productFolder('shop');
    await withOrigin(folder, `https://github.com/${USER}/shop.git`);
    const gh = github({ reach: [`${USER}/shop`] });
    const step = stepFor(w, { appFile: appFile(tempFolder('wh-app-')), fetch: gh.fetch, askSecret: async () => { throw new Error('no box should open'); } });
    const planned = await answerAll(step, ctxFor(folder), choose({ realUsers: REAL_USERS.yes, locked: LEVELS.standard, way: WAYS.wheelhouse }));
    await applyStep(step, folder, planned.changes, { answers: planned.answers });
    assert.equal(readProject(slugFor(`${USER}/shop`)).connection.directorSignIn, undefined);
    const fresh = standIn({ signedIn: { github: false } });
    const empty = productFolder('Fresh');
    const newPlan = await answerAll(stepFor(fresh, { appFile: appFile(tempFolder('wh-app-')), fetch: gh.fetch }), ctxFor(empty), choose({ realUsers: REAL_USERS.yes, locked: LEVELS.standard, way: WAYS.wheelhouse }));
    assert.equal(newPlan.changes.find((c) => c.action === 'sign-in')?.via, undefined, 'a repository still to be made needs the account, so the browser');
  });
});

// ---- Narrow on GitLab without its tool: the one-day setup token (paths b, b' and c) ----

const SETUP_TOKEN = 'glpat-one-day-setup-token-0001';

// The system's curl in front of a stand-in GitLab with the setup token's account: GET /user answers for SETUP_TOKEN
// only, and the project's protected branches and settings are kept here; projects and project keys are the stand-in's
// (`w.api`). The token itself is `self` (api alone, ending tomorrow), or not known where `self` is null; revoking it
// is kept in `revoked`, and GitLab answers it with `revokeStatus`. Each call is recorded with its arguments, its config
// and its environment, so a test can look for the token.
function setupTokenCurl(w, { userStatus = 200, self = { scopes: ['api'], expires_at: '2026-10-21' }, selfStatus = 200, revokeStatus = 204 } = {}) {
  const calls = [];
  const revoked = [];
  const branches = {};
  const answerFor = async (call) => {
    const token = call.headers.find((h) => /^private-token:/i.test(h))?.replace(/^[^:]+:\s*/, '') ?? '';
    if (token !== SETUP_TOKEN && !/^glpat-project-key-/.test(token) && token !== PASTED) return { status: 401, body: { message: '401 Unauthorized' } };
    const p = call.url.replace(/^https:\/\/[^/]+\/api\/v4/, '');
    const body = call.body === undefined ? undefined : JSON.parse(call.body);
    if (p === '/personal_access_tokens/self' && token === SETUP_TOKEN) {
      if (call.method === 'DELETE') {
        if (revokeStatus !== 204) return { status: revokeStatus, body: null };
        revoked.push(token);
        return { status: 204, body: null };
      }
      if (selfStatus !== 200) return { status: selfStatus, body: null };
      return self === null ? { status: 404, body: { message: '404 Not Found' } } : { status: 200, body: self };
    }
    if (p === '/user') return userStatus === 200 ? { status: 200, body: { id: 7, username: USER, name: 'A Director', commit_email: 'director@example.com' } } : { status: userStatus, body: { message: 'no' } };
    const branch = /^\/projects\/([^/]+)\/protected_branches(?:\/(.+))?$/.exec(p);
    if (branch && call.method === 'GET') return branches[`${branch[1]}/${branch[2]}`] ? { status: 200, body: branches[`${branch[1]}/${branch[2]}`] } : { status: 404, body: null };
    if (branch && call.method === 'POST') {
      branches[`${branch[1]}/${body.name}`] = { name: body.name, push_access_levels: [{ access_level: body.push_access_level }], merge_access_levels: [{ access_level: body.merge_access_level }], allow_force_push: body.allow_force_push };
      return { status: 201, body: branches[`${branch[1]}/${body.name}`] };
    }
    if (/\/approval_rules$/.test(p)) return { status: 403, body: null };
    if (/\/(variables|pipelines)\?/.test(p)) return { status: 200, body: [] };
    if (call.method === 'PUT' && /^\/projects\/[^/]+$/.test(p)) return { status: 200, body: {} };
    if (call.method === 'GET') return w.api.get(p);
    if (call.method === 'POST') return w.api.post(p, body);
    return { status: 404, body: null };
  };
  const others = [];
  const run = async (file, args = [], options = {}) => {
    // Any other program (git, reading the director's settings) goes to the stand-in, recorded for the leak check.
    if (path.basename(file).replace(/\.exe$/, '') !== 'curl') {
      others.push({ file, args: [...args], env: options.env ?? null, input: options.input ?? null });
      return w.run(file, args, options);
    }
    const config = String(options.input ?? '');
    const pairs = parseConfig(config);
    const field = (name) => pairs.find(([key]) => key === name)?.[1];
    const call = {
      file, args: [...args], config, baseEnv: options.baseEnv ?? null, env: options.env ?? null,
      url: field('url'), method: field('request') ?? 'GET', headers: pairs.filter(([key]) => key === 'header').map(([, value]) => value), body: field('data-binary'),
    };
    calls.push(call);
    const answer = await answerFor(call);
    const format = args[args.indexOf('--write-out') + 1] ?? '';
    const tail = format.replace('%{http_code}', String(answer.status)).replace('%{http_connect}', '0').replace(/\\n/g, '\n');
    return { code: 0, stdout: `${answer.body === null || answer.body === undefined ? '' : JSON.stringify(answer.body)}${tail}`, stderr: '' };
  };
  return { run, calls, others, revoked };
}
const tokenVia = (curl) => ({ run: curl.run, curl: '/usr/bin/curl', proxy: null, caFile: null, platform: 'darwin' });

// Every place the token could leak to: a call's arguments or environment, and any file under the given folders.
function tokenOutside(curl, ...folders) {
  const where = [];
  for (const c of curl.calls) {
    if (c.args.some((a) => a.includes(SETUP_TOKEN))) where.push(`the arguments of ${c.url}`);
    if (JSON.stringify(c.baseEnv ?? {}).includes(SETUP_TOKEN) || JSON.stringify(c.env ?? {}).includes(SETUP_TOKEN)) where.push(`the environment of ${c.url}`);
  }
  for (const o of curl.others ?? []) if (JSON.stringify(o).includes(SETUP_TOKEN)) where.push(`${path.basename(o.file)} ${o.args.join(' ')}`);
  for (const c of hostLog) if (JSON.stringify(c).includes(SETUP_TOKEN)) where.push('a program setup ran');
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) walk(full);
      else if (e.isFile() && fs.readFileSync(full).includes(SETUP_TOKEN)) where.push(full);
    }
  };
  for (const f of folders) if (typeof f === 'string' && fs.existsSync(f)) walk(f);
  return where;
}

test('the setup token goes to curl only in the request header on standard input, never its arguments or environment, and is forgotten on request', async () => {
  const w = standIn();
  const curl = setupTokenCurl(w);
  const opened = [];
  const held = await setupTokenApi({ base: 'https://gitlab.example.com', via: tokenVia(curl), open: async (url) => { opened.push(url); }, askSecret: async () => `${SETUP_TOKEN}\n`, platform: 'darwin' });
  assert.equal(held.user, USER);
  assert.deepEqual(held.author, { name: 'A Director', email: 'director@example.com' });
  assert.equal(opened.length, 1);
  const page = new URL(opened[0]);
  assert.equal(page.origin, 'https://gitlab.example.com');
  assert.equal(page.searchParams.get('scopes'), 'api', 'the token page asks for api alone');
  assert.deepEqual(curl.calls.map((c) => [c.method, c.url]), [['GET', 'https://gitlab.example.com/api/v4/user'], ['GET', 'https://gitlab.example.com/api/v4/personal_access_tokens/self']]);
  const [call] = curl.calls;
  assert.ok(call.headers.includes(`PRIVATE-TOKEN: ${SETUP_TOKEN}`), 'the token is in the header');
  assert.deepEqual(tokenOutside(curl), []);
  assert.ok(!JSON.stringify(held).includes(SETUP_TOKEN), 'what the call gives back holds no token');
  held.forget();
  await assert.rejects(held.api.get('/user'), /forgotten the one-day GitLab token/);
  assert.equal(curl.calls.length, 2, 'nothing more reaches GitLab once forgotten');
  assert.equal(await held.end(), false, 'a forgotten token is not revoked again');
});

test('a setup token that can do more than api, or lasts longer than a day, is revoked and refused before anything is made; one GitLab can\'t describe is taken', async () => {
  const at = () => NOW;
  for (const [self, words] of [
    [{ scopes: ['api', 'sudo'], expires_at: '2026-10-21' }, /can do more than api, so setup made nothing with it and cancelled it/],
    [{ scopes: ['read_api'], expires_at: '2026-10-21' }, /can do more than api/],
    [{ scopes: ['api'], expires_at: '2026-11-19' }, /lasts longer than a day, so setup made nothing with it and cancelled it/],
    [{ scopes: ['api'], expires_at: null }, /lasts longer than a day/],
  ]) {
    const curl = setupTokenCurl(standIn(), { self });
    const got = await setupTokenApi({ base: 'https://gitlab.example.com', via: tokenVia(curl), open: async () => {}, askSecret: async () => SETUP_TOKEN, now: at }).catch((e) => e);
    assert.match(got.message, words, JSON.stringify(self));
    assert.deepEqual(curl.revoked, [SETUP_TOKEN], 'revoked');
    assert.ok(!curl.calls.some((c) => c.method !== 'GET' && !/personal_access_tokens\/self$/.test(c.url)), 'nothing made');
  }
  // Where GitLab does not take a refused token back, setup says to delete it, never that it was revoked.
  for (const self of [{ scopes: ['api', 'sudo'], expires_at: '2026-10-21' }, { scopes: ['api'], expires_at: '2026-11-19' }]) {
    const got = await setupTokenApi({ base: 'https://gitlab.example.com', via: tokenVia(setupTokenCurl(standIn(), { self, revokeStatus: 500 })), open: async () => {}, askSecret: async () => SETUP_TOKEN, now: at }).catch((e) => e);
    assert.match(got.message, /so setup made nothing with it, but could not cancel it, so delete it on GitLab's Access tokens page and make a new one/, JSON.stringify(self));
    assert.doesNotMatch(got.message, /and cancelled it/);
  }
  // Ending the day after tomorrow at the latest, for a director a day ahead: taken, and revoked at the end.
  const curl = setupTokenCurl(standIn(), { self: { scopes: ['api'], expires_at: '2026-10-22' } });
  const held = await setupTokenApi({ base: 'https://gitlab.example.com', via: tokenVia(curl), open: async () => {}, askSecret: async () => SETUP_TOKEN, now: at });
  assert.equal(await held.end(), true);
  assert.deepEqual(curl.revoked, [SETUP_TOKEN]);
  await assert.rejects(held.api.get('/user'), /forgotten the one-day GitLab token/);
  // An older GitLab with no such path: taken at the page's word.
  const old = await setupTokenApi({ base: 'https://gitlab.example.com', via: tokenVia(setupTokenCurl(standIn(), { self: null })), open: async () => {}, askSecret: async () => SETUP_TOKEN, now: at });
  assert.equal(old.user, USER);
});

test('a setup token GitLab took but could not describe or take back is named for the director to delete, the error left as it is', async () => {
  const said = [];
  const curl = setupTokenCurl(standIn(), { selfStatus: 500, revokeStatus: 500 });
  const got = await setupTokenApi({ base: 'https://gitlab.example.com', via: tokenVia(curl), say: (line) => said.push(line), open: async () => {}, askSecret: async () => SETUP_TOKEN, now: () => NOW }).catch((e) => e);
  assert.match(got.message, /^GitLab did not say what the token can do \(HTTP 500\), so nothing was made; a fresh Go ahead tries again$/);
  assert.ok(said.includes(SETUP_TOKEN_KEPT));
  assert.ok(!said.join('\n').includes(SETUP_TOKEN));
});

test('the setup token is refused for a base that is not https, before any page opens or box is shown', async () => {
  for (const base of ['http://gitlab.example.com', 'ftp://gitlab.example.com', 'gitlab.example.com']) {
    let asked = false;
    await assert.rejects(setupTokenApi({ base, via: tokenVia(setupTokenCurl(standIn())), open: async () => { asked = true; }, askSecret: async () => { asked = true; return SETUP_TOKEN; } }));
    assert.equal(asked, false, base);
  }
});

test('a setup token GitLab refuses, an empty box, a closed box and a stop each make nothing, and no message carries the token', async () => {
  for (const status of [401, 403]) {
    const curl = setupTokenCurl(standIn(), { userStatus: status });
    const got = await setupTokenApi({ base: 'https://gitlab.example.com', via: tokenVia(curl), open: async () => {}, askSecret: async () => SETUP_TOKEN }).catch((e) => e);
    assert.match(got.message, /GitLab did not accept the token, so nothing was made/);
    assert.ok(!got.message.includes(SETUP_TOKEN) && !String(got.stack).includes(SETUP_TOKEN));
    assert.equal(curl.calls.length, 1);
  }
  for (const askSecret of [async () => '', async () => '  \n', async () => 'two words', async () => { throw new Error('closed'); }]) {
    const curl = setupTokenCurl(standIn());
    await assert.rejects(setupTokenApi({ base: 'https://gitlab.example.com', via: tokenVia(curl), open: async () => {}, askSecret }), /No GitLab token was given, so nothing was made on GitLab/);
    assert.equal(curl.calls.length, 0);
  }
  // A stop as the token comes back: nothing reaches GitLab.
  const curl = setupTokenCurl(standIn());
  await assert.rejects(setupTokenApi({ base: 'https://gitlab.example.com', via: tokenVia(curl), open: async () => {}, askSecret: async () => SETUP_TOKEN, halt: () => { throw new Error(STOPPED); } }), (e) => e.message === STOPPED);
  assert.equal(curl.calls.length, 0);
  // curl failing with the token in its own words: the line thrown is curl.js's plain one.
  const loud = { run: async () => ({ code: 7, stdout: '', stderr: `curl: (7) Failed with PRIVATE-TOKEN: ${SETUP_TOKEN}` }), curl: '/usr/bin/curl', proxy: null, caFile: null, platform: 'darwin' };
  const failed = await setupTokenApi({ base: 'https://gitlab.example.com', via: loud, open: async () => {}, askSecret: async () => SETUP_TOKEN }).catch((e) => e);
  assert.ok(failed instanceof Error);
  assert.ok(!failed.message.includes(SETUP_TOKEN) && !String(failed.stack).includes(SETUP_TOKEN), failed.message);
});

// Step 3 on a GitLab project, Narrow chosen, GitLab's tool blocked and not signed in: the setup token route.
async function setupTokenRun(w, { curl, askSecret } = {}) {
  const folder = await gitlabProject(w);
  const step = stepFor(w, { via: tokenVia(curl), open: async () => {}, askSecret });
  const planned = await answerAll(step, ctxFor(folder), choose({ way: WAYS.narrow }));
  return { folder, step, planned };
}

test('Narrow on GitLab without its tool makes the project key and protects the main line with the setup token, then revokes it; the token is kept nowhere', async () => {
  await withHome(async (home) => {
    const w = standIn({ signedIn: { gitlab: false }, blockedTool: true });
    const curl = setupTokenCurl(w);
    const boxes = [];
    const { folder, step, planned } = await setupTokenRun(w, { curl, askSecret: async (box) => { boxes.push(box.title); return SETUP_TOKEN; } });
    assert.equal(planned.changes.find((c) => c.action === 'sign-in')?.via, 'setup-token');
    const { lines, run } = await applyStep(step, folder, planned.changes, { answers: planned.answers });
    assert.deepEqual(boxes, ['Wheelhouse: one-day GitLab token'], 'one box, for the setup token');
    const id = w.repos[`${USER}/shop`].id;
    assert.equal(readKey(`gitlab-project-${id}`).kind, 'project-key', 'the project key is in the store');
    assert.ok(curl.calls.some((c) => c.method === 'POST' && /\/protected_branches$/.test(c.url)), 'the main line is protected');
    assert.ok(lines.some((l) => /Setup has cancelled the one-day token/.test(l)), lines.join('\n'));
    assert.deepEqual(curl.revoked, [SETUP_TOKEN], 'revoked on GitLab once, at the end');
    const kept = readProject(slugFor(`${USER}/shop`));
    assert.equal(kept.connection.directorSignIn, 'setup-token');
    assert.ok(!JSON.stringify(kept).includes(SETUP_TOKEN));
    assert.ok(!JSON.stringify(run).includes(SETUP_TOKEN), 'the journal holds no token');
    assert.ok(!lines.join('\n').includes(SETUP_TOKEN));
    // Every call with the token is built from the recorded base, https only.
    const withToken = curl.calls.filter((c) => c.headers.includes(`PRIVATE-TOKEN: ${SETUP_TOKEN}`));
    assert.ok(withToken.length > 0 && withToken.every((c) => c.url.startsWith('https://gitlab.com/api/v4/')));
    assert.deepEqual(tokenOutside(curl, home, folder), []);
  });
});

test('where GitLab does not revoke the setup token, setup says it ends tomorrow only when GitLab said so, and otherwise to delete it', async () => {
  for (const [self, said] of [[undefined, /Setup has forgotten the one-day token; it ends by itself within two days/], [null, /Setup has forgotten the one-day token but could not cancel it: delete it on GitLab's Access tokens page/]]) {
    await withHome(async () => {
      const w = standIn({ signedIn: { gitlab: false }, blockedTool: true });
      const curl = setupTokenCurl(w, { self, revokeStatus: 500 });
      const { folder, step, planned } = await setupTokenRun(w, { curl, askSecret: async () => SETUP_TOKEN });
      const { lines } = await applyStep(step, folder, planned.changes, { answers: planned.answers });
      assert.ok(lines.some((l) => said.test(l)), lines.join('\n'));
      assert.deepEqual(curl.revoked, []);
    });
  }
});

test('where GitLab refuses a project key, the setup token route falls back to a token typed into the box; the setup token is still kept nowhere', async () => {
  await withHome(async (home) => {
    const w = standIn({ signedIn: { gitlab: false }, blockedTool: true, keyAnswer: 400, keyBody: { message: '400 Bad request - User does not have permission to create project access token' } });
    const curl = setupTokenCurl(w);
    const boxes = [];
    const { folder, step, planned } = await setupTokenRun(w, { curl, askSecret: async (box) => { boxes.push(box.title); return boxes.length === 1 ? SETUP_TOKEN : PASTED; } });
    await applyStep(step, folder, planned.changes, { answers: planned.answers });
    assert.deepEqual(boxes, ['Wheelhouse: one-day GitLab token', 'Wheelhouse: GitLab token']);
    const kept = readKey(`gitlab-project-${w.repos[`${USER}/shop`].id}`);
    assert.equal(kept.kind, 'pasted-token');
    assert.equal(kept.token, PASTED, 'the typed token is kept, never the setup token');
    assert.deepEqual(tokenOutside(curl, home, folder), []);
  });
});

test('a stop part-way through the setup token route revokes and forgets the token: nothing after the stop reaches GitLab with it but its revoking, and it is kept nowhere', async () => {
  await withHome(async (home) => {
    const w = standIn({ signedIn: { gitlab: false }, blockedTool: true });
    const curl = setupTokenCurl(w);
    const { folder, step, planned } = await setupTokenRun(w, { curl, askSecret: async () => SETUP_TOKEN });
    let looks = 0;
    let stoppedAt = null;
    const stopped = () => {
      looks += 1;
      if (looks > 3 && stoppedAt === null) stoppedAt = curl.calls.length;
      return looks > 3;
    };
    await assert.rejects(applyStep(step, folder, planned.changes, { answers: planned.answers, stopped }), /All stop came on/);
    assert.ok(stoppedAt !== null, 'the stop came on during the step');
    const after = curl.calls.slice(stoppedAt).filter((c) => c.headers.includes(`PRIVATE-TOKEN: ${SETUP_TOKEN}`));
    assert.deepEqual(after.map((c) => [c.method, c.url]), [['DELETE', 'https://gitlab.com/api/v4/personal_access_tokens/self']], 'after the stop, the token only revokes itself');
    assert.deepEqual(tokenOutside(curl, home, folder), []);
    // A fresh Go ahead asks for a new token: the one held was dropped.
    const boxes = [];
    const again = stepFor(w, { via: tokenVia(curl), open: async () => {}, askSecret: async () => { boxes.push(1); return SETUP_TOKEN; } });
    await applyStep(again, folder, planned.changes, { answers: planned.answers });
    assert.equal(boxes.length, 1);
  });
});

test('after step 3 on the setup token\'s route, what later steps reach GitLab with is the project\'s own key from this computer\'s store: no box, no sign-in, no setup token', async () => {
  await withHome(async (home) => {
    const w = standIn({ signedIn: { gitlab: false }, blockedTool: true });
    const curl = setupTokenCurl(w);
    const boxes = [];
    const { folder, step, planned } = await setupTokenRun(w, { curl, askSecret: async (box) => { boxes.push(box.title); return SETUP_TOKEN; } });
    await applyStep(step, folder, planned.changes, { answers: planned.answers });
    const kept = readProject(slugFor(`${USER}/shop`));
    assert.equal(madeWithSetupToken(kept), true);
    const key = readKey(`gitlab-project-${kept.connection.projectId}`).token;
    assert.ok(typeof key === 'string' && key !== '' && key !== SETUP_TOKEN);
    const after3 = curl.calls.length;
    // Step 7's API (keyGitlabApi) and git (keyGitEnv), and step 10's git and checks (trialGitEnv, trialAdapter).
    const api = await keyGitlabApi({ record: kept, via: tokenVia(curl) });
    assert.equal((await api.get(`/projects/${kept.connection.projectId}`)).status, 200);
    const basic = `AUTHORIZATION: basic ${Buffer.from(`oauth2:${key}`, 'utf8').toString('base64')}`;
    for (const env of [await keyGitEnv({ record: kept, platform: 'darwin' }), await trialGitEnv({ host: 'gitlab', gitPath: 'git', platform: 'darwin', base: kept.connection.baseUrl, record: kept })]) {
      const values = Object.entries(env).filter(([k]) => /^GIT_CONFIG_VALUE_\d+$/.test(k)).map(([, v]) => v);
      assert.ok(values.includes(basic), JSON.stringify(values));
      assert.ok(!JSON.stringify(env).includes(SETUP_TOKEN));
    }
    const adapter = trialAdapter({ host: kept.host, repo: kept.repo, base: kept.connection.baseUrl, folder, connection: kept.connection }, { run: curl.run, via: tokenVia(curl) });
    assert.equal(adapter.backend, 'rest', 'GitLab\'s web API, as the agents reach it without GitLab\'s tool');
    await adapter.defaultBranch();
    const later = curl.calls.slice(after3);
    assert.ok(later.length >= 2 && later.every((c) => c.headers.includes(`PRIVATE-TOKEN: ${key}`)), JSON.stringify(later.map((c) => c.headers)));
    assert.deepEqual(boxes, ['Wheelhouse: one-day GitLab token'], 'nothing new is asked for after step 3');
    assert.deepEqual(tokenOutside(curl, home, folder), []);
  });
});

test('step 3\'s Narrow card on GitLab says, for a project with real users, that the director presses Merge on GitLab, and only then', () => {
  const changes = [{ kind: 'host', target: 'gitlab', action: 'sign-in', via: 'setup-token' }];
  const product = { isNew: false, host: 'gitlab', repo: `${USER}/shop`, name: 'shop', base: 'https://gitlab.com' };
  const text = (realUsers) => {
    const card = cardFor({ host: 'gitlab', changes, product, owner: USER, user: USER, way: WAYS.narrow, app: null, signedIn: false, appKeys: null, base: 'https://gitlab.com', realUsers });
    return composeCard({ ...card, target: { step: 3, hash: planHash(changes) } }).question.question;
  };
  assert.match(text(true), /only you can merge on GitLab: when a change is ready, you press Merge there/i, text(true));
  assert.doesNotMatch(text(false), /press Merge/);
});

test('step 3\'s card on a narrow way says the browser sign-in reaches the whole account and stays, and on Windows that agents could read it', () => {
  const changes = [{ kind: 'host', target: 'github', action: 'sign-in' }];
  const product = { isNew: true, host: 'github', repo: null, name: 'shop' };
  const text = (way, platform) => {
    const card = cardFor({ host: 'github', changes, product, owner: USER, user: USER, way, app: null, signedIn: false, appKeys: null, platform });
    return composeCard({ ...card, target: { step: 3, hash: planHash(changes) } }).question.question;
  };
  assert.match(text(WAYS.own, 'win32'), /That sign-in reaches your whole account and stays here, where any agent's command could read it\./);
  assert.match(text(WAYS.wheelhouse, 'darwin'), /That sign-in reaches your whole account and stays here, out of agents' reach unless this is an iPhone or Mac app\./);
  assert.doesNotMatch(text(WAYS.quick, 'win32'), /That sign-in reaches/);
  assert.match(text(WAYS.own, 'linux'), /That sign-in reaches your whole account and stays here\./);
  const pasted = [{ kind: 'host', target: 'gitlab', action: 'sign-in', via: 'token' }];
  const company = { isNew: false, host: 'gitlab', repo: `${USER}/shop`, name: 'shop', base: 'https://gitlab.example.com' };
  const card = cardFor({ host: 'gitlab', changes: pasted, product: company, owner: USER, user: USER, way: WAYS.narrow, app: null, signedIn: false, appKeys: null, base: company.base, platform: 'win32' });
  assert.match(composeCard({ ...card, target: { step: 3, hash: planHash(pasted) } }).question.question, /That sign-in reaches your whole account and stays here, where any agent's command/);
});

test('a card asked again drops an earlier own-git recommendation once git holds no key', () => {
  const earlier = { options: [{ label: WAYS.asIs }, { label: WAYS.wheelhouse }, { label: WAYS.own }], recommend: WAYS.asIs, because: 'it uses what this computer already has' };
  const now = { options: [{ label: WAYS.asIs }, { label: WAYS.own }], recommend: WAYS.own, because: 'if it leaked, the rest of your account would stay out of reach' };
  Object.defineProperty(now, 'reasonFor', { value: (way) => (way === WAYS.asIs ? null : now.because) });
  const again = againCard(earlier, now, WAYS.wheelhouse);
  assert.equal(again.recommend, WAYS.own);
  assert.equal(again.because, now.because);
});

test('a pasted address that names no project says so even when its user and token are hidden; a dotted miss says to paste the address with https://', async () => {
  await withHome(async () => {
    const step = stepFor(standIn());
    const folder = emptyFolder();
    const run = startRun({ folder, now: () => NOW });
    const ctx = ctxFor(folder, { runId: run.id });
    // Item 5: the hint rests on the text as pasted, not on what is shown of it.
    const ask = (await step.plan({ ...ctx, answers: { '3.join': { label: null, text: 'https://oauth2:tok@gitlab.company.example/', at: NOW.toISOString() } } })).ask;
    assert.equal(ask.card.what.startsWith('"gitlab.company.example/" is not a repository\'s name. That is the address of the host itself, not of a project: paste the address of the project\'s page, or type owner/name, like ann/cafe-menu, or click a button. '), true, ask.card.what);
    assert.equal(/tok@|oauth2/.test(ask.card.what), false);
    // Items 2 and 6: after a miss on a dotted first part, on GitLab, the card says groups and how to paste an address.
    const other = startRun({ folder: emptyFolder(), now: () => NOW });
    addChanges(other.id, [{ id: 'chg-1', kind: 'answer', target: 'step 3', before: null, after: { joined: 'gitlab.mycorp.internal', missed: 'none', host: 'gitlab' }, step: 3 }]);
    const again = (await step.plan(ctxFor(folder, { runId: other.id }))).ask;
    assert.match(again.card.what, /on your account or groups\. If that is an address, paste it with https:\/\/ at the front\. /);
    assert.match(again.card.options.at(-1).says, /in your account, organisations or groups, set up/);
    assert.match(joinMissLine({ host: 'gitlab', wanted: 'gitlab.mycorp.internal', found: [] }), /which asks again. If that is an address, paste it with https:\/\/ at the front\.$/);
    assert.doesNotMatch(joinMissLine({ host: 'gitlab', wanted: 'team/app', found: [] }), /paste it with https/);
  });
});

test('a look at the choices asks the computer for no key for a pasted company host, and a pasted host the reader refuses is no host', async () => {
  await withHome(async () => {
    const w = standIn();
    const step = stepFor(w);
    const folder = emptyFolder();
    const run = startRun({ folder, now: () => NOW });
    const ctx = ctxFor(folder, { runId: run.id });
    const borrowed = [];
    const original = directorKey.borrow;
    directorKey.borrow = async (args) => { borrowed.push(args); return null; };
    try {
      await answerJoin(step, { ...ctx, choicesOnly: true }, (id, card) => (id === 'join' ? 'https://gitlab.company.example/ann/Cafe-Menu' : choose()(id, card))).catch(() => {});
      assert.deepEqual(borrowed.filter((b) => String(b.host).includes('gitlab.company.example')), []);
    } finally {
      directorKey.borrow = original;
    }
    // One reader: what pinOf refuses, the plan never names (underscore and trailing-dot hosts, www.gitlab.com is public).
    for (const bad of ['https://git_lab.example.com/ann/x', 'https://db.internal./ann/x']) assert.equal(pinOf(bad)?.host, undefined, bad);
    assert.deepEqual(pinOf('https://www.gitlab.com/ann/x'), { host: 'gitlab', company: { base: 'https://gitlab.com' } });
  });
});

test('after a pasted address missed, GitLab on the same host under the name the miss holds in the director\'s own account is refused before the plan, and not otherwise', async () => {
  await withHome(async () => {
    const step = stepFor(standIn());
    const at = 'gitlab.company.example';
    const missRun = (owner) => {
      const folder = emptyFolder();
      const run = startRun({ folder, now: () => NOW });
      addChanges(run.id, [{ id: 'chg-1', kind: 'answer', target: 'step 3', before: null, after: { joined: `${owner}/Cafe-Menu`, missed: 'none', host: 'gitlab', user: USER, address: true, at }, step: 3 }]);
      return { folder, run };
    };
    const typed = (text) => ({ label: null, text, at: NOW.toISOString() });
    // The director's own account: GitLab is chosen, then the same company address is typed, so the question asks again at once.
    const own = missRun(USER);
    const first = (await step.plan(ctxFor(own.folder, { runId: own.run.id }))).ask;
    assert.match(first.id, /^join-[0-9a-f]{10}$/);
    assert.match(first.card.what, /^Setup couldn't find Wheelhouse's settings in a-director\/Cafe-Menu on gitlab\.company\.example, or your sign-in can't reach it\.\nSetup only brings in a project that was set up with Wheelhouse on another computer\.\nWhere should Cafe-Menu be kept instead\?\nChoose a button for a new product, or paste another address\.\nIf Cafe-Menu is already on gitlab\.company\.example, a new product can't use that name there\. Rename this folder and start setup again from it\.$/);
    const chose = { [`3.${first.id}`]: { label: HOST_LABELS.gitlab, text: null, at: NOW.toISOString() } };
    const refused = (await step.plan(ctxFor(own.folder, { runId: own.run.id, answers: { ...chose, '3.gitlab-where': { label: COMPANY_GITLAB, text: null, at: NOW.toISOString() }, '3.gitlab-address-0': typed(`https://${at}`) } }))).ask;
    assert.match(refused.id, /^join-[0-9a-f]{10}$/);
    assert.notEqual(refused.id, first.id);
    assert.equal(refused.card.what, [
      'Cafe-Menu may already be on gitlab.company.example without Wheelhouse\'s settings, so setup won\'t make a new product there under that name.',
      `Choose Keep it on this computer or GitHub, or choose GitLab and then ${new URL(DEFAULT_GITLAB).hostname}, or rename this folder and start setup again from it.`,
      'Where should Cafe-Menu be kept?',
    ].join('\n'));
    // Another host's address, or a project in someone else's account, is not refused, and says nothing of the name.
    const elsewhere = (await step.plan(ctxFor(own.folder, { runId: own.run.id, answers: { ...chose, '3.gitlab-where': { label: COMPANY_GITLAB, text: null, at: NOW.toISOString() }, '3.gitlab-address-0': typed('https://gitlab.other.example') } }))).ask;
    assert.doesNotMatch(String(elsewhere.id), /^join-/);
    const theirs = missRun('someone-else');
    const ask = (await step.plan(ctxFor(theirs.folder, { runId: theirs.run.id }))).ask;
    assert.doesNotMatch(ask.card.what, /can't use that name/);
  });
});
