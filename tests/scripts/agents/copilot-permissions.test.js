// tests/scripts/agents/copilot-permissions.test.js
// Each level's permission rules for a Copilot session, and which level may run. Every rule list is built and read
// here; no Copilot runs and nothing is spent.
import '../../helpers/homes.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LEVELS } from '../../../scripts/agents/copilot/numbers.js';
import { AGENT_CONTROL, homeControlPaths, homeGitSettingsPaths, systemGitSettingsPaths } from '../../../scripts/lib/agent-control.js';
import { credentialPaths } from '../../../scripts/lib/credentials.js';
import { wheelhouseHome } from '../../../scripts/lib/paths.js';
import { projectSettings } from '../../../scripts/protection/settings.js';
import { LOOP_TOOLS, SHELL_DENIES, levelAllowed, levelRules } from '../../../adapters/copilot/permissions.js';

const WORKTREE = '/home/a/projects/app/.worktrees/add-login';
const RUNNER = '"/home/a/.wheelhouse/windows/low-node/node.exe" "/plugin/scripts/windows/run-low.js"';
const GRANTS = [
  { questionId: 'q-1', commands: ['npm test'], scope: 'run' },
  { questionId: 'q-2', commands: ['npm run build'], scope: 'feature' },
];
const BUILD_COMMANDS = ['npm test', 'npm run', 'node', 'npx', 'git', 'npx wrangler', 'npx wranglerish'];
const rules = (level, extra = {}) => levelRules({ level, grants: GRANTS, buildCommands: BUILD_COMMANDS, runner: RUNNER, worktree: WORKTREE, domains: ['example.com'], platform: 'win32', ...extra });
const shells = (list) => list.filter((rule) => rule === 'shell' || rule.startsWith('shell('));

// Every command today's Claude Code project settings deny, as the Copilot rule it must have.
const CLAUDE_BASH_DENIES = projectSettings({ webDomains: [] }).permissions.deny.filter((r) => /^Bash\(.+\)$/s.test(r));
const copilotRule = (bash) => `shell(${bash.slice('Bash('.length)}`;
const commandOf = (rule) => rule.slice('shell('.length, -1).replace(/(:\*|@\*)$/, '');
// A grant for every command a deny names, so every deny is reachable at the levels that pass only reachable ones.
const REACH_COMMANDS = [...CLAUDE_BASH_DENIES.map((r) => commandOf(copilotRule(r))), 'git', 'security'];
const REACH_ALL = [{ questionId: 'q-all', commands: REACH_COMMANDS, scope: 'feature' }];

test('each of Claude Code\'s shell denies has its Copilot rule', () => {
  assert.ok(CLAUDE_BASH_DENIES.length > 100, 'the settings\' deny list was read');
  for (const bash of CLAUDE_BASH_DENIES) assert.ok(SHELL_DENIES.includes(copilotRule(bash)), bash);
  for (const bash of ['Bash(gh:*)', 'Bash(glab:*)', 'Bash(git push:*)', 'Bash(wrangler:*)', 'Bash(npx wrangler:*)', 'Bash(npx wrangler@*)']) assert.ok(CLAUDE_BASH_DENIES.includes(bash), bash);
  assert.ok(!CLAUDE_BASH_DENIES.some((r) => /\bcopilot\b/.test(r)), 'the extras below are Copilot\'s own');
  for (const extra of ['shell(git credential:*)', 'shell(security:*)', 'shell(copilot:*)']) assert.ok(SHELL_DENIES.includes(extra), extra);
});

test('every level passes every one of those rules where its allows could reach it, the shell allowed whole passes all', () => {
  for (const level of LEVELS) {
    const { deny } = rules(level, { grants: REACH_ALL, buildCommands: REACH_COMMANDS });
    for (const bash of CLAUDE_BASH_DENIES) assert.ok(deny.includes(copilotRule(bash)), `${level}: ${bash}`);
    for (const rule of SHELL_DENIES) assert.ok(deny.includes(rule), `${level}: ${rule}`);
    assert.equal(deny.filter((r) => r.startsWith('shell(')).length, SHELL_DENIES.length, level);
  }
  for (const level of ['sandbox', 'unattended']) {
    const { allow, deny } = rules(level, { grants: [] });
    assert.deepEqual(shells(allow), ['shell']);
    for (const rule of SHELL_DENIES) assert.ok(deny.includes(rule), `${level}: ${rule}`);
  }
});

