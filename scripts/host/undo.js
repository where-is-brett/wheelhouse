// scripts/host/undo.js
// Undo on a project kept on GitHub or GitLab (design section 8 of the director's way of working): one reply takes a merged change
// back out, by a revert the helper makes, opens as a pull request and merges through the same gate as any other merge. The
// director's reply is the approval: the signed click in the helper's window that names the merge (scripts/host/local/undo.js),
// which only the director's own click makes.
//
//   undoOnHost({ adapter, git, merge, approval, defaultBranch, kept, keep, approve, through })
//     -> { ok: true, pr, merged, merge?, refused? }
//      | { ok: false, reason: 'not-merged' | 'needs-approval' | 'conflict' | 'wide' | 'nothing-to-undo' | 'push' | 'host' | 'old-git' | 'already-undone', refused? }
//   merge:    the merge commit to take out, in full
//   approval: the director's signed click for this merge, or null
//   git:      { base() -> { head, history }, revert({ merge, head }) -> { ok: true, commit } | { ok: false, reason },
//               update({ head, base }) -> { ok: true, current: true } | { ok: true, commit } | { ok: false, reason }, push({ branch, commit }) }
//             over the helper's own mirror
//   kept:     the undo already made for this merge and still open, { merge, pr, head, branch }, or null
//   keep:     remembers the undo it made, before anything else is done with it
//   approve:  ({ pr, head, approval }) -> boolean, records the director's approval of the revert's head from the click; false where
//             it can't (no click, and none recorded before)
//   through:  (pr) -> the merge route's answer for the revert's pull request: the gate decides
// A revert that clashes with later work forces nothing: nothing is pushed or opened, and the caller turns the answer into a decision
// for the director. An undo of an undo is an undo of that merge like any other.
export const FULL_SHA = /^[0-9a-f]{40}$/;

// The branch of an undo's pull request: the merge it takes out and the revert's own commit, so one merge undone again later (after its
// undo was itself undone) gets a branch of its own.
export const UNDO_BRANCH = /^wheelhouse\/undo-([0-9a-f]{12})-([0-9a-f]{12})$/;
export const undoBranch = (merge, commit) => `wheelhouse/undo-${merge.slice(0, 12)}-${commit.slice(0, 12)}`;

export const undoTitle = (subject) => `Take back: ${String(subject ?? '').replace(/\s+/g, ' ').trim().slice(0, 100) || 'a merged change'}`;
export const undoBody = (merge) => `This takes the merge ${merge} back out of the main version, on the director's say. It adds a new commit that reverses the merge: nothing is deleted, and later work stays.\n\nWheelhouse made it and merges it once its checks pass.`;

// The decision for the director when later work clashes with the revert.
export const conflictLine = (merge) => `Undo of the merge ${merge} clashes with later work`;
export const CONFLICT_LINE = /Undo of the merge ([0-9a-f]{40}) clashes with later work/g;
export function undoConflictCard(merge) {
  const line = conflictLine(merge);
  return {
    question: [
      'Taking this merge back out can\'t be done in one step.',
      'Later work touches the same files, so the undo would clash. Nothing was changed and nothing was forced.',
      'Recommended: Take it out by hand. Until you choose, nothing happens.',
      line,
    ].join('\n'),
    header: 'Undo',
    options: ['Take it out by hand', 'Leave it'],
    kind: 'question',
    level: 3,
    recommend: 'Take it out by hand',
    line,
  };
}

// The pull request an earlier, interrupted undo opened, found by its branch and the exact commit the helper kept for it before pushing,
// and open against the default branch.
async function adoptable(adapter, kept, defaultBranch) {
  if (typeof adapter.openRequests !== 'function') return null;
  const open = await adapter.openRequests();
  const found = (Array.isArray(open) ? open : []).find((r) => r?.branch === kept.branch && r.fork !== true && r.head === kept.head && Number.isInteger(r.number));
  if (found === undefined) return null;
  const state = await adapter.prState(found.number);
  if (state?.state !== 'open' || state.baseRef !== defaultBranch || state.headSha !== kept.head) return null;
  return { merge: kept.merge, pr: found.number, head: kept.head, branch: kept.branch };
}

