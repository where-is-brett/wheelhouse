// scripts/engine/feature.js
// A feature on the engine (Archon design, section 7.2). The First Mate's design, once the director approved it, lists
// the feature's slices in a fenced `wheelhouse-slices` block: the goal, the switch the work sits behind, whether the
// director chose a midpoint demo, and each slice's goal and done checks. The feature stays one piece of work. Each
// slice is a run of the slice lane, merged behind the switch, started only once the slice before it has merged; the
// feature's own run then reviews the whole feature, switches it on and waits for the director. Every run is recorded
// under the feature's work, so its spend rolls up there, and Carry on starts the slice that hadn't merged, never one
// that had. Not a model: the dispatcher's runner calls these.
import { workOrder, checkProblem, checkKey, DEFAULT_FLAG_FILE, MOST_SLICES } from './order.js';
import { limitsFor } from './caps.js';
import { SLUG } from '../lib/build-loop.js';

export const SLICES_FENCE = 'wheelhouse-slices';
export const DEMOS = Object.freeze(['midpoint', 'end']);
const FENCE = new RegExp(`^\`\`\`${SLICES_FENCE}[ \\t]*\\r?\\n([\\s\\S]*?)\\r?\\n\`\`\`[ \\t]*$`, 'm');

const isText = (value) => typeof value === 'string' && value.trim() !== '';
const isPlain = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
const texts = (value) => value === undefined || (Array.isArray(value) && value.every(isText));

// readSlices(text) -> { goal, flag, demo, slices: [{ title, goal, done, notInScope, protectedFiles }] }: the slices
// block of an approved design. Throws, in plain words, on a design that has none or one that can't be built from.
export function readSlices(text) {
  const found = FENCE.exec(String(text ?? ''));
  if (!found) throw new Error(`The design has no list of slices (a \`${SLICES_FENCE}\` block)`);
  let value;
  try { value = JSON.parse(found[1]); } catch { throw new Error('The design\'s list of slices can\'t be read: it isn\'t JSON'); }
  if (!isPlain(value)) throw new Error('The design\'s list of slices can\'t be read: it isn\'t a record');
  if (!isText(value.goal)) throw new Error('The design\'s list of slices needs the feature\'s goal');
  const demo = value.demo ?? 'end';
  if (!DEMOS.includes(demo)) throw new Error('The design says midpoint or end for its demo');
  const flag = isPlain(value.flag) ? value.flag : {};
  if (typeof flag.name !== 'string' || !SLUG.test(flag.name)) throw new Error('The design\'s flag needs its name, as a short slug');
  const switchOf = isText(flag.how) ? { name: flag.name, how: flag.how } : { name: flag.name, file: isText(flag.file) ? flag.file : DEFAULT_FLAG_FILE };
  const slices = Array.isArray(value.slices) ? value.slices : [];
  if (slices.length === 0) throw new Error('The design needs at least one slice');
  if (slices.length > MOST_SLICES) throw new Error(`The design has more slices than a feature takes: at most ${MOST_SLICES}`);
  return {
    goal: value.goal,
    flag: switchOf,
    demo,
    slices: slices.map((s, i) => {
      if (!isPlain(s) || !isText(s.title) || !isText(s.goal)) throw new Error(`Slice ${i + 1} needs its title and goal`);
      if (!Array.isArray(s.done) || s.done.length === 0 || s.done.some((c) => checkProblem(c) !== null)) {
        throw new Error(`Slice ${i + 1} needs at least one done check: a test, a command with what it should give, or a page with what must show`);
      }
      if (!texts(s.notInScope) || !texts(s.protectedFiles)) throw new Error(`Slice ${i + 1}'s lists must hold text`);
      return { title: s.title, goal: s.goal, done: s.done.map((c) => ({ ...c })), notInScope: [...(s.notInScope ?? [])], protectedFiles: [...(s.protectedFiles ?? [])] };
    }),
  };
}

// The slice after which the director sees a demo, or null: half way, rounded up, when they chose midpoint demos and
// the feature has two slices or more.
export function demoSlice(design) {
  const count = design?.slices?.length ?? 0;
  return design?.demo === 'midpoint' && count >= 2 ? Math.ceil(count / 2) : null;
}

// progressOf({ runs, orderOf, merged }) -> { slices: { [n]: { runs, pr, head, merged } }, finish: { runs, pr, merged } }
// `runs` are the work's `run` records (the latest of each run's records counts), `orderOf(runId)` the order the
// helper kept for the run, and `merged` the pull requests that merged: a Map of each to its head, or a Set.
export function progressOf({ runs = [], orderOf = () => null, merged = new Map() } = {}) {
  const latest = new Map();
  for (const r of runs) if (isPlain(r?.data) && typeof r.data.runId === 'string') latest.set(r.data.runId, r.data);
  const slices = {};
  const finish = { runs: [], pr: null, merged: false };
  const isMerged = (pr) => Number.isInteger(pr) && merged.has(pr);
  for (const data of latest.values()) {
    const order = orderOf(data.runId);
    const n = order?.slice?.n;
    if (Number.isInteger(n)) {
      const s = (slices[n] ??= { runs: [], pr: null, head: null, merged: false });
      s.runs.push(data);
      if (Number.isInteger(data.pr)) s.pr = data.pr;
      if (isMerged(data.pr)) {
        s.merged = true;
        s.head = merged.get?.(data.pr) ?? null;
      }
    } else if (data.lane === 'feature' || order?.lane === 'feature') {
      finish.runs.push(data);
      if (Number.isInteger(data.pr)) finish.pr = data.pr;
      if (isMerged(data.pr)) finish.merged = true;
    }
  }
  return { slices, finish };
}

