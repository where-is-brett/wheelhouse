// scripts/host/undo.js
// Undo on a project kept on GitHub or GitLab (design section 8 of the director's way of working): one reply takes a merged change
// back out, by a revert the helper makes, opens as a pull request and merges through the same gate as any other merge. The
// director's reply is the approval: the signed click in the helper's window that names the merge (scripts/host/local/undo.js),
// which only the director's own click makes.
//
//   undoOnHost({ adapter, git, merge, approval, defaultBranch, kept, keep, approve, through })
//     -> { ok: true, pr, merged, merge?, refused? }
//      | { ok: false, reason: 'not-merged' | 'needs-approval' | 'conflict' | 'wide' | 'nothing-to-undo' | 'push' | 'host', refused? }
//   merge:    the merge commit to take out, in full
//   approval: the director's signed click for this merge, or null
//   git:      { base() -> { head, history }, revert({ merge, head }) -> { ok: true, commit } | { ok: false, reason }, push({ branch, commit }) }
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

export async function undoOnHost({ adapter, git, merge, approval = null, defaultBranch, kept = null, keep, approve, through }) {
  if (typeof merge !== 'string' || !FULL_SHA.test(merge)) return { ok: false, reason: 'not-merged' };
  let entry = null;
  // An undo already made and still open is carried on, never made twice.
  if (kept !== null && kept.merge === merge && Number.isInteger(kept.pr)) {
    const state = await adapter.prState(kept.pr);
    if (state?.state === 'open' && state.headSha === kept.head) entry = kept;
  }
  if (entry === null) {
    const base = await git.base();
    if (!Array.isArray(base?.history) || !base.history.includes(merge)) return { ok: false, reason: 'not-merged' };
    // Nothing is pushed or opened without the director's click.
    if (approval === null || approval === undefined) return { ok: false, reason: 'needs-approval' };
    const made = await git.revert({ merge, head: base.head });
    if (made?.ok !== true) return { ok: false, reason: made?.reason === 'wide' ? 'wide' : made?.reason === 'nothing' ? 'nothing-to-undo' : 'conflict' };
    const branch = undoBranch(merge, made.commit);
    const pushed = await git.push({ branch, commit: made.commit });
    if (pushed?.ok !== true) return { ok: false, reason: 'push', refused: pushed?.refused };
    let opened;
    try {
      opened = await adapter.openPr({ head: branch, base: defaultBranch, title: undoTitle(made.subject), body: undoBody(merge) });
    } catch (error) {
      return { ok: false, reason: 'host', refused: error instanceof Error ? error.message : 'the host would not open the pull request' };
    }
    entry = { merge, pr: opened.number, head: made.commit, branch };
    keep(entry);
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
