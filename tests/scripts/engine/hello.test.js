// tests/scripts/engine/hello.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { helloTrial, engineCheck, nodeOnPath } from '../../../scripts/engine/hello.js';

const scratch = () => fs.mkdtempSync(path.join(os.tmpdir(), 'wh-hello-'));
const okGit = async () => ({ code: 0, stdout: '', stderr: '' });

// A stood-in Archon: `workflow run` gives a run id, `workflow get` gives the guarded step's output.
function archon({ refused = true, runCode = 0 } = {}) {
  const calls = [];
  const cli = async (args, opts = {}) => {
    calls.push({ args, opts });
    if (args[0] === 'workflow' && args[1] === 'run') return { code: runCode, json: runCode === 0 ? { ok: true, runId: 'run-1' } : null, stdout: '', stderr: runCode ? 'failed' : '' };
    if (args[0] === 'workflow' && args[1] === 'get') {
      return { code: 0, json: { events: [{ event_type: 'node_completed', step_name: 'guarded', data: { node_output: JSON.stringify({ refused }) } }] } };
    }
    return { code: 1, json: null };
  };
  return { cli, calls };
}

test("the hello trial's planted .env read is refused", async () => {
  const folder = scratch();
  const a = archon();
  const got = await helloTrial({ cli: a.cli, run: okGit, folder, packDir: '/pack', configFile: '/config.yaml' });
  assert.equal(got, 'refused');
  const run = a.calls.find((c) => c.args[1] === 'run');
  assert.deepEqual(run.args.slice(0, 3), ['workflow', 'run', 'wheelhouse-hello']);
  assert.ok(run.args.includes('--workflow-source') && run.args.includes('/pack'));
  assert.ok(run.args.includes('--config') && run.args.includes('/config.yaml'));
  assert.equal(run.args[run.args.indexOf('--cwd') + 1], folder);
  // The scratch project: a planted .env that is no secret, and Standard's project settings, which deny reading it.
  assert.match(fs.readFileSync(path.join(folder, '.env'), 'utf8'), /planted/);
  const settings = JSON.parse(fs.readFileSync(path.join(folder, '.claude', 'settings.json'), 'utf8'));
  assert.ok(settings.permissions.deny.some((rule) => rule.includes('.env')));
  assert.equal(await helloTrial({ cli: archon({ refused: false }).cli, run: okGit, folder: scratch(), packDir: '/pack', configFile: '/c' }), 'read');
  assert.equal(await helloTrial({ cli: archon({ runCode: 1 }).cli, run: okGit, folder: scratch(), packDir: '/pack', configFile: '/c' }), 'could not run');
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
