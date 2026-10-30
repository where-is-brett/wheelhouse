// scripts/engine/archon/copilot-cli.js
// The Copilot CLI at its pin, in the engine folder (Archon design, section 13): Archon's Copilot provider is in Archon,
// but the CLI isn't, and Archon finds it by COPILOT_BIN_PATH (env.js). The pin is the CLI's native package for each
// Mac, a tarball holding one program, with the sha512 integrity npm recorded for it. The tarball comes from the npm
// registry only; it is checked against the pin and unpacked in a folder of its own beside the engine's Copilot folder,
// and only then is its one program moved in, the change recorded in setup's journal first. Anything else leaves the
// engine folder as it was, and the refusal says why in plain words. Signing in is the director's own step
// (`copilot login`, with COPILOT_HOME set to the clean home), never this one's.
//   <engine>/copilot/bin/copilot   the program
//   <engine>/copilot/home/         the clean home (scripts/agents/copilot/engine-home.js)
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { engineDir } from '../../lib/paths.js';
import { run as defaultRun } from '../../lib/run.js';
import { COPILOT_VERSION } from '../../lib/copilot-numbers.js';
import { newId } from '../../setup/journal.js';

// Read on 30 October 2026 from the lockfile of the probes' own install of COPILOT_VERSION (checks 74 and 79).
export const COPILOT_CLI_PIN = Object.freeze({
  version: COPILOT_VERSION,
  packages: Object.freeze({
    arm64: Object.freeze({
      url: `https://registry.npmjs.org/@github/copilot-darwin-arm64/-/copilot-darwin-arm64-${COPILOT_VERSION}.tgz`,
      integrity: 'sha512-XEDw2YKw1xQkD1291WcW9t4UYWP1YHAVzV5D9vfzPGa+scCibnFx4EE2QomDsrihyKK3NTqW6BiGmsIHCaXs6A==',
    }),
    x64: Object.freeze({
      url: `https://registry.npmjs.org/@github/copilot-darwin-x64/-/copilot-darwin-x64-${COPILOT_VERSION}.tgz`,
      integrity: 'sha512-9dFk1DB02LUMC19IoWZ26YxIE3GbrhQLitALCPzRy5+ih5IOTDEJLhyl+2w8rDxySIb8/mK3R/B0F1Wp6C4tOA==',
    }),
  }),
});

const REGISTRY = 'registry.npmjs.org';

export function copilotCliPaths(engine = engineDir()) {
  const folder = path.join(engine, 'copilot');
  return { folder, binDir: path.join(folder, 'bin'), bin: path.join(folder, 'bin', 'copilot'), home: path.join(folder, 'home') };
}

// Whether the program is in the engine folder, as a file of its own (never a link).
export function copilotCliInstalled(engine = engineDir()) {
  const stat = fs.lstatSync(copilotCliPaths(engine).bin, { throwIfNoEntry: false });
  return stat !== undefined && stat.isFile();
}

// npm's form of a checksum: sha512-<base64>.
export const integrityOf = (body) => `sha512-${crypto.createHash('sha512').update(body).digest('base64')}`;

const fromRegistry = (url) => {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' && u.hostname === REGISTRY;
  } catch {
    return false;
  }
};

const refused = (why) => ({ ok: false, refused: why });

// installCopilotCli({ engine, platform, arch, fetch, run, record, pin }) -> { ok: true, bin } | { ok: false, refused }
// `record(change)` is setup's journal; `run` unpacks the tarball with the system's tar.
export async function installCopilotCli({
  engine = engineDir(), platform = process.platform, arch = process.arch, fetch = globalThis.fetch, run = defaultRun,
  record = () => {}, pin = COPILOT_CLI_PIN,
} = {}) {
  if (platform !== 'darwin') return refused('The Copilot CLI is installed into the build engine on a Mac only for now');
  const pkg = pin.packages?.[arch];
  if (!pkg) return refused(`No Copilot CLI is pinned for a ${arch} Mac`);
  if (!fromRegistry(pkg.url)) return refused(`${pkg.url} is not on the npm registry, so the Copilot CLI was not installed`);
  let response;
  try {
    response = await fetch(pkg.url, { redirect: 'follow' });
  } catch (error) {
    return refused(`The Copilot CLI download failed: ${error.message}`);
  }
  if (response?.url && !fromRegistry(response.url)) return refused(`${pkg.url} was sent on to ${response.url}, which is not on the npm registry, so the Copilot CLI was not installed`);
  if (!response?.ok) return refused(`The Copilot CLI download failed (${response?.status})`);
  const body = Buffer.from(await response.arrayBuffer());
  const got = integrityOf(body);
  if (got !== pkg.integrity) return refused(`The Copilot CLI download's checksum ${got} is not the pinned ${pkg.integrity}, so it was not installed`);

  const paths = copilotCliPaths(engine);
  fs.mkdirSync(engine, { recursive: true });
  const staging = fs.mkdtempSync(path.join(engine, '.copilot-download-'));
  try {
    const tgz = path.join(staging, 'package.tgz');
    fs.writeFileSync(tgz, body);
    const unpacked = path.join(staging, 'unpacked');
    fs.mkdirSync(unpacked);
    const tar = await run('/usr/bin/tar', ['-xzf', tgz, '-C', unpacked], { timeoutMs: 120000 });
    const program = path.join(unpacked, 'package', 'copilot');
    const stat = fs.lstatSync(program, { throwIfNoEntry: false });
    if (tar.code !== 0 || stat === undefined || !stat.isFile()) return refused('The Copilot CLI download holds no Copilot CLI program, so it was not installed');
    const there = fs.existsSync(paths.bin);
    record({ id: newId('chg'), kind: 'folder', target: paths.binDir, before: there ? {} : null, after: { tool: 'copilot', version: pin.version } });
    fs.mkdirSync(paths.binDir, { recursive: true });
    fs.chmodSync(program, 0o755);
    fs.renameSync(program, paths.bin);
    return { ok: true, bin: paths.bin };
  } finally {
    // The download's own folder: Wheelhouse made it.
    fs.rmSync(staging, { recursive: true, force: true });
  }
}
