// scripts/agents/tool-sheets.js
// Each agent's tool sheet, for the session start. The adapters' registry (scripts/agents/index.js) reaches the
// setup and evaluation code, which a hook must not load, so the hook reads the sheets from here: this file
// imports only each adapter's tool-sheet module, which imports nothing of Wheelhouse's. An agent with no entry
// here is given no sheet. A test holds each entry to its adapter's own `toolSheet`.
import claudeCode from '../../adapters/claude-code/tool-sheet.js';
import copilot, { byLauncher as copilotByLauncher } from '../../adapters/copilot/tool-sheet.js';

export const TOOL_SHEETS = Object.freeze({ 'claude-code': claudeCode, copilot });

// The agents that match a shell rule on a command's stem, so their sessions run Wheelhouse's scripts by launcher
// (scripts/lib/launchers.js): each adapter's tool-sheet module says so with `byLauncher`.
export const BY_LAUNCHER = Object.freeze(Object.entries({ copilot: copilotByLauncher }).filter(([, by]) => by === true).map(([agent]) => agent));
