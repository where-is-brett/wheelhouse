// scripts/update/engine-move.js
// The move of a project on Archon to Wheelhouse's own engine, at the update that drops Archon (core cut, design 4.3, 6
// item 1 and 8.3). From that release `engine` reads as `wheelhouse` whatever is stored (scripts/settings/effective.js), so
// the helper no longer tends Archon's runs; the update's finish step calls this once the hand-over is done, which is the
// quiet point the move waits for. In order, each step once however often the update runs:
//   1. each Archon run still going is cancelled through the connector, its worktree and branch kept;
//   2. its work is queued for the own engine as a carry-on piece on the same branch: a ready record and a work event, and
//      the order in <project>/engine/carried.json, which names an Archon question left unanswered, whose card stays up;
//   3. one card asks the director to remove `.archon/` and the merge queue's policy file from the project, by one helper
//      pull request; the update does not wait for it;
//   4. Archon's parts on this computer move to <home>/archive/archon-<date>/ once no project here still stores Archon.
//      Nothing is deleted.
// Open pull requests stay open for the gate, and the records of Archon's runs stay as they are. Every outside look is a seam.
import fs from 'node:fs';
import path from 'node:path';
import { CARRY_ON } from '../engine/archon/adapter.js';
import { pieceWork } from '../survey/ready.js';
import { readyRecordFile, writeReadyRecord } from '../survey/ready-record.js';
import { archonHome, engineDir, stateDir, wheelhouseHome } from '../lib/paths.js';
import { run as defaultRun } from '../lib/run.js';
import { backup } from './journal.js';

export const REMOVE_THEM = 'Remove them';
export const KEEP_THEM = 'Keep them for now';
export const MOVED_LINE = 'This project now builds on Wheelhouse\'s own engine; Archon is no longer used.';
export const archonUnread = (runId) => `Archon did not answer about run ${runId}, so the move waits: run the update again.`;
export const carriedLine = (work, id) => `${work} carries on from its branch as ${id}.`;
export const ARCHIVED_LINE = 'Archon on this computer was moved to Wheelhouse\'s archive; it is deleted only when you say so.';

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const SLUG = /^[a-z0-9][a-z0-9-]{0,47}$/;
const BRANCH = /^[A-Za-z0-9._/-]+$/;

export const carriedFile = (project) => path.join(path.dirname(stateDir(project)), 'engine', 'carried.json');

// Archon's own parts on this computer: its program and the pinned Bun under the engine folder, and its home. The engine
// folder itself is shared with the gh broker and stays.
export function archonParts({ engine = engineDir(), home = archonHome() } = {}) {
  return [path.join(engine, 'archon'), path.join(engine, 'bun'), home];
}

// Moves each part that is there into <home>/archive/archon-<date>/. Gives the folder, or null when there was nothing.
export function archiveArchon({ parts = archonParts(), date = new Date(), into = path.join(wheelhouseHome(), 'archive') } = {}) {
  const there = parts.filter((p) => fs.existsSync(p));
  if (there.length === 0) return null;
  const folder = path.join(into, `archon-${date.toISOString().slice(0, 10)}`);
  fs.mkdirSync(folder, { recursive: true });
  const moved = [];
  for (const part of there) {
    const to = path.join(folder, path.basename(part).replace(/^\./, ''));
    if (fs.existsSync(to)) continue;
    fs.renameSync(part, to);
    moved.push({ from: part, to });
  }
  return { folder, moved };
}

// Puts back what archiveArchon moved, for the update's undo.
export function unarchiveArchon(moved = []) {
  for (const { from, to } of moved) if (fs.existsSync(to) && !fs.existsSync(from)) fs.renameSync(to, from);
}

