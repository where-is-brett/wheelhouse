// tests/probes/60-other-hooks/run.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { tempFolder } from '../../helpers/homes.js';
import { answerFor, promptOf, sentence } from '../../../probes/60-other-hooks/hook.js';
import {
  CHECK, MARKER_PROMPT, SPELLINGS, assistantText, compactionEventTypes, compactionHappened, copilotArgs, countHooks, eventName, fieldTable,
  hookCommand, hookFiles, main, makeMarkers, markerOutcomes, parseOptions, preCompactRan, projectFiles, subagentFindings, summarise,
} from '../../../probes/60-other-hooks/run.js';

const unix = process.platform !== 'win32';
const t = unix ? test : test.skip;
const dir = (name) => fileURLToPath(new URL(`../../../probes/60-other-hooks/${name}`, import.meta.url));
const runHook = (log, args, input, env) => spawnSync(process.execPath, [dir('hook.js'), log, ...args], { input: JSON.stringify(input), encoding: 'utf8', ...(env ? { env } : {}) });
const lines = (file) => fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line));

test('a hook answers through the field it is told to, and only then', () => {
  const base = { event: 'sessionStart', token: 'WHMARK-aa', input: { prompt: 'hello' } };
  assert.deepEqual(JSON.parse(answerFor({ ...base, mode: 'marker', field: 'additionalContext' })), { additionalContext: sentence('WHMARK-aa') });
  assert.deepEqual(JSON.parse(answerFor({ ...base, mode: 'marker', field: 'hookSpecific' })), { hookSpecificOutput: { hookEventName: 'sessionStart', additionalContext: sentence('WHMARK-aa') } });
  assert.deepEqual(JSON.parse(answerFor({ ...base, mode: 'marker', field: 'systemMessage' })), { systemMessage: sentence('WHMARK-aa') });
  assert.equal(answerFor({ ...base, mode: 'marker', field: 'plain' }), sentence('WHMARK-aa'));
  assert.equal(JSON.parse(answerFor({ ...base, mode: 'marker', field: 'modifiedPrompt' })).modifiedPrompt, `hello\n\n${sentence('WHMARK-aa')}`);
  assert.equal(answerFor({ ...base, input: {}, mode: 'marker', field: 'modifiedPrompt' }), null);
  assert.equal(answerFor({ ...base, mode: 'marker', field: 'nope' }), null);
  assert.equal(answerFor({ ...base, mode: 'log', field: '' }), null);
  assert.equal(JSON.parse(answerFor({ ...base, mode: 'block' })).decision, 'block');
  assert.equal(promptOf({ userPrompt: 'x' }), 'x');
  assert.equal(promptOf({}), null);
});

t('the hook logs its input and keeps no value of the caller\'s environment, then answers as its mode says', () => {
  const log = path.join(tempFolder('wh-hook60-'), 'h.jsonl');
  const env = { ...process.env, CLAUDE_PROJECT_DIR: '/secret/place', COPILOT_CLI_BINARY_VERSION: '9.9.9' };
  let result = runHook(log, ['camel:plain', 'sessionStart', 'marker', 'plain', 'WHMARK-1'], { sessionId: 's' }, env);
  assert.equal(result.status, 0);
  assert.equal(result.stdout.trim(), sentence('WHMARK-1'));
  const [entry] = lines(log);
  assert.deepEqual(entry.input, { sessionId: 's' });
  assert.equal(entry.tag, 'camel:plain');
  assert.equal(entry.env.CLAUDE_PROJECT_DIR, '[set]');
  assert.equal(entry.env.COPILOT_CLI_BINARY_VERSION, '9.9.9');
  result = runHook(log, ['camel:log', 'preCompact', 'block'], {});
  assert.equal(result.status, 0);
  assert.equal(JSON.parse(result.stdout).decision, 'block');
  assert.equal(runHook(log, ['camel:log', 'preCompact', 'exit2'], {}).status, 2);
  assert.equal(runHook(log, ['camel:log', 'preCompact', 'log'], {}).stdout, '');
  const bad = spawnSync(process.execPath, [dir('hook.js'), log, 't', 'e'], { input: 'not json', encoding: 'utf8' });
  assert.equal(bad.status, 0);
  assert.deepEqual(lines(log).at(-1).input, { unparsed: 'not json' });
});

