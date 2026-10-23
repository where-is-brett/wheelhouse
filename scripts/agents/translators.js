// scripts/agents/translators.js
// Each agent's translation of its hook input and answers, for the hook kit. The adapters' registry
// (scripts/agents/index.js) reaches the setup and evaluation code, which a hook must not load, so the kit reads
// the translations from here: this file imports only each adapter's translate module, which imports nothing
// that reaches the kit. An agent with no entry here has no translation, and its input is refused. A test holds
// each entry to its adapter's own `translate`.
import claudeCode from '../../adapters/claude-code/translate.js';
import copilot from '../../adapters/copilot/translate.js';

export const TRANSLATORS = Object.freeze({
  'claude-code': Object.freeze({ translate: claudeCode }),
  copilot: Object.freeze({ translate: copilot }),
});
