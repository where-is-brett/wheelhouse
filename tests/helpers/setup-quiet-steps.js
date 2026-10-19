// tests/helpers/setup-quiet-steps.js
// The real step 2 (tools) and step 6 (changes to this computer), for the engine's routes, on a
// fake computer where every tool is in: `which` finds each, Apple's command-line tools are in,
// and each tool gives its version. Nothing real runs. Each plan reads
// <WHEELHOUSE_HOME>/quiet-world.json, { pluginRoot, config, floor, port }: the plugin's folder
// for step 2's allow rule, and for step 6 the Claude Code folder (CLAUDE_CONFIG_DIR), the
// manifest's floor and the telemetry port. The other steps are the engine tests' own
// (tests/helpers/setup-steps.js).
import fs from 'node:fs';
import path from 'node:path';
import { wheelhouseHome } from '../../scripts/lib/paths.js';
import { toolsStep } from '../../scripts/setup/tools.js';
import { computerStep } from '../../scripts/setup/computer.js';
import { STEPS as TEST_STEPS } from './setup-steps.js';

const world = () => JSON.parse(fs.readFileSync(path.join(wheelhouseHome(), 'quiet-world.json'), 'utf8'));

// The fake computer: every tool on the path, at a version good enough.
export async function quietRun(file, args = []) {
  const name = file.split(/[\\/]/).pop();
  const answer = (stdout, code = 0) => ({ code, stdout, stderr: '' });
  if (name === 'which' || name === 'where') return answer(`/usr/bin/${args[0]}\n`);
  if (name === 'xcode-select' && args[0] === '-p') return answer('/Library/Developer/CommandLineTools\n');
  if (args[0] === '--version') return answer(name === 'node' ? 'v22.3.0\n' : `${name} version 2.40.0\n`);
  return answer('');
}

const tools = () => toolsStep({ run: quietRun, fetch: async () => { throw new Error('no fetch in this test'); }, pluginRoot: world().pluginRoot, env: {} });
const computer = () => {
  const w = world();
  return computerStep({ run: quietRun, env: { CLAUDE_CONFIG_DIR: w.config }, manifest: { claudeCode: { floor: w.floor } }, port: w.port });
};

// A step read afresh from the world on each call.
const fresh = (made, n) => ({
  n,
  title: made().title,
  long: made().long,
  plan: (ctx) => made().plan(ctx),
  apply: (ctx, changes) => made().apply(ctx, changes),
});

export const STEPS = TEST_STEPS.map((s) => (s.n === 2 ? fresh(tools, 2) : s.n === 6 ? fresh(computer, 6) : s));
