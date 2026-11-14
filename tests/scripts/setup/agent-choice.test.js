// tests/scripts/setup/agent-choice.test.js
// Step 6's agent choice for a computer, the hook file it makes, the sign-in wait, the account reading, uninstall's way back,
// and step 7's entry in the project's `agents` map (design section 8, part 11). Every home is a scratch one, no Copilot
// program is started, and the account is a stand-in `run`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { computerStep } from '../../../scripts/setup/computer.js';
import { configFrom, starterConfig } from '../../../scripts/setup/project-files.js';
import { newId, reverseChange } from '../../../scripts/setup/journal.js';
import { agentChosen, agentEntries, otherAgentsFound, refreshAgentComputer, AGENT_ANSWER } from '../../../scripts/agents/setup-parts.js';
import { planOf, signedIn } from '../../../scripts/agents/copilot/setup.js';
import hooks from '../../../adapters/copilot/hooks.js';
import { readAccount as readUsageAccount } from '../../../scripts/agents/copilot/usage.js';
import { computerId } from '../../../scripts/lib/paths.js';
import { readConfig } from '../../../scripts/gate/guardrails.js';
import { withProject, T0 } from '../../helpers/setup-answers.js';
import { tempFolder } from '../../helpers/homes.js';

const MANIFEST = { claudeCode: { floor: '2.1.100' } };
const COPILOT = { label: 'Copilot', text: null, at: T0.toISOString() };
const CLAUDE = { label: 'Claude Code', text: null, at: T0.toISOString() };

// A PATH folder holding a stand-in `copilot` file (never run), and a Copilot home, for the step's environment.
function copilotEnv(config, { signedIn = true, installed = true } = {}) {
  const bin = tempFolder('wh-bin-');
  if (installed) fs.writeFileSync(path.join(bin, 'copilot'), '#!/bin/sh\n');
  const home = tempFolder('wh-copilot-');
  if (signedIn) fs.writeFileSync(path.join(home, 'config.json'), '// Copilot CLI\n{"loggedInUsers":[{"host":"github.com","login":"someone"}]}\n');
  return { env: { CLAUDE_CONFIG_DIR: config, PATH: bin, COPILOT_HOME: home }, home };
}

const ACCOUNT = JSON.stringify({
  access_type_sku: 'free_educational_quota',
  copilot_plan: 'individual',
  quota_reset_date: '2026-12-01',
  quota_snapshots: { premium_interactions: { entitlement: 200, remaining: 148, overage_permitted: false } },
});

// A `run` that answers the account call and records every call.
function accountRun(stdout = ACCOUNT, code = 0) {
  const calls = [];
  return { calls, run: async (file, args) => { calls.push([file, ...args]); return { code, stdout, stderr: '' }; } };
}

const stepFor = (env, run) => computerStep({ engine: null, run, env, manifest: MANIFEST, port: 14318 });
const ctxFor = (folder, user, answers = {}) => ({ folder, step: 6, now: () => T0, userHome: user, platform: 'darwin', answers });

test('a computer with no other agent installed asks nothing', async () => {
  await withProject(async ({ folder, user, config }) => {
    const { env } = copilotEnv(config, { installed: false });
    const planned = await stepFor(env, accountRun().run).plan(ctxFor(folder, user));
    assert.equal(planned.ask, undefined);
    assert.deepEqual(otherAgentsFound({ platform: 'darwin', env }), []);
  });
});

test('where Copilot is installed the step asks once, Claude Code first and recommended', async () => {
  await withProject(async ({ folder, user, config }) => {
    const { env } = copilotEnv(config);
    const planned = await stepFor(env, accountRun().run).plan(ctxFor(folder, user));
    assert.equal(planned.ask.id, 'agent');
    assert.deepEqual(planned.ask.card.options.map((o) => o.label), ['Claude Code', 'Copilot']);
    assert.equal(planned.ask.card.recommend, 'Claude Code');
    assert.equal(planned.ask.card.level, 3);
    assert.equal(AGENT_ANSWER, '6.agent');
  });
});

