// scripts/settings/effective.js
// The value in force for each setting, and those values in plain words.
import { SETTINGS, definitionOf, isAllowed } from './catalogue.js';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

const instant = (now) => new Date(typeof now === 'function' ? now() : now).getTime();
// An end time that is missing is open-ended; one that can't be read counts as already passed.
const ahead = (until, nowMs) => until === undefined || until === null || Date.parse(until) > nowMs;

// What one view holds for a key at `nowMs`: the latest value if it hasn't ended, else the one
// before it if that hasn't ended either, else nothing.
function held(entry, nowMs) {
  if (!entry || !isAllowed(entry.key, entry.value)) return null;
  if (ahead(entry.until, nowMs)) return { value: entry.value, ...(entry.until === undefined ? {} : { until: entry.until }) };
  const prior = entry.before;
  if (prior && isAllowed(entry.key, prior.value) && ahead(prior.until, nowMs)) {
    return { value: prior.value, ...(prior.until === undefined ? {} : { until: prior.until }) };
  }
  return null;
}

const own = (view, key) => (view && Object.hasOwn(view, key) ? view[key] : undefined);

// project and profile are `settings` views. The project wins over the profile; a value that
// has ended gives way to the one before it, then to the next layer down, then to the default.
export function effectiveSettings({ project = {}, profile = {}, now }) {
  const nowMs = instant(now);
  const keys = Object.keys(SETTINGS);
  const concepts = new Set([...Object.keys(project ?? {}), ...Object.keys(profile ?? {})].filter((k) => !Object.hasOwn(SETTINGS, k) && definitionOf(k)));
  const out = {};
  for (const key of [...keys, ...[...concepts].sort()]) {
    const fromProject = held(own(project, key), nowMs);
    const fromProfile = fromProject ? null : held(own(profile, key), nowMs);
    const found = fromProject ? { ...fromProject, from: 'project' } : fromProfile ? { ...fromProfile, from: 'profile' } : null;
    if (found) out[key] = { value: structuredClone(found.value), from: found.from, ...(found.until === undefined ? {} : { until: found.until }) };
    else if (!concepts.has(key)) out[key] = { value: structuredClone(SETTINGS[key].default), from: 'default' };
    // a concept the director knows appears only when set
  }
  return out;
}

const SOURCE_WORDS = { profile: 'yours', project: 'this project', default: 'the default' };

function two(n) { return String(n).padStart(2, '0'); }

// "18 October 2026, 18:00 UTC"
export function sayTime(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}, ${two(d.getUTCHours())}:${two(d.getUTCMinutes())} UTC`;
}

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function sayValue(key, value) {
  if (key.startsWith('known:')) return value ? 'yes' : 'no';
  if (key === 'notifications') {
    const channels = value.channels.length ? value.channels.join(', ') : 'none';
    return value.quiet ? `${channels}, quiet from ${value.quiet.from} to ${value.quiet.to}` : channels;
  }
  if (key === 'hours') return value === null ? 'no set hours' : `${value.days.map((d) => DAYS[d]).join(', ')}, ${value.from} to ${value.to}`;
  if (key === 'briefingGapHours') return `${value} ${value === 1 ? 'hour' : 'hours'}`;
  if (key === 'delegationReviewDays') return `${value} days`;
  if (key === 'sources') return value.length ? `${value.length} ${value.length === 1 ? 'address' : 'addresses'}` : 'none yet';
  if (typeof value === 'number') return value.toLocaleString('en-AU');
  return String(value);
}

// One line per setting, everyday then advanced: "Presence: away, until 18 October 2026, 18:00 UTC (yours)".
export function settingsText(effective) {
  const lines = [];
  for (const group of ['everyday', 'advanced']) {
    for (const [key, held_] of Object.entries(effective ?? {})) {
      const def = definitionOf(key);
      if (!def || def.group !== group) continue;
      const label = key.startsWith('known:') ? `Knows "${key.slice('known:'.length)}"` : def.label;
      const end = held_.until ? `, until ${sayTime(held_.until)}` : '';
      lines.push(`${label}: ${sayValue(key, held_.value)}${end} (${SOURCE_WORDS[held_.from] ?? held_.from})`);
    }
  }
  return lines.join('\n');
}
