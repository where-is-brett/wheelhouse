// scripts/agents/vscode-held.js
// Whether a project's cards are held back from Copilot's chat because a VS Code panel is live for it. Only a project that
// runs Copilot on this computer is held: a Claude Code project's cards are always asked in its chat, panel or no panel.
// Anything that goes wrong gives false, so the cards are asked in the chat.
import { agentOfProject } from './names.js';
import { computerId } from '../lib/paths.js';
import { vscodePaneLive } from '../lib/vscode-pane.js';

// Whether the project in `folder` runs the VS Code agent on this computer.
export function runsVscodeAgent(folder) {
  try {
    return typeof folder === 'string' && agentOfProject(folder, { computerId: computerId() }) === 'copilot';
  } catch {
    return false;
  }
}

// `project` is the project's id and `folder` its main folder; `now` is in ms.
export function heldForVscode({ project, folder }, now) {
  try {
    if (typeof project !== 'string') return false;
    return runsVscodeAgent(folder) && vscodePaneLive(project, now);
  } catch {
    return false;
  }
}
