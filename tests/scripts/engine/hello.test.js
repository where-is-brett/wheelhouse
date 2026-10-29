// tests/scripts/engine/hello.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { helloTrial, engineCheck, nodeOnPath } from '../../../scripts/engine/hello.js';
import { decide } from '../../../scripts/hooks/tool-guard.js';
import { withHome } from '../../helpers/homes.js';

const scratch = () => fs.mkdtempSync(path.join(os.tmpdir(), 'wh-hello-'));
const gitCalls = new Map();
const okGit = async (command, args, { cwd } = {}) => {
  (gitCalls.get(cwd) ?? gitCalls.set(cwd, []).get(cwd)).push(args);
  return { code: 0, stdout: '', stderr: '' };
};
const okGitCalls = (folder) => gitCalls.get(folder) ?? [];

// A stood-in Archon, as v0.13.0 answers: a project with no git remote can't have a worktree, a run without --detach
// prints its steps and no run id, and `workflow get` shows the run going until it ends, then the guarded step's output, given --events.
const GUARD_WORDS = 'Wheelhouse does not let an agent read a .env file: ask the helper';
function archon({ refused = true, refusal = refused ? GUARD_WORDS : undefined, runCode = 0, polls = 2, end = 'completed' } = {}) {
  const calls = [];
  let gets = 0;
  const cli = async (args, opts = {}) => {
    calls.push({ args, opts });
    if (args[0] === 'workflow' && args[1] === 'run') {
      if (!args.includes('--no-worktree')) return { code: 1, json: { ok: false, error: 'Could not create isolated workspace (Cannot determine git remote)' }, stdout: '', stderr: '' };
      if (!args.includes('--detach')) return { code: 0, json: { refused }, stdout: '', stderr: '' };
      return { code: runCode, json: runCode === 0 ? { ok: true, detached: true, runId: 'run-1' } : null, stdout: '', stderr: runCode ? 'failed' : '' };
    }
    if (args[0] === 'workflow' && args[1] === 'get') {
      gets += 1;
      if (gets <= polls) return { code: 0, json: { status: 'running', events: [] } };
      if (!args.includes('--events')) return { code: 0, json: { status: end } };
      return { code: 0, json: { status: end, events: [{ event_type: 'node_completed', step_name: 'guarded', data: { node_output: JSON.stringify({ refused, ...(refusal == null ? {} : { refusal }) }) } }] } };
    }
    return { code: 1, json: null };
  };
  return { cli, calls };
}
const quick = { pollMs: 1 };

test("the hello trial's planted .env read is refused", async () => {
  const folder = scratch();
  const a = archon();
  const got = await helloTrial({ cli: a.cli, run: okGit, folder, packDir: '/pack', configFile: '/config.yaml', ...quick });
  assert.equal(got, 'refused');
  const run = a.calls.find((c) => c.args[1] === 'run');
  assert.deepEqual(run.args.slice(0, 3), ['workflow', 'run', 'wheelhouse-hello']);
  // The scratch project has no remote, so the trial runs in its own checkout, detached, and is read once it has ended.
  assert.ok(run.args.includes('--detach') && run.args.includes('--no-worktree'));
  assert.equal(a.calls.filter((c) => c.args[1] === 'get').length, 3);
  assert.ok(run.args.includes('--workflow-source') && run.args.includes('/pack'));
  assert.ok(run.args.includes('--config') && run.args.includes('/config.yaml'));
  assert.equal(run.args[run.args.indexOf('--cwd') + 1], folder);
  // The scratch project: a planted .env that is no secret, and Standard's project settings without their own .env
  // rules, so only Wheelhouse's tool guard can refuse the read, and a refusal proves the plugin's hooks loaded.
  assert.match(fs.readFileSync(path.join(folder, '.env'), 'utf8'), /planted/);
  const settings = JSON.parse(fs.readFileSync(path.join(folder, '.claude', 'settings.json'), 'utf8'));
  assert.ok(settings.permissions.deny.length > 0, "Standard's other rules stay");
  assert.doesNotMatch(JSON.stringify(settings), /\*\*\/\.env/);
  // The .env is committed, so a checkout of the trial project holds it.
  assert.ok(okGitCalls(folder).some((args) => args.includes('add') && args.includes('.env')));
  assert.equal(await helloTrial({ cli: archon({ refused: false }).cli, run: okGit, folder: scratch(), packDir: '/pack', configFile: '/c', ...quick }), 'read');
  // A refusal that isn't the tool guard's (Claude Code's own rule, say) doesn't show the hooks loaded.
  assert.equal(await helloTrial({ cli: archon({ refusal: 'Permission to read .env was denied' }).cli, run: okGit, folder: scratch(), packDir: '/pack', configFile: '/c', ...quick }), 'could not run');
  assert.equal(await helloTrial({ cli: archon({ refusal: null }).cli, run: okGit, folder: scratch(), packDir: '/pack', configFile: '/c', ...quick }), 'could not run');
  assert.equal(await helloTrial({ cli: archon({ runCode: 1 }).cli, run: okGit, folder: scratch(), packDir: '/pack', configFile: '/c', ...quick }), 'could not run');
  assert.equal(await helloTrial({ cli: archon({ end: 'failed' }).cli, run: okGit, folder: scratch(), packDir: '/pack', configFile: '/c', ...quick }), 'could not run');
});

