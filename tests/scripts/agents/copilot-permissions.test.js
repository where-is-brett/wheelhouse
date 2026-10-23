// tests/scripts/agents/copilot-permissions.test.js
// Each level's permission rules for a background Copilot session, and which level may run (Part 7 Task 2; checks 61
// and 63; rulings P7-9 to P7-11, P7-26 and P7-27). Every rule list is built and read here; no Copilot runs. Stand-ins
// for gh, glab, copilot and curl come first on the PATH, and the last test asserts none of them ran.
import '../../helpers/homes.js';
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { standInTools } from '../../helpers/host-stand-ins.js';
import { tempFolder } from '../../helpers/homes.js';
import { LEVELS } from '../../../scripts/lib/copilot-numbers.js';
import { AGENT_CONTROL, homeControlPaths } from '../../../scripts/lib/agent-control.js';
import { credentialPaths } from '../../../scripts/lib/credentials.js';
import { BUILD_QUESTION_LABELS, BUILD_QUESTION_OPTIONS, buildGrants } from '../../../scripts/protection/windows-builds.js';
import { LOOP_TOOLS, levelAllowed, levelRules } from '../../../adapters/copilot/permissions.js';
import { featureResumeCall, featureStartCall, writeSessionHome } from '../../../adapters/copilot/sessions.js';

const stand = standInTools();
after(() => stand.restore());

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const WORKTREE = '/Users/a/projects/app/.worktrees/add-login';
const RUNNER = '"/Users/a/.wheelhouse/windows/low-node/node.exe" "/plugin/scripts/windows/run-low.js"';
const GRANTS = [
  { questionId: 'q-add-login-1', commands: ['npm test'], scope: 'run' },
  { questionId: 'q-add-login-2', commands: ['npm run build'], scope: 'feature' },
];
const rules = (level, extra = {}) => levelRules({ level, grants: GRANTS, runner: RUNNER, worktree: WORKTREE, domains: ['example.com'], platform: 'win32', ...extra });
const shells = (list) => list.filter((rule) => rule === 'shell' || rule.startsWith('shell('));

// Every system's credential folders and files, and every system's home folders that steer an agent.
const CREDENTIALS = [...new Set(['darwin', 'linux', 'win32'].flatMap((p) => credentialPaths(p)))];
const SHELL_DENIES = ['shell(gh:*)', 'shell(glab:*)', 'shell(git credential:*)', 'shell(git push:*)', 'shell(security:*)', 'shell(copilot:*)'];

test('at sandbox, the shell is allowed: the sandbox holds it', () => {
  const { allow } = rules('sandbox');
  assert.deepEqual(shells(allow), ['shell']);
});

test('at guarded, the shell only as the runner, with the granted commands', () => {
  const { allow, deny } = rules('guarded');
  assert.deepEqual(shells(allow), [`shell(${RUNNER}:*)`, 'shell(npm test:*)', 'shell(npm run build:*)']);
  assert.ok(!allow.includes('shell'));
  assert.ok(!deny.includes(`shell(${RUNNER}:*)`));
  // No runner that can be a rule, or not on Windows (Guarded is Windows' level): the granted commands alone.
  for (const runner of [null, '', 'node x\nrm y', 'x'.repeat(600)]) assert.deepEqual(shells(rules('guarded', { runner }).allow), ['shell(npm test:*)', 'shell(npm run build:*)']);
  assert.deepEqual(shells(rules('guarded', { platform: 'darwin' }).allow), ['shell(npm test:*)', 'shell(npm run build:*)']);
});

test('at ask, only the granted commands', () => {
  assert.deepEqual(shells(rules('ask').allow), ['shell(npm test:*)', 'shell(npm run build:*)']);
  assert.deepEqual(shells(rules('ask', { grants: [] }).allow), []);
  assert.deepEqual(shells(rules('ask', { grants: undefined }).allow), []);
  // A grant that isn't one, or a command no rule can hold, gives nothing.
  const odd = [null, 'npm test', { commands: 'npm test', scope: 'run' }, { commands: ['npm test'], scope: 'forever' }, { commands: ['--yolo', 'npm test && rm -rf ~', ''], scope: 'feature' }];
  assert.deepEqual(shells(rules('ask', { grants: odd }).allow), []);
  // A level Wheelhouse doesn't know is Ask.
  for (const level of [undefined, 'Unattended', 'everything', 7]) assert.deepEqual(rules(level), rules('ask'), String(level));
});

