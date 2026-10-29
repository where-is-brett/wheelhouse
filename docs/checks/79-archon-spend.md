<!-- docs/checks/79-archon-spend.md -->

# Check 79: counting spend under Archon (early check E6)

**Answer:** Deferred. The Claude half passes: each Claude step's tokens and cost are in Archon's record, marked as the provider's. The Copilot half, the estimate against GitHub's figure over 20 steps, needs Copilot requests. The account has no included model (check 74), so it waits for the director's yes on spending part of the allowance.

## Question

Spec 15's E6: can each step's tokens and cost be read from Archon's record? And is the spend meter's Copilot estimate within one request of GitHub's own premium-request figure over 20 Copilot steps? The estimate is prompts sent per step (attempts, loop rounds and structured-output re-asks) times the model's multiplier.

## Tested on

29 October 2026, on the Mac, with the scratch engine of check 74: Archon v0.13.0 and Bun 1.4.3, checksum-pinned, telemetry reported off. The Claude provider ran on the Mac's existing subscription.

## Method

`probes/79-archon-spend/run.js` holds the meter's two halves:
- `stepSpend(record)` gives one entry per AI step of `archon workflow get <run> --json --verbose`: provider, model, tokens (the four kinds added) and cost. Cost the provider didn't report is `null`, marked `unavailable`, never zero.
- `promptsPerNode(record)` counts a Copilot node's attempts, so a retry or a loop round adds one.
- `estimatePremium(steps, multipliers)` multiplies prompts by the model's multiplier. A model with no known multiplier is an error, not a zero.

Their tests are in `tests/probes/79-archon-spend/run.test.js`.

`trial --copilot <n> --allowance <n>` runs three kinds of workflow in a scratch project:
- `n - 3` single Copilot steps;
- one three-round Copilot loop with fresh context;
- three Claude steps on the small model.

It reads GitHub's figure (`gh api /copilot_internal/user`, as in check 74) before and after. It stops before a step that would take the figure past the allowance. On 29 October 2026 it ran with `--copilot 0 --allowance 0`: the Claude steps only.

## Evidence

- **Three Claude steps,** each "reply with the single word ok", all `completed`. Each record's step reads `provider: claude`, with the resolved model id, as below. Each run's totals match its step.

  | Run | Tokens in | Tokens out | Input, output and cache added | Cost (reported) |
  |---|---|---|---|---|
  | 1 | 22,759 | 18 | 44,354 | $0.00124 |
  | 2 | 22,759 | 18 | 44,354 | $0.00081 |
  | 3 | 22,759 | 18 | 44,354 | $0.00081 |

  The first run cost more because it wrote the prompt cache; the next two read it. Most of the 22,759 input tokens are the Claude Code system prompt and the settings a step loads by default (spec 7.1).
- **The record's spend fields,** per step under `execution.spend`:
  - `tokens {source, value: {input, output, cacheRead, cacheWrite}}`;
  - `costUsd {source, value}`;
  - `numTurns` and `stopReason`.

  A step with nothing to report, such as a bash step, says `source: unavailable, reason: not_applicable`. The run's `metadata` carries `total_cost_usd`, `total_tokens_in` and `total_tokens_out`.
- **GitHub's figure** stayed at 37 used of 200: no Copilot request was sent.
- **Copilot** reports tokens but not cost, according to Archon's capability table for the provider (`packages/providers/src/community/copilot/capabilities.ts`). So `stepSpend` gives Copilot steps `costUsd: null` with `source: unavailable`.

## What it means for the design

- **Claude:** the spend meter can read every step's tokens and dollars from `workflow get --json --verbose`, as spec 10.1 says. The figure for a step is the provider's, with cache reads and writes kept apart.
  - Count input, output and cache tokens separately, not as one sum: a run's `total_tokens_in` leaves the cache out.
  - Even a one-word step costs about 22,000 input tokens of start-up context. The per-run token caps (spec 10.2) should be read with that floor in mind.
- **Copilot:** as check 74 found, no model on this account is free. The meter's estimate counts every prompt at the model's rate (`auto` at 1), not zero. The comparison with GitHub's figure is still needed before Copilot runs unattended. Until it is done, spec 15's rule holds: no Copilot runs unattended.
- The estimate uses the record's attempts as prompts. Whether Copilot's structured-output re-asks show as attempts in the record, or happen inside one attempt, is part of what the Copilot trial must show. If they are hidden, the estimate will run low by the re-asks, and the daily comparison with GitHub's figure (spec 10.1) catches it.

## Needs the director

- **A yes to spend part of the Copilot allowance:** the same card as check 74, queued with the main session on 29 October 2026. With it, an agent runs `node probes/79-archon-spend/run.js trial --copilot 20 --allowance 25` after check 74's setup, and this note is rewritten with the comparison.
- Removed afterwards: the scratch project under `$TMPDIR/wheelhouse-archon-checks/e6`, moved to the Trash.
