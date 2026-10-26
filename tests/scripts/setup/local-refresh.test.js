// tests/scripts/setup/local-refresh.test.js
// This computer's settings.local.json in a project set up here, brought up to what setup's step 7
// would write now at each session start: after an update from 0.1.1 to 0.1.2 the Wheelhouse
// command's rules name 0.1.2's folder, the rules Wheelhouse wrote for 0.1.1's go, the work's
// reports rule arrives, and the director's own entries stay. Nothing else is taken out; a start
// with nothing to do writes nothing. Each key it writes is recorded as step 7's, so uninstall puts
// the file back to the director's own.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { refreshLocalSettings, refreshed, staleRule, keyEdits } from '../../../scripts/setup/local-refresh.js';
import { startRun, markStep, addChanges, applyJsonKey, reverseChange, readJournal, closeRun } from '../../../scripts/setup/journal.js';
import { localSettings, mergeSettings, frontDeskCommand, setupCommand, statusLineCommand } from '../../../scripts/protection/settings.js';
import { WORK_REPORTS_RULE, FRONT_DESK_INPUT } from '../../../scripts/lib/front-desk.js';

const CACHE = '/Users/a-director/.claude/plugins/cache/wheelhouse/wheelhouse';
const OLD = `${CACHE}/0.1.1`;
const NEW = `${CACHE}/0.1.2`;
const ADDRESS = '/Users/a-director/.wheelhouse/helper.sock';
const NODE = '/usr/local/bin/node';
const INPUT = `Edit(/${FRONT_DESK_INPUT})`;
const rules = (root) => [false, true].flatMap((noSystemCa) => [frontDeskCommand(root, { platform: 'darwin', noSystemCa }), setupCommand(root, { platform: 'darwin', noSystemCa })])
  .map((command) => `Bash(${command}:*)`);
const read = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));
const OWN_RULES = ['Bash(ls:*)', 'Bash(node "/opt/tools/scripts/frontdesk/cli.js":*)', 'Bash(node "/Users/a-director/wheelhouse-notes/tidy.js":*)'];

// A project as step 7 left it on 0.1.1: the director's own file (`mine`, or none), with step 7's 0.1.1 settings
// merged in key by key through the journal, as its apply does, before the reports rule existed. `text`
// writes the file as it is instead, recording nothing.
function project({ mine = { permissions: { allow: OWN_RULES }, env: { MINE: '1' } }, text, stepDone = true, statusLine = null } = {}) {
  const folder = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'wh-local-refresh-')));
  const claudeHome = path.join(folder, 'claude home');
  fs.mkdirSync(path.join(folder, '.claude'), { recursive: true });
  fs.mkdirSync(claudeHome);
  const file = path.join(folder, '.claude', 'settings.local.json');
  const run = startRun({ folder });
  if (text !== undefined) {
    if (text !== null) fs.writeFileSync(file, text);
  } else {
    const own = statusLine === null ? mine : { ...mine, statusLine };
    fs.writeFileSync(file, `${JSON.stringify(own, null, 2)}\n`);
    const step7 = localSettings({ address: ADDRESS, node: NODE, pluginRoot: OLD, platform: 'darwin', model: 'claude-opus-5-5', ownStatusLine: statusLine });
    step7.permissions.allow = step7.permissions.allow.filter((r) => r !== WORK_REPORTS_RULE);
    for (const { key, value } of keyEdits(own, mergeSettings(own, step7))) {
      applyJsonKey({ file, key, value, step: 7, record: (c) => addChanges(run.id, [c]) });
    }
  }
  if (stepDone) markStep(run.id, 7, 'doneAt');
  return { folder, claudeHome, file, run };
}
const refreshIn = ({ folder, claudeHome }, root = NEW) => refreshLocalSettings({ folder, address: ADDRESS, node: NODE, pluginRoot: root, platform: 'darwin', claudeHome });
const changesOf = (run) => readJournal().runs.find((r) => r.id === run.id).changes;