test('makeMarkers gives each spelling, event and field a code of its own', () => {
  let n = 0;
  const markers = makeMarkers(() => String(n++).padStart(6, '0'));
  assert.equal(markers.length, 8 + 15);
  assert.equal(new Set(markers.map((m) => m.token)).size, markers.length);
  assert.ok(markers.every((m) => /^WHMARK-\d{6}$/.test(m.token)));
  assert.deepEqual(markers.filter((m) => m.spelling === 'claude').map((m) => m.event), Array(5).fill('UserPromptSubmit'));
  assert.ok(!markers.some((m) => m.kind === 'session' && m.field === 'modifiedPrompt'));
  assert.equal(eventName('pascal', 'userPromptSubmitted'), 'UserPromptSubmitted');
  assert.equal(eventName('claude', 'sessionStart'), null);
  assert.equal(makeMarkers().length, 23);
});

test('the hook files register logging for every event and markers on the two events, and only the chosen spelling acts on preCompact', () => {
  const markers = makeMarkers(() => 'abc');
  const files = hookFiles({ hook: '/h.js', log: '/l.jsonl', markers, compactMode: 'block', compactActs: 'pascal' });
  assert.deepEqual(Object.keys(files), SPELLINGS.map((s) => `probe-${s}.json`));
  const camel = files['probe-camel.json'].hooks;
  assert.equal(camel.sessionStart.length, 1 + 4);
  assert.equal(camel.userPromptSubmitted.length, 1 + 5);
  assert.equal(camel.preCompact[0].bash, 'node "/h.js" "/l.jsonl" camel:log preCompact log');
  assert.equal(files['probe-pascal.json'].hooks.PreCompact[0].bash, 'node "/h.js" "/l.jsonl" pascal:log PreCompact block');
  assert.deepEqual(Object.keys(files['probe-claude.json'].hooks), ['UserPromptSubmit']);
  assert.equal(camel.sessionStart[1].bash, 'node "/h.js" "/l.jsonl" camel:additionalContext sessionStart marker additionalContext WHMARK-abc');
  assert.equal(camel.sessionStart[1].timeoutSec, 30);
  assert.equal(camel.sessionStart[1].powershell, camel.sessionStart[1].bash);
  const plain = hookFiles({ hook: '/h.js', log: '/l' });
  assert.equal(plain['probe-camel.json'].hooks.sessionStart.length, 1);
  assert.equal(hookCommand({ log: '/l', tag: 'x', event: 'e' }).endsWith(' x e log'), true);
});

test('the arguments allow all tools, trust the folder (not on a resumed run, which Copilot refuses), and add --resume only for a resumed run', () => {
  const args = copilotArgs({ prompt: 'p', logDir: '/logs' });
  for (const flag of ['--allow-all-tools', '--trust-folder', '--no-ask-user', '--output-format']) assert.ok(args.includes(flag), flag);
  assert.ok(!copilotArgs({ prompt: 'p', logDir: '/l', resume: 'abc' }).includes('--trust-folder'));
  assert.equal(args[args.indexOf('--log-level') + 1], 'debug');
  assert.ok(!args.some((arg) => arg.startsWith('--resume')));
  assert.ok(copilotArgs({ prompt: 'p', logDir: '/l', resume: 'abc' }).includes('--resume=abc'));
  assert.match(MARKER_PROMPT, /WHMARK/);
  assert.ok(projectFiles()[path.join('.github', 'agents', 'probe-agent.agent.md')].includes('name: probe-agent'));
});

