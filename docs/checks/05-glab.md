<!-- docs/checks/05-glab.md -->

# Check 5: `glab` covers the adapter

**Answer:** Partly — every operation the adapter needs exists in `glab`; a live run waits for a GitLab project.

## Question

That `glab` covers every adapter operation, including a merge with an exact head commit.

## Tested on

`glab` 1.123.0 for macOS (Apple silicon), the official release, checked against its published checksum and run from a temporary folder without installing. 17 October 2026.

## Method

The help text of each command the adapter would use was saved to `tests/fixtures/glab-help/`. `probes/05-glab/coverage.js` checks each adapter operation's command and the flag it relies on; its tests run on those saved texts.

## Evidence

| Operation | Command | Flag | Covered |
|---|---|---|---|
| open MR | `mr create` | `--source-branch` | Yes |
| update MR | `mr update` | `--description` | Yes |
| CI status for a commit | `ci status` | `--branch` | Yes |
| watch CI | `ci status` | `--live` | Yes |
| mergeability | `mr view` | `--output` (JSON) | Yes |
| merge exact head | `mr merge` | `--sha` | Yes |
| issues | `issue create` | `--description` | Yes |
| issue checklist | `issue update` | `--description` | Yes |

`glab mr merge --sha` is described as "Merge only if the HEAD of the source branch matches this SHA". Its help also says that "when a pipeline is running, auto-merge is enabled by default".

## What it means for the design

- Section 11 stands for GitLab.
- The adapter's GitLab merge must pass `--auto-merge=false` as well as `--sha`. Otherwise a merge asked for while CI is still running would be queued, and would happen later, after the gate's checks.
- Which field of `mr view --output json` gives mergeability is settled in the state-and-host plan, against a real project.

## Needs the director

No.
