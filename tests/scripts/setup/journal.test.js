// tests/scripts/setup/journal.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  addChanges, applyJsonKey, findRun, journalFile, markStep, readJournal, reverseChange, startRun, stepTimes,
} from '../../../scripts/setup/journal.js';
import {
  CLICK_FRESH_MS, NODE_FLOOR, PUSH_TEST_WAIT_MS, RETENTION_DAYS, STEP_TIMEOUT_MS, TARGET_MINUTES,
} from '../../../scripts/lib/setup-numbers.js';
import { tempFolder, withHome } from '../../helpers/homes.js';

const at = (iso) => () => new Date(iso);
const readText = (file) => fs.readFileSync(file, 'utf8');
const readJson = (file) => JSON.parse(readText(file));

test('the design\'s numbers are named once', () => {
  assert.equal(TARGET_MINUTES, 15);
  assert.equal(CLICK_FRESH_MS, 10 * 60 * 1000);
  assert.deepEqual(NODE_FLOOR, [22, 0, 0]);
  assert.equal(RETENTION_DAYS, 30);
  assert.equal(PUSH_TEST_WAIT_MS, 2 * 60 * 1000);
  assert.equal(STEP_TIMEOUT_MS, 20 * 60 * 1000);
});

test('a key is set without touching the file\'s other keys, and its value before is kept', () => {
  withHome(() => {
    const dir = tempFolder('wh-journal-');
    const file = path.join(dir, 'settings.json');
    fs.writeFileSync(file, `${JSON.stringify({ theme: 'dark', cleanupPeriodDays: 7, nested: { keep: [1, 2], other: true } }, null, '\t')}\n`);
    const change = applyJsonKey({ file, key: ['cleanupPeriodDays'], value: 30, step: 6, project: 'shop' });
    assert.equal(change.kind, 'json-key');
    assert.equal(change.target, file);
    assert.deepEqual(change.key, ['cleanupPeriodDays']);
    assert.equal(change.before, 7);
    assert.equal(change.after, 30);
    assert.equal(change.step, 6);
    assert.equal(change.project, 'shop');
    assert.equal(typeof change.id, 'string');
    assert.ok(change.id.length > 0);
    assert.deepEqual(readJson(file), { theme: 'dark', cleanupPeriodDays: 30, nested: { keep: [1, 2], other: true } });
    // The file's indent and closing newline are kept.
    assert.match(readText(file), /^\{\n\t"theme"/);
    assert.ok(readText(file).endsWith('}\n'));
    // A key deeper in the file leaves its neighbours alone.
    const deep = applyJsonKey({ file, key: ['nested', 'added'], value: 'x' });
    assert.equal(deep.before, null);
    assert.deepEqual(readJson(file).nested, { keep: [1, 2], other: true, added: 'x' });
    // No temporary file is left behind.
    assert.deepEqual(fs.readdirSync(dir), ['settings.json']);
  });
});

test('a key that was absent is removed again on reversal', () => {
  withHome(() => {
    const dir = tempFolder('wh-journal-');
    const file = path.join(dir, 'settings.json');
    fs.writeFileSync(file, '{\n  "theme": "dark"\n}\n');
    const change = applyJsonKey({ file, key: ['plugins', 'wheelhouse'], value: { on: true } });
    assert.equal(change.before, null);
    assert.deepEqual(readJson(file).plugins, { wheelhouse: { on: true } });
    assert.deepEqual(reverseChange(change), { put: true });
    assert.deepEqual(readJson(file).plugins, {});
    assert.equal(readJson(file).theme, 'dark');
    // A file that was missing is made, and the key goes again on reversal.
    const fresh = path.join(dir, 'sub', 'new.json');
    const made = applyJsonKey({ file: fresh, key: ['a'], value: 1 });
    assert.deepEqual(readJson(fresh), { a: 1 });
    assert.equal(made.before, null);
    assert.deepEqual(reverseChange(made), { put: true });
    assert.deepEqual(readJson(fresh), {});
    // A value that was there before is put back.
    const set = applyJsonKey({ file, key: ['theme'], value: 'light' });
    assert.deepEqual(reverseChange(set), { put: true });
    assert.equal(readJson(file).theme, 'dark');
  });
});

test('a value the director changed after setup is left and named', () => {
  withHome(() => {
    const dir = tempFolder('wh-journal-');
    const file = path.join(dir, 'settings.json');
    fs.writeFileSync(file, '{"cleanupPeriodDays":7}\n');
    const change = applyJsonKey({ file, key: ['cleanupPeriodDays'], value: 30 });
    // The director sets their own value afterwards.
    fs.writeFileSync(file, '{"cleanupPeriodDays":90}\n');
    assert.deepEqual(reverseChange(change), { put: false, why: 'changed since setup' });
    assert.equal(readJson(file).cleanupPeriodDays, 90);
    // A key the director removed, and a file they removed, are left alone too.
    fs.writeFileSync(file, '{}\n');
    assert.deepEqual(reverseChange(change), { put: false, why: 'changed since setup' });
    assert.equal(readText(file), '{}\n');
    fs.rmSync(file);
    assert.deepEqual(reverseChange(change), { put: false, why: 'changed since setup' });
    assert.equal(fs.existsSync(file), false);
    // A value of an object kind is compared by content, whatever the key order.
    fs.writeFileSync(file, '{}\n');
    const obj = applyJsonKey({ file, key: ['hooks'], value: { b: 1, a: [1, 2] } });
    fs.writeFileSync(file, '{"hooks":{"a":[1,2],"b":1}}\n');
    assert.deepEqual(reverseChange(obj), { put: true });
    fs.writeFileSync(file, '{"hooks":{"a":[1,2],"b":2}}\n');
    assert.deepEqual(reverseChange(obj), { put: false, why: 'changed since setup' });
  });
});

test('a file that is not JSON is refused, never replaced', () => {
  withHome(() => {
    const dir = tempFolder('wh-journal-');
    const file = path.join(dir, 'settings.json');
    const text = '{ "theme": "dark", // the director\'s own note\n}\n';
    fs.writeFileSync(file, text);
    assert.throws(() => applyJsonKey({ file, key: ['a'], value: 1 }), (error) => error.message.includes(file));
    assert.equal(readText(file), text);
    // A file holding something other than an object is refused as well.
    fs.writeFileSync(file, '[1,2]\n');
    assert.throws(() => applyJsonKey({ file, key: ['a'], value: 1 }), (error) => error.message.includes(file));
    assert.equal(readText(file), '[1,2]\n');
    // So is a path through a value that is not an object.
    fs.writeFileSync(file, '{"a":5}\n');
    assert.throws(() => applyJsonKey({ file, key: ['a', 'b'], value: 1 }), (error) => error.message.includes(file));
    assert.equal(readText(file), '{"a":5}\n');
    // Reversal leaves a file that stopped being JSON as it is.
    const change = { id: 'x', step: 6, kind: 'json-key', target: file, key: ['a'], before: null, after: 1 };
    fs.writeFileSync(file, 'not json');
    assert.deepEqual(reverseChange(change), { put: false, why: 'changed since setup' });
    assert.equal(readText(file), 'not json');
  });
});

test('a path with a space and an accent is written and put back', () => {
  withHome(() => {
    const dir = path.join(tempFolder('wh-journal-'), 'Zoë Smith', 'My Projects');
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, 'settings é.json');
    fs.writeFileSync(file, '{"café":1}\n');
    const change = applyJsonKey({ file, key: ['naïve', 'clé'], value: 'ü', step: 6 });
    assert.deepEqual(readJson(file), { café: 1, naïve: { clé: 'ü' } });
    // The change survives the journal.
    const run = startRun({ folder: dir, now: at('2026-10-19T01:00:00.000Z') });
    addChanges(run.id, [change]);
    const [kept] = findRun(dir).changes;
    assert.deepEqual(kept, change);
    assert.deepEqual(reverseChange(kept), { put: true });
    assert.deepEqual(readJson(file), { café: 1, naïve: {} });
    // A file and a folder with such a path are put back too.
    const note = path.join(dir, 'note é.txt');
    fs.writeFileSync(note, 'after');
    assert.deepEqual(reverseChange({ id: 'f', step: 7, kind: 'file', target: note, before: null, after: 'after' }), { put: true });
    assert.equal(fs.existsSync(note), false);
    const made = path.join(dir, 'Dossier élève');
    fs.mkdirSync(made);
    assert.deepEqual(reverseChange({ id: 'd', step: 3, kind: 'folder', target: made, before: null, after: true }), { put: true });
    assert.equal(fs.existsSync(made), false);
  });
});

