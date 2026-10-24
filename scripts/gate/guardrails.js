// scripts/gate/guardrails.js
// What a pull request's changed files say about the merge gate (design section
// 12.4): whether they touch the guardrails (so the director must approve), and
// which of the project's critical areas they are in.
//
// The project's configuration is .claude/wheelhouse.json on the default branch:
//   Config = { v: 1, criticalAreas: [{ name, paths: [glob], checks: [glob] }],
//              ciFiles: [glob], mcpServers: [string], webDomains: [string],
//              runbook?: { contain?: { describe: string, command: [string] } },
//              routing?: { frontDesk, foreman, builder, reviewer, reviewerCritical, tester, mechanical, feature, builderCritical },
//              tiers?: { pins: { mostCapable?, midSized?, premium? } },
//              sessionMode?: string, buildCommands?: [string], watcherShape?: 1 | 2,
//              hotFiles?: [glob], flagFiles?: [glob], pages?: [path], gitlabHosts?: [string],
//              glabFrom?: string, signsApps?: boolean,
//              agentRouting?: { <agent>: { <role>: model | null } } }
// Other keys are kept and ignored.
//
// `agentRouting` is the routing table's column for each agent other than the command line's own (ruling P8-22): keyed
// by an agent's name (scripts/agents/names.js), each a table of the same roles as `routing`, each model a name
// isModelName passes or null for that agent's own default. Anything else makes the configuration unreadable. Setup
// pins no model there until that agent's list of models has been read on a real run.
//
// `tiers.pins` is the Thoroughness setting's column of models (design section 14.6): the name of the most capable,
// the mid-sized and the premium model, each a name isModelName passes or null. A cell of the routing table is a class
// of model, and the class's pin is its model (scripts/routing/thoroughness.js). With no `tiers`, only Balanced is
// available, and `routing` names each role's model as it always did. Anything else in `tiers` makes the configuration
// unreadable.
//
// `signsApps: true` says the project's builds sign Mac or iOS apps, which needs the keychain, so
// the project's settings leave it open (scripts/protection/settings.js, check 73). Left out or
// false, the keychain stays shut. The file is a guardrail, so the switch moves only by a reviewed
// pull request with the director's approval.
//
// The build loop's keys (build-loop design, section 11; main design, section 8),
// filled in by readConfig when left out:
//   - routing: each role's model name, or null for the command line's own
//     default (the default for every role, so Wheelhouse names no model). Setup
//     pins `frontDesk` in the project's own table to the full name Claude Code's
//     alias `opus` stands for (setup/best-model.js), and the
//     pin moves only after the evaluation passes on a new model (design section 8).
//     A name may not start with `-`, so it can never read as a flag. Other
//     roles in the table are kept.
//   - sessionMode: the explicit permission mode sessions start in, default
//     `acceptEdits`. Bypass mode is refused.
//   - buildCommands: the commands feature sessions may run without asking,
//     each made into a `Bash(<command>:*)` rule; default `npm test`, `npm run`
//     and `node`. Words of letters, digits and `._/@=-`, one space apart.
//   - watcherShape: how the watcher wakes sessions (check 27), default 1.
//   - hotFiles: globs for the files nearly every feature touches (dependency lists, migrations and
//     the project's route files, which the project lists itself). Two plans that each touch a file
//     matching one of them clash, even if they name different files. Default: package.json,
//     package-lock.json, pnpm-lock.yaml, yarn.lock and `**/migrations/**`.
//   - flagFiles: globs for the files where a feature switch is declared, default none.
//
// And the front desk's (front desk plan, Task 12): `pages`, at most MOST_PAGES paths on the
// preview such as `/` and `/pricing`. When every one looks the same at an approved commit and at
// a later one that only brought the branch up to date, the director's approval carries over
// (design section 12.3). List public pages only, never one behind a sign-in: a sign-in screen
// looks the same at every commit. No pages, the default, and an approval never carries over.
import { matchGlob } from './glob.js';
import { AGENT_CONTROL } from '../lib/agent-control.js';
import { isPage } from '../screens/pages.js';
import { AGENTS } from '../agents/names.js';

// The Claude Code settings, the Wheelhouse configuration inside .claude/,
// CLAUDE.md, and .mcp.json (it names the connectors agents get), then every file that steers an
// agent (scripts/lib/agent-control.js), in any project.
export const GUARDRAILS = ['.claude/**', '**/CLAUDE.md', '.mcp.json', ...AGENT_CONTROL];
export const CI_FILES = ['.github/workflows/**', '.github/actions/**', '.gitlab-ci.yml', '.gitlab/**'];

const UNREADABLE = 'The project\'s Wheelhouse configuration can\'t be read';

const isObject = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
const strings = (x) => Array.isArray(x) && x.every((s) => typeof s === 'string');
// A glob with an empty segment (a leading, trailing or doubled `/`) would never match.
const globs = (x) => strings(x) && x.every((s) => s !== '' && s.split('/').every((seg) => seg !== ''));

export const ROLES = Object.freeze(['frontDesk', 'foreman', 'builder', 'reviewer', 'reviewerCritical', 'tester', 'mechanical', 'feature', 'builderCritical']);
// Claude Code's permission modes, less bypass.
export const SESSION_MODES = Object.freeze(['acceptEdits', 'auto', 'default', 'dontAsk', 'plan']);
export const DEFAULT_SESSION_MODE = 'acceptEdits';
export const DEFAULT_BUILD_COMMANDS = Object.freeze(['npm test', 'npm run', 'node']);
export const WATCHER_SHAPES = Object.freeze([1, 2]);
export const DEFAULT_HOT_FILES = Object.freeze(['package.json', 'package-lock.json', 'pnpm-lock.yaml', 'yarn.lock', '**/migrations/**']);

