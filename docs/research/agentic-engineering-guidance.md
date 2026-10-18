<!-- docs/research/agentic-engineering-guidance.md -->

# Agentic engineering guidance for a Claude Code "Command Centre"

Research brief, compiled 17 October 2026. It covers one orchestrator session that acts as engineering and product manager for a solo director. The orchestrator briefs builder subagents (each in its own git worktree, each opening a pull request), runs independent reviewers, merges, and reports back. It runs for days, across compactions, and keeps continuity through GitHub PR events, CI and a handover document.

**How to read this.** Every claim carries a source link. Most sources are primary: Anthropic engineering posts, the Claude Code docs at code.claude.com, and posts by the named authors. Markers:

- **[secondary]**: the claim comes from commentary, not the original author.
- **[unverified]**: I could not confirm it from a primary source.
- **[inference]**: my own reasoning from the cited sources. It is not a claim made by the source.

Claude Code docs change quickly. The doc pages cited were fetched as Markdown on 17 October 2026, and the version numbers quoted are the ones the pages gave that day.

---

## 1. Anthropic engineering posts

### 1.1 Building effective agents (19 December 2024)
Source: https://www.anthropic.com/engineering/building-effective-agents

- **Workflows and agents differ in who chooses the path.** Workflows are "systems where LLMs and tools are orchestrated through predefined code paths". Agents are "systems where LLMs dynamically direct their own processes and tool usage".
- **Start simple.** "find the simplest solution possible, and only increasing complexity when needed". A single optimised LLM call with retrieval is often enough.
- **The patterns:**
  - prompt chaining;
  - routing;
  - parallelisation, either sectioning or voting;
  - **orchestrator-workers**, where a central LLM decides the subtasks at runtime, delegates them and synthesises the results;
  - **evaluator-optimiser**, where one LLM generates and another critiques in a loop. It fits "when criteria are clear and feedback measurably improves output".
- **Check real results.** Agents should check environmental feedback (tool results, code execution) at each step. They can pause for a human at checkpoints. Stopping conditions such as "a maximum number of iterations" keep the agent under control.
- **Agent-computer interface (ACI).** Spend as much on tool documentation as on human interfaces. Make tools hard to misuse ("Poka-yoke your tools"). Example: requiring absolute file paths removed a whole class of errors.

### 1.2 How we built our multi-agent research system (13 June 2025)
Source: https://www.anthropic.com/engineering/multi-agent-research-system

- **Architecture.** An orchestrator-worker design: a lead agent plans and spawns parallel subagents, each with its own context. It suits broad, parallelisable work. It does not suit tasks where agents must share one context.
- **What a brief must contain.** Each subagent task needs an objective, an output format, guidance on tools and sources, and "clear task boundaries". Vague briefs caused duplicated work and coverage gaps.
- **Cost.**
  - Agents use about 4× the tokens of chat, and multi-agent systems about 15×.
  - Token usage alone explained about 80% of the performance variance on BrowseComp.
  - The prompts encoded explicit effort budgets, for example "Simple fact-finding requires just 1 agent with 3-10 tool calls".
- **Durable state.** The lead agent saves its plan to external memory, because context beyond 200,000 tokens gets truncated. When context runs low it can spawn fresh subagents and hand over through stored notes.
- **Outputs as files.** Subagents store outputs externally and return lightweight references. This avoids the "game of telephone" through the coordinator.
- **Evaluation.**
  - Start early and small: about 20 real queries were enough to show large effects.
  - An LLM judge scored 0.0–1.0 plus pass/fail. A single judge prompt aligned best with humans.
  - Human testers still caught problems the automation missed.
- **Reliability.** Resume from the point of failure rather than restarting, using retries and checkpoints. "rainbow deployments" move traffic gradually so running agents are not disrupted.
- **Limit.** The lead runs synchronously: it waits for each batch, so it cannot steer subagents mid-task, and one slow subagent blocks the rest.

### 1.3 Effective context engineering for AI agents (29 September 2025)
Source: https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents

- **Definition.** Context engineering is "the set of strategies for curating and maintaining the optimal set of tokens (information) during LLM inference".
- **Context rot.** Recall falls as context grows, and every token draws on an "attention budget". The aim is the smallest set of high-signal tokens.
- **System prompts.** Write them at the "right altitude": neither brittle hard-coded logic nor vague guidance. Start minimal and add instructions in response to observed failures.
- **Tools and examples.** Avoid "bloated tool sets". Use a few canonical examples rather than long lists of edge-case rules.
- **Just-in-time retrieval.** Hold lightweight references (paths, queries, links) and load the content when it is needed. "do the simplest thing that works".
- **Long-horizon techniques:**
  - **compaction**: tune for recall first, then precision; clearing old tool results is a light first step;
  - **structured note-taking**, for example a "NOTES.md file";
  - **sub-agent architectures** that return a "condensed, distilled summary" of about 1,000–2,000 tokens.

### 1.4 Effective harnesses for long-running agents (26 November 2025)
Source: https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents

- **Failure modes.** Agents try to do too much in one session and leave half-finished, undocumented work. Later agents see partial progress and declare the job done. Compaction alone was not enough.
- **Two roles:**
  - an **initialiser agent** runs once and writes `init.sh`, a progress log and the first git commit;
  - a **coding agent** runs every later session, makes incremental progress and leaves structured notes.
- **Feature list.** A JSON file with more than 200 features. Each entry has steps and a `passes` flag, and agents may change only that flag: "It is unacceptable to remove or edit tests." JSON was chosen because models are less likely to overwrite it inappropriately than Markdown.
- **`claude-progress.txt` plus git history** lets a fresh session understand the state quickly. Each session ends in a "clean state", like code ready to merge.
- **One feature per session** was critical.
- **End-to-end checks.** Agents marked features done after unit tests or curl checks alone. They did much better when told to test like a user with browser automation.
- **Start-of-session routine:**
  1. `pwd`;
  2. read the git log and progress files;
  3. read the feature list and pick the highest-priority unfinished item;
  4. run `init.sh` and a basic end-to-end test before starting new work.

### 1.5 Writing effective tools for agents, with agents (11 September 2025)
Source: https://www.anthropic.com/engineering/writing-tools-for-agents

- **Evaluation-driven development.** Prototype quickly, then build realistic evals that need multiple tool calls.
- **Fewer, higher-level tools.** "More tools don't always lead to better outcomes". Consolidate multi-step flows into one tool.
- **Names and outputs.**
  - Namespace tools, for example `asana_search`.
  - Return high-signal, natural-language fields rather than cryptic IDs.
  - Offer a `response_format` choice of concise or detailed.
- **Token efficiency.** Use pagination, filtering and truncation with sensible defaults. Make error messages actionable.
- **Descriptions.** Write them as you would for a new hire. Small wording changes have large effects.
- **Improve with Claude.** Feed eval transcripts back to Claude to refactor the tools. Use held-out sets to avoid overfitting.

