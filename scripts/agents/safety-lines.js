// scripts/agents/safety-lines.js
// Each agent's label, safety line and update line (`updateWaiting(name)`, for a tool Wheelhouse doesn't know yet), for the board. The board's model is core code that never names an agent,
// and the adapters' registry (scripts/agents/index.js) reaches the setup and evaluation code, so the board reads
// these from here: this file imports only each adapter's identity and safety-line modules. A test holds each
// entry to its adapter's own parts.
import claudeCodeIdentity from '../../adapters/claude-code/identity.js';
import claudeCodeSafety, { updateWaiting as claudeCodeUpdate } from '../../adapters/claude-code/safety-line.js';
import copilotIdentity from '../../adapters/copilot/identity.js';
import copilotSafety, { updateWaiting as copilotUpdate } from '../../adapters/copilot/safety-line.js';

export const SAFETY_LINES = Object.freeze({
  'claude-code': Object.freeze({ label: claudeCodeIdentity.label, safetyLine: claudeCodeSafety, updateWaiting: claudeCodeUpdate }),
  copilot: Object.freeze({ label: copilotIdentity.label, safetyLine: copilotSafety, updateWaiting: copilotUpdate }),
});
