// tests/scripts/engine/archon/build.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { buildFromSource, ARCHON_SOURCE, BUN_PIN, PATCHES, CANCEL_PATCH_MARK, CLI_PATCH_MARK, enginePaths, launcherText, archonSettingsFile, archonSettingsOk, writeArchonSettings } from '../../../../scripts/engine/archon/build.js';

const sha = (buffer) => crypto.createHash('sha256').update(buffer).digest('hex');

// A stood-in world: a fake download, and a `run` that records every command and plays git, unzip and bun.
function world({ head = ARCHON_SOURCE.commit, zip = Buffer.from('bun zip'), failInstall = false } = {}) {
  const engine = fs.mkdtempSync(path.join(os.tmpdir(), 'wh-engine-build-'));
  const calls = [];
  const fetched = [];
  const fetcher = async (url) => {
    fetched.push(url);
    return { ok: true, status: 200, arrayBuffer: async () => zip };
  };
  const run = async (file, args = [], options = {}) => {
    calls.push({ file, args, options });
    const name = path.basename(file);
    if (name === 'git' && args[0] === 'clone') fs.mkdirSync(args[args.length - 1], { recursive: true });
    if (name === 'git' && args.includes('rev-parse')) return { code: 0, stdout: `${head}\n`, stderr: '' };
    if (name === 'unzip') {
      const into = args[args.indexOf('-d') + 1];
      const dir = path.join(into, 'bun-darwin-aarch64');
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, 'bun'), 'bun');
    }
    if (name === 'bun' && failInstall) return { code: 1, stdout: '', stderr: 'lockfile out of date' };
    return { code: 0, stdout: '', stderr: '' };
  };
  return { engine, calls, fetched, fetcher, run };
}

const pins = (zip) => ({ ...BUN_PIN, sums: { 'bun-darwin-aarch64.zip': sha(zip) } });

