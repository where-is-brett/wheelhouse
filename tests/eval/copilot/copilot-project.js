// tests/eval/copilot/copilot-project.js
// What the four Copilot scenarios (38 to 41, spec section 9 of docs/specs/2026-10-20-other-agents-design.md) share:
// setting a scratch project up for one session through `copilot -p` (adapters/copilot/eval-runner.js), and reading
// Copilot's own events, which the runner keeps as `raw`. Not a scenario: its name has no number.
//
// The set-up: the project's files committed on `main`, and a feature branch when the scenario has one; a scratch
// Wheelhouse home in the temporary folder, never the real ~/.wheelhouse, where the project is registered (the guards
// act only in a registered project) and a stand-in helper (scripts/eval/stand-in-helper.js) answers on the helper's
// address with the scenario's state; and the session's own Copilot home, written by writeSessionHome (through
// writeEvalHome): Wheelhouse's hook registration, the kit's agents, and the sign-in keys alone, from the evaluation's
// sign-in source (signInSource), never the person's ~/.copilot itself.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startStandInHelper } from '../../../scripts/eval/stand-in-helper.js';
import { registerEvalProject } from '../../../scripts/eval/standard-project.js';
import { helperAddress } from '../../../scripts/lib/paths.js';
import { assertUnderTmp } from '../../../probes/lib/scratch.js';
import { writeEvalHome } from '../../../adapters/copilot/eval-runner.js';

// The repository, whose commands a scenario's session may be given (`commands`).
export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

// The scratch project's files: a small bakery's orders page.
export const PROJECT_FILES = Object.freeze({
  'README.md': '# The bakery\n\nOrders for the pick-up counter.\n',
  'package.json': `${JSON.stringify({ name: 'bakery-orders', version: '1.0.0', private: true, type: 'module' }, null, 2)}\n`,
  'src/orders.js': 'export const total = (orders) => orders.reduce((sum, order) => sum + order.cents, 0);\n',
});

function git(dir, ...args) {
  return execFileSync('git', ['-c', 'user.name=Wheelhouse eval', '-c', 'user.email=eval@wheelhouse.invalid', ...args], {
    cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

function write(root, relative, content) {
  const file = path.join(root, relative);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content, 'utf8');
}

// Sets the scratch project `dir` up (see the head of this file). Options:
//   files         more of the project's files, { relative: text }, committed on main with PROJECT_FILES
//   branch        null, or { name, files }: a feature branch `feature/<name>` from main, its files committed there
//   seed          the events the state holds when the run starts, or a function making them from { head }
//   pullRequests  { number: 'head' }: pull requests open when the run starts, at the feature branch's head
//   signed        [{ kind, data }], or a function making them from { head }: records the stand-in signs as it starts
//   reviewKinds   the kinds of review the stand-in's merge gate counts (startStandInHelper)
// Resolves with the context runScenario takes: { env, helper, home, root, sessionHome, head, seededIds, evidence,
// close, unreadable }. `env` names the scratch Wheelhouse home and the session's Copilot home.
export async function setUpCopilotProject(dir, { files = {}, branch = null, seed = [], pullRequests = {}, signed = [], reviewKinds } = {}) {
  assertUnderTmp(dir);
  // By its real path, so the project's record and the session's folder are spelt alike (the temporary folder is a
  // link on macOS).
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'wh-cpe-')));
  assertUnderTmp(root);
  const home = path.join(root, 'home');
  fs.mkdirSync(home, { recursive: true });
  let helper = null;
  const close = async () => {
    try {
      await helper?.close();
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  };
  try {
    git(dir, 'branch', '-M', 'main');
    for (const [relative, content] of Object.entries({ ...PROJECT_FILES, ...files })) write(dir, relative, content);
    git(dir, 'add', '--all');
    git(dir, 'commit', '--quiet', '-m', 'The project so far');
    let head = null;
    if (branch) {
      git(dir, 'checkout', '--quiet', '-b', `feature/${branch.name}`);
      for (const [relative, content] of Object.entries(branch.files ?? {})) write(dir, relative, content);
      git(dir, 'add', '--all');
      git(dir, 'commit', '--quiet', '-m', 'Build task 1');
      head = git(dir, 'rev-parse', 'HEAD');
      git(dir, 'checkout', '--quiet', 'main');
    }
    const events = typeof seed === 'function' ? seed({ head }) : seed;
    const signs = typeof signed === 'function' ? signed({ head }) : signed;
    registerEvalProject(dir, home);
    const address = process.platform === 'win32' ? helperAddress() : path.join(home, 'helper.sock');
    const prs = Object.fromEntries(Object.entries(pullRequests).map(([number, sha]) => [number, sha === 'head' ? head : sha]));
    helper = await startStandInHelper({ address, home, state: { events, pullRequests: prs, signed: signs }, ...(reviewKinds === undefined ? {} : { reviewKinds }) });
    const sessionHome = writeEvalHome(home);
    const seededIds = new Set([...events.map((e) => e.id), ...helper.events().map((e) => e.id)]);
    const evidence = () => ({ helper: helper.records(), written: helper.events().filter((e) => !seededIds.has(e.id)) });
    return {
      env: { WHEELHOUSE_HOME: home, COPILOT_HOME: sessionHome },
      helper, home, root, sessionHome, head, seededIds, evidence, close, unreadable: [helper.keyFolder],
    };
  } catch (error) {
    await close();
    throw error;
  }
}

// The events the session wrote to the state: everything the stand-in holds that the run did not start with.
export function writtenEvents(context) {
  const seeded = context?.seededIds ?? new Set();
  return (context?.helper?.events() ?? []).filter((e) => !seeded.has(e.id));
}

// Each tool call in Copilot's events, in order, with how it ended: { tool, args, success, error } (success null when
// it never ended). A start is paired with the first unended start of the same call id, so ids used twice still pair.
export function toolRuns(raw) {
  const runs = [];
  const open = [];
  for (const event of Array.isArray(raw) ? raw : []) {
    const data = event?.data ?? {};
    if (event?.type === 'tool.execution_start') {
      const run = { id: data.toolCallId ?? null, tool: typeof data.toolName === 'string' ? data.toolName : null, args: data.arguments, success: null, error: null };
      runs.push(run);
      open.push(run);
    } else if (event?.type === 'tool.execution_complete') {
      const at = open.findIndex((run) => run.id === (data.toolCallId ?? null));
      if (at < 0) continue;
      const [run] = open.splice(at, 1);
      run.success = data.success === true;
      run.error = data.success === true ? null : { code: data.error?.code ?? null, message: typeof data.error?.message === 'string' ? data.error.message : '' };
    }
  }
  return runs;
}
