<!-- docs/superpowers/plans/2026-10-30-archon-part-4-7-mediums.md -->
# Part 4.7: the Archon build's open MEDIUMs

**Goal.** Before the director's first real use on the Mac, close the MEDIUMs from pull requests #118 to #129 that would bite there, and show a real Archon run's tokens in the evaluation's report.

**How.** One pull request, test first: each fix starts with a test that fails on main. Safety, money (caps and spend) and stuck work come first. At most about eight fixes; the rest are listed below.

## Fixed here

| # | From | What | Where |
|---|---|---|---|
| 1 | #128 | Stop on a held run left it paused and holding a build slot. Stop now ends it in the record, so the slot is free. The run stays paused in Archon and spends nothing. It is never abandoned, because abandoning removes the worktree's uncommitted work. Its asks never become cards. | `scripts/engine/runner.js` |
| 2 | #128 | With skip-worktree set, git refuses a rebase, merge, checkout or pull that changes `.claude/settings.json`. `order-copy.js --release` puts the branch's own settings back and clears the mark. `pack-check` refuses a script step that moves the worktree before it releases. The shared rules tell AI steps to build on the branch as it is. | `scripts/engine/order-copy.js`, `scripts/engine/pack-check.js`, `prompts/rules.md` |
| 3 | #120 M1 | The hello trial's `.env` read was refused by Claude Code's own deny rule, so a pass didn't prove the plugin's hooks loaded. Also, the tool guard does nothing in a folder that isn't a project. The trial project now switches the plugin on and leaves out Standard's `**/.env` rules. A pass needs the refusal to be the tool guard's own words, and the `.env` is committed. | `scripts/engine/hello.js`, the hello workflow and prompt |
| 4 | #120 M3 | Uninstalling one project, while others stay, left its fetch mirror in `engine/mirrors/`. That mirror is now removed. The other projects' mirrors stay. | `scripts/setup/uninstall.js` |
| 5 | #120 M6 | The broker launcher names setup's Node.js and a versioned plugin path, and nothing checked it after an update. Engine health now finds a launcher that is missing, unknown, or names a program that is gone. A run's start is refused while the launcher names a gone program. Setup's step 2 already rewrites it. | `scripts/engine/parts.js`, `scripts/engine/archon/adapter.js` |
| 6 | brief | The eval report's token meter read 0 for real Archon steps. The world now adds up each run's spend from Archon's own records, the health trial's too. That goes into the run record's `usage`, which the summary adds up. | `scripts/eval/archon-world.js`, `scripts/eval/run.js` |
| 7 | #118 | A Fix it forward or Undo answer was lost when its start was refused, and work stayed held with no note. The answer is now kept and tried again on later ticks, with one Logbook line saying why. | `scripts/engine/dispatch-run.js` |
| 8 | #118 | A fix still running when main turned green by itself was refused at merge, and its PR was left open with no word. Closing the incident now stops a fix that is still running. A fix whose PR wasn't added gets a Logbook line naming the PR. | `scripts/engine/dispatch-run.js` |
| 9 | #127 | A quick, small or bug PR closed unmerged left its work out of the queue with no word. When every run has ended and the newest PR is closed, the work gets a `closed` report and one Logbook line. | `scripts/engine/dispatch-run.js` |

## Dropped: already fixed

- #118, `/state/write` accepting red-main incident fields: closed in #118 itself (`RED_MAIN_FIELDS` in the helper).
- #120 M2 and M4: fixed in #124.
- #123: a closed slice PR, Stop or a rejected demo holding the lane; the merged report for quick and small work; polling closed PRs; the report flag set before the report. All are fixed in #127.

## Dropped: only on Windows, Linux or GitLab (they stay as notes)

- #120 M5: a GitLab-only director on a Mac still gets the engine.
- #120 M7: a Windows or Linux computer gets a build-engine health finding it can't clear.

## Left open, for a later part

- #118: no helper-level merge test through `doMerge` with `fixCall`, and no test of `brokerPermit`'s rerun lookup. A fix needing a new dependency goes to the director, because every change to `package.json` is refused. Scenario 60 doesn't play the merge. "Last step only" rests on step order. The incident closes on the helper's own reading of the checks.
- #119: a CLEAN lens from an earlier round is signed at the final head (ruling 5 allows this). The budget covers only the build tasks. Round state on resume is partly in the artefacts (it fails closed).
- #122: a fresh branch can get an older kept reproduction. The red step's clean-tree check skips ignored files.
- #123: null slice heads in the order, the contrast check, the `approved.js` import, and the tester's own judgement.
- #124: a switched project's helper-written mirror rule and its `.archon/` files stay until the last uninstall. With the GitHub App, the switch waits for a login.
- From fix 2: a Claude step's own git use is held only by the shared rules' line. A hook check would be stronger.
- From the review: a red-main fix that is paused at its cap when the main line turns green can't be cancelled, since Archon cancels only running runs. The Logbook says so. It spends nothing.
- From the review: with the plugin on in the hello trial's folder, the session start treats the folder as one being set up. That adds its note to the trial step's context, which is noise, not a risk.
- From the review: a PR seen closed and then reopened is never asked about again. Since #127 this now ends its work with a `closed` report.
- From fix 2: `--release` can't see git calls made inside a Node script step.
- From fix 3: the eval world's own health trial (`archon-world.js`, `prove`) still counts any refusal, since its project keeps Standard's `.env` rules.

## Review

An independent whole-branch review found no BLOCKER and one HIGH, now fixed with a test that failed first. After Stop on a held run, an answer to one of that run's earlier cards still went to the engine and resumed the run, past its record's end. Such an answer is no longer sent, the Logbook says so, and the run's unshown asks are dropped. Also fixed:
- MEDIUM: a red main line's first fix whose start was refused said nothing.
- MEDIUM: a play that threw lost its tokens.
- LOW: `git merge-base` and `git -C <dir> rebase` were misread by the pack check.

## Tests

Each touched test file, then `tests/scripts/engine`, `tests/scripts/eval`, `tests/engine` and `tests/scripts/setup/uninstall*`. The full suite is left to CI. No real Archon run is needed.
