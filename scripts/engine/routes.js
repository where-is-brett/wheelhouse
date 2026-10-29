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
//                           request; repo(project) -> 'owner/name'; previewUrl(project, sha) -> the host's preview of
//                           the commit, or null }
//   provenance(project, { branch })   records what built the branch's pull request (the pack's digest and Archon's)
//   previewsDir(project)  where previews are kept, `previews/<work>/<head>/` under the project's engine files
// A run is found by its id in the projects' order stores: the only runs these routes serve are ones the helper
// started itself, with an order.
import fs from 'node:fs';
import path from 'node:path';
import { checkOrder, orderStore, isRunId } from './order.js';

const NO_ORDER = 'there is no work order for that run';

// The pack's review steps (engine/archon/pack/wheelhouse-quick.yaml), and the severities that hold work back.
export const REVIEW_STEPS = Object.freeze(['review-standards', 'review-spec', 'review-security', 'review-design']);
const HOLDS = new Set(['BLOCKER', 'HIGH']);
const SEVERITIES = new Set(['BLOCKER', 'HIGH', 'MEDIUM', 'LOW']);
const FULL_SHA = /^[0-9a-f]{40}$/;
// What the helper copies from a run's preview folder: pictures the step named by page and size, and its notes.
const PREVIEW_FILE = /^([a-z0-9][a-z0-9-]{0,80}-\d{2,5}x\d{2,5}\.png|notes\.json)$/;
const MOST_PREVIEW_BYTES = 20 * 1024 * 1024;

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
  projects, engineFor, ordersDir, write, held = () => false, now = () => new Date(),
  filesDir = (project) => path.join(ordersDir(project), '..'), digests = { installed: () => null, captured: () => null }, comment,
  host, provenance, previewsDir = (project) => path.join(filesDir(project), 'previews'),
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

  // Starts a run of `order` for `project` and keeps its order under the run's id; writes the run's start in the
  // project's record, which is how the continuation host knows the run is the project's.
  async function start({ project, order, branch, carryOn } = {}) {
    if (held()) return { ok: false, refused: 'All stop is on, so no run starts' };
    const found = projects().find((p) => p.project === project);
    if (!found) return { ok: false, refused: 'that project isn\'t registered on this computer' };
    const engine = engineFor(project);
    if (!engine) return { ok: false, refused: 'that project doesn\'t use the build engine' };
    const problem = checkOrder(order);
    if (problem) return { ok: false, refused: problem };
    const started = await engine.start({ work: order.work, lane: order.lane, branch, carryOn: carryOn === true, project: found.folder, bindings: order.bindings });
    if (!started?.ok) return { ok: false, refused: started?.refused ?? 'the engine didn\'t start the run' };
    storeOf(project).save(started.runId, order);
    const runBranch = started.branch ?? branch;
    await write(project, 'run', { work: order.work, lane: order.lane, engine: engine.name ?? 'engine', runId: started.runId, state: 'started', ...(runBranch ? { branch: runBranch } : {}) });
    return { ok: true, runId: started.runId };
  }

  // The verdicts kept for a project: { runs: { [runId]: { head, signed: { [step]: verdict } } }, comments: { [pr]: id } }.
  const verdictsFile = (project) => path.join(filesDir(project), 'verdicts.json');
  function readVerdicts(project) {
    const kept = parsed(fs.existsSync(verdictsFile(project)) ? fs.readFileSync(verdictsFile(project), 'utf8') : 'null');
    return kept && typeof kept === 'object' ? { runs: kept.runs ?? {}, comments: kept.comments ?? {}, ready: kept.ready ?? {} } : { runs: {}, comments: {}, ready: {} };
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
    return { ok: true, ran: true, verdict, posted };
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
    const handed = await engine.handOver({ project: run.folder, repo, pr: opened.pr, url: `https://github.com/${repo}/pull/${opened.pr}`, runId, at: now().toISOString() });
    if (!handed?.ok) return { ok: false, refused: handed?.refused ?? 'the engine didn\'t take the work' };
    verdicts.ready = { ...(verdicts.ready ?? {}), [opened.pr]: { head: opened.head, runId, showFirst: run.order.showFirst === true, work: run.order.work } };
    keepVerdicts(run.project, verdicts);
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
  // clean-up and can't be planted from another run. Only plain files named as the step names them are copied.
  async function preview({ runId } = {}) {
    const run = runOf(runId);
    if (!run) return { ok: false, refused: NO_ORDER };
    const engine = engineFor(run.project);
    if (typeof engine?.artefactsOf !== 'function' || typeof engine?.outputs !== 'function') return { ok: false, refused: 'that project\'s engine keeps no artefacts' };
    const opened = readOpened((await engine.outputs(runId))['open-pr']);
    if (!opened) return { ok: false, refused: 'the run hasn\'t opened its pull request yet' };
    const artefacts = engine.artefactsOf(runId, host?.repo(run.project));
    const from = artefacts ? path.join(artefacts, 'preview') : null;
    if (!from || !fs.existsSync(from) || !fs.lstatSync(from).isDirectory()) return { ok: false, refused: 'the run made no preview' };
    const to = path.join(previewsDir(run.project), run.order.work, opened.head);
    fs.mkdirSync(to, { recursive: true, mode: 0o700 });
    let pictures = 0;
    let notes = null;
    for (const name of fs.readdirSync(from).filter((n) => PREVIEW_FILE.test(n)).sort()) {
      const file = path.join(from, name);
      const found = fs.lstatSync(file);
      if (!found.isFile() || found.size > MOST_PREVIEW_BYTES) continue;
      fs.copyFileSync(file, path.join(to, name));
      if (name === 'notes.json') notes = parsed(fs.readFileSync(file, 'utf8'));
      else pictures += 1;
    }
    const pages = Array.isArray(notes?.pages) && notes.pages.every((p) => typeof p === 'string') ? notes.pages : [];
    await write(run.project, 'preview', { work: run.order.work, head: opened.head, folder: to, pages });
    return { ok: true, folder: to, pictures };
  }

  // What the helper knows of a pull request it marked ready: { head, runId, showFirst, work }, or null.
  const readyOf = (project, pr) => readVerdicts(project).ready?.[pr] ?? null;

  return {
    runOf,
    readyOf,
    routes: {
      '/engine/start': start,
      '/engine/review': review,
      '/engine/open-pr': openPr,
      '/engine/ready': ready,
      '/engine/preview/find': previewFind,
      '/engine/preview': preview,
      // The order the helper keeps for the run, and nothing for any other id.
      '/engine/order': async ({ runId } = {}) => {
        const run = runOf(runId);
        return run ? { ok: true, order: run.order } : { ok: false, refused: NO_ORDER };
      },
    },
  };
}

// Where a project's engine files are kept beside its record: `<state>/../engine/`.
export const engineDirOf = (stateFolder) => path.join(stateFolder, '..', 'engine');