// Each Archon run whose latest record is not 'ended', by work, with the branch and lane its records name.
export function liveArchonRuns(runs = {}) {
  const out = [];
  for (const [work, records] of Object.entries(isObject(runs) ? runs : {})) {
    const byRun = new Map();
    for (const record of Array.isArray(records) ? records : []) {
      const d = record?.data;
      if (typeof d?.runId !== 'string' || (d.engine !== undefined && d.engine !== 'archon')) continue;
      const seen = byRun.get(d.runId) ?? { runId: d.runId, work, lane: null, branch: null, state: null };
      seen.lane ??= typeof d.lane === 'string' ? d.lane : null;
      seen.branch ??= typeof d.branch === 'string' ? d.branch : null;
      seen.state = d.state;
      byRun.set(d.runId, seen);
    }
    for (const run of byRun.values()) if (run.state !== 'ended') out.push(run);
  }
  return out;
}

// The Archon question left unanswered for a run, as { id, question }, or null.
export function openQuestion({ asks = {}, questions = {} }, work, runId) {
  const mine = (asks[work] ?? []).filter((e) => e?.data?.runId === runId);
  for (const ask of mine.reverse()) {
    const id = ask.data?.id ?? ask.id;
    const q = questions?.[id];
    if (q?.answer?.label === undefined && q?.answer?.words === undefined) return { id, question: ask.data?.question ?? q?.question ?? null };
  }
  return null;
}

// The card that asks to remove Archon's files from the project by one helper pull request.
export function removalCard() {
  const ask = 'Remove Archon\'s files from this project?';
  const what = 'The project still holds the .archon folder and the merge queue\'s policy file, which only Archon read.';
  const why = 'This release builds on Wheelhouse\'s own engine, so the files do nothing now. One pull request removes them, and you approve it as any change.';
  const meanwhile = 'The files stay and do nothing; building carries on.';
  const says = { [REMOVE_THEM]: 'Wheelhouse opens one pull request removing them.', [KEEP_THEM]: 'They stay as they are; nothing reads them.' };
  const options = [REMOVE_THEM, KEEP_THEM];
  const recommendation = `${REMOVE_THEM}, because nothing reads them any more.`;
  return {
    question: [ask, what, why, meanwhile].join('\n'),
    header: 'Archon',
    kind: 'question',
    level: 2,
    options,
    descriptions: options.map((o) => (o === REMOVE_THEM ? `Recommended: ${says[o]}` : says[o])),
    recommend: REMOVE_THEM,
    line: null,
    code: null,
    parts: {
      kind: 'question', header: 'Archon', ask, what, small: why, recommendation,
      options: options.map((o) => ({ label: o, says: says[o], recommended: o === REMOVE_THEM })), why, meanwhile, line: null, code: null,
    },
  };
}

async function gitIn(run, folder, args) {
  const got = await run('git', ['-C', folder, ...args]);
  return { code: got?.code ?? 1, stdout: String(got?.stdout ?? '').trim() };
}

