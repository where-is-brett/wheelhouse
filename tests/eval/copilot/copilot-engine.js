// tests/eval/copilot/copilot-engine.js
// What the four Copilot scenarios (38 to 41) share, now that a Copilot project's work runs through the build engine
// (Archon design, section 13): a world of the engine's own (scripts/eval/engine-world.js) whose project runs on
// Copilot on this computer, the pack built with its Copilot twins, and the clean home written as setup writes it. No
// Copilot runs: the engine is the fake one, and the guard is run as the CLI would run it, from the clean home's own
// registration. Not a scenario: its name has no number.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { computerId } from '../../../scripts/lib/paths.js';
import { confirmationFor } from '../../../scripts/state/events.js';
import { run } from '../../../scripts/lib/run.js';
import { buildPack, PACK_NAME } from '../../../scripts/engine/pack-build.js';
import { ENGINE_PACK_FORMS, LANE_WORKFLOWS, workflowFor } from '../../../scripts/engine/archon/adapter.js';
import { COPILOT_SUFFIX } from '../../../scripts/engine/archon/copilot-pack.js';
import { writeEngineHome } from '../../../scripts/agents/copilot/engine-home.js';
import { file as hookFile } from '../../../adapters/copilot/hooks.js';
import { registerLean, updateLean } from '../../../scripts/lean/project.js';
import { WORKTREE_PATH } from '../../../scripts/engine/parts.js';
import { COPILOT_VERSION } from '../../../scripts/lib/copilot-numbers.js';

export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
// The requests a month the director allowed in these scenarios' project.
export const ALLOWANCE = 40;

// The world's seed for a project on Copilot: its configuration names Copilot for this computer, and the director has
// allowed some of the plan's requests, a setting they confirmed.
export function onCopilot(world) {
  fs.mkdirSync(path.join(world.folder, '.claude'), { recursive: true });
  fs.writeFileSync(path.join(world.folder, '.claude', 'wheelhouse.json'), `${JSON.stringify({ v: 1, criticalAreas: [], ciFiles: [], mcpServers: [], webDomains: [], agents: { [computerId()]: 'copilot' }, testCommand: 'node --test' }, null, 2)}\n`);
  const setting = world.put('setting', { key: 'capRequests', value: ALLOWANCE });
  world.put('confirmation', confirmationFor(setting).data);
}

// The fake engine as the Archon adapter is for a Copilot run: it counts requests (and the count is taken as checked
// against GitHub's, which check 79 will settle), and each start is told which workflow Archon would run, the lane's
// own or its Copilot twin (workflowFor).
export function asArchonOnCopilot(engine) {
  const start = engine.start.bind(engine);
  engine.workflows = [];
  engine.countsRequests = (routing = {}) => [...Object.values(routing.tiers ?? {}), ...Object.values(routing.aliases ?? {})].some((m) => String(m).startsWith('copilot/'));
  engine.requestsConfirmed = true;
  engine.start = async (order = {}) => {
    const chosen = workflowFor(LANE_WORKFLOWS[order.lane], order.bindings);
    engine.workflows.push(chosen.workflow ?? null);
    if (chosen.refused) return { ok: false, refused: chosen.refused };
    return start(order);
  };
  return engine;
}

// The pack built with its twins into a folder of its own: { dir, workflow(name) }, read as Archon reads them.
export function builtPack() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wh-cp-pack-'));
  const { workflows } = buildPack({ out: dir, forms: ENGINE_PACK_FORMS });
  const workflow = (name) => JSON.parse(fs.readFileSync(path.join(dir, '.archon', 'workflows', PACK_NAME, name, `${name}.yaml`), 'utf8'));
  return { dir, workflows, twins: workflows.filter((w) => w.endsWith(COPILOT_SUFFIX)), workflow, close: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

// A Lean project on Copilot with a run's worktree inside it, as Archon places one, and the clean home written as
// setup writes it, signed in from a stand-in sign-in. `guard(toolName, toolArgs)` runs the registered `preToolUse`
// command in the worktree as the CLI would, and resolves with { code, answer }.
export function cleanHomeWorld() {
  const root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'wh-cp-')));
  const wh = path.join(root, 'wh');
  const folder = path.join(root, 'shop');
  fs.mkdirSync(path.join(folder, '.git'), { recursive: true });
  const before = process.env.WHEELHOUSE_HOME;
  process.env.WHEELHOUSE_HOME = wh;
  try {
    registerLean({ project: 'shop', folder });
    updateLean('shop', { agent: 'copilot' });
  } finally {
    if (before === undefined) delete process.env.WHEELHOUSE_HOME;
    else process.env.WHEELHOUSE_HOME = before;
  }
  const worktree = path.join(folder, ...WORKTREE_PATH.split('/'), 'run-1');
  fs.mkdirSync(worktree, { recursive: true });
  const signedIn = path.join(root, 'signed-in');
  fs.mkdirSync(signedIn);
  fs.writeFileSync(path.join(signedIn, 'config.json'), JSON.stringify({ loggedInUsers: [{ host: 'https://github.com', login: 'director' }] }));
  const home = writeEngineHome({ engine: path.join(root, 'engine'), signedInFrom: signedIn, root: REPO_ROOT });
  const registration = JSON.parse(fs.readFileSync(hookFile({ home }), 'utf8'));
  async function guard(toolName, toolArgs) {
    const entry = registration.hooks.preToolUse[0];
    const got = await run('/bin/sh', ['-c', entry.bash], {
      cwd: worktree,
      baseEnv: {},
      env: { PATH: '/usr/bin:/bin', HOME: os.homedir(), WHEELHOUSE_HOME: wh, COPILOT_HOME: home, COPILOT_CLI_BINARY_VERSION: COPILOT_VERSION },
      input: JSON.stringify({ sessionId: 'run-1', timestamp: Date.now(), cwd: worktree, toolName, toolArgs }),
      timeoutMs: 30000,
    });
    let answer = null;
    try { answer = JSON.parse(got.stdout); } catch { /* none */ }
    return { code: got.code, answer };
  }
  return { root, home, worktree, registration, guard, close: () => fs.rmSync(root, { recursive: true, force: true }) };
}
