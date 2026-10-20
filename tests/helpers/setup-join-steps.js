// tests/helpers/setup-join-steps.js
// Setup's real steps for a computer joining a project, for the engine's routes in one test process
// (tests/scripts/setup/joining-run.test.js), each made afresh from the test's world, which the test
// puts on globalThis.wheelhouseJoiningWorld before the routes load this module:
//   { run, hostUrl, pluginRoot, config, claudeHome, manifest, managedDir, address }
// `run` stands in for `gh`, `claude` and git (git runs for real against bare remotes in temporary
// folders); step 2 and step 6 run on the fake computer where every tool is in (quiet-run.js).
// Steps 4, 5 and 10, which a joining run never has, are the engine tests' own.
import path from 'node:path';
import os from 'node:os';
import { installStep } from '../../scripts/setup/install-step.js';
import { toolsStep } from '../../scripts/setup/tools.js';
import { hostStep } from '../../scripts/setup/host.js';
import { computerStep, lockedStep } from '../../scripts/setup/computer.js';
import { projectFilesStep } from '../../scripts/setup/project-files.js';
import { notifyStep } from '../../scripts/setup/notify.js';
import { quietRun } from './quiet-run.js';
import { STEPS as TEST_STEPS } from './setup-steps.js';

const world = () => globalThis.wheelhouseJoiningWorld;
const nothing = async () => { throw new Error('nothing is run here'); };
const noApp = path.join(os.tmpdir(), 'wh-no-such-app.json');

const MAKE = {
  1: () => installStep({ env: { CLAUDE_CONFIG_DIR: world().config } }),
  2: () => toolsStep({ run: quietRun, fetch: nothing, pluginRoot: world().pluginRoot, env: {} }),
  3: () => hostStep({
    run: world().run, appFile: noApp, hostUrl: world().hostUrl, findGit: async () => ({ ok: true, path: 'git' }), gitlab: nothing,
    open: async () => {}, sleep: async () => {},
  }),
  6: () => computerStep({ run: quietRun, env: { CLAUDE_CONFIG_DIR: world().config }, manifest: { claudeCode: { floor: '2.1.100' } }, port: 14318 }),
  7: () => projectFilesStep({
    run: world().run, findGit: async () => ({ ok: true, path: 'git' }), claude: () => ({ kind: 'direct', file: 'claude' }),
    manifest: () => world().manifest, claudeHome: () => world().claudeHome, switchOn: nothing, protectionStatus: nothing,
    address: () => world().address, node: '/usr/local/bin/node', pluginRoot: world().pluginRoot,
  }),
  8: () => lockedStep({ run: nothing, dir: world().managedDir, mdmPlist: '/nowhere/com.anthropic.claudecode.plist' }),
  9: () => notifyStep(),
};

// A step made afresh from the world on each call, with its number, title, `long`, `after` and
// `asksDuring` as the real step has them.
const fresh = (n) => {
  const made = MAKE[n]();
  return {
    n,
    title: made.title,
    ...(made.long ? { long: true } : {}),
    ...(made.after ? { after: made.after } : {}),
    ...(made.asksDuring ? { asksDuring: made.asksDuring } : {}),
    plan: (ctx) => MAKE[n]().plan(ctx),
    apply: (ctx, changes) => MAKE[n]().apply(ctx, changes),
  };
};

export const STEPS = TEST_STEPS.map((s) => (MAKE[s.n] ? fresh(s.n) : s));
