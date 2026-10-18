// tests/scripts/state/backup.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { writeBackup } from '../../../scripts/state/backup.js';
import { cloneState } from '../../../scripts/state/clone.js';
import { run } from '../../../scripts/lib/run.js';
import { makeBareRemote } from '../../helpers/git-fixture.js';
import { tempFolder } from '../../helpers/homes.js';

test('writeBackup makes a bundle that git can verify, at most weekly, keeping eight', async () => {
  const remote = await makeBareRemote();
  const home = path.join(tempFolder('wh-bk-'), 'Zoë home');
  const before = process.env.WHEELHOUSE_HOME;
  process.env.WHEELHOUSE_HOME = home;
  try {
    const stateDir = await cloneState({ project: 'o__p', remoteUrl: remote.url });
    const day = (n) => () => new Date(Date.UTC(2026, 0, 1 + n, 12));
    const first = await writeBackup({ project: 'o__p', now: day(0) });
    assert.equal(path.basename(first), '2026-01-01.bundle');
    assert.equal(path.dirname(first), path.join(home, 'profile', 'backups', 'o__p'));
    const verified = await run('git', ['bundle', 'verify', first], { cwd: stateDir });
    assert.equal(verified.code, 0);
    // within seven days: skipped, existing path returned
    assert.equal(await writeBackup({ project: 'o__p', now: day(6) }), first);
    assert.equal(fs.readdirSync(path.dirname(first)).length, 1);
    // every eight days for twelve backups
    for (let i = 1; i <= 11; i++) await writeBackup({ project: 'o__p', now: day(i * 8) });
    const names = fs.readdirSync(path.dirname(first)).sort();
    assert.equal(names.length, 8);
    assert.equal(names[0], new Date(Date.UTC(2026, 0, 1 + 4 * 8)).toISOString().slice(0, 10) + '.bundle');
    fs.writeFileSync(path.join(path.dirname(first), 'notes.txt'), 'keep');
    await writeBackup({ project: 'o__p', now: day(200) });
    assert.ok(fs.existsSync(path.join(path.dirname(first), 'notes.txt')));
  } finally {
    if (before === undefined) delete process.env.WHEELHOUSE_HOME; else process.env.WHEELHOUSE_HOME = before;
    remote.cleanup();
  }
});

test('a bundle dated in the future does not stop the weekly backup', async () => {
  const remote = await makeBareRemote();
  const home = path.join(tempFolder('wh-bk-'), 'home');
  const before = process.env.WHEELHOUSE_HOME;
  process.env.WHEELHOUSE_HOME = home;
  try {
    await cloneState({ project: 'o__p', remoteUrl: remote.url });
    const folder = path.join(home, 'profile', 'backups', 'o__p');
    fs.mkdirSync(folder, { recursive: true });
    fs.writeFileSync(path.join(folder, '2099-01-01.bundle'), 'not a bundle');
    const made = await writeBackup({ project: 'o__p', now: () => new Date(Date.UTC(2026, 0, 1, 12)) });
    assert.equal(path.basename(made), '2026-01-01.bundle');
    assert.ok(fs.existsSync(path.join(folder, '2099-01-01.bundle')), 'the future file is left alone');
  } finally {
    if (before === undefined) delete process.env.WHEELHOUSE_HOME; else process.env.WHEELHOUSE_HOME = before;
    remote.cleanup();
  }
});
