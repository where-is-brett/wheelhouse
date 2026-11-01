// scripts/engine/routes.js
// The helper's routes for the build engine's runs (Archon design, sections 7.4, 7.5, 9, 11 and 12.4). Each route is
// `(body) => answer`; the helper serves them under /engine/ and /broker/. They know the engine only through the
// engine interface (contract.js) and the project only through what the helper gives them:
//   projects()            [{ project, folder }]: the registered projects
//   engineFor(project)    the project's engine, or null when it isn't on the new engine
//   ordersDir(project)    the folder of the project's work orders, the helper's own
//   write(project, kind, data)   writes a record in the project's history
//   held()                true while All stop is on: nothing starts
//   now()                 a Date
//   filesDir(project)     the folder of the project's engine files, the helper's own
//   digests               { installed(): the installed pack's digest, captured(root): the digest of the pack a run froze }
//   comment(project, { number, id, body })   posts or edits the merge queue's verdict comment, giving { id }
//   host                  { push(project, { dir }) -> { ok, branch } | refusal: pushes the folder's own branch;
//                           open(project, { branch, title, body }) -> { pr, url, head }: opens or updates its pull
//                           request; repo(project) -> 'owner/name', or a project in git alone's name; local(project) -> whether
//                           it is one; previewUrl(project, sha) -> the host's preview of the commit, or null;
//                           repoHost(project) -> the host's name, where it can be read }
//   provenance(project, { branch })   records what built the branch's pull request (the pack's digest and Archon's)
//   previewsDir(project)  where previews are kept, `previews/<work>/<head>/` under the project's engine files
//   incidentOf(project, id)   the open red-main incident of that id, or null
//   changesOf(project, { pr, head })   the pull request's changed files and the project's configuration,
//                         { paths, config }, read by the helper from its own mirror, or null when they can't be read
//   refresh(project)      brings the project's fetch mirror, the engine's only copy of it, up to date: { ok } or a refusal
//   merge(project, { pr, head, incident, runId })   merges the pull request through the helper's own gate as the
//                         incident's fix, giving { ok } or a refusal, with `waiting` while its check hasn't finished
//   checkTook(project, { head, work })   hands a head the helper took in to the project's checks
//   mainCheck(project)    { ok, here, green?, rerun? }: whether the project's checks run on this computer, and if so
//                         whether the main line's latest counted check passed
//   readerViewOf(project, card)   the view of the card a reader is reading, or null
//   briefOf(project)      the project's standing brief in force, as views.brief, or null
// A run is found by its id in the projects' order stores: the only runs these routes serve are ones the helper
// started itself, with an order. Only the helper starts a run (the dispatcher, through `start`, never a route), and
// every route asks for the run's ticket (ticket.js), which only that run's steps can read.
import fs from 'node:fs';
import path from 'node:path';
import { checkOrder, orderStore, isRunId } from './order.js';
import { MOST_TOUCHED, pictureName } from './preview-names.js';
import { SCREEN_SIZES } from '../lib/front-desk.js';
import { newTicket, ticketHash, ticketMatches, writeTicket } from './ticket.js';
import { FIX_LANE, weakensChecks } from './fix-main.js';
import { readReproduction, sameReproduction } from './reproduction.js';
import { reviewHolds } from './review-round.js';
import { READER_LANE, READER_WORK } from '../delegation/reader.js';
import { briefLines } from '../delegation/brief.js';

const NO_ORDER = 'there is no work order for that run';
const NO_TICKET = 'the call didn\'t carry the run\'s own ticket';

// The pack's review steps (engine/archon/pack/wheelhouse-quick.yaml, and the whole-feature lens of a feature's own run,
// wheelhouse-feature.yaml), and the severities that hold work back.
export const FEATURE_REVIEW = 'review-feature';
export const REVIEW_STEPS = Object.freeze(['review-standards', 'review-spec', 'review-security', 'review-design', FEATURE_REVIEW]);
const HOLDS = new Set(['BLOCKER', 'HIGH']);
const SEVERITIES = new Set(['BLOCKER', 'HIGH', 'MEDIUM', 'LOW']);
const FULL_SHA = /^[0-9a-f]{40}$/;
const MOST_PREVIEW_BYTES = 20 * 1024 * 1024;
const PAGE = /^\/[^\s\\]*$/;

// A plain file's bytes, read without following a link (where the system can say so), or null.
function readPlain(file) {
  let fd;
  try {
    fd = fs.openSync(file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0));
    const found = fs.fstatSync(fd);
    if (!found.isFile() || found.size > MOST_PREVIEW_BYTES || !fs.lstatSync(file).isFile()) return null;
    return fs.readFileSync(fd);
  } catch {
    return null;
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
}
// The longest lesson kept: one or two sentences, as the lesson prompt asks.
const MOST_LESSON = 600;

