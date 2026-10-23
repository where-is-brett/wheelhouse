// scripts/settings/catalogue.js
// Every setting the director can change: its levels, its default, where it lives and
// whether it can end on its own. Design section 14. The state branch holds the changes
// as `setting` events; this file says which of them are allowed.
import { BRIEFING_GAP_HOURS, UNUSUAL } from '../lib/core-numbers.js';
import { DEFAULT_SOURCES } from '../sources/list.js';
import { LEVELS as BUILD_LEVELS } from '../protection/windows-builds.js';

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const ISO_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/;
const CONCEPT = /^known:[a-z0-9-]{1,40}$/;
const WINDOWS_BUILDS_KEY = /^windowsBuildCommands:[0-9a-f]{8}$/;
const CHANNELS = ['claude', 'ntfy', 'telegram'];

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const wholeBetween = (low, high) => (v) => Number.isInteger(v) && v >= low && v <= high;
const onlyKeys = (obj, allowed) => Object.keys(obj).every((k) => allowed.includes(k));

const checkQuiet = (q) => isObject(q) && onlyKeys(q, ['from', 'to']) && TIME.test(q.from) && TIME.test(q.to);
const checkNotifications = (v) => isObject(v) && onlyKeys(v, ['channels', 'quiet'])
  && Array.isArray(v.channels) && v.channels.every((c) => CHANNELS.includes(c)) && new Set(v.channels).size === v.channels.length
  && (v.quiet === undefined || checkQuiet(v.quiet));
const checkHours = (v) => v === null || (isObject(v) && onlyKeys(v, ['days', 'from', 'to'])
  && Array.isArray(v.days) && v.days.length > 0 && v.days.every(wholeBetween(0, 6)) && new Set(v.days).size === v.days.length
  && TIME.test(v.from) && TIME.test(v.to));
const checkSources = (v) => Array.isArray(v) && v.every((u) => {
  if (typeof u !== 'string' || !u.startsWith('https://')) return false;
  try { return new URL(u).protocol === 'https:'; } catch { return false; }
});

// group: where it shows in the settings list. label: its name there.
export const SETTINGS = {
  // Everyday, kept in the project.
  autonomy: { label: 'Autonomy', group: 'everyday', levels: ['cautious', 'balanced', 'trusting'], default: 'balanced', home: 'project' },
  showFirst: { label: 'Show before building', group: 'everyday', levels: ['always', 'visual', 'asked'], default: 'visual', home: 'project' },
  milestones: { label: 'Feature milestones', group: 'everyday', levels: ['demos', 'to-the-end', 'ask'], default: 'ask', home: 'project' },
  efficiency: { label: 'Thoroughness', group: 'everyday', levels: ['lean', 'balanced', 'thorough'], default: 'balanced', home: 'project' },
  // Only "report" is on offer while budget allocation is in the backlog.
  budget: { label: 'Budget', group: 'everyday', levels: ['report', 'weekly-share', 'per-feature'], only: ['report'], default: 'report', home: 'project' },
  // The build loop's limit of three wins over the main design's two.
  pace: { label: 'Builders at once', group: 'everyday', levels: [1, 2, 3], default: 3, home: 'project' },
  phase: { label: 'Product phase', group: 'everyday', levels: ['before-launch', 'launched'], default: 'before-launch', home: 'project' },
  // Everyday, kept in the director's profile.
  presence: { label: 'Availability', group: 'everyday', levels: ['here', 'away', 'dnd'], default: 'here', home: 'profile', temporary: true },
  briefing: { label: 'Briefing length', group: 'everyday', levels: ['short', 'standard', 'detailed'], default: 'standard', home: 'profile' },
  briefingGapHours: { label: 'Hours before a new briefing', group: 'everyday', check: wholeBetween(1, 24), default: BRIEFING_GAP_HOURS, home: 'profile' },
  explanations: { label: 'Explanations', group: 'everyday', levels: ['plain', 'some-terms'], default: 'plain', home: 'profile' },
  notifications: { label: 'Notifications', group: 'everyday', check: checkNotifications, default: { channels: ['claude'] }, home: 'profile' },
  boardTab: { label: 'Board opens on', group: 'everyday', levels: ['director', 'build'], default: 'director', home: 'profile' },
  hours: { label: 'Working hours', group: 'everyday', check: checkHours, default: null, home: 'profile' },
  // Advanced, kept in the project.
  roundCap: { label: 'Review round cap', group: 'advanced', check: wholeBetween(1, 5), default: 3, home: 'project' },
  // The point where the context gauge says to prepare. The compaction point itself is in the
  // project's Claude Code settings and changes only by a pull request.
  compactPrepare: { label: 'Prepare for compaction at (context size)', group: 'advanced', check: wholeBetween(100000, 290000), default: 200000, home: 'project' },
  delegationReviewDays: { label: 'Days between delegation reviews', group: 'advanced', check: wholeBetween(7, 60), default: 14, home: 'project' },
  unusualFactor: { label: 'Unusual-use factor', group: 'advanced', check: (v) => typeof v === 'number' && Number.isFinite(v) && v >= 2 && v <= 10, default: UNUSUAL.factor, home: 'project' },
  // The addresses of the official pages, checked weekly beside the upstream repositories.
  sources: { label: 'Sources checked weekly', group: 'advanced', check: checkSources, default: DEFAULT_SOURCES.map((source) => source.url), home: 'project' },
};

