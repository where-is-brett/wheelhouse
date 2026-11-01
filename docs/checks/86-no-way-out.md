<!-- docs/checks/86-no-way-out.md -->

# Check 86: no way out of a run (D2)

**Answer:** Yes, nothing in a step reaches a person. In a real engine step the question tool does not exist, and a tool search cannot find it. A plain-chat question at the end of a step went nowhere: it stayed in the step's transcript. The pack itself closes none of this, since none of its 56 AI steps denies the question tool, so the tool's absence rests on how Archon runs a step. Other open tools that reach beyond the folder were found and are listed below. Part 1b should deny the question tool in every step anyway, so the pack stops depending on the engine for it.

## Question

Delegated-decisions design, section 7.5 and section 16, D2. Can any step in the built pack reach the question tool or plain chat? Plan part 0a, step 1: list every AI node and the tools it can reach, then run one real cheap step on the scratch engine whose prompt tells it to use the question tool and then to end on a plain-chat question.

## Tested on

1 November 2026, on macOS 27.0.1 (arm64) with Node.js 22.22.1, Archon v0.13.0's compiled binary and Bun 1.4.3 from `probes/lib/archon.js`, on a scratch engine of its own under the system's temporary folder (`wheelhouse-archon-checks-86`, telemetry off). The step ran on the `small` tier, which Archon resolved to the smallest current model. Claude spend was $0.0086 across two runs.

## Method

- **The pack reading.** `node probes/86-no-way-out/pack.js` reads `engine/archon/pack/*.yaml`, walks every node including those inside a loop group, and keeps those with a prompt or a prompt file.
- **The real step.** `node probes/86-no-way-out/run.js step probes/86-no-way-out/workflows/no-way-out.yaml`. One node, no plugins, whose prompt says to call `AskUserQuestion` with a question, to say so if it has no such tool, and to end its reply on a plain question. Its structured fields record what it tried. The step's session transcript, not its own report, is the evidence.
- **The search.** A second run (`no-way-out-search.yaml`) told the step to look for a tool that could put a question to a person, or notify one, through `ToolSearch`: `select:AskUserQuestion`, `select:PushNotification` and the words "ask user question".

## Evidence

| Leg | Result | What showed it |
|---|---|---|
| The pack | 56 AI nodes in 9 workflows. None names `AskUserQuestion` in `denied_tools`; none sets `allowed_tools` | `pack.js`: 34 deny `Write`, `Edit`, `NotebookEdit` (the reviewers and testers), 6 deny `Edit`, `NotebookEdit` (the pull request text steps), 16 deny nothing |
| The step's tool list | `AskUserQuestion` is not in it | The step named every tool it had: Agent, Bash, Edit, ListAgents, Read, ReportFindings, ScheduleWakeup, Skill, StructuredOutput, ToolSearch, Workflow, Write, then CronCreate, CronDelete, CronList, DesignSync, EnterWorktree, ExitWorktree, NotebookEdit, RemoteTrigger, SendMessage, TaskStop, WebFetch, WebSearch |
| The question tool | Not called, and could not be | "No `AskUserQuestion` tool exists in my tool list". The transcript has no call to it |
| Searching for it | Not found | `ToolSearch` answered "No matching deferred tools found" for `select:AskUserQuestion` and `select:PushNotification`. The words "ask user question" returned only TaskStop, SendMessage, WebSearch, CronCreate and DesignSync |
| Plain chat | Said, and reached no one | The step's last text was "Which one do you want: blue or green?". Archon took the structured output as the node's result and the run completed. Nothing was shown to a person, and no attention event or wait was raised |

### What was not tested

- **The pack's own plugin.** Every real step loads `wheelhouse@wheelhouse`, which brings hooks, skills and rules. The trial step had no plugin, so a tool a plugin adds was not in view.
- **`SendMessage` and `RemoteTrigger` against something real.** They were present, and the scratch had no linked session or trigger to reach, so they were not called. `SendMessage` reaches other sessions, not the person, but in a project with sessions open it could reach one that relays to them.
- **A step that ends in a plain question with no structured output.** The trial node had an output format, as the pack's nodes do.

## What it means for the design

- **Section 7.5 point 1 holds for the engine as run today.** A step's only way to reach the director is an ask, and the plain-chat question lands in the transcript only.
- **Part 1b should close it in the pack as well.** Add `AskUserQuestion` to `denied_tools` for every AI node, and in `pack-check.js` require it. It costs nothing, and it keeps the claim true if a later Archon offers the tool to a step.
- **The tools that remain open for a step** (`SendMessage`, `RemoteTrigger`, `CronCreate`, `ScheduleWakeup`, `WebFetch`, `WebSearch`, `Workflow`, `Agent`) are not a route to the director, so D2 does not ask the pack to close them. The reader's step is different: part 1b takes its tool list from check 87 (an allow-list, not a deny-list).
- **The chat-question count in section 7.5 point 4 stays a count of the First Mate's own chat,** since a step has none.

## Needs the director

Nothing. The scratch engine and project are in the system's temporary folder.