test('the build clones the pinned tag, checks its commit, applies the patch and installs with the lockfile', async () => {
  const w = world();
  const built = await buildFromSource({ engine: w.engine, run: w.run, fetcher: w.fetcher, arch: 'arm64', platform: 'darwin', bun: pins(Buffer.from('bun zip')) });
  const p = enginePaths(w.engine);
  const git = w.calls.filter((c) => path.basename(c.file) === 'git').map((c) => c.args);
  const clone = git.find((args) => args[0] === 'clone');
  assert.ok(clone.includes(ARCHON_SOURCE.tag) && clone.includes(ARCHON_SOURCE.repo));
  const applied = git.filter((args) => args.includes('apply')).map((args) => path.basename(args[args.length - 1]));
  assert.deepEqual(applied, PATCHES);
  const install = w.calls.find((c) => path.basename(c.file) === 'bun');
  assert.equal(install.file, p.bunBin);
  assert.deepEqual(install.args, ['install', '--frozen-lockfile', '--ignore-scripts']);
  assert.equal(install.options.cwd, p.src);
  assert.equal(built.archonBin, p.launcher);
  const launcher = fs.readFileSync(p.launcher, 'utf8');
  assert.match(launcher, new RegExp(p.bunBin.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(launcher, /packages\/cli\/src\/cli\.ts/);
  assert.equal(launcher, launcherText(w.engine));
});

test("the launcher gives Bun the engine's own empty bunfig, so none in the folder Archon starts in is read", async () => {
  const w = world();
  await buildFromSource({ engine: w.engine, run: w.run, fetcher: w.fetcher, arch: 'arm64', platform: 'darwin', bun: pins(Buffer.from('bun zip')) });
  const p = enginePaths(w.engine);
  assert.equal(p.bunfig, path.join(w.engine, 'archon', 'bunfig.toml'));
  assert.doesNotMatch(fs.readFileSync(p.bunfig, 'utf8'), /^\s*[^#\s]/m, 'the bunfig sets nothing');
  const exec = fs.readFileSync(p.launcher, 'utf8').split('\n').find((line) => line.startsWith('exec '));
  assert.equal(exec, `exec '${p.bunBin}' --config='${p.bunfig}' --no-env-file '${path.join(p.src, 'packages', 'cli', 'src', 'cli.ts')}' "$@"`);
});

test('the build installs with the telemetry switches and without the caller\'s PATH', async () => {
  const w = world();
  await buildFromSource({ engine: w.engine, run: w.run, fetcher: w.fetcher, arch: 'arm64', platform: 'darwin', bun: pins(Buffer.from('bun zip')) });
  const install = w.calls.find((c) => path.basename(c.file) === 'bun');
  assert.deepEqual(install.options.baseEnv, {});
  for (const [name, value] of Object.entries({ ARCHON_TELEMETRY_DISABLED: '1', DO_NOT_TRACK: '1', POSTHOG_API_KEY: 'off' })) {
    assert.equal(install.options.env[name], value);
  }
  assert.ok(!install.options.env.PATH.split(path.delimiter).includes('/opt/homebrew/bin'));
});

test('a source at another commit is refused before anything is installed', async () => {
  const w = world({ head: 'f'.repeat(40) });
  await assert.rejects(
    buildFromSource({ engine: w.engine, run: w.run, fetcher: w.fetcher, arch: 'arm64', platform: 'darwin', bun: pins(Buffer.from('bun zip')) }),
    /commit/,
  );
  assert.ok(!w.calls.some((c) => path.basename(c.file) === 'bun'));
});

test('a Bun download that does not match its pinned checksum is refused', async () => {
  const w = world();
  await assert.rejects(
    buildFromSource({ engine: w.engine, run: w.run, fetcher: w.fetcher, arch: 'arm64', platform: 'darwin', bun: { ...BUN_PIN, sums: { 'bun-darwin-aarch64.zip': '0'.repeat(64) } } }),
    /checksum/,
  );
  assert.ok(!w.calls.some((c) => path.basename(c.file) === 'git'));
});

test('a failed install says so in plain words', async () => {
  const w = world({ failInstall: true });
  await assert.rejects(
    buildFromSource({ engine: w.engine, run: w.run, fetcher: w.fetcher, arch: 'arm64', platform: 'darwin', bun: pins(Buffer.from('bun zip')) }),
    /lockfile out of date/,
  );
});

test('the patch applies to the pinned source as a git patch and names only the Claude provider', () => {
  const text = fs.readFileSync(new URL('../../../../scripts/engine/archon/patch/claude-permission-mode.patch', import.meta.url), 'utf8');
  const files = [...text.matchAll(/^diff --git a\/(\S+)/gm)].map((m) => m[1]);
  assert.deepEqual(files, ['packages/providers/src/claude/provider.ts']);
  assert.match(text, /ARCHON_CLAUDE_PERMISSION_MODE === 'acceptEdits'/);
});

test('the Copilot patch lets a source build run the CLI COPILOT_BIN_PATH names, and names only the Copilot resolver', () => {
  assert.deepEqual(PATCHES, ['claude-permission-mode.patch', 'provider-cli-path.patch', 'paused-run-cancel.patch']);
  const text = fs.readFileSync(new URL('../../../../scripts/engine/archon/patch/provider-cli-path.patch', import.meta.url), 'utf8');
  const files = [...text.matchAll(/^diff --git a\/(\S+)/gm)].map((m) => m[1]);
  assert.deepEqual(files, ['packages/providers/src/community/copilot/binary-resolver.ts']);
  assert.match(text, /^-  if \(!BUNDLED_IS_BINARY\) return undefined;$/m);
  assert.match(text, /^\+  if \(!BUNDLED_IS_BINARY && !process\.env\.COPILOT_BIN_PATH\) return undefined;$/m);
  assert.ok(text.split('\n').some((l) => l.startsWith('+') && l.includes(CLI_PATCH_MARK)), 'the patched resolver carries the mark health and setup look for');
  assert.equal(enginePaths('/e').cliResolver, path.join('/e', 'archon', 'src', 'packages', 'providers', 'src', 'community', 'copilot', 'binary-resolver.ts'));
});

test('the paused-run patch lets cancel take a paused run through the path that keeps its worktree, and changes nothing else', () => {
  const text = fs.readFileSync(new URL('../../../../scripts/engine/archon/patch/paused-run-cancel.patch', import.meta.url), 'utf8');
  assert.deepEqual([...text.matchAll(/^diff --git a\/(\S+)/gm)].map((m) => m[1]), ['packages/core/src/operations/workflow/cancel.ts']);
  assert.ok(text.split('\n').some((l) => l.startsWith('+') && l.includes(CANCEL_PATCH_MARK)), 'the patched file carries the mark health and setup look for');
  assert.match(text, /^\+  if \(run\.status === 'paused'\) return cancelPaused\(ctx, run\);$/m);
  assert.doesNotMatch(text, /^\+.*(releaseRunWorktree|reclaimRunWorktree)/m, 'the worktree is never released');
  assert.doesNotMatch(text, /^-(?!--)/m, 'it only adds');
  assert.equal(enginePaths('/e').cancelOperation, path.join('/e', 'archon', 'src', 'packages', 'core', 'src', 'operations', 'workflow', 'cancel.ts'));
});

test('the build refuses Windows for now', async () => {
  const w = world();
  await assert.rejects(buildFromSource({ engine: w.engine, run: w.run, fetcher: w.fetcher, arch: 'x64', platform: 'win32' }), /Windows/);
});

test("Archon's own settings name Claude as its steps' assistant, keeping any other line", () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'wh-archon-home-'));
  try {
    assert.equal(archonSettingsOk(home), false);
    writeArchonSettings(home);
    assert.equal(fs.readFileSync(archonSettingsFile(home), 'utf8'), 'defaultAssistant: claude\n');
    assert.equal(archonSettingsOk(home), true);
    fs.writeFileSync(archonSettingsFile(home), 'defaultAssistant: codex\nlogLevel: info\n');
    assert.equal(archonSettingsOk(home), false);
    writeArchonSettings(home);
    assert.equal(fs.readFileSync(archonSettingsFile(home), 'utf8'), 'logLevel: info\ndefaultAssistant: claude\n');
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});