test('the shell allows follow the level', () => {
  assert.deepEqual(shells(rules('guarded').allow), [`shell(${RUNNER}:*)`, 'shell(npm test:*)', 'shell(npm run build:*)']);
  assert.deepEqual(shells(rules('ask').allow), ['shell(npm test:*)', 'shell(npm run build:*)']);
  assert.deepEqual(shells(rules('ask', { grants: [] }).allow), []);
  const odd = [null, 'npm test', { commands: 'npm test', scope: 'run' }, { commands: ['npm test'], scope: 'forever' }, { commands: ['--yolo', 'npm test && rm -rf ~', ''], scope: 'feature' }];
  assert.deepEqual(shells(rules('ask', { grants: odd }).allow), []);
  // A grant for a command the project doesn't configure gives nothing.
  assert.deepEqual(shells(rules('ask', { grants: [{ commands: ['rm -rf'], scope: 'feature' }] }).allow), []);
  for (const level of [undefined, 'Unattended', 'everything', 7]) assert.deepEqual(rules(level), rules('ask'), String(level));
});

test('no wide switch can be produced', () => {
  const crafted = {
    grants: [
      ...GRANTS,
      { commands: ['*', 'shell', '--allow-all', '--allow-all-tools', '--yolo', 'npm test:*', 'npm test, shell', 'gh)', 'a;b', 'x && y', '$(y)', ''], scope: 'feature' },
      { commands: ['git'], scope: 'run' },
    ],
    domains: ['*', '*.*', 'x),shell,url(y', 'a.com)', 'a,b.com', 'localhost', 'https://x.test', 'example.com', 'url', '*.example.org'],
  };
  const wide = /^(\*|shell\(\*\)|shell\(:\*\)|shell\(\*:\*\)|url\(\*\)|write\(\*\)|--allow-all.*|--yolo)$/;
  for (const level of [...LEVELS, undefined, null, 'everything', 'all', 7]) {
    for (const runner of [RUNNER, '*', null, 'x)']) {
      let result;
      try {
        result = levelRules({ level, runner, worktree: WORKTREE, platform: 'win32', ...crafted });
      } catch (e) {
        assert.match(e.message, /can't name safely/);
        continue;
      }
      const { allow, deny } = result;
      for (const rule of allow) {
        assert.ok(!wide.test(rule), `${level}: ${rule}`);
        assert.ok(!/^--/.test(rule), `${level}: ${rule}`);
        assert.ok(/^(write|task|skill|sql|read_agent|shell(\(.+:\*\))?|url\([a-z0-9*.-]+\))$/.test(rule), `${level}: ${rule}`);
        assert.ok(!deny.includes(rule), `${level}: ${rule} is also denied`);
      }
      // The bare shell appears only at the two levels that allow it whole, and then every shell deny is passed.
      if (allow.includes('shell')) {
        assert.ok(['sandbox', 'unattended'].includes(level), String(level));
        for (const rule of SHELL_DENIES) assert.ok(deny.includes(rule), `${level}: ${rule}`);
      }
      // A granted command never undoes a deny: every deny whose command begins with an allow's, or the reverse, is passed.
      for (const rule of shells(allow).filter((r) => r !== 'shell')) {
        const a = commandOf(rule);
        for (const d of SHELL_DENIES) {
          const b = commandOf(d);
          if (b.startsWith(a) || a.startsWith(b)) assert.ok(deny.includes(d), `${level}: ${rule} against ${d}`);
        }
      }
      // No wildcard url rule, and a domain with a bracket or comma is dropped.
      assert.deepEqual(allow.filter((r) => r.startsWith('url(')), ['url(example.com)', 'url(*.example.org)']);
    }
  }
});

test('a granted command that a deny reaches brings the deny', () => {
  const at = (level, commands) => rules(level, { grants: [{ commands, scope: 'feature' }] }).deny.filter((r) => r.startsWith('shell('));
  for (const rule of ['shell(npx wrangler:*)', 'shell(npx wrangler@*)', 'shell(npx vercel:*)']) assert.ok(at('ask', ['npx']).includes(rule), rule);
  assert.ok(at('ask', ['npx wrangler deploy']).includes('shell(npx wrangler:*)'));
  assert.ok(at('ask', ['npx wranglerish']).includes('shell(npx wrangler:*)'));
  for (const rule of ['shell(git push:*)', 'shell(git credential:*)']) assert.ok(at('ask', ['git']).includes(rule), rule);
  assert.deepEqual(at('ask', ['npm test']), ['shell(copilot:*)']);
  assert.deepEqual(at('guarded', ['npm test']), ['shell(copilot:*)']);
  for (const level of LEVELS) assert.ok(at(level, []).includes('shell(copilot:*)'), level);
});

test('the credential and control-file denies are on every level', () => {
  const credentials = [...new Set(['darwin', 'linux', 'win32'].flatMap((p) => credentialPaths(p)))];
  const home = wheelhouseHome().replace(/\\/g, '/');
  for (const level of LEVELS) {
    const { deny, allow } = rules(level);
    for (const pattern of AGENT_CONTROL) assert.ok(deny.includes(`write(${pattern})`), `${level}: ${pattern}`);
    for (const folder of homeControlPaths()) assert.ok(deny.includes(`write(~/${folder})`) && deny.includes(`write(~/${folder}/**)`), `${level}: ${folder}`);
    for (const f of homeGitSettingsPaths()) assert.ok(deny.includes(`write(~/${f})`), `${level}: ~/${f}`);
    for (const f of systemGitSettingsPaths()) assert.ok(deny.includes(`write(/${f})`), `${level}: /${f}`);
    for (const c of credentials) assert.ok(deny.includes(`write(~/${c})`) && deny.includes(`write(~/${c}/**)`), `${level}: ${c}`);
    for (const folder of ['~/.wheelhouse', home, '~/.claude']) assert.ok(deny.includes(`write(${folder})`) && deny.includes(`write(${folder}/**)`), `${level}: ${folder}`);
    for (const file of ['.claude/settings.json', '.claude/settings.local.json', '.claude/hooks/**']) assert.ok(deny.includes(`write(${file})`), `${level}: ${file}`);
    assert.ok(deny.includes('lsp'), level);
    for (const tool of LOOP_TOOLS) assert.ok(allow.includes(tool), `${level}: ${tool}`);
    assert.ok(allow.includes('write'), level);
    for (const rule of [...allow, ...deny]) assert.ok(rule !== '' && rule.length <= 500 && !/[\u0000-\u001f\u007f]/.test(rule), rule);
  }
  const notShell = (list) => list.filter((r) => !r.startsWith('shell('));
  for (const level of LEVELS) assert.deepEqual(notShell(rules(level).deny), notShell(rules('unattended').deny), level);
  for (const worktree of [undefined, '', 'app/.worktrees/x', 7]) assert.throws(() => levelRules({ level: 'ask', worktree, platform: 'darwin' }), /worktree/);
});

test('the web is held to the project\'s domains, and a runner that could break its rule is refused', () => {
  const { allow } = rules('ask', { domains: ['Example.com ', '*.example.org', 'https://evil.test', '*', '', 7, 'a/b'] });
  assert.deepEqual(allow.filter((r) => r.startsWith('url(')), ['url(example.com)', 'url(*.example.org)']);
  for (const runner of ['*', 'node *', 'node.exe x.js,shell', '"C:/Program Files (x86)/n/node.exe" x.js', 'x)']) assert.throws(() => rules('guarded', { runner }), /can't name safely/, runner);
  assert.doesNotThrow(() => rules('ask', { runner: '*' }));
});

test('unattended and the sandbox run only when their conditions are plainly met', () => {
  const asked = { level: 'unattended', realUsers: false, unattendedConfirmed: true };
  assert.deepEqual(levelAllowed(asked), { ok: true, level: 'unattended', why: null });
  for (const extra of [{ realUsers: true }, { realUsers: undefined }, { unattendedConfirmed: false }]) {
    const answer = levelAllowed({ ...asked, ...extra });
    assert.deepEqual([answer.ok, answer.level], [false, 'ask']);
  }
  assert.equal(levelAllowed({ level: 'sandbox' }).level, 'ask');
  assert.equal(levelAllowed({ level: 'sandbox', sandbox: true }).level, 'sandbox');
  assert.equal(levelAllowed({ level: 'guarded', keysUnreadable: true, hostApproval: false, platform: 'darwin' }).level, 'ask');
  assert.equal(levelAllowed({ level: 'guarded', keysUnreadable: true, hostApproval: false, platform: 'win32' }).level, 'guarded');
  assert.equal(levelAllowed({ level: 'guarded', keysUnreadable: false, hostApproval: false, platform: 'win32' }).level, 'ask');
  for (const level of [undefined, null, 'everything', 'Guarded']) assert.equal(levelAllowed({ level }).level, 'ask', String(level));
  assert.deepEqual(levelAllowed({ level: 'ask' }), { ok: true, level: 'ask', why: null });
});
