// scripts/engine/archon/build.js
// Builds Archon from source at the pinned tag, with Wheelhouse's patch (spec 12.1, check 75): Archon starts
// Claude in bypass mode, where Claude Code applies no sandbox, so until the patch lands upstream Wheelhouse runs
// a source checkout whose Claude steps start in acceptEdits mode. A source checkout runs its maintained
// providers from source, so the patched provider is what runs. The pinned Bun is downloaded and checked
// against its checksum; nothing comes from Homebrew. Layout under the engine folder:
//   bun/bin/bun            the pinned Bun
//   archon/src/            the source at the pinned commit, patched, its dependencies installed by the lockfile
//   archon/bin/archon      a launcher: the pinned Bun running the source's command line
//   archon/bunfig.toml     an empty Bun config the launcher names, so Bun never reads a bunfig.toml (and its preload)
//                          from the folder Archon starts in
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { run as defaultRun } from '../../lib/run.js';

export const ARCHON_SOURCE = Object.freeze({
  repo: 'https://github.com/coleam00/Archon.git',
  tag: 'v0.13.0',
  commit: '0d39c1f2d177f804366500a9cda837abed7d103d',
});

// The newest Bun release at least two weeks old on 29 October 2026, with checksums pinned from its own list.
export const BUN_PIN = Object.freeze({
  version: '1.4.3',
  sums: Object.freeze({
    'bun-darwin-aarch64.zip': '80afd4c069b46a6fa8f3ec520bebc750a7843e4a8d5b9583d29ad436c00a3403',
    'bun-darwin-x64.zip': '62660e6438eb872278877acca77e1152d5d031324df368d4a81b428211489d2d',
  }),
});

// The patches applied to the source, in order, from patch/ beside this file.
export const PATCHES = Object.freeze(['claude-permission-mode.patch', 'copilot-bin-path.patch']);
const PATCH_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'patch');

// The value of ARCHON_CLAUDE_PERMISSION_MODE that the patch reads.
export const PERMISSION_MODE = 'acceptEdits';
// What the patched provider holds and the unpatched one doesn't; health looks for it.
export const PATCH_MARK = 'ARCHON_CLAUDE_PERMISSION_MODE';
// What the Copilot patch's resolver holds (copilot-bin-path.patch): a source build then runs the CLI COPILOT_BIN_PATH
// names, the one the engine pins, rather than the SDK's own runtime.
export const COPILOT_PATCH_MARK = 'Wheelhouse: a source build honours COPILOT_BIN_PATH';

const TELEMETRY = { ARCHON_TELEMETRY_DISABLED: '1', DO_NOT_TRACK: '1', POSTHOG_API_KEY: 'off' };
const SYSTEM_PATH = ['/usr/bin', '/bin', '/usr/sbin', '/sbin'];

// Archon's own settings, in its home: Claude runs its steps. Without this line `archon ai tier list` names no assistant,
// and the adapter's health check refuses the engine. Setup writes it (scripts/setup/engine-parts.js), and so does the
// evaluation's world of its own (scripts/eval/archon-world.js); any other line there is kept.
export const ASSISTANT_LINE = 'defaultAssistant: claude';
export const archonSettingsFile = (home) => path.join(home, 'config.yaml');
const readOr = (file) => {
  try { return fs.readFileSync(file, 'utf8'); } catch { return null; }
};
export const archonSettingsOk = (home) => /^defaultAssistant:\s*claude\s*$/m.test(readOr(archonSettingsFile(home)) ?? '');
export function writeArchonSettings(home) {
  const kept = (readOr(archonSettingsFile(home)) ?? '').split('\n').filter((l) => l.trim() !== '' && !/^defaultAssistant:/.test(l));
  fs.mkdirSync(home, { recursive: true });
  fs.writeFileSync(archonSettingsFile(home), `${[...kept, ASSISTANT_LINE].join('\n')}\n`);
}

export function enginePaths(engine) {
  const bunDir = path.join(engine, 'bun', 'bin');
  return {
    bunDir,
    bunBin: path.join(bunDir, 'bun'),
    src: path.join(engine, 'archon', 'src'),
    launcher: path.join(engine, 'archon', 'bin', 'archon'),
    bunfig: path.join(engine, 'archon', 'bunfig.toml'),
    provider: path.join(engine, 'archon', 'src', 'packages', 'providers', 'src', 'claude', 'provider.ts'),
    copilotResolver: path.join(engine, 'archon', 'src', 'packages', 'providers', 'src', 'community', 'copilot', 'binary-resolver.ts'),
  };
}

