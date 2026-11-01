<!-- docs/checks/89-off-path.md -->

# Check 89: the off path (D5)

**Answer:** Partly. The planned checks catch a reused switch name, a changed off path that a test sees, a test edited to match, and a switch given in words. They do not catch a changed off path that no test sees, which is the known limit in section 19 of the design. Nothing in this trial fails the design; the third case is as written. Switch undo needs all four checks to run, with the fourth (no test changed) doing real work.

## Question

Delegated-decisions design, section 16, D5, and guardrail 3's switch undo: on a sample change, do the off-path checks catch a reused switch and a changed off path? Plan part 0a, step 3: a slice that reuses a name found in the main line's history, a slice that changes the off path where a test sees it, and one where no test sees it.

## Tested on

1 November 2026, on macOS 27.0.1 (arm64) with Node.js 22.22.1. No engine and no model: a scratch repository in the system's temporary folder, git, `node --test`, and the real `scripts/engine/flag.js --check-off`.

## Method

`node probes/89-off-path/run.js`. The main line has an app with one flag, `new-greeting`, a test file, and a flags file (`config/feature-flags.json`). Long ago the main line carried a flag called `old-banner` that was later removed, so its name is in the history. Each slice is a branch cloned from it, checked by:

0. **The switch is in a file.** A switch given in words has no file, so this undo kind is not available.
1. **The flags file reads off:** `flag.js --check-off`, with a stand-in for the helper's order.
2. **The name is new:** no commit on the main line mentions it (`git log main -S<name>`). The plan has the helper record the name at the feature's start; this reads the same history.
3. **With the switch off, the tests pass.**
4. **No test file changed.**

The pages comparison (screenshots with the switch off) needs a browser and was not trialled.

## Evidence

| Slice | Caught by |
|---|---|
| Reuses `old-banner`, a name in main's history | Check 2. The flags file reads off, the tests pass, no test changed: only the name gives it away |
| Changes the off path (`Hello` becomes `Hi`) where a test sees it | Check 3. The test fails with the switch off |
| The same change, with the test edited to match | Check 4. Checks 1 to 3 all pass |
| Changes the off path (the shipping charge) where no test looks | **Nothing.** All four pass |
| A switch given in words, with the test edited | Check 0. `flag.js --check-off` returned `{ clean: true }` without looking at anything, as the design says; only check 0, and here also check 4, catch it |

### What was not tested

- **The pages comparison,** and a project that lists `pages`.
- **The helper's record of a name at the feature's start.** The trial reads main's history instead, which gives the same answer unless the name was added to main by another branch since.
- **A reuse by renaming** (the same flag in a new spelling) or by a name found only in a deleted branch's history.

## What it means for the design

- **Switch undo works as the design states it, and no check can be dropped.** Each of the four catches something the others miss. Check 4 is the one that catches an edited test; without it, a slice that rewrites a test to fit its change passes.
- **The third case is the known limit and stays in section 19.** An off-path change that no test sees passes all four checks. Part 5 reads this: it is the reason decisions are sampled, and a project with few tests falls back to held.
- **Check 0 matters most for a project whose switch is in words,** where the existing `--check-off` returns clean. Part 5's use of it must test for a file first.

## Needs the director

Nothing.
