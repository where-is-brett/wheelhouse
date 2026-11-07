// tests/scripts/agents/claude-sessions-why.test.js
// The "why" session: a read-only fork of the session that raised a decision (design section 6.3).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { whyCall, ROLE_VARIABLE } from '../../../adapters/claude-code/sessions.js';

const BUILDER = '11111111-2222-3333-4444-555555555555';
const call = (extra = {}) => whyCall({
  sessionId: BUILDER, worktree: '/work/harbour-demo-w-tide-1', question: 'Why weekly?', env: {}, claude: { kind: 'exe', file: '/bin/claude' }, ...extra,
});

test('whyCall forks the session and never resumes the building one directly', () => {
  const c = call();
  const i = c.args.indexOf('--resume');
  assert.ok(i >= 0);
  assert.equal(c.args[i + 1], BUILDER);
  assert.ok(c.args.includes('--fork-session'), 'the resume is always a fork');
  assert.equal(c.args.indexOf('--fork-session'), i + 2, 'the fork flag follows the resume');
  assert.ok(c.args.includes('-p'));
  assert.ok(c.args.includes('Why weekly?'));
  assert.deepEqual(c.args.slice(c.args.indexOf('--output-format'), c.args.indexOf('--output-format') + 2), ['--output-format', 'json']);
  assert.equal(c.cwd, '/work/harbour-demo-w-tide-1');
  assert.equal(c.command, c.file);
  assert.equal(c.env[ROLE_VARIABLE], 'why');
});

test('whyCall allows only read-only tools', () => {
  const c = call();
  const a = c.args.indexOf('--allowedTools');
  assert.equal(c.args[a + 1], 'Read,Grep,Glob');
  assert.ok(c.args[a + 2] === undefined || c.args[a + 2].startsWith('--'), 'nothing else follows the tools as a tool');
  assert.deepEqual(c.args.slice(c.args.indexOf('--permission-mode'), c.args.indexOf('--permission-mode') + 2), ['--permission-mode', 'plan']);
  const tools = c.args.filter((x) => /^(Edit|Write|Bash|MultiEdit|NotebookEdit)\b/.test(x));
  assert.deepEqual(tools, []);
});

test('the role variable of the host session is replaced, never passed on', () => {
  const c = call({ env: { [ROLE_VARIABLE]: 'foreman', PATH: '/bin' } });
  assert.equal(c.env[ROLE_VARIABLE], 'why');
});

test('whyCall refuses a session id that is not a plain id', () => {
  assert.throws(() => call({ sessionId: '--dangerously-skip-permissions' }));
  assert.throws(() => call({ sessionId: '' }));
});
