// tests/helpers/helper-process.js
// A helper in a process of its own, so two computers can each have a home
// (WHEELHOUSE_HOME is per process). Its connection is a key for the stand-in
// host in tests/helpers/http-host.js, given as git's extra header in the
// environment. Set WH_TEST_ADDRESS, WH_TEST_HOST_URL and WH_TEST_TOKEN.
import { startHelper } from '../../scripts/host/helper.js';
import { run as realRun } from '../../scripts/lib/run.js';
import { hostKeyEnv } from './host-key.js';
import { guardedRun } from './stood-in.js';

const adapter = {
  defaultBranch: async () => 'main',
  prState: async () => ({ state: 'closed' }),
  ciState: async () => ({ state: 'pending' }),
  merge: async () => ({ merged: false }),
  openPr: async () => ({ number: 1 }),
  updatePr: async () => ({ number: 1 }),
  issue: { create: async () => ({ number: 1 }), update: async () => ({ number: 1 }), list: async () => [] },
};

// A host tool this process is asked to run is refused (and the process says so on stderr).
const refused = [];
const helper = await startHelper({
  run: guardedRun(realRun, { log: refused }),
  address: process.env.WH_TEST_ADDRESS,
  adapterFor: async () => adapter,
  envFor: async () => ({ mode: 'narrow', env: hostKeyEnv(process.env.WH_TEST_HOST_URL, process.env.WH_TEST_TOKEN) }),
});
process.stdout.write('ready\n');
process.on('SIGTERM', () => {
  if (refused.length > 0) process.stderr.write(`host tools were asked for: ${refused.join('; ')}\n`);
  helper.close().then(() => process.exit(0));
});
