// probes/71-gitlab-self-managed/run.js
// Check 71 at Free: Wheelhouse's GitLab code against a self-managed GitLab Enterprise Edition
// that stands in for a company's own servers (the test instance of probes/lib/gitlab-ee.js, behind
// a throwaway certificate authority). It records what each step does.
//
//   node probes/71-gitlab-self-managed/run.js                 prints what it would make, run and undo
//   node probes/71-gitlab-self-managed/run.js --dry-run       the same (it never runs a tool)
//   node probes/71-gitlab-self-managed/run.js --yes [--steps 1,2,3]
//                                                             runs the steps against the running instance
//
// The instance must already be running (startGitlab, with makeTestPeople for wh-maintainer and
// wh-second); its folder is probes/71-gitlab-self-managed/state/ (git-ignored, mode 600). The probe
// never starts or removes the instance. It makes a group and a project of its own, and undoes them.
//
// Secrets are never in any process's arguments and never printed: a token reaches a child through
// its environment or standard input. Every line printed and every fixture written passes through
// ./scrub.js first; a fixture with anything token-shaped left is refused. Neither `-k`, nor
// NODE_TLS_REJECT_UNAUTHORIZED, nor GIT_SSL_NO_VERIFY, nor `sslVerify`, nor `skip_tls_verify` is
// used anywhere. The computer's keychains and keyring are not touched: glab signs in with
// `--insecure-storage` into a scratch config folder, Node.js with `--use-system-ca` runs only
// without the authority in any store.
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { run, withoutGitVars } from '../../scripts/lib/run.js';
import { makeProjectKey } from '../../scripts/host/gitlab-key.js';
import { readGitlabProtection, protectGitlabBranch } from '../../scripts/host/protection.js';
import { makeAdapter, detectHost } from '../../scripts/host/adapter.js';
import { apiFor, fetchTrusting, names, stateDir, waitForReadiness, DEFAULT_PORT } from '../lib/gitlab-ee.js';
import { scrubText, scrubFixture, tokenShaped } from './scrub.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
export const FIXTURE_DIR = path.join(ROOT, 'tests', 'fixtures', 'gitlab-ee', 'free');
const MINUTE = 60 * 1000;

export const GROUP_PATH = 'wh71-probe';
export const PROJECT_PATH = 'trial';
export const REPO = `${GROUP_PATH}/${PROJECT_PATH}`;
export const STATE_BRANCH = 'wheelhouse-state';
export const JOB_NAME = 'probe-job';
export const SECRET_NAME = 'PROBE_SECRET';
export const APP_NAME = 'wheelhouse-probe-glab';
export const TOKEN_SETTING = 'resource_access_token_creation_allowed';

export const STEPS = Object.freeze([
  { n: 1, slug: 'certificates', title: 'Certificates', does: 'calls the API from Node.js (with NODE_EXTRA_CA_CERTS, with --use-system-ca, and with neither), from glab (ca_cert) and from git (http.<url>.sslCAInfo), each also without the authority' },
  { n: 2, slug: 'sign-in', title: 'Sign-in', does: 'glab auth login --hostname with a token on standard input; the OAuth routes (--web, --device) without and with an application the root makes; where glab keeps the token' },
  { n: 3, slug: 'project-key', title: 'The project key', does: 'makes the project key as the maintainer; switches the group setting that disallows project access tokens off, tries again, and switches it back on' },
  { n: 4, slug: 'protection-and-pipelines', title: 'Protection and pipelines', does: 'protects main and the state branch with Wheelhouse\'s code and reads both back; posts a commit status with the project key against a merge request with no pipeline, and against one whose pipeline failed' },
  { n: 5, slug: 'protected-variables', title: 'Protected variables', does: 'a protected PROBE_SECRET; the merge request\'s pipeline and the default branch\'s pipeline each echo whether it is set (never its value)' },
  { n: 6, slug: 'merge-by-maintainers', title: 'Merge by Maintainers only', does: 'the bot\'s and a Developer\'s merge refused, the maintainer\'s accepted; a commit pushed by the bot after the maintainer looked, then merged by the maintainer' },
  { n: 7, slug: 'unreachable', title: 'Unreachable', does: 'docker stop on GitLab, the adapter\'s error text, docker start and wait for readiness (the runner is restarted too)' },
  { n: 8, slug: 'undo', title: 'Undo', does: 'revokes the project key, deletes the OAuth application, the project and the group, and the scratch folder; wh-maintainer and wh-second stay' },
]);

// What would be made, run and undone. Prints nothing else and starts nothing.
export function planText({ dir = HERE, port = DEFAULT_PORT } = {}) {
  const lines = [
    `Check 71 at Free against https://localhost:${port} (containers ${names(port).gitlab} and ${names(port).runner}, state in ${stateDir(dir)}).`,
    `It would make: the group ${GROUP_PATH} and the project ${REPO}, a project key, a protected variable ${SECRET_NAME}, an OAuth application ${APP_NAME}, branches and merge requests, and a scratch folder for glab and git.`,
    'It would run: node, glab, git, docker (exec for settings, stop and start for step 7).',
    '',
    ...STEPS.map((s) => `Step ${s.n}, ${s.title}: ${s.does}.`),
    '',
    'It would remove everything it made except wh-maintainer and wh-second, and leave the containers running.',
    'Nothing was run. Run again with --yes to do it.',
  ];
  return lines.join('\n');
}

// ---------------------------------------------------------------------------------------------
// Recording

// Bodies over this are kept as their top-level scalar fields only.
const BIG_BODY = 4000;
function shorten(body) {
  const text = JSON.stringify(body ?? null);
  if (text.length <= BIG_BODY || body === null || typeof body !== 'object' || Array.isArray(body)) return text.length <= BIG_BODY * 3 ? body : { kept: 'a list too long to keep', length: Array.isArray(body) ? body.length : undefined };
  const kept = {};
  for (const [name, value] of Object.entries(body)) {
    if (value === null || ['string', 'number', 'boolean'].includes(typeof value)) kept[name] = typeof value === 'string' && value.length > 200 ? `${value.slice(0, 200)}...` : value;
  }
  return { ...kept, otherFields: Object.keys(body).filter((name) => !(name in kept)) };
}

export function makeRecorder({ secrets = new Set(), home = os.homedir(), probe = HERE, fixtureDir = FIXTURE_DIR, log = (line) => console.log(line) } = {}) {
  const books = new Map();
  let step = 0;
  const clean = (text) => scrubText(text, { secrets: [...secrets], home, probe });
  const book = () => {
    if (!books.has(step)) books.set(step, { trials: [], exchanges: [], commands: [] });
    return books.get(step);
  };
  return {
    secrets,
    hold(secret) { if (typeof secret === 'string' && secret.length >= 6) secrets.add(secret); return secret; },
    clean,
    at(n) { step = n; },
    trial(what, result) {
      const said = clean(typeof result === 'string' ? result : JSON.stringify(result));
      log(`Step ${step} | ${clean(what)} | ${said}`);
      book().trials.push({ what: clean(what), result: said });
    },
    exchange(label, request, response) {
      book().exchanges.push({ label, request: { ...request, body: request.body === undefined ? undefined : shorten(request.body) }, response: { status: response.status, body: shorten(response.body) } });
    },
    command(label, command, outcome) {
      const output = clean(`${outcome.stdout ?? ''}${outcome.stderr ? `\n${outcome.stderr}` : ''}`).trim();
      book().commands.push({ label: clean(label), command: clean(command), exitCode: outcome.code, timedOut: outcome.timedOut === true ? true : undefined, output: output.length > 2500 ? `${output.slice(0, 2500)}...` : output });
    },
    // Writes one fixture per step, refusing any that still holds something token-shaped.
    save(stepInfo) {
      const taken = books.get(stepInfo.n);
      if (!taken) return null;
      const clear = scrubFixture({ step: stepInfo.n, title: stepInfo.title, ...taken });
      const text = `${JSON.stringify(clear, null, 2)}\n`;
      const left = tokenShaped(text);
      if (left.length > 0 || [...secrets].some((s) => s.length >= 6 && text.includes(s))) throw new Error(`Fixture for step ${stepInfo.n} still holds something token-shaped: not written`);
      fs.mkdirSync(fixtureDir, { recursive: true });
      const file = path.join(fixtureDir, `step-${stepInfo.n}-${stepInfo.slug}.json`);
      fs.writeFileSync(file, text);
      return file;
    },
    books,
  };
}

// ---------------------------------------------------------------------------------------------
// The context every step shares: who can call what, with every tool through `run`.