// The most pages the configuration may list: each costs a picture at every size at both commits.
const MOST_PAGES = 20;

const MODEL_NAME = /^[A-Za-z0-9][A-Za-z0-9._:/@[\]-]{0,127}$/;
// Its first word starts with a letter or digit, so it never reads as a flag.
const BUILD_COMMAND = /^[A-Za-z0-9][A-Za-z0-9._/@=-]*( [A-Za-z0-9._/@=-]+)*$/;

export const isModelName = (m) => typeof m === 'string' && MODEL_NAME.test(m);
const modelOk = (m) => m === null || isModelName(m);
export const isBuildCommand = (c) => typeof c === 'string' && c.length <= 200 && BUILD_COMMAND.test(c);

function emptyConfig() {
  return withDefaults({ v: 1, criticalAreas: [], ciFiles: [], mcpServers: [], webDomains: [] });
}

// The build loop's keys, filled in where the configuration leaves them out.
function withDefaults(c) {
  const routing = Object.fromEntries(ROLES.map((role) => [role, null]));
  for (const [role, model] of Object.entries(c.routing ?? {})) Object.defineProperty(routing, role, { value: model, enumerable: true, writable: true, configurable: true });
  return {
    ...c,
    routing,
    sessionMode: c.sessionMode ?? DEFAULT_SESSION_MODE,
    buildCommands: c.buildCommands ?? [...DEFAULT_BUILD_COMMANDS],
    watcherShape: c.watcherShape ?? 1,
    hotFiles: c.hotFiles ?? [...DEFAULT_HOT_FILES],
    flagFiles: c.flagFiles ?? [],
  };
}

// The agent whose column is `routing` itself, so `agentRouting` never holds one for it (review Minor 8).
const COMMAND_LINE_AGENT = 'claude-code';
// One agent's column: an object of roles, each a model or null.
const columnOk = (column) => isObject(column) && Object.entries(column).every(([role, model]) => ROLES.includes(role) && modelOk(model));

const PIN_CLASSES = ['mostCapable', 'midSized', 'premium'];
const tiersOk = (t) => isObject(t) && Object.keys(t).length === 1 && isObject(t.pins)
  && Object.entries(t.pins).every(([name, model]) => PIN_CLASSES.includes(name) && modelOk(model));

function buildLoopOk(c) {
  if (c.tiers !== undefined && !tiersOk(c.tiers)) return false;
  if (c.routing !== undefined && !(isObject(c.routing) && Object.values(c.routing).every(modelOk))) return false;
  if (c.agentRouting !== undefined && !(isObject(c.agentRouting) && Object.entries(c.agentRouting).every(([agent, column]) => AGENTS.includes(agent) && agent !== COMMAND_LINE_AGENT && columnOk(column)))) return false;
  if (c.sessionMode !== undefined && !SESSION_MODES.includes(c.sessionMode)) return false;
  if (c.buildCommands !== undefined && !(Array.isArray(c.buildCommands) && c.buildCommands.every(isBuildCommand))) return false;
  if (c.watcherShape !== undefined && !WATCHER_SHAPES.includes(c.watcherShape)) return false;
  if (c.hotFiles !== undefined && !globs(c.hotFiles)) return false;
  if (c.flagFiles !== undefined && !globs(c.flagFiles)) return false;
  return true;
}

function shapeOk(c) {
  if (!isObject(c) || c.v !== 1) return false;
  if (!Array.isArray(c.criticalAreas) || !c.criticalAreas.every((a) => (
    isObject(a) && typeof a.name === 'string' && globs(a.paths) && globs(a.checks)
  ))) return false;
  if (!globs(c.ciFiles) || !strings(c.mcpServers) || !strings(c.webDomains)) return false;
  if (c.runbook !== undefined) {
    if (!isObject(c.runbook)) return false;
    const contain = c.runbook.contain;
    if (contain !== undefined && !(isObject(contain) && typeof contain.describe === 'string' && contain.describe !== '' && strings(contain.command)
      && contain.command.length > 0 && contain.command[0] !== '')) return false;
  }
  if (c.pages !== undefined && !(Array.isArray(c.pages) && c.pages.length <= MOST_PAGES && c.pages.every(isPage))) return false;
  if (c.signsApps !== undefined && typeof c.signsApps !== 'boolean') return false;
  return buildLoopOk(c);
}

// `null` (no file) is the empty configuration. Anything else must parse and fit
// the shape, or this throws. Either way the build loop's keys are filled in.
export function readConfig(text) {
  if (text === null) return emptyConfig();
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error(UNREADABLE);
  }
  if (!shapeOk(parsed)) throw new Error(UNREADABLE);
  return withDefaults(parsed);
}

// Case is ignored: on macOS and Windows a file named .Claude/settings.json is
// the real one, and a false match only fails closed.
const matchesAny = (patterns, file) => patterns.some((p) => matchGlob(p, file, { ignoreCase: true }));

export function classifyChange({ paths, config }) {
  const patterns = [
    ...GUARDRAILS, ...CI_FILES, ...config.ciFiles, ...config.criticalAreas.flatMap((a) => a.checks),
  ];
  const guardrailPaths = paths.filter((file) => matchesAny(patterns, file));
  const criticalAreas = config.criticalAreas
    .filter((area) => paths.some((file) => matchesAny(area.paths, file)))
    .map((area) => area.name);
  return { touchesGuardrails: guardrailPaths.length > 0, guardrailPaths, criticalAreas };
}
