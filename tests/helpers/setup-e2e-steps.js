// tests/helpers/setup-e2e-steps.js
// Setup's ten real steps for the end-to-end tests (tests/e2e/setup.test.js), loaded by a real helper
// as its setup steps module. Each step is made afresh on every call from the world of the computer
// whose Wheelhouse home is in use (WHEELHOUSE_HOME), which the test keeps on
// globalThis[WORLDS] (setup-e2e.js), a Map from that home to { run, hostUrl, config, manifest,
// managedDir, adapterFor, switchOn, protectionStatus, readProtection, checkPins, toolsRun, fetch } (tests/helpers/
// setup-e2e.js, makeComputer). `run` stands in for `gh` and `claude` and passes git to the real git,
// which reaches only bare repositories in temporary folders. Step 2 runs on a fake computer with every
// tool in but gh, which it fetches from a stand-in of gh's release page (`toolsRun`, `fetch`); step 6
// on one where every tool is in (quiet-run.js). Nothing real is installed,
// signed in to, fetched or pushed beyond those folders.
import { engineForProject } from '../../scripts/host/helper-main.js';
import os from 'node:os';
import path from 'node:path';
import { wheelhouseHome, helperAddress } from '../../scripts/lib/paths.js';
import { SETUP_TITLES } from '../../scripts/state/card-lines.js';
import { installStep } from '../../scripts/setup/install-step.js';
import { toolsStep } from '../../scripts/setup/tools.js';
import { hostStep } from '../../scripts/setup/host.js';
import { questionsStep } from '../../scripts/setup/questions.js';
import { rulesStep } from '../../scripts/setup/rules.js';
import { computerStep, lockedStep } from '../../scripts/setup/computer.js';
import { projectFilesStep } from '../../scripts/setup/project-files.js';
import { notifyStep } from '../../scripts/setup/notify.js';
import { healthStep } from '../../scripts/setup/health.js';
import { quietRun } from './quiet-run.js';
import { WORLDS } from './setup-e2e.js';

const world = () => {
  const found = globalThis[WORLDS]?.get(wheelhouseHome());
  if (!found) throw new Error('no end-to-end world for this Wheelhouse home');
  return found;
};
const nothing = async () => { throw new Error('nothing is run here'); };
const noApp = path.join(os.tmpdir(), 'wh-no-such-app.json');
const git = async () => ({ ok: true, path: 'git' });
// The stand-in world's tools and allow rule are a Mac's, and setup fetches gh for macOS and Windows only, so on
// Linux and Windows (CI's runners) step 2 runs as on a Mac; Windows' own step 2 is tried in tools.test.js. Step 3
// does too: the stand-in host serves Quick only, which the one card recommends on a Mac (design section 15.1), and
// a narrow way elsewhere is tried in host.test.js.
const asMac = (step) => (process.platform === 'darwin' ? step : {
  ...step,
  plan: (ctx, ...rest) => step.plan({ ...ctx, platform: 'darwin' }, ...rest),
  apply: (ctx, ...rest) => step.apply({ ...ctx, platform: 'darwin' }, ...rest),
});

const MAKE = {
  1: () => installStep({ env: { CLAUDE_CONFIG_DIR: world().config } }),
  2: () => asMac(toolsStep({ engine: null, run: world().toolsRun, fetch: world().fetch, env: {} })),
  3: () => asMac(hostStep({
    run: world().run, fetch: nothing, appFile: noApp, hostUrl: world().hostUrl, findGit: git, gitlab: nothing,
    open: async () => {}, sleep: async () => {},
  })),
  4: () => questionsStep(),
  5: () => rulesStep({ env: { CLAUDE_CONFIG_DIR: world().config } }),
  6: () => computerStep({ engine: null, run: quietRun, env: { CLAUDE_CONFIG_DIR: world().config }, manifest: { claudeCode: { floor: '2.1.100' } }, port: 14318 }),
  7: () => projectFilesStep({
    run: world().run, findGit: git, gitlab: nothing, claude: () => ({ kind: 'direct', file: 'claude' }),
    manifest: () => world().manifest, claudeHome: () => world().config, switchOn: world().switchOn, protectionStatus: world().protectionStatus,
    address: () => helperAddress(), node: process.execPath,
    // What the front desk's model alias stands for: a stand-in name, never asked of claude.
    best: async () => 'model-top',
  }),
  8: () => lockedStep({ run: nothing, dir: world().managedDir, mdmPlist: path.join(world().managedDir, 'no-such-profile.plist') }),
  9: () => notifyStep(),
  10: () => healthStep({
    run: world().run, adapterFor: world().adapterFor, findGit: git,
    checkPins: world().checkPins, readProtection: world().readProtection,
    // A project on the new engine (a Mac's setup starts it there) gets a stand-in engine that is healthy and refuses
    // the hello trial's read; nothing of Archon's runs here.
    engineChecks: async ({ project, kits }) => (engineForProject({ adapter: () => ({}) })(project)
      ? { engine: 'ok', trial: kits ? 'refused' : 'not run', findings: [] }
      : null),
  }),
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

export const STEPS = Object.keys(SETUP_TITLES).map(Number).sort((a, b) => a - b).map(fresh);