test('the journal survives a crash between two writes', () => {
  withHome(() => {
    // Nothing yet: the empty journal.
    assert.deepEqual(readJournal(), { v: 1, runs: [] });
    assert.equal(journalFile(), path.join(process.env.WHEELHOUSE_HOME, 'setup', 'journal.json'));
    const run = startRun({ folder: '/work/shop', project: 'shop', now: at('2026-10-19T01:00:00.000Z') });
    markStep(run.id, 1, 'shownAt', { now: at('2026-10-19T01:00:05.000Z') });
    const whole = readText(journalFile());

    // A write that died before its rename left a half-written temporary file: it is ignored.
    fs.writeFileSync(`${journalFile()}.4242.tmp`, whole.slice(0, whole.length / 2));
    assert.equal(readText(journalFile()), whole);
    assert.equal(readJournal().runs.length, 1);
    assert.equal(findRun('/work/shop').steps[1].shownAt, '2026-10-19T01:00:05.000Z');

    // A write whose rename fails leaves the journal as it was, and no temporary file of its own.
    const real = fs.renameSync;
    fs.renameSync = () => { throw new Error('the computer slept'); };
    try {
      assert.throws(() => markStep(run.id, 1, 'clickedAt', { now: at('2026-10-19T01:00:30.000Z') }), /the computer slept/);
    } finally {
      fs.renameSync = real;
    }
    assert.equal(readText(journalFile()), whole);
    assert.deepEqual(fs.readdirSync(path.dirname(journalFile())).sort(), ['journal.json', 'journal.json.4242.tmp']);

    // The next write goes through and the journal carries on.
    markStep(run.id, 1, 'clickedAt', { now: at('2026-10-19T01:00:30.000Z') });
    assert.equal(findRun('/work/shop').steps[1].clickedAt, '2026-10-19T01:00:30.000Z');
  });
});

