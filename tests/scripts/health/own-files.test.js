// tests/scripts/health/own-files.test.js
// A look at Wheelhouse's and Copilot's own files (Task B3): a baseline of their hashes, the names of what changed, and
// the weekly check that makes a baseline afresh after setup and each update, and never reads a sign-in.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { ownFilesBaseline, ownFilesChanged, checkOwnFiles, ownFilesLine, readOwnFilesState } from '../../../scripts/health/own-files.js';
import { as, tempFolder } from '../../helpers/homes.js';

// A person's home with Copilot's own folder, a plugin root, an engine with the clean home, and an add-on.
function layout() {
  const base = tempFolder('wh-own-');
  const home = path.join(base, 'user');
  const root = path.join(base, 'plugin');
  const engine = path.join(base, 'engine');
  const put = (file, text) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, text); return file; };
  const files = {
    hook: put(path.join(home, '.copilot', 'hooks', 'wheelhouse.json'), '{"hooks":1}\n'),
    agent: put(path.join(home, '.copilot', 'agents', 'lookout.md'), 'lookout\n'),
    settings: put(path.join(home, '.copilot', 'settings.json'), '{"a":1}\n'),
    signIn: put(path.join(home, '.copilot', 'config.json'), '{"token":"SECRET-SIGN-IN"}\n'),
    cleanHook: put(path.join(engine, 'copilot', 'home', 'hooks', 'wheelhouse.json'), '{"clean":1}\n'),
    cleanSettings: put(path.join(engine, 'copilot', 'home', 'settings.json'), '{"c":1}\n'),
    cleanSignIn: put(path.join(engine, 'copilot', 'home', 'config.json'), '{"token":"SECRET-CLEAN"}\n'),
    addon: put(path.join(home, '.vscode', 'extensions', 'wheelhouse.wheelhouse-0.2.0', 'extension.js'), 'addon\n'),
    script: put(path.join(root, 'scripts', 'x.js'), 'x\n'),
    manifest: put(path.join(root, '.claude-plugin', 'plugin.json'), '{"version":"0.2.0"}\n'),
    login: put(path.join(home, 'Library', 'LaunchAgents', 'dev.wheelhouse.helper.plist'), '<plist/>\n'),
    other: put(path.join(home, '.copilot', 'session-state', 'chat.json'), 'not ours\n'),
  };
  return { home, root, engine, files, loginFile: files.login };
}

test('a changed hook file is named, and so is one added or removed', () => {
  const l = layout();
  const before = ownFilesBaseline(l);
  assert.deepEqual(ownFilesChanged(before, ownFilesBaseline(l)), []);
  fs.writeFileSync(l.files.hook, '{"hooks":2}\n');
  assert.deepEqual(ownFilesChanged(before, ownFilesBaseline(l)), [l.files.hook]);
  fs.writeFileSync(path.join(l.home, '.copilot', 'hooks', 'extra.json'), '{}\n');
  fs.rmSync(l.files.agent);
  fs.writeFileSync(l.files.cleanSettings, '{"c":2}\n');
  fs.writeFileSync(l.files.addon, 'changed\n');
  assert.deepEqual(ownFilesChanged(before, ownFilesBaseline(l)).sort(), [l.files.hook, path.join(l.home, '.copilot', 'hooks', 'extra.json'), l.files.agent, l.files.cleanSettings, l.files.addon].sort());
});

test('what isn\'t Wheelhouse\'s or Copilot\'s own settings is not in the baseline', () => {
  const l = layout();
  const names = [...ownFilesBaseline(l).keys()];
  assert.ok(names.includes(l.files.script) && names.includes(l.files.login) && names.includes(l.files.cleanHook));
  assert.equal(names.includes(l.files.other), false, 'a chat\'s state');
});

