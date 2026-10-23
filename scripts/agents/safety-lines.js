// scripts/agents/safety-lines.js
// Each agent's label and safety line, for the board. The board's model is core code that never names an agent,
// and the adapters' registry (scripts/agents/index.js) reaches the setup and evaluation code, so the board reads
// these from here: this file imports only each adapter's identity and safety-line modules. A test holds each
// entry to its adapter's own parts.
import claudeCodeIdentity from '../../adapters/claude-code/identity.js';
import claudeCodeSafety from '../../adapters/claude-code/safety-line.js';
import copilotIdentity from '../../adapters/copilot/identity.js';
import copilotSafety from '../../adapters/copilot/safety-line.js';

export const SAFETY_LINES = Object.freeze({
  'claude-code': Object.freeze({ label: claudeCodeIdentity.label, safetyLine: claudeCodeSafety }),
  copilot: Object.freeze({ label: copilotIdentity.label, safetyLine: copilotSafety }),
});