### 1.6 Claude Code best practices (now a docs page)
The April 2025 engineering post now permanently redirects (HTTP 308) to https://code.claude.com/docs/en/best-practices.

- **Context is the constraint.** "Claude's context window fills up fast, and performance degrades as it fills."
- **Give Claude a check it can run.** "It's the difference between a session you watch and one you walk away from." The page names four levels of gating:
  1. in the prompt;
  2. across a session with `/goal`;
  3. as a deterministic gate with a Stop hook;
  4. as a second opinion from a verification subagent or a dynamic workflow, "so the agent doing the work isn't the one grading it".
- **Evidence over assertion.** Ask Claude to show test output, the commands it ran, or screenshots.
- **Explore, then plan, then implement, then commit.** Skip the plan "If you could describe the diff in one sentence".
- **CLAUDE.md.** Keep it short. For each line ask "Would removing this cause Claude to make mistakes?" A bloated file causes Claude to ignore real instructions. Rules that must always hold belong in hooks.
- **Specs.** Self-contained specs name files and interfaces, state what is out of scope, and end with an end-to-end verification step. Run them in a fresh session.
- **Session hygiene.** After two failed corrections, `/clear` and rewrite the prompt. Compaction can be steered from CLAUDE.md, for example "When compacting, always preserve the full list of modified files…".
- **Writer/Reviewer pattern.** "A fresh context improves code review since Claude won't be biased toward code it just wrote."
- **Adversarial review step.** A subagent reviews the diff in fresh context against the plan. The page also warns: "A reviewer prompted to find gaps will usually report some, even when the work is sound." Ask reviewers to flag only gaps that affect correctness or stated requirements, or you get over-engineering.

### 1.7 Equipping agents for the real world with Agent Skills (16 October 2025; open standard announced 18 December 2025)
Source: https://www.anthropic.com/engineering/equipping-agents-for-the-real-world-with-agent-skills

- **What a skill is.** A skill is a folder with `SKILL.md` plus optional scripts and resources: "organized folders of instructions, scripts, and resources".
- **Progressive disclosure in three levels:**
  1. the name and description sit in the system prompt;
  2. the body loads when the skill is relevant;
  3. linked files load only when needed.
- **Bundled scripts** run deterministically without their code entering context.
- **Best practice.**
  - Start from evaluation: find where agents struggle on representative tasks and build skills to close those gaps.
  - Have Claude capture what worked and what went wrong.
  - Watch the `name` and `description` closely, because they decide when the skill triggers.
- **Security.** Install skills only from trusted sources, and audit the scripts in less-trusted ones.

### 1.8 Posts from 2026
- **Demystifying evals for AI agents (9 January 2026)**, https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents.
  - Vocabulary: task, trial, grader, transcript, outcome, harness. "evaluating an agent means evaluating the harness and model together".
  - Grader types are code, model and human.
  - **Capability evals** should start with a low pass rate. **Regression evals** should stay near 100%.
  - **pass@k versus pass^k.** pass^k is the right measure where every run must succeed: a 75% success rate per trial gives about 42% over three trials.
  - Start with "20-50 simple tasks drawn from real failures". Include should-do and should-not-do cases, and start each trial from a clean environment.
  - Grade outcomes, not paths. "Read the transcripts!"
- **Building a C compiler with a team of parallel Claudes (5 February 2026)**, https://www.anthropic.com/engineering/building-c-compiler.
  - A bash `while true` loop restarts Claude.
  - Tasks are locked through files in `current_tasks/` synchronised with git.
  - Tests are the oracle ("Claude will solve the wrong problem" otherwise), and CI stops new commits breaking old code.
  - Against context pollution: print "a few lines of output", log details to files, and put "ERROR" on the same line as the error so grep finds it.
  - Against time blindness: a `--fast` option runs a 1% or 10% sample.
  - Progress files are "updated frequently".
  - Warning: "it is easy to see tests pass and assume the job is done, when this is rarely the case."
  - Scale and cost: about 2,000 sessions over two weeks, "just under $20,000".
- **Harness design for long-running application development (24 March 2026)**, https://www.anthropic.com/engineering/harness-design-long-running-apps.
  - Uses a **planner, generator and evaluator**. Self-evaluation is lenient, and tuning a standalone sceptical evaluator is "far more tractable".
  - **Sprint contracts**: before each sprint the generator proposes what it will build and how it will be verified, and the evaluator agrees the terms.
  - Agents communicated **through files**.
  - Context resets beat compaction for Sonnet 4.5's "context anxiety". Opus 4.5 "largely removed that behavior", so the resets were dropped.
  - Principle: "every component in a harness encodes an assumption about what the model can't do on its own". Remove components one at a time to find the load-bearing ones. With Opus 4.6 the sprint construct went, the planner stayed, and the evaluator moved to a single pass at the end.
  - Out of the box, Claude is a weak QA agent: it "talked itself into approving" real issues.
  - Cost: the solo run took 20 minutes and cost $9; the full harness took 6 hours and cost $200.
- **Scaling Managed Agents: Decoupling the brain from the hands (8 April 2026)**, https://www.anthropic.com/engineering/managed-agents.
  - The harness (the "brain") is stateless. Sandboxes (the "hands") are "cattle, not pets".
  - "The session is not Claude's context window": it is a durable, queryable event log, so "nothing in the harness needs to survive a crash", and `wake(sessionId)` resumes from the last event.
  - "The resets had become dead weight".
  - Credentials are never reachable from generated code.
- **How we built Claude Code auto mode (25 March 2026)**, https://www.anthropic.com/engineering/claude-code-auto-mode.
  - Users "approve 93% of permission prompts", which produces approval fatigue.
  - A classifier reviews each action and is blind to Claude's reasoning.
  - The full pipeline misses 17% of real over-eager actions ("the honest number").
  - Escalation thresholds: after 3 consecutive denials or 20 in total the session goes to a human. Under `claude -p` the process terminates instead.
- **Code execution with MCP (4 November 2025)**, https://www.anthropic.com/engineering/code-execution-with-mcp.
  - Filter data in code before it reaches the model: "The agent sees five rows instead of 10,000".
  - The example cut tokens "from 150,000 tokens to 2,000 tokens".
- **Measuring AI agent autonomy in practice (18 February 2026)**, https://www.anthropic.com/research/measuring-agent-autonomy.
  - Experienced users auto-approve more ("over 40% of sessions") but also interrupt more ("around 9% of turns"). Oversight moves from approving each step to intervening.
  - "effective oversight doesn't require approving every action but being in a position to intervene when it matters".
  - "Claude Code pauses for clarification more often than humans interrupt it."
  - Requirements to approve every action "will create friction without necessarily producing safety benefits".
