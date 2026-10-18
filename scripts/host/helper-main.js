// scripts/host/helper-main.js
// The real helper: each project's host, repository and connection come from
// its record (~/.wheelhouse/projects/<project>/project.json). Run as a script,
// it starts the helper at the usual address and stays up.
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { helperAddress } from '../lib/paths.js';
import { readProject } from '../lib/projects.js';
import { run } from '../lib/run.js';
import { makeAdapter } from './adapter.js';
import { startHelper, envForConnection } from './helper.js';

function recordOf(project) {
  const record = readProject(project);
  if (!record) throw new Error('The project has not been set up on this computer');
  return record;
}

export function startRealHelper({ address = helperAddress(), fetch = globalThis.fetch, now = () => new Date() } = {}) {
  return startHelper({
    address,
    now,
    adapterFor: (project, { env }) => {
      const record = recordOf(project);
      return makeAdapter({ host: record.host, repo: record.repo, run, env });
    },
    envFor: envForConnection((project) => recordOf(project).connection, { fetch, now }),
  });
}

function startedAsScript() {
  try {
    return fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}
const isScript = Boolean(process.argv[1]) && startedAsScript();
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
