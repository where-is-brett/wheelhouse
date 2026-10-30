// tests/scripts/agents/engine-parts.test.js
// What the build engine takes from a project's agent: its routing column as the engine's bindings, and setup's line.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { engineRouting, agentSetupLine } from '../../../scripts/agents/engine-parts.js';
import { writeAccountModels, parseAccountModels, copilotColumn, requestRates, readAccountModels, modelsFile } from '../../../scripts/agents/copilot/column.js';
import { workflowFor } from '../../../scripts/engine/archon/adapter.js';
import { tempFolder } from '../../helpers/homes.js';

// The account's list as the CLI's ACP `session/new` gives it, as check 74 read it for this account: Auto alone, at 1x.
const THIS_ACCOUNT = { sessionId: 's', models: { currentModelId: 'auto', availableModels: [{ modelId: 'auto', name: 'Auto', description: 'Let Copilot pick the best model', _meta: { copilotUsage: '1x' } }] } };
// An account whose plan has an included model.
const WITH_INCLUDED = { models: { availableModels: [
  { modelId: 'auto', _meta: { copilotUsage: '1x' } },
  { modelId: 'gpt-included', _meta: { copilotUsage: '0x' } },
  { modelId: 'big-premium', _meta: { copilotUsage: '10x' } },
  { modelId: 'cheap', _meta: { copilotUsage: '0.33x' } },
] } };

test('the account\'s list is read with each model\'s rate; a rate that can\'t be read is unknown, never zero', () => {
  assert.deepEqual(parseAccountModels(THIS_ACCOUNT), [{ id: 'auto', multiplier: 1 }]);
  assert.deepEqual(parseAccountModels(WITH_INCLUDED).map((m) => m.multiplier), [1, 0, 10, 0.33]);
  assert.deepEqual(parseAccountModels({ models: { availableModels: [{ modelId: 'odd', _meta: { copilotUsage: 'lots' } }, { name: 'no id' }, { modelId: 'bad name; rm -rf' }] } }), [{ id: 'odd', multiplier: null }]);
  assert.deepEqual(parseAccountModels(null), []);
});

test('the Copilot column takes an included model where the plan has one, and Copilot\'s own pick where it has none', () => {
  assert.deepEqual(copilotColumn(parseAccountModels(WITH_INCLUDED)), { model: 'gpt-included', included: true });
  assert.deepEqual(copilotColumn(parseAccountModels(THIS_ACCOUNT)), { model: 'auto', included: false });
  assert.deepEqual(copilotColumn([]), { model: 'auto', included: false });
});

test('the rates count every model at its multiplier, an unknown one and Auto at one', () => {
  const rates = requestRates(parseAccountModels(WITH_INCLUDED));
  assert.equal(rates('gpt-included'), 0);
  assert.equal(rates('big-premium'), 10);
  assert.equal(rates('auto'), 1);
  assert.equal(rates('never-heard-of'), 1);
  assert.equal(requestRates([{ id: 'odd', multiplier: null }])('odd'), 1);
  assert.equal(requestRates([])('auto'), 1);
});

test('the list setup read is kept in the engine folder, and one that can\'t be read is none', () => {
  const engine = tempFolder('wh-models-');
  assert.deepEqual(readAccountModels(engine), []);
  writeAccountModels(engine, parseAccountModels(WITH_INCLUDED), { now: () => new Date('2026-10-30T01:00:00Z') });
  assert.equal(path.dirname(modelsFile(engine)), path.join(engine, 'copilot'));
  assert.deepEqual(readAccountModels(engine).map((m) => m.id), ['auto', 'gpt-included', 'big-premium', 'cheap']);
});

