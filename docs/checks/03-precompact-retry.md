<!-- docs/checks/03-precompact-retry.md -->

# Check 3: a blocked compaction is tried again

**Answer:** Yes — a blocked automatic compaction is tried again within seconds, in the same turn, and goes ahead once the hook allows it.

## Question

Whether a PreCompact block is retried on the next request.

## Tested on

macOS, Claude Code 2.1.278, a headless session, 17 October 2026.

## Method

`probes/03-precompact/run.js` made a scratch project with `autoCompactWindow` at 100,000 and a `PreCompact` hook (`guard.js`, matcher `auto`) that blocks the first three compactions and allows the rest, logging each call. A headless session then read large files, turn after turn, with `--resume`. The trial was stopped after about 14 minutes, once the answer was clear, to save the director's weekly allowance.

## Evidence

- The first three calls, all automatic, came at 10:01:13, 10:01:30 and 10:01:41, and were blocked. The fourth came at 10:01:45 and was allowed. All four were in the same session and the same turn.
- The guard's input carries `trigger` and `custom_instructions`, which a guard can use to tell an automatic compaction from one the director asked for.
- After that, each new turn of large reads compacted again, every one to two minutes: the trial's files were larger than the window. The guard was called 14 times in all.

## What it means for the design

- Section 10, step 5 stands: a block holds the compaction off, and it is tried again within seconds. A guard that blocks while state is unsaved delays the compaction only until the save is done.
- Section 10, step 5: because the retry comes so quickly, the "gives up after five blocks" escape is reached within about a minute. The guard should give up after a time instead, for example two minutes, rather than after a count.

## Needs the director

No.

## Addendum: probe 03b, what drives the retry (3 November 2026)

**Answer: outcome A.** A held compaction is re-tried once per model request, not on a timer, and the model is not told why.

**Tested on:** macOS, Claude Code 2.1.302, headless, a scratch project in a temporary folder with the Wheelhouse plugin switched off in that project's settings, `--model haiku`. Scripts: `probes/03-precompact/run-b.js` and `guard-b.js`. `autoCompactWindow` was 100,000 and the `PreCompact` `auto` hook blocked every call, with a reason on stderr, until turn 3.

**Method:** turn 1 read a large filler file; turn 2 (resumed) ran a 40-second wait three times, one at a time, giving four requests 40 seconds apart; turn 3 switched the hook to allow. Times below are seconds from the start of turn 1.

**Evidence**
- During turn 2 the hook was called at 18, 60, 102 and 144 seconds. The transcript's assistant entries were at 19, 62, 103 and 144. Each call came just before a request, and no call came in the 40-second gaps.
- Before turn 2, three calls came at 4, 7 and 11 seconds, in step with the requests of turn 1.
- Neither the model's replies nor the transcript contained the block's reason (searched for a unique marker in both).
- Once the hook allowed, calls at 151 and 163 seconds were followed by `compact_boundary` entries (two in the transcript).
- A first attempt asked for `sleep 40`; the shell refused it, so no waits ran and that attempt was discarded. The run above uses a Node timer for the wait.

**What it means for the design:** the hold is skipped and re-tried on each request, and the model sees nothing. Remove it, as section 6 of the compaction design says for outcome A.

Tokens: two short Haiku sessions, about a dozen requests each, mostly cached input.
