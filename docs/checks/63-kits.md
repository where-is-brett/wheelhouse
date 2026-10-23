<!-- docs/checks/63-kits.md -->

# Check 63: Superpowers and Matt Pocock's skills on Copilot

**Answer:** Yes, with two gaps. All five loops the build needs ran to the end under Copilot with the override first: brainstorming into writing-plans, writing-plans, subagent-driven development, executing-plans and test-driven development (Superpowers' and Matt Pocock's), and the toy feature was built and tested by each build run. The subagent dispatch did not break, but it names a different tool and needs a different argument from Claude Code's. The two gaps: Copilot's `task` tool refuses a call without a `name` (the first dispatch failed in both loop runs, subagent-driven and executing-plans, and the model corrected it on the next try), and the reviewers that ran were Copilot's built-in `code-review` agent, not a Wheelhouse reviewer.

## Question

Do the pinned kits (Superpowers v7.0.0 and Matt Pocock's skills v1.3.1) run under Copilot as designed, with the Wheelhouse override first in the prompt? Which skill hands off to which, which tools do they call, and where does a loop break, most likely at the subagent dispatch, which names Claude Code's tools?

## Tested on

21 October 2026, on macOS, with Copilot CLI 1.0.101 (the pinned copy under `~/.wheelhouse-probes/`), signed in through a scratch Copilot home. Six real model runs by `probes/63-kits/run.js`, all exit 0, from 34 seconds (brainstorming into a plan) to 272 seconds (subagent-driven). The raw results and the debug logs are kept with the build's working papers, not in the repository.

## Method

`node probes/63-kits/run.js`. The probe fetches each kit at the commit pinned in `lineage/manifest.json` (the same shallow fetch lineage uses), checks every skill folder against the manifest's fingerprint (all 18 matched), and copies the skills Wheelhouse uses into the scratch home's `skills/` folder. That is where Copilot reads personal skills from, and `copilot skill list` showed all 18 there. Each run is a fresh headless Copilot in its own scratch git project: a 20-line `greet.js`, a `package.json` at version 1.2.3 and one test. The prompt starts with the override (`templates/brief/override.md`), then a line saying nobody is reading and where a skill would ask a question to take its recommended option, then the brief ("add a `--version` flag to `greet.js`"), then the stage. Every run uses `--allow-all-tools --no-ask-user` and keeps its debug log. `--disallow-temp-dir` was not used: the skills and their companion prompt files live in the temporary folder. The runs:

- **brainstorm-to-plan.** Start with brainstorming and follow its hand-offs until a plan is written; build nothing.
- **writing-plans.** From a hand-made spec; build nothing.
- **subagent-driven.** Subagent-driven development from a hand-made two-task plan.
- **executing-plans.** Executing-plans from the same plan.
- **tdd-superpowers, tdd-matt.** "Use the test-driven-development (or tdd) skill to build it."

Which skills loaded is read from Copilot's own `skill` tool calls; every tool call (name, success, failure code) from its tool events; the result from the project afterwards (does `node greet.js --version` print `1.2.3`, do the tests pass, what was committed).

### Undo

The probe makes everything under the system's temporary folder and removes it itself, also on Ctrl-C: the scratch home with its copied skills, the kit checkouts and the six scratch projects. Nothing was written to the real `~/.copilot` or `~/.wheelhouse`. What is left is the results folder under `<temporary folder>/wheelhouse-probe-results/`, which can be deleted. Nothing needs undoing by hand.

## Evidence

### Skills and hand-offs

Copilot has a `skill` tool; a call is `{"skill": "<name>"}`. Every skill the runs needed loaded, none failed, and Copilot's `session.skills_loaded` event lists the personal skills it found, from the scratch home's `skills/` folder.

| Run | Skills loaded, in order | Result |
| --- | --- | --- |
| brainstorm-to-plan | brainstorming, writing-plans | plan written, nothing built |
| writing-plans | using-superpowers, brainstorming, (again), writing-plans | plan written, nothing built |
| subagent-driven | using-superpowers, brainstorming, subagent-driven-development, using-git-worktrees, code-review, test-driven-development, verification-before-completion | flag works, tests pass, 2 commits |
| executing-plans | using-superpowers, executing-plans, test-driven-development, using-git-worktrees, verification-before-completion, code-review, finishing-a-development-branch | flag works, tests pass, 2 commits |
| tdd-superpowers | using-superpowers, brainstorming, test-driven-development, verification-before-completion | flag works, tests pass |
| tdd-matt | using-superpowers, tdd, verification-before-completion | flag works, tests pass |

- **The hand-offs between skills work through the `skill` tool.** Brainstorming went to writing-plans on its own. Subagent-driven development called using-git-worktrees, test-driven-development and code-review as it describes; executing-plans reached finishing-a-development-branch and kept the work local, as the prompt said.
- **Superpowers' session-start hook is not loaded under Copilot, and the model loaded using-superpowers itself** in five of the six runs (all but brainstorm-to-plan). So the "check for skills first" rule reaches the agent through the skill's own description, not through the hook. It also means it fires extra skills: three runs started with brainstorming, though the brief was fully specified, and in the writing-plans run the model loaded brainstorming twice and handed the plan's writing to a `task` sub-agent. None of that stopped a loop.
- **Brainstorming skipped its spec.** In brainstorm-to-plan the model treated the brief as fully specified, wrote a plan and no spec file.
- **The override was read, not put to the test.** Nothing asked a question or waited for chat. Rules 1 to 3 (fix rounds, level 3 and 4 matters) never came up in a toy task, and rule 7 (Wheelhouse's reviewer) is covered below.

### Subagents

Copilot's tool for dispatching a sub-agent is `task`, and for collecting its answer `read_agent` (`{"agent_id", "wait", "timeout"}`).

- **`task` needs a `name`.** The arguments are `description`, `prompt`, `name`, an `agent_type` and a `mode` (`sync` or `background`). The first dispatch in subagent-driven and in executing-plans failed with `"name": Required`, and the model repeated it with a name and it succeeded. In writing-plans the first call already had one. A skill that says "dispatch a subagent" without a name will cost one failed call.
- **Agent types seen:** `general-purpose` for the implementers, `code-review` for every reviewer, and `task` for the planner the writing-plans run dispatched (read from the debug logs, which keep the whole arguments; the results file cuts them short). The `code-review` type is Copilot's own agent: its prompt in the debug log is a generic reviewer with a high bar, not Wheelhouse's. The model called them "Wheelhouse's read-only reviewer" in the prompt it wrote, but no agent of that name existed in the scratch home and none was used. So rule 7 (reviews by Wheelhouse's read-only reviewer) was not met by anything the kits did, and could not have been.
- **Subagent-driven development ran as designed otherwise:** an implementer and a reviewer per task (task 1, task 2), a whole-branch reviewer at the end, each answer collected with `read_agent` (five calls), 11 skill calls, and the implementers' DONE reports with a commit and a test count. Executing-plans ran inline and dispatched one whole-branch review.
- **Copilot's `sql` tool carried the task list** (a `todos` table the skills' to-do tracking was mapped onto, three calls in each loop run). Claude Code's `TodoWrite` has no call in these logs.

### Failed calls

Three calls failed in the whole set, out of 203: the two `task` calls without a name, and one `view` of a review-package file that did not exist (subagent-driven; the model went on without it). No call was denied: `--allow-all-tools` was on.

### What was not tested

- Wheelhouse's own reviewer and builder agents (the `code-review` type was the model's choice here), and whether `agent_type` can name a custom agent from the home's `agents/` folder.
- A real brief with questions: the toy task never reached a decision a skill would stop on, and `--no-ask-user` was on.
- A longer loop (more than two tasks), and the failure and fix rounds.
- Matt Pocock's other skills in the manifest (code-review, prototype, domain-modeling, implement) beyond their being found by `skill list`.
- Other models.

## What it means for the design

- **Part 8 Task 2 (the kits on Copilot).** The kits are never edited, and they do not need to be: the five loops ran, with every tool allowed (every run used `--allow-all-tools`). Whether they run under a level's allow rules is untried: check 61 shows that headless, a tool no rule allows is refused at once, and `apply_patch`, `task`, `skill`, `sql` and `read_agent` were not tried under rules. Backgrounded builders on Copilot may use the kits' loops only if Part 7 Task 2's rules allow those tools by name; the first real run must show they ran.
- **The Copilot tool sheet (Part 4 Task 1) gains lines naming Copilot's equivalents:** dispatching a sub-agent is `task` (a `name` is required, plus `description`, `prompt`, `agent_type` and `mode`), reading its answer is `read_agent`, loading a skill is `skill` with `{"skill": "<name>"}`, and the task list is kept in the `sql` tool's `todos` table. Put the `name` requirement in the sheet so the first dispatch does not fail.
- **The reviewer.** A skill's review step reached Copilot's built-in `code-review` agent, not a Wheelhouse one. If rule 7 is to hold on Copilot, the Wheelhouse reviewer has to exist as a custom agent in the home and the tool sheet has to say to use it by `agent_type`; whether that works was not tried here, and is worth one more check before Part 8 relies on it.
- **No session-start hook is needed for using-superpowers**: the model loaded it itself. Do not rely on it, though: brainstorm-to-plan went without it.
- **The override reached the agent as the first text in the prompt and nothing contradicted it**, but little of it was exercised. Nothing waited in chat (rule 4), but the brainstorm-to-plan stage stopped at the plan, so "go straight from the plan to building" was not tried there. Rule 5 (the front desk never plans) is about the front desk, which brainstorm-to-plan is not, so its call to writing-plans says nothing about it. Rule 6 (models from the routing table) had no table to follow: the model weighed whether to name one and no dispatch passed a `model`. The other rules still need a real brief.

## Needs the director

- **Deferred (24 October 2026): the loop's tools under a level's rules.** These runs used `--allow-all-tools`; Part 7 Task 2's rules (`adapters/copilot/permissions.js`) instead allow `task`, `skill`, `sql`, `read_agent` and `write` by name at every level, and nothing else that no rule names. The first real run of a session under those rules (check 61's note says how it runs) records here whether Copilot accepts those names, that `task` and `skill` ran, and that an `apply_patch` inside the worktree went through under `write`.