test("in the trial's project, Wheelhouse's tool guard itself refuses the .env read", async () => {
  const folder = scratch();
  await helloTrial({ cli: archon().cli, run: okGit, folder, packDir: '/pack', configFile: '/c', ...quick });
  await withHome(async () => {
    const got = await decide({ tool_name: 'Read', cwd: folder, tool_input: { file_path: path.join(folder, '.env') } });
    assert.equal(got?.hookSpecificOutput?.permissionDecision ?? got?.decision, 'deny');
    assert.match(JSON.stringify(got), /Wheelhouse does not let an agent read a \.env file/);
  });
});

test('a hello trial that never ends, or waits on an ask, could not run, and is cancelled so it spends no more', async () => {
  const a = archon({ polls: Infinity });
  assert.equal(await helloTrial({ cli: a.cli, run: okGit, folder: scratch(), packDir: '/pack', configFile: '/c', pollMs: 1, timeout: 20 }), 'could not run');
  assert.deepEqual(a.calls.at(-1).args, ['workflow', 'cancel', 'run-1']);
  assert.ok(a.calls.filter((c) => c.args[1] === 'get').every((c) => c.opts.timeout <= 20));
  const paused = archon({ end: 'paused', polls: 0 });
  assert.equal(await helloTrial({ cli: paused.cli, run: okGit, folder: scratch(), packDir: '/pack', configFile: '/c', ...quick }), 'could not run');
  assert.deepEqual(paused.calls.at(-1).args, ['workflow', 'cancel', 'run-1']);
});

test('step 10 fails closed when telemetry reports on, and the trial is not run', async () => {
  let tried = 0;
  const trial = async () => { tried += 1; return 'refused'; };
  const on = await engineCheck({ health: async () => ({ ok: false, findings: ["Archon's usage reporting is on, or it couldn't say; no run starts until it is off"] }), trial, node: () => true });
  assert.deepEqual(on, { engine: 'findings', trial: 'not run', findings: ["Archon's usage reporting is on, or it couldn't say; no run starts until it is off"] });
  assert.equal(tried, 0);
  const good = await engineCheck({ health: async () => ({ ok: true, findings: [] }), trial, node: () => true });
  assert.deepEqual(good, { engine: 'ok', trial: 'refused', findings: [] });
  // Without Node.js on the engine's PATH, the plugin's hooks can't run in its steps: fail closed.
  const noNode = await engineCheck({ health: async () => ({ ok: true, findings: [] }), trial, node: () => false });
  assert.equal(noNode.engine, 'findings');
  assert.match(noNode.findings[0], /Node\.js/);
  assert.equal(tried, 1);
});

test("nodeOnPath looks for a node in the engine's PATH", () => {
  const dir = scratch();
  fs.writeFileSync(path.join(dir, 'node'), '');
  assert.equal(nodeOnPath({ PATH: ['/nowhere', dir].join(path.delimiter) }), true);
  assert.equal(nodeOnPath({ PATH: '/nowhere' }), false);
});
