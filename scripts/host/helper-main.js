// scripts/host/helper-main.js
// The real helper: each project's host, repository and connection come from
// its record (~/.wheelhouse/projects/<project>/project.json). Run as a script,
// it starts the helper at the usual address and stays up.
import { helperAddress } from '../lib/paths.js';
import { readProject } from '../lib/projects.js';
import { run } from '../lib/run.js';
import { makeAdapter } from './adapter.js';
import { startHelper, envForConnection } from './helper.js';
import { startedAsScript } from '../lib/started-as-script.js';
import { archonAdapter } from '../engine/archon/adapter.js';
import { settingsViews } from '../desk/mod-records.js';
import { effectiveSettings } from '../settings/effective.js';

function recordOf(project) {
  const record = readProject(project);
  if (!record) throw new Error('The project has not been set up on this computer');
  return record;
}

// The engine for a project whose `engine` setting in force is Archon, or null. Every such project shares one Archon
// adapter: there is one Archon on the computer.
export function engineForProject({ adapter = () => archonAdapter(), now = () => new Date(), views = settingsViews } = {}) {
  let shared = null;
  return (project) => {
    const { project: own, profile } = views(project);
    if (effectiveSettings({ project: own, profile, now })?.engine?.value !== 'archon') return null;
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
    adapterFor: (project, { env }) => {
      const record = recordOf(project);
      return makeAdapter({ host: record.host, repo: record.repo, run, env, base: record.connection?.baseUrl });
    },
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