- **Trustworthy agents in practice (9 April 2026)**, https://www.anthropic.com/research/trustworthy-agents.
  - Plan Mode moves oversight from individual steps to overall strategy.
  - Questions of preference or intent are the user's to settle. Gaps the agent can resolve itself, such as researching information, are the agent's.
  - Calibrate in both directions: pausing too often erodes useful autonomy.
  - The post says subagents complicate oversight and that coordination patterns are still being explored.
- **Steering Claude Code (claude.com blog, 18 June 2026)**, https://claude.com/blog/steering-claude-code-skills-hooks-rules-subagents-and-more. It compares seven steering methods by when each loads, how it behaves under compaction, and how much authority it has:

  | Method | Load and compaction behaviour |
  | :- | :- |
  | Root CLAUDE.md | Re-read after compaction |
  | Subdirectory CLAUDE.md and path-scoped rules | Lost until their files are touched again |
  | Skills | Re-injected within a shared budget, oldest dropped first |
  | Subagents | Only the final message returns |
  | Hooks | "Bypass compaction entirely" |
  | Output styles | Never compacted; highest instruction weight; replace the default engineering instructions unless `keep-coding-instructions: true` |

  The post says subagents nest "up to five levels deep". The current sub-agents doc says three by default (see 2.1); the doc is newer and more specific.
- **Loop engineering: Getting started with loops (claude.com, 30 June 2026)**, https://claude.com/resources/articles/getting-started-with-loops.
  - Loops are "agents repeating cycles of work until a stop condition is met". The types are turn-based, goal-based (`/goal`, with turn caps such as "stop after 5 tries"), time-based (`/loop`, `/schedule`) and proactive (routines with auto mode).
  - Use a second, fresh-context agent for code review. When a result falls short, encode the fix into the system.
  - On cost: "Pilot before a large run", "Use scripts for deterministic work", and match the polling interval to how often the watched thing changes.
- **Improving skill-creator (claude.com, 3 March 2026)**, https://claude.com/blog/improving-skill-creator-test-measure-and-refine-agent-skills.
  - Skills are either **capability uplift** skills, which may become unnecessary as models improve (evals tell you when), or **encoded preference** skills, which are durable but only as good as their fidelity to the real workflow.
  - Benchmark mode, blind A/B comparator agents, and tuning of descriptions for triggering. Triggering improved on 5 of 6 public skills.

---

## 2. Claude Code primitives (code.claude.com/docs/en)

### 2.1 What each primitive is, how it is distributed, when to pick it

| Primitive | What it is | Distributed by | Pick it when | Source |
| :- | :- | :- | :- | :- |
| **CLAUDE.md / rules** | Instructions loaded every session; rules can be path-scoped | Committed to the repository; user and managed levels | "Always do X" facts. Keep under 200 lines | https://code.claude.com/docs/en/features-overview, https://code.claude.com/docs/en/memory |
| **Auto memory** | Claude-written `MEMORY.md` index plus topic files. The first 200 lines or 25KB load each session | Machine-local, shared across worktrees, not shared across machines or cloud | Learned corrections and preferences | https://code.claude.com/docs/en/memory |
| **Skill** | `SKILL.md` folder. The description is always in context; the body loads on invocation | `.claude/skills/` in the repository, `~/.claude/skills/`, plugins, managed settings | Reusable procedure or reference; "the third time" you paste a playbook | https://code.claude.com/docs/en/skills |
| **Subagent** | Isolated context, own tools, model and permissions; returns a summary | `.claude/agents/`, `~/.claude/agents/`, plugin `agents/`, `--agents` flag | A side task would flood context; tool restrictions; parallel work | https://code.claude.com/docs/en/sub-agents |
| **Hook (settings hook)** | Command, HTTP, MCP-tool, prompt or agent handler run on lifecycle events | `settings.json` (project, user, managed), skill or agent frontmatter, plugins | Must happen "every time with zero exceptions"; guardrails | https://code.claude.com/docs/en/hooks-guide, https://code.claude.com/docs/en/hooks |
| **Plugin** | The packaging layer: a directory of skills, agents, hooks, MCP servers and a hooks module, with a manifest | Marketplaces (`/plugin install x@market`), `--plugin-dir`, skills-directory plugins, claude.ai-synced plugins | You want several components as one versioned unit, reused across repositories or shared | https://code.claude.com/docs/en/plugins/overview |
| **Mod** | A plugin with a JS or TS hooks module that runs inside Claude Code. It can draw panes, bands, status lines and toasts, add commands and tools, rewrite or answer events, run timers and send cross-session messages | Installed as a plugin from a marketplace | You need UI (a pane, a band above the prompt), a custom command with no Claude turn, or to intercept or rewrite events | https://code.claude.com/docs/en/plugins/mods/overview |
| **Dynamic workflow** | A JS script Claude writes; the runtime runs many subagents in the background and returns one result | Saved as a command; can ship in a plugin | Work "outgrows a handful of subagents" or findings need cross-checking | https://code.claude.com/docs/en/workflows |
| **Cross-session messaging** | Plain-text messages between your sessions, local, cross-machine or cloud | Built in (v2.1.224+) | Sessions you run yourself need each other's findings | https://code.claude.com/docs/en/cross-session-messaging |
| **`/goal`** | Session-scoped prompt Stop hook; a small fast model judges a condition after every turn | Built-in command | A verifiable end state | https://code.claude.com/docs/en/goal |
| **`/loop`, cron tools** | Session-scoped recurring prompts | Built in | Polling within an open session | https://code.claude.com/docs/en/scheduled-tasks |
| **Routines** | Saved cloud configuration with schedule, API or GitHub triggers | claude.ai/code/routines, `/schedule` | Durable, machine-independent automation | https://code.claude.com/docs/en/routines |
| **Projects** | One coordinating conversation that starts parallel cloud "threads", with project instructions and memory and an Overview pane | claude.ai/code, Desktop (public beta, Pro and Max) | Work spanning "days or weeks" that you'd "rather describe once" | https://code.claude.com/docs/en/claude-projects |
| **Channels** | MCP server that pushes events (CI, chat) into a running session | Installed as a plugin (research preview) | React to events rather than polling | https://code.claude.com/docs/en/channels |
| **Artifacts** | Live private web page published from a session | Built in (Pro and above) | Output easier to look at than read: dashboards, status boards | https://code.claude.com/docs/en/artifacts |

