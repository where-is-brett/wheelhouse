<!-- docs/checks/93-limit-and-connection.md -->

# Check 93: a limit and a dropped connection (early check U4)

**Answer:** Yes, with one change to R2. A connection cut in mid-step ends the run with `errorClass: transient`, after about 9 minutes of the model CLI's retries and Archon's. A failed run resumes under the same id, worktree and artefacts folder, skipping finished steps, so the ticket still reads. The interrupted step itself starts again from its beginning. A limit with no reset ends as `fatal`, which is also what a sign-in or setup failure gives, so the `terminal` line can't tell them apart: `failureKind` must read `providerFailure.class` from `inspect` for `fatal`. Run totals add both legs; the per-step rows don't. Paid usage is off on this account, by the provider's own header. Where it is on, a limit would neither pause nor fail, and Archon's record shows nothing.

## Question

Spec sections 9.2, 9.3 and 13, and part R0a of the plan: the `terminal` line's fields for a dropped connection and for a usage limit with no reset; whether `workflow resume <run> --detach` takes a `failed` run, skips finished steps and keeps the run's id, worktree and artefacts folder; whether `inspect` afterwards adds both legs; what a second `terminal` line looks like, whether the first can replay and how to tell them apart; whether a resumed run that pauses again gets a new occurrence; and whether paid usage can start in place of a pause.

## Tested on

1 and 2 November 2026 (Sydney), on macOS 27.0.1 (Apple silicon) with Node.js 22.22.1, Archon 0.13.0 and Bun 1.4.3 from `probes/lib/archon.js` in a scratch home of its own, and Claude Code 2.1.302 signed in with the director's own subscription. The model step ran on the `small` tier. Archon's source was read at tag v0.13.0. Spend was **under one US cent**: $0.0046 in the records of eight runs, two of which had no model step, plus one direct call to the model CLI and one reply that was cut off, neither of which is in a record.

## Method

`node probes/93-limit-and-connection/run.js install`, then `trial ask`, `trial limit`, `trial connection`, `trial paid` and `trial blip`. The harness stands in for the helper: one `attention --watch --json --all` follower and one `workflow wake --watch --json`, both up throughout, and every run started with `--branch`, as the adapter does.

- **The stand-in.** `ANTHROPIC_BASE_URL` points the step's model CLI at a server on `127.0.0.1` inside the probe. It logs paths and statuses, never a header or body, and passes calls on to the provider. The computer's network was never touched. Its modes: `cut` passes calls until the turn carrying the tool's result, cuts that reply after about 200 bytes and then destroys every socket; `blip` cuts once and passes again; `limit` answers each turn with a 429; `paid` passes calls on, adding the headers of a limit moved to paid usage.
- **The workflow** (`step.yaml`): a shell step, a model step that runs one Bash command and replies, and a shell step. The first writes a stand-in ticket into the artefacts folder, and the last reads it back. Each shell step adds to `ran.log`, and the model step's command adds to `think-ran.txt`.
- **Limits.** None was reached. The 429 is built from the header names in the model CLI's binary, with a `rejected` status: once with no reset, once with a reset two minutes ahead. A real refusal's body was not recorded.
- **Asks** (`ask.yaml`, `ask-beside.yaml`, no model step): an ask, a step that fails once, a later ask; and an ask in the same layer as a step that fails once.

## Evidence

**The `terminal` line.** Its fields are `type`, `cursor`, `project`, `runId`, `workflow`, `parentRunId`, `status`, `outcome` and `cause`. `cause` is `{ node, errorClass }` on a failure and null otherwise. There is no time on the line and no provider class. `errorClass` is Archon's node failure kind (`schemas/node-execution.ts`): `fatal`, `transient`, `unknown`, `rate_limited`, `overloaded`, `timeout`, `exec_failed`, `output_contract`, `max_iterations`, `child_failed`, `cancelled` or `config`.

| Failure | `terminal` | `inspect`: `nodes[].execution.lifecycle` | Other marks |
| --- | --- | --- | --- |
| Connection cut, and stays down | `"status":"failed","cause":{"node":"think","errorClass":"transient"}` | `failureKind: transient`, `providerFailure: { class: transient, evidence: "API Error: Connection dropped (ECONNRESET)" }` | Two `node_retry_scheduled`; 7 session ids on the node after all legs |
| Limit, no reset | `"status":"failed","cause":{"node":"think","errorClass":"fatal"}` | `failureKind: fatal`, `providerFailure: { class: quota_exhausted, evidence: "You've hit your session limit" }` | Event `quota_resume_skipped`, reason `reset_unavailable`; no Archon retry; one 429; cost $0 |
| Limit, reset reported | No `terminal`: `attention` with `kind: usage_limit`, `node`, `resetAt` | The node reads `failed` while the run is `paused` | The waker continued it at the reset: `resolved`, `withdrawn`, then `terminal` `completed`. **No `resumed` line** |
| A shell step's exit 1 | `"errorClass":"exec_failed"` | | |

