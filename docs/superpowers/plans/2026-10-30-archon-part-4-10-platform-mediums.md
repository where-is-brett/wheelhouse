<!-- docs/superpowers/plans/2026-10-30-archon-part-4-10-platform-mediums.md -->
# Part 4.10: the MEDIUMs only for GitLab, Windows or Linux

**Goal.** Close the two MEDIUMs that part 4.7 left because they bite only off the Mac or off GitHub: #120's M5 and M7. Both can be tested on the Mac with the platform and the host given to the code. Nothing here needs real Windows.

**How.** One pull request, test first: each fix starts with a test that fails on main.

## The fixes

| # | From | What | Where |
|---|---|---|---|
| 1 | #120 M5 | The engine builds on GitHub only (design on Archon, section 16). A Mac whose projects are all on GitLab still got the engine in step 2, Wheelhouse at user scope and the login start in step 6, and the engine's line on the one card. `engineWanted` now takes the hosts of the projects on this computer, the one being set up included. A project whose host isn't chosen yet counts as one that may be on GitHub. | `scripts/engine/parts.js`, `scripts/setup/tools.js`, `scripts/setup/computer.js`, `scripts/setup/choices.js`, `scripts/setup/engine.js` |
| 2 | #120 M7 | A Windows or Linux computer with a project on the engine could get a 'build engine' health finding that it can't clear, since step 2 installs the engine on the Mac only. The engine is now given to a project only on a computer that runs it, so off the Mac the project's work goes to the old engine and health has no engine checks. Setup's step 7 writes the fetch mirror's rule only where the engine runs. | `scripts/host/helper-main.js`, `scripts/setup/project-files.js` |

## Review

An independent whole-branch review found no BLOCKER or HIGH. Its two MEDIUMs are fixed, each with a test that failed first:
- Off the Mac, step 6 still listed the login start for a project on the engine, through its other trigger (`needsLoginStart`). It now needs a computer that runs the engine. `scripts/setup/computer.js`
- Off the Mac, each visit still asked the helper for the switch's next step, which could write the mirror rule or open the switch's pull request from a computer that never runs the engine. The visit now leaves the switch to a Mac. `scripts/desk/visit.js`

Its LOW stays: before step 3's host is answered, the one card can name the engine for a product that then goes on GitLab. Steps 2 and 6 still leave the engine out.

## Checked and left

- #125's LOW: GitLab nested-group projects get no artefacts folder. A LOW from before #125, not one of the MEDIUMs, so it stays a note.

## Tests

Each touched test file. The full suite is left to CI. No real Archon run is needed.
