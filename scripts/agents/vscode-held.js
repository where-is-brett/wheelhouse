// scripts/agents/vscode-held.js
// Whether a project's cards are held back from Copilot's chat because a VS Code panel is live for it. Only a project that
// runs Copilot on this computer is held: a Claude Code project's cards are always asked in its chat, panel or no panel.
// Anything that goes wrong gives false, so the cards are asked in the chat. These read the Wheelhouse home, so they run
// in the helper (through the desk's source), never in a sandboxed command.
import { agentOfProject } from './names.js';
import { computerId } from '../lib/paths.js';
import { vscodePaneLive, markVscodeHere, takeVscodeHere } from '../lib/vscode-pane.js';

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

// What a card command asks about the panel: { applies, held }. `applies` says the project runs the VS Code agent. With
// `ids` and a live panel, `held` is true unless those cards were let through once by an earlier `here`; with `here` and a
// live panel the ids are marked to be let through once and `held` is false. Never throws.
export function vscodeAsk(where, asked) {
  try {
    const { project, folder, now } = where;
    const { ids, here } = asked ?? {};
    const applies = runsVscodeAgent(folder);
    if (!applies || !heldForVscode({ project, folder }, now)) return { applies, held: false };
    if (!Array.isArray(ids) || ids.length === 0) return { applies, held: true };
    if (here === true) {
      markVscodeHere(project, ids, now);
      return { applies, held: false };
    }
    return { applies, held: !takeVscodeHere(project, ids, now) };
  } catch {
    return { applies: false, held: false };
  }
}