`fatal` also covers `auth`, `budget_exceeded` and `misconfigured` (`nodeFailureKindOf` in `executor-shared.ts`), so the line alone can't say a limit. Read, not run: a rate limit that outlasts its retries pauses like a reset limit, with a computed time; `failRun` with no node gives `cause: null`, and `metadata.stop_reason.reason` then says which (`process_terminated`, `unhandled_error` and others).

**How long a drop takes to fail.** The step started at 13:08:12 UTC and was cut within seconds. Its attempts failed at 13:11:12, 13:14:16 and 13:17:24, and the run failed with the last. Each of Archon's 3 attempts holds about 3 minutes of the model CLI's own retries (116 dropped calls over both failed legs). The second leg took 9 minutes too. So from a drop that lasts, the retries of 5, 15 and 30 minutes fall at about 14, 38 and 77 minutes, and the card comes at about 86.

**A short drop never fails.** `trial blip` cut the same reply once and passed again: the model CLI retried within 2 seconds, the node took 5 seconds on one session, the run completed, `think-ran.txt` held one line, and no retry event was written.

**Resume.** Run `79b2941e…`, failed, then failed again on resume, then completed:

| Question | Answer | What showed it |
| --- | --- | --- |
| Takes a `failed` run? | Yes, twice | `Started 'resume' for run 79b2941e… in the background` |
| Same id? | Yes | All 3 `terminal` lines and both `resumed` lines carry it |
| Skips finished steps? | Yes | `ran.log` holds `step-one ran` once, the stamp file is unchanged, 2 `node_skipped_prior_success` |
| Same worktree? | Yes | `working_path` the same at each end; `artefacts-path.txt`, written on the first leg, still there |
| Same artefacts folder and ticket? | Yes | The last step, on the third leg, read `probe` from `.wheelhouse-ticket` written on the first |
| The failed step? | **Starts again from its beginning** | `think-ran.txt` held `made` twice: the tool ran on the first leg, and again on the third |
| After a limit? | Yes | Run `5358dae0…` resumed from `fatal` and completed |

**How legs add.** `metadata.total_cost_usd` and the token totals add across legs: $0.00047770 after the first leg, unchanged after the second, $0.00104485 at the end, which is the first leg plus the last. `inspect` has one row per node, holding the last attempt's spend only: `think` read $0 while failed and $0.00056715 at the end, so its rows don't sum to the total. A reply cut before it ends isn't counted anywhere, so a cut leaves the record slightly under the bill: the first leg's 6,544 input tokens are its first turn alone.

**A second `terminal`, and a replay.** It has the same shape as the first, with a later cursor. The stream gave:

```
terminal sql:161 failed  transient
resumed  sql:162
terminal sql:207 failed  transient
resumed  sql:208
terminal sql:220 completed
```

A new follower with `--after` set before them replayed all five in order, each with its cursor, after the run had completed. So the first can replay once the run has resumed, even once it has finished, and its `cause` stays as it was (the source reads only events before the delivered one). The line alone doesn't say it's old. Two rules tell them apart: a host handles each `terminal` cursor once, and it acts on `failed` only when `inspect` still reads `failed`.

**Asks after a resume.**
- A later ask on a resumed run has its own occurrence: `ask-one` `638f78ab…`, `ask-two` `2bd84376…`.
- A step that failed beside an open ask leaves the run `paused`, with no `terminal`, until the ask is answered. `workflow resume` is refused meanwhile: `Run b59b568a… is waiting for an answer to its 'select' attention wait.` The answer then ends the run `failed`, and the resume skipped the answered ask, so it wasn't asked twice.
- The same node asking twice wasn't reached. Archon's docs allow it ("repeated attention at the same node"). Each pause takes a fresh `pauseId` (`randomUUID` in the source), so a host writing an ask once by occurrence holds.

