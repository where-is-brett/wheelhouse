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