// The launcher the build writes: the pinned Bun, with the engine's own empty bunfig, running the source's command line.
export function launcherText(engine) {
  const p = enginePaths(engine);
  const cli = path.join(p.src, 'packages', 'cli', 'src', 'cli.ts');
  return `#!/bin/sh\n# Archon from source, patched by Wheelhouse (scripts/engine/archon/build.js).\nexec '${p.bunBin}' --config='${p.bunfig}' --no-env-file '${cli}' "$@"\n`;
}

function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

async function must(promise, what) {
  const result = await promise;
  if (result.code !== 0) throw new Error(`${what} failed: ${String(result.stderr || result.stdout).trim().slice(0, 500)}`);
  return result;
}

// Downloads the pinned Bun into bun/bin, refusing a download whose checksum isn't the pinned one.
async function installBun({ engine, run, fetcher, arch, bun }) {
  const p = enginePaths(engine);
  const name = `bun-darwin-${arch === 'arm64' ? 'aarch64' : 'x64'}.zip`;
  const pinned = bun.sums[name];
  if (!pinned) throw new Error(`No pinned checksum for ${name}`);
  const url = `https://github.com/oven-sh/bun/releases/download/bun-v${bun.version}/${name}`;
  const response = await fetcher(url, { redirect: 'follow' });
  if (!response.ok) throw new Error(`The Bun download failed (${response.status})`);
  const body = Buffer.from(await response.arrayBuffer());
  const got = sha256(body);
  if (got !== pinned) throw new Error(`${name}: checksum ${got} is not the pinned ${pinned}`);
  const dl = path.join(engine, 'dl');
  fs.mkdirSync(dl, { recursive: true });
  const zip = path.join(dl, name);
  fs.writeFileSync(zip, body);
  await must(run('/usr/bin/unzip', ['-q', '-o', zip, '-d', dl]), 'Unpacking Bun');
  fs.mkdirSync(p.bunDir, { recursive: true });
  fs.renameSync(path.join(dl, name.replace(/\.zip$/, ''), 'bun'), p.bunBin);
  fs.chmodSync(p.bunBin, 0o755);
}

// Builds the engine under `engine`. Returns the launcher's path, which archonCli runs.
export async function buildFromSource({ engine, run = defaultRun, fetcher = fetch, arch = process.arch, platform = process.platform, bun = BUN_PIN, git = '/usr/bin/git' } = {}) {
  if (platform === 'win32') throw new Error('Building Archon from source on Windows is not supported yet');
  if (!engine) throw new Error('buildFromSource needs the engine folder');
  // The launcher quotes its paths in single quotes, so a folder name holding one is refused.
  if (engine.includes("'")) throw new Error('The engine folder\'s path may not hold a single quote');
  const p = enginePaths(engine);
  if (fs.existsSync(p.src)) throw new Error(`${p.src} is already there: move it to the Trash before building again`);
  await installBun({ engine, run, fetcher, arch, bun });

  fs.mkdirSync(path.dirname(p.src), { recursive: true });
  await must(run(git, ['clone', '--quiet', '--depth', '1', '--branch', ARCHON_SOURCE.tag, ARCHON_SOURCE.repo, p.src]), 'Fetching the Archon source');
  const head = (await must(run(git, ['-C', p.src, 'rev-parse', 'HEAD']), 'Reading the source commit')).stdout.trim();
  if (head !== ARCHON_SOURCE.commit) throw new Error(`The source at ${ARCHON_SOURCE.tag} is at commit ${head}, not the pinned ${ARCHON_SOURCE.commit}`);
  for (const patch of PATCHES) await must(run(git, ['-C', p.src, 'apply', path.join(PATCH_DIR, patch)]), `Applying ${patch}`);

  const env = { HOME: process.env.HOME, PATH: [p.bunDir, ...SYSTEM_PATH].join(path.delimiter), ...TELEMETRY };
  const install = ['install', '--frozen-lockfile', '--ignore-scripts'];
  await must(run(p.bunBin, install, { cwd: p.src, env, baseEnv: {}, timeoutMs: 900000 }), 'Installing Archon\'s dependencies');

  fs.mkdirSync(path.dirname(p.launcher), { recursive: true });
  fs.writeFileSync(p.bunfig, '# Empty: Bun reads this in place of a bunfig.toml in the folder Archon starts in.\n');
  fs.writeFileSync(p.launcher, launcherText(engine));
  fs.chmodSync(p.launcher, 0o755);
  return { archonBin: p.launcher, bunBin: p.bunBin, src: p.src };
}
