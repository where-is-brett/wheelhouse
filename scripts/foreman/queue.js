// scripts/foreman/queue.js
// The foreman's deterministic queue (build-loop design, sections 2, 4 and 8): which files a plan
// touches, whether two plans would clash, and which work may take a building slot now.
import { matchGlob } from '../gate/glob.js';
import { PACE } from '../lib/build-loop.js';

const FILES_LABEL = /^\s*\*\*Files:\*\*\s*$/;
const FILES_LINE = /^\s*[-*]\s+(?:Create|Modify|Test):(.*)$/;
// A trailing `:10-20` or `:3,40-50` after a path.
const LINE_SUFFIX = /:\d+(?:-\d+)?(?:,\d+(?:-\d+)?)*$/;

// The backticked spans on a line that are not inside a parenthetical note, which may name
// identifiers rather than files. Parentheses inside backticks belong to the path.
function pathsOnLine(text) {
  const spans = [];
  let depth = 0;
  let open = -1;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (open >= 0) {
      if (ch === '`') {
        if (depth === 0 && i > open + 1) spans.push(text.slice(open + 1, i));
        open = -1;
      }
    } else if (ch === '`') open = i;
    else if (ch === '(') depth += 1;
    else if (ch === ')' && depth > 0) depth -= 1;
  }
  return spans;
}

// Every backticked path on a Create, Modify or Test line under a task's `**Files:**`, without line
// suffixes, each once, in the order the plan gives them.
export function fileMapOf(planText) {
  const out = [];
  let inFiles = false;
  for (const line of String(planText ?? '').split(/\r?\n/)) {
    if (FILES_LABEL.test(line)) {
      inFiles = true;
      continue;
    }
    if (!inFiles || line.trim() === '') continue;
    const match = FILES_LINE.exec(line);
    if (!match) {
      inFiles = false;
      continue;
    }
    for (const text of pathsOnLine(match[1])) {
      const file = text.trim().replace(LINE_SUFFIX, '').replace(/^\.\//, '');
      if (file !== '' && !out.includes(file)) out.push(file);
    }
  }
  return out;
}

const same = (a, b) => a.toLowerCase() === b.toLowerCase();
const matchesHot = (pattern, file) => matchGlob(pattern, file, { ignoreCase: true });

// A clash is a file in both maps, or a file of each matching the same hot pattern (so two new
// migrations clash). `hot` is true when a hot pattern found it, a shared file included.
export function clashCheck({ files, running, hotFiles }) {
  const clashes = [];
  for (const other of running ?? []) {
    for (const file of files ?? []) {
      const shared = (other.files ?? []).some((f) => same(f, file));
      const hot = (hotFiles ?? []).some((p) => matchesHot(p, file) && (other.files ?? []).some((f) => matchesHot(p, f)));
      if (shared || hot) clashes.push({ work: other.work, file, hot });
    }
  }
  return { ok: clashes.length === 0, clashes };
}

const FEATURE_LANE = 'feature';
// A report with one of these outcomes ends the work; a blocked one leaves it in the queue.
const ENDED = ['merged', 'closed'];

// Which work may take a building slot now. `work`, `features` and `reports` are the state views.
// A slot is held by a feature that is building, or by quick work that has started (it has no plan,
// so it builds at once). `now` is accepted for the interface; the order never reads the clock.
// With `fiveHourTight` nothing starts, and the newest slot-holding feature pauses.
export function nextWork({ work, features, reports, now, fiveHourTight }) {
  const laneOf = (id) => work?.[id]?.work?.data?.lane;
  const stepOf = (id) => features?.[id]?.data?.step;
  const holdsSlot = (id) => stepOf(id) === 'building' || (stepOf(id) === 'started' && laneOf(id) === 'quick');

  const slots = Object.keys(features ?? {}).filter(holdsSlot);
  let building = slots.length;
  let featureLane = slots.filter((id) => laneOf(id) === FEATURE_LANE).length;

  const candidates = Object.values(work ?? {})
    .map((w) => w.work)
    .filter((w) => !holdsSlot(w.key) && stepOf(w.key) !== 'closed' && !ENDED.includes(reports?.[w.key]?.data?.outcome))
    .map((w) => ({ ...w, since: work[w.key].since ?? w.at }))
    .sort((a, b) => {
      const pa = a.data.place;
      const pb = b.data.place;
      const hasA = Number.isFinite(pa);
      const hasB = Number.isFinite(pb);
      if (hasA !== hasB) return hasA ? -1 : 1;
      if (hasA && pa !== pb) return pa - pb;
      return a.since < b.since ? -1 : a.since > b.since ? 1 : a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
    });

  const start = [];
  const hold = [];
  for (const w of candidates) {
    const id = w.key;
    const { lane, visible } = w.data;
    const needsApproval = lane !== 'quick' || visible === true;
    if (needsApproval && work[id].approved !== true) {
      hold.push({ work: id, why: 'unapproved' });
    } else if ((w.data.dependsOn ?? []).some((dep) => reports?.[dep]?.data?.outcome !== 'merged')) {
      hold.push({ work: id, why: 'dependency' });
    } else if (fiveHourTight || building >= PACE.building || (lane === FEATURE_LANE && featureLane >= PACE.featureLane)) {
      hold.push({ work: id, why: 'pace' });
    } else {
      start.push(id);
      building += 1;
      if (lane === FEATURE_LANE) featureLane += 1;
    }
  }

  const pause = [];
  if (fiveHourTight && slots.length > 0) {
    const newest = slots.reduce((a, b) => (features[b].at > features[a].at ? b : a));
    pause.push(newest);
  }
  return { start, hold, pause };
}
