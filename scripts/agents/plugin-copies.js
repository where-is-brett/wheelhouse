// scripts/agents/plugin-copies.js
// The plugin copies another agent installs for itself and runs the hooks of, beside the hook entry Wheelhouse
// registers for that agent: each check says whether a hook script is such a copy and stands aside, saying nothing.
// The hook kit reads them from here, as it does the translations (translators.js); each check imports nothing
// that reaches the kit.
import { standsAside as copilotCopy } from '../../adapters/copilot/plugin-copy.js';

export const PLUGIN_COPIES = Object.freeze([copilotCopy]);
