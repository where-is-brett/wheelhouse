// tests/scripts/statusline.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { withHome, tempFolder } from '../helpers/homes.js';
import { nodeStartMs } from '../helpers/until.js';
import { usageDir } from '../../scripts/lib/paths.js';

const SCRIPT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'scripts', 'statusline.js');

function runScript(input, home) {
  return spawnSync(process.execPath, [SCRIPT], { input, encoding: 'utf8', env: { ...process.env, WHEELHOUSE_HOME: home }, timeout: 5000 });
}

const allowance = () => JSON.parse(fs.readFileSync(path.join(usageDir(), 'allowance.json'), 'utf8'));

test('the seven-day share and its reset time are recorded from the status-line input', () => withHome((home) => {
  const input = JSON.stringify({
    workspace: { current_dir: '/some/folder' },
    rate_limits: {
      five_hour: { used_percentage: 23.5, resets_at: 1738425600 },
      seven_day: { used_percentage: 41.2, resets_at: 1738857600 },
    },
  });
  const result = runScript(input, home);
  assert.equal(result.status, 0);
  assert.equal(result.stdout.trim(), 'Wheelhouse');
  const kept = allowance();
  assert.deepEqual(kept.windows, [
    { kind: 'five_hour', percentUsed: 23.5, resetsAt: '2025-02-01T16:00:00.000Z' },
    { kind: 'seven_day', percentUsed: 41.2, resetsAt: '2025-02-06T16:00:00.000Z' },
  ]);
  assert.ok(Number.isFinite(Date.parse(kept.at)));
}));

test('a window missing from the input is not recorded, and one with no usable share is dropped', () => withHome((home) => {
  const result = runScript(JSON.stringify({ rate_limits: { seven_day: { used_percentage: 10, resets_at: 1738857600 }, five_hour: { used_percentage: 'lots' } } }), home);
  assert.equal(result.status, 0);
  assert.deepEqual(allowance().windows, [{ kind: 'seven_day', percentUsed: 10, resetsAt: '2025-02-06T16:00:00.000Z' }]);
}));

test('a status-line input with no rate limits records nothing and still prints a line', () => withHome((home) => {
  for (const input of [JSON.stringify({ workspace: { current_dir: '/x' } }), JSON.stringify({ rate_limits: {} }), JSON.stringify({ rate_limits: null })]) {
    const result = runScript(input, home);
    assert.equal(result.status, 0);
    assert.equal(result.stdout.trim(), 'Wheelhouse');
  }
  assert.equal(fs.existsSync(path.join(usageDir(), 'allowance.json')), false);
}));

test('a failure prints Wheelhouse and exits 0', () => withHome((home) => {
  const broken = runScript('{not json', home);
  assert.equal(broken.status, 0);
  assert.equal(broken.stdout.trim(), 'Wheelhouse');
  const empty = runScript('', home);
  assert.equal(empty.status, 0);
  assert.equal(empty.stdout.trim(), 'Wheelhouse');
  // A home that is a file, so nothing can be written under it.
  const file = path.join(tempFolder('wh-statusline-'), 'not-a-folder');
  fs.writeFileSync(file, 'x');
  const input = JSON.stringify({ rate_limits: { seven_day: { used_percentage: 5, resets_at: 1738857600 } } });
  const unwritable = runScript(input, file);
  assert.equal(unwritable.status, 0);
  assert.equal(unwritable.stdout.trim(), 'Wheelhouse');
}));

test('input that never ends still gets a line, and quickly', async () => {
  const home = tempFolder('wh-statusline-');
  const boot = await nodeStartMs();
  const child = spawn(process.execPath, [SCRIPT], { env: { ...process.env, WHEELHOUSE_HOME: home }, stdio: ['pipe', 'pipe', 'ignore'] });
  const started = Date.now();
  let out = '';
  child.stdout.on('data', (d) => { out += d; });
  child.stdin.write('{"rate_limits":');
  const code = await new Promise((resolve) => child.on('close', resolve));
  assert.equal(code, 0);
  assert.equal(out.trim(), 'Wheelhouse');
  // Its limit counts from when Node has started it, which a loaded computer can make slow.
  assert.ok(Date.now() - started - boot < 1500, `took ${Date.now() - started} ms, ${boot} ms of it to start Node`);
});

test('a share outside 0 to 100 is dropped rather than recorded', () => withHome((home) => {
  const result = runScript(JSON.stringify({ rate_limits: { five_hour: { used_percentage: 140, resets_at: 1738425600 }, seven_day: { used_percentage: -3, resets_at: 1738857600 } } }), home);
  assert.equal(result.status, 0);
  assert.equal(result.stdout.trim(), 'Wheelhouse');
  assert.equal(fs.existsSync(path.join(usageDir(), 'allowance.json')), false);
  runScript(JSON.stringify({ rate_limits: { five_hour: { used_percentage: 0, resets_at: 1738425600 }, seven_day: { used_percentage: 100, resets_at: 1738857600 } } }), home);
  assert.deepEqual(allowance().windows.map((w) => w.percentUsed), [0, 100]);
}));

test('in a Wheelhouse project the line is the glance, with the share just recorded', () => withHome((home) => {
  const repo = path.join(home, 'repo');
  fs.mkdirSync(path.join(repo, '.git'), { recursive: true });
  const project = path.join(home, 'projects', 'owner__name');
  fs.mkdirSync(path.join(project, 'views'), { recursive: true });
  fs.writeFileSync(path.join(project, 'project.json'), JSON.stringify({
    folder: repo, remoteUrl: 'https://example.com/owner/name.git', host: 'github', repo: 'owner/name', connection: {},
  }));
  fs.writeFileSync(path.join(project, 'views', 'waiting.json'), JSON.stringify([{ id: 'c1', at: '2026-10-18T09:00:00.000Z', data: { title: 'Approve it' } }]));
  fs.writeFileSync(path.join(project, 'views', 'blockers.json'), JSON.stringify({
    pay: { key: 'pay', id: 'b1', at: '2026-10-10T00:00:00.000Z', data: { what: 'Payments', resolved: true } },
    law: { key: 'law', id: 'b2', at: '2026-10-11T00:00:00.000Z', data: { what: 'Privacy page' } },
  }));
  fs.writeFileSync(path.join(home, 'STOP'), '');
  const resetsAt = Math.floor(Date.now() / 1000) + 3 * 24 * 60 * 60;
  const result = runScript(JSON.stringify({ workspace: { current_dir: repo }, rate_limits: { seven_day: { used_percentage: 41.2, resets_at: resetsAt } } }), home);
  assert.equal(result.status, 0);
  assert.equal(result.stdout.trim(), 'Wheelhouse · 1 waiting · launch 1 of 2 · week 41% · STOP on');
}));
