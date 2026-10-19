// tests/scripts/eval/scenarios-27-33-34.test.js
// The judgements of scenarios 27, 33 and 34, on made-up streams. Models are
// made-up names (model-a and the like), never real ones.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { callsOf, subagentRuns } from '../../../scripts/eval/feature-project.js';
import { locateMattSkills } from '../../../scripts/eval/harness.js';
import { filesWritten, isSourceFile, isTestFile, judge as judge27 } from '../../eval/build-loop/27-bug-route.js';
import { implementers, judge as judge33, routingFrom, sameModel, sessionModel } from '../../eval/build-loop/33-models.js';
import { isReview, judge as judge34 } from '../../eval/build-loop/34-read-only-reviewer.js';

// The events of tool calls, each answered: [name, input, resultText, { isError, parent, id }].
function events(...steps) {
  const out = [];
  steps.forEach(([name, input, text = '', { isError = false, parent = null, id = `t${out.length}` } = {}]) => {
    out.push({ type: 'assistant', parent_tool_use_id: parent, message: { content: [{ type: 'tool_use', id, name, input }] } });
    out.push({ type: 'user', parent_tool_use_id: parent, message: { content: [{ type: 'tool_result', tool_use_id: id, content: [{ type: 'text', text }], is_error: isError }] } });
  });
  return out;
}
const stream = (...steps) => callsOf(events(...steps));

// --- 27 ---

const writeTest = ['Write', { file_path: '/p/duration.test.js', content: "test('65 seconds', ...)" }];
const editTest = ['Edit', { file_path: '/p/duration.test.js', old_string: 'a', new_string: 'b' }];
const fix = ['Edit', { file_path: '/p/duration.js', old_string: "rest === 0 ? '00' : rest", new_string: "String(rest).padStart(2, '0')" }];
const failing = ['Bash', { command: 'node --test' }, 'Exit code 1\n✖ 65 seconds\n# pass 2\n# fail 1', { isError: true }];
const passing = ['Bash', { command: 'node --test' }, '# pass 3\n# fail 0'];
const debugging = ['Skill', { skill: 'superpowers:systematic-debugging' }, 'loaded'];

test('scenario 27 tells test files from source files, and finds files a command writes', () => {
  assert.equal(isTestFile('/p/duration.test.js'), true);
  assert.equal(isTestFile('/p/tests/duration.js'), true);
  assert.equal(isSourceFile('/p/duration.js'), true);
  assert.equal(isSourceFile('/p/duration.test.js'), false);
  assert.equal(isSourceFile('/p/.wheelhouse/feature/report.js'), false);
  assert.equal(isSourceFile('/p/README.md'), false);
  const [redirect, sed, quiet] = stream(
    ['Bash', { command: "printf 'x' > duration.js" }],
    ['Bash', { command: "sed -i '' 's/a/b/' duration.js" }],
    ['Bash', { command: 'node --test 2>&1 > /dev/null' }],
  );
  assert.deepEqual(filesWritten(redirect), ['duration.js']);
  assert.ok(filesWritten(sed).includes('duration.js'));
  assert.deepEqual(filesWritten(quiet), []);
});

test('scenario 27 wants a test written and failing before the first change to a source file', () => {
  const good = judge27({ calls: stream(debugging, editTest, failing, fix, passing) });
  assert.equal(good.pass, true);
  assert.match(good.why, /started systematic-debugging/);
  // A fix first, a test written but never run failing first, or no test at all, fail.
  assert.match(judge27({ calls: stream(fix, writeTest, failing, passing) }).why, /changed duration\.js before writing any test/);
  assert.match(judge27({ calls: stream(writeTest, fix, failing) }).why, /ran no failing test before changing duration\.js/);
  assert.match(judge27({ calls: stream(writeTest, passing, fix) }).why, /ran no failing test/);
  // A failing run before the test was written does not count: it is not the reproduction.
  assert.match(judge27({ calls: stream(failing, writeTest, fix) }).why, /ran no failing test/);
  // A failure shown only in the output still counts, and so does a subagent's work.
  const quietFail = ['Bash', { command: 'npm test' }, '# tests 3\n# pass 2\n# fail 1', { parent: 'b1' }];
  assert.equal(judge27({ calls: stream([...writeTest.slice(0, 2), '', { parent: 'b1' }], quietFail, [...fix.slice(0, 2), '', { parent: 'b1' }]) }).pass, true);
  assert.match(judge27({ calls: stream(writeTest, failing) }).why, /inconclusive: no source file/);
  assert.match(judge27({ calls: stream(fix) }).why, /did not start systematic-debugging/);
});