test('at unattended, the shell, and every deny still passed (a deny beats every allow)', () => {
  const unattended = rules('unattended');
  assert.deepEqual(shells(unattended.allow), ['shell']);
  for (const level of LEVELS) assert.deepEqual(rules(level).deny, unattended.deny, level);
});

test('the credential and control-file denies are on every level', () => {
  for (const level of LEVELS) {
    const { deny } = rules(level);
    for (const pattern of AGENT_CONTROL) {
      assert.ok(deny.includes(`write(${pattern})`), `${level}: write(${pattern})`);
    }
    for (const folder of homeControlPaths()) {
      assert.ok(deny.includes(`write(~/${folder})`) && deny.includes(`write(~/${folder}/**)`), `${level}: ~/${folder}`);
    }
    for (const credential of CREDENTIALS) {
      assert.ok(deny.includes(`write(~/${credential})`) && deny.includes(`write(~/${credential}/**)`), `${level}: ~/${credential}`);
    }
    for (const rule of SHELL_DENIES) assert.ok(deny.includes(rule), `${level}: ${rule}`);
    // An untrusted checkout still registers its language servers (check 66), and a builder could start a copilot of
    // its own with every permission (P7-27).
    assert.ok(deny.includes('lsp'), `${level}: lsp`);
    assert.ok(deny.includes('shell(copilot:*)'), `${level}: shell(copilot:*)`);
    // Nothing denied is also allowed, and no rule is one an argument can't carry.
    const { allow } = rules(level);
    assert.deepEqual(allow.filter((rule) => deny.includes(rule)), []);
    for (const rule of [...allow, ...deny]) assert.ok(rule !== '' && rule.length <= 500 && !/[\u0000-\u001f\u007f]/.test(rule), rule);
  }
  // A Windows worktree is a whole path there.
  assert.deepEqual(levelRules({ level: 'ask', worktree: 'C:\\Users\\a\\app\\.worktrees\\add-login', platform: 'win32' }).deny, rules('ask').deny);
  // A worktree that isn't a whole path makes no rules at all.
  for (const worktree of [undefined, '', 'app/.worktrees/x', 7]) assert.throws(() => levelRules({ level: 'ask', worktree, platform: 'darwin' }), /worktree/);
});

test('each level allows the loop\'s tools by name (checks 61 and 63)', () => {
  assert.deepEqual([...LOOP_TOOLS], ['task', 'skill', 'sql', 'read_agent']);
  for (const level of LEVELS) {
    const { allow } = rules(level);
    for (const tool of LOOP_TOOLS) assert.ok(allow.includes(tool), `${level}: ${tool}`);
    // Copilot's apply_patch is held by the write kind (check 61).
    assert.ok(allow.includes('write'), `${level}: write`);
  }
});

test('the web is held to the project\'s domains', () => {
  const { allow } = rules('ask', { domains: ['Example.com ', '*.example.org', 'https://evil.test', '*', '', 7, 'a/b', 'example.com'] });
  assert.deepEqual(allow.filter((rule) => rule.startsWith('url(')), ['url(example.com)', 'url(*.example.org)']);
  assert.deepEqual(rules('ask', { domains: undefined }).allow.filter((rule) => rule.startsWith('url')), []);
});

// The views buildGrants reads, by hand: the feature and one build-command question per grant, answered on this
// computer.
const COMPUTER = 'computer-a';
function viewsWith(answers, { step = 'building' } = {}) {
  const questions = {};
  for (const [questionId, commands, label] of answers) {
    questions[questionId] = {
      question: { data: { work: 'add-login', commands, options: BUILD_QUESTION_OPTIONS.map((o) => ({ ...o })), recommendation: BUILD_QUESTION_LABELS.once, level: 3 } },
      answer: { computer: COMPUTER, at: '2026-10-24T01:00:00.000Z', label },
    };
  }
  return { features: { 'add-login': { data: { step }, began: '2026-10-24T00:00:00.000Z' } }, questions, reports: {} };
}

