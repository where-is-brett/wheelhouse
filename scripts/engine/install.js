// scripts/engine/install.js
// Installs the build engine at its pins (Archon design, section 14.1): Archon built from source with Wheelhouse's
// patches, and the pinned Bun, into Wheelhouse's engine folder. Nothing comes from Homebrew or Archon's installer, and
// nothing is written outside the engine folder, so no admin step is needed. The build happens in a folder of its own
// beside the engine folder; only once every download came from an official release and the build holds the pinned
// digests are its `bun` and `archon` folders moved in, each change recorded in setup's journal first. Anything else
// leaves the engine folder as it was, and the refusal says why in plain words.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { engineDir } from '../lib/paths.js';
import { newId } from '../setup/journal.js';
import { buildFromSource, enginePaths, launcherText } from './archon/build.js';
import { ENGINE_PINS } from './pins.js';

// The hosts an engine download may come from: GitHub, and the hosts GitHub serves release files from.
export const OFFICIAL_HOSTS = Object.freeze(['github.com', 'objects.githubusercontent.com', 'release-assets.githubusercontent.com']);

const official = (url) => {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' && OFFICIAL_HOSTS.includes(u.hostname);
  } catch {
    return false;
  }
};

class Refusal extends Error {}

// A fetch that refuses an address off the official hosts, before asking and after any redirect.
function officialFetch(fetch) {
  return async (url, init) => {
    if (!official(url)) throw new Refusal(`${url} is not from an official release, so the engine was not installed`);
    const response = await fetch(url, init);
    if (response?.url && !official(response.url)) throw new Refusal(`${url} was sent on to ${response.url}, which is not from an official release, so the engine was not installed`);
    return response;
  };
}

const digest = (file) => {
  try {
    return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
  } catch {
    return null;
  }
};

// installEngine({ platform, arch, fetch, run, record, folder, pins, build }) -> { ok: true, archonBin, bunBin } | { ok: false, refused }
// `record(change)` is setup's journal. `build` is buildFromSource; tests stand in for it.
export async function installEngine({
  platform = process.platform, arch = process.arch, fetch = globalThis.fetch, run, record = () => {},
  folder = engineDir(), pins = ENGINE_PINS, build = buildFromSource,
} = {}) {
  if (platform !== 'darwin') return { ok: false, refused: 'The build engine is installed on a Mac only for now' };
  fs.mkdirSync(path.dirname(folder), { recursive: true });
  const staging = fs.mkdtempSync(path.join(path.dirname(folder), `.${path.basename(folder)}-new-`));
  try {
    try {
      await build({ engine: staging, run, fetcher: officialFetch(fetch), arch, platform, bun: pins.bun });
    } catch (error) {
      return { ok: false, refused: error instanceof Refusal ? error.message : `The engine was not installed: ${error.message}` };
    }
    const built = enginePaths(staging);
    const got = { provider: digest(built.provider), lockfile: digest(path.join(built.src, 'bun.lock')), cliResolver: digest(built.cliResolver) };
    for (const [part, want] of Object.entries(pins.archon.built)) {
      if (got[part] !== want) return { ok: false, refused: `The engine built from Archon ${pins.archon.tag} isn't the pinned build (its ${part} is ${got[part] ?? 'missing'}, not ${want}), so it was not installed` };
    }
    const versions = { bun: pins.bun.version, archon: pins.archon.tag };
    const earlier = path.join(staging, 'earlier');
    fs.mkdirSync(folder, { recursive: true });
    for (const part of ['bun', 'archon']) {
      const target = path.join(folder, part);
      const there = fs.existsSync(target);
      record({ id: newId('chg'), kind: 'folder', target, before: there ? {} : null, after: { tool: part, version: versions[part] } });
      if (there) {
        fs.mkdirSync(earlier, { recursive: true });
        fs.renameSync(target, path.join(earlier, part));
      }
      fs.renameSync(path.join(staging, part), target);
    }
    // The launcher names its own paths, so it is written again for the folder it now lives in.
    const p = enginePaths(folder);
    fs.writeFileSync(p.launcher, launcherText(folder));
    fs.chmodSync(p.launcher, 0o755);
    return { ok: true, archonBin: p.launcher, bunBin: p.bunBin };
  } finally {
    // The build's own folder, with any earlier engine moved aside: Wheelhouse made both.
    fs.rmSync(staging, { recursive: true, force: true });
  }
}
