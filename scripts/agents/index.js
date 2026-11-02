// scripts/agents/index.js
// Which coding agent a piece of input or a project belongs to, and the adapter for each agent.
import claudeCode from '../../adapters/claude-code/index.js';
import copilot from '../../adapters/copilot/index.js';
import { AGENTS, noAdapter } from './project-agent.js';
import { CLAUDE_HARNESS_CHECKED } from '../lib/copilot-numbers.js';
import { companyManages, readCompanySettings } from './copilot/company.js';
import { copilotLocked } from './copilot/locked.js';

export { ADAPTER_PARTS, checkAdapter } from './contract.js';
export { AGENTS, agentOfConfig, agentOfProject } from './project-agent.js';
export { agentOfInput } from './of-input.js';
// The script a sign-in start runs to start the helper; the engine's sign-in start shares it.
export { START_SCRIPT as HELPER_START_SCRIPT } from './copilot/start-helper.js';

// VS Code's Claude harness (design section 3.1, check 54): the Claude Code adapter in another front end, with its own
// name and safety line. It is a front end only: builds stay on Archon, and no project names it as its agent.
export const CLAUDE_IN_VSCODE = 'claude-in-vscode';
export const claudeInVscodeLine = () => [
  'In VS Code, Claude runs through Copilot\'s subscription: Wheelhouse\'s guards load there as in Claude Code, but a company that manages Copilot can switch it off, and it is used as a front end only',
  'Builds run on the build engine, not in this chat',
];
const claudeInVscode = Object.freeze({
  ...claudeCode,
  identity: Object.freeze({ ...claudeCode.identity, name: CLAUDE_IN_VSCODE, label: 'Claude in VS Code' }),
  safetyLine: claudeInVscodeLine,
});

const ADAPTERS = Object.freeze({ 'claude-code': claudeCode, copilot, [CLAUDE_IN_VSCODE]: claudeInVscode });

// Whether setup may offer VS Code's Claude agent beside the Copilot route: check 54 has passed (the switch is on) and
// the company's settings don't switch it off. `company` is whether the company manages Copilot's permission or sandbox
// rules, which makes VS Code switch its Claude agent off (design section 6.4).
export function claudeHarnessOffered({ checked = CLAUDE_HARNESS_CHECKED, company = false } = {}) {
  return checked === true && company !== true;
}

// setup's question for the front end: `{ offered }`, true only where check 54 passed and the company doesn't manage
// Copilot. `company` is readCompanySettings' arguments, `checked` the switch, for tests.
export function claudeHarnessRoute({ platform = process.platform, company = {}, checked } = {}) {
  const managed = companyManages(readCompanySettings({ platform, ...company }));
  return { offered: claudeHarnessOffered({ ...(checked === undefined ? {} : { checked }), company: managed }) };
}

// An agent's part of Locked (scripts/protection/locked.js takes it as `agent`), or null for an agent whose Locked is the
// core's alone. `{ route(platform) -> { route: 'organisation' | 'locked' | 'none', why }, prepare, removal }`; `options`
// are for tests.
export function agentLocked(name, options = {}) {
  return name === 'copilot' ? copilotLocked(options) : null;
}

export function adapterFor(name) {
  if (typeof name !== 'string' || !Object.hasOwn(ADAPTERS, name)) throw noAdapter(name);
  return ADAPTERS[name];
}