// The merge queue's verdict comment for `head`, in the form the pinned release's gate reads (check 76).
export function verdictBody({ head, steps }) {
  return [
    '<!-- archon-review-report -->',
    `Reviewed commit: \`${head}\``,
    'Verdict: ready',
    'Contract: complete',
    '',
    `Wheelhouse signed a CLEAN review of this commit from each lens that ran: ${steps.join(', ')}.`,
  ].join('\n');
}

const parsed = (text) => { try { return JSON.parse(text); } catch { return null; } };

// The one lane whose tasks are each reviewed (wheelhouse-slice-task.yaml), and the key of a slice's plan: a run carried
// on works the same plan, and a slice's tasks are numbered afresh.
const SLICE_LANE = 'slice';
const planOf = (order) => `${order.work}#${order.slice?.n ?? 0}`;

// A review step's output as { verdict, findings, blocked }, or null when it isn't one.
function readReview(text) {
  const output = parsed(text);
  if (!output || !['CLEAN', 'FINDINGS'].includes(output.verdict) || !Array.isArray(output.findings)) return null;
  if (!output.findings.every((f) => f && SEVERITIES.has(f.severity))) return null;
  return { verdict: output.verdict, findings: output.findings, blocked: output.blocked === true };
}
const isClean = (found) => found.verdict === 'CLEAN' && !found.blocked && !found.findings.some((f) => HOLDS.has(f.severity));

// The pull request the run opened ({ pr, head }), from its open-pr step's output, or null.
function readOpened(text) {
  const output = parsed(text);
  return output && Number.isInteger(output.pr) && output.pr > 0 && FULL_SHA.test(output.head ?? '') ? { pr: output.pr, head: output.head } : null;
}