test('a grant ends when its time ends: a run grant given to one start isn\'t in the next start\'s rules', () => {
  const answers = [['q-1', ['npm test'], BUILD_QUESTION_LABELS.once], ['q-2', ['npm run build'], BUILD_QUESTION_LABELS.feature]];
  const views = viewsWith(answers);
  const startRules = (used, v = views) => shells(levelRules({ level: 'ask', grants: buildGrants({ views: v, work: 'add-login', used, computer: COMPUTER }), worktree: WORKTREE, platform: 'darwin' }).allow);
  // The first start is given both; its run grant is then recorded as used (grants-used.json).
  assert.deepEqual(startRules([]), ['shell(npm test:*)', 'shell(npm run build:*)']);
  // The next start: Allow this time is spent; Allow for this feature lasts.
  assert.deepEqual(startRules(['q-1']), ['shell(npm run build:*)']);
  // Once the feature closes, neither.
  assert.deepEqual(startRules(['q-1'], viewsWith(answers, { step: 'closed' })), []);
});

test('unattended is refused for a real-user project', () => {
  const asked = { level: 'unattended', realUsers: true, keysUnreadable: true, hostApproval: true, unattendedConfirmed: true };
  const refused = levelAllowed(asked);
  assert.equal(refused.ok, false);
  assert.equal(refused.level, 'ask');
  assert.match(refused.why, /real users/);
  // Not known to have none is taken as having them.
  assert.equal(levelAllowed({ ...asked, realUsers: undefined }).level, 'ask');
  // Without its own card, never.
  const unconfirmed = levelAllowed({ ...asked, realUsers: false, unattendedConfirmed: false });
  assert.deepEqual([unconfirmed.ok, unconfirmed.level], [false, 'ask']);
  assert.match(unconfirmed.why, /its own card/);
  assert.deepEqual(levelAllowed({ ...asked, realUsers: false }), { ok: true, level: 'unattended', why: null });
});

test('before the host\'s approval is ready, a level whose test could read the keys becomes ask', () => {
  // Guarded's self-test showed builds can't read the keys: Guarded, with no prompt.
  assert.deepEqual(levelAllowed({ level: 'guarded', keysUnreadable: true, hostApproval: false }), { ok: true, level: 'guarded', why: null });
  // It could read them, or nothing says it couldn't: Ask.
  for (const keysUnreadable of [false, undefined, 'yes']) {
    const answer = levelAllowed({ level: 'guarded', keysUnreadable, hostApproval: false });
    assert.deepEqual([answer.ok, answer.level], [false, 'ask'], String(keysUnreadable));
    assert.match(answer.why, /keys/);
  }
  // The host's approval not given is taken as not ready (scripts/host/approval-ready.js answers false until Part 9).
  assert.equal(levelAllowed({ level: 'guarded', keysUnreadable: false }).level, 'ask');
  // Once it is ready, Guarded holds without the keys' test.
  assert.equal(levelAllowed({ level: 'guarded', keysUnreadable: false, hostApproval: true }).level, 'guarded');
  // The sandbox has no test on this computer until Part 9: Ask, whatever else is so.
  for (const extra of [{}, { keysUnreadable: true }, { keysUnreadable: true, hostApproval: true }]) {
    const sandbox = levelAllowed({ level: 'sandbox', ...extra });
    assert.deepEqual([sandbox.ok, sandbox.level], [false, 'ask']);
    assert.match(sandbox.why, /sandbox hasn't been tested/);
  }
  assert.deepEqual(levelAllowed({ level: 'ask' }), { ok: true, level: 'ask', why: null });
  for (const level of [undefined, null, 'everything', 'Guarded']) {
    const answer = levelAllowed({ level });
    assert.deepEqual([answer.ok, answer.level], [false, 'ask'], String(level));
  }
});

// The calls work the rules out themselves (P7-11), in this file's own temporary Wheelhouse home.
const PROJECT = 'owner__app';
const personHome = () => {
  const dir = tempFolder('wh-copilot-person-');
  fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify({ loggedInUsers: [{ host: 'https://github.com', login: 'someone' }] }));
  return dir;
};
writeSessionHome({ project: PROJECT, target: 'feature-add-login', signedInFrom: personHome(), node: process.execPath, root: ROOT });
const COPILOT = { kind: 'direct', file: 'copilot' };
const CONFIG = { buildCommands: ['npm test', 'npm run'], webDomains: ['example.com'] };
const call = (make, extra = {}) => make({
  project: PROJECT, work: 'add-login', sessionId: 'a1b2c3d4-0000-4000-8000-000000000001', config: CONFIG, prompt: 'Read the brief.',
  worktree: WORKTREE, env: { PATH: '/usr/bin', HOME: '/Users/a' }, copilot: COPILOT, platform: 'darwin', ...extra,
});
const ruleArgs = (args) => args.filter((arg) => arg.startsWith('--allow-tool=') || arg.startsWith('--deny-tool='));
const asArgs = ({ allow, deny }) => [...allow.map((r) => `--allow-tool=${r}`), ...deny.map((r) => `--deny-tool=${r}`)];

