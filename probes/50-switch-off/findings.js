// probes/50-switch-off/findings.js
// Check 50: turns the trials that run.js recorded into the answers Tasks 3, 5
// and 7 of the install plan read. Pure: nothing here touches the computer, so
// the tests run on any system.
//
// A trial is one candidate route tried with one copy of Claude Code:
//   { name, binary: 'terminal' | 'desktop', where: 'main' | 'worktree',
//     init: { skills, agents, slashCommands, plugins, beforeModel } | null,
//     hooksRan: ['hook-project', 'hook-plugin', ...],
//     turns: { model | typed-skill | typed-command | typed-personal: { markers: [...] },
//              sandbox: { wrote: true | false } },
//     git: { statusClean, nothingStaged } }
// Markers are the files the scratch parts write into the project's `ran/`
// folder when they run, without the `.txt`.
//
// A kind's route is null (untried) unless the baseline trial, with nothing
// switched off, shows that part running: otherwise its not running under a
// candidate route says nothing. Otherwise it is one of:
//   { route: 'setting', file, key, value | add, typedRefused, ... }  a setting that held
//       on every copy; an agent's also carries blocksSameNamedPluginAgent
//   { route: 'move' }            no setting held: the part is moved out (the note's fall-back)
//   { route: 'none', instead }   no setting held and there is no move: `instead` says what then
// A route with `untried: true` had no candidate trial recorded.

export const LOCAL_FILE = '.claude/settings.local.json';
export const PROJECT_FILE = '.claude/settings.json';

export const NAMES = {
  skill: 'probe-skill',
  command: 'probe-command',
  agent: 'builder',
  untracked: 'probe-untracked',
  personal: 'wheelhouse-probe-50-personal',
  plugin: 'wheelhouse-probe-tools',
};

export const MARKERS = {
  skill: `skill-${NAMES.skill}`,
  personal: `skill-${NAMES.personal}`,
  command: `command-${NAMES.command}`,
  projectAgentBare: 'agent-project-step3',
  pluginAgentBare: 'agent-plugin-step3',
  projectAgentScoped: 'agent-project-step4',
  pluginAgentScoped: 'agent-plugin-step4',
  projectHook: 'hook-project',
  pluginHook: 'hook-plugin',
};

// The candidate routes, by trial name, as the exact key and value each writes.
// `<name>` stands for the part's own name.
export const CANDIDATES = {
  skill: [
    { trial: 'skill-overrides', route: { file: LOCAL_FILE, key: 'skillOverrides.<name>', value: 'off' } },
    { trial: 'skill-deny', route: { file: LOCAL_FILE, key: 'permissions.deny', add: 'Skill(<name>)' } },
    { trial: 'skill-deny-param', route: { file: LOCAL_FILE, key: 'permissions.deny', add: 'Skill(skill:<name>)' } },
  ],
  personal: [
    { trial: 'personal-overrides', route: { file: PROJECT_FILE, key: 'skillOverrides.<name>', value: 'off' } },
    { trial: 'personal-deny', route: { file: PROJECT_FILE, key: 'permissions.deny', add: 'Skill(<name>)' } },
  ],
  agent: [
    { trial: 'agent-deny', route: { file: LOCAL_FILE, key: 'permissions.deny', add: 'Agent(<name>)' } },
  ],
  hook: [
    { trial: 'hooks-off', route: { file: LOCAL_FILE, key: 'disableAllHooks', value: true } },
  ],
};

// The fall-back for a skill, agent or command: moved into briefDir(folder)/off/, with
// the move in the journal (the brief's fall-back; see the note).
const MOVE = Object.freeze({ route: 'move' });
const NONE_FOUND = 'none found: the note says what Task 3 does';

// ------------------------------------------------------------------ helpers

function named(trials, name, where = 'main') {
  return trials.filter((trial) => trial.name === name && (trial.where ?? 'main') === where);
}

// { terminal: value, desktop: value } for one trial name.
function perBinary(trials, name, read, where = 'main') {
  const out = {};
  for (const trial of named(trials, name, where)) out[trial.binary] = read(trial);
  return out;
}

