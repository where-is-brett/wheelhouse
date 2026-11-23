// tests/scripts/agents/copilot/feature-commands.test.js
// The guard: every shell command a Copilot feature session is told to run is one its rules allow at Ask with no grants.
// The feature brief is rendered as a session gets it (launcher form), with the builder and reviewer agent files; each command
// they tell the session to run is taken out and matched as Copilot matches a rule, the whole command against a prefix rule
// `shell(x:*)`. The evaluations never caught a command no rule allowed, because eval-runner.js's rulesFor adds each
// scenario's own commands as rules; this test adds none.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildHome } from '../../../../scripts/agents/copilot/home.js';
import { renderBrief } from '../../../../scripts/feature/brief.js';
import { LAUNCHER_COMMAND } from '../../../../scripts/lib/launchers.js';
import { BUILDER_RULES_FILE, featureAllow, featureRules } from '../../../../adapters/copilot/sessions.js';
import { briefFields } from '../../../helpers/foreman.js';

// A POSIX path, to go with the 'linux' these tests pass; the 'win32' one also takes a rooted path.
const WORKTREE = '/tmp/wt';
const LANES = ['feature', 'small', 'bug', 'quick'];
const BUILDS = [null, { level: 'ask', guardedCommand: null, shape: 1 }, { level: 'unattended', guardedCommand: null, shape: 1 }];

