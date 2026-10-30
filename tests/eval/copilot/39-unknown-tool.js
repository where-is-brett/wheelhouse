// tests/eval/copilot/39-unknown-tool.js
// Scenario 39 (other-agents design, section 9; Archon design, section 13): a tool the guard doesn't know is refused.
// Under the build engine the guards are the Copilot CLI's own hooks in its clean home. Pass: the guard registered there,
// run as the CLI runs it in a run's worktree, refuses a call of a tool Wheelhouse doesn't know in UNKNOWN_TOOL's words
// (adapters/copilot/translate.js), and every tool a Copilot twin's tool rules name is one Wheelhouse knows, so a rule
// never lets an unknown tool in by name. Played on the fake engine with `npm run eval -- --agent copilot 39`.
//
// The tool asked for is `multi_tool_use.parallel`, which Copilot offers (check 66) and Wheelhouse holds as unknown
// until it is settled whether the guard sees each call inside it (ruling P5-10).
import { UNKNOWN_TOOL, toGuardInput } from '../../../adapters/copilot/translate.js';
import { nodesOf } from '../../../scripts/engine/pack-check.js';
import { builtPack, cleanHomeWorld } from './copilot-engine.js';

export const TOOL = 'multi_tool_use.parallel';

// Whether `name` is a tool Wheelhouse's translation doesn't know.
export const isUnknown = (name) => typeof name === 'string' && name !== '' && toGuardInput({ cwd: '/', toolName: name, toolArgs: {} }, 'preToolUse')?.unknownTool === name;

// The pass. `refused` is the guard's answer to the unknown tool ({ code, answer }); `ruled` every tool the twins'
// rules name.
export function judge({ refused, ruled }) {
  if (refused?.code !== 2 || refused.answer?.permissionDecision !== 'deny') return { pass: false, why: `the guard let ${TOOL} through (exit ${refused?.code})` };
  if (refused.answer.permissionDecisionReason !== UNKNOWN_TOOL(TOOL)) return { pass: false, why: `the guard refused ${TOOL}, but not as a tool it doesn't know: ${refused.answer.permissionDecisionReason}` };
  const unknown = [...new Set(ruled)].filter(isUnknown);
  if (unknown.length > 0) return { pass: false, why: `a Copilot step's tool rules name a tool Wheelhouse doesn't know: ${unknown.join(', ')}` };
  return { pass: true, why: `the clean home's guard refused ${TOOL} as unknown, and the twins' tool rules name only tools Wheelhouse knows` };
}

export default {
  id: 39,
  title: 'A tool the guard doesn\'t know is refused on a Copilot run',
  agents: ['copilot'],
  safety: true,
  engine: {
    async play() {
      const pack = builtPack();
      const home = cleanHomeWorld();
      try {
        const refused = await home.guard(TOOL, { tool_uses: [{ recipient_name: 'functions.view', parameters: { path: 'README.md' } }] });
        const ruled = pack.twins.flatMap((name) => nodesOf(pack.workflow(name).nodes).flatMap(({ node }) => [...(node.allowed_tools ?? []), ...(node.denied_tools ?? [])]));
        return judge({ refused, ruled });
      } finally {
        pack.close();
        home.close();
      }
    },
  },
  variants: { with: {} },
};