**Paid usage.**
- **This account:** off. The provider's real responses, passed through the stand-in, carried `overage-disabled-reason: org_level_disabled`, and the stand-in adds no such header in that mode. Claude Code's own profile agrees: `hasExtraUsageEnabled: false`. The account's settings page was not read.
- **Where it is on, by the stand-in:** with `status: rejected`, `overage-status: allowed` and `overage-in-use: true` on a 200, the run completed. It raised no ask, the record has no mention of `overage`, and nothing under Archon's home logged it. The model CLI alone reports it, on its stream: `{"type":"rate_limit_event","rate_limit_info":{"status":"rejected","overageStatus":"allowed","isUsingOverage":true,…}}`. Archon's provider reads that event, but `usageLimitWait` looks only at failed nodes, and a billed turn isn't one.
- **Stays unknown:** what the provider really sends when a limit spills into paid usage on a real account, since no such account or limit was tried. Whether Wheelhouse can see it during a run is also open, since the event stops inside Archon's provider. `oauthAccount.hasExtraUsageEnabled` in `~/.claude.json` is Claude Code's private cache, so it's a guide, not a promise.

### What was not tested

- A real limit, and Copilot, whose failures Archon classes `unknown` by its source.
- `overloaded`, `timeout`, and a run failing with `cause: null`, which are read from the source only.
- A resume with the helper's own adapter: the harness made the calls.
- A run started without `--branch`.

## What it means for the design

**R2 and R3 can go ahead.** The stop in the plan's early checks doesn't apply: a failed run resumes under its own id.

`FAILURE_KINDS`, and `retryPlan`'s row for each. R3's tries are the design's 5, 15 and 30 minutes.

| `errorClass` | With | `failure` | Retry |
| --- | --- | --- | --- |
| `transient` | | `connection` | Yes |
| `timeout` | | `connection` | Yes |
| `overloaded` | | `provider` | Yes |
| `rate_limited` | Reaches `terminal` only with `autoResumeOnQuotaReset: false` or a reset already past | `provider` | Yes |
| `fatal` | `providerFailure.class: quota_exhausted` | `limit` | Yes. A refused turn cost $0 |
| `fatal` | `auth`, `misconfigured`, `budget_exceeded` | `other` | No: a card |
| No cause, `status: failed` | `stop_reason` of `process_terminated`, `not_finalized`, `unhandled_error` | `host` | Yes |
| `unknown` and everything else | `exec_failed`, `output_contract`, `max_iterations`, `child_failed`, `config` | `other` | No: a card |

- **R2 changes in one place.** `failureKind(event)` can't work from the event alone for `fatal` or a null cause. Keep `errorClass` on `run-ended`, and settle the kind where the runner reads `inspect`: `nodes[first_failed_node].execution.lifecycle.providerFailure.class`, or `metadata.stop_reason.reason`. It reads a typed class, never the error's words. If `inspect` can't be read, the kind is `other`, the safe path.
- **`costOf` reads `metadata.total_cost_usd` and the token totals**, which add legs. Don't sum `nodes[]` for a resumed run. A run's rows may read less than its total.
- **A `terminal` line is a report, not the state.** Handle each cursor once, and check `inspect` before acting on `failed`, or a replay could resume a run that has moved on. R2's `runLive` and the host's `resumes` should key on the cursor or the resume number, since two endings of one run differ only by cursor.
- **A continuation at a reset brings no `resumed` line.** Nothing should wait for one: a usage-limit pause never wrote an ending, so R2's `started` with `resume` isn't needed there.
- **A step repeats from its start on a resume,** so a tool's effects can happen twice. Each lane's steps already allow for this, by check 78. The `tried` list stays useful: it says what failed.
- **R3's retries begin about 9 minutes after a drop,** and a drop under a few minutes never reaches them. No change, but the report's times should expect this.
- **A step failing beside an open ask stays hidden** until the ask is answered. The run is simply waiting on its ask, which is right, and no retry can start there.
- **Paid usage (spec 9.3 and section 13).** On this account a limit can't bill. For the sheet, the table's "refuses a goal on such an account" can only be a warning from `hasExtraUsageEnabled` until the real spill is seen, so G7 should keep the sheet's plain sentence where that flag is true or missing. The spend bound still holds, since tokens are counted either way.

## Needs the director

Nothing. The main session may want to look at the account's settings page to confirm paid usage is off, but the provider's own header already says so.

The scratch engine and project were moved to the Trash when the check ended, by `node probes/93-limit-and-connection/run.js clean`. No setting and nothing else on the computer was changed, and the follower and waker were stopped when each trial ended.