// --- 33 ---

const init = (model) => ({ type: 'system', subtype: 'init', model });
const result = (...models) => ({ type: 'result', modelUsage: Object.fromEntries(models.map((m) => [m, { inputTokens: 1 }])) });
const builder = (model) => ['Agent', { subagent_type: 'wheelhouse:builder', description: 'Build Task 1', ...(model ? { model } : {}) }, 'done'];
const reviewer = (model) => ['Agent', { subagent_type: 'wheelhouse:reviewer', description: 'Review Task 1', ...(model ? { model } : {}) }, 'CLEAN'];
const ROUTING = { builder: 'model-b', mechanical: 'model-b', reviewer: 'model-c' };

test('scenario 33 reads the routing table from the environment, or refuses plainly', () => {
  assert.deepEqual(routingFrom({ WHEELHOUSE_EVAL_ROUTING: '{"builder":"model-b","reviewer":"model-c"}' }), ROUTING);
  assert.equal(routingFrom({ WHEELHOUSE_EVAL_ROUTING: '{"builder":"model-b","mechanical":"model-d"}' }).mechanical, 'model-d');
  assert.throws(() => routingFrom({}), /needs WHEELHOUSE_EVAL_ROUTING/);
  assert.throws(() => routingFrom({ WHEELHOUSE_EVAL_ROUTING: 'not json' }), /is not JSON/);
  assert.throws(() => routingFrom({ WHEELHOUSE_EVAL_ROUTING: '{"reviewer":"model-c"}' }), /does not name a builder model/);
  assert.equal(sameModel('model-b', 'vendor-model-b-2'), true);
  assert.equal(sameModel('model-b', 'model-c'), false);
  assert.equal(sameModel(null, 'model-b'), false);
  assert.equal(sessionModel([init('model-a')]), 'model-a');
});

test("scenario 33 wants each implementer dispatched with the builder role's model", () => {
  const calls = stream(builder('model-b'), reviewer('model-c'));
  const good = judge33({ calls, routing: ROUTING, session: 'model-a', worked: ['model-a', 'vendor-model-b-1', 'model-c'] });
  assert.equal(good.pass, true);
  assert.match(good.why, /1 of 1 review dispatch/);
  // The session's own model, by leaving the field out, or a model of its own choosing, fails.
  assert.match(judge33({ calls: stream(builder()), routing: ROUTING, session: 'model-a' }).why, /none set/);
  const own = judge33({ calls: stream(builder('model-z')), routing: {}, session: 'model-a', variant: 'without' });
  assert.equal(own.pass, false);
  assert.match(judge33({ calls: stream(builder('model-z')), routing: ROUTING, session: 'model-a', variant: 'without' }).why, /no routing in its brief; the implementer was dispatched with model-z/);
  // A routing table that gives the builder the session's own model cannot show anything.
  assert.match(judge33({ calls, routing: { ...ROUTING, builder: 'model-a', mechanical: 'model-a' }, session: 'model-a' }).why, /inconclusive/);
  assert.match(judge33({ calls: stream(reviewer('model-c')), routing: ROUTING, session: 'model-a' }).why, /no implementer/);
  // Dispatched with the right name, but the model never worked.
  assert.match(judge33({ calls, routing: ROUTING, session: 'model-a', worked: ['model-a'] }).why, /modelUsage shows no work/);
  // A general-purpose implementer counts; a subagent's own dispatch does not.
  const general = stream(['Agent', { description: 'Implement Task 1: limits', model: 'model-b' }, 'done'], ['Agent', { description: 'Look around', model: 'model-z' }, 'x', { parent: 'p1' }]);
  assert.equal(implementers(general).length, 1);
});

// --- 34 ---

const dispatch = (id, type, description) => ['Agent', { ...(type ? { subagent_type: type } : {}), description }, 'report', { id }];
const by = (id, name, input = {}) => [name, input, 'ok', { parent: id }];

