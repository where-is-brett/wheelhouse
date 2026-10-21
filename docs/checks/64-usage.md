<!-- docs/checks/64-usage.md -->

# Check 64: usage figures from Copilot

**Answer:** Deferred. A session's own output carries per-session usage: a headless run reports it on its final `result` event, in one usage checkpoint event, and in a usage file it can be told to write. Those are enough to show a session's use on the board. The other half, the month's total for the signed-in person, was not read. GitHub's two documented calls for it answered 404 because the `gh` sign-in lacks the `user` scope, and the director's ruling is that Wheelhouse does not ask for that scope.

## Question

Which credit and token fields a Copilot session's JSON output carries, and what GitHub's documented REST call for a person's Copilot credit use returns with the signed-in person's own token, read only. Fields and types are recorded, never amounts.

## Tested on

21 October 2026, on macOS, with Copilot CLI 1.0.101 (the pinned copy under `~/.wheelhouse-probes/`), signed in through a scratch Copilot home. Two real model runs by `probes/64-usage/run.js` (one plain, one using the `view` tool), each with `--output-format json` and `--usage-output-file`; both exited 0 on the first attempt of the probe's rerun (the first run of the probe failed before any model call, because the Mac's network was blocked, and gave nothing to record). Also `copilot help billing`, which needs no network, and two read-only calls with `gh api` as the person's own `gh` sign-in. The model's name is written `<MODEL>` below; the person's login is not recorded.

## Method

`node probes/64-usage/run.js`, run outside the sandbox. Each session runs in a throwaway project, with `--usage-output-file`, `--log-dir` and debug logging. The probe turns every event into a map from field path to type and keeps only those maps, so no amounts, model names or prompt text are stored. The REST half looks up the login with `gh api user --jq .login`, uses it in the path only, and records the status line, the scope headers, the body's field paths and the refusal message. Raw results: `<temporary folder>/wheelhouse-probe-results/64-usage.json`.

## Evidence

### The `result` event

The last line of the JSON output. Both runs had the same fields:

| Field | Type |
| --- | --- |
| `sessionId`, `timestamp`, `type` | string |
| `exitCode` | number |
| `usage.premiumRequests` | number |
| `usage.sessionDurationMs`, `usage.totalApiDurationMs` | number |
| `usage.codeChanges.linesAdded`, `.linesRemoved` | number |
| `usage.codeChanges.filesModified` | array |

It carries no token counts and no credit figure. `premiumRequests` is the old request-based measure; the credit measure is in the checkpoint and the usage file.

### The `session.usage_checkpoint` event

One per session, just before `assistant.idle`. Its `data` holds:

- `totalNanoAiu` (number) and `totalPremiumRequests` (number): the session's totals. `NanoAiu` is the credit unit in billionths.
- `usageAccountingWatermarks.<id>` (number): one counter, keyed by an id.
- `providerModelMetrics[]`: one entry per model, with `modelId`, `modelDisplayName`, `provider.{id,kind,label}` (strings) and `metrics`, which has the same fields as a model's entry in the usage file (below).
- `accountingSnapshot`: the same figures as the usage file (below) in one object: `modelMetrics.<MODEL>`, `agentMetrics.main.modelMetrics.<MODEL>`, `agentMetrics.main.{totalNanoAiu,totalApiDurationMs}`, `aiCreditsStatus`, `currentModel`, `lastCallInputTokens`, `lastCallOutputTokens`, `codeChanges`, `providerModelMetrics[]`.

The `tool` run added `tool.execution_start`, `tool.execution_complete` and `assistant.tool_call_delta` events; none of them carries usage fields. Of the `model.call_*` events, `model.call_finished` has only `dispatchDurationMs` (number) and `containsBuiltInFileEditRequest` (boolean); `model.call_start` and `model.call_final_result` have no usage-like fields. `assistant.message` has a `toolRequests` array and nothing else of use.

### The usage file (`--usage-output-file`)

A JSON object, 101 field paths in both runs, the same shape with and without a tool. Written even for the plain run.