// featureProgress({ design, all, now, orderOf, merged }) -> progressOf's shape, each slice with its `branch` too: what
// has merged comes from `all` the work's runs, even those before the work was queued again (the First Mate's Carry
// on), but only for a slice of the same title in the design; what has run comes from `now`, the runs since it was
// queued; `branch` is the latest branch the slice was built on, for carrying it on.
export function featureProgress({ design, all = [], now = [], orderOf = () => null, merged = new Map() } = {}) {
  const titled = (id) => {
    const order = orderOf(id);
    const n = order?.slice?.n;
    return Number.isInteger(n) && design.slices[n - 1]?.title !== order.slice.title ? null : order;
  };
  const ever = progressOf({ runs: all, orderOf: titled, merged });
  const since = progressOf({ runs: now, orderOf: titled, merged });
  const slices = {};
  for (let n = 1; n <= design.slices.length; n += 1) {
    const e = ever.slices[n];
    const s = since.slices[n];
    if (!e && !s) continue;
    const branch = [...(e?.runs ?? [])].reverse().find((r) => typeof r.branch === 'string')?.branch ?? null;
    slices[n] = { runs: s?.runs ?? [], pr: e?.merged ? e.pr : s?.pr ?? null, head: e?.merged ? e.head : null, merged: e?.merged === true, branch };
  }
  return { slices, finish: { ...since.finish, merged: since.finish.merged || ever.finish.merged, pr: ever.finish.merged ? ever.finish.pr : since.finish.pr } };
}

// featureNext({ design, progress, live }) -> { act: 'wait' } | { act: 'start', slice } | { act: 'start', finish: true }
//   | { act: 'done', pr }
// The first slice that hasn't merged starts if it has never run; one that has run waits, for its pull request to
// merge or for the runner's Carry on, never started again from here. Once every slice has merged, the feature's own
// run starts, and once its pull request merges, the feature is done.
export function featureNext({ design, progress, live = false } = {}) {
  if (live) return { act: 'wait' };
  const count = design.slices.length;
  for (let n = 1; n <= count; n += 1) {
    const s = progress.slices?.[n];
    if (s?.merged) continue;
    return s && s.runs.length > 0 ? { act: 'wait' } : { act: 'start', slice: n };
  }
  const finish = progress.finish ?? { runs: [] };
  if (finish.merged) return { act: 'done', pr: finish.pr };
  return finish.runs.length > 0 ? { act: 'wait' } : { act: 'start', finish: true };
}

// The step a carry-on of the feature takes up again: the first slice that hasn't merged, or the feature's own run.
export function currentStep({ design, progress } = {}) {
  for (let n = 1; n <= design.slices.length; n += 1) if (!progress.slices?.[n]?.merged) return { slice: n };
  return { finish: true };
}

// The order for one run of the feature `entry` (the work's view): its goal, checks and lists, and the feature's fields.
function orderOf({ entry, lane, goal, done, notInScope = [], protectedFiles = [], extra, config = {}, settings = {}, raised = false, answers = [], tried = [] }) {
  const data = entry.work.data;
  return workOrder({
    work: { id: data.id ?? entry.work.key, lane, goal, done, visible: data.visible === true, level: data.level, notInScope, protectedFiles },
    config,
    routing: config.routing ?? {},
    caps: limitsFor('slice', settings, { raised }),
    answers,
    extra: { ...extra, ...(tried.length > 0 ? { tried } : {}) },
  });
}

// sliceOrder({ entry, design, n, config, settings, raised, answers, tried }): slice `n`'s order, in the slice lane, behind the
// design's flag. It is shown first only at the midpoint demo.
export function sliceOrder({ entry, design, n, ...rest }) {
  const slice = design.slices[n - 1];
  if (!slice) throw new Error(`The design has no slice ${n}`);
  const demo = demoSlice(design) === n;
  return orderOf({
    entry, lane: 'slice', goal: slice.goal, done: slice.done, notInScope: slice.notInScope, protectedFiles: slice.protectedFiles,
    extra: { slice: { n, of: design.slices.length, title: slice.title }, flag: { ...design.flag }, demo, showFirst: demo },
    ...rest,
  });
}

// finishOrder({ entry, design, progress, config, settings, raised, answers, tried }): the feature's own order, for its
// whole-feature review and switch-on: every slice's done checks once, then `goalDone`, the checks of the sheet that lists
// the feature, the merged slices, and always shown first.
export function finishOrder({ entry, design, progress, goalDone = [], ...rest }) {
  const done = [];
  const seen = new Set();
  for (const check of [...design.slices.flatMap((slice) => slice.done), ...goalDone]) {
    const key = checkKey(check);
    if (!seen.has(key)) {
      seen.add(key);
      done.push(check);
    }
  }
  const slices = design.slices.map((slice, i) => {
    const got = progress.slices?.[i + 1];
    return { n: i + 1, title: slice.title, pr: got?.pr ?? null, head: got?.head ?? null };
  });
  return orderOf({ entry, lane: 'feature', goal: `Switch on: ${design.goal}`, done, extra: { flag: { ...design.flag }, feature: { slices }, showFirst: true }, ...rest });
}

// The most tokens the whole feature may spend: a slice's for each slice, and one more for the feature's own run.
export function featureCap(design, settings = {}, { raised = false } = {}) {
  return (design.slices.length + 1) * limitsFor('slice', settings, { raised }).tokens;
}