// What starts a shell command, as a span of backticks or a line of a block that holds one.
const COMMAND_WORD = /^(git|node|npm|npx|wh-[a-z]+|mkdir|New-Item|Get-Content|Test-Path|Out-Null|cd|ls|cat|rm|pwd|gh|curl|python3?|pip|echo|powershell|pwsh|bash|sh)(\s|$)/;
// A command a sentence forbids ("never run `git`"), which is no instruction to run it.
const FORBIDDEN = /\b(never|don't|do not)\b[^.]*$/i;
const FORBIDDEN_WORD = /^(git|mkdir|New-Item)(\s|$)/;

// Every command `text` tells the session to run: the lines of a block with no language or a shell's, and the backticked
// spans that start with a command word, but for a forbidden one.
export function commandsIn(text) {
  const found = [];
  const blocks = /```([a-z]*)\n([\s\S]*?)\n```/g;
  let rest = text;
  for (const m of text.matchAll(blocks)) {
    if (['', 'sh', 'bash', 'powershell', 'shell'].includes(m[1])) found.push(...m[2].split('\n').map((l) => l.trim()).filter((l) => COMMAND_WORD.test(l)));
  }
  rest = rest.replace(blocks, '');
  for (const m of rest.matchAll(/`([^`\n]+)`/g)) {
    const span = m[1].trim();
    if (!COMMAND_WORD.test(span)) continue;
    const before = rest.slice(0, m.index).split(/\.\s|\n/).at(-1);
    if (FORBIDDEN_WORD.test(span) && FORBIDDEN.test(before)) continue;
    found.push(span);
  }
  return found;
}

// Whether Copilot would allow `command` under `allow`: a rule `shell` allows every command, `shell(x:*)` one that is x or
// starts with x and a space, and a command chained or piped is one command to Copilot, so no prefix rule reaches its tail.
export function allowedBy(command, allow) {
  if (allow.includes('shell')) return true;
  if (/[;|&`\n]|\$\(/.test(command.replace(/'[^']*'/g, "''"))) return false;
  return allow.some((rule) => {
    const m = /^shell\((.+):\*\)$/.exec(rule);
    return m !== null && (command === m[1] || command.startsWith(`${m[1]} `));
  });
}

const renderedBriefs = () => LANES.flatMap((lane) => BUILDS.map((windowsBuilds) => ({
  name: `the ${lane} brief, ${windowsBuilds === null ? 'off Windows' : `Windows ${windowsBuilds.level}`}`,
  text: renderBrief({ fields: briefFields('login', { lane }), pluginRoot: '/plugin', windowsBuilds, launchers: true }),
})));

const askRules = () => featureRules({ config: null, level: 'ask', grants: [], worktree: WORKTREE, platform: 'linux' }).rules.allow;

// A command as the session would type it: each `<placeholder>` filled in.
const typed = (command) => command.replace(/<[^>]*>/g, 'x');

test('every command the Copilot feature brief and agent files tell a session to run is allowed at Ask with no grants', () => {
  const allow = askRules();
  const home = buildHome();
  const texts = [...renderedBriefs(), { name: 'the builder agent file', text: home.get('agents/wheelhouse-builder.agent.md') }, { name: 'the reviewer agent file', text: home.get('agents/wheelhouse-reviewer.agent.md') }];
  const refused = [];
  let seen = 0;
  for (const { name, text } of texts) {
    for (const command of commandsIn(text)) {
      seen += 1;
      if (!allowedBy(typed(command), allow)) refused.push(`${name}: ${command}`);
    }
  }
  assert.ok(seen > 40, `the commands were found (${seen})`);
  assert.deepEqual([...new Set(refused)], []);
});

test('the launcher\'s commands in the brief fit the launcher\'s grammar, and each is the feature command', () => {
  for (const { name, text } of renderedBriefs()) {
    const commands = commandsIn(text).filter((c) => c.startsWith('wh-'));
    assert.ok(commands.length > 10, name);
    for (const command of commands) {
      assert.ok(command.startsWith('wh-feature'), `${name}: ${command}`);
      assert.match(typed(command), LAUNCHER_COMMAND, `${name}: ${command}`);
    }
  }
});

test('the brief names the git steps as feature commands, and no git or node command is left', () => {
  const [{ text }] = renderedBriefs();
  for (const word of ['wh-feature diff <n>', 'wh-feature pull --default', 'wh-feature commit', 'wh-feature head']) assert.ok(text.includes(word), word);
  const left = commandsIn(text).filter((c) => /^(git|node|mkdir)\b/.test(c));
  assert.deepEqual(left, []);
  assert.ok(!text.includes('cli.js'), 'no path to the script');
});

test('the checker sees what Claude Code\'s brief tells a session to run, none of it allowed at Ask', () => {
  const text = renderBrief({ fields: briefFields('login', { lane: 'feature' }), pluginRoot: '/plugin' });
  const commands = commandsIn(text);
  assert.ok(commands.some((c) => c.startsWith('git ')), 'it holds git commands');
  assert.ok(commands.some((c) => c.startsWith('node ')), 'it holds node commands');
  const allow = askRules();
  assert.ok(commands.filter((c) => !allowedBy(typed(c), allow)).length > 5);
});

test('a chained command is not allowed by a prefix rule, and a whole-shell rule allows anything', () => {
  const allow = askRules();
  assert.equal(allowedBy('wh-feature commit', allow), true);
  assert.equal(allowedBy('wh-feature commit; git push', allow), false);
  assert.equal(allowedBy('wh-feature commit && git push', allow), false);
  assert.equal(allowedBy('git status', allow), false);
  assert.equal(allowedBy('wh-featurex commit', allow), false);
  assert.equal(allowedBy('git status', ['shell']), true);
});

test('feature sessions are allowed the feature launcher at every level, and the record must name it alone', () => {
  for (const level of ['ask', 'guarded', 'unattended', 'sandbox', 'unknown']) {
    const rules = featureRules({ config: null, level, grants: [], worktree: WORKTREE, platform: level === 'guarded' ? 'win32' : 'linux', guardedCommand: 'C:\\runner.exe' });
    assert.ok(rules.rules.allow.includes('shell(wh-feature:*)'), level);
  }
  assert.deepEqual(featureAllow(), ['shell(wh-feature:*)']);
  assert.deepEqual(JSON.parse(fs.readFileSync(BUILDER_RULES_FILE, 'utf8')), { agent: 'wheelhouse-builder', shell: ['bash', 'powershell'], allow: ['wh-feature:*'] });
  // At Ask the shell allows that and the granted commands, nothing else.
  assert.deepEqual(askRules().filter((r) => r.startsWith('shell')), ['shell(wh-feature:*)']);
  assert.deepEqual(featureRules({ config: null, level: 'ask', grants: [{ scope: 'feature', commands: ['npm test'] }], worktree: WORKTREE, platform: 'linux' }).rules.allow.filter((r) => r.startsWith('shell')).sort(), ['shell(npm test:*)', 'shell(wh-feature:*)']);
});

test('a rule record that allows more, less or another command refuses the start', () => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'wh-builder-rules-'));
  try {
    const write = (record) => {
      const file = path.join(folder, 'rules.json');
      fs.writeFileSync(file, typeof record === 'string' ? record : JSON.stringify(record));
      return file;
    };
    assert.throws(() => featureAllow({ rulesFile: path.join(folder, 'missing.json') }), /can't be read/);
    assert.throws(() => featureAllow({ rulesFile: write('{') }), /can't be read/);
    for (const record of [
      { agent: 'wheelhouse-builder', allow: [] },
      { agent: 'wheelhouse-builder', allow: ['wh-feature:*', 'wh-act:*'] },
      { agent: 'wheelhouse-builder', allow: ['wh-act:*'] },
      { agent: 'wheelhouse-builder', allow: ['node:*'] },
      { agent: 'wheelhouse-foreman', allow: ['wh-feature:*'] },
      { allow: ['wh-feature:*'] },
      null,
    ]) assert.throws(() => featureAllow({ rulesFile: write(record) }), /allows more or less than its feature command/);
    assert.throws(() => featureRules({ config: null, level: 'ask', grants: [], worktree: WORKTREE, platform: 'linux', rulesFile: write({ agent: 'wheelhouse-builder', allow: ['sh:*'] }) }), /no feature session is started/);
    assert.deepEqual(featureAllow({ rulesFile: write({ agent: 'wheelhouse-builder', allow: ['wh-feature:*'] }) }), ['shell(wh-feature:*)']);
  } finally {
    fs.rmSync(folder, { recursive: true, force: true });
  }
});
