<!-- docs/superpowers/plans/2026-10-30-archon-check-74-findings.md -->
# Check 74's findings and the open items from the Copilot part

Check 74's real Copilot run and the review of pull request #137 left these. One part, one pull request, each fix with a test that fails first. Stand-ins only: no real Copilot request.

## 1. A paused run can be cancelled (HIGH)

**Cause.** Archon's `cancelWorkflow` refuses any run that isn't `running`, and tells the caller to abandon a paused one. Wheelhouse never abandons, because abandon removes the worktree with its uncommitted work (spec 12.3). So a paused run couldn't be cancelled, for Claude runs and Copilot ones alike. All stop goes through the same call and left every paused run paused, on every project. A run answered just before All stop then carried on when the wake came back after the lift, although lifting All stop is meant to start nothing. That is why this is HIGH.

**Change.**
- A third Archon patch, `paused-run-cancel.patch`: `cancel` on a paused run stops any live owner, records it cancelled, and keeps its worktree. It releases the lock and the slot as abandon does, without removing the checkout.
- The adapter's `stopAll` cancels paused runs too. `paused` now lists only those the engine wouldn't cancel. The process snapshot covers them.
- The cap: **Stop** on a held run now cancels it. If the engine refuses, the old behaviour stands (it stays paused, and the record ends it).
- The runner: an ask or a held answer of a run that has ended never comes back after the lift.
- The patched file joins the build pins, `engineInstalled` and `health`, so an engine built without the patch is rebuilt, and no run starts on it.

**Real check.** A scratch copy of the engine with the patch, a no-model workflow paused at an ask, `workflow cancel --json`. No model is called.

## 2. The kits hold for a Copilot project

The hold keeps one file and one card. What changes is what it is checked against, and where.

- The manifest gains a fingerprint of each of Wheelhouse's own skill copies (`copies`), and `inspectCopies` checks them, in `inspectLineage`'s shape.
- `checkLineage` takes `inspect`. A Claude check is unchanged.
- Before a Copilot run starts, the route asks the engine (`checkHold`). It checks the copies, then removes the hold on a match, or writes it and refuses the run on a mismatch. That re-check is where the hold lifts by itself, and the lift is recorded so its card closes.
- The check runs only when both the default branch's configuration and the main checkout's say this computer runs Copilot, as the rule for an agent's own hold has it (ruling P8-33). So editing a working copy can't lift a Claude project's hold.
- Copilot's own session start writes nothing, as before. A Claude session start is unchanged: it still checks the Claude kits, and the next Copilot run's start re-checks.

## 3. The meter

- **Never null for zero.** `runCost` counts a run's requests from its steps whatever the run's source: a cancelled step that counted its prompt still counts. `premiumRequests` is null only where the count can't be known (a run the engine no longer has).
- A cost record whose count is null counts as one request for each step it names, at least one, in the estimate. So an unknown run reads high, never as 0. GitHub's daily figure stays the correction.
- A run that hasn't ended counts too, from the engine's record, so a run left paused doesn't count as nothing.

## 4. One meter for each account

- The meter's file moves from each project to one for the account, under the Wheelhouse home, named by the engine's clean home's sign-in. An account that can't be read shares one file, the cautious side.
- The estimate adds up the cost records of every project on the engine, so two projects on one account share one count against each project's cap.
- One look at a time, so a day's check reads GitHub once and writes one Logbook line.

## 5. The LOWs

- **Skill copies in a reused worktree:** a copy Wheelhouse wrote (it has its own `.gitignore`) is refreshed; a project's own skill of the same name is still kept.
- **The home change's `before`:** records what was there, or says nothing was, rather than `null` for both.
- **The unreadable-figure line:** said once until a reading works.