- Session totals: `totalNanoAiu`, `totalPremiumRequestCost`, `totalUserRequests`, `totalApiDurationMs` (numbers), `aiCreditsStatus` (string), `sessionStartTime` (string), `currentModel` (string), `lastCallInputTokens`, `lastCallOutputTokens` (numbers).
- `tokenDetails.{input,output,cache_read,cache_write}.tokenCount` (numbers).
- `codeChanges.{linesAdded,linesRemoved,filesModifiedCount}` (numbers) and `filesModified` (array).
- `modelMetrics.<MODEL>`: `requests.{count,cost}`, `usage.{inputTokens,outputTokens,cacheReadTokens,cacheWriteTokens,reasoningTokens}`, `tokenDetails` as above, `totalNanoAiu`, `aiCreditsStatus`, `cacheExpiresAt` (string).
- `agentMetrics.main`: `totalNanoAiu`, `totalApiDurationMs` and its own `modelMetrics.<MODEL>`; a per-agent split, here only the main agent.
- `providerModelMetrics[]`: as in the checkpoint.

### What `copilot help billing` says

It says usage is measured in AI credits, and that on "the legacy billing platform" premium requests are shown instead. Every place it names for seeing use is inside the CLI: the footer's remaining budget, `/statusline` (a `quota` option for use against the plan limit and an `ai-used` option for the session's credits), the `/model` picker's per-token prices, `/context`, `/usage` (the session's credits, a token breakdown and limit progress) and the exit summary. It names no file or command that reports the month's account total, and links only to GitHub's billing pages (concepts/billing and the legacy request-based billing page).

### The REST call for the month's total

The documented calls are `GET /users/{username}/settings/billing/ai_credit/usage` and, for the legacy platform, `GET /users/{username}/settings/billing/premium_request/usage` (https://docs.github.com/rest/billing/usage; found in `docs/research/copilot-vscode-2026-10.md`, section 12). Both were made once, as the person's `gh` sign-in.

- Both answered `404 Not Found`. The body has three fields, all strings: `message` ("Not Found"), `documentation_url` (the docs anchor for that very operation) and `status`.
- The response headers say the operation accepts the `user` scope. The sign-in's scopes are `gist`, `read:org` and `repo`. `gh` itself printed that the operation needs the `user` scope.
- So the endpoints exist and the 404 is most likely GitHub hiding a call the token's scope does not allow. The docs page was not fetched in this run, so a 404 for an account type with no billing report is not ruled out.
- No usage figures were returned, so the shape of a successful reply was not seen.

### What was not tested

- The REST call with the `user` scope (the director ruled that Wheelhouse does not ask for it), so the month's total and the shape of a successful reply are unknown.
- Longer sessions, several models, sub-agents (`agentMetrics` had only `main`) and resumed sessions; whether the usage file is written when a session is stopped early.
- The legacy billing platform's output.
- Whether the amounts in the file agree with what GitHub bills.

## What it means for the design

- **Part 8 Task 2 (usage on the board).** The brief's "If the answer differs" paragraph applies: per-session figures exist, and the month's total is not reachable with this sign-in. Usage on Copilot shows each session's use only. The starter passes `--usage-output-file <path>` to every session and reads `totalNanoAiu` for credits, `tokenDetails.*.tokenCount` for tokens, and `totalPremiumRequestCost` for legacy requests; it falls back to the `session.usage_checkpoint` event, then to the `result` event's `usage.premiumRequests`, if the file is missing. It sums those across sessions itself.
- **The board's wording.** The board says "this session's use" and "the sessions Wheelhouse started", and does not claim to show the person's whole month, because sessions the person starts by hand are not counted.
- **Reading by field name.** Fields are read by name and a missing one shows as "not available", not as zero, because the file's layout is Copilot's and may change.
- **The month's total** can be added later if the director chooses to give `gh` the `user` scope; the call and its docs link are above.

## Needs the director

Nothing now. The month's total stays deferred until the director decides to grant the `user` scope; they have ruled not to ask for it.
