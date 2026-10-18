// scripts/state/views.js
import fs from 'node:fs';
import path from 'node:path';
import { wheelhouseHome, stateDir } from '../lib/paths.js';
import { listEvents, eventHash, dataHash, CONFIRMABLE_KINDS } from './events.js';
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

// The build loop's views: work and its approvals, features, questions and incidents.
// Every approval, answer, amendment and lift here is read from a verified action,
// so a plain event of any kind stands in for none of them.
function buildLoopViews(sorted, enrolled) {
  const actions = (name) => sorted.filter((e) => e.kind === 'action' && e.data?.action === name && verify(e, enrolled));
  const mark = (e) => ({ id: e.id, at: e.at, data: e.data });

  const latestWork = {};
  for (const e of sorted) if (e.kind === 'work' && isPlainKey(e.data?.id)) latestWork[e.data.id] = e;
  const amendments = sorted.filter((e) => e.kind === 'amendment');
  const approvals = actions('approve-work');
  // An amend counts when it names a change that was proposed for that work.
  const amends = actions('amend').filter((a) => amendments.some((m) => m.data?.work === a.data?.work && m.data?.hash === a.data?.hash));
  const work = {};
  for (const [id, w] of Object.entries(latestWork)) {
    // Only an approval for the work's current lane counts: a work event that moves the work to another lane asks again.
    const ofWork = approvals.filter((a) => a.data.work === id && a.data.lane === w.data.lane);
    const detail = (a, hash) => ({ hash, shownFirst: a.data.shownFirst, lane: a.data.lane });
    // In time order the document the work names (each work event, each approved change) is the one an
    // approval must name. The director's click on a change approves the changed work as it approved
    // the work before it; a work event that names another document starts again, and one that names
    // the document an approved change already moved to leaves the approval standing.
    let current = null;
    let carried = null;
    const timeline = [...sorted.filter((e) => e.kind === 'work' && e.data?.id === id), ...ofWork, ...amends.filter((a) => a.data.work === id)].sort(byOrder);
    for (const e of timeline) {
      if (e.kind === 'work') {
        current = e.data.doc?.hash ?? null;
        if (carried && carried.hash !== current) carried = null;
      } else if (e.data.action === 'amend') {
        current = e.data.hash;
        if (carried) carried = { ...carried, hash: current };
      } else if (current !== null && e.data.hash === current) {
        carried = detail(e, current);
      }
    }
    let approval = null;
    if (typeof current === 'string' && current !== '') {
      // An approval of the document the work now names counts wherever it falls in time.
      const direct = ofWork.filter((a) => a.data.hash === current).at(-1);
      approval = direct ? detail(direct, current) : carried;
    }
    // `since` is when the work was first recorded: re-recording it (a changed document) keeps its place in the queue.
    const since = sorted.find((e) => e.kind === 'work' && e.data?.id === id).at;
    // The director's wish to see the work before it merges stands once any of their approvals said so,
    // in whatever lane and for whatever document (ruling R120), so a lapsed approval never drops it.
    const shownFirst = approvals.some((a) => a.data.work === id && a.data.shownFirst === true);
    work[id] = {
      work: { key: id, ...mark(w) }, since, approved: approval !== null, ...(approval ? { approval } : {}), ...(shownFirst ? { shownFirst } : {}),
    };
  }

  const features = latestPerKey(sorted.filter((e) => e.kind === 'feature'), (e) => e.data?.work);
  // The latest report for each work: how its feature ended (merged, closed or blocked).
  const reports = latestPerKey(sorted.filter((e) => e.kind === 'report'), (e) => e.data?.work);

  // An answer counts for the question as it was shown: it names the hash of the question's data, and
  // one question recorded again with other words or options needs a fresh answer.
  const questions = {};
  for (const e of sorted) {
    if (e.kind === 'question' && isPlainKey(e.data?.id)) questions[e.data.id] = { question: { key: e.data.id, ...mark(e) }, answer: null };
  }
  for (const a of actions('answer')) {
    const q = questions[a.data.questionId];
    if (!q || typeof a.data.label !== 'string' || a.data.questionHash !== dataHash(q.question.data)) continue;
    if (Array.isArray(q.question.data.options) && q.question.data.options.some((o) => o?.label === a.data.label)) {
      q.answer = { label: a.data.label, at: a.at };
    }
  }

  // An incident is open from its declaration until a verified lift after it.
  const fixes = actions('incident-fix');
  const lifts = actions('lift-incident');
  const open = new Map();
  for (const e of [...sorted.filter((x) => x.kind === 'incident'), ...fixes, ...lifts].sort(byOrder)) {
    if (e.kind === 'incident') {
      if (isPlainKey(e.data?.id) && !open.has(e.data.id)) open.set(e.data.id, { id: e.data.id, what: e.data.what, at: e.at, fixes: [] });
    } else if (e.data.action === 'lift-incident') {
      open.delete(e.data.incident);
    } else {
      const found = open.get(e.data.incident);
      if (found && Number.isInteger(e.data.pr) && !found.fixes.includes(e.data.pr)) found.fixes.push(e.data.pr);
    }
  }
  return { work, features, reports, questions, incidents: { open: [...open.values()] } };
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
    ...buildLoopViews(sorted, enrolled),
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
