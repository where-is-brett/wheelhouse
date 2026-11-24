// tests/scripts/lib/sign-in-gate.test.js
// The sign-in gate's fact file, the gate, the classifier, the cleaners and the Builders line (builders design, section 10).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  signInFile, readSignIn, writeSignInFact, clearSignInFact, gateFor, classify, cleanExcerpt, commandName, buildersLine, buildersHealth, timeWords,
} from '../../../scripts/lib/sign-in-gate.js';
import { signInPatterns } from '../../../adapters/claude-code/sign-in-patterns.js';
import { tempFolder } from '../../helpers/homes.js';

const ROUTE = 'claude-code:background';
const fact = (over = {}) => ({ kind: 'not-signed-in', since: new Date(2026, 10, 24, 14, 2).toISOString(), command: 'claude', excerpt: 'Not logged in', starts: 1, ...over });
const home = () => tempFolder('wh-gate-');

test('no file is no facts and an open gate; a written fact shuts that route only', () => {
  const h = home();
  assert.deepEqual(readSignIn(h), { ok: true, facts: {} });
  assert.deepEqual(gateFor(h, ROUTE), { open: true });
  writeSignInFact(h, ROUTE, fact());
  assert.equal(signInFile(h), path.join(h, 'sign-in.json'));
  assert.equal(gateFor(h, ROUTE).open, false);
  assert.match(gateFor(h, ROUTE).reason, /^not started: builders can't sign in \(not signed in since 14:02\)$/);
  assert.deepEqual(gateFor(h, 'claude-code:desktop'), { open: true });
  assert.deepEqual(gateFor(h, 'copilot:background'), { open: true });
});

test('a second failure on a route keeps the first time and counts the start', () => {
  const h = home();
  writeSignInFact(h, ROUTE, fact());
  const again = writeSignInFact(h, ROUTE, fact({ since: new Date(2026, 10, 24, 15, 0).toISOString(), excerpt: 'Invalid API key' }));
  assert.equal(again.starts, 2);
  assert.equal(again.since, fact().since);
  assert.equal(readSignIn(h).facts[ROUTE].excerpt, 'Invalid API key');
});

test('the file is written whole, readable by this account only, and clearing takes one route', () => {
  const h = home();
  writeSignInFact(h, ROUTE, fact());
  writeSignInFact(h, 'copilot:background', fact({ command: 'copilot' }));
  assert.deepEqual(fs.readdirSync(h), ['sign-in.json'], 'no temporary file is left');
  if (process.platform !== 'win32') assert.equal(fs.statSync(signInFile(h)).mode & 0o777, 0o600);
  assert.equal(clearSignInFact(h, ROUTE), true);
  assert.equal(clearSignInFact(h, ROUTE), false);
  assert.deepEqual(Object.keys(readSignIn(h).facts), ['copilot:background']);
});

test('a malformed file is not "no fault": the gate stays shut and names file, line and column (review focus 2)', () => {
  const h = home();
  fs.writeFileSync(signInFile(h), '{\n  "claude-code:background": { "kind": "other",, }\n}\n');
  const read = readSignIn(h);
  assert.equal(read.ok, false);
  assert.equal(read.fault.file, signInFile(h));
  assert.equal(read.fault.line, 2);
  const gate = gateFor(h, ROUTE);
  assert.equal(gate.open, false);
  assert.match(gate.reason, /sign-in\.json can't be read: line 2, column \d+\./);
  // Nor is it written over or cleared.
  assert.throws(() => writeSignInFact(h, ROUTE, fact()), /sign-in\.json can't be read/);
  assert.throws(() => clearSignInFact(h, ROUTE), /sign-in\.json can't be read/);
  // The wrong shape is as shut as a damaged one, and says no file text.
  for (const text of ['[]', '"x"', '{"claude-code:background":{"kind":"gone"}}', '{"not a route":{}}']) {
    fs.writeFileSync(signInFile(h), text);
    assert.equal(gateFor(h, ROUTE).open, false, text);
    assert.ok(!gateFor(h, ROUTE).reason.includes('gone'), text);
  }
});

test('classify: not-signed-in, blocked, no-program, other', () => {
  const ok = { code: 1 };
  for (const said of ['Not logged in · Please run /login', 'Invalid API key · Fix external API key', 'OAuth token has expired. Please run /login', 'API Error: 401 {"type":"authentication_error"}']) {
    assert.equal(classify(said, ok, signInPatterns), 'not-signed-in', said);
  }
  assert.equal(classify('API Error: 403 {"error":"Forbidden: your organization has disabled this"}', ok, signInPatterns), 'blocked');
  assert.equal(classify('Request blocked by policy (403)', ok, signInPatterns), 'blocked');
  assert.equal(classify('', { code: null, error: Object.assign(new Error('spawn claude ENOENT'), { code: 'ENOENT' }) }, signInPatterns), 'no-program');
  assert.equal(classify('', { code: null, error: Object.assign(new Error('x'), { code: 'EACCES' }) }, signInPatterns), 'no-program');
  assert.equal(classify('', { code: null, error: new Error('Cannot pass this to a .cmd program safely: "a&b"') }, signInPatterns), 'no-program');
  assert.equal(classify('Error: the tests failed', ok, signInPatterns), 'other');
  assert.equal(classify('', { code: 137, signal: 'SIGKILL' }, signInPatterns), 'other');
  assert.equal(classify('Not logged in', ok, null), 'other', 'an agent with no patterns reads none');
  // A session that ran long and printed about logging in is not a refusal.
  assert.equal(classify(`${'work '.repeat(600)}\nNot logged in`, ok, signInPatterns), 'other');
});

test('the excerpt is one clean line of at most 200 characters, with an address\'s sign-in hidden', () => {
  const said = cleanExcerpt(`Not logged in\n\t\u0007 https://me:pw@host.example/x ${'long '.repeat(100)}`);
  assert.ok(said.length <= 200);
  assert.ok(!/[\u0000-\u001F]/.test(said));
  assert.ok(!said.includes('pw@'));
  assert.ok(said.startsWith('Not logged in https://[hidden]@host.example'));
  assert.equal(cleanExcerpt('short'), 'short');
  assert.equal(cleanExcerpt(undefined), '');
  assert.equal(cleanExcerpt('😀'.repeat(300)).length <= 200, true);
});

test('the command is the program\'s name only', () => {
  assert.equal(commandName('/usr/local/bin/claude'), 'claude');
  assert.equal(commandName('C:\\Users\\me\\AppData\\claude.cmd'), 'claude');
  assert.equal(commandName('/opt/my folder/wrap'), 'wrap');
  assert.equal(commandName(''), 'claude');
  assert.equal(commandName('a;b$(c)'), 'abc');
  assert.ok(commandName('x'.repeat(500)).length <= 60);
});

test('the Builders line states the recorded fact, and says a damaged file', () => {
  const h = home();
  assert.equal(buildersLine({ home: h }), 'Builders: background as `claude`');
  assert.deepEqual(buildersHealth({ home: h }), { level: 'ok', text: 'Builders: background as `claude`' });
  writeSignInFact(h, ROUTE, fact({ command: '/opt/bin/wrap' }));
  assert.equal(buildersLine({ home: h }), `Builders: background as \`wrap\` · can't sign in since ${timeWords(fact().since)} (not signed in)`);
  assert.equal(buildersLine({ home: h }), 'Builders: background as `wrap` · can\'t sign in since 14:02 (not signed in)');
  assert.equal(buildersHealth({ home: h }).level, 'watch');
  writeSignInFact(h, ROUTE, fact({ kind: 'blocked' }));
  assert.match(buildersLine({ home: h }), /\(blocked\)$/);
  fs.writeFileSync(signInFile(h), '{');
  assert.match(buildersLine({ home: h }), /^Builders: background as `claude` · .*sign-in\.json can't be read: line 1, column 2\./);
  assert.equal(buildersHealth({ home: h }).level, 'watch');
});
