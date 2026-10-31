// scripts/host/local/changes.js
// A local change stands in for a pull request (spec 7.1): a branch in the home, a number, and signed `change` events in the
// private record, each holding the whole change as it now stands. Numbers count up from 1 for each project, from the file
// `next-change` beside the home, and never come back. `refs/pull/<n>/head` in the home follows the change, so the rest of the
// code reads one as it reads a pull request. Only the helper writes any of this.
import fs from 'node:fs';
import path from 'node:path';
import { stateDir } from '../../lib/paths.js';
import { withLocalLock } from '../../lib/local-git.js';
import { listEvents, makeEvent, writeEvent } from '../../state/events.js';
import { openProjectRecord } from '../../state/record.js';
import { ownKey, verify } from '../../state/signing.js';
import { writeViews } from '../../state/views.js';
import { gitRoute, homeGit, isBranchName, projectFolder } from './home.js';

const FULL_COMMIT = /^[0-9a-f]{40}$/;
const NUMBER_FILE = 'next-change';
// Its own lock, apart from the local queue's, which holds its lock across a merge that records a change here.
const CHANGE_LOCK = 'change.lock';

// The project's records of a kind this computer signed, oldest first.
export function signedOf(project, kind) {
  const own = ownKey();
  const enrolled = own === null ? [] : [{ computer: own.computer, publicKey: own.publicKey }];
  return listEvents(stateDir(project), { report: () => {} }).filter((e) => e.kind === kind && verify(e, enrolled));
}

// Keeps a signed event in the project's private record, and brings the views up to date.
const keepHere = (project) => async ({ event }) => {
  await openProjectRecord(project, {});
  await writeEvent({ project, event });
  try { await writeViews(project); } catch { /* the next write brings them up to date */ }
};

const refuse = (text) => { throw new Error(text); };
const pullRef = (n) => `refs/pull/${n}/head`;

// The project's changes as they stand, each from its latest record: the highest `rev`, so two records in one moment, or a
// clock put back, can't turn a change back.
function changesOf(project) {
  const latest = new Map();
  for (const { data } of signedOf(project, 'change')) {
    if ((latest.get(data.n)?.rev ?? 0) < data.rev) latest.set(data.n, data);
  }
  return [...latest.values()].sort((a, b) => a.n - b.n);
}

function nextNumber(project) {
  const file = path.join(projectFolder(project), NUMBER_FILE);
  let kept = 0;
  try { kept = Number.parseInt(fs.readFileSync(file, 'utf8'), 10); } catch { /* none yet */ }
  // The records stand behind the file: a lost file never gives a number out twice.
  const n = Math.max(Number.isInteger(kept) ? kept : 0, 1, ...changesOf(project).map((c) => c.n + 1));
  const part = `${file}.${process.pid}`;
  fs.writeFileSync(part, `${n + 1}\n`, { mode: 0o600 });
  fs.renameSync(part, file);
  return n;
}

// `git` is gitRoute's; `write` keeps a signed event ({ event }).
export function localChanges({ project, git = gitRoute(), write = keepHere(project), now = () => new Date() }) {
  const home = () => homeGit(project, git);
  const locked = (fn) => withLocalLock({ dir: projectFolder(project), name: CHANGE_LOCK }, fn, { now });

  async function mustHold(commit) {
    if (typeof commit !== 'string' || !FULL_COMMIT.test(commit) || !(await home().ok(['rev-parse', '--verify', '-q', `${commit}^{commit}`]))) {
      refuse('That commit isn\'t in this project\'s home');
    }
  }
  // The record first, so the head a change stands at is never one the record doesn't hold.
  async function keep(change) {
    await write({ project, event: makeEvent({ kind: 'change', data: change, now }) });
    if (!(await home().ok(['update-ref', pullRef(change.n), change.head]))) refuse('The change was recorded, but its place in the home could not be moved');
    return change;
  }
  function held(n) {
    const change = changeOf(n);
    if (change === null) refuse(`There is no change ${n}`);
    return change;
  }
  function stillOpen(n) {
    const change = held(n);
    if (change.state !== 'open') refuse(`Change ${n} has ended, so it can't be changed`);
    return change;
  }
  function changeOf(n) {
    return changesOf(project).find((c) => c.n === n) ?? null;
  }

  return {
    changeOf,
    // The open changes, oldest first.
    openChanges: () => changesOf(project).filter((c) => c.state === 'open'),
    // Every change that has merged, oldest first, for the reports.
    mergedChanges: () => changesOf(project).filter((c) => c.state === 'merged'),
    openChange: ({ branch, base, title, body = '', head }) => locked(async () => {
      if (!isBranchName(branch) || !isBranchName(base)) refuse('A change needs a branch and a base with plain names');
      if (branch === base) refuse('A change can\'t be from the main version to itself');
      await mustHold(head);
      if (changesOf(project).some((c) => c.state === 'open' && c.branch === branch)) refuse(`There is an open change for ${branch} already`);
      return keep({ n: nextNumber(project), rev: 1, branch, base, title, body, state: 'open', head, mergeCommit: null });
    }),
    // Changes what is given: the title, the text, or the head a push moved the branch to.
    updateChange: ({ n, title, body, head }) => locked(async () => {
      const change = stillOpen(n);
      if (head !== undefined) await mustHold(head);
      return keep({ ...change, rev: change.rev + 1, title: title ?? change.title, body: body ?? change.body, head: head ?? change.head });
    }),
    closeChange: (n) => locked(async () => {
      const change = stillOpen(n);
      return keep({ ...change, rev: change.rev + 1, state: 'closed' });
    }),
    // Marks a change merged, as the local queue does once its squash stands on the main version.
    markMerged: ({ n, commit }) => locked(async () => {
      const change = stillOpen(n);
      await mustHold(commit);
      return keep({ ...change, rev: change.rev + 1, state: 'merged', mergeCommit: commit });
    }),
  };
}