test('a start and a wake work out their level\'s rules, and fail closed to ask with no grants', () => {
  for (const make of [featureStartCall, featureResumeCall]) {
    const ask = levelRules({ level: 'ask', grants: [], worktree: WORKTREE, domains: CONFIG.webDomains, platform: 'darwin' });
    // No level, or one that can't be read: Ask with no grants, whatever grants are passed.
    for (const level of [undefined, null, 'everything']) {
      const c = call(make, { level, grants: GRANTS });
      assert.deepEqual(ruleArgs(c.args), asArgs(ask), String(level));
      assert.equal(c.level, 'ask');
    }
    // Rules passed in are never used: the level's are.
    assert.deepEqual(ruleArgs(call(make, { rules: { allow: ['shell'], deny: [] } }).args), asArgs(ask));
    // Ask with grants: each granted command still configured.
    const asked = call(make, { level: 'ask', grants: [...GRANTS, { questionId: 'q-3', commands: ['rm'], scope: 'feature' }] });
    assert.deepEqual(shells(ruleArgs(asked.args).map((a) => a.replace(/^--allow-tool=/, ''))), ['shell(npm test:*)', 'shell(npm run build:*)']);
    // Unattended as levelAllowed decides: Ask for a project with real users, the shell for one confirmed without.
    const refused = call(make, { level: 'unattended', grants: [], realUsers: true, unattendedConfirmed: true });
    assert.deepEqual(ruleArgs(refused.args), asArgs(ask));
    assert.equal(refused.level, 'ask');
    const unattended = call(make, { level: 'unattended', grants: [], realUsers: false, unattendedConfirmed: true });
    assert.deepEqual(ruleArgs(unattended.args), asArgs(levelRules({ level: 'unattended', worktree: WORKTREE, domains: CONFIG.webDomains, platform: 'darwin' })));
    assert.equal(unattended.level, 'unattended');
    // Guarded on Windows, where the keys' test held: the runner's rule.
    const guarded = call(make, { level: 'guarded', grants: [], guardedCommand: RUNNER, keysUnreadable: true, platform: 'win32' });
    assert.ok(guarded.args.includes(`--allow-tool=shell(${RUNNER}:*)`));
    assert.ok(!call(make, { level: 'guarded', grants: [], guardedCommand: RUNNER, keysUnreadable: false, platform: 'win32' }).args.includes(`--allow-tool=shell(${RUNNER}:*)`));
    // The sandbox isn't tested yet: Ask.
    assert.ok(!call(make, { level: 'sandbox', keysUnreadable: true, hostApproval: true }).args.includes('--allow-tool=shell'));
    // A feature session needs its worktree.
    assert.throws(() => call(make, { level: 'ask', worktree: undefined }), /worktree/);
  }
});

test('none of the real copilot, gh or glab ran', () => {
  assert.deepEqual(stand.calls(), []);
});
