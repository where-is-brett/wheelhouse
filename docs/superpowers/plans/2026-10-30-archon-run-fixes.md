<!-- docs/superpowers/plans/2026-10-30-archon-run-fixes.md -->
# Archon run fixes (part 4.6)

Three engine defects that real Archon runs found. Each fix gets a test that fails first.

## 1. The run's overlay where Claude Code reads it

Archon v0.13.0 gives Claude steps `settingSources` of `project` and `user` only, and its config and node schema refuse `local` (`packages/providers/src/claude/config.ts`). A node's `sandbox:` passes through, but it is fixed per workflow, so it can't name one run's artefacts. So `.claude/settings.local.json` is never read, and no Archon patch is needed if the overlay goes into the project source instead.

- `order-copy.js` writes the worktree's `.claude/settings.json`: the branch's own shared settings (read from the index, so a second run in the same worktree never merges over an earlier run's overlay) merged with `ownRunRules`. Lists are joined without repeats; the overlay's single values win.
- Kept out of commits with `git update-index --skip-worktree .claude/settings.json`, which is per worktree (each worktree has its own index), so the director's checkout is untouched.
- A branch with no shared settings is refused: the run's guards live in them, so a run there would be unguarded. The old `settings.local.json` overlay is no longer written.
- Tests: the merged file holds both the shared deny rules and the run's allow and sandbox lists; `git status` and `git add -A` leave it out; a second write replaces the run's lists rather than adding to them; a link is refused; no shared settings is refused.
- Real check: a cheap probe if the eval cache's Archon can run one step.

## 2. All stop reaches a just-started run

`workflow status --all` doesn't list a run started under about a second ago. `stopAll(reason, { beforeCancel, known })` takes the run ids the helper started and hasn't seen end; each one `status` didn't list is read with `workflow get`, and is cancelled when it is pending or running (paused goes to `paused`). The helper passes every project's unended runs.

- Tests: adapter (an unlisted known run that `get` shows pending is cancelled; one shown completed is left; a listed one isn't read twice); stop.js passes `known` through; the helper hands its unended runs.

## 3. The cap on a paused run

A paused run spends nothing, and Archon cancels only running ones. At its cap, a run Archon shows paused is held by the helper instead: no cancel, no process ending. The cap card says it is held. While held, no answer to its asks goes back (a standing rule's answer waits as under All stop; a director's answer waits undelivered), so it can't carry on past its cap. **Give it more** lifts the hold with the cap raised once, and the waiting answers go through; **Stop** leaves it held.

- Tests: runner (a paused run at its cap is not cancelled or ended and the card says held; an answer to it isn't delivered while held; Give it more delivers it; Stop keeps it held).
