<!-- docs/research/model-presets-2026-10.md -->

# Model and effort presets: what the tools allow, and how to keep a preset robust

Research brief, compiled 24 October 2026, for design section 14.6 (Thoroughness), with sections 8 and 9.1, and checks 74 and 75.

**The question.** Thoroughness (Lean · Balanced · Thorough) sets three things at once: which model does each job, the thinking effort for each, and the extra checks. The director only ever picks a level, so each level must keep working when a model is missing, rate-limited or retired. What can Claude Code and Copilot actually control? What does Anthropic advise? How do other tools present presets? What should Wheelhouse do?

**How to read this.** Every claim carries a source link. Most sources are primary: vendor documentation, changelogs and vendor posts. Markers:

- **[secondary]**: the claim comes from commentary or a third party, not the original author.
- **[unverified]**: I could not confirm it from a primary source.
- **[inference]**: my own reasoning from the cited sources. It is not a claim made by the source.

Pages were read on 24 October 2026. Claude Code version numbers are the ones its pages gave that day. Models are named by class throughout (the premium, the most capable, the mid-sized and the smallest model), as the design does; Claude Code's aliases and the full names they stood for are left to the routing table and the cited pages ([model configuration](https://code.claude.com/docs/en/model-config#model-aliases)). Quotations that name a model are given in paraphrase.

---

## Summary

