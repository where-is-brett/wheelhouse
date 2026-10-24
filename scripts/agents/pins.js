// scripts/agents/pins.js
// The version of each agent other than Claude Code that Wheelhouse is pinned to, as lineage/manifest.json records it
// under `agents` (ruling P8-18). Each pin is the agent's own number, named once in its design's numbers file, so the
// manifest and the code can't drift: buildManifest writes these, and lineage's verify checks the manifest holds them.
// It imports only those numbers.
import { COPILOT_VERSION } from '../lib/copilot-numbers.js';

export const AGENT_PINS = Object.freeze({ copilot: Object.freeze({ cli: COPILOT_VERSION }) });