test('a journal that is not JSON is refused, naming it, and never replaced', () => {
  withHome(() => {
    fs.mkdirSync(path.dirname(journalFile()), { recursive: true });
    fs.writeFileSync(journalFile(), '{"v":1,"runs":[');
    assert.throws(() => readJournal(), (error) => error.message.includes(journalFile()));
    assert.throws(() => startRun({ folder: '/work/shop', now: at('2026-10-19T01:00:00.000Z') }), (error) => error.message.includes(journalFile()));
    assert.equal(readText(journalFile()), '{"v":1,"runs":[');
    // A journal of another shape is refused too.
    fs.writeFileSync(journalFile(), '{"v":2,"runs":[]}');
    assert.throws(() => readJournal(), (error) => error.message.includes(journalFile()));
  });
});

test('runs are started for a folder, found again, and take times and changes', () => {
  withHome(() => {
    const a = startRun({ folder: '/work/a', now: at('2026-10-19T01:00:00.000Z') });
    const b = startRun({ folder: '/work/b', project: 'bee', now: at('2026-10-19T02:00:00.000Z') });
    assert.notEqual(a.id, b.id);
    assert.equal(a.startedAt, '2026-10-19T01:00:00.000Z');
    assert.equal(findRun('/work/b').project, 'bee');
    assert.equal(findRun('/work/nowhere'), null);
    markStep(b.id, 4, 'shownAt', { now: at('2026-10-19T02:01:00.000Z') });
    markStep(b.id, 4, 'failed', { now: at('2026-10-19T02:02:00.000Z'), reason: 'the installer stopped' });
    assert.equal(findRun('/work/b').steps[4].failed, 'the installer stopped');
    // A later click or finish clears the failure.
    markStep(b.id, 4, 'clickedAt', { now: at('2026-10-19T02:03:00.000Z') });
    assert.equal(findRun('/work/b').steps[4].failed, undefined);
    assert.throws(() => markStep(b.id, 4, 'failed', { now: at('2026-10-19T02:04:00.000Z') }), /reason/);
    assert.throws(() => markStep(b.id, 4, 'wobbled', { now: at('2026-10-19T02:04:00.000Z') }), /field/);
    assert.throws(() => markStep('run-none', 1, 'shownAt', { now: at('2026-10-19T02:04:00.000Z') }), /run-none/);
    const change = { id: 'c1', step: 4, kind: 'folder', target: '/work/b/x', before: null, after: true };
    addChanges(b.id, [change]);
    addChanges(b.id, [{ ...change, id: 'c2' }]);
    assert.deepEqual(findRun('/work/b').changes.map((c) => c.id), ['c1', 'c2']);
    assert.throws(() => addChanges(b.id, [change]), /c1/);
    assert.throws(() => addChanges(b.id, [{ id: 'c3', step: 4, kind: 'wobble', target: 'x', before: null, after: 1 }]), /kind/);
    assert.equal(findRun('/work/a').changes.length, 0);
    // The latest run for a folder is the one found.
    const again = startRun({ folder: '/work/a', now: at('2026-10-19T03:00:00.000Z') });
    assert.equal(findRun('/work/a').id, again.id);
  });
});

