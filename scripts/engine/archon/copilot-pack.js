// scripts/engine/archon/copilot-pack.js
// The pack's Copilot form (Archon design, sections 7.1 and 13). A Copilot project's run starts each workflow's twin,
// `<name>-copilot`, built into the same pack tree as the Claude form, so one digest covers both (pack-build.js). The
// twin differs only where Archon's Copilot provider needs it to:
//   - every step that asks a model runs on Copilot (`provider: copilot`); its tier stays, and the routing table's
//     Copilot column binds it per run, so the twin names no model;
//   - its skills are named plainly (Copilot loads no plugins, so `wheelhouse:tdd` is `tdd`), and it names no plugin;
//   - the tool rules name Copilot's tools, by one table;
//   - a first step writes the copies the workflow names into the run's worktree (copilot-skills.js), since Archon
//     looks for a Copilot step's skills there or in $HOME and nowhere else (check 74), and every other first step
//     waits on it;
//   - an included workflow is the twin of the one the Claude form includes.
import copilotToolNames from '../../../adapters/copilot/tools.js';
import { plainSkillName } from './copilot-skills.js';

export const PROVIDER = 'copilot';
export const COPILOT_SUFFIX = '-copilot';
export const SKILLS_STEP = 'copilot-skills';

// Claude Code's tool names, as a step's tool rules give them, to Copilot's. A name with no entry throws.
const TOOLS = Object.freeze({
  Read: ['view'],
  Grep: ['rg'],
  Glob: ['glob'],
  Bash: [...copilotToolNames.shell],
  WebFetch: ['web_fetch'],
  Write: [...copilotToolNames.edit],
  Edit: [...copilotToolNames.edit],
  NotebookEdit: [...copilotToolNames.edit],
});
// What only Claude steps take, left out of the twin.
const CLAUDE_ONLY = ['plugins', 'hooks', 'agents', 'maxBudgetUsd', 'settingSources', 'betas', 'fallbackModel'];

const asksModel = (node) => ['prompt', 'prompt_file', 'command', 'loop'].some((key) => node[key] !== undefined) || node.loop_group !== undefined;

export function copilotTools(names) {
  const out = [];
  for (const name of names) {
    if (!Object.hasOwn(TOOLS, name)) throw new Error(`A step's tool rule names ${name}, which has no Copilot tool in the table`);
    for (const tool of TOOLS[name]) if (!out.includes(tool)) out.push(tool);
  }
  return out;
}

function formOf(node, skills) {
  const copy = structuredClone(node);
  for (const key of CLAUDE_ONLY) delete copy[key];
  if (asksModel(copy)) copy.provider = PROVIDER;
  if (Array.isArray(copy.skills)) {
    copy.skills = copy.skills.map(plainSkillName);
    for (const name of copy.skills) skills.add(name);
  }
  for (const key of ['allowed_tools', 'denied_tools']) if (Array.isArray(copy[key])) copy[key] = copilotTools(copy[key]);
  if (typeof copy.include === 'string') copy.include = `${copy.include}${COPILOT_SUFFIX}`;
  if (Array.isArray(copy.loop_group?.nodes)) copy.loop_group.nodes = copy.loop_group.nodes.map((n) => formOf(n, skills));
  return copy;
}

// The Copilot twin of one workflow as the pack builds it. Leaves `workflow` as it was.
export function copilotForm(workflow) {
  const skills = new Set();
  const nodes = workflow.nodes.map((node) => formOf(node, skills));
  if (skills.size > 0) {
    for (const node of nodes) if (!Array.isArray(node.depends_on) || node.depends_on.length === 0) node.depends_on = [SKILLS_STEP];
    nodes.unshift({
      id: SKILLS_STEP,
      bash: `node "$WHEELHOUSE_ROOT/scripts/engine/archon/copilot-skills.js" --names ${[...skills].sort().join(',')}`,
      timeout: 60000,
    });
  }
  return { ...workflow, name: `${workflow.name}${COPILOT_SUFFIX}`, nodes };
}

// The forms buildPack writes beside each workflow's own.
export const PACK_FORMS = Object.freeze([copilotForm]);