export async function undoOnHost({ adapter, git, merge, approval = null, defaultBranch, kept = null, keep, approve, through }) {
  if (typeof merge !== 'string' || !FULL_SHA.test(merge)) return { ok: false, reason: 'not-merged' };
  let entry = null;
  // An undo already made and still open is carried on, never made twice. One that was kept before its push but not after its pull
  // request opened (a crash between) is found on the host by its branch and commit and kept whole; so is one whose update was kept
  // as pending (`next`) and pushed before the keep.
  if (kept !== null && kept.merge === merge && Number.isInteger(kept.pr)) {
    if (kept.pr === 0) {
      entry = await adoptable(adapter, kept, defaultBranch);
      if (entry !== null) await keep(entry);
    } else {
      const state = await adapter.prState(kept.pr);
      // With no new click, a merge whose undo already merged is undone: there is nothing to ask.
      if (state?.state === 'merged' && (approval === null || approval === undefined)) return { ok: false, reason: 'already-undone' };
      const whole = { merge: kept.merge, pr: kept.pr, head: kept.head, branch: kept.branch };
      if (state?.state === 'open' && state.headSha === kept.head) {
        entry = whole;
      } else if (state?.state === 'open' && typeof kept.next === 'string' && state.headSha === kept.next) {
        entry = { ...whole, head: kept.next };
        await keep(entry);
      }
    }
  }
  if (entry !== null) {
    // Behind the main version it can't merge, and nothing else would bring it up to date: the helper's own branch takes the main
    // version's moves, as a merge of it, so later work that clashes is a conflict and nothing is forced. While the checks for the
    // current head are still pending it is left alone, so a busy main version doesn't keep restarting them.
    const base = await git.base();
    const updated = await git.update({ head: entry.head, base: base.head });
    if (updated?.ok !== true) {
      const reason = updated?.reason === 'conflict' ? 'conflict' : updated?.reason === 'old-git' ? 'old-git' : 'push';
      return { ok: false, reason, ...(typeof updated?.refused === 'string' ? { refused: updated.refused } : {}) };
    }
    if (updated.current !== true) {
      let waiting = true;
      try { waiting = (await adapter.ciState(entry.head))?.state === 'pending'; } catch { /* not known: left alone */ }
      if (!waiting) {
        // Kept as pending before the push, as the revert is, so a stop between the push and the keep is found again.
        await keep({ ...entry, next: updated.commit });
        const pushed = await git.push({ branch: entry.branch, commit: updated.commit });
        if (pushed?.ok !== true) return { ok: false, reason: 'push', refused: pushed?.refused };
        entry = { merge: entry.merge, pr: entry.pr, head: updated.commit, branch: entry.branch };
        await keep(entry);
      }
    }
  }
  if (entry === null) {
    const base = await git.base();
    if (!Array.isArray(base?.history) || !base.history.includes(merge)) return { ok: false, reason: 'not-merged' };
    // Nothing is pushed or opened without the director's click.
    if (approval === null || approval === undefined) return { ok: false, reason: 'needs-approval' };
    const made = await git.revert({ merge, head: base.head });
    if (made?.ok !== true) {
      if (made?.reason === 'old-git') return { ok: false, reason: 'old-git', refused: made.refused };
      return { ok: false, reason: made?.reason === 'wide' ? 'wide' : made?.reason === 'nothing' ? 'nothing-to-undo' : 'conflict' };
    }
    const branch = undoBranch(merge, made.commit);
    // Kept before the push (pr 0: not opened yet), so a crash after the push finds its own revert again and opens no second one.
    await keep({ merge, pr: 0, head: made.commit, branch });
    const pushed = await git.push({ branch, commit: made.commit });
    if (pushed?.ok !== true) return { ok: false, reason: 'push', refused: pushed?.refused };
    let opened;
    try {
      opened = await adapter.openPr({ head: branch, base: defaultBranch, title: undoTitle(made.subject), body: undoBody(merge) });
    } catch (error) {
      return { ok: false, reason: 'host', refused: error instanceof Error ? error.message : 'the host would not open the pull request' };
    }
    entry = { merge, pr: opened.number, head: made.commit, branch };
    await keep(entry);
  }
  if ((await approve({ pr: entry.pr, head: entry.head, approval })) !== true) return { ok: false, reason: 'needs-approval' };
  const answer = await through(entry.pr);
  if (answer?.ok === true && answer.merged === true) {
    let after = null;
    try { after = (await git.base()).head; } catch { /* the merge stands; its commit is just not named */ }
    return { ok: true, pr: entry.pr, merged: true, ...(after === null ? {} : { merge: after }) };
  }
  return { ok: true, pr: entry.pr, merged: false, refused: typeof answer?.refused === 'string' ? answer.refused : 'the gate gave no answer', ...(answer?.waiting === true ? { waiting: true } : {}) };
}
