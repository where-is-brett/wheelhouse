// scripts/agents/tool-sheets.js
// Each agent's tool sheet, for the session start. The adapters' registry (scripts/agents/index.js) reaches the
// setup and evaluation code, which a hook must not load, so the hook reads the sheets from here: this file
// imports only each adapter's tool-sheet module, which imports nothing of Wheelhouse's. An agent with no entry
// here is given no sheet.
import claudeCode from '../../adapters/claude-code/tool-sheet.js';

export const TOOL_SHEETS = Object.freeze({ 'claude-code': claudeCode });