test('the analysis reads markers, compaction and subagent hooks from events and the hook log', () => {
  const markers = [
    { id: 'camel/session/additionalContext', spelling: 'camel', kind: 'session', event: 'sessionStart', field: 'additionalContext', token: 'WHMARK-1' },
    { id: 'pascal/prompt/plain', spelling: 'pascal', kind: 'prompt', event: 'UserPromptSubmitted', field: 'plain', token: 'WHMARK-2' },
    { id: 'claude/prompt/plain', spelling: 'claude', kind: 'prompt', event: 'UserPromptSubmit', field: 'plain', token: 'WHMARK-3' },
    { id: 'camel/prompt/plain', spelling: 'camel', kind: 'prompt', event: 'userPromptSubmitted', field: 'plain', token: 'WHMARK-4' },
  ];
  const entries = [
    { tag: 'camel:additionalContext', event: 'sessionStart', phase: undefined, input: {} },
    { tag: 'pascal:plain', event: 'UserPromptSubmitted', input: {} },
    { tag: 'claude:plain', event: 'UserPromptSubmit', input: {} },
    { tag: 'camel:log', event: 'preCompact', input: {} },
    { tag: 'camel:log', event: 'subagentStart', input: { agentName: 'probe-agent' } },
    { tag: 'camel:log', event: 'subagentStop', input: { agentName: 'probe-agent', n: 1 } },
    { tag: 'pascal:log', event: 'SubagentStop', input: { sessionId: 's' } },
  ];
  const events = [
    { type: 'user.message', data: { content: 'x WHMARK-2' } },
    { type: 'assistant.message', data: { content: 'WHMARK-1 came with a sentence' } },
    { type: 'session.compaction_start', data: {} },
    { type: 'session.compaction_complete', data: { success: true } },
  ];
  assert.equal(assistantText(events), 'WHMARK-1 came with a sentence');
  const outcomes = markerOutcomes(markers, events, entries);
  assert.deepEqual(outcomes.map((o) => [o.id, o.ran, o.inReply, o.inEventTypes]), [
    ['camel/session/additionalContext', 1, true, ['assistant.message']],
    ['pascal/prompt/plain', 1, false, ['user.message']],
    ['claude/prompt/plain', 1, false, []],
    ['camel/prompt/plain', 0, false, []],
  ]);
  assert.deepEqual(fieldTable(outcomes), {
    'session/additionalContext': { camel: 'in reply' },
    'prompt/plain': { pascal: 'events only: user.message', claude: 'not seen', camel: 'hook did not run' },
  });
  assert.deepEqual(countHooks(entries)['camel:log'], { preCompact: 1, subagentStart: 1, subagentStop: 1 });
  assert.equal(preCompactRan(entries), true);
  assert.equal(preCompactRan(entries.slice(0, 3)), false);
  assert.deepEqual(compactionEventTypes(events), ['session.compaction_start', 'session.compaction_complete']);
  assert.equal(compactionHappened(events), true);
  assert.equal(compactionHappened(events.slice(0, 3)), false);
  assert.equal(compactionHappened([{ type: 'session.compaction_complete', data: { success: false } }]), false);
  const found = subagentFindings(entries);
  assert.equal(found.starts.length, 1);
  assert.equal(found.stops.length, 2);
  assert.deepEqual(found.namedIn, ['camel:log:agentName']);
});

test('parseOptions takes the options and refuses what it does not know', () => {
  assert.deepEqual({ ...parseOptions(['--dry-run', '--bin', '/b', '--timeout-ms', '5', '--results-dir', '/r']) }, { dryRun: true, bin: '/b', timeoutMs: 5, resultsDir: '/r' });
  assert.equal(parseOptions([]).dryRun, false);
  assert.equal(parseOptions([]).timeoutMs, 300_000);
  assert.throws(() => parseOptions(['--go']), /Unknown option/);
  assert.throws(() => parseOptions(['--timeout-ms', 'x']), /--timeout-ms/);
});