// The one value every copy of Claude Code gave, or { differs } when they disagree,
// or null when nothing was recorded.
export function agree(map) {
  const values = Object.values(map);
  if (!values.length) return null;
  const first = JSON.stringify(values[0]);
  return values.every((value) => JSON.stringify(value) === first) ? values[0] : { differs: map };
}

// True only when every copy said true; false when any said false; null otherwise.
export function holds(map) {
  const values = Object.values(map);
  if (!values.length || values.some((value) => value === null || value === undefined)) {
    return values.some((value) => value === false) ? false : null;
  }
  return values.every((value) => value === true);
}

function ran(trial, ask, marker) {
  const turn = trial.turns?.[ask];
  if (!turn) return null;
  return turn.markers.includes(marker);
}

function keptOut(trial, ask, marker) {
  const did = ran(trial, ask, marker);
  return did === null ? null : !did;
}

function listedSkill(init, name) {
  if (!init) return null;
  return (init.skills ?? []).includes(name) || (init.slashCommands ?? []).includes(name);
}

function listedAgent(init, name) {
  if (!init) return null;
  return (init.agents ?? []).includes(name);
}

function listedPlugin(init, name) {
  if (!init) return null;
  return (init.plugins ?? []).some((plugin) => typeof plugin === 'string' && (plugin === name || plugin.startsWith(`${name}@`)));
}

function hookRan(trial, marker) {
  return Array.isArray(trial.hooksRan) ? trial.hooksRan.includes(marker) : null;
}

// ------------------------------------------------------------------ routes

function skillLike(trials, { trial, route }, { marker, typedAsk, name }) {
  const fromClaude = perBinary(trials, trial, (one) => keptOut(one, 'model', marker));
  const typed = perBinary(trials, trial, (one) => keptOut(one, typedAsk, marker));
  const listed = perBinary(trials, trial, (one) => listedSkill(one.init, name));
  return {
    trial,
    route,
    keptFromClaude: agree(fromClaude),
    typedRefused: agree(typed),
    stillListed: agree(listed),
    holds: holds(fromClaude),
    typedHolds: holds(typed),
  };
}

// A command, like a skill: kept from Claude (the model turn asks Claude to use
// it), and the typed `/<name>` refused.
function commandLike(trials, candidate) {
  return skillLike(trials, candidate, { marker: MARKERS.command, typedAsk: 'typed-command', name: NAMES.command });
}

// The first candidate that held on every copy, preferring one that also refused
// the typed `/<name>`, as { route: 'setting', ... }; otherwise `fallback`
// ({ route: 'move' } or { route: 'none', instead }). `extra(result)` adds fields
// to a setting route.
export function choose(results, fallback, extra = () => ({})) {
  const both = results.find((result) => result.holds === true && result.typedHolds === true);
  const either = both ?? results.find((result) => result.holds === true);
  if (either) return { route: 'setting', ...either.route, typedRefused: either.typedHolds, ...extra(either) };
  const untried = results.every((result) => result.holds === null);
  return { ...fallback, ...(untried ? { untried: true } : {}) };
}

// --------------------------------------------------------------- the answers