test('scenario 34 wants the task reviewed by wheelhouse:reviewer, with no write or command', () => {
  const good = events(dispatch('b1', 'wheelhouse:builder', 'Build Task 1'), by('b1', 'Bash', { command: 'node --test' }), dispatch('r1', 'wheelhouse:reviewer', 'Review Task 1'), by('r1', 'Read', { file_path: '/p/initials.js' }), by('r1', 'Grep', { pattern: 'x' }));
  const passed = judge34({ calls: callsOf(good), runs: subagentRuns(good) });
  assert.equal(passed.pass, true);
  // The builder's own commands do not count against the review.
  assert.match(passed.why, /all 1 review/);
  const general = events(dispatch('b1', 'wheelhouse:builder', 'Build Task 1'), dispatch('r1', null, 'Review Task 1 code quality'), by('r1', 'Bash', { command: 'git diff main' }));
  const failed = judge34({ calls: callsOf(general), runs: subagentRuns(general) });
  assert.equal(failed.pass, false);
  assert.match(failed.why, /a general-purpose subagent/);
  assert.match(failed.why, /1 call\(s\) that write or run a command \(Bash: git diff main/);
  const quiet = events(dispatch('b1', 'wheelhouse:builder', 'Build Task 1'), dispatch('r1', null, 'Review Task 1'), by('r1', 'Read', {}));
  assert.match(judge34({ calls: callsOf(quiet), runs: subagentRuns(quiet) }).why, /general-purpose subagent.*no write and ran no command/);
  const writer = events(dispatch('b1', 'wheelhouse:builder', 'Build Task 1'), dispatch('r1', 'wheelhouse:reviewer', 'Review Task 1'), by('r1', 'Edit', { file_path: '/p/initials.js' }));
  assert.match(judge34({ calls: callsOf(writer), runs: subagentRuns(writer) }).why, /\(Edit\)/);
  const later = events(dispatch('b1', 'wheelhouse:builder', 'Build Task 1'), dispatch('r1', 'wheelhouse:reviewer', 'Review Task 1'), dispatch('r2', null, 'Final whole-branch review'));
  assert.match(judge34({ calls: callsOf(later), runs: subagentRuns(later) }).why, /1 other review\(s\) were general-purpose/);
  // A fix sent after a review is not a review, and its writes are not a reviewer's.
  const fixWave = events(dispatch('b1', 'wheelhouse:builder', 'Build Task 1'), dispatch('r1', 'wheelhouse:reviewer', 'Review Task 1'), dispatch('f1', null, 'Final-review fix wave'), by('f1', 'Write', { file_path: '/p/initials.js' }), dispatch('r2', null, 'Scoped re-review of fix wave'));
  const judged = judge34({ calls: callsOf(fixWave), runs: subagentRuns(fixWave) });
  assert.match(judged.why, /1 other review\(s\) were general-purpose subagents; the reviews made no write/);
  assert.equal(isReview({ type: 'general-purpose', description: 'Re-review initials fix round 1' }), true);
  assert.equal(isReview({ type: 'general-purpose', description: 'Fix review findings' }), false);
  assert.equal(isReview({ type: 'general-purpose', description: 'Final whole-branch review' }), true);
  const none = events(dispatch('b1', 'wheelhouse:builder', 'Build Task 1'));
  assert.match(judge34({ calls: callsOf(none), runs: subagentRuns(none) }).why, /never reviewed/);
});

test("the reviewer agent's tool list holds no tool that writes or runs a command", () => {
  const text = fs.readFileSync(new URL('../../../agents/reviewer.md', import.meta.url), 'utf8');
  const tools = /^tools:\s*(.+)$/m.exec(text)[1].split(',').map((t) => t.trim());
  assert.deepEqual(tools, ['Read', 'Grep', 'Glob']);
});

test("locateMattSkills finds a recorded install first, else the newest synced copy", () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'matt-home-'));
  const plugins = path.join(home, '.claude', 'plugins');
  const copy = (folder, name = 'mattpocock-skills') => {
    const dir = path.join(plugins, 'synced', 'catalogue', folder);
    fs.mkdirSync(path.join(dir, '.claude-plugin'), { recursive: true });
    fs.writeFileSync(path.join(dir, '.claude-plugin', 'plugin.json'), JSON.stringify({ name }));
    return dir;
  };
  assert.throws(() => locateMattSkills({ home, env: {} }), /No copy of Matt Pocock's skills/);
  copy('other', 'something-else');
  copy('abc~g2');
  const synced = copy('abc');
  assert.equal(locateMattSkills({ home, env: {} }), synced);
  const installed = path.join(home, 'installed');
  fs.mkdirSync(installed);
  fs.writeFileSync(path.join(plugins, 'installed_plugins.json'), JSON.stringify({ plugins: { 'mattpocock-skills@market': [{ installPath: installed }] } }));
  assert.equal(locateMattSkills({ home, env: {} }), installed);
  fs.rmSync(home, { recursive: true, force: true });
});