test('a Claude Code answer makes no change for an agent', async () => {
  await withProject(async ({ folder, user, config }) => {
    const { env, home } = copilotEnv(config);
    const planned = await stepFor(env, accountRun().run).plan(ctxFor(folder, user, { '6.agent': CLAUDE }));
    assert.equal(planned.changes.some((c) => c.what === 'agent'), false);
    assert.equal(fs.existsSync(path.join(home, 'hooks')), false);
    assert.equal(agentChosen({ '6.agent': CLAUDE }), 'claude-code');
  });
});

test('Copilot chosen but not signed in waits, names the sign-in, and changes nothing', async () => {
  await withProject(async ({ folder, user, config }) => {
    const { env, home } = copilotEnv(config, { signedIn: false });
    const planned = await stepFor(env, accountRun().run).plan(ctxFor(folder, user, { '6.agent': COPILOT }));
    assert.equal(typeof planned.wait, 'number');
    assert.match(planned.why, /copilot login/);
    assert.equal(planned.changes, undefined);
    assert.equal(fs.existsSync(path.join(home, 'hooks')), false);
  });
});

test('Copilot chosen and signed in: the card lists the hook file, apply writes it and records it, and the account is read', async () => {
  await withProject(async ({ folder, user, config }) => {
    const { env, home } = copilotEnv(config);
    const fake = accountRun();
    const step = stepFor(env, fake.run);
    const ctx = ctxFor(folder, user, { '6.agent': COPILOT });
    const planned = await step.plan(ctx);
    const hook = planned.changes.find((c) => c.what === 'agent');
    assert.equal(hook.target, path.join(home, 'hooks', 'wheelhouse.json'));
    assert.match(planned.card.what, /Copilot's checks before each of its actions/);
    assert.match(planned.card.why, /Copilot's hook file/);

    const recorded = [];
    const said = [];
    await step.apply({ ...ctx, applyJsonKey: () => {}, record: (c) => recorded.push(c), say: (line) => said.push(line) }, planned.changes);

    const written = fs.readFileSync(hook.target, 'utf8');
    const parsed = JSON.parse(written);
    assert.deepEqual(Object.keys(parsed.hooks).sort(), ['agentStop', 'preCompact', 'preToolUse', 'sessionEnd', 'sessionStart', 'subagentStop', 'userPromptSubmitted']);
    assert.match(parsed.hooks.preToolUse[0].command, /scripts\/agents\/copilot\/hook-entry\.js/);
    const change = recorded.find((c) => c.target === hook.target);
    assert.equal(change.kind, 'file');
    assert.equal(change.before, null);
    assert.equal(change.after, written);
    assert.deepEqual(fake.calls.filter(([file]) => file === 'gh'), [['gh', 'api', '/copilot_internal/user']]);
    assert.equal(readUsageAccount().entitlement, 200);
    assert.match(said.join('\n'), /Auto only, counted in requests, 200 requests a month/);

    // Already as Wheelhouse writes it: nothing more to do.
    const again = await step.plan(ctx);
    assert.equal(again.changes?.some((c) => c.what === 'agent') ?? false, false);

    // Uninstall puts the computer back: the file goes, since it still holds what setup wrote.
    assert.deepEqual(reverseChange({ id: newId('chg'), step: 6, ...change }), { put: true });
    assert.equal(fs.existsSync(hook.target), false);
  });
});

test('a hook file changed since setup is left alone by uninstall', async () => {
  await withProject(async ({ folder, user, config }) => {
    const { env } = copilotEnv(config);
    const step = stepFor(env, accountRun().run);
    const ctx = ctxFor(folder, user, { '6.agent': COPILOT });
    const planned = await step.plan(ctx);
    const recorded = [];
    await step.apply({ ...ctx, applyJsonKey: () => {}, record: (c) => recorded.push(c), say: () => {} }, planned.changes);
    const change = recorded[0];
    fs.writeFileSync(change.target, '{"version":1,"hooks":{}}\n');
    const got = reverseChange({ id: newId('chg'), step: 6, ...change });
    assert.equal(got.put, false);
    assert.equal(fs.existsSync(change.target), true);
  });
});

test('an account that can\'t be read leaves the defaults and says so', async () => {
  await withProject(async ({ folder, user, config }) => {
    for (const run of [accountRun('not json').run, accountRun('', 1).run, async (file) => { if (file === 'gh') throw new Error('no gh'); return { code: 0, stdout: '', stderr: '' }; }]) {
      const { env } = copilotEnv(config);
      const step = stepFor(env, run);
      const ctx = ctxFor(folder, user, { '6.agent': COPILOT });
      const planned = await step.plan(ctx);
      const said = [];
      await step.apply({ ...ctx, applyJsonKey: () => {}, record: () => {}, say: (l) => said.push(l) }, planned.changes.filter((c) => c.what === 'agent'));
      assert.match(said[0], /couldn't be read.*Auto only, 200 requests/);
    }
  });
});

test('a paid plan on usage-based billing is named, with its setting left to the director', async () => {
  await withProject(async ({ folder, user, config }) => {
    const { env } = copilotEnv(config);
    const paid = JSON.stringify({ access_type_sku: 'copilot_pro', token_based_billing: true, quota_snapshots: { premium_interactions: { entitlement: 1500, remaining: 1400 } } });
    const step = stepFor(env, accountRun(paid).run);
    const ctx = ctxFor(folder, user, { '6.agent': COPILOT });
    const planned = await step.plan(ctx);
    const said = [];
    await step.apply({ ...ctx, applyJsonKey: () => {}, record: () => {}, say: (l) => said.push(l) }, planned.changes);
    assert.match(said[0], /billed in AI credits, 1500 requests a month/);
    assert.match(said[0], /plan setting is Auto only until you change it/);
  });
});

test('step 7 sets this computer\'s entry in the agents map, keeps other computers\', and takes it out for Claude Code', () => {
  const id = computerId();
  assert.deepEqual(agentEntries({}), {});
  assert.deepEqual(agentEntries({ '6.agent': COPILOT }), { [id]: 'copilot' });
  assert.deepEqual(agentEntries({ '6.agent': CLAUDE }), { [id]: null });

  const answers = { '4.live-data': { label: 'No live data', text: null } };
  const withCopilot = starterConfig({ answers, agents: agentEntries({ '6.agent': COPILOT }) });
  const fresh = configFrom(null, withCopilot);
  assert.deepEqual(fresh.agents, { [id]: 'copilot' });
  assert.doesNotThrow(() => readConfig(JSON.stringify(fresh)));

  const existing = structuredClone(fresh);
  existing.agents = { elsewhere: 'copilot', [id]: 'claude-code' };
  assert.deepEqual(configFrom(existing, withCopilot).agents, { elsewhere: 'copilot', [id]: 'copilot' });

  const backToClaude = starterConfig({ answers, agents: agentEntries({ '6.agent': CLAUDE }) });
  assert.deepEqual(configFrom(existing, backToClaude).agents, { elsewhere: 'copilot' });
  const only = { ...structuredClone(fresh), agents: { [id]: 'copilot' } };
  assert.equal(Object.hasOwn(configFrom(only, backToClaude), 'agents'), false);
  assert.equal(Object.hasOwn(configFrom(null, backToClaude), 'agents'), false);

  // Where the director wasn't asked, the map is left as it is.
  const unasked = starterConfig({ answers });
  assert.deepEqual(configFrom(existing, unasked).agents, existing.agents);
});

test('the plan class is read from the account: free and student plans are Auto only, paid ones by their billing, else unknown', () => {
  assert.equal(planOf({ access_type_sku: 'free_educational_quota' }), 'auto-only');
  assert.equal(planOf({ access_type_sku: 'free_limited_copilot' }), 'auto-only');
  assert.equal(planOf({ access_type_sku: 'copilot_pro', token_based_billing: true }), 'credits');
  assert.equal(planOf({ access_type_sku: 'yearly_subscriber', token_based_billing: false }), 'requests');
  assert.equal(planOf({ access_type_sku: 'copilot_pro' }), null);
  assert.equal(planOf(null), null);
});

test('signed in means a sign-in key in the Copilot home, and only key names are looked at', () => {
  const home = tempFolder('wh-copilot-');
  assert.equal(signedIn({ home }), false);
  fs.writeFileSync(path.join(home, 'config.json'), '{"theme":"dark"}');
  assert.equal(signedIn({ home }), false);
  fs.writeFileSync(path.join(home, 'config.json'), '// Copilot CLI\n{"loggedInUsers":[]}');
  assert.equal(signedIn({ home }), true);
  fs.writeFileSync(path.join(home, 'config.json'), 'not json');
  assert.equal(signedIn({ home }), false);
});

test('an update points an existing hook file at the new release, leaves a computer with none alone, and writes nothing twice', () => {
  const env = { COPILOT_HOME: tempFolder('wh-copilot-') };
  const root = (version) => path.join(tempFolder('wh-root-'), version);
  assert.deepEqual(refreshAgentComputer({ env, root: root('0.3.2'), platform: 'darwin' }), []);
  assert.equal(fs.existsSync(path.join(env.COPILOT_HOME, 'hooks')), false);

  const first = root('0.3.1');
  hooks.writeRegistration({ home: env.COPILOT_HOME, root: first, platform: 'darwin' });
  const second = root('0.3.2');
  const lines = refreshAgentComputer({ env, root: second, platform: 'darwin' });
  assert.equal(lines.length, 1);
  assert.match(lines[0], /points at the new release/);
  const text = fs.readFileSync(hooks.file({ home: env.COPILOT_HOME }), 'utf8');
  assert.ok(text.includes(second) && !text.includes(first));
  assert.deepEqual(refreshAgentComputer({ env, root: second, platform: 'darwin' }), []);
});

// ---- Through the engine's routes, on the real step 6 ----

test('through /setup/plan, step 6 asks which agent, then waits for the sign-in, then lists the hook file', async () => {
  const bin = tempFolder('wh-bin-');
  fs.writeFileSync(path.join(bin, 'copilot'), '#!/bin/sh\n');
  const before = process.env.PATH;
  const beforeHome = process.env.COPILOT_HOME;
  const copilotHome = tempFolder('wh-copilot-');
  process.env.PATH = `${bin}${path.delimiter}${before}`;
  process.env.COPILOT_HOME = copilotHome;
  try {
    await withProject(async ({ folder, plan, answer, home, tools }) => {
      const asked = await plan(6);
      assert.equal(asked.ask.id, 'agent');
      assert.deepEqual(asked.ask.card.options.map((o) => o.label), ['Claude Code', 'Copilot']);

      // The click is recorded with the card; the next plan reads it. Not signed in yet: the step waits and says why.
      await answer(asked.ask.card, 'Copilot');
      const waiting = await plan(6);
      assert.match(JSON.stringify(waiting), /copilot login/);
      assert.equal(fs.existsSync(path.join(copilotHome, 'hooks')), false, 'nothing is written while it waits');

      fs.mkdirSync(copilotHome, { recursive: true });
      fs.writeFileSync(path.join(copilotHome, 'config.json'), '{"loggedInUsers":[{"host":"github.com","login":"someone"}]}\n');
      const planned = await plan(6);
      assert.match(JSON.stringify(planned), /Copilot's checks before each of its actions/);
      assert.equal(fs.existsSync(path.join(copilotHome, 'hooks')), false, 'planning changes nothing');
      assert.ok(folder && home);
      // The real step 6 reads the launch environment for telemetry through the stand-in launchctl; no host tool ran.
      assert.ok(tools.calls().every((line) => line.startsWith('launchctl getenv ')), tools.calls().join('\n'));
      tools.reset();
    });
  } finally {
    process.env.PATH = before;
    if (beforeHome === undefined) delete process.env.COPILOT_HOME; else process.env.COPILOT_HOME = beforeHome;
  }
});
