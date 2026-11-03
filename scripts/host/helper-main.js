// scripts/host/helper-main.js
// The real helper: each project's host, repository and connection come from
// its record (~/.wheelhouse/projects/<project>/project.json). Run as a script,
// it starts the helper at the usual address and stays up.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { helperAddress, engineDir } from '../lib/paths.js';
import { readProject, writeProject } from '../lib/projects.js';
import { run as realRun } from '../lib/run.js';
import { adapterOf } from './adapter-for.js';
import { startHelper, envForConnection } from './helper.js';
import { backendOf } from './connection.js';
import { moveKeysToStore } from './keys.js';
import { borrowKey } from './store.js';
import { startedAsScript } from '../lib/started-as-script.js';
import { archonAdapter, ENGINE_PACK_FORMS } from '../engine/archon/adapter.js';
import { buildPack } from '../engine/pack-build.js';
import { settingsViews } from '../desk/mod-records.js';
import { effectiveSettings } from '../settings/effective.js';
import { engineReady } from '../engine/switch.js';
import { engineWanted } from '../engine/parts.js';

function recordOf(project) {
  const record = readProject(project);
  if (!record) throw new Error('The project has not been set up on this computer');
  return record;
}

// Wheelhouse's run layer for every Archon run (--config).
export const ENGINE_CONFIG = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'engine', 'archon', 'config.yaml');

// The Archon adapter with the pack built from the plugin into <engine>/pack, where --workflow-source reads it. Built
// once, when the first project on Archon asks; a pack that fails its check leaves the adapter refusing to start runs.
export function packedArchon({ engine = engineDir(), build = buildPack, adapter = archonAdapter } = {}) {
  const packDir = path.join(engine, 'pack');
  let built = true;
  try { build({ out: packDir, forms: ENGINE_PACK_FORMS }); } catch { built = false; }
  return adapter({ engine, packDir: built ? packDir : undefined, configFile: ENGINE_CONFIG });
}

// The engine for a project whose `engine` setting in force is Archon and which the engine can build (its fetch-mirror
// rule is in: scripts/engine/switch.js), or null. Every such project shares one Archon adapter: there is one Archon on
// the computer. Off the Mac there is none (scripts/engine/parts.js), so a project on the engine there builds on the old
// engine, and its health has no engine checks it can't clear.
export function engineForProject({ adapter = () => packedArchon(), now = () => new Date(), views = settingsViews, ready = engineReady, platform = process.platform } = {}) {
  let shared = null;
  return (project) => {
    if (!engineWanted({ platform })) return null;
    const { project: own, profile } = views(project);
    if (effectiveSettings({ project: own, profile, now })?.engine?.value !== 'archon' || !ready(project)) return null;
    shared ??= adapter();
    return shared;
  };
}

// Records that a GitHub or GitLab project's tool stopped starting and the helper moved it to the web API by itself
// (scripts/host/adapter-for.js): the record keeps `backend: 'rest'` and `switched: 'cli'`, which the board says in one
// calm line. It holds no secret. Nothing moves it back by itself: the next setup run checks again.
export function recordSwitch(project, { read = readProject, write = writeProject } = {}) {
  const record = read(project);
  if (!record || (record.host !== 'gitlab' && record.host !== 'github')) return false;
  if (backendOf(record.connection) === 'rest' && record.connection.switched === 'cli') return false;
  write(project, { ...record, connection: { ...record.connection, backend: 'rest', switched: 'cli' } });
  return true;
}

// `onStop` is what the helper does once the last uninstall's answer, saying it stops, has been sent
// (by default it closes and this process exits). `run`, `via` (how its GitLab calls are made: run, curl, proxy and
// caFile), `keyDeps` (the computer's store, keys.js's seam) and `borrow` (the lender of the director's own key) are
// for tests; left out, the real ones are used. `moveKeys` moves the old key files into the computer's store once,
// before the first request; it is off until every reader of those files reads the store too (scripts/setup/host.js
// and scripts/setup/uninstall-run.js still read the files).
export function startRealHelper({
  address = helperAddress(), fetch = globalThis.fetch, now = () => new Date(),
  onStop = (close) => close().then(() => process.exit(0), () => process.exit(1)),
  run = realRun, via, keyDeps, borrow = borrowKey, moveKeys = false,
} = {}) {
  const moved = moveKeys ? moveKeysToStore(keyDeps).catch(() => null) : null;
  const envFor = envForConnection((project) => recordOf(project).connection, { fetch, now, keys: keyDeps, borrow });
  return startHelper({
    address,
    now,
    onStop,
    run,
    via,
    keyDeps,
    borrow,
    adapterFor: (project, { env, write }) => adapterOf(recordOf(project), { run, env, write, via, borrow, keys: keyDeps, onSwitch: () => recordSwitch(project) }),
    envFor: moved === null ? envFor : async (project) => { await moved; return envFor(project); },
    engineFor: engineForProject({ now }),
  });
}

const isScript = startedAsScript(import.meta.url);
if (isScript) {
  try {
    const helper = await startRealHelper();
    process.stdout.write(`The Wheelhouse helper is running at ${helper.address}\n`);
    const stop = () => { helper.close().then(() => process.exit(0), () => process.exit(1)); };
    process.on('SIGTERM', stop);
    process.on('SIGINT', stop);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : 'The helper could not be started'}\n`);
    process.exit(1);
  }
}
