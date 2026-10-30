// scripts/agents/engine-parts.js
// What the build engine takes from a project's agent (Archon design, sections 7.6, 13 and 14.4), so the core names no
// agent: the routing table's column as the engine's bindings, setup's engine line, and what step 2 adds to the engine
// folder for the agent. For the command line's own
// agent, the bindings are the column in force and setup's line is the core's own; another agent's column is bound to
// that agent's provider in the engine, every tier of it.
import { bindingsOf } from '../engine/order.js';
import { PROVIDER as COPILOT } from '../engine/archon/copilot-pack.js';
import { copilotColumn, readAccountModels } from './copilot/column.js';
import { engineDir } from '../lib/paths.js';
import { copilotCliInstalled, copilotCliPaths, installCopilotCli } from '../engine/archon/copilot-cli.js';
import { engineHomeProblem, writeEngineHome } from './copilot/engine-home.js';
import { newId } from '../setup/journal.js';

// The engine's tiers, and the role of the routing table each takes its model from (order.js's bindingsOf).
const TIER_ROLES = Object.freeze({ large: 'builderCritical', medium: 'builder', small: 'mechanical' });

// The bindings for a project's runs: `config` is the project's configuration, `agent` its agent, `inForce()` the
// routing table's column in force for the command line's agent ({ role: { model } }), `engine` the engine folder where
// setup kept the account's list of models.
export function engineRouting({ config, agent, inForce = () => ({}), engine = engineDir() }) {
  if (agent !== 'copilot') return bindingsOf(inForce());
  const column = config?.agentRouting?.copilot ?? {};
  const fallback = copilotColumn(readAccountModels(engine)).model;
  const tiers = {};
  for (const [tier, role] of Object.entries(TIER_ROLES)) {
    const model = typeof column[role] === 'string' && column[role] !== '' ? column[role] : fallback;
    tiers[tier] = `${COPILOT}/${model}`;
  }
  return { tiers };
}

// The one card's engine line for a project on `agent` (spec 14.4), or null for the core's own. On Copilot it names the
// requests a month the director allowed (check 74: a plan may have no included model, so every prompt counts), or its
// included models where the account's list (kept in `engine`) has one.
export function agentSetupLine(agent, { allowance = 0, engine = engineDir(), included } = {}) {
  if (agent !== 'copilot') return null;
  included ??= copilotColumn(readAccountModels(engine)).included;
  if (included) return 'Install the build engine, Archon, with its usage reporting off, and run its steps on Copilot\'s included models.';
  if (!(allowance > 0)) return 'Install the build engine, Archon, with its usage reporting off, to run its steps on Copilot, with no Copilot requests until you allow some.';
  return `Install the build engine, Archon, with its usage reporting off, to run its steps on Copilot, using up to ${allowance} of your plan's Copilot requests a month.`;
}

// Step 2's changes for the engine that a project's agent needs (scripts/setup/engine-parts.js): on Copilot, the CLI at
// its pin in the engine folder and its clean home, each only when it isn't in as it should be. Each change carries the
// words setup's card shows for it.
export function agentEngineChanges(agent, { engine = engineDir() } = {}) {
  if (agent !== 'copilot') return [];
  const paths = copilotCliPaths(engine);
  const changes = [];
  if (!copilotCliInstalled(engine)) {
    changes.push({ kind: 'folder', target: paths.binDir, action: 'agent-engine', part: 'cli', words: { full: 'Copilot\'s command-line program, pinned and checked, in the build engine\'s folder', terse: 'Copilot\'s program for the engine' } });
  }
  if (engineHomeProblem({ engine }) !== null) {
    changes.push({ kind: 'folder', target: paths.home, action: 'agent-engine', part: 'home', words: { full: 'a clean home for Copilot in the build engine, holding Wheelhouse\'s guards and your Copilot sign-in alone', terse: 'Copilot\'s clean home' } });
  }
  return changes;
}

// Makes one of agentEngineChanges' changes. A refused install, or a computer not signed in to Copilot, throws its plain
// reason. `install` and `writeHome` are for tests.
export async function applyAgentEngine(change, { engine = engineDir(), record = () => {}, fetch, arch, platform, run, install = installCopilotCli, writeHome = writeEngineHome } = {}) {
  if (change.part === 'cli') {
    const got = await install({ engine, record, fetch, arch, platform, run });
    if (got?.ok !== true) throw new Error(got?.refused ?? 'Copilot\'s program was not installed');
    return;
  }
  if (change.part === 'home') {
    record({ id: newId('chg'), kind: 'folder', target: change.target, before: null, after: { tool: 'copilot-home' } });
    writeHome({ engine });
  }
}