// One per concept the director already knows (a plain-words glossary switch).
export const KNOWN = { label: 'Concept the director knows', group: 'everyday', check: (v) => typeof v === 'boolean', default: false, home: 'profile' };

// One per computer (`windowsBuildCommands:<computer>`): the level its build commands run at
// on Windows (design section 12.2).
export const WINDOWS_BUILD_COMMANDS = { label: 'Build commands on Windows', group: 'everyday', levels: BUILD_LEVELS, default: 'ask', home: 'project' };

// The person's own GitHub App (setup's step 3, ruling R56): { clientId, slug, owner }, the app the
// narrow GitHub connection signs in to in place of Wheelhouse's, on every computer of theirs; null
// is none. Setup records it, and it counts only once the director confirms it. The client ID is
// public, so no secret is kept here.
export const OWN_GITHUB_APP_KEY = 'own-github-app';
// The shape of a GitHub App's client ID, which setup checks when it reads an app back.
export const OWN_APP_CLIENT_ID = /^Iv[A-Za-z0-9._-]{4,60}$/;
const APP_SLUG = /^[A-Za-z0-9][A-Za-z0-9-]{0,99}$/;
const LOGIN = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;
const checkOwnApp = (v) => v === null || (isObject(v) && onlyKeys(v, ['clientId', 'slug', 'owner'])
  && typeof v.clientId === 'string' && OWN_APP_CLIENT_ID.test(v.clientId)
  && typeof v.slug === 'string' && APP_SLUG.test(v.slug)
  && typeof v.owner === 'string' && LOGIN.test(v.owner));
export const OWN_GITHUB_APP = { label: 'Your own GitHub App', group: 'advanced', check: checkOwnApp, default: null, home: 'profile' };

// The catalogue entry for a key, or undefined when Wheelhouse has no such setting.
export function definitionOf(key) {
  if (typeof key !== 'string') return undefined;
  if (Object.hasOwn(SETTINGS, key)) return SETTINGS[key];
  if (key === OWN_GITHUB_APP_KEY) return OWN_GITHUB_APP;
  if (WINDOWS_BUILDS_KEY.test(key)) return WINDOWS_BUILD_COMMANDS;
  return CONCEPT.test(key) ? KNOWN : undefined;
}

// How a value reads in a refusal.
export function say(value) {
  if (typeof value === 'string') return value;
  const text = JSON.stringify(value);
  return text === undefined ? String(value) : text;
}

function allowed(def, value) {
  if (def.levels && !def.levels.includes(value)) return false;
  if (def.only && !def.only.includes(value)) return false;
  if (def.check) {
    try { return def.check(value) === true; } catch { return false; }
  }
  return true;
}

// Throws, in plain words, when the key or value is not allowed. `until` (an end time) is
// allowed only on a temporary setting.
export function checkSetting(key, value, until) {
  const def = definitionOf(key);
  if (!def) throw new Error(`Wheelhouse has no setting called ${say(key)}`);
  if (!allowed(def, value)) throw new Error(`${key} can't be ${say(value)}`);
  if (until !== undefined && until !== null) {
    if (!def.temporary) throw new Error(`${key} can't have an end time`);
    if (typeof until !== 'string' || !ISO_TIME.test(until) || Number.isNaN(Date.parse(until))) throw new Error(`${key} can't end at ${say(until)}`);
  }
}

// True when checkSetting would accept the value.
export function isAllowed(key, value) {
  const def = definitionOf(key);
  return def !== undefined && allowed(def, value);
}