test('a kind put back by its own step is not put back here', () => {
  for (const kind of ['process', 'host', 'locked', 'env']) {
    assert.deepEqual(reverseChange({ id: 'x', step: 1, kind, target: 't', before: null, after: 1 }), { put: false, why: 'put back by its own step' });
  }
  assert.throws(() => reverseChange({ id: 'x', step: 1, kind: 'wobble', target: 't', before: null, after: 1 }), /kind/);
});

test('a file setup wrote is put back only while it still holds what setup wrote', () => {
  const dir = tempFolder('wh-journal-');
  const file = path.join(dir, 'rules.md');
  fs.writeFileSync(file, 'setup\'s text');
  const made = { id: 'f1', step: 7, kind: 'file', target: file, before: null, after: 'setup\'s text' };
  fs.writeFileSync(file, 'the director\'s edit');
  assert.deepEqual(reverseChange(made), { put: false, why: 'changed since setup' });
  assert.equal(readText(file), 'the director\'s edit');
  fs.writeFileSync(file, 'setup\'s text');
  assert.deepEqual(reverseChange(made), { put: true });
  assert.equal(fs.existsSync(file), false);
  // A file that held something before gets it back.
  fs.writeFileSync(file, 'new');
  assert.deepEqual(reverseChange({ ...made, before: 'old', after: 'new' }), { put: true });
  assert.equal(readText(file), 'old');
  // A file already gone is left as it is.
  fs.rmSync(file);
  assert.deepEqual(reverseChange({ ...made, before: 'old', after: 'new' }), { put: false, why: 'changed since setup' });
});

test('a folder is removed only when setup made it and it is empty', () => {
  const dir = tempFolder('wh-journal-');
  const folder = path.join(dir, 'Projects');
  fs.mkdirSync(folder);
  const made = { id: 'd1', step: 3, kind: 'folder', target: folder, before: null, after: true };
  fs.writeFileSync(path.join(folder, 'theirs.txt'), 'x');
  assert.deepEqual(reverseChange(made), { put: false, why: 'changed since setup' });
  assert.equal(fs.existsSync(folder), true);
  fs.rmSync(path.join(folder, 'theirs.txt'));
  assert.deepEqual(reverseChange({ ...made, before: true }), { put: false, why: 'not made by setup' });
  assert.equal(fs.existsSync(folder), true);
  assert.deepEqual(reverseChange(made), { put: true });
  assert.equal(fs.existsSync(folder), false);
});

test('step times give the director\'s minutes from shown to clicked, and the waits', () => {
  const run = {
    id: 'r', folder: '/work/a', startedAt: '2026-10-19T01:00:00.000Z',
    steps: {
      2: { shownAt: '2026-10-19T01:10:00.000Z', clickedAt: '2026-10-19T01:11:00.000Z', doneAt: '2026-10-19T01:11:30.000Z' },
      1: { shownAt: '2026-10-19T01:00:00.000Z', clickedAt: '2026-10-19T01:02:30.000Z', doneAt: '2026-10-19T01:07:30.000Z' },
      3: { shownAt: '2026-10-19T01:12:00.000Z', clickedAt: '2026-10-19T01:13:00.000Z' },
      4: { shownAt: '2026-10-19T01:14:00.000Z' },
    },
    changes: [],
  };
  assert.deepEqual(stepTimes(run), [
    { step: 1, directorMs: 150000, waitMs: 300000 },
    { step: 2, directorMs: 60000, waitMs: 30000 },
  ]);
  assert.deepEqual(stepTimes({ ...run, steps: {} }), []);
});
