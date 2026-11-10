// scripts/agents/pins.js
// The version of each agent other than Claude Code that Wheelhouse is pinned to, as lineage/manifest.json records it
// under `agents` (ruling P8-18). The manifest names no agent but through this file, and the guard on core files lets
// it name none. Copilot's pin is the version its trial checks ran on (scripts/agents/copilot/numbers.js).
import { COPILOT_VERSION } from './copilot/numbers.js';

export const AGENT_PINS = Object.freeze({ copilot: Object.freeze({ cli: COPILOT_VERSION }) });
