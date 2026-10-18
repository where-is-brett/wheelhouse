// tests/helpers/helper-process.js
// A helper in a process of its own, so two computers can each have a home
// (WHEELHOUSE_HOME is per process). Its connection is a key for the stand-in
// host in tests/helpers/http-host.js, given as git's extra header in the
// environment. Set WH_TEST_ADDRESS, WH_TEST_HOST_URL and WH_TEST_TOKEN.
import { startHelper } from '../../scripts/host/helper.js';
import { hostKeyEnv } from './host-key.js';

const adapter = {
  defaultBranch: async () => 'main',
  prState: async () => ({ state: 'closed' }),
  ciState: async () => ({ state: 'pending' }),
  merge: async () => ({ merged: false }),
  openPr: async () => ({ number: 1 }),
  updatePr: async () => ({ number: 1 }),
  issue: { create: async () => ({ number: 1 }), update: async () => ({ number: 1 }), list: async () => [] },
};

const helper = await startHelper({
  address: process.env.WH_TEST_ADDRESS,
  adapterFor: async () => adapter,
  envFor: async () => ({ mode: 'narrow', env: hostKeyEnv(process.env.WH_TEST_HOST_URL, process.env.WH_TEST_TOKEN) }),
});
process.stdout.write('ready\n');
process.on('SIGTERM', () => { helper.close().then(() => process.exit(0)); });
