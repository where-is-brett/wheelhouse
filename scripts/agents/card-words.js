// scripts/agents/card-words.js
// Each agent's words for the line the board context adds when cards wait (ruling P5-54). The board context is
// core code that never names an agent, so it asks here: an agent with an entry gets its own line, and any other
// (Claude Code among them) keeps the core's own, which names Claude Code's tool and `cli.js cards`. The
// clickable-question tool is read from the agent's tool sheet (scripts/agents/tool-sheets.js), so the line names
// the tool the session start told the agent about.
import { TOOL_SHEETS } from './tool-sheets.js';

const ASK_LINE = /^- Your clickable-question tool is (.+)\.$/m;

// The agent's clickable-question tool as its tool sheet names it, or null when the sheet names none.
export function askTool(agent) {
  if (!Object.hasOwn(TOOL_SHEETS, agent)) return null;
  return ASK_LINE.exec(TOOL_SHEETS[agent])?.[1] ?? null;
}

// Copilot: the cards come from the Wheelhouse command the session start names, and are asked with ask_user.
// Under STOP, at every tier, the one card is Lift All stop, which the helper's own window confirms, never a click in the
// chat (ruling P8-7): at Lean the Lean command's `confirm lift-stop` shows it there (its playbook's With Wheelhouse's
// helper), and at Middle and Full the Wheelhouse command's `confirm lift-stop` does.
function copilotLine({ count, lean, stop }) {
  if (stop) {
    const command = lean ? 'the Lean command\'s' : 'the Wheelhouse command\'s';
    return `Cards to ask this visit: 1, Lift All stop, which is confirmed in Wheelhouse's own window: after the briefing, run ${command} \`confirm lift-stop\` and wait for the director's click there.`;
  }
  return `Cards to ask this visit: ${count}. Run the Wheelhouse command's \`cards\` and ask them in one call of ${askTool('copilot')}, after the briefing.`;
}

const LINES = Object.freeze({ copilot: copilotLine });

// The agent's own cards line for `count` cards, in a Lean project or not, with STOP on or off; null when the
// agent has no words of its own, so the core's line stands.
export function cardsLineFor(agent, { count, lean = false, stop = false }) {
  if (typeof agent !== 'string' || !Object.hasOwn(LINES, agent)) return null;
  return LINES[agent]({ count, lean: lean === true, stop: stop === true });
}
