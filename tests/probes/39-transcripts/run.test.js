// tests/probes/39-transcripts/run.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  newTally, tallySession, summarise, keyPaths, enumValue, isIdShaped, safeKey, safeToolName, textMarker, maskReport,
  outPath, writeOut,
} from '../../../probes/39-transcripts/run.js';

const SESSION = '0f1e2d3c-4b5a-4968-8776-655443322110';
const AGENT = 'a1234567890abcdef';
// Strings the --mine pass must never print, whatever the shape of the entry
// that holds them.
const SECRETS = [
  'toolu_01HostileIdXyz', 'srvtoolu_01Hostile', 'msg_01HostileMsg', 'req_01HostileReq',
  '1b4e28ba-2fa1-11d2-883f-0016d3cca427', 'secretplan', 'secretfile', 'secretmodel', 'secretserver',
  'secrettag', 'Secret question text', 'hostile-cwd-folder', SESSION, AGENT, 'deadbeefcafe0123',
  // Maps the first guard let through, ids with no prefix, hex or digit run, and
  // plain words in fields that once printed any word.
  'todoState', 'secretupdated', 'byServer', 'session_01AbcDefGhiJkLmnOp', 'task_AbcDefGhiJkLmnoP', 'bAbCdEfGhIjKlMnOpQr',
  'side-session-alpha', 'mySecretProject', 'secretproducer', 'secretpath', 'brandNewField', 'secretword',
];

function line(entry) { return JSON.stringify(entry); }

function hostileSession() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wheelhouse-test-39-'));
  const file = path.join(dir, `${SESSION}.jsonl`);
  const base = { sessionId: SESSION, cwd: '/tmp/hostile-cwd-folder', entrypoint: 'claude-desktop', version: '2.1.302', userType: 'external' };
  const entries = [
    // A typed prompt whose text starts with an unknown tag.
    { ...base, type: 'user', uuid: 'u1', origin: { kind: 'human' }, promptSource: 'sdk', message: { role: 'user', content: '<secrettag>do the secretplan' } },
    // An id-keyed map, an MCP tool name, an id where a kind word should be.
    {
      ...base, type: 'assistant', uuid: 'u2', requestId: 'req_01HostileReq',
      wireToolInputs: { toolu_01HostileIdXyz: { file_path: '/x/secretfile' }, srvtoolu_01Hostile: { q: 1 } },
      message: {
        id: 'msg_01HostileMsg', role: 'assistant', model: 'secretmodel-1', stop_reason: 'toolu_01HostileIdXyz',
        usage: { input_tokens: 1, cache_read_input_tokens: 2, cache_creation_input_tokens: 3, output_tokens: 4 },
        content: [{ type: 'tool_use', id: 'toolu_01HostileIdXyz', name: 'mcp__secretserver__do_thing', input: { secretplan: 1 } }],
      },
    },
    // A tool result for it; a user-keyed map whose keys are single plain words.
    {
      ...base, type: 'user', uuid: 'u3', sourceToolAssistantUUID: 'u2',
      toolUseResult: { answers: { secretplan: 'Approve', 'Secret question text': 'Approve' }, secretfile: 1 },
      message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_01HostileIdXyz', content: 'ok' }] },
    },
    // A peer message with a UUID in origin.handback, and a hostile source value.
    { ...base, type: 'user', uuid: 'u4', isMeta: true, source: 'deadbeefcafe0123', origin: { kind: 'peer', handback: '1b4e28ba-2fa1-11d2-883f-0016d3cca427', from: 'secretserver' }, message: { role: 'user', content: 'hi' } },
    // Model and file maps keyed by the person's own data.
    { type: 'cost-state', sessionId: SESSION, modelUsage: { secretmodel: { inputTokens: 1 } } },
    { type: 'file-history-snapshot', snapshot: { trackedFileBackups: { secretfile: { backupFileName: 'secretfile@v1' } } } },
    { ...base, type: 'attachment', uuid: 'u5', attachment: { type: 'hook_additional_context', hookEvent: 'PostToolUse', hookName: 'PostToolUse:mcp__secretserver__x', content: ['secretplan'] } },
    // A map under a new field, a map under a listed field, a map in an attachment.
    { ...base, type: 'user', uuid: 'u6', todoState: { secretplan: { done: true } }, permissionDecision: { decision: 'accept', updatedInput: { secretfile: 1, secretupdated: 2 } }, message: { role: 'user', content: 'x' } },
    { ...base, type: 'attachment', uuid: 'u7', attachment: { type: 'mcp_instructions_delta', byServer: { secretserver: { on: true } } } },
    // Ids with no listed prefix, no hex and no run of three digits, as keys and as values.
    { ...base, type: 'user', uuid: 'u8', session_01AbcDefGhiJkLmnOp: 1, origin: { kind: 'task_AbcDefGhiJkLmnoP', bAbCdEfGhIjKlMnOpQr: 1 }, entrypoint: 'bAbCdEfGhIjKlMnOpQr', message: { role: 'user', content: 'y' } },
    // Plain words in fields that print presence only.
    { ...base, type: 'user', uuid: 'u9', source: 'mySecretProject', origin: { kind: 'peer', handback: 'side-session-alpha', producer: 'secretproducer' }, message: { role: 'user', content: 'z' } },
    // A path-shaped type, a system entry with an unknown subtype, a new top-level field.
    { ...base, type: '/Users/secretpath/x', uuid: 'u10' },
    { ...base, type: 'system', subtype: 'secretword', uuid: 'u11' },
    { ...base, type: 'user', uuid: 'u12', brandNewField: 'secretword', message: { role: 'user', content: 'w' } },
  ];
  fs.writeFileSync(file, entries.map(line).join('\n') + '\n');
  const sub = path.join(dir, SESSION, 'subagents');
  fs.mkdirSync(sub, { recursive: true });
  fs.writeFileSync(path.join(sub, `agent-${AGENT}.jsonl`), line({ ...base, type: 'user', agentId: AGENT, isSidechain: true, parentUuid: null, message: { role: 'user', content: 'task' } }) + '\n');
  fs.writeFileSync(path.join(sub, `agent-${AGENT}.meta.json`), JSON.stringify({ agentType: 'x', toolUseId: 'toolu_01HostileIdXyz', secretfile: 1 }));
  return { dir, file };
}

