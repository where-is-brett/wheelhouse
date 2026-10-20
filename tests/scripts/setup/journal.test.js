// tests/scripts/setup/journal.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {
  addChanges, applyJsonKey, closeRun, findRun, journalFile, markPutBack, markStep, readJournal, reverseChange, startRun, stepTimes, wouldReverse,
} from '../../../scripts/setup/journal.js';
import {
  CLICK_FRESH_MS, NODE_FLOOR, PUSH_TEST_WAIT_MS, RETENTION_DAYS, STEP_TIMEOUT_MS, TARGET_MINUTES,
} from '../../../scripts/lib/setup-numbers.js';
import { tempFolder, withHome } from '../../helpers/homes.js';
import { journalTrouble, NEWER_JOURNAL, NOT_A_JOURNAL, phonePushResult, runClosed } from '../../../scripts/lib/setup-run.js';

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

// Why the journal can't be read, for the session start's line and the mod's hold on the watcher
// (ruling R72): a journal a newer Wheelhouse wrote, or anything else; told by the refusal's code.
test('a journal that can\'t be read says why, by its refusal\'s code, and is left as it was', () => {
  withHome(() => {
    assert.equal(journalTrouble(), null, 'none at all reads as empty');
    fs.mkdirSync(path.dirname(journalFile()), { recursive: true });
    const cases = [
      ['{"v":1,"runs":[]}', null, null],
      ['{"v":1,"runs":[', NOT_A_JOURNAL, 'unreadable'],
      ['null', NOT_A_JOURNAL, 'unreadable'],
      ['[]', NOT_A_JOURNAL, 'unreadable'],
      ['{"runs":[]}', NOT_A_JOURNAL, 'unreadable'],
      ['{"v":1,"runs":{}}', NOT_A_JOURNAL, 'unreadable'],
      ['{"v":0,"runs":[]}', NOT_A_JOURNAL, 'unreadable'],
      ['{"v":"2","runs":[]}', NOT_A_JOURNAL, 'unreadable'],
      ['{"v":2,"runs":[]}', NEWER_JOURNAL, 'newer'],
      ['{"v":7}', NEWER_JOURNAL, 'newer'],
    ];
    for (const [text, code, trouble] of cases) {
      fs.writeFileSync(journalFile(), text);
      if (code === null) assert.doesNotThrow(() => readJournal(), text);
      else assert.throws(() => readJournal(), (error) => error.code === code && error.message.includes(journalFile()), text);
      assert.equal(journalTrouble(), trouble, text);
      assert.equal(readText(journalFile()), text);
    }
    // A journal that can't be opened is unreadable too.
    fs.rmSync(journalFile());
    fs.mkdirSync(journalFile());
    assert.equal(journalTrouble(), 'unreadable');
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

test('a file that cannot be read is reported as it is, not as the director\'s edit', () => {
  const dir = tempFolder('wh-journal-');
  // A folder where the file should be: reading it fails with something other than "missing".
  const target = path.join(dir, 'settings.json');
  fs.mkdirSync(target);
  for (const change of [
    { id: 'j', step: 6, kind: 'json-key', target, key: ['a'], before: null, after: 1 },
    { id: 'f', step: 7, kind: 'file', target, before: null, after: 'x' },
  ]) {
    const result = reverseChange(change);
    assert.equal(result.put, false);
    assert.match(result.why, /could not read .*settings\.json: EISDIR/);
    assert.notEqual(result.why, 'changed since setup');
  }
});

const journalUrl = new URL('../../../scripts/setup/journal.js', import.meta.url).href;

// Runs `body` in a separate node process with the same home; resolves with its exit code.
function child(body) {
  const code = `import(${JSON.stringify(journalUrl)}).then(async (j) => { const fs = await import('node:fs'); ${body} })`;
  return new Promise((resolve) => {
    const proc = spawn(process.execPath, ['-e', code], { env: process.env, stdio: 'ignore' });
    proc.on('exit', (exit) => resolve(exit));
  });
}

test('writers in several processes at once lose nothing', async () => {
  await withHome(async (home) => {
    const run = startRun({ folder: '/work/shop', now: at('2026-10-19T01:00:00.000Z') });
    const go = path.join(home, 'go');
    const workers = ['a', 'b', 'c'].map((name) => child(`
      while (!fs.existsSync(${JSON.stringify(go)})) await new Promise((r) => setTimeout(r, 2));
      for (let i = 1; i <= 25; i++) {
        j.markStep(${JSON.stringify(run.id)}, i, 'shownAt', { now: () => new Date('2026-10-19T02:00:00.000Z') });
        j.addChanges(${JSON.stringify(run.id)}, [{ id: '${name}' + i, step: i, kind: 'folder', target: '/x/${name}' + i, before: null, after: true }]);
      }`));
    fs.writeFileSync(go, '');
    for (let i = 1; i <= 25; i++) {
      addChanges(run.id, [{ id: `p${i}`, step: i, kind: 'folder', target: `/x/p${i}`, before: null, after: true }]);
      markStep(run.id, 30 + i, 'doneAt', { now: at('2026-10-19T02:00:00.000Z') });
    }
    assert.deepEqual(await Promise.all(workers), [0, 0, 0]);
    const found = findRun('/work/shop');
    assert.equal(found.changes.length, 25 * 4);
    assert.equal(new Set(found.changes.map((c) => c.id)).size, 100);
    for (let i = 1; i <= 25; i++) {
      assert.equal(found.steps[i].shownAt, '2026-10-19T02:00:00.000Z');
      assert.equal(found.steps[30 + i].doneAt, '2026-10-19T02:00:00.000Z');
    }
    assert.equal(fs.existsSync(`${journalFile()}.lock`), false);
  });
});

test('a writer waits for a lock another process holds, and goes on when it is released', async () => {
  await withHome(async () => {
    const run = startRun({ folder: '/work/shop', now: at('2026-10-19T01:00:00.000Z') });
    const lock = `${journalFile()}.lock`;
    fs.writeFileSync(lock, 'someone-else\n');
    const releasing = child(`setTimeout(() => fs.rmSync(${JSON.stringify(lock)}), 400)`);
    const began = Date.now();
    markStep(run.id, 1, 'shownAt', { now: at('2026-10-19T01:00:05.000Z') });
    assert.ok(Date.now() - began >= 200, 'the writer waited for the lock');
    assert.equal(findRun('/work/shop').steps[1].shownAt, '2026-10-19T01:00:05.000Z');
    assert.equal(fs.existsSync(lock), false);
    await releasing;
  });
});

test('a lock left by a process that died is taken over', () => {
  withHome(() => {
    const run = startRun({ folder: '/work/shop', now: at('2026-10-19T01:00:00.000Z') });
    const lock = `${journalFile()}.lock`;
    fs.writeFileSync(lock, '99999.dead\n');
    const old = new Date(Date.now() - 60 * 1000);
    fs.utimesSync(lock, old, old);
    markStep(run.id, 1, 'shownAt', { now: at('2026-10-19T01:00:05.000Z') });
    assert.equal(findRun('/work/shop').steps[1].shownAt, '2026-10-19T01:00:05.000Z');
    assert.deepEqual(fs.readdirSync(path.dirname(journalFile())), ['journal.json']);
  });
});

test('a key that held null is put back as null; only a key that was absent is removed', () => {
  withHome(() => {
    const dir = tempFolder('wh-journal-');
    const file = path.join(dir, 'settings.json');
    fs.writeFileSync(file, '{\n  "model": null\n}\n');
    const held = applyJsonKey({ file, key: ['model'], value: 'x' });
    assert.equal(held.before, null);
    assert.equal(held.absent, undefined);
    const missing = applyJsonKey({ file, key: ['other'], value: 1 });
    assert.equal(missing.before, null);
    assert.equal(missing.absent, true);
    assert.deepEqual(reverseChange(missing), { put: true });
    assert.deepEqual(reverseChange(held), { put: true });
    const back = readJson(file);
    assert.ok(Object.hasOwn(back, 'model'), 'the key that held null is still there');
    assert.equal(back.model, null);
    assert.equal(Object.hasOwn(back, 'other'), false);
    // The journal keeps the difference.
    const run = startRun({ folder: dir, now: at('2026-10-19T03:00:00.000Z') });
    addChanges(run.id, [{ ...held, step: 6 }, { ...missing, step: 6 }]);
    assert.deepEqual(findRun(dir).changes.map((c) => c.absent), [undefined, true]);
    assert.throws(() => addChanges(run.id, [{ ...missing, id: 'chg-0000000001', step: 6, absent: 'yes' }]), /absent/);
  });
});

test('a change is recorded before its key is written, and one recorded but never written is not put back', () => {
  withHome(() => {
    const dir = tempFolder('wh-journal-');
    const file = path.join(dir, 'settings.json');
    fs.writeFileSync(file, '{"theme":"dark"}\n');
    // The record is made while the file still holds its value before.
    const seen = [];
    const change = applyJsonKey({ file, key: ['theme'], value: 'light', record: (c) => seen.push([c, readJson(file).theme]) });
    assert.deepEqual(seen, [[change, 'dark']]);
    assert.equal(readJson(file).theme, 'light');
    // A record that fails leaves the file as it was.
    const stop = () => { throw new Error('the journal could not be written'); };
    assert.throws(() => applyJsonKey({ file, key: ['theme'], value: 'blue', record: stop }), /could not be written/);
    assert.equal(readJson(file).theme, 'light');
    // Recorded, then the write never happened (a crash between the two): neither a key that was
    // there nor one that was absent is touched on reversal.
    for (const key of [['theme'], ['absent']]) {
      let recorded = null;
      assert.throws(() => applyJsonKey({ file, key, value: 'setup', record: (c) => { recorded = c; throw new Error('crash'); } }), /crash/);
      const text = readText(file);
      assert.deepEqual(reverseChange(recorded), { put: false, why: 'changed since setup' });
      assert.equal(readText(file), text);
    }
  });
});

test('the journal is written for its owner only', { skip: process.platform === 'win32' }, () => {
  withHome(() => {
    startRun({ folder: tempFolder('wh-journal-'), now: at('2026-10-19T03:00:00.000Z') });
    assert.equal(fs.statSync(journalFile()).mode & 0o777, 0o600);
    fs.chmodSync(journalFile(), 0o644);
    startRun({ folder: tempFolder('wh-journal-'), now: at('2026-10-19T03:00:00.000Z') });
    assert.equal(fs.statSync(journalFile()).mode & 0o777, 0o600);
  });
});

test('the journal\'s source names the byte order mark by its escape, not as a literal character', () => {
  const source = fs.readFileSync(new URL('../../../scripts/setup/journal.js', import.meta.url), 'utf8');
  assert.equal(source.includes('\uFEFF'), false);
});

// ---- Uninstall's marks (ruling R89) ----

test('each change uninstall puts back is marked once, with when, whether it was put back and why', () => {
  withHome(() => {
    const run = startRun({ folder: tempFolder('wh-journal-'), now: at('2026-10-19T03:00:00.000Z') });
    const other = startRun({ folder: tempFolder('wh-journal-'), now: at('2026-10-19T03:00:00.000Z') });
    const change = (id) => ({ id, step: 6, kind: 'json-key', target: '/x/settings.json', key: ['a'], before: null, absent: true, after: 1 });
    addChanges(run.id, [change('c1'), change('c2')]);
    addChanges(other.id, [change('c3')]);
    // Several at once, across runs, in one write.
    assert.deepEqual(markPutBack(['c1', 'c3'], { put: true, now: at('2026-10-20T01:00:00.000Z') }), ['c1', 'c3']);
    const marks = () => Object.fromEntries(readJournal().runs.flatMap((r) => r.changes).map((c) => [c.id, c.putBack]));
    assert.deepEqual(marks(), { c1: { at: '2026-10-20T01:00:00.000Z', put: true }, c2: undefined, c3: { at: '2026-10-20T01:00:00.000Z', put: true } });
    // One left, with why; a mark already made stays as it was, so nothing is reversed twice.
    assert.deepEqual(markPutBack('c2', { put: false, why: 'changed since setup', now: at('2026-10-20T02:00:00.000Z') }), ['c2']);
    assert.deepEqual(markPutBack(['c1', 'c2'], { put: false, why: 'again', now: at('2026-10-20T03:00:00.000Z') }), []);
    assert.deepEqual(marks().c1, { at: '2026-10-20T01:00:00.000Z', put: true });
    assert.deepEqual(marks().c2, { at: '2026-10-20T02:00:00.000Z', put: false, why: 'changed since setup' });
    // An id the journal hasn't got is refused, and nothing is marked.
    const text = readText(journalFile());
    assert.throws(() => markPutBack(['c3', 'nope'], { put: true, now: at('2026-10-20T04:00:00.000Z') }), /nope/);
    assert.equal(readText(journalFile()), text);
    assert.throws(() => markPutBack([], { put: true, now: at('2026-10-20T04:00:00.000Z') }), /at least one/);
    assert.throws(() => markPutBack('c1', { put: 'yes', now: at('2026-10-20T04:00:00.000Z') }), /true or false/);
    assert.throws(() => markPutBack('c1', { put: false, why: '', now: at('2026-10-20T04:00:00.000Z') }), /why/i);
    // A step never records a change as put back already.
    assert.throws(() => addChanges(run.id, [{ ...change('c4'), putBack: { at: 'x', put: true } }]), /put back/);
  });
});

test('a run uninstall has closed is marked closed, once, and a closed run no longer gives the phone push result', () => {
  withHome(() => {
    const run = startRun({ folder: tempFolder('wh-journal-'), now: at('2026-10-19T03:00:00.000Z') });
    markStep(run.id, 9, 'doneAt', { now: at('2026-10-19T04:00:00.000Z') });
    addChanges(run.id, [{ id: 'c9', step: 9, kind: 'answer', target: 'step 9', before: null, after: { pushArrived: true } }]);
    assert.equal(runClosed(readJournal().runs[0]), false);
    assert.equal(phonePushResult().arrived, true);
    assert.equal(closeRun(run.id, { at: at('2026-10-20T05:00:00.000Z'), by: 'uninstall' }), true);
    const closed = readJournal().runs[0];
    assert.equal(closed.closedAt, '2026-10-20T05:00:00.000Z');
    assert.equal(closed.closedBy, 'uninstall');
    assert.equal(runClosed(closed), true);
    assert.equal(phonePushResult(), null, 'a computer that has left is asked the push test again');
    // Closed once: a second close changes nothing.
    assert.equal(closeRun(run.id, { at: at('2026-10-21T05:00:00.000Z'), by: 'uninstall' }), false);
    assert.equal(readJournal().runs[0].closedAt, '2026-10-20T05:00:00.000Z');
    assert.throws(() => closeRun('run-none', { at: at('2026-10-21T05:00:00.000Z'), by: 'uninstall' }), /no setup run/);
    assert.throws(() => closeRun(run.id, { at: at('2026-10-21T05:00:00.000Z'), by: 'someone' }), /uninstall/);
    assert.equal(runClosed(null), false);
    assert.equal(runClosed({ closedAt: 7 }), false);
  });
});

test('wouldReverse says what reverseChange would, and changes nothing', () => {
  withHome(() => {
    const dir = tempFolder('wh-journal-');
    const file = path.join(dir, 'settings.json');
    fs.writeFileSync(file, '{"a":1}\n');
    const key = applyJsonKey({ file, key: ['a'], value: 2, step: 6 });
    const text = path.join(dir, 'note.txt');
    const made = path.join(dir, 'made');
    fs.mkdirSync(made);
    const folder = { id: 'f', step: 3, kind: 'folder', target: made, before: null, after: {} };
    const note = { id: 'n', step: 7, kind: 'file', target: text, before: null, after: 'setup\n' };
    fs.writeFileSync(text, 'setup\n');
    const before = [readText(file), readText(text)];
    for (const c of [key, note, folder]) assert.deepEqual(wouldReverse(c), { put: true });
    assert.deepEqual([readText(file), readText(text)], before);
    assert.equal(fs.existsSync(made), true);
    fs.writeFileSync(path.join(made, 'x'), '');
    fs.writeFileSync(text, 'theirs\n');
    fs.writeFileSync(file, '{"a":3}\n');
    for (const c of [key, note, folder]) assert.deepEqual(wouldReverse(c), { put: false, why: 'changed since setup' });
    assert.deepEqual(wouldReverse({ ...folder, before: {} }), { put: false, why: 'not made by setup' });
    assert.deepEqual(wouldReverse({ id: 'e', kind: 'env', target: 'X', before: null, after: '1' }), { put: false, why: 'put back by its own step' });
  });
});
