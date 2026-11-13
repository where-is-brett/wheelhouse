// tests/probes/haiku-trial/snapshot.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { takeLocal, restoreLocal, listSnapshots, nextNumber, writeMeta, readMeta, snapshotsDir, SNAPSHOT_POINTS, pointsFor } from '../../../probes/haiku-trial/snapshot.js';

function scratch(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'haiku-snap-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}
const put = (file, text) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, text); };

function runFolder(root) {
  const folder = path.join(root, 'haiku-2026-11-13');
  put(path.join(folder, 'project', 'src', 'a.js'), 'a');
  put(path.join(folder, 'wheelhouse-home', 'projects', 'p', 'events.jsonl'), '{"a":1}\n');
  put(path.join(folder, 'plugin', 'plugin.json'), '{}');
  put(path.join(folder, 'plugin.tar'), 'tar');
  put(path.join(folder, 'state.json'), '{"x":1}');
  put(path.join(folder, 'run-log.jsonl'), '{"step":"stage"}\n');
  return folder;
}

test('takeLocal copies the run and leaves out sockets', async (t) => {
  const root = scratch(t);
  const folder = runFolder(root);
  // A socket path has a short length limit, so it is made from inside its folder by a relative name. Where a socket cannot be
  // made (a sandbox), a plain file with the same name still tests the name filter.
  const server = net.createServer();
  const here = process.cwd();
  process.chdir(path.join(folder, 'wheelhouse-home'));
  try {
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen('helper.sock', resolve); });
    t.after(() => server.close());
  } catch { fs.writeFileSync('helper.sock', ''); } finally { process.chdir(here); }
  const dest = path.join(root, 'snaps', '01-after-w2-audit');
  const configDir = path.join(root, 'claude');
  const transcript = path.join(configDir, 'projects', '-proj', 's1.jsonl');
  put(transcript, '{"t":1}\n');
  const got = takeLocal({ folder, dest, configDir, transcripts: [transcript, path.join(root, 'elsewhere.jsonl')] });
  assert.deepEqual(got.torn, []);
  assert.equal(fs.readFileSync(path.join(dest, 'run', 'project', 'src', 'a.js'), 'utf8'), 'a');
  assert.ok(fs.existsSync(path.join(dest, 'run', 'wheelhouse-home', 'projects', 'p', 'events.jsonl')));
  assert.equal(fs.existsSync(path.join(dest, 'run', 'wheelhouse-home', 'helper.sock')), false);
  assert.equal(fs.existsSync(path.join(dest, 'run', 'plugin.tar')), false);
  assert.equal(fs.readFileSync(path.join(dest, 'run', 'state.json'), 'utf8'), '{"x":1}');
  assert.equal(fs.readFileSync(path.join(dest, 'transcripts', '-proj', 's1.jsonl'), 'utf8'), '{"t":1}\n');
});

test('a torn last jsonl line is cut and reported', (t) => {
  const root = scratch(t);
  const folder = runFolder(root);
  put(path.join(folder, 'run-log.jsonl'), '{"a":1}\n{"b":');
  const dest = path.join(root, 'snaps', '01-x');
  const got = takeLocal({ folder, dest, configDir: path.join(root, 'claude') });
  assert.equal(got.torn.length, 1);
  assert.equal(got.torn[0].file, 'run-log.jsonl');
  assert.equal(got.torn[0].cut, 1);
  const lines = fs.readFileSync(path.join(dest, 'run', 'run-log.jsonl'), 'utf8').split('\n').filter(Boolean);
  assert.deepEqual(lines.map((l) => JSON.parse(l)), [{ a: 1 }]);
  // The folder itself is left as it was.
  assert.equal(fs.readFileSync(path.join(folder, 'run-log.jsonl'), 'utf8'), '{"a":1}\n{"b":');
});

test('a whole last line is kept, with or without a closing newline', (t) => {
  const root = scratch(t);
  const folder = runFolder(root);
  put(path.join(folder, 'run-log.jsonl'), '{"a":1}\n{"b":2}');
  const got = takeLocal({ folder, dest: path.join(root, 'snaps', '01-x'), configDir: path.join(root, 'claude') });
  assert.deepEqual(got.torn, []);
});

test('restoreLocal puts the run back and refuses an existing folder', (t) => {
  const root = scratch(t);
  const folder = runFolder(root);
  const configDir = path.join(root, 'claude');
  const transcript = path.join(configDir, 'projects', '-proj', 's1.jsonl');
  put(transcript, '{"t":1}\n');
  const dest = path.join(root, 'snaps', '01-x');
  takeLocal({ folder, dest, configDir, transcripts: [transcript] });
  assert.throws(() => restoreLocal({ dest, folder, configDir }), /already exists/);
  fs.rmSync(folder, { recursive: true });
  fs.rmSync(path.join(configDir, 'projects'), { recursive: true });
  restoreLocal({ dest, folder, configDir });
  assert.equal(fs.readFileSync(path.join(folder, 'project', 'src', 'a.js'), 'utf8'), 'a');
  assert.equal(fs.readFileSync(path.join(folder, 'state.json'), 'utf8'), '{"x":1}');
  assert.equal(fs.readFileSync(transcript, 'utf8'), '{"t":1}\n');
});

test('listSnapshots sorts by number', (t) => {
  const dir = scratch(t);
  for (const name of ['10-after-w4-audit', '02-before-f1', '01-after-ntfy']) writeMeta(path.join(dir, name), { point: name.slice(3) });
  fs.mkdirSync(path.join(dir, 'not-numbered'));
  assert.deepEqual(listSnapshots(dir).map((s) => s.name), ['01-after-ntfy', '02-before-f1', '10-after-w4-audit']);
  assert.equal(listSnapshots(dir)[1].meta.point, 'before-f1');
  assert.equal(nextNumber(dir), '11');
  assert.equal(nextNumber(path.join(dir, 'none')), '01');
  assert.equal(readMeta(path.join(dir, 'none')), null);
});

test('snapshot points follow the spec and a smoke run takes only its own', () => {
  assert.equal(snapshotsDir('2026-11-13', '/b'), '/b/haiku-2026-11-13.snapshots');
  assert.deepEqual(pointsFor('full').map((p) => p.point), ['after-ntfy', 'after-w2-audit', 'before-f1', 'after-w3-audit', 'before-f4-check', 'before-s9-1', 'after-w4-audit']);
  assert.deepEqual(pointsFor('smoke').map((p) => p.point), ['after-front-desk', 'after-w2-audit', 'before-s9-1', 'after-w4-audit']);
  assert.ok(SNAPSHOT_POINTS.every((p) => (p.after === undefined) !== (p.before === undefined)));
});
