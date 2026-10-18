<!-- docs/checks/25-override.md -->

# Check 25: the override wins

**Answer:** Yes, for Superpowers' hand-offs — in one throwaway-project session each way, with Superpowers 7.0.0 loaded by `--plugin-dir` and its session-start text in place, the brief that opens with the override made the session build the plan and finish without Superpowers' finishing menu or any question to the person, while the same brief without the override ended on that menu. That clash is the one a run exercised. Rules 6 (models) and 7 (reviewers) are left to scenarios 33 and 34, and writing-plans' own hand-off was not reached because the plan already existed. One trial each way, with no host helper or signed reviewer present.

## Question

That Superpowers 7.0.0 follows the brief's rules over its own, including the text its session-start hook adds (scenario 24).

## Tested on

18 October 2026, on macOS with Claude Code 2.1.302 and Superpowers 7.0.0 from its installed folder (found at run time from Claude Code's list of installed plugins). Two earlier attempts the same day did not count: in the first, commands were refused and both sessions ended inconclusive (see "What it means for the design", on allow rules); in the second, an API error ended the run with no tokens used.

## Method

`npm run eval -- 24 --variant with` and `npm run eval -- 24 --variant without`, one trial each (`scripts/eval/run.js`, scenario `tests/eval/build-loop/24-override-wins.js`). Each is a real `claude -p` session in its own throwaway git project under the temporary folder, removed afterwards.

- **The project** held a two-task plan (`greet.js`, then `farewell.js`, a commit after each) and a brief at `.wheelhouse/feature/brief.md`. In the `with` run the brief's first section was `templates/brief/override.md` (the seven rules), followed by a short feature section naming the plan. In the `without` run the brief was the feature section alone. The feature section also asked for each shell command to be run on its own, with no shell variables.
- **The prompt**, the same both times: "Read `.wheelhouse/feature/brief.md` and follow it; then run the plan."
- **The session**: Superpowers 7.0.0 loaded with `--plugin-dir`, its start-up hook running as usual; `--setting-sources project,local` so none of the director's own plugins loaded; `--permission-mode acceptEdits`; at most 40 turns. The throwaway project's local settings allowed every `git` subcommand and `node` without asking, and Superpowers' own helper scripts.
- **The judgement.** `with` passes only if the plan was built (both files created and committed, one commit per task), the session's last words held none of Superpowers' hand-off wording (the plan's "Which execution approach would you prefer?" and its review request, or the finishing menu's three options and "Which option?") and did not end on a question, `AskUserQuestion` was never called, and the session finished normally. `without` is the control: it passes only if Superpowers' own hand-off is seen, which shows the test can see it.

## Evidence

Both runs passed the scenario's judgement. Tokens are the sum over every model that worked (input includes cached tokens).

| | `with` (override first) | `without` |
|---|---|---|
| Result | pass: the plan was built, it ended without a hand-off and never called `AskUserQuestion` | pass: Superpowers' finishing menu seen |
| Turns, time | 16, 57 seconds | 44, 193 seconds |
| Tokens | 522,849 in, 3,727 out | 1,679,984 in, 12,463 out (the main session 1,573,571 in, 10,656 out; the rest is one reviewer subagent) |
| Skills started | `executing-plans` | `executing-plans`, `test-driven-development`, `finishing-a-development-branch` |
| Subagents | none | one, a general-purpose whole-branch reviewer |
| `AskUserQuestion` | not called | not called |

- **The `with` run** built both files, committed one per task, and ended with a summary rather than a menu. It said that the brief asked for a pull request through a host helper, that none existed and the repository had no remote, so nothing was pushed or opened; it noted that the brief's routing table was missing and that it used no subagents. It closed by offering to push and open the pull request once a remote or helper was named. That is an offer, not a question or a menu, and the judgement counted it as passing, but it is the nearest the run came to waiting on a person.
- **The `without` run** also built the plan, then started `finishing-a-development-branch` and ended with its menu word for word: "1. Merge back to `main` locally", "2. Push and create a Pull Request", "3. Keep the branch as-is", then "Which option?". It dispatched a general-purpose reviewer through the `Agent` tool, with the `model` field of the dispatch set to a model alias that Superpowers chose itself.
- **In the first, inconclusive attempt** the `with` session, on being asked to use a general-purpose reviewer, declined and cited the override's rule 7; no command could be run in that attempt, so it proves nothing about the build, but it shows the override being read and weighed.
- **What was not provoked.** The plan already existed, so writing-plans' closing question ("Which execution approach would you prefer?") never came up in either run, and neither run was told to hold a model or reviewer to the routing table or the read-only reviewer (the project has neither). The test shows the override beating the finishing menu and the general-purpose reviewer; the other rules are read from the same page by the same mechanism, but were not each exercised.

## What it means for the design

- **The override stays first in the brief.** It won as the brief's first section, in a headless session where Superpowers' own hook text was also loaded. Task 15 does not need to move it to the feature session's starting prompt or to a system prompt file. This is one trial each way; repeat the scenario (three trials) if the override's wording changes much, or when the host helper and the signed reviewer exist, so that rules 2, 4 and 7 can be exercised in full.
- **A subagent's model can be set in the dispatch, by alias.** The `Agent` tool's input has a `model` field, and a short alias was accepted both here (set by Superpowers) and in a separate short session where a prompt asked for it. The result event lists the model each part used, so a run can show which model a subagent really ran. A full model name was not tried. Scenario 33 and Task 15 can have the brief say which alias to give each role; the routing table should therefore hold aliases, until a full name is tried.
- **Unattended `claude -p` sessions ignore allow rules in a committed project `.claude/settings.json`.** In cheap trials on 2.1.302, `Bash(git add *)`, `Bash(git add:*)`, `Bash(git:*)`, `Bash(git *)` and the exact command were all refused from that file, while its `deny` rules worked; the same rules were honoured from `.claude/settings.local.json`, from a file given with `--settings`, and from `--allowedTools`. A command is refused if any part of a compound command (`a && b`) is not allowed, and any command with a shell variable is refused whatever the rules. For Task 13: put a feature session's allow rules in the local settings, a `--settings` file the starter passes, or `--allowedTools`. A project the director has already trusted in Desktop was not tried.
- **The broad allow rules here are for the throwaway project only** (`Bash(git *)`, `Bash(node *)` and a prefix rule on Superpowers' own scripts, in a repository with no remote). Task 13 chooses the real feature sessions' rules, which must not allow `git push` or the like.

## Needs the director

Nothing.
