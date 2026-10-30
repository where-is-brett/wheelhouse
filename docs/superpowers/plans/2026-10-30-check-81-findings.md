<!-- docs/superpowers/plans/2026-10-30-check-81-findings.md -->
# Check 81's five findings

Check 81 saw five things and changed none of them. All five go in one pull request, each fix with a test that fails first.

## 1. A red end always becomes a rework or a question (HIGH)

**Cause.** A task's loop closes on its last round whatever the reason, and `task-check.js` trusts the lane's close to ask. The close (`tasks-done.js`) asks only about tasks left unticked. So a task that is ticked, with its test red, changes left uncommitted or a BLOCKER or HIGH from its review, closes clean. The same hole opens on a rework: the fresh run builds only unticked tasks, so nothing goes back to a ticked task. The steps after the close run the protected-test check, reviews and the merge gate. None of them runs the task's test, so red work reaches the reviewers, and the main line unless the project's own CI stops it.

**Fix.**
- `tasks-done.js` checks every ticked task at the close, from the helper's order: its test passes, and the tree is clean. It trusts nothing in the run's artefacts.
- `task-record.js`, in a slice's task, carries a review that holds (`--reviewed`), and the close reads it from the fan-out's records.
- A task that fails is unticked in its own commit, so the fresh run builds it again, and the close raises one card naming the task, with **Send it back for a fresh run** recommended. An order the helper won't give, or an untick that fails, still raises the card.
- The steps' timeout rises to hold the tests; a timeout fails the run, which is not quiet.

## 2. One decision, one question

The merge queue's level 3 question about a feature's own switch-on pull request is answered with the director's approval when all of these hold, and otherwise comes as a card:
- the helper's own record says a feature run opened that pull request;
- Archon's record of what it asked names that pull request, its head and a choice whose effect is `merge`;
- a verified, signed approval of exactly that head is in the views.

Nothing changes in the gate: the broker still needs the signed approval to merge. Under All stop the question waits. The Logbook says it was answered and by what.

## 3. The question names its pull request

The card says "pull request #7, <title>", from Archon's record of what it asked and the host's title. With no title, the number alone.

## 4. A ruled merge goes ahead

**Cause.** Archon's `launchDetached` reads a refusal from standard error, but `--json` puts it on standard output, so check 81's log kept nothing after "did not start:". The refusal can't be recovered from the run, and the same start from a copy of the engine's database, in a real paused-and-woken script step, started. So the cause in that run stays unknown; the fix doesn't rest on it. A start from a step can't be the way anyway: it lacks `--project`, `--workflow-source` and the routing table's bindings, and the helper wouldn't know the run, so its asks wouldn't route.

**Fix.** Wheelhouse starts the follow-up itself. An answer whose choice has the effect `merge` marks the queue as due, and the dispatcher starts it on the first tick after the ruling's run ends. The upstream note records the lost refusal. If Archon's own start does work, the second sweep finds nothing to do.

## 5. Allow rules in a fresh worktree

**Cause.** Claude Code reads no `permissions.allow` from a project's settings until the folder is trusted, and Archon's worktrees are never trusted. Check 75 found this and the tool guard answers `allow` for a file tool call in the step's own artefacts. Check 81's steps were denied anyway because they loaded the installed plugin, 0.1.2, which is older than that branch of the guard.

**Result.** Nothing a run needs is blocked in a released install, where the plugin and the pack are one version. But a step denied its order did go on without it in check 81, so the shared rules now say to read it through the shell and to take the blocked exit if it still can't be read. Documented in check 81's record.
