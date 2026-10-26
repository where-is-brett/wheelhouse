// scripts/routing/in-force.js
// The Thoroughness column in force for a project now (design section 14.6, "How a running feature picks up a
// change"): the level and the premium mode from the settings, the columns whose evaluation passed on today's pins
// (the `columnsReady` view, readyColumns), and resolveRouting's answer for them. The watcher reads it at each wake,
// the foreman's start for its long session and the foreman's commands at dispatch and merge. Anything that can't be
// read gives Balanced, never more.
import fs from 'node:fs';
import path from 'node:path';
import { readConfig } from '../gate/guardrails.js';
import { stateDir, wheelhouseHome } from '../lib/paths.js';
import { readProject } from '../lib/projects.js';
import { effectiveSettings } from '../settings/effective.js';
import { listEvents } from '../state/events.js';
import { readEnrolled } from '../state/signing.js';
import { buildViews, readyColumns } from '../state/views.js';
import { COLUMNS, EXTRA, levelOf, resolveRouting } from './thoroughness.js';
import { withPremiumPin } from './premium.js';

// The levels ready whatever the state says (the ruling for this plan): Balanced, and Thorough, whose models are
// the ones Balanced already runs on.
export const ALWAYS_READY = Object.freeze(['balanced', 'thorough']);

const isPlain = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);

// Balanced for `config`, as resolveRouting gives it, or, when even that can't be had, Balanced with no models
// named: each session then takes its model from the flat routing table, as before.
export function balancedRouting(config) {
  try {
    return resolveRouting({ config, level: 'balanced' });
  } catch {
    return { level: 'balanced', roles: {}, extra: EXTRA.balanced, lines: [] };
  }
}

// The column in force for `config` and a project's `views` (its `settings`, `columnsReady` and `premium`). How the
// premium model is paid for isn't known yet (check 76), so `billing` is always 'unknown'. The premium mode and pin are
// the state's (the `premium` view: the setting its own card made, and the model the helper's check found for it),
// never the configuration's (scripts/routing/premium.js).
// `resting` (the waker's own) says the premium model rests whatever the state says: the waker keeps its own record of a
// refusal it read, so a rest the helper couldn't take still holds on this computer.
export function routingFrom({ config, views, now = () => new Date(), resting = false }) {
  try {
    const settings = effectiveSettings({ project: isPlain(views?.settings) ? views.settings : {}, now });
    const pinned = withPremiumPin(config, views?.premium);
    return resolveRouting({
      config: pinned,
      level: levelOf(settings),
      ready: [...ALWAYS_READY, ...readyColumns(views?.columnsReady, pinned)],
      premium: typeof views?.premium?.value === 'string' && !isPlain(views.premium.failed) ? views.premium.value : 'off',
      billing: 'unknown',
      resting: resting === true || isPlain(views?.premium?.rest),
    });
  } catch {
    return balancedRouting(config);
  }
}

// The column in force for `project` now, from its local state clone, as the waker reads the settings.
export function routingInForce(project, config, { now = () => new Date(), resting = false } = {}) {
  let views;
  try {
    views = buildViews(listEvents(stateDir(project), { report: () => {} }), readEnrolled());
  } catch {
    return balancedRouting(config);
  }
  return routingFrom({ config, views, now, resting });
}

// The columns ready for `project`, for the settings pane: the `columnsReady` view the last sync left on disk,
// against the pins in the configuration of the project's main folder, with the premium pin the `premium` view holds.
// Anything that can't be read gives none.
export function columnsReadyOf({ project }) {
  try {
    const folder = readProject(project)?.folder;
    if (typeof folder !== 'string' || folder === '') return [];
    const config = readConfig(fs.readFileSync(path.join(folder, '.claude', 'wheelhouse.json'), 'utf8'));
    const base = path.join(wheelhouseHome(), 'projects', project, 'views');
    const dir = fs.existsSync(base) ? base : `${base}.old`;
    const view = JSON.parse(fs.readFileSync(path.join(dir, 'columnsReady.json'), 'utf8'));
    return readyColumns(view, withPremiumPin(config, premiumViewIn(dir)));
  } catch {
    return [];
  }
}

// The `premium` view the last sync left in `dir`, or null when there is none to read.
function premiumViewIn(dir) {
  try {
    return JSON.parse(fs.readFileSync(path.join(dir, 'premium.json'), 'utf8'));
  } catch {
    return null;
  }
}

// The premium view the last sync left on disk for `project`, for the settings pane, or null.
export function premiumViewOf({ project }) {
  try {
    const base = path.join(wheelhouseHome(), 'projects', project, 'views');
    return premiumViewIn(fs.existsSync(base) ? base : `${base}.old`);
  } catch {
    return null;
  }
}

// The subagent roles a feature session dispatches, in the order its brief names them.
export const SUBAGENT_ROLES = Object.freeze(['builder', 'mechanical', 'builderCritical', 'reviewer', 'reviewerCritical', 'tester']);
export const REWORK_LINE = 'When a task is sent back by its review, build it again at effort high.';
export const SECOND_REVIEWER_LINE = 'Critical-area work gets a second fresh reviewer; both must report CLEAN.';
const LEVEL_NAMES = Object.freeze({ lightest: 'Lightest', lean: 'Lean', balanced: 'Balanced', thorough: 'Thorough' });

// The lines a feature wake's prompt carries for the subagents it dispatches (design section 14.6): one per role,
// "<role>: model <name or the session's own>, effort <effort>", then the rework line at Lean and Lightest and the
// second reviewer's at Thorough. A role the routing doesn't name is left out.
export function columnLines(routing) {
  const level = Object.hasOwn(LEVEL_NAMES, routing?.level) ? routing.level : 'balanced';
  const lines = [`The models and efforts for the subagents you dispatch this wake (Thoroughness: ${LEVEL_NAMES[level]}):`];
  for (const role of SUBAGENT_ROLES) {
    const r = routing?.roles?.[role];
    if (!isPlain(r) || typeof r.effort !== 'string') continue;
    lines.push(`${role}: model ${typeof r.model === 'string' && r.model !== '' ? r.model : "the session's own"}, effort ${r.effort}`);
  }
  if (COLUMNS[level].builder.rework === 'high') lines.push(REWORK_LINE);
  if (routing?.extra?.secondReviewer === true) lines.push(SECOND_REVIEWER_LINE);
  return lines;
}

// A role's model, thinking effort and fallback from `routing`, as the adapter's calls take them (null where it names
// none), or nothing when the routing doesn't name the role. The waker's, and the evaluation's for a level's run.
export function roleOf(routing, role) {
  const cell = routing?.roles?.[role];
  return isPlain(cell) ? { model: cell.model ?? null, effort: cell.effort ?? null, fallback: cell.fallback ?? null } : {};
}

// A feature wake's prompt with the column for its subagents after it (columnLines), as the waker gives a session
// whose adapter takes the column, and as the evaluation gives a feature session at a level.
export const promptWithColumn = (prompt, routing) => [prompt, '', ...columnLines(routing)].join('\n');