test('the summary of a hostile transcript prints none of its ids or the person\'s own words', () => {
  const { dir, file } = hostileSession();
  try {
    const tally = newTally();
    tallySession(tally, file);
    const out = summarise(tally);
    for (const secret of SECRETS) assert.ok(!out.includes(secret), `printed ${secret}`);
    // It still says what the reader needs.
    assert.match(out, /tool_result\(mcp tool\)/);
    assert.match(out, /origin=\{kind:human\}/);
    assert.match(out, /origin=\{kind:<value>\}/);
    assert.match(out, /\twireToolInputs\n/);
    assert.match(out, /toolUseResult\.answers/);
    assert.match(out, /origin\.handback=<present>/);
    assert.match(out, /source=<present>/);
    assert.match(out, /string:other tag/);
    assert.match(out, /usage\.cache_read_input_tokens 1;/);
    assert.match(out, /session:<value>/);
    assert.match(out, /system:<value>/);
    // The hidden keys are counted per parent path.
    assert.match(out, /== Keys not on the list/);
    assert.match(out, /\t\(top\)\n/);
    assert.match(out, /\twireToolInputs\n/);
    assert.match(out, /\tpermissionDecision\n/);
    assert.match(out, /\tattachment\n/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('ids are recognised by shape for the scratch run\'s own listing', () => {
  for (const id of ['toolu_01ABC', 'srvtoolu_x', 'msg_01x', 'req_9', '1b4e28ba-2fa1-11d2-883f-0016d3cca427', 'deadbeefcafe0123', 'run123456']) {
    assert.ok(isIdShaped(id), id);
    assert.equal(safeKey(id), '<key>');
  }
});

test('a value prints only from its field\'s list; some fields print presence only', () => {
  assert.equal(enumValue('claude-desktop', 'entrypoint'), 'claude-desktop');
  assert.equal(enumValue('sdk-cli', 'entrypoint'), 'sdk-cli');
  for (const v of ['bAbCdEfGhIjKlMnOpQr', 'task_AbcDefGhiJkLmnoP', 'mySecretProject', 'toolu_01ABC']) {
    assert.equal(enumValue(v, 'entrypoint'), '<value>');
    assert.equal(enumValue(v, 'type'), '<value>');
    assert.equal(enumValue(v, 'an unlisted field'), '<value>');
  }
  assert.equal(enumValue('human', 'origin.kind'), 'human');
  assert.equal(enumValue({ kind: 'peer', handback: 'x' }, 'origin'), '{kind:peer}');
  assert.equal(enumValue({ kind: 'toolu_01x' }, 'origin'), '{kind:<value>}');
  assert.equal(enumValue('side-session-alpha', 'origin.handback'), '<present>');
  assert.equal(enumValue('mySecretProject', 'source'), '<present>');
  assert.equal(enumValue('secretproducer', 'origin.producer'), '<present>');
  assert.equal(enumValue('2.1.302', 'version'), '2.1.302');
  assert.equal(enumValue('not a version', 'version'), '<value>');
  assert.equal(enumValue('PostToolUse:mcp__srv__tool', 'attachment.hookName'), '<value>');
  assert.equal(enumValue(true, 'turnCompanion'), 'true');
  assert.equal(safeToolName('Read'), 'Read');
  assert.equal(safeToolName('mcp__secretserver__do'), 'mcp tool');
  assert.equal(safeToolName('secretthing'), 'other tool');
});

test('a key not on the list prints nothing and nothing below it is read; it is counted under its parent', () => {
  const hidden = new Map();
  const paths = [...keyPaths({
    wireToolInputs: { toolu_1: { a: 1 } }, modelUsage: { mymodel: { x: 1 } },
    toolUseResult: { answers: { q: 1 }, myfile: 1 }, todoState: { secretplan: 1 },
  }, '', new Set(), hidden)];
  assert.deepEqual(paths.sort(), ['modelUsage', 'toolUseResult', 'toolUseResult.answers', 'wireToolInputs'].sort());
  assert.deepEqual(Object.fromEntries(hidden), {
    wireToolInputs: 1, modelUsage: 1, 'toolUseResult.answers': 1, toolUseResult: 1, '(top)': 1,
  });
});

test('a leading tag is named only when it is a known one', () => {
  assert.equal(textMarker('<task-notification> x'), '<task-notification>');
  assert.equal(textMarker('<agent-message from="x">'), '<agent-message');
  assert.equal(textMarker('<secrettag>hello'), 'other tag');
  assert.equal(textMarker('K7QD Approve'), 'reply-code');
  assert.equal(textMarker('Wheelhouse: read x'), 'Wheelhouse:');
  assert.equal(textMarker('hello'), 'plain text');
});

test('the kept scratch report masks API ids wherever they stand, in key paths too', () => {
  const masked = maskReport('wireToolInputs.toolu_012abcXYZ.questions "msg_01abc" req_011CXyz a0123456789abcdef', { scratchDirs: [] });
  assert.ok(!/toolu_012abc|msg_01abc|req_011C|a0123456789abcdef/.test(masked), masked);
});

test('--out refuses a link, dangling or not, and any path whose real folder is in the repository', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wheelhouse-test-39-out-'));
  try {
    const repo = path.join(dir, 'repo');
    fs.mkdirSync(repo);
    // A dangling link pointing into the repository: refused, and its target not made.
    const dangling = path.join(dir, 'dangling.txt');
    fs.symlinkSync(path.join(repo, 'made.txt'), dangling);
    assert.throws(() => outPath(dangling, { repo }), /link/);
    assert.throws(() => writeOut(dangling, 'x'), /link/);
    assert.equal(fs.existsSync(path.join(repo, 'made.txt')), false);
    // A link to a real file: refused.
    fs.writeFileSync(path.join(dir, 'real.txt'), '');
    fs.symlinkSync(path.join(dir, 'real.txt'), path.join(dir, 'tofile.txt'));
    assert.throws(() => outPath(path.join(dir, 'tofile.txt'), { repo }), /link/);
    // A folder link into the repository: refused by the real path.
    fs.symlinkSync(repo, path.join(dir, 'into-repo'));
    assert.throws(() => outPath(path.join(dir, 'into-repo', 'x.txt'), { repo }), /outside the repository/);
    assert.throws(() => outPath(path.join(repo, 'x.txt'), { repo }), /outside the repository/);
    // A plain file outside: written, and written again.
    const fine = outPath(path.join(dir, 'out', 'mine.txt'), { repo });
    writeOut(fine, 'one');
    writeOut(fine, 'two');
    assert.equal(fs.readFileSync(fine, 'utf8'), 'two');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