// A work id for the carry-on that no branch, ref or ready record here holds yet.
async function freeId({ run, folder, project, work }) {
  const base = pieceWork(work);
  for (let n = 1; n <= 20; n += 1) {
    const id = n === 1 ? base : `${base}-${n}`;
    if (!SLUG.test(id)) break;
    const held = await gitIn(run, folder, ['for-each-ref', '--format=%(refname)', `refs/heads/feature/${id}`, `refs/wheelhouse/from/${id}`]);
    if (held.code === 0 && held.stdout === '' && !fs.existsSync(readyRecordFile(project, id))) return id;
  }
  return null;
}

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`);
  fs.renameSync(temp, file);
}

// Moves the project off Archon. `progress` is the finish step's saved progress; this keeps its own in `progress.engine`
// and calls `save` after each step, so a second run repeats none. Resolves null when the project was never on Archon,
// else { done, lines }: done is false while a step must be tried again (Archon gave no answer).
export async function moveOffArchon({
  project, folder, journal, progress, save = () => {}, stored, views, connector, client, run = defaultRun,
  othersOnArchon = () => false, archive = () => archiveArchon(), now = () => new Date(),
}) {
  if (!isObject(progress.engine) && stored() !== 'archon') return null;
  const p = (progress.engine ??= { cancelled: {}, queued: {}, card: false, archived: null });
  const lines = [];
  let done = true;

  const seen = await views();
  for (const live of liveArchonRuns(seen?.runs)) {
    // 1. The cancel, once, and only of a run Archon still has going.
    if (p.cancelled[live.runId] === undefined) {
      const rec = await connector.inspect(live.runId);
      if (rec?.unread) { lines.push(archonUnread(live.runId)); done = false; continue; }
      if (rec?.status === 'running' || rec?.status === 'paused') {
        const got = await connector.act(live.runId, { cancel: true });
        if (got?.ok !== true) { lines.push(got?.unreachable ? archonUnread(live.runId) : `Archon's run ${live.runId} could not be cancelled: ${got?.refused ?? 'no reason given'}.`); done = false; continue; }
        p.cancelled[live.runId] = 'cancelled';
      } else {
        p.cancelled[live.runId] = 'ended';
      }
      live.branch ??= typeof rec?.branch === 'string' ? rec.branch : null;
      p.branches = { ...(p.branches ?? {}), [live.runId]: live.branch };
      save();
    }
    // 2. The carry-on, once per work, on the run's own branch.
    if (p.queued[live.work] !== undefined) continue;
    const branch = live.branch ?? p.branches?.[live.runId] ?? null;
    const head = branch && BRANCH.test(branch) ? await gitIn(run, folder, ['rev-parse', '--verify', '--quiet', `refs/heads/${branch}^{commit}`]) : { code: 1 };
    if (head.code !== 0 || !/^[0-9a-f]{40}$/.test(head.stdout)) {
      p.queued[live.work] = { id: null, why: 'no branch' };
      lines.push(`${live.work} had no branch to carry on from; ask for it again.`);
      save();
      continue;
    }
    const id = await freeId({ run, folder, project, work: live.work });
    if (id === null) { lines.push(`No free name was found for ${live.work}'s carry-on; run the update again.`); done = false; continue; }
    const ref = `refs/wheelhouse/from/${id}`;
    const carried = carriedFile(project);
    if (journal) backup(journal, [readyRecordFile(project, id), carried]);
    if ((await gitIn(run, folder, ['update-ref', ref, head.stdout, ''])).code !== 0) { lines.push(`${live.work}'s carry-on could not be marked; run the update again.`); done = false; continue; }
    writeReadyRecord(project, id, { sha: head.stdout, ref, request: null, branch });
    const question = openQuestion(seen ?? {}, live.work, live.runId);
    const orders = readJson(carried) ?? {};
    orders[id] = { order: CARRY_ON, from: live.work, runId: live.runId, branch, ask: question, at: now().toISOString() };
    writeJson(carried, orders);
    const made = await client.state.write({
      project,
      kind: 'work',
      data: { id, title: `Carry on: ${live.work}`, lane: live.lane ?? 'slice', visible: true, dependsOn: [], parent: live.work, from: { sha: head.stdout, ref } },
    });
    if (made?.ok !== true) { lines.push(`${live.work}'s carry-on was not recorded (${made?.refused ?? 'no reason given'}); run the update again.`); done = false; continue; }
    p.queued[live.work] = { id, runId: live.runId, branch, sha: head.stdout };
    lines.push(carriedLine(live.work, id));
    save();
  }

  // 3. The removal card, once; the update does not wait for its answer.
  if (p.card !== true) {
    const made = await client.state.write({ project, kind: 'card', data: removalCard() });
    if (made?.ok === true) { p.card = true; save(); } else done = false;
  }

  // 4. Archon's parts on this computer, once no other project here still stores it.
  if (p.archived === null && done && !(await othersOnArchon())) {
    const got = archive();
    p.archived = got ?? { folder: null, moved: [] };
    save();
    if (got?.moved?.length) lines.push(ARCHIVED_LINE);
  }

  if (done) lines.unshift(MOVED_LINE);
  return { done, lines };
}

// What the update's undo puts back of the move: Archon's parts from the archive. The files it wrote are in the journal's
// backup; a cancelled run stays cancelled and its carry-on stays queued, which either release builds.
export function undoMove(progress) {
  unarchiveArchon(progress?.engine?.archived?.moved ?? []);
}
