// tests/probes/haiku-trial/seed.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { makeTestProject } from '../../../probes/haiku-trial/seed.js';

function childEnv(extra = {}) {
  const env = { ...process.env, ...extra };
  for (const key of Object.keys(env)) if (key.startsWith('NODE_TEST')) delete env[key];
  return env;
}

function fresh() {
  const dir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'haiku-seed-')), 'project');
  return { dir, ...makeTestProject({ dir }) };
}

function cleanup(dir) {
  fs.rmSync(path.dirname(dir), { recursive: true, force: true });
}

test('makeTestProject builds a repository whose smoke test passes', () => {
  const { dir, sha } = fresh();
  try {
    const run = spawnSync(process.execPath, ['--test'], { cwd: dir, encoding: 'utf8', env: childEnv() });
    assert.equal(run.status, 0, run.stdout + run.stderr);
    const log = spawnSync('git', ['log', '--oneline'], { cwd: dir, encoding: 'utf8' }).stdout.trim().split('\n');
    assert.equal(log.length, 1);
    assert.match(log[0], /Seed the spending tracker/);
    assert.match(sha, /^[0-9a-f]{40}$/);
    assert.ok(fs.existsSync(path.join(dir, 'data', 'sample-statement.csv')));
  } finally {
    cleanup(dir);
  }
});

test('home page says Nothing imported yet', async () => {
  const { dir } = fresh();
  const child = spawn(process.execPath, ['src/server.js'], {
    cwd: dir,
    env: childEnv({ PORT: '0', LEDGER_DB: ':memory:' }),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  try {
    const port = await new Promise((resolve, reject) => {
      let out = '';
      const timer = setTimeout(() => reject(new Error(`no port announced: ${out}`)), 10000);
      child.stdout.on('data', (chunk) => {
        out += chunk;
        const hit = /listening on (\d+)/.exec(out);
        if (hit) {
          clearTimeout(timer);
          resolve(hit[1]);
        }
      });
      child.on('exit', () => reject(new Error(`server exited: ${out}`)));
    });
    const response = await fetch(`http://127.0.0.1:${port}/`);
    assert.match(await response.text(), /Nothing imported yet/);
  } finally {
    child.kill();
    cleanup(dir);
  }
});

test('parseAmount has the planted bug, and dates read DD/MM/YYYY without a clock', async () => {
  const { dir } = fresh();
  try {
    const money = await import(pathToFileURL(path.join(dir, 'src/lib/money.js')));
    assert.equal(money.parseAmount('(40.00)'), 4000);
    assert.equal(money.parseAmount('-12.50'), -1250);
    assert.equal(money.parseAmount('1,234.50'), 123450);
    const dates = await import(pathToFileURL(path.join(dir, 'src/lib/dates.js')));
    assert.equal(dates.parseDate('31/08/2026'), '2026-08-31');
    assert.equal(dates.monthOf('31/08/2026'), '2026-08');
  } finally {
    cleanup(dir);
  }
});

test('project settings run every session on haiku and switch Wheelhouse on for the project', () => {
  const { dir } = fresh();
  try {
    const settings = JSON.parse(fs.readFileSync(path.join(dir, '.claude/settings.json'), 'utf8'));
    // As `claude plugin install wheelhouse@wheelhouse --scope project` would: the hooks act only in a folder whose own settings
    // switch the plugin on, so without it the session start never starts the helper and setup cannot begin.
    assert.deepEqual(settings, { model: 'haiku', env: { CLAUDE_CODE_SUBAGENT_MODEL: 'haiku' }, enabledPlugins: { 'wheelhouse@wheelhouse': true } });
  } finally {
    cleanup(dir);
  }
});

test('ci runs npm ci and npm test on Node 22', () => {
  const { dir } = fresh();
  try {
    const text = fs.readFileSync(path.join(dir, '.github/workflows/ci.yml'), 'utf8');
    assert.match(text, /npm ci/);
    assert.match(text, /npm test/);
    const list = /node-version:\s*\[([^\]]*)\]/.exec(text);
    assert.deepEqual(list[1].split(',').map((s) => s.trim()), ['22']);
  } finally {
    cleanup(dir);
  }
});

test('the seed carries a lockfile that matches package.json, so npm ci works, and ignores what a run leaves behind', () => {
  const { dir } = fresh();
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
    const lock = JSON.parse(fs.readFileSync(path.join(dir, 'package-lock.json'), 'utf8'));
    assert.equal(lock.lockfileVersion, 3);
    assert.equal(lock.name, pkg.name);
    assert.equal(lock.version, pkg.version);
    assert.deepEqual(Object.keys(lock.packages), [''], 'the seed has no dependencies, so the lockfile has no packages');
    assert.deepEqual(lock.packages[''].dependencies ?? {}, pkg.dependencies ?? {});
    const ignore = fs.readFileSync(path.join(dir, '.gitignore'), 'utf8').split('\n');
    assert.ok(ignore.includes('node_modules'));
    assert.ok(ignore.includes('ledger.db*'));
    const tracked = spawnSync('git', ['ls-files'], { cwd: dir, encoding: 'utf8' }).stdout.split('\n');
    assert.ok(tracked.includes('package-lock.json'));
    assert.ok(tracked.includes('.gitignore'));
  } finally {
    cleanup(dir);
  }
});

test('refuses a folder outside the temp folder', () => {
  assert.throws(() => makeTestProject({ dir: path.join(process.cwd(), 'not-in-tmp') }), /outside the temporary folder/);
  assert.equal(fs.existsSync(path.join(process.cwd(), 'not-in-tmp')), false);
});