test('the sign-in is never read', () => {
  const l = layout();
  const reads = [];
  const read = (file) => { reads.push(file); return fs.readFileSync(file); };
  const baseline = ownFilesBaseline({ ...l, read });
  assert.ok(reads.length > 0);
  for (const secret of [l.files.signIn, l.files.cleanSignIn]) {
    assert.equal(reads.includes(secret), false, `${secret} was read`);
    assert.equal(baseline.has(secret), false);
  }
  fs.writeFileSync(l.files.signIn, '{"token":"ROTATED"}\n');
  assert.deepEqual(ownFilesChanged(baseline, ownFilesBaseline(l)), [], 'a new sign-in is no change');
});

test('no baseline yet says nothing, and makes one', async () => {
  const l = layout();
  await as(path.join(tempFolder('wh-own-home-'), 'wh'), () => {
    const first = checkOwnFiles({ ...l, now: () => new Date('2026-11-02T00:00:00.000Z') });
    assert.deepEqual(first, { changed: [] });
    assert.notEqual(readOwnFilesState(), null, 'a baseline is kept');
    fs.writeFileSync(l.files.hook, '{"hooks":2}\n');
    // Checked again within the day: the answer from the day is kept, so the board never waits on a walk of the files.
    assert.deepEqual(checkOwnFiles({ ...l, now: () => new Date('2026-11-02T06:00:00.000Z') }), { changed: [] });
    assert.deepEqual(checkOwnFiles({ ...l, now: () => new Date('2026-11-03T06:00:00.000Z') }), { changed: [l.files.hook] });
    assert.deepEqual(checkOwnFiles({ ...l, now: () => new Date('2026-11-05T06:00:00.000Z') }), { changed: [l.files.hook] }, 'still named until the files are accepted');
  });
});

test('an update of Wheelhouse makes a new baseline and names nothing', async () => {
  const l = layout();
  await as(path.join(tempFolder('wh-own-home-'), 'wh'), () => {
    checkOwnFiles({ ...l, now: () => new Date('2026-11-02T00:00:00.000Z') });
    fs.writeFileSync(l.files.manifest, '{"version":"0.2.1"}\n');
    fs.writeFileSync(l.files.script, 'x2\n');
    fs.writeFileSync(l.files.hook, '{"hooks":3}\n');
    assert.deepEqual(checkOwnFiles({ ...l, now: () => new Date('2026-11-04T00:00:00.000Z') }), { changed: [] });
    assert.equal(readOwnFilesState().version, '0.2.1');
    fs.writeFileSync(l.files.hook, '{"hooks":4}\n');
    assert.deepEqual(checkOwnFiles({ ...l, now: () => new Date('2026-11-06T00:00:00.000Z') }), { changed: [l.files.hook] }, 'a change after the update is named');
  });
});

test('the line names a change in plain words, and the board says nothing for none', () => {
  const l = layout();
  assert.equal(ownFilesLine([], l), null);
  const line = ownFilesLine([l.files.hook, l.files.cleanSettings, l.files.script], l);
  assert.match(line, /Copilot's guard files/);
  assert.match(line, /build engine's own Copilot folder/);
  assert.match(line, /Wheelhouse's own files/);
  assert.doesNotMatch(line, /\/user\//, 'no path from the person\'s computer');
});

test('the board shows the look, the key and the host approval lines when they apply, and none otherwise', async () => {
  const { healthLines } = await import('../../../scripts/board/health.js');
  const texts = (extra) => healthLines({ record: { connection: {} }, platform: 'linux', ...extra }).map((l) => l.text);
  const quiet = texts({});
  assert.equal(quiet.some((t) => /new signing key|have changed|own approval/.test(t)), false);
  const all = texts({ keyRenewal: { due: true, why: 'a period at Unattended has ended' }, ownFiles: { line: 'Some of the files that guard your project have changed' }, hostApproval: true });
  assert.ok(all.some((t) => /new signing key is due: a period at Unattended has ended/.test(t)));
  assert.ok(all.some((t) => /have changed/.test(t)));
  assert.ok(all.some((t) => /own approval on GitHub/.test(t)));
});