const sleepFor = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(check, { limitMs = 3 * MINUTE, intervalMs = 3000, sleep = sleepFor } = {}) {
  const began = Date.now();
  for (;;) {
    const got = await check();
    if (got) return got;
    if (Date.now() - began > limitMs) return null;
    await sleep(intervalMs);
  }
}
// Whether nothing on this computer is listening on `port` (glab's browser sign-in listens on 7171).
export function portFree(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', () => resolve(false));
    server.listen(port, () => server.close(() => resolve(true)));
  });
}
// Waits for a port to be given up (a program just stopped may hold it for a moment).
export async function portFreeSoon(port, { limitMs = 8000, intervalMs = 250 } = {}) {
  const began = Date.now();
  for (;;) {
    if (await portFree(port)) return true;
    if (Date.now() - began > limitMs) return false;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}
const OAUTH_PORT = 7171;
const readSecret = (file) => fs.readFileSync(file, 'utf8').trim();

export function makeContext({ dir = HERE, port = DEFAULT_PORT, io = {}, rec = makeRecorder({ probe: dir }) } = {}) {
  const state = stateDir(dir);
  const scratch = path.join(state, 'scratch');
  const baseUrl = `https://localhost:${port}`;
  const host = `localhost:${port}`;
  const caFile = path.join(state, 'tls', 'ca.pem');
  const tokenFiles = {
    root: path.join(state, 'root-token'),
    maintainer: path.join(state, 'people', 'maintainer.token'),
    second: path.join(state, 'people', 'second.token'),
  };
  const names_ = names(port);
  const runTool = io.run ?? run;
  const makeApi = io.apiFor ?? apiFor;
  const ctx = { patient: true, dir, port, state, scratch, baseUrl, host, caFile, tokenFiles, rec, group: null, project: null, key: null, names: names_, sleep: io.sleep ?? sleepFor, until };

  ctx.path = (...parts) => path.join(scratch, ...parts);
  // A token read from its file and held for scrubbing. The bot's is the project key.
  ctx.token = (role) => {
    if (role === 'bot') {
      if (!ctx.key) throw new Error('The project key has not been made');
      return ctx.key.token;
    }
    return rec.hold(readSecret(tokenFiles[role]));
  };
  // An API client for a role; every call is recorded as an exchange unless `quiet`.
  ctx.api = (role, { quiet = false } = {}) => {
    const real = role === 'bot'
      ? makeApi({ baseUrl, caFile, tokenFile: writeKeyFile(ctx) })
      : makeApi({ baseUrl, caFile, tokenFile: tokenFiles[role] });
    const send = (method) => async (apiPath, body) => {
      let answer;
      for (let attempt = 0; ; attempt += 1) {
        try {
          answer = await real[method.toLowerCase()](apiPath, body);
        } catch (error) {
          if (!ctx.patient || attempt >= 24) throw error;
          await ctx.sleep(5000);
          continue;
        }
        // GitLab's web process can be away for a minute on this small instance: that is not an answer.
        if (![502, 503, 504].includes(answer.status) || !ctx.patient || attempt >= 24) break;
        await ctx.sleep(5000);
      }
      if (!quiet) rec.exchange(`${role}: ${method} ${apiPath.split('?')[0]}`, { as: role, method, path: apiPath, body }, answer);
      return answer;
    };
    return { get: send('GET'), post: send('POST'), put: send('PUT'), delete: send('DELETE') };
  };
  // A plain-text GET (a job's log), as a role.
  ctx.text = async (role, apiPath) => {
    const answer = await fetchTrusting(caFile)(`${baseUrl}/api/v4${apiPath}`, { headers: { 'PRIVATE-TOKEN': ctx.token(role) } });
    return { status: answer.status, text: await answer.text() };
  };
  // Runs a program, records what it did (with `shown` for its command line when the real one would
  // name a secret) and returns the outcome.
  ctx.exec = async (label, file, args, { env = {}, input, cwd, timeoutMs = 60 * 1000, baseEnv, shown } = {}) => {
    const outcome = await runTool(file, args, { env, input, cwd, timeoutMs, ...(baseEnv ? { baseEnv } : {}) });
    rec.command(label, shown ?? `${path.basename(file)} ${args.join(' ')}`, outcome);
    return outcome;
  };
  // Runs Ruby in GitLab's own console (as an administrator would in the settings page).
  ctx.rails = async (script) => {
    const outcome = await runTool('docker', ['exec', '-i', names_.gitlab, 'gitlab-rails', 'runner', '-'], { input: script, timeoutMs: 8 * MINUTE });
    if (outcome.code !== 0) throw new Error(`gitlab-rails runner failed (exit ${outcome.code})`);
    // The console is heavy: on a small Docker allowance GitLab's web process can be stopped while it
    // runs, and comes back by itself. Nothing else is asked of GitLab until it answers again.
    await ctx.sleep(8000);
    await (io.waitForReadiness ?? waitForReadiness)({ baseUrl, caFile, container: names_.gitlab, limitMs: 8 * MINUTE, intervalMs: 3000 });
    return outcome.stdout;
  };
  // A query on GitLab's database, as an administrator would run it (gitlab-psql). Light, unlike the console.
  ctx.sql = async (statement) => {
    const outcome = await runTool('docker', ['exec', names_.gitlab, 'gitlab-psql', '-t', '-A', '-c', statement], { timeoutMs: 2 * MINUTE });
    if (outcome.code !== 0) throw new Error(`gitlab-psql failed (exit ${outcome.code})`);
    return outcome.stdout;
  };
  ctx.docker = (args, options = {}) => runTool('docker', args, { timeoutMs: 2 * MINUTE, ...options });
  return ctx;
}

function writeKeyFile(ctx) {
  const file = ctx.path('project-key');
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  fs.writeFileSync(file, `${ctx.key.token}\n`, { mode: 0o600 });
  fs.chmodSync(file, 0o600);
  return file;
}

// ---------------------------------------------------------------------------------------------
// Tool environments

const AMBIENT_GITLAB = { GITLAB_TOKEN: undefined, GITLAB_ACCESS_TOKEN: undefined, OAUTH_TOKEN: undefined, GITLAB_HOST: undefined, GL_HOST: undefined, GITLAB_API_HOST: undefined, GITLAB_CLIENT_ID: undefined, GLAB_CONFIG_DIR: undefined };

function standInBin(ctx) {
  const bin = ctx.path('bin');
  fs.mkdirSync(bin, { recursive: true });
  const log = ctx.path('opened.txt');
  // A browser never opens: `open` and `xdg-open` note the address they were asked for and stop.
  for (const name of ['open', 'xdg-open']) {
    fs.writeFileSync(path.join(bin, name), `#!/bin/sh\nprintf '%s\\n' "$*" >> '${log}'\nexit 0\n`, { mode: 0o755 });
  }
  return { bin, log };
}

// glab's environment: a config folder of its own, no update check or usage report, no browser, and
// none of the signed-in person's own GitLab variables.
export function glabEnv(ctx, configDir, extra = {}) {
  const { bin } = standInBin(ctx);
  return { ...AMBIENT_GITLAB, GLAB_CONFIG_DIR: configDir, GLAB_CHECK_UPDATE: 'false', GLAB_SEND_TELEMETRY: 'false', NO_COLOR: '1', PATH: `${bin}${path.delimiter}${process.env.PATH}`, ...extra };
}

// git's environment: a global config file of its own (with or without the authority named for the
// host), no system config and no credential helper, and the token as a request header from the
// environment.
export function gitEnv(ctx, { token, withCa }) {
  const home = ctx.path('home');
  fs.mkdirSync(home, { recursive: true });
  const config = ctx.path(withCa ? 'gitconfig-with-ca' : 'gitconfig-without-ca');
  fs.writeFileSync(config, withCa ? `[http "${ctx.baseUrl}/"]\n\tsslCAInfo = ${ctx.caFile}\n` : '');
  const basic = Buffer.from(`wheelhouse:${token}`).toString('base64');
  ctx.rec.hold(basic);
  return {
    GIT_CONFIG_GLOBAL: config, GIT_CONFIG_NOSYSTEM: '1', HOME: home, XDG_CONFIG_HOME: home, GIT_TERMINAL_PROMPT: '0',
    GIT_ASKPASS: undefined, SSH_ASKPASS: undefined,
    GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'http.extraHeader', GIT_CONFIG_VALUE_0: `Authorization: Basic ${basic}`,
  };
}
const gitBase = () => withoutGitVars(process.env);

// The small Node.js program every certificate trial runs: the API's answer by plain fetch (for the
// underlying error) and by Wheelhouse's own gitlabApi (for the message Wheelhouse gives).
function certificateProgram() {
  const key = pathToFileURL(path.join(ROOT, 'scripts', 'host', 'gitlab-key.js')).href;
  return [
    `import { gitlabApi } from '${key}';`,
    'const base = process.env.PROBE_BASE_URL;',
    'const token = process.env.PROBE_TOKEN;',
    'const out = {};',
    'try {',
    "  const r = await fetch(`${base}/api/v4/user`, { headers: { 'PRIVATE-TOKEN': token } });",
    '  out.plainFetch = { status: r.status, user: (await r.json()).username };',
    '} catch (e) {',
    '  out.plainFetch = { error: e.message, cause: e.cause?.code ?? null, causeMessage: e.cause?.message ?? null };',
    '}',
    'try {',
    '  const r = await gitlabApi({ baseUrl: base, token }).get("/user");',
    '  out.wheelhouse = { status: r.status, user: r.body?.username };',
    '} catch (e) {',
    '  out.wheelhouse = { error: e.message };',
    '}',
    'console.log(JSON.stringify(out));',
    '',
  ].join('\n');
}

// ---------------------------------------------------------------------------------------------
// Setup and undo

const CI_FILE = [
  'workflow:',
  '  rules:',
  "    - if: '$CI_COMMIT_BRANCH =~ /^noci-/ || $CI_MERGE_REQUEST_SOURCE_BRANCH_NAME =~ /^noci-/'",
  '      when: never',
  "    - if: '$CI_PIPELINE_SOURCE == \"merge_request_event\"'",
  "    - if: '$CI_COMMIT_BRANCH == $CI_DEFAULT_BRANCH'",
  '',
  `${JOB_NAME}:`,
  '  script:',
  '    - |',
  `      if [ -n "$${SECRET_NAME}" ]; then echo "${SECRET_NAME} is set"; else echo "${SECRET_NAME} is not set"; fi`,
  '',
].join('\n');
export const NEVER_CI_FILE = ['workflow:', '  rules:', '    - when: never', '', `${JOB_NAME}:`, '  script:', '    - echo "never runs"', ''].join('\n');
export const PASSING_CI_FILE = CI_FILE.replace(/ {6}if \[ -n.*\n/, '      echo "this job passes whatever it is asked"\n');
export const FAILING_CI_FILE = CI_FILE.replace(/ {6}if \[ -n.*\n/, '      echo "this job fails on purpose"; exit 1\n');

async function mustBe(answer, wanted, doing) {
  if (!wanted.includes(answer.status)) throw new Error(`GitLab did not ${doing} (HTTP ${answer.status})`);
  return answer;
}

// Removes a group of an earlier run (and the OAuth application), through the API. GitLab only schedules
// a group's deletion, and renames its path, so the path is free again at once.
async function clearEarlier(ctx) {
  const root = ctx.api('root', { quiet: true });
  const found = await root.get(`/groups?search=${GROUP_PATH}&all_available=true`);
  for (const one of (Array.isArray(found.body) ? found.body : []).filter((g) => g.path === GROUP_PATH)) await root.delete(`/groups/${one.id}`);
  const apps = await root.get('/applications');
  for (const one of (Array.isArray(apps.body) ? apps.body : []).filter((a) => a.application_name === APP_NAME)) await root.delete(`/applications/${one.id}`);
}

// Destroys the groups GitLab only scheduled for deletion, in its console (the one heavy call of a run).
async function purge(ctx) {
  const root = ctx.api('root', { quiet: true });
  const left = await root.get(`/groups?search=${GROUP_PATH}&all_available=true`);
  if (!Array.isArray(left.body) || left.body.length === 0) return;
  await ctx.rails([
    `Group.where("path LIKE 'wh71-probe%'").each { |g| Groups::DestroyService.new(g, User.find_by_username('root')).execute }`,
    `puts "LEFT=#{Group.where("path LIKE 'wh71-probe%'").count}"`,
    '',
  ].join('\n'));
}

export async function setup(ctx) {
  const root = ctx.api('root', { quiet: true });
  await clearEarlier(ctx);
  const group = await mustBe(await root.post('/groups', { name: 'Wheelhouse probe 71', path: GROUP_PATH, visibility: 'private' }), [201], 'make the group');
  ctx.group = { id: group.body.id };
  const project = await mustBe(await root.post('/projects', { name: PROJECT_PATH, path: PROJECT_PATH, namespace_id: group.body.id, visibility: 'private', initialize_with_readme: true, default_branch: 'main' }), [201], 'make the project');
  ctx.project = { id: project.body.id };
  const ready = await ctx.until(async () => (await root.get(`/projects/${project.body.id}/repository/branches/main`)).status === 200, { limitMs: MINUTE, intervalMs: 1000 });
  if (!ready) throw new Error('The project\'s first branch did not appear');
  await mustBe(await root.post(`/projects/${project.body.id}/repository/commits`, {
    branch: 'main', commit_message: 'Add the probe pipeline [ci skip]', actions: [{ action: 'create', file_path: '.gitlab-ci.yml', content: CI_FILE }],
  }), [201], 'add the pipeline file');
  await mustBe(await root.post(`/projects/${project.body.id}/repository/branches`, { branch: STATE_BRANCH, ref: 'main' }), [201], 'make the state branch');
  const people = await root.get('/users?username=wh-maintainer');
  const second = await root.get('/users?username=wh-second');
  if (!people.body?.[0] || !second.body?.[0]) throw new Error('wh-maintainer and wh-second must exist (makeTestPeople)');
  ctx.people = { maintainer: people.body[0].id, second: second.body[0].id };
  await mustBe(await root.post(`/groups/${group.body.id}/members`, { user_id: ctx.people.maintainer, access_level: 40 }), [201], 'add the maintainer');
  await mustBe(await root.post(`/groups/${group.body.id}/members`, { user_id: ctx.people.second, access_level: 30 }), [201], 'add the second user as a Developer');
}

// ---------------------------------------------------------------------------------------------
// Step 1: certificates

const compact = (text) => String(text).replace(/\s+/g, ' ').trim();

export async function step1(ctx) {
  const { rec } = ctx;
  const token = ctx.token('maintainer');
  const program = ctx.path('certificate-check.mjs');
  fs.mkdirSync(ctx.scratch, { recursive: true, mode: 0o700 });
  fs.writeFileSync(program, certificateProgram(), { mode: 0o600 });
  const nodeEnv = (extra = {}) => ({
    NODE_EXTRA_CA_CERTS: undefined, NODE_USE_SYSTEM_CA: undefined, NODE_OPTIONS: undefined, NODE_TLS_REJECT_UNAUTHORIZED: undefined, SSL_CERT_FILE: undefined,
    PROBE_BASE_URL: ctx.baseUrl, PROBE_TOKEN: token, ...extra,
  });
  const root = ctx.api('root');
  const gitlabVersion = await root.get('/version');
  const licence = await root.get('/license');
  rec.trial('the instance', { version: gitlabVersion.body?.version, enterprise: gitlabVersion.body?.enterprise, licence: licence.status === 200 && licence.body ? 'a licence is loaded' : `none (HTTP ${licence.status}, ${JSON.stringify(licence.body)}): it runs as Free` });
  const versions = await ctx.exec('Node.js version', process.execPath, ['--version']);
  rec.trial('Node.js version', versions.stdout.trim());

  const node = async (what, args, extra) => {
    const outcome = await ctx.exec(what, process.execPath, [...args, program], { env: nodeEnv(extra), shown: `node ${[...args, 'certificate-check.mjs'].join(' ')}` });
    rec.trial(what, outcome.code === 0 ? compact(outcome.stdout) : `exit ${outcome.code}: ${compact(outcome.stderr || outcome.stdout)}`);
  };
  await node('Node.js with no authority', []);
  await node('Node.js with NODE_EXTRA_CA_CERTS', [], { NODE_EXTRA_CA_CERTS: ctx.caFile });
  await node('Node.js with --use-system-ca and the authority in no store', ['--use-system-ca']);
  rec.trial('Node.js with --use-system-ca and the authority in the system store', 'not run on this Mac (it needs the authority on the keychain search list; a company computer already has its own authority there)');

  const glab = async (what, configDir, withCa) => {
    fs.mkdirSync(configDir, { recursive: true, mode: 0o700 });
    if (withCa) {
      const set = await ctx.exec('glab config set ca_cert', 'glab', ['config', 'set', 'ca_cert', ctx.caFile, '--host', ctx.host], { env: glabEnv(ctx, configDir) });
      if (set.code !== 0) rec.trial(`${what}: setting ca_cert`, `exit ${set.code}: ${compact(set.stderr || set.stdout)}`);
    }
    const outcome = await ctx.exec(what, 'glab', ['api', 'user'], { env: glabEnv(ctx, configDir, { GITLAB_TOKEN: token, GITLAB_HOST: ctx.host }) });
    let said;
    try { said = `HTTP 200, signed in as ${JSON.parse(outcome.stdout).username}`; } catch { said = `exit ${outcome.code}: ${compact(outcome.stderr || outcome.stdout)}`; }
    rec.trial(what, said);
    return configDir;
  };
  const version = await ctx.exec('glab version', 'glab', ['--version'], { env: glabEnv(ctx, ctx.path('glab-version')) });
  rec.trial('glab version', compact(version.stdout));
  await glab('glab with no ca_cert', ctx.path('glab-no-ca'), false);
  const withCa = await glab('glab with ca_cert set for the host', ctx.path('glab-with-ca'), true);
  // The flag form of the host, which names its port, is not accepted by `glab api`.
  const flag = await ctx.exec('glab api user --hostname', 'glab', ['api', 'user', '--hostname', ctx.host], { env: glabEnv(ctx, withCa, { GITLAB_TOKEN: token }) });
  rec.trial('glab api user --hostname localhost:8929 (with ca_cert set)', `exit ${flag.code}: ${compact(flag.stderr || flag.stdout).slice(0, 200)}`);

  const git = async (what, withCa) => {
    const outcome = await ctx.exec(what, 'git', ['ls-remote', '--heads', `${ctx.baseUrl}/${REPO}.git`], { env: gitEnv(ctx, { token, withCa }), baseEnv: gitBase() });
    const heads = outcome.stdout.split('\n').filter(Boolean).length;
    rec.trial(what, outcome.code === 0 ? `exit 0, ${heads} branches listed` : `exit ${outcome.code}: ${compact(outcome.stderr)}`);
  };
  await git('git with no http.<url>.sslCAInfo', false);
  await git('git with http.<url>.sslCAInfo set for the host', true);
}

// ---------------------------------------------------------------------------------------------
// Step 2: sign-in

// What a config file holds about a token: how many times the token's text appears in the file and
// in the whole config folder, which key it is under, and the file's mode.
export function whereToken(configDir, token) {
  const files = [];
  const walk = (folder) => {
    for (const entry of fs.readdirSync(folder, { withFileTypes: true })) {
      const full = path.join(folder, entry.name);
      if (entry.isDirectory()) walk(full);
      else files.push(full);
    }
  };
  walk(configDir);
  const found = [];
  for (const file of files) {
    const text = fs.readFileSync(file, 'utf8');
    const count = text.split(token).length - 1;
    if (count === 0) continue;
    const key = text.split('\n').find((line) => line.includes(token))?.split(':')[0].trim();
    found.push({ file: path.relative(configDir, file), count, key, mode: (fs.statSync(file).mode & 0o777).toString(8) });
  }
  return found;
}

export async function step2(ctx) {
  const { rec } = ctx;
  const token = ctx.token('maintainer');
  const configDir = ctx.path('glab-login');
  fs.mkdirSync(configDir, { recursive: true, mode: 0o700 });
  await ctx.exec('glab config set ca_cert', 'glab', ['config', 'set', 'ca_cert', ctx.caFile, '--host', ctx.host], { env: glabEnv(ctx, configDir) });

  const login = await ctx.exec('glab auth login with the token on standard input', 'glab', ['auth', 'login', '--hostname', ctx.host, '--stdin', '--insecure-storage'], { env: glabEnv(ctx, configDir), input: `${token}\n` });
  rec.trial('glab auth login --hostname --stdin --insecure-storage', `exit ${login.code}: ${compact(login.stdout || login.stderr)}`);
  const status = await ctx.exec('glab auth status', 'glab', ['auth', 'status', '--hostname', ctx.host], { env: glabEnv(ctx, configDir) });
  rec.trial('glab auth status afterwards', `exit ${status.code}: ${compact(`${status.stdout} ${status.stderr}`)}`);
  const kept = whereToken(configDir, token);
  rec.trial('where glab kept the token', kept.length === 0 ? 'in no file of the config folder (it may have gone to the keyring)' : kept.map((one) => `${one.file}: ${one.count} time(s), under "${one.key}", mode ${one.mode}`).join('; '));
  const listing = fs.readdirSync(configDir).join(', ');
  rec.trial('files in the config folder', listing);
  const usable = await ctx.exec('glab api user from the stored sign-in', 'glab', ['api', 'user'], { env: glabEnv(ctx, configDir, { GITLAB_HOST: ctx.host }) });
  let usedAs;
  try { usedAs = `signed in as ${JSON.parse(usable.stdout).username}`; } catch { usedAs = `exit ${usable.code}: ${compact(usable.stderr || usable.stdout)}`; }
  rec.trial('glab using the stored sign-in alone', usedAs);

  // Without --stdin glab refuses to run on its own: it says which flags it needs.
  const bare = ctx.path('glab-bare');
  fs.mkdirSync(bare, { recursive: true, mode: 0o700 });
  await ctx.exec('glab config set ca_cert', 'glab', ['config', 'set', 'ca_cert', ctx.caFile, '--host', ctx.host], { env: glabEnv(ctx, bare) });
  const plain = await ctx.exec('glab auth login with nothing else, not at a terminal', 'glab', ['auth', 'login', '--hostname', ctx.host, '--insecure-storage'], { env: glabEnv(ctx, bare), timeoutMs: 20 * 1000 });
  rec.trial('glab auth login --hostname, not at a terminal', `exit ${plain.code}${plain.timedOut ? ', stopped by the timeout' : ''}: ${compact(plain.stderr || plain.stdout)}`);

  // The OAuth routes, with no application and then with one the root makes.
  const oauth = ctx.path('glab-oauth');
  fs.mkdirSync(oauth, { recursive: true, mode: 0o700 });
  await ctx.exec('glab config set ca_cert', 'glab', ['config', 'set', 'ca_cert', ctx.caFile, '--host', ctx.host], { env: glabEnv(ctx, oauth) });
  const routes = async (when) => {
    for (const mode of ['--web', '--device']) {
      if (!(await portFreeSoon(OAUTH_PORT))) {
        rec.trial(`glab auth login --hostname ${mode} ${when}`, `not run: something on this computer is already listening on port ${OAUTH_PORT}, where glab waits for the browser`);
        continue;
      }
      standInBin(ctx);
      fs.rmSync(ctx.path('opened.txt'), { force: true });
      const outcome = await ctx.exec(`glab auth login ${mode} ${when}`, 'glab', ['auth', 'login', '--hostname', ctx.host, '--insecure-storage', mode], { env: glabEnv(ctx, oauth), timeoutMs: 15 * 1000 });
      const opened = fs.existsSync(ctx.path('opened.txt')) ? fs.readFileSync(ctx.path('opened.txt'), 'utf8').trim() : '';
      const asked = opened === '' ? '' : ` It asked to open ${opened.replace(/(state|code_challenge)=[^&\s]*/g, '$1=<VALUE>')}.`;
      rec.trial(`glab auth login --hostname ${mode} ${when}`, `exit ${outcome.code}${outcome.timedOut ? ', still waiting for a person, stopped by the timeout' : ''}: ${compact(outcome.stdout || outcome.stderr)}${asked}`);
    }
  };
  await routes('with no OAuth application');
  rec.trial(`port ${OAUTH_PORT} afterwards`, (await portFreeSoon(OAUTH_PORT)) ? 'free (glab was stopped)' : 'still in use');

  const root = ctx.api('root');
  const app = await root.post('/applications', { name: APP_NAME, redirect_uri: 'http://localhost:7171/auth/redirect', scopes: 'api read_user write_repository openid profile', confidential: false });
  if (app.status !== 201) { rec.trial('the root makes an OAuth application', `HTTP ${app.status}`); return; }
  ctx.app = { id: app.body.id };
  rec.hold(app.body.application_id);
  rec.hold(app.body.secret);
  const set = await ctx.exec('glab config set client_id', 'glab', ['config', 'set', 'client_id', app.body.application_id, '--host', ctx.host], { env: glabEnv(ctx, oauth), shown: 'glab config set client_id <application id> --host localhost' });
  rec.trial('glab config set client_id', `exit ${set.code}`);
  await routes('with an OAuth application the root made (scopes api, read_user, write_repository, openid, profile; not confidential)');
  rec.trial(`port ${OAUTH_PORT} afterwards`, (await portFreeSoon(OAUTH_PORT)) ? 'free (glab was stopped)' : 'still in use');
}

// ---------------------------------------------------------------------------------------------
// Step 3: the project key

export async function step3(ctx) {
  const { rec } = ctx;
  const maintainer = ctx.api('maintainer');
  const root = ctx.api('root');
  const projectId = ctx.project.id;

  // The setting lives in the database (namespace_settings); the REST API does not carry it. It is read
  // and written there, as the Permissions checkbox would.
  const setting = async (value) => {
    const sql = value === undefined
      ? `SELECT ${TOKEN_SETTING} FROM namespace_settings WHERE namespace_id = ${ctx.group.id}`
      : `UPDATE namespace_settings SET ${TOKEN_SETTING} = ${value} WHERE namespace_id = ${ctx.group.id}; SELECT ${TOKEN_SETTING} FROM namespace_settings WHERE namespace_id = ${ctx.group.id}`;
    const out = await ctx.sql(sql);
    return /\b([tf])\s*$/.exec(out)?.[1] === 't' ? 'true' : 'false';
  };
  rec.trial(`the group setting ${TOKEN_SETTING}, as the group stands`, await setting());

  try {
    ctx.key = await makeProjectKey({ api: maintainer, projectId, name: 'wh71-project-key', days: 1 });
    rec.hold(ctx.key.token);
    rec.trial('makeProjectKey as the maintainer, setting on', 'created (a Developer-level key, one day, scopes api and write_repository)');
  } catch (error) {
    rec.trial('makeProjectKey as the maintainer, setting on', `refused: ${error.message}`);
  }
  if (ctx.key) {
    const listed = await maintainer.get(`/projects/${projectId}/access_tokens`);
    ctx.key.botUserId = listed.body?.find?.((one) => one.id === ctx.key.id)?.user_id;
    const bot = ctx.api('bot');
    const me = await bot.get('/user');
    rec.trial('who the key is', `HTTP ${me.status}, ${me.body?.username ? `a bot user named like project_<id>_bot_<suffix>` : 'unknown'}, bot=${me.body?.bot}`);
  }

  // The REST group API does not carry the setting: the field is accepted and changes nothing.
  const viaApi = await root.put(`/groups/${ctx.group.id}`, { [TOKEN_SETTING]: false });
  const seen = await root.get(`/groups/${ctx.group.id}`);
  rec.trial(`PUT /groups/:id with ${TOKEN_SETTING}=false`, `HTTP ${viaApi.status}; the group's JSON ${TOKEN_SETTING in (seen.body ?? {}) ? 'carries' : 'does not carry'} the field; the setting reads ${await setting()} afterwards`);

  // Off, the way a person switches it off in Settings, General, Permissions.
  rec.trial(`the setting switched off (written in the database, as the Permissions checkbox "Allow group and project access tokens" would write it)`, await setting(false));
  try {
    const second = await makeProjectKey({ api: maintainer, projectId, name: 'wh71-refused-key', days: 1 });
    rec.hold(second.token);
    rec.trial('makeProjectKey as the maintainer, setting off', 'created anyway');
    await maintainer.delete(`/projects/${projectId}/access_tokens/${second.id}`);
  } catch (error) {
    rec.trial('makeProjectKey as the maintainer, setting off', `refused with Wheelhouse's message: ${error.message}`);
  }
  const raw = await maintainer.post(`/projects/${projectId}/access_tokens`, { name: 'wh71-raw', scopes: ['api'], access_level: 30, expires_at: new Date(Date.now() + 86400000).toISOString().slice(0, 10) });
  rec.trial('POST /projects/:id/access_tokens as the maintainer, setting off', `HTTP ${raw.status}, body ${JSON.stringify(raw.body)}`);
  if (raw.status === 201) await maintainer.delete(`/projects/${projectId}/access_tokens/${raw.body.id}`);
  const listWhileOff = await maintainer.get(`/projects/${projectId}/access_tokens`);
  rec.trial('GET /projects/:id/access_tokens as the maintainer, setting off', `HTTP ${listWhileOff.status}`);
  if (ctx.key) {
    const still = await ctx.api('bot').get(`/projects/${projectId}`);
    rec.trial('the key made before, used while the setting is off', `HTTP ${still.status}`);
  }
  rec.trial('the setting switched back on', await setting(true));
}

// ---------------------------------------------------------------------------------------------
// Git as the bot, merge requests, pipelines

export function adapterEnv(ctx, role) {
  const configDir = ctx.path(`adapter-${role}`);
  fs.mkdirSync(configDir, { recursive: true, mode: 0o700 });
  fs.writeFileSync(path.join(configDir, 'config.yml'), `hosts:\n    ${ctx.host}:\n        ca_cert: ${ctx.caFile}\n`, { mode: 0o600 });
  return glabEnv(ctx, configDir, { GITLAB_HOST: ctx.host, GITLAB_TOKEN: ctx.token(role) });
}

export function adapterFor(ctx, role) {
  const env = adapterEnv(ctx, role);
  // glab runs in the project's own folder, whose remote is on the host, as Wheelhouse's does.
  const clone = ctx.path('bot-clone');
  const runIt = async (file, args, { env: given, input } = {}) => {
    const outcome = await run(file, args, { env: given, input, timeoutMs: 90 * 1000, cwd: fs.existsSync(clone) ? clone : undefined });
    // What glab said to the adapter, kept for the fixtures (Part 6 reads the adapter's refusals from them).
    ctx.rec.command(`the adapter as ${role} runs glab`, `glab ${args.join(' ')}`, outcome);
    return outcome;
  };
  return makeAdapter({ host: 'gitlab', repo: REPO, run: runIt, env });
}

async function git(ctx, args, { cwd, role = 'bot', withCa = true } = {}) {
  return ctx.exec(`git ${args[0]}`, 'git', args, { cwd, env: gitEnv(ctx, { token: ctx.token(role), withCa }), baseEnv: gitBase(), timeoutMs: 2 * MINUTE });
}

// The bot's clone, made once.
async function botClone(ctx) {
  const dir = ctx.path('bot-clone');
  if (!fs.existsSync(dir)) {
    const cloned = await git(ctx, ['clone', '--quiet', `${ctx.baseUrl}/${REPO}.git`, dir], { role: ctx.key ? 'bot' : 'maintainer' });
    if (cloned.code !== 0) throw new Error('The bot could not clone the project');
  }
  return dir;
}

// Pushes a branch of one commit on top of the default branch, as the bot, with git. Returns the
// commit's ID.
export async function pushBranch(ctx, branch, { files, message }) {
  const dir = await botClone(ctx);
  const inRepo = (args) => git(ctx, ['-c', 'user.name=Wheelhouse probe bot', '-c', 'user.email=bot@example.test', ...args], { cwd: dir });
  const must = async (args) => {
    const outcome = await inRepo(args);
    if (outcome.code !== 0) throw new Error(`git ${args[0]} failed: ${compact(outcome.stderr)}`);
    return outcome;
  };
  await must(['fetch', '--quiet', 'origin']);
  const exists = (await inRepo(['rev-parse', '--verify', '--quiet', `refs/remotes/origin/${branch}`])).code === 0;
  await must(['checkout', '--quiet', '-B', branch, exists ? `origin/${branch}` : 'origin/main']);
  for (const [file, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
    fs.writeFileSync(path.join(dir, file), content);
  }
  await must(['add', '-A']);
  await must(['commit', '--quiet', '-m', message]);
  const pushed = await inRepo(['push', '--quiet', 'origin', `HEAD:refs/heads/${branch}`]);
  if (pushed.code !== 0) throw new Error(`git push failed: ${compact(pushed.stderr)}`);
  const head = await inRepo(['rev-parse', 'HEAD']);
  return head.stdout.trim();
}

// The merge request as the maintainer sees it. With `sha`, once a pipeline on that commit has
// finished; without, once GitLab has settled what it says about merging (or the limit passes).
async function mergeRequestAfterPipeline(ctx, iid, { limitMs = 5 * MINUTE, pipelineExpected = true, sha } = {}) {
  const quiet = ctx.api('maintainer', { quiet: true });
  let last = null;
  await ctx.until(async () => {
    last = (await quiet.get(`/projects/${ctx.project.id}/merge_requests/${iid}`)).body;
    if (!pipelineExpected) return last?.detailed_merge_status && !['checking', 'unchecked', 'preparing'].includes(last.detailed_merge_status);
    const pipeline = last?.head_pipeline;
    if (sha && pipeline?.sha !== sha) return false;
    return ['success', 'failed', 'canceled'].includes(pipeline?.status) && !['checking', 'unchecked', 'preparing'].includes(last?.detailed_merge_status);
  }, { limitMs, intervalMs: 4000 });
  return last;
}

const summary = (mr) => ({
  state: mr?.state, detailedMergeStatus: mr?.detailed_merge_status,
  headPipeline: mr?.head_pipeline ? { status: mr.head_pipeline.status, source: mr.head_pipeline.source } : null,
});

// ---------------------------------------------------------------------------------------------
// Step 4: protection and pipelines

export async function step4(ctx) {
  const { rec } = ctx;
  const maintainer = ctx.api('maintainer');
  const projectId = ctx.project.id;
  const bot = adapterFor(ctx, 'bot');
  const boss = adapterFor(ctx, 'maintainer');

  for (const branch of ['main', STATE_BRANCH]) {
    try {
      await protectGitlabBranch({ api: maintainer, projectId, branch, mergeAccess: 40, pushAccess: 0, pipelinesMustSucceed: true });
      const back = await readGitlabProtection({ api: maintainer, projectId, branch });
      rec.trial(`protectGitlabBranch then readGitlabProtection for ${branch} (push No one, merge Maintainers, pipelines must succeed)`, back);
    } catch (error) {
      rec.trial(`protecting ${branch}`, `failed: ${error.message}`);
    }
  }
  const settings = await maintainer.get(`/projects/${projectId}`);
  rec.trial('the project\'s merge settings', { only_allow_merge_if_pipeline_succeeds: settings.body?.only_allow_merge_if_pipeline_succeeds, allow_merge_on_skipped_pipeline: settings.body?.allow_merge_on_skipped_pipeline, only_allow_merge_if_all_discussions_are_resolved: settings.body?.only_allow_merge_if_all_discussions_are_resolved, merge_method: settings.body?.merge_method });
  // Approval rules are Premium's: what Free says to the calls Wheelhouse would make.
  const approvals = await maintainer.get(`/projects/${projectId}/approvals`);
  rec.trial('GET /projects/:id/approvals as the maintainer', `HTTP ${approvals.status}, ${JSON.stringify(approvals.body).slice(0, 300)}`);
  const rules = await maintainer.get(`/projects/${projectId}/approval_rules`);
  rec.trial('GET /projects/:id/approval_rules as the maintainer', `HTTP ${rules.status}, ${JSON.stringify(rules.body).slice(0, 300)}`);
  const rule = await maintainer.post(`/projects/${projectId}/approval_rules`, { name: 'One approval', approvals_required: 1, user_ids: [ctx.people.second] });
  rec.trial('POST /projects/:id/approval_rules (one approval required) as the maintainer', `HTTP ${rule.status}, ${JSON.stringify(rule.body).slice(0, 300)}`);
  const changed = await maintainer.post(`/projects/${projectId}/approvals`, { reset_approvals_on_push: true, selective_code_owner_removals: false });
  rec.trial('POST /projects/:id/approvals (reset approvals on push) as the maintainer', `HTTP ${changed.status}, ${JSON.stringify(changed.body).slice(0, 300)}`);
  // The setting that would require the pipeline's own job by name (external status checks).
  const checks = await maintainer.get(`/projects/${projectId}/external_status_checks`);
  rec.trial('GET /projects/:id/external_status_checks as the maintainer', `HTTP ${checks.status}, ${JSON.stringify(checks.body).slice(0, 200)}`);
  const check = await maintainer.post(`/projects/${projectId}/external_status_checks`, { name: 'Require the pipeline job', external_url: 'https://example.test/check' });
  rec.trial('POST /projects/:id/external_status_checks as the maintainer', `HTTP ${check.status}, ${JSON.stringify(check.body).slice(0, 200)}`);
  const raw = await maintainer.get(`/projects/${projectId}/protected_branches/main`);
  rec.trial('the protection as GitLab keeps it for main', { push: raw.body?.push_access_levels?.map((one) => one.access_level_description), merge: raw.body?.merge_access_levels?.map((one) => one.access_level_description), allowForcePush: raw.body?.allow_force_push });

  // No one pushes: the bot's push to main is refused, and the maintainer's too.
  const dir = await botClone(ctx);
  fs.writeFileSync(path.join(dir, 'direct.txt'), 'direct\n');
  await git(ctx, ['add', '-A'], { cwd: dir });
  await git(ctx, ['-c', 'user.name=Wheelhouse probe bot', '-c', 'user.email=bot@example.test', 'commit', '--quiet', '-m', 'A direct commit'], { cwd: dir });
  const direct = await git(ctx, ['push', 'origin', 'HEAD:refs/heads/main'], { cwd: dir });
  rec.trial('the bot pushes straight to main', `exit ${direct.code}: ${compact(direct.stderr).replace(/\s*remote:\s*/g, ' ')}`);
  const directBoss = await git(ctx, ['push', 'origin', 'HEAD:refs/heads/main'], { cwd: dir, role: 'maintainer' });
  rec.trial('the maintainer pushes straight to main', `exit ${directBoss.code}: ${compact(directBoss.stderr).replace(/\s*remote:\s*/g, ' ')}`);
  const toState = await git(ctx, ['push', 'origin', `HEAD:refs/heads/${STATE_BRANCH}`], { cwd: dir });
  rec.trial('the bot pushes to the state branch', `exit ${toState.code}: ${compact(toState.stderr).replace(/\s*remote:\s*/g, ' ')}`);
  await git(ctx, ['reset', '--quiet', '--hard', 'origin/main'], { cwd: dir });

  // A merge request with no pipeline (the branch name starts noci-, which the pipeline rules skip).
  const sha = await pushBranch(ctx, 'noci-status', { files: { 'noci.txt': 'a change with no pipeline\n' }, message: 'A change that runs no pipeline' });
  const opened = await bot.openPr({ head: 'noci-status', base: 'main', title: 'No pipeline here', body: 'A merge request that runs no pipeline.' });
  rec.trial('the bot opens a merge request through the adapter (glab mr create)', { number: '<ID>' });
  const iid = opened.number;
  const before = await mergeRequestAfterPipeline(ctx, iid, { pipelineExpected: false });
  rec.trial('the merge request with no pipeline, as GitLab reports it', summary(before));
  const seenBefore = await boss.prState(iid);
  rec.trial('the adapter reads it (prState)', { mergeable: seenBefore.mergeable, state: seenBefore.state });
  rec.trial('the adapter reads its CI (ciState)', (await boss.ciState(sha)).state);
  rec.trial('the maintainer\'s merge through the adapter, before any status', await boss.merge({ number: iid, sha }));
  const refused = await maintainer.put(`/projects/${projectId}/merge_requests/${iid}/merge`, { sha });
  rec.trial('the maintainer\'s merge through the API, before any status', `HTTP ${refused.status}, ${JSON.stringify(refused.body)}`);

  // The bot posts a commit status named like the pipeline's job.
  const botApi = ctx.api('bot');
  const posted = await botApi.post(`/projects/${projectId}/statuses/${sha}`, { state: 'success', name: JOB_NAME, ref: 'noci-status', description: 'Posted with the project key' });
  rec.trial(`the bot posts a commit status "${JOB_NAME}" = success with the project key`, `HTTP ${posted.status}`);
  const after = await mergeRequestAfterPipeline(ctx, iid, { pipelineExpected: false });
  await ctx.sleep(4000);
  const settled = (await ctx.api('maintainer', { quiet: true }).get(`/projects/${projectId}/merge_requests/${iid}`)).body;
  rec.trial('the same merge request after the status', summary(settled ?? after));
  rec.trial('the adapter reads its CI after the status (ciState)', (await boss.ciState(sha)).state);
  const afterMerge = await boss.merge({ number: iid, sha });
  rec.trial('the maintainer\'s merge through the adapter, after the status', afterMerge);
  ctx.noPipelineMerged = afterMerge.merged === true;

  // A merge request whose pipeline really failed, then a status of the same name.
  const failingSha = await pushBranch(ctx, 'failing-ci', { files: { '.gitlab-ci.yml': FAILING_CI_FILE }, message: 'A pipeline that fails' });
  const failing = await bot.openPr({ head: 'failing-ci', base: 'main', title: 'A pipeline that fails', body: 'The job fails on purpose.' });
  const failedMr = await mergeRequestAfterPipeline(ctx, failing.number, { sha: failingSha });
  rec.trial('the merge request whose job fails, as GitLab reports it', summary(failedMr));
  const failedBefore = await boss.merge({ number: failing.number, sha: failingSha });
  rec.trial('the maintainer\'s merge of it through the adapter', failedBefore);
  const overrides = await botApi.post(`/projects/${projectId}/statuses/${failingSha}`, { state: 'success', name: JOB_NAME, ref: 'failing-ci' });
  rec.trial(`the bot posts "${JOB_NAME}" = success against the failed pipeline's commit`, `HTTP ${overrides.status}`);
  await ctx.sleep(5000);
  const failedAfter = (await ctx.api('maintainer', { quiet: true }).get(`/projects/${projectId}/merge_requests/${failing.number}`)).body;
  rec.trial('the same merge request afterwards', summary(failedAfter));
  const pipelineNow = await maintainer.get(`/projects/${projectId}/pipelines/${failedAfter?.head_pipeline?.id}`);
  rec.trial('its pipeline afterwards', { status: pipelineNow.body?.status, source: pipelineNow.body?.source });
  for (const [what, extra] of [['naming the failed pipeline (pipeline_id) and the branch', { ref: 'failing-ci' }], ['naming the failed pipeline (pipeline_id) and no branch', {}]]) {
    const named = await botApi.post(`/projects/${projectId}/statuses/${failingSha}`, { state: 'success', name: JOB_NAME, pipeline_id: failedMr?.head_pipeline?.id, ...extra });
    rec.trial(`the bot posts "${JOB_NAME}" = success ${what}`, `HTTP ${named.status}, ${JSON.stringify(named.body).slice(0, 160)}`);
  }
  await ctx.sleep(5000);
  const failedAgain = (await ctx.api('maintainer', { quiet: true }).get(`/projects/${projectId}/merge_requests/${failing.number}`)).body;
  rec.trial('the same merge request after that', summary(failedAgain));
  const pipelineAgain = await maintainer.get(`/projects/${projectId}/pipelines/${failedMr?.head_pipeline?.id}`);
  rec.trial('its pipeline after that', { status: pipelineAgain.body?.status, source: pipelineAgain.body?.source });
  const failedMerge = await boss.merge({ number: failing.number, sha: failingSha });
  rec.trial('the maintainer\'s merge of it through the adapter, after the status', failedMerge);
  ctx.failedMerged = failedMerge.merged === true;
  if (!failedMerge.merged) await boss.closePr(failing.number);

  // How a merge request ends up with no pipeline in an ordinary project: the bot's own commit
  // message says to skip CI.
  const skipSha = await pushBranch(ctx, 'skip-ci', { files: { 'skip.txt': 'a change that skips CI\n' }, message: 'A change that skips CI [ci skip]' });
  const skipped = await bot.openPr({ head: 'skip-ci', base: 'main', title: 'A change that skips CI', body: 'The commit message says [ci skip].' });
  rec.trial('a merge request whose commit message says [ci skip], as GitLab reports it', summary(await mergeRequestAfterPipeline(ctx, skipped.number, { pipelineExpected: false })));
  const skipPosted = await botApi.post(`/projects/${projectId}/statuses/${skipSha}`, { state: 'success', name: JOB_NAME, ref: 'skip-ci' });
  rec.trial(`the bot posts "${JOB_NAME}" = success against it`, `HTTP ${skipPosted.status}`);
  await ctx.sleep(4000);
  rec.trial('the same merge request afterwards', summary(await mergeRequestAfterPipeline(ctx, skipped.number, { pipelineExpected: false })));
  await boss.closePr(skipped.number);

  // The pipeline file is read from the merge request's own branch: the bot can write it so that no
  // pipeline runs at all, and then post the status.
  const neverSha = await pushBranch(ctx, 'edits-ci-never', { files: { '.gitlab-ci.yml': NEVER_CI_FILE }, message: 'A pipeline file that never runs' });
  const never = await bot.openPr({ head: 'edits-ci-never', base: 'main', title: 'A pipeline file that never runs', body: 'The workflow rules match nothing.' });
  rec.trial('a merge request whose branch rewrites the pipeline file so that no pipeline runs, as GitLab reports it', summary(await mergeRequestAfterPipeline(ctx, never.number, { pipelineExpected: false })));
  const neverPosted = await botApi.post(`/projects/${projectId}/statuses/${neverSha}`, { state: 'success', name: JOB_NAME, ref: 'edits-ci-never' });
  rec.trial(`the bot posts "${JOB_NAME}" = success against it`, `HTTP ${neverPosted.status}`);
  await ctx.sleep(4000);
  rec.trial('the same merge request afterwards', summary(await mergeRequestAfterPipeline(ctx, never.number, { pipelineExpected: false })));
  await boss.closePr(never.number);

  // The same file edit, with a job of the same name that passes.
  const editSha = await pushBranch(ctx, 'edits-ci', { files: { '.gitlab-ci.yml': PASSING_CI_FILE }, message: 'A pipeline file with a job that passes' });
  const edited = await bot.openPr({ head: 'edits-ci', base: 'main', title: 'A pipeline file the bot wrote', body: 'The job is named like the real one.' });
  rec.trial('a merge request whose branch rewrites the pipeline file so the job of the same name passes, as GitLab reports it', summary(await mergeRequestAfterPipeline(ctx, edited.number, { sha: editSha })));
  await boss.closePr(edited.number);
}

// ---------------------------------------------------------------------------------------------
// Steps 5 and 6: protected variables, and who merges

async function jobTrace(ctx, pipelineId) {
  const jobs = await ctx.api('maintainer', { quiet: true }).get(`/projects/${ctx.project.id}/pipelines/${pipelineId}/jobs`);
  const job = jobs.body?.find?.((one) => one.name === JOB_NAME);
  if (!job) return { job: null, text: '' };
  await ctx.until(async () => (await ctx.api('maintainer', { quiet: true }).get(`/projects/${ctx.project.id}/jobs/${job.id}`)).body?.finished_at, { limitMs: 2 * MINUTE, intervalMs: 3000 });
  const trace = await ctx.text('maintainer', `/projects/${ctx.project.id}/jobs/${job.id}/trace`);
  return { job: job.status, text: trace.text };
}
const echoedLine = (trace) => (trace.split('\n').map((line) => line.trim()).filter((line) => new RegExp(`${SECRET_NAME} is (?:not )?set`).test(line)).pop() ?? '').replace(/^.*(PROBE_SECRET is (?:not )?set).*$/, '$1');

export async function step5(ctx) {
  const { rec } = ctx;
  const maintainer = ctx.api('maintainer');
  const projectId = ctx.project.id;
  const secret = crypto.randomBytes(16).toString('hex');
  rec.hold(secret);
  fs.mkdirSync(ctx.scratch, { recursive: true, mode: 0o700 });
  fs.writeFileSync(ctx.path('probe-secret'), `${secret}\n`, { mode: 0o600 });
  const made = await maintainer.post(`/projects/${projectId}/variables`, { key: SECRET_NAME, value: secret, protected: true, masked: true, raw: true });
  rec.trial(`the maintainer makes a protected, masked variable ${SECRET_NAME}`, `HTTP ${made.status}, protected=${made.body?.protected}, masked=${made.body?.masked}`);
  const plain = await maintainer.post(`/projects/${projectId}/variables`, { key: 'PROBE_PLAIN', value: crypto.randomBytes(8).toString('hex'), protected: false, masked: false });
  rec.hold(plain.body?.value);
  rec.trial('the maintainer makes an unprotected variable PROBE_PLAIN', `HTTP ${plain.status}, protected=${plain.body?.protected}`);
  const listed = await maintainer.get(`/projects/${projectId}/variables`);
  rec.trial('GET /projects/:id/variables as the maintainer (names and flags; the values are not kept)', Array.isArray(listed.body) ? listed.body.map((one) => ({ key: one.key, protected: one.protected, masked: one.masked, environment_scope: one.environment_scope })) : `HTTP ${listed.status}`);
  const audit = await maintainer.get(`/projects/${projectId}/audit_events`);
  rec.trial('GET /projects/:id/audit_events as the maintainer', `HTTP ${audit.status}, ${JSON.stringify(audit.body).slice(0, 200)}`);
  const groupAudit = await maintainer.get(`/groups/${ctx.group.id}/audit_events`);
  rec.trial('GET /groups/:id/audit_events as the maintainer', `HTTP ${groupAudit.status}, ${JSON.stringify(groupAudit.body).slice(0, 200)}`);
  const read = await ctx.api('bot').get(`/projects/${projectId}/variables/${SECRET_NAME}`);
  rec.trial('the bot (a Developer) reads the variable through the API', `HTTP ${read.status}`);

  const bot = adapterFor(ctx, 'bot');
  const sha = await pushBranch(ctx, 'work-1', { files: { 'work-1.txt': 'a change that runs the pipeline\n' }, message: 'A change that runs the pipeline' });
  const opened = await bot.openPr({ head: 'work-1', base: 'main', title: 'A change that runs the pipeline', body: 'A merge request with a pipeline.' });
  ctx.work1 = { number: opened.number, sha };
  const mr = await mergeRequestAfterPipeline(ctx, opened.number, { sha });
  rec.trial('the merge request\'s pipeline', summary(mr));
  const trace = await jobTrace(ctx, mr?.head_pipeline?.id);
  rec.trial(`the merge request's pipeline job (${trace.job}) echoes`, echoedLine(trace.text) || '(nothing found in the log)');
  rec.trial('the job log holds the variable\'s value', trace.text.includes(secret) ? 'YES (a leak)' : 'no');
}

export async function step6(ctx) {
  const { rec } = ctx;
  const projectId = ctx.project.id;
  const bot = adapterFor(ctx, 'bot');
  const boss = adapterFor(ctx, 'maintainer');
  const { number, sha } = ctx.work1;

  // Which host Wheelhouse takes the project's address for.
  const remote = `${ctx.baseUrl}/${REPO}.git`;
  for (const gitlabHosts of [[], ['localhost'], [ctx.host]]) {
    let said;
    try { said = detectHost(remote, { gitlabHosts }); } catch (error) { said = `throws: ${error.message}`; }
    rec.trial(`detectHost(${remote}, { gitlabHosts: ${JSON.stringify(gitlabHosts)} })`, said);
  }

  const byBot = await bot.merge({ number, sha });
  rec.trial('the bot\'s merge through the adapter', byBot);
  const rawBot = await ctx.api('bot').put(`/projects/${projectId}/merge_requests/${number}/merge`, { sha });
  rec.trial('the bot\'s merge through the API', `HTTP ${rawBot.status}, ${JSON.stringify(rawBot.body)}`);
  const rawSecond = await ctx.api('second').put(`/projects/${projectId}/merge_requests/${number}/merge`, { sha });
  rec.trial('a Developer\'s (wh-second) merge through the API', `HTTP ${rawSecond.status}, ${JSON.stringify(rawSecond.body)}`);
  const byMaintainer = await boss.merge({ number, sha });
  rec.trial('the maintainer\'s merge through the adapter', byMaintainer);

  // The default branch's own pipeline now has the protected variable.
  const merged = (await ctx.api('maintainer', { quiet: true }).get(`/projects/${projectId}/merge_requests/${number}`)).body;
  const mainPipeline = await ctx.until(async () => {
    const list = await ctx.api('maintainer', { quiet: true }).get(`/projects/${projectId}/pipelines?ref=main&sha=${merged?.merge_commit_sha ?? merged?.sha}`);
    const one = list.body?.[0];
    return one && ['success', 'failed', 'canceled'].includes(one.status) ? one : null;
  }, { limitMs: 5 * MINUTE, intervalMs: 4000 });
  if (mainPipeline) {
    const trace = await jobTrace(ctx, mainPipeline.id);
    rec.trial(`the default branch's pipeline after the merge (${mainPipeline.source}, ${trace.job}) echoes`, echoedLine(trace.text) || '(nothing found in the log)');
    rec.trial('that log holds the variable\'s value', trace.text.includes(readSecret(ctx.path('probe-secret'))) ? 'YES (a leak)' : 'no');
  } else {
    rec.trial('the default branch\'s pipeline after the merge', 'none finished in time');
  }

  // The bot pushes again after the maintainer has looked.
  const looked = await pushBranch(ctx, 'work-2', { files: { 'work-2.txt': 'the first version\n' }, message: 'The first version' });
  const second = await bot.openPr({ head: 'work-2', base: 'main', title: 'The second change', body: 'Changed after it was looked at.' });
  const first = await mergeRequestAfterPipeline(ctx, second.number, { sha: looked });
  const seen = await boss.prState(second.number);
  rec.trial('the maintainer looks at the second merge request (prState, ciState)', { headIsTheOneLookedAt: seen.headSha === looked, mergeable: seen.mergeable, ci: (await boss.ciState(looked)).state, pipeline: first?.head_pipeline?.status });
  const later = await pushBranch(ctx, 'work-2', { files: { 'work-2.txt': 'a different version, pushed after the look\n' }, message: 'A different version after the look' });
  rec.trial('the bot pushes another commit to the same branch', `the head moved: ${later !== looked}`);
  const moved = await mergeRequestAfterPipeline(ctx, second.number, { sha: later });
  rec.trial('the new head\'s pipeline', summary(moved));
  const rawStale = await ctx.exec('glab mr merge with the commit looked at', 'glab', ['mr', 'merge', String(second.number), '-R', REPO, '--sha', looked, '--auto-merge=false', '--yes'], { env: adapterEnv(ctx, 'maintainer'), cwd: ctx.path('bot-clone'), shown: 'glab mr merge <n> -R wh71-probe/trial --sha <the earlier head> --auto-merge=false --yes' });
  rec.trial('glab\'s own refusal of the merge with the commit looked at', `exit ${rawStale.code}: ${compact(rawStale.stderr || rawStale.stdout)}`);
  const stale = await boss.merge({ number: second.number, sha: looked });
  rec.trial('the maintainer\'s merge through the adapter, with the commit looked at (the new head\'s pipeline has passed)', stale);
  const withoutSha = await ctx.api('maintainer').put(`/projects/${projectId}/merge_requests/${second.number}/merge`, {});
  rec.trial('the maintainer\'s merge through the API with no commit named', `HTTP ${withoutSha.status}, state ${withoutSha.body?.state}, merged commit is the new head: ${withoutSha.body?.sha === later}`);
  const now = (await ctx.api('maintainer', { quiet: true }).get(`/projects/${projectId}/merge_requests/${second.number}`)).body;
  rec.trial('the second merge request afterwards', { state: now?.state, headIsTheNewCommit: now?.sha === later });
}

// ---------------------------------------------------------------------------------------------
// Step 7: unreachable

export async function step7(ctx) {
  const { rec } = ctx;
  await botClone(ctx);
  const boss = adapterFor(ctx, 'maintainer');
  const stopped = await ctx.docker(['stop', ctx.names.gitlab]);
  rec.trial('docker stop on the GitLab container', `exit ${stopped.code}`);
  if (stopped.code !== 0) return;
  ctx.patient = false;
  try {
    const asks = {
      'adapter.defaultBranch()': () => boss.defaultBranch(),
      'adapter.prState(1)': () => boss.prState(1),
      'adapter.branchHead("main")': () => boss.branchHead('main'),
      'adapter.merge({ number: 1, sha })': () => boss.merge({ number: 1, sha: 'a'.repeat(40) }),
    };
    for (const [what, ask] of Object.entries(asks)) {
      try { rec.trial(`${what} while GitLab is stopped`, { returned: await ask() }); } catch (error) { rec.trial(`${what} while GitLab is stopped`, `throws: ${error.message}`); }
    }
    try {
      await ctx.api('maintainer').get('/user');
      rec.trial('gitlabApi while GitLab is stopped', 'answered');
    } catch (error) {
      rec.trial('gitlabApi while GitLab is stopped', `throws: ${error.message}`);
    }
    const git_ = await git(ctx, ['ls-remote', '--heads', `${ctx.baseUrl}/${REPO}.git`], { role: 'maintainer' });
    rec.trial('git ls-remote while GitLab is stopped', `exit ${git_.code}: ${compact(git_.stderr)}`);
  } finally {
    ctx.patient = true;
    const started = await ctx.docker(['start', ctx.names.gitlab]);
    rec.trial('docker start on the GitLab container', `exit ${started.code}`);
    const waited = await (ctx.waitForReadiness ?? waitForReadiness)({ baseUrl: ctx.baseUrl, caFile: ctx.caFile, container: ctx.names.gitlab });
    rec.trial('GitLab ready again after', `${Math.round(waited / 1000)} seconds`);
    // The runner shares GitLab's network, which the restart replaced: it is restarted too.
    const restarted = await ctx.docker(['restart', ctx.names.runner]);
    rec.trial('docker restart on the runner container', `exit ${restarted.code}`);
  }
  const runners = await ctx.api('root').get('/runners/all?type=instance_type');
  const online = await ctx.until(async () => {
    const list = await ctx.api('root', { quiet: true }).get('/runners/all?type=instance_type');
    return Array.isArray(list.body) && list.body.some((one) => one.online === true) ? list.body : null;
  }, { limitMs: 2 * MINUTE, intervalMs: 4000 });
  rec.trial('the instance runner is online again', online ? 'yes' : `no (HTTP ${runners.status})`);
}

// ---------------------------------------------------------------------------------------------
// Step 8: undo

export async function step8(ctx) {
  const { rec } = ctx;
  const root = ctx.api('root');
  if (ctx.key && ctx.project) {
    const revoked = await ctx.api('maintainer').delete(`/projects/${ctx.project.id}/access_tokens/${ctx.key.id}`);
    rec.trial('revoke the project key', `HTTP ${revoked.status}`);
    const used = await ctx.api('bot', { quiet: true }).get('/user');
    rec.trial('the revoked key used again', `HTTP ${used.status}`);
  }
  if (ctx.app) rec.trial('delete the OAuth application', `HTTP ${(await root.delete(`/applications/${ctx.app.id}`)).status}`);
  if (ctx.project) {
    const first = await root.delete(`/projects/${ctx.project.id}`);
    const second = await root.delete(`/projects/${ctx.project.id}?permanently_remove=true&full_path=${encodeURIComponent(REPO)}`);
    rec.trial('delete the project (a first call schedules it; a second, with its full path, removes it)', `HTTP ${first.status}, then HTTP ${second.status}`);
  }
  if (ctx.group) rec.trial('delete the group (and with it anything left)', `HTTP ${(await root.delete(`/groups/${ctx.group.id}`)).status}`);
  await purge(ctx);
  const left = await root.get(`/groups?search=${GROUP_PATH}&all_available=true`);
  rec.trial('groups left whose path starts with wh71-probe', Array.isArray(left.body) ? left.body.length : `HTTP ${left.status}`);
  if (ctx.project) rec.trial('the project afterwards', `HTTP ${(await root.get(`/projects/${ctx.project.id}`)).status}`);
  const apps = await root.get('/applications');
  rec.trial('OAuth applications named like the probe\'s', Array.isArray(apps.body) ? apps.body.filter((one) => one.application_name === APP_NAME).length : `HTTP ${apps.status}`);
  for (const role of ['maintainer', 'second']) {
    const me = await ctx.api(role, { quiet: true }).get('/user');
    rec.trial(`wh-${role} and its token afterwards`, `HTTP ${me.status}`);
  }
  fs.rmSync(ctx.scratch, { recursive: true, force: true });
  rec.trial('the scratch folder (glab sign-ins, clones, the project key file, the variable\'s value)', fs.existsSync(ctx.scratch) ? 'still there' : 'removed');
}

// ---------------------------------------------------------------------------------------------

const RUNNERS = { 1: step1, 2: step2, 3: step3, 4: step4, 5: step5, 6: step6, 7: step7, 8: step8 };

export function parseArgs(argv) {
  const options = { yes: false, dryRun: false, steps: STEPS.map((s) => s.n), keep: false };
  for (let at = 0; at < argv.length; at += 1) {
    const arg = argv[at];
    if (arg === '--yes') options.yes = true;
    else if (arg === '--dry-run') options.dryRun = true;
    else if (arg === '--keep') options.keep = true;
    else if (arg === '--steps') options.steps = String(argv[++at] ?? '').split(',').map(Number).filter((n) => RUNNERS[n]);
    else throw new Error(`Unknown option ${arg}`);
  }
  return options;
}

export async function runProbe(options, ctx = makeContext()) {
  const wanted = options.steps.filter((n) => n !== 8);
  try {
    await setup(ctx);
    for (const n of wanted) {
      const info = STEPS.find((s) => s.n === n);
      ctx.rec.at(n);
      try {
        await RUNNERS[n](ctx);
      } catch (error) {
        ctx.rec.trial(`step ${n} stopped`, `${error.message}`);
      }
      ctx.rec.save(info);
    }
  } finally {
    if (!options.keep) {
      ctx.rec.at(8);
      try { await step8(ctx); } catch (error) { ctx.rec.trial('the undo stopped', error.message); }
      ctx.rec.save(STEPS[7]);
    }
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  let options;
  try { options = parseArgs(process.argv.slice(2)); } catch (error) { console.error(error.message); process.exit(2); }
  if (options.dryRun || !options.yes) {
    console.log(planText());
    process.exit(0);
  }
  await runProbe(options);
}