**Plugin versus standalone component.**
- "Skills, subagents, hooks, and MCP servers all work on their own, without a plugin." Use a plugin "when you want several … packaged as one unit", to install a setup someone else built, or to give your own setup to others with versioned releases (https://code.claude.com/docs/en/plugins/overview).
- The trigger table says package as a plugin when "A second repository needs the same setup" (https://code.claude.com/docs/en/features-overview).
- An enabled plugin is part of **every** session. Its skill and agent descriptions cost context on every turn, its MCP servers run, and its hooks fire (https://code.claude.com/docs/en/plugins/overview).

**Mod versus settings hook versus skill versus MCP server.** From the comparison table in the mods overview (https://code.claude.com/docs/en/plugins/mods/overview):

| | Mod | Settings hook | Skill | MCP server |
| :- | :- | :- | :- | :- |
| What it is | JS or TS functions inside Claude Code's process | A script, HTTP call or prompt run on an event | Markdown instructions | An external tool server |
| Can draw in the interface | Yes | No | No | No |
| Pick it when | You want a pane, a band, a custom command, or to rewrite an event | You want to block, allow or log an event with a script you already have | You keep pasting the same instructions | Claude needs to reach an external system |

- Mods are not sandboxed. A mod "can approve one that an `ask` rule would prompt for, or that one of your own `PreToolUse` hooks blocked". Review one with `claude plugin validate`.

**Skill versus subagent versus workflow versus agent team** (https://code.claude.com/docs/en/workflows, https://code.claude.com/docs/en/agents):

| | Who holds the plan | Where intermediate results live | What survives interruption |
| :- | :- | :- | :- |
| Skill | Claude, following the prompt | The main context | An interruption restarts the turn |
| Subagent | Claude, turn by turn | The parent's context, as a summary only | An interruption restarts the turn |
| Workflow | The script | Script variables | The run is "resumable in the same session" |
| Agent team | A lead supervising peer sessions | A shared task list | Teammates keep running |

- Agent teams are experimental, disabled by default, and do not isolate teammates in worktrees.

**Subagent facts that matter for builders and reviewers** (https://code.claude.com/docs/en/sub-agents):
- **Worktrees.** `isolation: worktree` creates a temporary worktree **branched from the default branch, not the parent's HEAD**. It is cleaned up if nothing changed.
- **Persistent memory.** `memory: user|project|local`.
- **Turn caps.** `maxTurns`, after which the output is marked partial. Also `permissionMode`, `tools`/`disallowedTools`, `skills` (preloaded in full) and `omitClaudeMd`.
- **Nesting.** Subagents can spawn subagents "up to three layers below the main conversation" by default, set by `CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH`.
- **Resuming.** A subagent can be resumed by ID or name with `SendMessage` and keeps its full history. Transcripts are stored under `~/.claude/projects/{project}/{sessionId}/subagents/`.
- **Inherited modes.** If the parent runs in `bypassPermissions`, `acceptEdits` or auto mode, the subagent inherits that mode and its own `permissionMode` is ignored.

### 2.2 Features that matter for a long-running orchestrator

**What survives compaction** (https://code.claude.com/docs/en/context-window#what-survives-compaction):

| Content | After compaction |
| :- | :- |
| Project-root CLAUDE.md, unscoped rules, auto memory, plan-mode plan | Re-injected from disk |
| Invoked skill bodies | Re-injected, capped at 5,000 tokens per skill and 25,000 in total; oldest dropped first; truncation keeps the start of the file |
| Files read or edited | Up to five re-read; a file over 5,000 tokens comes back as a reference only |
| Path-scoped rules and nested CLAUDE.md | Lost until their trigger file is touched |
| Context that hooks added earlier | Summarised with the rest of the conversation |
| SessionStart hooks matching `compact` | Run again, and their output is added |

- Implication: **put the orchestrator's must-never-lose rules in the root CLAUDE.md or a SessionStart(compact) hook, and the most important skill instructions at the top of `SKILL.md`**. To restore a long skill in full, invoke it again (https://code.claude.com/docs/en/skills).

**Hooks** (https://code.claude.com/docs/en/hooks, https://code.claude.com/docs/en/hooks-guide):
- **`SessionStart`** has the matchers `startup | resume | clear | compact | fork`. Supported handlers are `command` and `mcp_tool`. Its output enters context, which makes it the deterministic way to load state (handover, open PRs, CI) on every start and after every compaction. On resume it also receives `seconds_since_last_response`, `context_tokens`, `prompt_cache_likely_expired` and `estimated_cache_write_usd` (v2.1.251+).
- **`PreCompact`** (`manual | auto`) can block compaction. **`PostCompact`** receives `compact_summary` and has no decision control, which makes it useful for logging or for checkpointing state externally.
- **`Stop` and `SubagentStop`** can block with `decision: "block"` and a `reason`, or return `additionalContext`. Their safeguards:
  - Input includes `stop_hook_active`, `background_tasks` and `session_crons`, so a hook can tell "done" from "waiting for background work".
  - **Eight-continuation cap**: after eight consecutive blocks the turn ends. The count resets on any tool call, and `CLAUDE_CODE_STOP_HOOK_BLOCK_CAP` raises it.
  - A SubagentStop block feeds `reason` to the subagent as its next instruction.
  - To inject context into the parent after a subagent returns, use `PostToolUse` on the `Agent` tool.
  - With `SubagentHandback` (v2.1.271+), the report is in `tool_input.message`, not in `last_assistant_message`.
- **Prompt and agent hooks.** A `type: "prompt"` hook makes one model judgment. A `type: "agent"` hook (experimental) spawns a verifier with tools, up to 50 turns. Prefer command hooks in production.
- **Guardrails belong in hooks.** "An instruction like 'never edit `.env`' in CLAUDE.md or a skill is a request, not a guarantee. A `PreToolUse` hook that blocks the edit is enforcement." (https://code.claude.com/docs/en/features-overview)
- **`SubagentStart`** can inject `additionalContext` into every subagent of a type, for example standing builder rules.

**`/goal`** (https://code.claude.com/docs/en/goal):
- The evaluator "doesn't run commands or read files independently". The condition must be demonstrable from transcript output.
- A good condition has one measurable end state, a stated check and its constraints. Add "or stop after 20 turns" as a budget.
- It clears on met, impossible, or unrecoverable errors. It stops if there is no tool use for several turns.
- Background work defers evaluation, with check-ins after 30 minutes that then back off.

**Scheduling** (https://code.claude.com/docs/en/scheduled-tasks):
- `/loop` and cron tasks are **session-scoped**. They fire only while the session is open and idle, and recurring tasks **expire after 7 days**. A self-paced `/loop` is not restored on resume.
- With no prompt, `/loop` runs a built-in maintenance prompt: continue unfinished work, tend the branch's PR, then clean up. "irreversible actions such as pushing or deleting only proceed when they continue something the transcript already authorized".
- For durable scheduling use routines (cloud, minimum interval one hour) or Desktop tasks.
- The **Monitor** tool streams a background script's output and "avoids polling altogether".

**Cross-session messaging** (https://code.claude.com/docs/en/cross-session-messaging):
- Plain text only, read between tool calls. An idle session is woken with a new turn.
- Inbound messages "can't approve anything", "can't change configuration", and commands in them do not run.
- Loops between sessions are throttled, with at most 50 queued messages.

**PR events** (https://code.claude.com/docs/en/claude-code-on-the-web#auto-fix-pull-requests):
- Auto-fix subscribes a cloud session to a PR's review comments and CI failures. Claude pushes clear fixes, asks when a comment is ambiguous, and notes duplicates.
- "GitHub does not emit a webhook when the base branch advances and creates a merge conflict", so conflicts must be polled or rebased by hand.

**Projects** (https://code.claude.com/docs/en/claude-projects). This is effectively a productised Command Centre:
- **Parts.** A coordinator conversation that "sees what threads report back, not every step they take". Threads are separate cloud sessions on their own branches that open PRs and watch them with auto-fix.
- **Standing context.** Project instructions (up to 16,000 characters) and project memory (a `MEMORY.md` index).
- **Overview pane** with Ready for review / Waiting on you / Working / Landing / Idle / Resolved. Desktop notifications on errors or when input is needed.
- **Tuning.** You tune it in conversation ("Only post when something finishes or is blocked", "Run at most two threads at a time"). These preferences are "instructions Claude keeps to, not enforced settings".
- **Recommended brief contents**: purpose, where work happens, how a thread checks its own work, what to do when something is missing ("say exactly what's missing … and stop. Don't substitute, mock, or guess"), and what needs the director's go-ahead.
- **Debugging.** When several threads fail the same way, fix the gap once in the instructions and send one thread before resending the rest.
- **Limits.**
  - Public beta on Pro and Max, not Team or Enterprise.
  - Not available in the terminal CLI.
  - A sandbox that cannot resume restarts from a fresh clone, so "ask Claude to commit and push work in progress".

**Cloud sessions: what carries over** (https://code.claude.com/docs/en/cloud-environments#what-carries-over-from-your-setup):

| Carries over | Does not carry over |
| :- | :- |
| The repository's CLAUDE.md, `.claude/rules/`, `.claude/skills/`, `.claude/agents/` and `.claude/commands/` | **Plugins declared in the repository's `enabledPlugins`** |
| `.claude/settings.json` hooks and permission rules, and `.mcp.json` (single-repository sessions) | User-level skills, agents and plugins |
| Skills enabled on claude.ai | |

- Mods' hooks run in a cloud session for a plugin that reaches it, **but what a mod draws does not appear there** (https://code.claude.com/docs/en/plugins/mods/overview#where-mods-run).
- Whether a project skills-directory plugin (`.claude/skills/<name>/.claude-plugin/plugin.json`) loads in a cloud session: **[unverified]**. Loading depends on workspace trust, and "a cloud session never shows" the trust dialog (https://code.claude.com/docs/en/plugins/loading).

**Mods for director visibility** (https://code.claude.com/docs/en/plugins/mods/api, https://code.claude.com/docs/en/plugins/mods/interface):
- A mod can poll on a timer (`$.clock.every`, for example `gh pr checks`), show `$.ui.status`, toasts or panes, start a turn with `$.prompt.submit`, and send or observe cross-session messages.
- Mods are testable without a session through `claude plugin test` (https://code.claude.com/docs/en/plugins/mods/test).
- Drawing works only in the terminal, the Desktop Code tab and VS Code. A status line script is the lighter alternative for one line of state (https://code.claude.com/docs/en/statusline).

**Evaluating skills and plugins:**
- Seeing a skill trigger "tells you Claude found it, not that it did what you intended". Run realistic prompts in fresh sessions **with and without** the skill (https://code.claude.com/docs/en/skills#evaluate-and-iterate-on-a-skill).
- `claude plugin eval` (v2.1.269+):
  - Runs each case three times by default, plus a no-plugin baseline (`WITH`, `W/OUT`, `Δ`).
  - Graders: regex, `tool_used`, `tool_order`, `llm` rubric.
  - Can gate CI on a threshold.
  - Advice: use regex for long outputs, short LLM rubrics, and one grader on the result plus one on the steps (https://code.claude.com/docs/en/plugin-evals).
- The skill-creator plugin uses `evals/evals.json`, an isolated subagent per run, `grading.json` with evidence, `benchmark.json` comparing with and without the skill on pass rate, time and tokens, blind A/B comparison between versions, and description tuning (https://code.claude.com/docs/en/skills, https://agentskills.io/skill-creation/evaluating-skills).
- `/skill-doctor` reports each skill's context cost and usage (https://code.claude.com/docs/en/skills#find-unused-skills).

---

## 3. Wider industry

- **Cognition, "Don't Build Multi-Agents" (Walden Yan, 12 June 2025)**, https://www.cognition.ai/blog/dont-build-multi-agents.
  - Principle 1: "Share context, and share full agent traces, not just individual messages". Principle 2: "Actions carry implicit decisions, and conflicting decisions carry bad results".
  - Flappy Bird example: parallel subagents build a mismatched background and bird.
  - The default should be a "single-threaded linear agent". For very long tasks, add a compression model.
  - It describes Claude Code's subagents as answering questions and not writing code in parallel.
- **Cognition, "Multi-Agents: What's Actually Working" (Walden Yan, 22 April 2026)**, https://www.cognition.ai/blog/multi-agents-working.
  - What works: "setups where multiple agents contribute intelligence to a task while writes stay single-threaded".
  - Its code-review loop catches about 2 bugs per PR, roughly 58% of them severe, and works best when "coding and review agents do not share any context beforehand".
  - The coder must filter review findings against user intent, to prevent "looping, disobeying the user, doing work that is out of scope".
  - "Managers trained on small-scoped delegation default to being overly prescriptive"; "Agents assume they share state with their children when they don't"; upward communication "doesn't happen by default".
  - Unstructured swarms are "mostly a distraction". The practical shape is "map-reduce-and-manage".
- **OpenAI, "A practical guide to building agents" (2025 PDF)**, https://cdn.openai.com/business-guides-and-resources/a-practical-guide-to-building-agents.pdf.
  - Every run is a loop "until an exit condition is reached", such as a tool call, structured output, error or maximum turns.
  - "maximize a single agent's capabilities first". There are two multi-agent patterns, manager (agents as tools) and decentralised handoffs.
  - Rate each tool's risk as low, medium or high, by read versus write access, reversibility, permissions and financial impact, and use the rating to pause or escalate.
  - Human intervention has two triggers: "Exceeding failure thresholds" and "High-risk actions".
- **HumanLayer, "12-Factor Agents"**, https://github.com/humanlayer/12-factor-agents.
  - Factor 3: own your context window.
  - Factor 5: "Unify execution state and business state". Its benefits include "Recovery: Can resume from any point by just loading the thread" (https://github.com/humanlayer/12-factor-agents/blob/main/content/factor-05-unify-execution-state.md).
  - Factor 6: launch, pause and resume with simple APIs.
  - Factor 7: contact humans with tool calls, via a `request_human_input` intent that carries `urgency`, `format` and `choices`, then save state and wait for a webhook (https://github.com/humanlayer/12-factor-agents/blob/main/content/factor-07-contact-humans-with-tools.md).
  - Factor 9: compact errors into context, with a consecutive-error counter that escalates after about 3 (https://github.com/humanlayer/12-factor-agents/blob/main/content/factor-09-compact-errors.md).
  - Factor 10: small, focused agents of "3-10, maybe 20 steps max" (https://github.com/humanlayer/12-factor-agents/blob/main/content/factor-10-small-focused-agents.md).
  - Factor 12: the agent as a stateless reducer.
  - The one-line descriptions of factors 1–4, 8 and 11–13 are my paraphrases of their titles.
- **Simon Willison**:
  - "Designing agentic loops" (30 September 2025), https://simonwillison.net/2025/Sep/30/designing-agentic-loops/. An agent "runs tools in a loop to achieve a goal". Loops suit "problems with clear success criteria where finding a good solution is likely to involve (potentially slightly tedious) trial and error". Run unattended agents in a sandbox or on "someone else's computer". Issue credentials for test or staging only, and put tight budget limits on anything that can spend money.
  - The *Agentic Engineering Patterns* guide (from 23 February 2026), https://simonwillison.net/guides/agentic-engineering-patterns/:
    - "Don't file pull requests with code you haven't reviewed yourself". Good PRs are small, carry context, and include evidence such as test notes or screenshots (https://simonwillison.net/guides/agentic-engineering-patterns/anti-patterns/).
    - "First run the tests" (https://simonwillison.net/guides/agentic-engineering-patterns/first-run-the-tests/).
    - Test-runner subagents can "hide the full test output from the main coding agent" (https://simonwillison.net/guides/agentic-engineering-patterns/subagents/).
    - The "compound engineering loop": end each project with a retrospective that updates the instructions (https://simonwillison.net/guides/agentic-engineering-patterns/better-code/).
  - "We're going to need default hard budget caps on pretty much everything" (3 October 2026), https://simonwillison.net/2026/Oct/3/default-hard-budget-caps/: caps must be hard, not warning emails.
- **Geoffrey Huntley, "Ralph Wiggum as a 'software engineer'" (14 July 2025)**, https://ghuntley.com/ralph/.
  - The loop is `while :; do cat PROMPT.md | claude-code ; done`, with "one item per loop".
  - Load the plan and specs into context "the same way every loop".
  - The primary context "should operate as a scheduler", delegating expensive work to subagents, but with only one subagent for build and test.
  - "backpressure": tests, type checkers and static analysis reject bad output.
  - Update `AGENT.md` with learnings, "keep it brief".
- **Addy Osmani, "Long-running Agents" (28 April 2026)**, https://addyosmani.com/blog/long-running-agents/.
  - Three walls: finite context, no persistent state, no self-verification.
  - "Write down the done-condition before the agent starts"; "Separate the evaluator from the generator"; "Invest in the session log". Budgets and circuit breakers are needed for cost.
  - "Alignment drift": the goal gets "summarized, then re-summarized".
  - The appreciating skill is "writing specs that survive contact with an autonomous executor".
  - **[secondary]** on Google's Agent Platform (Agent Runtime, Sessions, Memory Bank, a "Mission Control" approval inbox) and on Anthropic's scientific-computing post, which I did not fetch.
- **Cursor, "Scaling long-running autonomous coding" (Wilson Lin, 14 January 2026)**, https://cursor.com/blog/scaling-agents.
  - Flat self-coordination with locks failed: "Twenty agents would slow down to the effective throughput of two or three". Without hierarchy, agents became risk-averse.
  - Planners, workers and judges worked. "Many of our improvements came from removing complexity". An integrator role "created more bottlenecks than it solved".
  - "The right amount of structure is somewhere in the middle". "We still need periodic fresh starts to combat drift and tunnel vision."
- **Google ADK tool confirmation**, https://google.github.io/adk-docs/tools-custom/confirmation/.
  - A tool can "pause its execution and interact with a user or other system for confirmation or to gather structured data before proceeding". This can be a boolean `require_confirmation` or advanced structured responses, and works remotely through REST. Marked experimental.
- **"The harness is the product".** I found the phrase only in secondary blogs (for example https://pub.towardsai.net/the-harness-is-the-product-an-end-to-end-guide-to-harnessing-in-agentic-ai-fcc0a9931526) and could not trace it to a primary source **[unverified]**. The closest primary statements:
  - "evaluating an agent means evaluating the harness and model together" (Anthropic, demystifying evals);
  - "The harness and models matter, but the prompts matter more" (Cursor).

---

## 4. Distilled principles

### (a) Orchestrator to human: keeping the director informed
1. **Let the director intervene; don't make them approve everything.** Effective oversight means "being in a position to intervene when it matters". Per-action approval "will create friction without necessarily producing safety benefits" (https://www.anthropic.com/research/measuring-agent-autonomy). Approval fatigue is real: 93% of prompts get approved (https://www.anthropic.com/engineering/claude-code-auto-mode).
2. **Escalate on explicit thresholds:**
   - repeated failure ("Exceeding failure thresholds"; about 3 consecutive errors) (https://cdn.openai.com/business-guides-and-resources/a-practical-guide-to-building-agents.pdf, https://github.com/humanlayer/12-factor-agents/blob/main/content/factor-09-compact-errors.md);
   - high-risk or irreversible actions, by a risk rating per tool (OpenAI guide);
   - preference or intent questions, which belong to the human (https://www.anthropic.com/research/trustworthy-agents);
   - missing access: "say exactly what's missing … and stop. Don't substitute, mock, or guess" (https://code.claude.com/docs/en/claude-projects).
3. **Make escalations structured.** Each one is a single question with urgency, format and choices, after which the agent saves state and waits (https://github.com/humanlayer/12-factor-agents/blob/main/content/factor-07-contact-humans-with-tools.md).
4. **Report by state, not by step.** Projects groups work as Ready for review / Waiting on you / Working / Landing, and lets the user ask for "Only post when something finishes or is blocked" (https://code.claude.com/docs/en/claude-projects). [inference] A digest should lead with "waiting on you", then "ready", then "done since last digest", then risks and spend.
5. **Show evidence, not claims.** Test output, commands run, screenshots (https://code.claude.com/docs/en/best-practices). Review agent-written PR descriptions too (https://simonwillison.net/guides/agentic-engineering-patterns/anti-patterns/).
6. **Use visual channels where they render.** Artifacts give live status pages (https://code.claude.com/docs/en/artifacts). Mods give panes and status lines, but only in terminal, Desktop and VS Code, not cloud (https://code.claude.com/docs/en/plugins/mods/overview). The Projects Overview and Desktop notifications are another option (https://code.claude.com/docs/en/claude-projects).

### (b) Orchestrator to worker: briefs, reports, isolation
1. **A brief carries:**
   - an objective, output format, tools and sources, and "clear task boundaries" (https://www.anthropic.com/engineering/multi-agent-research-system);
   - the files and interfaces, what is out of scope, and an end-to-end verification step (https://code.claude.com/docs/en/best-practices);
   - how to check the work, what to do when blocked, and what needs approval (https://code.claude.com/docs/en/claude-projects).
2. **Briefs and reports as files, passed by reference.** This avoids the "game of telephone" (https://www.anthropic.com/engineering/multi-agent-research-system). Anthropic's harness agents communicated through files (https://www.anthropic.com/engineering/harness-design-long-running-apps).
3. **Report back a condensed summary**, about 1,000–2,000 tokens (https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents). Give it a fixed structure so the orchestrator can parse it [inference].
4. **Keep writes single-threaded per area, and partition the files.** "Actions carry implicit decisions" (https://www.cognition.ai/blog/dont-build-multi-agents). "writes stay single-threaded" (https://www.cognition.ai/blog/multi-agents-working). Agent teams need partitioned files (https://code.claude.com/docs/en/agents). Use one worktree per builder, remembering that `isolation: worktree` branches from the default branch (https://code.claude.com/docs/en/sub-agents).
5. **Don't over-prescribe.** Managers without deep codebase context become "overly prescriptive", and children wrongly assume shared state (https://www.cognition.ai/blog/multi-agents-working). State the shared priors, such as conventions and decisions, explicitly in the brief (https://www.cognition.ai/blog/dont-build-multi-agents).
6. **Inject standing rules deterministically.** A `SubagentStart` hook's `additionalContext` or a subagent's preloaded `skills` beat repeating rules in every brief (https://code.claude.com/docs/en/hooks, https://code.claude.com/docs/en/sub-agents).

### (c) Token and context efficiency
1. **Keep the orchestrator's context as a scheduler.** "Your primary context window should operate as a scheduler" (https://ghuntley.com/ralph/). Delegate reads and test runs to subagents, which can "hide the full test output" (https://simonwillison.net/guides/agentic-engineering-patterns/subagents/).
2. **Keep always-on context small.**
   - CLAUDE.md under 200 lines, procedures in skills.
   - `disable-model-invocation: true` for side-effecting or rarely used skills, which takes their descriptions out of context (https://code.claude.com/docs/en/features-overview).
   - Enabled plugins cost context every turn (https://code.claude.com/docs/en/plugins/overview).
   - Audit with `/skill-doctor` and `/context`.
3. **Use CLI tools and scripts before reasoning.** "CLI tools are the most context-efficient way to interact with external services" (https://code.claude.com/docs/en/best-practices). "Use scripts for deterministic work" (https://claude.com/resources/articles/getting-started-with-loops). Filter data in code, as in the cut from 150,000 to 2,000 tokens (https://www.anthropic.com/engineering/code-execution-with-mcp).
4. **Keep output terse and grep-able.** "a few lines of output", logs to files, "ERROR" on the same line, a `--fast` sample (https://www.anthropic.com/engineering/building-c-compiler).
5. **Prefer events over polling.** Use PR auto-fix events, Channels or Monitor (https://code.claude.com/docs/en/claude-code-on-the-web, https://code.claude.com/docs/en/channels, https://code.claude.com/docs/en/scheduled-tasks). Match any polling interval to how often the watched thing changes (https://claude.com/resources/articles/getting-started-with-loops).
6. **Budget explicitly.** Multi-agent runs use about 15× chat tokens (https://www.anthropic.com/engineering/multi-agent-research-system). Pilot on a slice first (https://claude.com/resources/articles/getting-started-with-loops). Use hard caps (https://simonwillison.net/2026/Oct/3/default-hard-budget-caps/).

### (d) Loop design: verification, stop conditions, circuit breakers, review independence
1. **Verification is the precondition for autonomy.** "Give Claude a check it can run" (https://code.claude.com/docs/en/best-practices). Add "backpressure" from tests, types and linters (https://ghuntley.com/ralph/). Prefer end-to-end checks to unit tests alone (https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents).
2. **Separate the generator from the evaluator.**
   - Self-grading is lenient; a separate sceptical evaluator is "far more tractable" (https://www.anthropic.com/engineering/harness-design-long-running-apps).
   - The reviewer sees only the diff and the criteria (https://code.claude.com/docs/en/best-practices).
   - No shared context beforehand works best (https://www.cognition.ai/blog/multi-agents-working).
   - Tune the reviewer against human judgement, because out of the box it "talked itself into approving" real issues (harness-design post).
3. **Stop reviewers chasing noise.** Ask them for correctness or requirement gaps only (https://code.claude.com/docs/en/best-practices). The coder filters findings against user intent to prevent loops and scope creep (https://www.cognition.ai/blog/multi-agents-working).
4. **Agree done-criteria up front.** Use a feature list with `passes` flags and the rule "It is unacceptable to remove or edit tests" (https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents). Use sprint contracts (harness-design post). "Write down the done-condition before the agent starts" (https://addyosmani.com/blog/long-running-agents/).
5. **Layer the stop conditions:**
   - maximum turns (OpenAI guide; subagent `maxTurns`);
   - a turn or time clause in `/goal`;
   - the Stop-hook eight-continuation cap and `stop_hook_active`;
   - the auto-mode thresholds of 3 consecutive or 20 total denials;
   - goal stall detection when there is no tool use for several turns (https://code.claude.com/docs/en/goal, https://code.claude.com/docs/en/hooks, https://www.anthropic.com/engineering/claude-code-auto-mode).
6. **Add circuit breakers [inference from cited practice]:**
   - after N consecutive failures on one task, stop and escalate (12-factor factor 9);
   - after two failed corrections, start fresh with a better prompt (https://code.claude.com/docs/en/best-practices);
   - cap review rounds, since review loops can keep "finding new bugs each time" (https://www.cognition.ai/blog/multi-agents-working);
   - use a hard spend cap.
7. **Make critical gates deterministic.** Hooks are "enforcement"; prompt instructions are "a request" (https://code.claude.com/docs/en/features-overview). CI must pass before merge (https://www.anthropic.com/engineering/building-c-compiler).
8. **One item per loop and per builder.** (https://ghuntley.com/ralph/, https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents)

### (e) Durable state across sessions and compactions
1. **State lives outside the context window.** "The session is not Claude's context window" (https://www.anthropic.com/engineering/managed-agents). Keep a plan file, a progress file and a rulebook on disk (https://addyosmani.com/blog/long-running-agents/, https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents). The aim is that "nothing in the harness needs to survive a crash" (managed-agents post).
2. **Use the systems of record as state [inference, consistent with HumanLayer factor 5].** GitHub issues, PRs, CI status and git history are durable and queryable. The handover document should index them rather than duplicate them.
3. **Run a fixed start-of-session routine**: confirm the directory, read git log and progress, pick the next item, run smoke tests (https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents). Automate it with a `SessionStart` hook on `startup|resume|compact` (https://code.claude.com/docs/en/hooks).
4. **Design for compaction.**
   - Root CLAUDE.md and auto memory are re-injected.
   - Skill bodies keep only their first 5,000 tokens.
   - Path-scoped rules and hook-added context get summarised away.
   - So: rules in root CLAUDE.md, the critical skill content first, and live state re-injected by a `SessionStart(compact)` hook (https://code.claude.com/docs/en/context-window#what-survives-compaction).
   - `PostCompact` can log `compact_summary` for audit (https://code.claude.com/docs/en/hooks).
5. **Commit and push often.** Cloud sandboxes can restart from a fresh clone (https://code.claude.com/docs/en/claude-projects).
6. **Re-arm session-scoped schedules.** `/loop` and cron tasks expire after seven days and need the session open. Use routines for anything durable (https://code.claude.com/docs/en/scheduled-tasks).
7. **Write lessons back with an owner and a size limit.** Use the compound engineering loop (https://simonwillison.net/guides/agentic-engineering-patterns/better-code/). Update `AGENT.md` with learnings, "keep it brief" (https://ghuntley.com/ralph/). The auto-memory index is capped at 200 lines or 25KB (https://code.claude.com/docs/en/memory).

### (f) Testing and evaluating a skill or harness
1. **Start from real failures, with 20–50 tasks.** Include should-do and should-not-do cases, start from clean environments, use several trials, and use pass^k where reliability matters (https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents).
2. **Always compare against a baseline**: with and without the skill or plugin, or the old version against the new. A high score alone does not show the skill helped (https://code.claude.com/docs/en/plugin-evals, https://code.claude.com/docs/en/skills#evaluate-and-iterate-on-a-skill).
3. **Measure triggering and output separately.** Use a `tool_used: Skill` grader for triggering and outcome graders for output. Tune descriptions with should-trigger and should-not-trigger prompts (https://code.claude.com/docs/en/plugin-evals, https://claude.com/blog/improving-skill-creator-test-measure-and-refine-agent-skills).
4. **Prefer code graders, keep LLM rubrics short and concrete, and read the transcripts** (https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents, https://code.claude.com/docs/en/plugin-evals).
5. **Track cost as well as pass rate**: tokens and time per run (https://agentskills.io/skill-creation/evaluating-skills).
6. **Run ablations on the harness.** Remove one component at a time to find the load-bearing ones, and re-run after each model upgrade. Capability-uplift skills may become unnecessary (https://www.anthropic.com/engineering/harness-design-long-running-apps, https://claude.com/blog/improving-skill-creator-test-measure-and-refine-agent-skills).
7. **Test deterministic parts deterministically.** Mods have `claude plugin test`; plugin files have `claude plugin validate` (https://code.claude.com/docs/en/plugins/mods/test, https://code.claude.com/docs/en/skills). Use a small pilot before scale (https://claude.com/resources/articles/getting-started-with-loops).

---

## 5. Implications for the Command Centre [inference throughout, built on the sources above]

1. **Choosing the form:**
   - **The orchestrator's playbook should be a project skill** (`.claude/skills/command-centre/`). Project skills carry into cloud sessions. Repository-declared plugins do not, and mods do not draw in cloud sessions (https://code.claude.com/docs/en/cloud-environments, https://code.claude.com/docs/en/plugins/mods/overview).
   - Make it `disable-model-invocation: true` so it runs only when invoked. Put its most important rules first, so they survive the 5,000-token re-injection cap.
   - **Make the builder and reviewer roles custom subagents** in `.claude/agents/`. Use `isolation: worktree` for builders. Give reviewers read-only `tools` and no access to the builder's reasoning. Give both `maxTurns`.
   - **Implement the gates as project hooks** in `.claude/settings.json`:
     - SessionStart on `startup|resume|compact` to print the handover summary and open PR and CI state;
     - PreToolUse to block merges unless CI is green and a reviewer approved;
     - optionally a Stop or SubagentStop check that a builder's report has the required fields.
   - **Use a plugin only once the setup must be reused across repositories** or versioned for others. **Use a mod only for local terminal or Desktop visibility**, such as a status line or pane with PR and CI counts, or a `/digest` command with no Claude turn. It will not render in a cloud session.
   - **Consider a dynamic workflow** for one-off fan-outs such as codebase audits, not for the standing loop.
2. **Weigh Projects.** It already provides a coordinator, threads with PRs and auto-fix, project memory, an Overview pane and notifications (https://code.claude.com/docs/en/claude-projects). It is beta, available on Pro and Max only, not in the CLI, and its tuning is "not enforced settings". If it is available, it may replace much of a hand-built orchestrator. If not, copy its state model (Waiting on you / Ready / Working / Landing) for the director digest.
3. **Communication with the director:**
   - A digest ordered "decisions needed", then "ready to merge", then "merged since last time", then "blocked or risks", then spend.
   - Escalate immediately only on the thresholds in 4(a)2. Everything else batches into the digest.
   - Ask one question per escalation, with options.
4. **Durable state.**
   - GitHub is the system of record. The handover document is a short index that is re-read after every compaction.
   - `/loop` re-arming is part of the start-of-session routine, because of the seven-day expiry.
   - Merge conflicts need polling, because GitHub sends no webhook for them.
5. **Independent review.** Use a fresh-context reviewer per PR, limited to correctness and requirement gaps, with a cap of about two review rounds before escalating. The orchestrator, not the builder, decides which findings to act on, filtered by the brief.

---

## 6. Items I could not verify, and discrepancies

- **Subagent nesting depth.** The current docs say three layers by default; the Steering blog says "up to five levels deep". The docs note that older versions allowed five (https://code.claude.com/docs/en/sub-agents, https://claude.com/blog/steering-claude-code-skills-hooks-rules-subagents-and-more).
- **Project skills-directory plugins in cloud sessions.** Whether they load is not stated. Loading depends on workspace trust, which cloud sessions never prompt for **[unverified]**.
- **"The harness is the product".** Not traced to a primary source **[unverified]**.
- **Google Agent Platform features** (Mission Control, Memory Bank, Agent Runtime "days at a time") come only via Addy Osmani **[secondary]**. The ADK tool-confirmation feature was verified from Google's docs.
- **Anthropic's scientific-computing long-running post** (CLAUDE.md as living plan, CHANGELOG.md, Ralph loop) is cited via Osmani only **[secondary]**.
- **HumanLayer factors 1–4, 8 and 11–13** are described from their titles only. Factors 5, 7, 9 and 10 were read in full.
- **Cognition was reached by direct download** after WebFetch DNS failures; quotes are from the downloaded page text.
- **Session-specific tools.** This session's own PR-event subscription and cross-session tools (for example `subscribe_pr_activity`, `send_message`, `create_trigger`) appear in the session's tool list but were not checked against public documentation **[unverified as documented features]**. The documented equivalents are auto-fix, cross-session messaging and routines.
- **Version-specific facts** quoted from the docs, such as v2.1.251 for SessionStart resume fields and v2.1.269 for `claude plugin eval`, are as stated on 17 October 2026 and may change.