test('a Copilot project\'s bindings are its own column, on Copilot, every tier bound', () => {
  const engine = tempFolder('wh-models-');
  const config = { agentRouting: { copilot: { builder: 'cheap', builderCritical: null } } };
  const routing = engineRouting({ config, agent: 'copilot', engine, inForce: () => assert.fail('the Claude column is never read') });
  assert.deepEqual(routing, { tiers: { large: 'copilot/auto', medium: 'copilot/cheap', small: 'copilot/auto' } });
  assert.deepEqual(workflowFor('wheelhouse-quick', routing), { workflow: 'wheelhouse-quick-copilot' });
  // With no column at all, and an included model on the account: every tier on it.
  writeAccountModels(engine, parseAccountModels(WITH_INCLUDED));
  assert.deepEqual(engineRouting({ config: {}, agent: 'copilot', engine }), { tiers: { large: 'copilot/gpt-included', medium: 'copilot/gpt-included', small: 'copilot/gpt-included' } });
});

test('a Claude Code project\'s bindings are the column in force, as before', () => {
  const routing = engineRouting({ config: {}, agent: 'claude-code', inForce: () => ({ builder: { model: 'm-mid' }, builderCritical: { model: 'm-big' } }) });
  assert.deepEqual(routing, { tiers: { large: 'm-big', medium: 'm-mid' } });
});

test('setup\'s engine line for a Copilot project names Copilot and the allowance the director set', () => {
  assert.equal(agentSetupLine('claude-code'), null);
  assert.match(agentSetupLine('copilot', { allowance: 0 }), /Copilot/);
  assert.match(agentSetupLine('copilot', { allowance: 0 }), /no Copilot requests until you allow some/);
  assert.match(agentSetupLine('copilot', { allowance: 40 }), /up to 40 of your plan's Copilot requests a month/);
  assert.match(agentSetupLine('copilot', { allowance: 40, included: true }), /included models/);
});

import fs from 'node:fs';
import { agentEngineChanges, applyAgentEngine } from '../../../scripts/agents/engine-parts.js';
import { copilotCliPaths } from '../../../scripts/engine/archon/copilot-cli.js';

test('a Copilot project\'s engine needs the CLI at its pin and the clean home; a Claude Code project\'s needs neither', () => {
  const engine = tempFolder('wh-agent-engine-');
  assert.deepEqual(agentEngineChanges('claude-code', { engine }), []);
  const changes = agentEngineChanges('copilot', { engine });
  assert.deepEqual(changes.map((c) => [c.action, c.part, c.target]), [
    ['agent-engine', 'cli', copilotCliPaths(engine).binDir],
    ['agent-engine', 'home', copilotCliPaths(engine).home],
  ]);
  for (const c of changes) assert.match(c.words.full, /Copilot/);
});

test('applying them installs the CLI and writes the home through their own makers, recording the home', async () => {
  const engine = tempFolder('wh-agent-engine-');
  const done = [];
  const records = [];
  const install = async (opts) => { done.push(['cli', opts.engine]); return { ok: true, bin: copilotCliPaths(engine).bin }; };
  const writeHome = (opts) => { done.push(['home', opts.engine]); return copilotCliPaths(engine).home; };
  for (const change of agentEngineChanges('copilot', { engine })) await applyAgentEngine(change, { engine, record: (c) => records.push(c), install, writeHome });
  assert.deepEqual(done, [['cli', engine], ['home', engine]]);
  assert.deepEqual(records.map((r) => [r.kind, r.target]), [['folder', copilotCliPaths(engine).home]]);
  assert.equal(records[0].before, null, 'nothing was there');
  fs.mkdirSync(copilotCliPaths(engine).home, { recursive: true });
  const again = [];
  await applyAgentEngine({ part: 'home', target: copilotCliPaths(engine).home }, { engine, record: (c) => again.push(c), install, writeHome });
  assert.deepEqual(again[0].before, {}, 'a home was there');
  // A refused install throws its plain reason.
  await assert.rejects(applyAgentEngine(agentEngineChanges('copilot', { engine })[0], { engine, install: async () => ({ ok: false, refused: 'no network' }) }), /no network/);
  assert.ok(fs.existsSync(engine));
});
