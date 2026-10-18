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
  const confirmations = [];
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
    if (hash === e.data.confirmsHash) {
      confirmed.add(target.id);
      confirmations.push({ target, event: e });
    }
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
      if (!confirmed.has(e.id)) continue;
      const entry = { key: e.data.key, id: e.id, at: e.at, value: e.data.value };
      if (kind === 'setting') {
        // A setting may end on its own (until) and remembers the accepted value it replaced.
        const prior = out[e.data.key];
        if (typeof e.data.until === 'string') entry.until = e.data.until;
        entry.before = prior ? { value: prior.value, ...(prior.until === undefined ? {} : { until: prior.until }) } : null;
      }
      out[e.data.key] = entry;
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

  // An answer names its card by id (data.card) or, as the prompt record writes it, quotes the
  // question shown (data.question): that matches a card's question, or its title when it has none.
  // Two cards asking the same question both close on one answer.
  const answers = sorted.filter((e) => e.kind === 'card-answer');
  const answeredIds = new Set(answers.map((e) => e.data?.card).filter((c) => typeof c === 'string'));
  const answeredQuestions = new Set(answers.filter((e) => e.data?.card === undefined || e.data?.card === null)
    .map((e) => e.data?.question).filter((q) => typeof q === 'string'));
  const questionOf = (card) => (typeof card.data?.question === 'string' ? card.data.question : card.data?.title);
  const answered = (card) => answeredIds.has(card.id) || answeredQuestions.has(questionOf(card));
  const waiting = sorted.filter((e) => e.kind === 'card' && !answered(e))
    .map((e) => ({ id: e.id, at: e.at, data: e.data }));

  const approvals = recordsByPr(sorted, 'approval', enrolled);
  const reviews = recordsByPr(sorted, 'review', enrolled);

  // Launch blockers, shortcuts taken and decisions told.
  const blockers = latestPerKey(sorted.filter((e) => e.kind === 'blocker'), (e) => e.data?.key);
  const risks = latestPerKey(sorted.filter((e) => e.kind === 'risk'), (e) => e.data?.key);
  const decisions = sorted.filter((e) => e.kind === 'decision').reverse().slice(0, 50)
    .map((e) => ({ id: e.id, at: e.at, data: e.data }));

  // Cards shown to the director, from verified records only. A code held by two different
  // questions is ambiguous, so neither is kept. A card is spent once a later verified record
  // carries its question or confirms the one event its confirm line names.
  const shownRecords = sorted.filter((e) => e.kind === 'shown' && verify(e, enrolled)
    && typeof e.data?.code === 'string' && typeof e.data?.question === 'string' && Array.isArray(e.data?.options));
  const questionsByCode = new Map();
  for (const e of shownRecords) {
    const questions = questionsByCode.get(e.data.code) ?? new Set();
    questions.add(e.data.question);
    questionsByCode.set(e.data.code, questions);
  }
  const clashing = [...questionsByCode].filter(([, questions]) => questions.size > 1).map(([code]) => code);
  const answeredBy = sorted.filter((e) => (e.kind === 'approval' || e.kind === 'action') && typeof e.data?.question === 'string' && verify(e, enrolled));
  const spentBy = (shownEvent) => {
    if (answeredBy.some((e) => byOrder(shownEvent, e) < 0 && e.data.question === shownEvent.data.question)) return true;
    const named = /Confirm ([a-z-]+) (\S+): "/.exec(shownEvent.data.question);
    return named !== null && confirmations.some((c) => byOrder(shownEvent, c.event) < 0
      && c.target.id === named[2] && c.target.kind === named[1]);
  };
  const shown = {};
  for (const e of shownRecords) {
    if (clashing.includes(e.data.code)) continue;
    shown[e.data.code] = { id: e.id, at: e.at, question: e.data.question, options: e.data.options, spent: spentBy(e) };
  }
  const clashes = clashing.map((code) => `a shown code held by two different questions: ${code}`);

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
    blockers,
    risks,
    decisions,
    shown,
    damaged: [...damaged, ...repeated, ...clashes],
    status: {
      builtAt: now().toISOString(),
      waitingCount: waiting.length,
      unconfirmedCount: unconfirmed.length,
      lastMerge,
      lastEventAt: sorted.length > 0 ? sorted.at(-1).at : null,
    },
  };
}

// Reads the clone and writes views/*.json beside it, outside the clone. `dir` and `out`
// name another clone of events and its views folder, such as the profile's.
export async function writeViews(project, {
  now = () => new Date(), dir = stateDir(project), out = path.join(wheelhouseHome(), 'projects', project, 'views'),
} = {}) {
  const damaged = [];
  const events = listEvents(dir, { report: () => {}, skipped: damaged });
  const views = buildViews(events, readEnrolled(), { damaged, now });
  // Built whole in a new folder, which then takes the old one's place. The old folder is
  // renamed aside first because Windows will not rename over a folder that has files in it.
  // Between the two renames there is no `views` folder, only `views.old` (a reader that
  // finds `views` missing falls back to it); after them, all of the new views.
  const fresh = `${out}.new`;
  const aside = `${out}.old`;
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.rmSync(fresh, { recursive: true, force: true });
  fs.rmSync(aside, { recursive: true, force: true });
  fs.mkdirSync(fresh);
  try {
    for (const [name, value] of Object.entries(views)) fs.writeFileSync(path.join(fresh, `${name}.json`), `${JSON.stringify(value, null, 2)}\n`);
    const hadOld = fs.existsSync(out);
    if (hadOld) fs.renameSync(out, aside);
    try {
      fs.renameSync(fresh, out);
    } catch (error) {
      if (hadOld) fs.renameSync(aside, out);
      throw error;
    }
  } finally {
    fs.rmSync(fresh, { recursive: true, force: true });
  }
  fs.rmSync(aside, { recursive: true, force: true });
  return views;
}