test('summarise lists the runs, the field table and the notes', () => {
  const text = summarise({
    dryRun: true, copilotVersion: 'v', notes: ['a note'], error: null,
    runs: [{ id: 'markers', code: 0, timedOut: false, durationMs: 2000, hookCounts: { 'camel:log': { sessionStart: 1 } }, fieldTable: { 'session/plain': { camel: 'in reply' } }, compaction: { preCompactRan: false, eventTypes: [], happened: false } },
      { id: 'subagent', code: 0, durationMs: 0, hookCounts: {}, subagent: { starts: [], stops: [{}], namedIn: ['camel:log:agentName'] } }],
  });
  assert.match(text, /2 model run/);
  assert.match(text, /session\/plain\s+camel: in reply/);
  assert.match(text, /agent named in stop input: camel:log:agentName/);
  assert.match(text, /Note: a note/);
});

t('--dry-run runs the whole plan against the stand-in, writes the raw results, and undoes everything it made', async () => {
  const resultsDir = tempFolder('wh-results-');
  const printed = [];
  const { results, file } = await main(['--dry-run', '--results-dir', resultsDir], { out: (line) => printed.push(line) });
  assert.equal(file, path.join(resultsDir, `${CHECK}.dry-run.json`));
  assert.equal(results.error, null);
  // The stand-in compacts a resumed session and honours block and exit 2, so every compaction step runs and block works.
  assert.deepEqual(results.runs.map((run) => run.id), ['markers', 'compact-log', 'compact-block', 'subagent']);
  const byId = Object.fromEntries(results.runs.map((run) => [run.id, run]));
  assert.equal(results.compactionTriggerable, true);
  assert.equal(results.preCompactCanBlock, 'compact-block');
  assert.equal(byId['compact-log'].compaction.happened, true);
  assert.equal(byId['compact-block'].compaction.happened, false);
  assert.equal(byId['compact-block'].compaction.preCompactRan, true);
  assert.ok(byId['compact-log'].args.includes('--resume=stand-in-session'));
  // Stand-in rule: additionalContext and hookSpecificOutput reach the reply; the other fields do not.
  const table = byId.markers.fieldTable;
  assert.equal(table['session/additionalContext'].camel, 'in reply');
  assert.equal(table['session/additionalContext'].pascal, 'in reply');
  assert.equal(table['prompt/hookSpecific'].claude, 'in reply');
  assert.equal(table['session/plain'].camel, 'not seen');
  assert.equal(table['prompt/modifiedPrompt'].camel, 'events only: user.message');
  assert.ok(byId.markers.markerOutcomes.every((o) => o.ran === 1));
  assert.deepEqual(byId.subagent.subagent.namedIn.sort(), ['camel:log:agentName', 'pascal:log:agentName']);
  for (const run of results.runs) assert.ok(run.args.includes('--allow-all-tools'), run.id);
  assert.equal(results.copilotVersion.includes('stand-in'), true);
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')).runs.map((run) => run.id), results.runs.map((run) => run.id));
  assert.match(printed[0], /4 model run/);
  assert.equal(printed.at(-1), `Raw results: ${file}`);
  for (const run of results.runs) assert.ok(!fs.existsSync(run.cwd), run.cwd);
  assert.ok(!fs.existsSync(path.dirname(results.bin)));
  assert.equal(fs.readdirSync(resultsDir).length, 1);
});

t('--dry-run tries a fresh /compact when the resumed one fires nothing, and says so when neither does', async () => {
  const resultsDir = tempFolder('wh-results-');
  process.env.WHEELHOUSE_FAKE_NO_COMPACT = '1';
  let results;
  try {
    ({ results } = await main(['--dry-run', '--results-dir', resultsDir], { out: () => {} }));
  } finally {
    delete process.env.WHEELHOUSE_FAKE_NO_COMPACT;
  }
  assert.equal(results.error, null);
  assert.deepEqual(results.runs.map((run) => run.id), ['markers', 'compact-log', 'compact-fresh', 'subagent']);
  assert.equal(results.compactionTriggerable, false);
  assert.equal(results.preCompactCanBlock, null);
  assert.equal(results.notes.length, 2);
});
