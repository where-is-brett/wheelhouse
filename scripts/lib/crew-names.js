// scripts/lib/crew-names.js
// The names a feature session dispatches its Crew by. Claude Code names an agent `wheelhouse:<role>`; an agent that matches
// a shell rule on a command's stem and runs Wheelhouse's commands by launcher (scripts/lib/launchers.js) names it
// `wheelhouse-<role>`, the name its agent file carries. The brief and the wakes say which, by whether the session runs by
// launcher.
import { agentOfConfig } from '../agents/names.js';
import { BY_LAUNCHER } from '../agents/tool-sheets.js';
import { computerId } from './paths.js';

// Whether the agent this computer runs feature sessions with runs Wheelhouse's commands by launcher, under `config`: the
// condition that sets the brief's `launchers` option. An agent that can't be read counts as one that doesn't.
export function runsByLauncher(config) {
  try {
    return BY_LAUNCHER.includes(agentOfConfig(config, { computerId: computerId() }));
  } catch {
    return false;
  }
}

// The name a Crew member (`builder`, `reviewer` or `tester`) is dispatched by.
export const crewAgent = (role, launchers = false) => (launchers === true ? `wheelhouse-${role}` : `wheelhouse:${role}`);

// `text` with each Claude Code name of a Crew member (`wheelhouse:builder`, `wheelhouse:reviewer`, `wheelhouse:tester`) given
// by its launcher name. Skills, which also have a colon (`superpowers:requesting-code-review`), are left as they are.
export const withLauncherCrewNames = (text) => text.replace(/\bwheelhouse:(builder|reviewer|tester)\b/g, 'wheelhouse-$1');