test('an update from 0.1.1 to 0.1.2 names 0.1.2\'s folder, takes out the rules Wheelhouse wrote for 0.1.1, and keeps the director\'s own', () => {
  const p = project();
  try {
    const before = read(p.file);
    assert.ok(rules(OLD).every((r) => before.permissions.allow.includes(r)), '0.1.1\'s rules are there');
    assert.ok(!before.permissions.allow.includes(WORK_REPORTS_RULE));
    const recorded = changesOf(p.run).length;
    assert.ok(refreshIn(p) > 0);
    const after = read(p.file);
    // The rules kept in their places, the director's first, then 0.1.2's added, the reports rule among them; none of 0.1.1's.
    assert.deepEqual(after.permissions.allow, [...OWN_RULES, INPUT, ...localSettings({ address: ADDRESS, pluginRoot: NEW, platform: 'darwin' }).permissions.allow.filter((r) => r !== INPUT)]);
    assert.ok(after.permissions.allow.includes(WORK_REPORTS_RULE));
    assert.ok(!after.permissions.allow.some((r) => r.includes('/0.1.1/')));
    // The status line names 0.1.2's script; the pin, the socket and the director's env stay.
    assert.equal(after.statusLine.command, statusLineCommand({ node: NODE, pluginRoot: NEW }));
    assert.equal(after.model, 'claude-opus-5-5');
    assert.deepEqual(after.sandbox.network.allowUnixSockets, [ADDRESS]);
    assert.deepEqual(after.env, { MINE: '1' });
    // Recorded as step 7's, each key's before what step 7 wrote.
    const made = changesOf(p.run).slice(recorded);
    assert.deepEqual(made.map((c) => [c.step, c.kind, c.key.join('.')]).sort(), [[7, 'json-key', 'permissions.allow'], [7, 'json-key', 'statusLine.command']]);
    assert.deepEqual(made.find((c) => c.key.join('.') === 'permissions.allow').before, before.permissions.allow);
    // Again, with nothing to do: nothing written or recorded.
    const text = fs.readFileSync(p.file, 'utf8');
    const mtime = fs.statSync(p.file).mtimeMs;
    assert.equal(refreshIn(p), 0);
    assert.equal(fs.readFileSync(p.file, 'utf8'), text);
    assert.equal(fs.statSync(p.file).mtimeMs, mtime);
    assert.equal(changesOf(p.run).length, recorded + made.length);
    // Uninstall's way, newest first: the file goes back to the director's own.
    for (const change of [...changesOf(p.run)].reverse()) assert.equal(reverseChange(change).put, true, change.key.join('.'));
    assert.deepEqual(read(p.file), { permissions: { allow: OWN_RULES }, env: { MINE: '1' } });
  } finally { fs.rmSync(p.folder, { recursive: true, force: true }); }
});

test('the director\'s own status line stays, and nothing is written without step 7 done in an open run, or to a file that isn\'t settings', () => {
  const mine = { type: 'command', command: 'my-line' };
  const p = project({ statusLine: mine });
  try {
    assert.ok(refreshIn(p) > 0);
    assert.deepEqual(read(p.file).statusLine, mine);
  } finally { fs.rmSync(p.folder, { recursive: true, force: true }); }
  // Step 7 not done yet, or the run closed by uninstall: left as it is.
  for (const shut of [false, true]) {
    const q = project({ stepDone: shut });
    if (shut) closeRun(q.run.id, { by: 'uninstall' });
    try {
      const text = fs.readFileSync(q.file, 'utf8');
      assert.equal(refreshIn(q), 0);
      assert.equal(fs.readFileSync(q.file, 'utf8'), text);
    } finally { fs.rmSync(q.folder, { recursive: true, force: true }); }
  }
  // Missing, damaged or not an object.
  for (const text of [null, '{ not json', '[1, 2]']) {
    const q = project({ text });
    try {
      assert.equal(refreshIn(q), 0);
      if (text === null) assert.equal(fs.existsSync(q.file), false, 'not made');
      else assert.equal(fs.readFileSync(q.file, 'utf8'), text);
    } finally { fs.rmSync(q.folder, { recursive: true, force: true }); }
  }
});

test('only the exact rules Wheelhouse writes for its commands, under another folder of Wheelhouse\'s, are stale', () => {
  const current = rules(NEW);
  for (const rule of rules(OLD)) assert.equal(staleRule(rule, current), true, rule);
  // A development copy of Wheelhouse's, and Windows' form.
  assert.equal(staleRule('Bash(node "/Users/a-director/Projects/wheelhouse/scripts/setup/cli.js":*)', current), true);
  assert.equal(staleRule('Bash(node --no-use-system-ca "C:/Users/Zoë/wheelhouse/0.1.1/scripts/frontdesk/cli.js":*)', current), true);
  for (const rule of [
    ...current,
    'Bash(node "/opt/tools/scripts/frontdesk/cli.js":*)', // not a folder of Wheelhouse's
    `Bash(node "${OLD}/scripts/health/trials.js":*)`, // a script setup writes no rule for
    `Bash(node "${OLD}/scripts/frontdesk/cli.js" views:*)`, // narrowed by the director
    `Bash(node "${OLD}/scripts/frontdesk/cli.js")`, // another form
    `Bash(node --inspect "${OLD}/scripts/frontdesk/cli.js":*)`,
    `Read(${OLD}/**)`, INPUT, 'Bash(ls:*)', 42, null,
  ]) assert.equal(staleRule(rule, current), false, String(rule));
  // A file with no permissions, or allow not a list, is merged as it is.
  const ours = localSettings({ address: ADDRESS, pluginRoot: NEW, platform: 'darwin' });
  assert.deepEqual(refreshed({}, ours).permissions.allow, ours.permissions.allow);
  assert.deepEqual(refreshed({ permissions: { allow: 'x' } }, ours).permissions.allow, ours.permissions.allow);
});