- **Claude Code can set a model and an effort for every session and every subagent call:** `--model` and `--effort`, `model` and `effort` in a subagent's file, and both as parameters on each call (effort from v2.1.292). One trap: the `CLAUDE_CODE_EFFORT_LEVEL` variable overrides every subagent's own effort, so the watcher must use the flag (section 1).
- **In `-p` mode, the premium model can bill money without asking.** On some plans its use goes to usage credits, and in non-interactive mode "Claude Code bills it without asking" ([model configuration](https://code.claude.com/docs/en/model-config)). Max plans give it a separate weekly limit that the status line doesn't report. The opt-in is a money decision, not only an allowance one.
- **The weekly allowance is shared across models.** Once it runs out, "switching models doesn't restore access", and work is blocked until the reset ([errors](https://code.claude.com/docs/en/errors#youve-hit-your-session-limit)). `rate_limits` reaches the status line only for Pro and Max, not Team or Enterprise seats ([status line](https://code.claude.com/docs/en/statusline#rate-limit-usage)).
- **Fallbacks cover outages and retirements, not limits.** `--fallback-model` switches for one turn when a model is "overloaded or not available, for example a retired model"; "rate-limit… errors never trigger a switch" ([model configuration](https://code.claude.com/docs/en/model-config#fallback-model-chains)). A wrong model name fails only on the first request.
- **Others converged on three named tiers:** Copilot's Efficiency, Balance, Intelligence ([GitHub](https://docs.github.com/en/copilot/concepts/auto-model-selection)) and Cursor's Cost, Balance, Intelligence ([Cursor](https://cursor.com/docs/models)). Cursor's worst confusion came from "unlimited" that applied to one mode only ([Cursor](https://cursor.com/blog/june-2025-pricing)).
- **The price gap is narrower than the names suggest.** The most capable model costs twice the mid-sized one per token; the premium model two and a half times the most capable ([pricing](https://platform.claude.com/docs/en/about-claude/pricing)). "The model setting is roughly how capable; the effort setting is roughly how thorough" ([blog](https://claude.com/blog/claude-model-and-effort-level-in-claude-code)).
- **What it means for Thoroughness** [inference]: keep three levels with Claude Code's effort names; pin each class by full ID with a fallback within the class; pass effort by flag; probe at setup and after updates, never the premium model; treat the premium opt-in as possibly spending money. Section 6.

---

## 1. Claude Code's controls

### 1.1 Choosing a model

- **Aliases.** `default` "clears any model override and reverts to the runtime default for your account". `best` stands for the premium model where the account has it, and otherwise for the most capable model. A split alias uses the most capable model in plan mode and the mid-sized model for the work after it ([model configuration](https://code.claude.com/docs/en/model-config#model-aliases)).
- **Aliases move as Claude Code updates.** The version-history table shows the most capable model's alias moving to a new model at v2.1.154, v2.1.219 and v2.1.280 ([version history](https://code.claude.com/docs/en/model-config#version-history)). "To pin to a specific version, use the full model name".
- **Order of precedence:** `/model`, then `--model`, then `ANTHROPIC_MODEL`, then the `model` setting, then `ANTHROPIC_DEFAULT_MODEL` ([setting your model](https://code.claude.com/docs/en/model-config#setting-your-model)).
- **Subagents.** A subagent's model is resolved in this order: "the per-invocation `model` parameter", then the definition's `model` frontmatter, then `CLAUDE_CODE_SUBAGENT_MODEL`, then the main conversation's model ([subagents](https://code.claude.com/docs/en/sub-agents#choose-a-model)). Setting `CLAUDE_CODE_SUBAGENT_MODEL_FORCE=1` makes Claude Code ignore both the definition and the per-call value.
- **Organisation limits.** An admin can block models with `availableModels`. A blocked `--model` is replaced "at startup with a warning naming both the requested and substituted models, and the session starts on the default model" ([restrict model selection](https://code.claude.com/docs/en/model-config#restrict-model-selection)). In a `-p` run nobody sees that warning [inference].

### 1.2 Effort and thinking

- **Levels.** Effort can be `low`, `medium`, `high`, `xhigh` or `max` on the current premium, most capable, mid-sized and smallest models. The previous generation of the most capable and mid-sized models has no `xhigh`. An unsupported level falls back to "the highest supported level at or below the one you set" ([adjust effort](https://code.claude.com/docs/en/model-config#adjust-effort-level)).
- **Defaults differ by model.** The current most capable, mid-sized and smallest models default to `medium`. Most others default to `high`. "The effort scale is calibrated per model, so the same level name does not represent the same underlying value across models" (same page).
- **How to set it.** `--effort` sets it for one session ([CLI reference](https://code.claude.com/docs/en/cli-reference)), as does `CLAUDE_CODE_EFFORT_LEVEL`. The `effortLevel` setting takes `low` to `xhigh`, "not `max`". A subagent's `effort` frontmatter "overrides the session level but not the environment variable" ([model configuration](https://code.claude.com/docs/en/model-config#set-the-effort-level); [subagents](https://code.claude.com/docs/en/sub-agents#choose-a-model)). v2.1.292 added "an `effort` parameter to the Agent tool" ([changelog](https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md)).
- **Thinking.** On the current models, "You can't turn thinking off". `MAX_THINKING_TOKENS` matters only for older ones. Effort "is the primary control for how much the model reasons" ([model configuration](https://code.claude.com/docs/en/model-config#extended-thinking); [effort](https://platform.claude.com/docs/en/build-with-claude/effort)).
- **Caps.** `maxEffortLevel`, and Enterprise per-role caps, lower the level silently. In `-p` the only sign is a stderr warning in plain-text output, or a debug-log line with JSON output ([organisation effort limits](https://code.claude.com/docs/en/model-config#organization-effort-limits)).

### 1.3 Fallbacks

- **For an unavailable model.** `--fallback-model a,b` or the `fallbackModel` setting gives up to three models. They are used when the primary is "overloaded, unavailable, or returns another non-retryable server error", including a retired model pinned in settings. The switch lasts "for the current turn only". The chain also covers subagents. "Claude Code doesn't confirm the chain at startup" ([fallback chains](https://code.claude.com/docs/en/model-config#fallback-model-chains)).
- **For flagged content.** When a safety classifier flags a request, the most capable and premium models re-run it on older models, and "the session continues on the fallback model" ([automatic fallback](https://code.claude.com/docs/en/model-config#automatic-model-fallback)).
- **Errors are reported.** For scripts, `-p --output-format stream-json` sends a `system/api_retry` event with an `error` category, such as `rate_limit`, `overloaded` or `model_not_found`. The `system/init` event reports the model actually in use ([headless](https://code.claude.com/docs/en/headless)).

### 1.4 Usage and limits

- **The status line** gets `rate_limits.five_hour` and `rate_limits.seven_day`, each with `used_percentage` and `resets_at`. They appear "only for claude.ai Pro and Max subscribers… and only after the first API response in the session" ([status line](https://code.claude.com/docs/en/statusline#rate-limit-usage)). There is no field for the premium model's own weekly limit.
- **`/usage`** shows plan bars and reset times. It can show "last-known usage" up to 60 minutes old when its fetch is rate-limited. It also suggests changes such as "Switch from max to high effort · /effort high" ([costs](https://code.claude.com/docs/en/costs)).
- **On hitting a limit.** Claude Code "blocks further requests until the reset time". Session and weekly limits are "shared across all models"; separate per-family limits apply to one family each, so switching family keeps work going. It warns first, for example at "85% of your session limit" ([errors](https://code.claude.com/docs/en/errors#youve-hit-your-session-limit)).
- **The premium model's limit.** On Max plans the premium model has a separate weekly limit of its own ([support](https://support.claude.com/en/articles/11145838-use-claude-code-with-your-pro-or-max-plan)). Its use "can bill to usage credits": interactive sessions ask first, background sessions end the turn after five unanswered minutes, and `-p` "bills it without asking" ([model configuration](https://code.claude.com/docs/en/model-config)).

### 1.5 The advisor

The advisor tool lets a cheaper main model consult a stronger one "at decision points rather than on every turn", which "typically costs less than running the stronger model throughout". It is experimental, works on Anthropic's own service only, and stays off when telemetry is off. A refused pairing carries on without it, with "no error" ([advisor](https://code.claude.com/docs/en/advisor)).

---

## 2. Anthropic's guidance on model and effort

- **Which model for which work.** The mid-sized model for "edits you can describe precisely, mechanical changes"; the most capable for "subtle bugs, unfamiliar domains, or architecture decisions"; the premium model for jobs the most capable and mid-sized models can't finish at any effort ([blog, 7 July 2026](https://claude.com/blog/claude-model-and-effort-level-in-claude-code)).
- **Smaller model, more effort, or bigger model, less?** The post's test for a failure: "did Claude not know enough or did it not try hard enough?" Not knowing points to a bigger model, not trying to more effort. On tasks that stretch the smaller model, the bigger one "reaches the same quality bar in fewer steps", so "the total cost per task can come out lower".
- **Effort per model.** For the mid-sized model in agentic coding, "start with `medium` for well-specified tasks and move to `high` for harder or longer ones"; `low` suits "simpler tasks… such as subagents" ([effort](https://platform.claude.com/docs/en/build-with-claude/effort)). The current most capable model at `medium` "matches or exceeds" its predecessor at `high`, and `max` "is prone to overthinking" ([model configuration](https://code.claude.com/docs/en/model-config#choose-an-effort-level)).

**Prices per million tokens, input and output** ([pricing](https://platform.claude.com/docs/en/about-claude/pricing)):

| Class | Input | Output | Compared with the mid-sized model |
|---|---|---|---|
| Premium | $10 | $50 | 5× |
| Most capable | $4 | $20 | 2× |
| Mid-sized | $2 | $10 | 1× |
| Smallest | $0.10 (up to 100K-token prompts) | $0.50 | 0.05× |

Subscription allowances aren't published in tokens [unverified]. I assume the share of the allowance a job uses follows these ratios roughly [inference]. Higher effort raises output, the dearer side, on any model ([effort](https://platform.claude.com/docs/en/build-with-claude/effort)).

---

## 3. How other tools offer presets

| Tool | The preset | What it does | What it costs |
|---|---|---|---|
| **GitHub Copilot** | Auto, with tiers Efficiency, Balance and Intelligence | Picks a model per task from "real-time system health and availability" and task complexity. It excludes models outside the plan or blocked by policy ([auto](https://docs.github.com/en/copilot/concepts/auto-model-selection)) | 10% off model costs on paid plans |
| **Copilot billing** | AI Credits from 1 June 2026, replacing premium requests | Cost follows model and tokens. Older annual plans keep multipliers. The fallback to a cheaper model when the allowance runs out ends; usage is then governed by credits and admin budgets ([GitHub blog](https://github.blog/news-insights/company-news/github-copilot-is-moving-to-usage-based-billing/)) | Pro: $10 of credits a month |
| **Cursor** | Auto: Cost, Balance, Intelligence. Max Mode | Individual plans get only Cost mode. Max Mode, on older plans, extends the context "billed at the model's API rate plus 20%". "Requests are never downgraded in quality or speed" ([Cursor models](https://cursor.com/docs/models)) | A weekly pool, then prepaid credit |
| **Codex CLI** | `model_reasoning_effort`, `plan_mode_reasoning_effort`, `agents.default_subagent_reasoning_effort`, profiles | Effort is set per mode, and separately for spawned agents ([Codex config](https://learn.chatgpt.com/docs/config-file/config-reference)) | Not researched |

Windsurf was not researched.

**What worked and what confused people:**

- **Cursor, July 2025.** "We were not clear that 'unlimited usage' was only for Auto and not all other models." Calling a pool "rate limits" "wasn't an intuitive way to describe the limit". Cursor refunded surprise charges and promised that usage limits would be shown on its dashboard ([Cursor](https://cursor.com/blog/june-2025-pricing)).
- **Copilot's desktop app.** A report says it ignores a custom agent's model and effort when the agent is chosen in its composer [secondary] ([issue 5241](https://github.com/github/copilot-cli/issues/5241)).
- **The pattern** [inference]. Three tiers named after the trade-off, and a cost stated next to each, are now the norm. Confusion comes when one name covers different costs, or when a limit's name hides what it limits.

---

## 4. Robustness

**What happens when a model can't be used:**

| Case | Claude Code | Copilot |
|---|---|---|
| Wrong name, or the account lacks access | Not checked at start. The first request fails with "There's an issue with the selected model". In `-p` the hint says to run `--model` ([errors](https://code.claude.com/docs/en/errors#theres-an-issue-with-the-selected-model)) | A custom agent's `models` list uses "the first model the user's plan can access". If none works, it uses the session's model ([CLI reference](https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-command-reference)) |
| Blocked by the organisation | The session starts on the default model with a warning ([errors](https://code.claude.com/docs/en/errors#model-is-restricted-by-your-organizations-settings)) | A model "that can't be honored falls back to the session's value". With `modelPolicy: "required"`, "dispatch is refused" instead (same page) |
| Overloaded | Up to 10 retries, then an error. The fallback chain applies ([errors](https://code.claude.com/docs/en/errors#automatic-retries)) | Auto routes around it ([auto](https://docs.github.com/en/copilot/concepts/auto-model-selection)) |
| Usage limit reached | Blocked until the reset. No fallback ([errors](https://code.claude.com/docs/en/errors#youve-hit-your-session-limit)) | The run stops at the credits limit ([session limit](https://docs.github.com/en/copilot/how-tos/copilot-cli/use-copilot-cli/set-session-limit)) |
| Retired | "Requests to retired models fail". At least 60 days' notice ([deprecations](https://platform.claude.com/docs/en/about-claude/model-deprecations)). The fallback chain covers it. Claude Code warns about "a scheduled retirement" ([model configuration](https://code.claude.com/docs/en/model-config)) | About a month's notice. Mid-October retirements were announced on 18 September ([GitHub](https://github.blog/changelog/2026-09-18-upcoming-deprecation-of-selected-github-copilot-models-in-mid-october/); [GitHub](https://github.blog/changelog/2026-10-19-github-copilot-models-deprecated-on-october-19-2026/)) |
| Claude Code too old for the model | An error naming the minimum version, `claude_code_version_too_old` ([errors](https://code.claude.com/docs/en/errors#claude-code-does-not-support-this-model)) | Minimum IDE versions are listed per model ([supported models](https://docs.github.com/en/copilot/reference/ai-models/supported-models)) |

**Checking availability.**

- **The model list.** `GET /v1/models` lists models with `lifecycle`, `retires_at`, `line` and the effort levels each supports ([List Models](https://platform.claude.com/docs/en/api/models/list)). It needs an API key, which a subscription sign-in doesn't provide [inference].
- **A probe.** What works for the director is a tiny run per class: `claude -p --model <id> --max-turns 1 --output-format stream-json`. Then read `system/init` for the model actually used, and any `model_not_found` ([headless](https://code.claude.com/docs/en/headless)). Each probe uses a little allowance [inference].
- **The current pins** stay active until at least September 2027 ([deprecations](https://platform.claude.com/docs/en/about-claude/model-deprecations)).

---

## 5. Copilot

| Control | Copilot CLI | VS Code Copilot |
|---|---|---|
| Model per session | `--model`, `COPILOT_MODEL`, `/model`. `auto` is allowed ([CLI reference](https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-command-reference)) | The model picker |
| Model per custom agent | `model`, or `models` in order of preference, plus `modelPolicy` (same page). Under Auto, "subagents always inherit the resolved session model regardless of this field" | `model`, a single model or "An array specifies models in preference order" ([VS Code](https://code.visualstudio.com/docs/agents/reference/custom-agent-file-reference)) |
| Effort | `--effort` / `--reasoning-effort`: `low` to `max`. `reasoningEffort` per agent. A per-call value takes precedence | `reasoning-effort` per agent, `low` to `max` (same VS Code page) |
| Reading usage | `/usage` shows per-model credits for the session. `--max-ai-credits` sets a soft cap per run. "Each credit equals $0.01" ([session limit](https://docs.github.com/en/copilot/how-tos/copilot-cli/use-copilot-cli/set-session-limit)) | Not researched. The month's credits left, as a figure a script can read, is [unverified] |

---

## 6. What it means for Thoroughness [inference]

### 6.1 The table

Keep section 14.6's table, with five changes:

1. **Claude Code's effort names:** `low`, `medium`, `high`, `xhigh`. Never `max`: it overthinks and can't be saved in a setting.
2. **An effort belongs to its cell.** The same level name means different amounts on different models, so the evaluation that moves a pin (section 9.1) also checks that class's efforts.
3. **Mechanical builds at Lean: mid-sized, `low`,** as Anthropic suggests for simple subagent work.
4. **Builders at Lean: mid-sized, `medium`, and `high` when sent back,** following Anthropic's advice for that model. A rework costs more than a little more effort.
5. **Effort by `--effort` on each wake and the `effort` parameter on each subagent call,** never `CLAUDE_CODE_EFFORT_LEVEL`. This answers most of check 74. Setup checks for Claude Code v2.1.292 or later.

| Job | Lean | **Balanced** | Thorough |
|---|---|---|---|
| Front desk | most capable, its default | the same | the same |
| Foreman | mid-sized, `low` | mid-sized, `medium` | most capable, `medium` |
| Design and critical work | most capable, `medium` | most capable, `high` | most capable, `xhigh` (premium model at `high` if opted in) |
| Reviews of critical work | most capable, `high` | most capable, `high` | most capable, `xhigh` |
| Well-defined builds, tester | mid-sized, `medium` (`high` on rework) | most capable, `medium` | most capable, `high` |
| Mechanical builds | mid-sized, `low` | mid-sized, `medium` | mid-sized, `medium` |
| Routine reviews | mid-sized, `medium` | mid-sized, `high` | most capable, `high` |

- **The premium model at `high`,** its documented starting point; `xhigh` multiplies the dearest model's output.
- **Never `best`, `default` or the split plan-and-do alias in the table.** `best` quietly becomes the premium model where available, `default` moves with updates, and the split alias needs plan mode, which wakes don't use.
- **Not the advisor yet.** The mid-sized model advised by the most capable fits Lean's builders on paper, but it is experimental and fails silently. Revisit later.

### 6.2 The premium model's opt-in

- **Only at Thorough, only for `feature` and `builderCritical`,** as drafted.
- **The card must say it may cost money.** A `-p` wake "bills it without asking", so the Yes is consent to that billing for every premium wake. The card should say whether usage credits are on, and that on Max it has its own weekly limit Wheelhouse can't see. Add to "What this is": "It may also be paid from your usage credits, not your allowance."
- **Nothing touches it before the Yes,** not even a probe, which could be billed.
- **Moving down a level** leaves the opt-in recorded but idle: "On at Thorough (not in use now)". Back at Thorough, it resumes with no new card.
- **When it becomes unavailable** (`model_not_found`, its limit, the consent timeout, retirement): each premium wake carries `--fallback-model <most capable pin>`, which covers outages. Limit and billing errors aren't covered, so the watcher re-runs that wake once on the most capable model at `xhigh`. The board shows "Premium model paused: not available", one card goes to the director, and it stays paused until the director says to try again. No automatic retries, which could spend credits.
- **A new premium pin needs a new Yes,** since the opt-in covers money spent on the model that was evaluated.

### 6.3 Availability checks and fallbacks

- **Pins by full ID per class,** as drafted, so an evaluation's result stays tied to the model it judged.
- **A fallback chain on every wake:** `--fallback-model <the class's alias>,<the next class down's pin>`. It lasts one turn, so the pin is tried again next turn. The watcher logs each switch from the stream; three in a day give one card.
- **Probe at setup, after each Claude Code version change, and daily:** one `-p` probe per class in use (never the premium model without the Yes). Compare `system/init`'s model with the pin, which catches an organisation's silent substitution.
- **A failed probe** marks that class "not available". The level steps down as a whole (Thorough, Balanced, Lean), never cell by cell. If the mid-sized class fails, Lean shows "not ready".
- **No probe at each wake.** The watcher reads `model_not_found`, `rate_limit` and `system/init` from the run's own stream.
- **Retirements.** A monthly job reads the deprecations page; the front desk raises one card about 45 days before a pin retires, leaving time to evaluate a successor. On Copilot, with about a month's notice, run it weekly.

### 6.4 The usage nudge

- **Keep `rate_limits.seven_day`,** as drafted, with three additions:
  - **Team and Enterprise seats** get no `rate_limits`, so no nudge; the board says "Allowance share not known" once.
  - **The figure appears only after a session's first response.** Keep the one-day staleness rule.
  - **A limit already hit:** wakes stop until the reset, and a switch won't help. On "You've hit your weekly limit", the watcher stops waking sessions and the front desk sends one card with the reset time.
- **Usage credits.** If they are on, work past the limit is paid. The nudge card should say so.
- **Copilot.** Credits are money ("each credit equals $0.01"). At Lean, `--max-ai-credits` caps each run. Use `models` lists and `reasoningEffort` per agent, with `modelPolicy: "required"` on critical reviewers. Never run sessions on Auto, under which subagents ignore their own model.
- **Wording, from Cursor's lesson.** Name each level's cost in the director's unit ("uses more allowance"). Never say "unlimited", and never call an allowance a "rate limit".