export function summarise(trials) {
  const baseline = (read) => holds(perBinary(trials, 'baseline', read));
  const controls = {
    skillRuns: baseline((one) => ran(one, 'model', MARKERS.skill)),
    typedSkillRuns: baseline((one) => ran(one, 'typed-skill', MARKERS.skill)),
    commandRuns: baseline((one) => ran(one, 'model', MARKERS.command)),
    typedCommandRuns: baseline((one) => ran(one, 'typed-command', MARKERS.command)),
    personalRuns: baseline((one) => ran(one, 'model', MARKERS.personal)),
    projectAgentRuns: baseline((one) => ran(one, 'model', MARKERS.projectAgentBare)),
    pluginAgentScopedRuns: baseline((one) => ran(one, 'model', MARKERS.pluginAgentScoped)),
    projectHookRuns: baseline((one) => hookRan(one, MARKERS.projectHook)),
    pluginHookRuns: baseline((one) => hookRan(one, MARKERS.pluginHook)),
    pluginLoads: baseline((one) => listedPlugin(one.init, NAMES.plugin)),
    sandboxBlocks: holds(perBinary(trials, 'sandbox-project', (one) => (one.turns?.sandbox ? !one.turns.sandbox.wrote : null))),
  };

  const candidates = {
    skill: CANDIDATES.skill.map((candidate) => skillLike(trials, candidate, { marker: MARKERS.skill, typedAsk: 'typed-skill', name: NAMES.skill })),
    command: CANDIDATES.skill.map((candidate) => commandLike(trials, candidate)),
    personal: CANDIDATES.personal.map((candidate) => skillLike(trials, candidate, { marker: MARKERS.personal, typedAsk: 'typed-personal', name: NAMES.personal })),
    agent: CANDIDATES.agent.map(({ trial, route }) => {
      const out = perBinary(trials, trial, (one) => keptOut(one, 'model', MARKERS.projectAgentBare));
      const scoped = perBinary(trials, trial, (one) => ran(one, 'model', MARKERS.pluginAgentScoped));
      // Whether the deny also stops the plugin's agent of the same name, by its
      // scoped name: false only when it still ran on every copy; untried unless
      // it ran in the baseline.
      const stillRunsEverywhere = holds(scoped);
      const blocks = controls.pluginAgentScopedRuns !== true || stillRunsEverywhere === null ? null : !stillRunsEverywhere;
      return {
        trial,
        route,
        keptFromClaude: agree(out),
        bareNameReachesPlugin: agree(perBinary(trials, trial, (one) => ran(one, 'model', MARKERS.pluginAgentBare))),
        scopedPluginAgentStillRuns: agree(scoped),
        blocksSameNamedPluginAgent: blocks,
        stillListed: agree(perBinary(trials, trial, (one) => listedAgent(one.init, NAMES.agent))),
        holds: holds(out),
        typedHolds: null,
      };
    }),
    hook: CANDIDATES.hook.map(({ trial, route }) => {
      const project = perBinary(trials, trial, (one) => {
        const did = hookRan(one, MARKERS.projectHook);
        return did === null ? null : !did;
      });
      const pluginStops = agree(perBinary(trials, trial, (one) => {
        const did = hookRan(one, MARKERS.pluginHook);
        return did === null ? null : !did;
      }));
      // disableAllHooks also stops Wheelhouse's own hooks if it stops a plugin's.
      const usable = pluginStops === false;
      return { trial, route, projectHookStops: agree(project), pluginHooksStopToo: pluginStops, holds: usable ? holds(project) : (pluginStops === true ? false : null), typedHolds: null };
    }),
  };

  // The move fall-back: a part moved out of the main checkout, its files marked
  // skip-worktree so git and its commits do not see it gone.
  const moved = {
    statusClean: agree(perBinary(trials, 'move-skip-worktree', (one) => one.git?.statusClean ?? null)),
    nothingStaged: agree(perBinary(trials, 'move-skip-worktree', (one) => one.git?.nothingStaged ?? null)),
    mainCheckoutLacksParts: agree(perBinary(trials, 'move-skip-worktree', (one) => (one.init
      ? !listedSkill(one.init, NAMES.skill) && !listedSkill(one.init, NAMES.command) && !listedAgent(one.init, NAMES.agent)
      : null))),
    worktreeStillLoadsThem: agree(perBinary(trials, 'move-skip-worktree', (one) => (one.init ? listedSkill(one.init, NAMES.skill) : null), 'worktree')),
  };
  const hookEdited = {
    statusClean: agree(perBinary(trials, 'hook-skip-worktree', (one) => one.git?.statusClean ?? null)),
    nothingStaged: agree(perBinary(trials, 'hook-skip-worktree', (one) => one.git?.nothingStaged ?? null)),
    mainCheckoutHookStops: agree(perBinary(trials, 'hook-skip-worktree', (one) => {
      const did = hookRan(one, MARKERS.projectHook);
      return did === null ? null : !did;
    })),
  };
  const hookInstead = hookEdited.mainCheckoutHookStops === true && hookEdited.statusClean === true
    ? 'edit: take the hook out of the main checkout\'s .claude/settings.json and mark it skip-worktree (see the note)'
    : NONE_FOUND;

  // A route is only an answer if the part ran in the baseline, with nothing
  // switched off: otherwise "it did not run" says nothing. Untried is null.
  const gated = (control, answer) => (control === true ? answer() : null);
  const route = {
    skill: gated(controls.skillRuns === true && controls.typedSkillRuns === true, () => choose(candidates.skill, MOVE)),
    // Where the deny also stops `<plugin>:<name>`, a project agent named as one of
    // Wheelhouse's own agents takes the move instead (see the note).
    agent: gated(controls.projectAgentRuns, () => choose(candidates.agent, MOVE, (result) => ({ blocksSameNamedPluginAgent: result.blocksSameNamedPluginAgent }))),
    command: gated(controls.commandRuns === true && controls.typedCommandRuns === true, () => choose(candidates.command, MOVE)),
    hook: gated(controls.projectHookRuns, () => choose(candidates.hook, { route: 'none', instead: hookInstead })),
  };
  const personal = gated(controls.personalRuns, () => choose(candidates.personal, { route: 'none', instead: NONE_FOUND }));

  // Does the main checkout's local settings reach a session in a worktree of it?
  const inWorktree = {
    skillHidden: agree(perBinary(trials, 'worktree-local', (one) => (one.init ? !listedSkill(one.init, NAMES.skill) : null), 'worktree')),
    agentKeptOut: agree(perBinary(trials, 'worktree-local', (one) => keptOut(one, 'model', MARKERS.projectAgentBare), 'worktree')),
    pluginOff: agree(perBinary(trials, 'worktree-local', (one) => (one.init ? !listedPlugin(one.init, NAMES.plugin) : null), 'worktree')),
    controlListsSkill: agree(perBinary(trials, 'worktree-control', (one) => listedSkill(one.init, NAMES.skill), 'worktree')),
  };

  const pluginOffMap = perBinary(trials, 'plugin-off', (one) => (one.init
    ? !listedPlugin(one.init, NAMES.plugin) && hookRan(one, MARKERS.pluginHook) === false
    : null));
  const sandboxOffMap = perBinary(trials, 'sandbox-local-off', (one) => (one.turns?.sandbox ? one.turns.sandbox.wrote : null));

  const sameNameMap = perBinary(trials, 'baseline', (one) => {
    const project = ran(one, 'model', MARKERS.projectAgentBare);
    const plugin = ran(one, 'model', MARKERS.pluginAgentBare);
    if (project === null) return null;
    if (project && plugin) return 'both';
    if (project) return 'project';
    if (plugin) return 'plugin';
    return null;
  });

  const nextSession = holds({
    off: holds(perBinary(trials, 'next-session-off', (one) => (one.init ? !listedSkill(one.init, NAMES.skill) : null))),
    on: holds(perBinary(trials, 'next-session-on', (one) => listedSkill(one.init, NAMES.skill))),
    offAgain: holds(perBinary(trials, 'next-session-off-again', (one) => (one.init ? !listedSkill(one.init, NAMES.skill) : null))),
  });

  const inits = trials.filter((trial) => trial.init);
  const initBeforeModel = inits.length ? inits.every((trial) => trial.init.beforeModel === true) : null;
  const initLists = inits.length
    ? inits.every((trial) => Array.isArray(trial.init.skills) && Array.isArray(trial.init.agents) && Array.isArray(trial.init.plugins))
    : null;

  return {
    route,
    typedRefused: { skill: route.skill?.typedRefused ?? null, command: route.command?.typedRefused ?? null },
    personal,
    pluginOff: controls.pluginLoads === true ? holds(pluginOffMap) : null,
    sandboxOff: controls.sandboxBlocks === true ? holds(sandboxOffMap) : null,
    sameName: agree(sameNameMap),
    untrackedLoads: agree(perBinary(trials, 'baseline', (one) => listedSkill(one.init, NAMES.untracked))),
    nextSession,
    initBeforeModel,
    initListsSkillsAgentsPlugins: initLists,
    inWorktree,
    moved,
    hookEdited,
    controls,
    candidates,
  };
}
