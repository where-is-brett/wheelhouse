// scripts/host/helper-main.js
// The real helper: each project's host, repository and connection come from
// its record (~/.wheelhouse/projects/<project>/project.json). Run as a script,
// it starts the helper at the usual address and stays up.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { helperAddress, engineDir } from '../lib/paths.js';
import { readProject } from '../lib/projects.js';
import { run } from '../lib/run.js';
import { adapterOf } from './adapter-for.js';
import { startHelper, envForConnection } from './helper.js';
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

// `onStop` is what the helper does once the last uninstall's answer, saying it stops, has been sent
// (by default it closes and this process exits).
export function startRealHelper({
  address = helperAddress(), fetch = globalThis.fetch, now = () => new Date(),
  onStop = (close) => close().then(() => process.exit(0), () => process.exit(1)),
} = {}) {
  return startHelper({
    address,
    now,
    onStop,
    adapterFor: (project, { env, write }) => adapterOf(recordOf(project), { run, env, write }),
    envFor: envForConnection((project) => recordOf(project).connection, { fetch, now }),
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
