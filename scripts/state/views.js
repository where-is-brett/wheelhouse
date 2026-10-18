// scripts/state/views.js
import fs from 'node:fs';
import path from 'node:path';
import { wheelhouseHome, stateDir } from '../lib/paths.js';
import { listEvents, eventHash, CONFIRMABLE_KINDS } from './events.js';
import { verify, readEnrolled } from './signing.js';

const byOrder = (a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
const isPlainKey = (k) => typeof k === 'string' && k !== '';

// The latest event per key, in the sorted order the caller supplies.
function latestPerKey(events, keyOf) {
  const out = {};
  for (const e of events) {
    const key = keyOf(e);
    if (isPlainKey(key)) out[key] = { key, id: e.id, at: e.at, data: e.data };
  }
  return out;
}

// pull request -> commit -> latest verified record
function recordsByPr(events, kind, enrolled) {
  const out = {};
  for (const e of events) {
    if (e.kind !== kind || !verify(e, enrolled)) continue;
    const pr = e.data?.pr;
    const commit = e.data?.commit;
    if (pr === undefined || pr === null || !isPlainKey(String(commit ?? ''))) continue;
    const bucket = (out[String(pr)] ??= {});
    bucket[String(commit)] = e;
  }
  return out;
}

// The latest verified record for a pull request across all its commits, or null.
export function latestFor(viewsMap, pr) {
  const commits = viewsMap?.[String(pr)];
  if (!commits) return null;
  const all = Object.values(commits).sort(byOrder);
  return all.length > 0 ? all[all.length - 1] : null;
}

export function buildViews(events, enrolled, { damaged = [], now = () => new Date() } = {}) {
  // An id carried by more than one event is damage: every copy is left out and listed.
  const counts = new Map();
  for (const e of events) counts.set(e.id, (counts.get(e.id) ?? 0) + 1);
  const repeated = [...events].filter((e) => counts.get(e.id) > 1).sort(byOrder)
    .map((e) => `an event with a repeated id: ${e.id} (${e.kind}, ${e.at})`);
  const sorted = events.filter((e) => counts.get(e.id) === 1).sort(byOrder);

  // A confirmation counts only for a ruling, level or setting whose id it names
  // and whose content hash it names, so it confirms that exact event alone.
  const byId = new Map(sorted.map((e) => [e.id, e]));
  const confirmed = new Set();
  for (const e of sorted) {
    if (e.kind !== 'confirmation' || typeof e.data?.confirms !== 'string' || typeof e.data?.confirmsHash !== 'string') continue;
    const target = byId.get(e.data.confirms);
    if (!target || !CONFIRMABLE_KINDS.includes(target.kind) || !verify(e, enrolled)) continue;
    let hash;
    try {
      hash = eventHash(target);
    } catch {
      continue;
    }
    if (hash === e.data.confirmsHash) confirmed.add(target.id);
  }

  // Rulebook
  const rulings = sorted.filter((e) => e.kind === 'ruling');
  const superseded = new Set();
  for (const r of rulings) {
    const target = rulings.find((x) => x.id === r.data?.supersedes);
    if (confirmed.has(r.id) && target && target.id !== r.id && byOrder(target, r) < 0) superseded.add(target.id);
  }
  const rulebook = rulings.map((r) => ({
    id: r.id,
    at: r.at,
    words: r.data?.words,
    reason: r.data?.reason,
    scope: r.data?.scope,
    status: superseded.has(r.id) ? 'superseded' : confirmed.has(r.id) ? 'accepted' : 'proposed',
  }));

  // Levels and settings: accepted value per key, plus proposals newer than it
  const unconfirmed = rulebook.filter((r) => r.status === 'proposed')
    .map((r) => ({ kind: 'ruling', id: r.id, at: r.at, data: rulings.find((x) => x.id === r.id).data }));
  const accepted = (kind) => {
    const out = {};
    const all = sorted.filter((e) => e.kind === kind && isPlainKey(e.data?.key));
    for (const e of all) {
      if (confirmed.has(e.id)) out[e.data.key] = { key: e.data.key, id: e.id, at: e.at, value: e.data.value };
    }
    for (const e of all) {
      if (confirmed.has(e.id)) continue;
      const kept = out[e.data.key];
      if (!kept || byOrder(kept, e) < 0) unconfirmed.push({ kind, id: e.id, at: e.at, key: e.data.key, data: e.data });
    }
    return out;
  };
  const levels = accepted('level');
  const settings = accepted('setting');
  unconfirmed.sort(byOrder);

  const glossary = latestPerKey(sorted.filter((e) => e.kind === 'glossary'), (e) => e.data?.term);
  const keyOrId = (e) => e.data?.key ?? e.id;
  const ideas = latestPerKey(sorted.filter((e) => e.kind === 'idea'), keyOrId);
  const rejections = latestPerKey(sorted.filter((e) => e.kind === 'rejection'), keyOrId);

  const answered = new Set(sorted.filter((e) => e.kind === 'card-answer').map((e) => e.data?.card));
  const waiting = sorted.filter((e) => e.kind === 'card' && !answered.has(e.id))
    .map((e) => ({ id: e.id, at: e.at, data: e.data }));

  const approvals = recordsByPr(sorted, 'approval', enrolled);
  const reviews = recordsByPr(sorted, 'review', enrolled);

  const merges = sorted.filter((e) => e.kind === 'merge');
  const lastMerge = merges.length > 0 ? { at: merges.at(-1).at, data: merges.at(-1).data } : null;

  return {
    rulebook,
    levels,
    settings,
    glossary,
    ideas,
    rejections,
    waiting,
    approvals,
    reviews,
    unconfirmed,
    damaged: [...damaged, ...repeated],
    status: {
      builtAt: now().toISOString(),
      waitingCount: waiting.length,
      unconfirmedCount: unconfirmed.length,
      lastMerge,
      lastEventAt: sorted.length > 0 ? sorted.at(-1).at : null,
    },
  };
}

// Reads the clone and writes views/*.json beside it, outside the clone.
export async function writeViews(project, { now = () => new Date() } = {}) {
  const dir = stateDir(project);
  const damaged = [];
  const events = listEvents(dir, { report: () => {}, skipped: damaged });
  const views = buildViews(events, readEnrolled(), { damaged, now });
  const out = path.join(wheelhouseHome(), 'projects', project, 'views');
  fs.mkdirSync(out, { recursive: true });
  for (const [name, value] of Object.entries(views)) {
    const target = path.join(out, `${name}.json`);
    const temp = `${target}.tmp`;
    fs.writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`);
    fs.renameSync(temp, target);
  }
  return views;
}
