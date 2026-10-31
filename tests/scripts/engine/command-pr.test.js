// tests/scripts/engine/command-pr.test.js
// The helper's own change that puts the found command on the default branch (spec 4.2): the one guardrail change no one
// approves, so it must be exactly that and nothing else.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { commandBranch, commandChange, commandText } from '../../../scripts/engine/command-pr.js';
import { classifyChange, readConfig } from '../../../scripts/gate/guardrails.js';

const FILE = '.claude/wheelhouse.json';
const BASE = JSON.stringify({ ...readConfig(null), pages: [] }, null, 2);
const FOUND = { testCommand: 'npm test', prepare: 'npm ci', why: 'a test script' };
const headRef = commandBranch('a'.repeat(40));
const change = (head, more = {}) => commandChange({ headRef, paths: [FILE], files: { [FILE]: { base: BASE, head, headMode: '100644' } }, found: FOUND, ...more });

test('the text adds the command and its prepare, and it reads as a configuration', () => {
  const text = commandText(BASE, FOUND);
  const read = readConfig(text);
  assert.equal(read.testCommand, 'npm test');
  assert.equal(read.checks.prepare, 'npm ci');
});

test('a project with no file gets one, and a found prepare of none adds no checks key', () => {
  const text = commandText(null, { testCommand: 'go test ./...', prepare: null });
  assert.equal(readConfig(text).testCommand, 'go test ./...');
  assert.equal(readConfig(text).checks, undefined);
});

test('the helper\'s own change matches', () => {
  assert.deepEqual(change(commandText(BASE, FOUND)), { matched: true, ok: true });
});

test('another branch isn\'t this change at all', () => {
  assert.deepEqual(commandChange({ headRef: 'feature/x', paths: [FILE], files: {}, found: FOUND }), { matched: false });
});

test('the helper\'s route refuses a change beyond the command', () => {
  const base = JSON.parse(BASE);
  const tries = {
    'another key': JSON.stringify({ ...JSON.parse(commandText(BASE, FOUND)), ciFiles: ['x'] }),
    'checks.network': JSON.stringify({ ...JSON.parse(commandText(BASE, FOUND)), checks: { prepare: 'npm ci', network: true } }),
    'checks.where': JSON.stringify({ ...JSON.parse(commandText(BASE, FOUND)), checks: { prepare: 'npm ci', where: 'host' } }),
    'another command': commandText(BASE, { ...FOUND, testCommand: 'exit 0' }),
    'another prepare': commandText(BASE, { ...FOUND, prepare: 'curl x' }),
    'a critical area': JSON.stringify({ ...JSON.parse(commandText(BASE, FOUND)), criticalAreas: base.criticalAreas.concat({ name: 'x', paths: [], checks: [] }) }),
    'nonsense': '{ not json',
  };
  for (const [what, head] of Object.entries(tries)) assert.equal(change(head).ok, false, what);
});

test('a second file, an odd mode or a base that already names a command is refused', () => {
  const good = commandText(BASE, FOUND);
  assert.equal(commandChange({ headRef, paths: [FILE, 'src/a.js'], files: { [FILE]: { base: BASE, head: good, headMode: '100644' } }, found: FOUND }).ok, false);
  assert.equal(change(good, { files: { [FILE]: { base: BASE, head: good, headMode: '100755' } } }).ok, false);
  const named = commandText(BASE, { ...FOUND, testCommand: 'make test' });
  assert.equal(change(good, { files: { [FILE]: { base: named, head: good, headMode: '100644' } } }).ok, false);
});

test('with no command kept in the record nothing matches as good', () => {
  assert.equal(change(commandText(BASE, FOUND), { found: null }).ok, false);
});

test('after that a change to the command is a guardrail change', () => {
  const config = readConfig(commandText(BASE, FOUND));
  assert.equal(classifyChange({ paths: [FILE], config }).touchesGuardrails, true);
});

test('a project\'s own prepare stands', () => {
  const base = JSON.stringify({ ...readConfig(null), checks: { prepare: 'npm ci --ignore-scripts' } });
  assert.equal(JSON.parse(commandText(base, { testCommand: 'npm test', prepare: 'npm ci' })).checks.prepare, 'npm ci --ignore-scripts');
});