export function engineRoutes({
  projects, engineFor, ordersDir, write, held = () => false, moving = () => false, now = () => new Date(),
  filesDir = (project) => path.join(ordersDir(project), '..'), digests = { installed: () => null, captured: () => null }, comment,
  projectAgents = async () => null, recheckCopies = async () => ({ ok: true }),
  checkTook = null, mainCheck = null,
  host, provenance, previewsDir = (project) => path.join(filesDir(project), 'previews'),
  incidentOf = () => null, changesOf = async () => null, merge = async () => ({ ok: false, refused: 'the helper can\'t merge here' }),
  refresh = async () => ({ ok: true }), readerViewOf = () => null, briefOf = () => null,
} = {}) {
  const storeOf = (project) => orderStore(ordersDir(project));

  // The project and order of a run the helper started, or null.
  function runOf(runId) {
    if (!isRunId(runId)) return null;
    for (const { project, folder } of projects()) {
      const order = storeOf(project).load(runId);
      if (order) return { project, folder, order };
    }
    return null;
  }

  // The hash of a run's ticket, kept beside its order.
  const ticketFile = (project, runId) => path.join(ordersDir(project), `${runId}.ticket`);

  // Where a run starts on an agent whose steps read Wheelhouse's own skill copies, the project's hold is re-checked
  // against those copies, so it lifts by itself once they match. Only when the default branch's configuration and the
  // main checkout's both name that agent (ruling P8-33): otherwise the hold stands as it is, and the kits decide it.
  // Gives why the run can't start, or null.
  async function recheckHold(project, folder, engine, bindings) {
    const agent = engine.stepAgent?.(bindings) ?? null;
    if (agent === null) return null;
    let agents = null;
    try { agents = await projectAgents(project, folder); } catch { /* the hold stands */ }
    if (agents?.branch !== agent || agents?.checkout !== agent) return null;
    const result = await recheckCopies(project, folder);
    return result?.ok === true ? null : "Wheelhouse's own skill copies differ from its manifest, so the project is held and no run started";
  }

  // Starts a run of `order` for `project` and keeps its order under the run's id; writes the run's ticket into the
  // run's artefacts folder and keeps its hash; writes the run's start in the project's record, which is how the
  // continuation host knows the run is the project's. The helper's own: no route reaches it.
  async function start({ project, order, branch, carryOn } = {}) {
    if (held()) return { ok: false, refused: 'All stop is on, so no run starts' };
    if (moving(project)) return { ok: false, refused: 'This project is moving to a host, so no run starts until it has' };
    const found = projects().find((p) => p.project === project);
    if (!found) return { ok: false, refused: 'that project isn\'t registered on this computer' };
    const engine = engineFor(project);
    if (!engine) return { ok: false, refused: 'that project doesn\'t use the build engine' };
    if (typeof engine.artefactsOf !== 'function') return { ok: false, refused: 'that project\'s engine gives a run no artefacts folder, so its steps can\'t be given their ticket' };
    const problem = checkOrder(order);
    if (problem) return { ok: false, refused: problem };
    // The engine reads the project only from the fetch mirror, so a run starts from the host's latest.
    let fresh;
    try { fresh = await refresh(project); } catch (error) { fresh = { ok: false, refused: error instanceof Error ? error.message : null }; }
    if (fresh?.ok !== true) return { ok: false, refused: `the engine's copy of the project couldn't be brought up to date${fresh?.refused ? ` (${fresh.refused})` : ''}, so no run started` };
    const stands = await recheckHold(project, found.folder, engine, order.bindings);
    if (stands) return { ok: false, refused: stands };
    const started = await engine.start({ work: order.work, lane: order.lane, branch, carryOn: carryOn === true, project: found.folder, bindings: order.bindings });
    if (!started?.ok) return { ok: false, refused: started?.refused ?? 'the engine didn\'t start the run', ...(started?.uncertain === true ? { uncertain: true } : {}) };
    storeOf(project).save(started.runId, order);
    const artefacts = engine.artefactsOf(started.runId, host?.repo?.(project));
    const ticket = newTicket();
    try {
      if (!artefacts) throw new Error('no artefacts folder');
      fs.writeFileSync(ticketFile(project, started.runId), `${ticketHash(ticket)}\n`, { flag: 'wx', mode: 0o600 });
      writeTicket(artefacts, ticket);
    } catch {
      const stopped = await Promise.resolve().then(() => engine.act(started.runId, { cancel: { reason: 'the run\'s ticket couldn\'t be written' } })).catch(() => null);
      // A run that wasn't stopped may still be going, so whoever started it must look before starting another.
      return stopped?.ok === true ? { ok: false, refused: 'the run\'s ticket couldn\'t be written, so it was stopped' } : { ok: false, refused: 'the run\'s ticket couldn\'t be written, and it couldn\'t be stopped', uncertain: true };
    }
    if (order.lane === SLICE_LANE) {
      const verdicts = readVerdicts(project);
      verdicts.taskReviews[planOf(order)] = [...(verdicts.taskReviews[planOf(order)] ?? []), { runId: started.runId, tasks: null }];
      keepVerdicts(project, verdicts);
    }
    const runBranch = started.branch ?? branch;
    await write(project, 'run', { work: order.work, lane: order.lane, engine: engine.name ?? 'engine', runId: started.runId, state: 'started', ...(runBranch ? { branch: runBranch } : {}) });
    return { ok: true, runId: started.runId };
  }

  // Starts a reader of `card` in its own folder. It has no work order to read, so `start` would refuse it: this saves a
  // stand-in order, which places the run, and writes its ticket as `start` does. It writes no `run` record: a reader's run
  // is no piece's. Nothing is fetched: its view was built when the card was sealed.
  async function startReader({ project, card, folder, bindings } = {}) {
    if (held()) return { ok: false, refused: 'All stop is on, so no run starts' };
    const engine = engineFor(project);
    if (typeof engine?.artefactsOf !== 'function') return { ok: false, refused: 'that project\'s engine gives a run no artefacts folder, so its steps can\'t be given their ticket' };
    const started = await engine.start({ work: READER_WORK, lane: READER_LANE, card, project: folder, bindings });
    if (!started?.ok) return { ok: false, refused: started?.refused ?? 'the engine didn\'t start the reader' };
    const ticket = newTicket();
    try {
      storeOf(project).save(started.runId, { v: 1, work: READER_WORK, lane: READER_LANE, card });
      const artefacts = engine.artefactsOf(started.runId, host?.repo?.(project), { folder });
      if (!artefacts) throw new Error('no artefacts folder');
      fs.writeFileSync(ticketFile(project, started.runId), `${ticketHash(ticket)}\n`, { flag: 'wx', mode: 0o600 });
      writeTicket(artefacts, ticket);
    } catch {
      await engine.act(started.runId, { cancel: { reason: 'the run\'s ticket couldn\'t be written' } });
      return { ok: false, refused: 'the run\'s ticket couldn\'t be written, so it was stopped' };
    }
    return { ok: true, runId: started.runId };
  }

  // The verdicts kept for a project: { runs: { [runId]: { head, signed: { [step]: verdict } } }, comments: { [pr]: id },
  // ready: { [pr]: { head, runId, showFirst, work } }, lessons: { [runId]: at },
  // opened: { [pr]: { runId, head, showFirst, work, level, lane, incident? } }, previews: { [runId]: head },
  // fixed: { [runId]: { pr, head, at } }, reproduced: { [work]: { check, files, commit, runId, at } },
  // taskReviews: { [plan]: [{ runId, tasks: { [task]: held } | null }] }, a slice's runs in the order they started }.
  const verdictsFile = (project) => path.join(filesDir(project), 'verdicts.json');
  function readVerdicts(project) {
    const kept = parsed(fs.existsSync(verdictsFile(project)) ? fs.readFileSync(verdictsFile(project), 'utf8') : 'null');
    return kept && typeof kept === 'object'
      ? { runs: kept.runs ?? {}, comments: kept.comments ?? {}, ready: kept.ready ?? {}, lessons: kept.lessons ?? {}, opened: kept.opened ?? {}, previews: kept.previews ?? {}, fixed: kept.fixed ?? {}, reproduced: kept.reproduced ?? {}, taskReviews: kept.taskReviews ?? {} }
      : { runs: {}, comments: {}, ready: {}, lessons: {}, opened: {}, previews: {}, fixed: {}, reproduced: {}, taskReviews: {} };
  }
  function keepVerdicts(project, verdicts) {
    fs.mkdirSync(filesDir(project), { recursive: true, mode: 0o700 });
    fs.writeFileSync(verdictsFile(project), `${JSON.stringify(verdicts, null, 2)}\n`, { mode: 0o600 });
  }

  // Signs the review `step` of `runId` from the engine's own record (Archon design, section 7.5), never from a file an
  // agent could write; once every lens that ran is signed CLEAN for the head, posts the merge queue's verdict comment.
  async function review({ runId, step } = {}) {
    const run = runOf(runId);
    if (!run) return { ok: false, refused: NO_ORDER };
    if (!REVIEW_STEPS.includes(step)) return { ok: false, refused: 'that step isn\'t one of the pack\'s review steps' };
    const engine = engineFor(run.project);
    if (typeof engine?.outputs !== 'function') return { ok: false, refused: 'that project\'s engine keeps no step outputs to sign from' };
    const record = await engine.inspect(runId);
    const installed = digests.installed();
    if (!installed || !record?.source || digests.captured(record.source) !== installed) {
      return { ok: false, refused: 'the run\'s pack isn\'t the installed pack, so its reviews aren\'t trusted' };
    }
    const outputs = await engine.outputs(runId);
    if (outputs[step] === undefined) return { ok: true, ran: false };
    const found = readReview(outputs[step]);
    if (!found) return { ok: false, refused: 'that review step\'s output isn\'t a review' };
    const opened = readOpened(outputs['open-pr']);
    if (!opened) return { ok: false, refused: 'the run hasn\'t opened its pull request yet' };
    // The reviews read the commit the lenses step recorded before them; a commit made after them is no one's review.
    const read = parsed(outputs.lenses);
    if (!FULL_SHA.test(read?.head ?? '') || read.clean !== true) return { ok: false, refused: 'the run didn\'t record the commit its reviews read, with nothing beside it' };
    if (read.head !== opened.head) return { ok: false, refused: `the reviews read ${read.head.slice(0, 7)}, not the pull request's head ${opened.head.slice(0, 7)}` };
    const verdict = isClean(found) ? 'CLEAN' : 'FINDINGS';
    await write(run.project, 'review', { pr: opened.pr, commit: opened.head, verdict, findings: found.findings.length, engine: 'archon', runId, step, digest: installed });

    const verdicts = readVerdicts(run.project);
    const kept = verdicts.runs[runId]?.head === opened.head ? verdicts.runs[runId] : { head: opened.head, signed: {} };
    kept.signed[step] = verdict;
    verdicts.runs[runId] = kept;
    const ran = REVIEW_STEPS.filter((s) => outputs[s] !== undefined);
    const ready = ran.every((s) => kept.signed[s] === 'CLEAN');
    let posted = false;
    if (ready && typeof comment === 'function') {
      const got = await comment(run.project, { number: opened.pr, id: verdicts.comments[opened.pr], body: verdictBody({ head: opened.head, steps: ran }) });
      verdicts.comments[opened.pr] = got.id;
      posted = true;
    }
    keepVerdicts(run.project, verdicts);
    // What holds the work, for the card a held review raises: each BLOCKER or HIGH, without its fix.
    const holding = found.findings.filter((f) => HOLDS.has(f.severity)).map(({ severity, file, line, repro }) => ({ severity, file, line, repro }));
    return { ok: true, ran: true, verdict, posted, ...(verdict === 'FINDINGS' ? { held: holding } : {}) };
  }

  // What a slice run's task reviews last said, { [task]: held }, from the engine's own record, never from anything a
  // step hands in, kept in the helper's record: the run's records die with a run cancelled before its close. A review
  // that took the blocked exit says nothing either way. False when the engine can't say.
  async function keepReviews(project, runId, order) {
    const engine = engineFor(project);
    let reviews = null;
    try { reviews = await engine?.taskReviews?.(runId); } catch { reviews = null; }
    if (!reviews) return false;
    const said = Object.entries(reviews).filter(([, text]) => parsed(text)?.blocked !== true).map(([task, text]) => [task, reviewHolds(text)]);
    const verdicts = readVerdicts(project);
    const runs = (verdicts.taskReviews[planOf(order)] ??= []);
    const entry = runs.find((r) => r.runId === runId) ?? runs[runs.push({ runId }) - 1];
    entry.tasks = Object.fromEntries(said);
    keepVerdicts(project, verdicts);
    return true;
  }

  // The tasks of the run's slice whose latest review, across every run of that slice, holds. Nothing clears a hold but
  // a later review: a task sent back and built again is reviewed again, so no step can answer one by saying so. The
  // run's own reviews are read afresh; a run before it that wasn't kept when it ended is read now, and one that can't be
  // is refused, so the close never reads it as clear.
  async function taskHolds({ runId } = {}) {
    const run = runOf(runId);
    if (!run) return { ok: false, refused: NO_ORDER };
    if (run.order.lane !== SLICE_LANE) return { ok: true, tasks: [] };
    const plan = planOf(run.order);
    const unread = (readVerdicts(run.project).taskReviews[plan] ?? []).filter((r) => r.runId !== runId && r.tasks === null).map((r) => r.runId);
    for (const id of [...unread, runId]) {
      if (!(await keepReviews(run.project, id, run.order))) return { ok: false, refused: `the task reviews of run ${id} couldn't be read` };
    }
    const latest = {};
    for (const { tasks } of readVerdicts(run.project).taskReviews[plan] ?? []) Object.assign(latest, tasks);
    return { ok: true, tasks: Object.keys(latest).filter((task) => latest[task] === true) };
  }

  // The pack's pull-request step: pushes the run's worktree's own branch from the helper's side and opens (or updates)
  // its pull request with the text the step wrote, recording first what built it. Gives { branch, pr, head }.
  async function openPr({ runId, cwd, title, body } = {}) {
    const run = runOf(runId);
    if (!run) return { ok: false, refused: NO_ORDER };
    if (held()) return { ok: false, refused: 'All stop is on, so nothing is pushed' };
    if (!host) return { ok: false, refused: 'the helper can\'t reach the project\'s host' };
    if (typeof title !== 'string' || title.trim() === '' || typeof body !== 'string') return { ok: false, refused: 'the pull request needs its title and body' };
    const pushed = await host.push(run.project, { dir: cwd });
    if (!pushed?.ok) return { ok: false, refused: pushed?.refused ?? 'the branch wasn\'t pushed' };
    await provenance(run.project, { branch: pushed.branch });
    const opened = await host.open(run.project, { branch: pushed.branch, title: title.trim().split('\n')[0], body });
    // The pull request is the run's from here: the broker's permit reads whether its work is shown first from this.
    const verdicts = readVerdicts(run.project);
    verdicts.opened[opened.pr] = {
      runId, head: opened.head, showFirst: run.order.showFirst === true, work: run.order.work, level: run.order.level ?? null, lane: run.order.lane,
      ...(typeof run.order.incident === 'string' ? { incident: run.order.incident } : {}),
    };
    keepVerdicts(run.project, verdicts);
    // The next tick finds the head if this doesn't reach the checks.
    try { await checkTook?.(run.project, { head: opened.head, work: run.order.work }); } catch { /* found on the next tick */ }
    return { ok: true, branch: pushed.branch, pr: opened.pr, head: opened.head };
  }

  // The pack's mark-ready step: hands the pull request to the engine's merge queue once every lens that ran is signed
  // CLEAN for its head, and, for work shown first, the director approved it. The broker's permit still checks both.
  async function ready({ runId } = {}) {
    const run = runOf(runId);
    if (!run) return { ok: false, refused: NO_ORDER };
    if (held()) return { ok: false, refused: 'All stop is on, so nothing is marked ready' };
    const engine = engineFor(run.project);
    if (typeof engine?.handOver !== 'function') return { ok: false, refused: 'that project\'s engine has no merge queue to hand the work to' };
    const outputs = await engine.outputs(runId);
    const opened = readOpened(outputs['open-pr']);
    if (!opened) return { ok: false, refused: 'the run hasn\'t opened its pull request yet' };
    const verdicts = readVerdicts(run.project);
    const kept = verdicts.runs[runId];
    const ran = REVIEW_STEPS.filter((s) => outputs[s] !== undefined);
    if (kept?.head !== opened.head || ran.length === 0 || !ran.every((s) => kept.signed[s] === 'CLEAN')) {
      return { ok: false, refused: `there is no signed CLEAN review of ${opened.head.slice(0, 7)} from every lens that ran` };
    }
    if (run.order.showFirst === true && parsed(outputs.approval)?.decision !== 'approve') {
      return { ok: false, refused: 'this work is shown first, and the director hasn\'t approved it' };
    }
    const repo = host?.repo(run.project);
    // A project in git alone has no merge queue of Archon's to take it: the local queue reads what is ready below.
    const handed = host?.local?.(run.project) === true ? { ok: true } : await engine.handOver({ project: run.folder, repo, pr: opened.pr, url: `https://${host?.repoHost?.(run.project) ?? 'github.com'}/${repo}/pull/${opened.pr}`, runId, at: now().toISOString() });
    if (!handed?.ok) return { ok: false, refused: handed?.refused ?? 'the engine didn\'t take the work' };
    verdicts.ready = { ...(verdicts.ready ?? {}), [opened.pr]: { head: opened.head, runId, showFirst: run.order.showFirst === true, work: run.order.work } };
    keepVerdicts(run.project, verdicts);
    return { ok: true, pr: opened.pr, head: opened.head };
  }

  // The fix-main lane's merge step (section 7.7): Archon's merge queue holds every merge while the main line is red, so
  // the fix is added through the helper's own gate, as the open red-main incident's fix. Only for a fix-main run's own
  // pull request, at the head it opened, for the incident its order names while that incident is open; every lens
  // that ran signed CLEAN for that head; nothing in it that would make the checks pass by asking less of them; once.
  async function mergeFix({ runId } = {}) {
    const run = runOf(runId);
    if (!run) return { ok: false, refused: NO_ORDER };
    if (held()) return { ok: false, refused: 'All stop is on, so nothing is added' };
    if (run.order.lane !== FIX_LANE || typeof run.order.incident !== 'string') return { ok: false, refused: 'this run isn\'t a fix for a red main line' };
    const verdicts = readVerdicts(run.project);
    if (verdicts.fixed[runId]) return { ok: false, refused: `this run's fix was already added (pull request #${verdicts.fixed[runId].pr})` };
    if (!incidentOf(run.project, run.order.incident)) return { ok: false, refused: `the incident ${run.order.incident} isn't open, so there is no red main line to fix` };
    const engine = engineFor(run.project);
    const outputs = typeof engine?.outputs === 'function' ? await engine.outputs(runId) : {};
    const opened = readOpened(outputs['open-pr']);
    const own = opened ? verdicts.opened[opened.pr] : null;
    if (!opened || own?.runId !== runId || own.head !== opened.head) return { ok: false, refused: 'the run hasn\'t opened its pull request yet' };
    const kept = verdicts.runs[runId];
    const ran = REVIEW_STEPS.filter((s) => outputs[s] !== undefined);
    if (kept?.head !== opened.head || ran.length === 0 || !ran.every((s) => kept.signed[s] === 'CLEAN')) {
      return { ok: false, refused: `there is no signed CLEAN review of ${opened.head.slice(0, 7)} from every lens that ran` };
    }
    let changes = null;
    try { changes = await changesOf(run.project, { pr: opened.pr, head: opened.head }); } catch { changes = null; }
    if (!changes || !Array.isArray(changes.paths) || !changes.config) return { ok: false, refused: 'the fix\'s changes couldn\'t be read, so it can\'t be shown to keep the checks' };
    const weakens = weakensChecks({ paths: changes.paths, config: changes.config, tests: parsed(outputs.tests) });
    if (weakens.length > 0) return { ok: false, refused: `the fix isn't added: ${weakens.join('; ')}`, weakens };
    const got = await merge(run.project, { pr: opened.pr, head: opened.head, incident: run.order.incident, runId });
    if (!got?.ok) return { ok: false, refused: got?.refused ?? 'the helper\'s gate didn\'t add the fix', ...(got?.waiting === true ? { waiting: true } : {}) };
    const after = readVerdicts(run.project);
    after.fixed[runId] = { pr: opened.pr, head: opened.head, at: now().toISOString() };
    keepVerdicts(run.project, after);
    await write(run.project, 'note', { about: 'engine', words: `The fix for the red main line, pull request #${opened.pr}, was added; work waits until the main line's checks are green.` });
    return { ok: true, pr: opened.pr, head: opened.head };
  }

  // The preview step's first ask: whether the run's work is visible, its pages, and the host's preview of the head the
  // run opened (null when there is none, or the host can't say).
  async function previewFind({ runId } = {}) {
    const run = runOf(runId);
    if (!run) return { ok: false, refused: NO_ORDER };
    const engine = engineFor(run.project);
    const opened = readOpened(typeof engine?.outputs === 'function' ? (await engine.outputs(runId))['open-pr'] : undefined);
    if (!opened) return { ok: false, refused: 'the run hasn\'t opened its pull request yet' };
    const visible = run.order.preview !== null && run.order.preview !== undefined;
    if (!visible) return { ok: true, visible: false, pages: [], url: null, pr: opened.pr, head: opened.head };
    let url = null;
    try { url = (await host?.previewUrl?.(run.project, opened.head)) ?? null; } catch { url = null; }
    return { ok: true, visible: true, pages: [...run.order.preview.pages], url, pr: opened.pr, head: opened.head };
  }

  // Keeps the run's preview: copies the pictures and notes from the run's own artefacts folder, which the helper finds
  // from the run's id (never a folder the step names), into `previews/<work>/<head>/`, so they outlive the engine's
  // clean-up and can't be planted from another run. Only pictures the step says it took are copied, and only under the
  // names it gives the run's own pages (the order's, and at most five the change touches) at its two sizes; each is
  // read without following a link. A run's preview of one head is kept once.
  async function preview({ runId } = {}) {
    const run = runOf(runId);
    if (!run) return { ok: false, refused: NO_ORDER };
    const engine = engineFor(run.project);
    if (typeof engine?.artefactsOf !== 'function' || typeof engine?.outputs !== 'function') return { ok: false, refused: 'that project\'s engine keeps no artefacts' };
    const opened = readOpened((await engine.outputs(runId))['open-pr']);
    if (!opened) return { ok: false, refused: 'the run hasn\'t opened its pull request yet' };
    const verdicts = readVerdicts(run.project);
    if (verdicts.previews[runId] === opened.head) return { ok: false, refused: 'this run\'s preview of that head is already kept' };
    const artefacts = engine.artefactsOf(runId, host?.repo(run.project));
    const from = artefacts ? path.join(artefacts, 'preview') : null;
    let real = null;
    try { real = from && fs.lstatSync(from).isDirectory() && fs.realpathSync(from) === path.join(fs.realpathSync(artefacts), 'preview') ? from : null; } catch { real = null; }
    if (!real) return { ok: false, refused: 'the run made no preview' };
    const notesBytes = readPlain(path.join(from, 'notes.json'));
    const notes = notesBytes ? parsed(notesBytes.toString('utf8')) : null;
    const listed = Array.isArray(notes?.pages) ? notes.pages.filter((p) => typeof p === 'string' && PAGE.test(p)) : [];
    const own = [...(run.order.preview?.pages ?? [])];
    const pages = [...own, ...listed.filter((p) => !own.includes(p)).slice(0, MOST_TOUCHED)];
    const taken = new Set(Array.isArray(notes?.taken) ? notes.taken : []);
    const names = pages.flatMap((page) => SCREEN_SIZES.map((size) => pictureName(page, size))).filter((name) => taken.has(name));
    const to = path.join(previewsDir(run.project), run.order.work, opened.head);
    fs.mkdirSync(to, { recursive: true, mode: 0o700 });
    let pictures = 0;
    for (const name of [...new Set(names)]) {
      const bytes = readPlain(path.join(from, name));
      if (!bytes) continue;
      fs.writeFileSync(path.join(to, name), bytes, { mode: 0o600 });
      pictures += 1;
    }
    if (notesBytes) fs.writeFileSync(path.join(to, 'notes.json'), notesBytes, { mode: 0o600 });
    verdicts.previews[runId] = opened.head;
    keepVerdicts(run.project, verdicts);
    await write(run.project, 'preview', { work: run.order.work, head: opened.head, folder: to, pages: pictures > 0 ? pages : [] });
    return { ok: true, folder: to, pictures };
  }

  // The pack's lesson step: writes the lesson the run's lesson step gave, read from the engine's own record, as one
  // `lesson` event. At most one a run, and none when the lesson is empty, which is the usual answer.
  async function lesson({ runId } = {}) {
    const run = runOf(runId);
    if (!run) return { ok: false, refused: NO_ORDER };
    const engine = engineFor(run.project);
    if (typeof engine?.outputs !== 'function') return { ok: false, refused: 'that project\'s engine keeps no step outputs' };
    const verdicts = readVerdicts(run.project);
    if (verdicts.lessons[runId]) return { ok: true, written: false };
    const given = parsed((await engine.outputs(runId)).lesson);
    const text = typeof given?.lesson === 'string' ? given.lesson.trim() : '';
    if (given?.blocked === true || text === '') return { ok: true, written: false };
    verdicts.lessons[runId] = now().toISOString();
    keepVerdicts(run.project, verdicts);
    await write(run.project, 'lesson', { work: run.order.work, text: text.slice(0, MOST_LESSON) });
    return { ok: true, written: true };
  }

  // The bug lane's reproduction (section 7.2): the work's kept one, and the one the run's reproduce step gave, read from
  // the engine's own record.
  async function reproductionFind({ runId } = {}) {
    const run = runOf(runId);
    if (!run) return { ok: false, refused: NO_ORDER };
    const engine = engineFor(run.project);
    const outputs = typeof engine?.outputs === 'function' ? await engine.outputs(runId) : {};
    const found = readVerdicts(run.project).reproduced[run.order.work];
    return { ok: true, kept: found ? { check: found.check, files: found.files, commit: found.commit } : null, given: readReproduction(outputs.reproduce) };
  }

  // Keeps the bug's reproduction once for its work: the reproduce step's check, which the red step proved red at its own
  // commit, both read from the engine's record. A later run of the same work gets the kept one back.
  async function reproduction({ runId } = {}) {
    const run = runOf(runId);
    if (!run) return { ok: false, refused: NO_ORDER };
    if (run.order.lane !== 'bug') return { ok: false, refused: 'only a bug run keeps a reproduction' };
    const verdicts = readVerdicts(run.project);
    const found = verdicts.reproduced[run.order.work];
    if (found) return { ok: true, check: found.check, commit: found.commit };
    const engine = engineFor(run.project);
    if (typeof engine?.outputs !== 'function') return { ok: false, refused: 'that project\'s engine keeps no step outputs' };
    const outputs = await engine.outputs(runId);
    const given = readReproduction(outputs.reproduce);
    if (!given) return { ok: false, refused: 'the run\'s reproduce step gave no reproduction' };
    const red = parsed(outputs.red);
    if (red?.red !== true || !FULL_SHA.test(red.commit ?? '') || !sameReproduction(given.check, red.check ?? null)) {
      return { ok: false, refused: 'the run didn\'t prove its reproduction red at its own commit' };
    }
    verdicts.reproduced[run.order.work] = { check: given.check, files: given.files, commit: red.commit, runId, at: now().toISOString() };
    keepVerdicts(run.project, verdicts);
    await write(run.project, 'reproduced', { work: run.order.work, runId, commit: red.commit, check: given.check, files: given.files });
    return { ok: true, check: given.check, commit: red.commit };
  }

  // The order a run's steps read: the one stored for it, with a bug's kept reproduction among its done checks.
  function orderNow(run) {
    const found = run.order.lane === 'bug' ? readVerdicts(run.project).reproduced[run.order.work] : null;
    return found ? { ...run.order, done: [...run.order.done, found.check] } : run.order;
  }

  // What the helper knows of a pull request it marked ready: { head, runId, showFirst, work }, or null.
  const readyOf = (project, pr) => readVerdicts(project).ready?.[pr] ?? null;
  // The run that opened a pull request: { runId, head, showFirst, work }, or null for one no run of the helper's opened.
  const openedOf = (project, pr) => readVerdicts(project).opened?.[pr] ?? null;

  // A route served only to a call that carries the run's own ticket.
  const ticketed = (route) => async (body = {}) => {
    const run = runOf(body?.runId);
    if (!run) return { ok: false, refused: NO_ORDER };
    let hash = null;
    try { hash = fs.readFileSync(ticketFile(run.project, body.runId), 'utf8').trim(); } catch { hash = null; }
    if (!ticketMatches(body.ticket, hash)) return { ok: false, refused: NO_TICKET };
    const { ticket: _ticket, ...rest } = body;
    return route(rest);
  };

  return {
    runOf,
    startReader,
    readyOf,
    openedOf,
    // The pull request a run opened, by the helper's own record of it, or null (an engine may not say so itself).
    openedBy: (project, runId) => {
      const found = Object.entries(readVerdicts(project).opened ?? {}).find(([, o]) => o?.runId === runId);
      return found ? Number(found[0]) : null;
    },
    // The helper's own record of what opened a pull request: { runId, head, work, lane, ... }, or null.
    openedOf: (project, pr) => readVerdicts(project).opened?.[pr] ?? null,
    // A project's local changes have become pull requests: what is known of each goes to its new number, and what is known of
    // a change that has ended goes, as its number now means another pull request.
    carryNumbers: (project, numbers) => {
      const verdicts = readVerdicts(project);
      const carried = (held) => Object.fromEntries(Object.entries(held ?? {}).flatMap(([n, o]) => (numbers[n] === undefined ? [] : [[numbers[n], o]])));
      keepVerdicts(project, { ...verdicts, opened: carried(verdicts.opened), ready: carried(verdicts.ready) });
    },
    // Every pull request the helper marked ready for the project: { [pr]: { head, runId, showFirst, work } }.
    readyAll: (project) => readVerdicts(project).ready ?? {},
    // The fix-main runs whose fix the helper added.
    fixedRuns: (project) => Object.keys(readVerdicts(project).fixed ?? {}),
    start,
    // Keeps an ended run's task reviews in the helper's record. True once there is nothing more to keep.
    keepTaskReviews: async (project, runId) => {
      const order = storeOf(project).load(runId);
      return order?.lane === SLICE_LANE ? keepReviews(project, runId, order) : true;
    },
    routes: {
      '/engine/review': ticketed(review),
      '/engine/task-holds': ticketed(taskHolds),
      '/engine/open-pr': ticketed(openPr),
      '/engine/ready': ticketed(ready),
      '/engine/preview/find': ticketed(previewFind),
      '/engine/preview': ticketed(preview),
      '/engine/lesson': ticketed(lesson),
      '/engine/merge-fix': ticketed(mergeFix),
      '/engine/main-check': ticketed(async ({ runId }) => (mainCheck ? mainCheck(runOf(runId).project) : { ok: true, here: false })),
      '/engine/reproduction': ticketed(reproduction),
      '/engine/reproduction/find': ticketed(reproductionFind),
      // The view of the card a reader run was started for, and nothing for any other run.
      '/engine/reader-view': ticketed(async ({ runId } = {}) => {
        const run = runOf(runId);
        const view = run?.order.lane === READER_LANE ? readerViewOf(run.project, run.order.card) : null;
        return view ? { ok: true, view } : { ok: false, refused: 'there is no view for that run' };
      }),
      // The project's standing brief, to read and never to write: only the director's signed click changes it.
      '/engine/brief': ticketed(async ({ runId } = {}) => ({ ok: true, brief: briefLines(briefOf(runOf(runId).project)?.brief) })),
      // The order the helper keeps for the run, and nothing for any other id.
      '/engine/order': ticketed(async ({ runId } = {}) => {
        const run = runOf(runId);
        return run ? { ok: true, order: orderNow(run) } : { ok: false, refused: NO_ORDER };
      }),
    },
  };
}

// Where a project's engine files are kept beside its record: `<state>/../engine/`.
export const engineDirOf = (stateFolder) => path.join(stateFolder, '..', 'engine');
