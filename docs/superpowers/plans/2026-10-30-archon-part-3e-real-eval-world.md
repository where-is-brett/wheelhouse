<!-- docs/superpowers/plans/2026-10-30-archon-part-3e-real-eval-world.md -->
# Part 3e: a counted-evaluation world that runs real Archon

**Goal:** the counted evaluation's engine scenarios (42 to 55, 60 to 62) can play on the real, source-built Archon (spec, section 18), beside the fake engine, with the report saying which scenarios ran for real and which played their recording. v0.2.0's tag waits for one such run.

**Waits on:** 3a to 3c (merged). Stays out of setup, uninstall and the version files (part 3d's pull request is open there), and keeps changes to shared files small, since 4.2 and 4.4 are building beside it.

## The world

`scripts/eval/archon-world.js`, chosen by `npm run eval -- … --engine archon`. It opens the same world the fake one does (a home in a temporary folder, the project registered with its record open and this computer's key enrolled, the real helper on it, the code host stood in) with these differences:

- **The engine.** The source-built Archon with Wheelhouse's patch (`buildFromSource`, at the pins in `build.js`), built once into a cache folder outside `~/.wheelhouse` (`WHEELHOUSE_EVAL_ARCHON`, by default `~/.wheelhouse-evals/engine`) and reused. Each world's engine folder (`<home>/engine`) holds the cache's Bun and source by link, its own launcher, its own bunfig, the broker's launcher and the pack built from this checkout, so the adapter's health check reads it as setup's install. Archon's home is the world's own (`archonHome()` beside the world's home). Every Archon command runs with `archonEnv`: telemetry off, the broker the only `gh`, the patch's permission mode.
- **Archon's home settings.** `defaultAssistant: claude` in the world's Archon home. Without it, real Archon's `ai tier list` names no assistant and the adapter's health check refuses the engine (found by this part's smoke on the real build; setup has to write it too).
- **The project.** A throwaway git repository with a local bare repository as its remote, so no fetch-mirror rule is needed and nothing reaches GitHub. It has Archon's project settings (worktrees under `.wheelhouse/worktrees`), a `.env` for the guards' trial, and cheap model bindings, so a real step costs cents.
- **The lock.** The world takes the project's lock on the local remote, so the broker reaches its real rules instead of refusing for want of the lock.
- **The host.** The helper's host adapter and the real `gh` are stood in: a `gh` call the broker lets through is kept and answered, never run.
- **Proof first.** Before its first real scenario, the run plays `wheelhouse-hello` once: the health check passes (patched build, pins, telemetry off) and the guarded step reports its `.env` read refused. Any failure there fails every real scenario with that reason.
- **Clean up.** A world ends by cancelling every run it started, then removes its folders.

## Real or recorded, per scenario

A scenario plays for real when it has `engine.real`, a play on the real world; otherwise the real run plays its recording on the fake engine and the report marks it **recorded**. A real play drives only what can be provoked cheaply and on cue.

| Scenario | How | Why |
|---|---|---|
| 46 All stop cancels | **real** | A real quick run is started, All stop cancels it while it runs, nothing starts while it is on, and after it is lifted the work runs again from the start. The waiting run's leg (left paused) needs a real ask, so it stays with the recording |
| 45 cap reached | **real** | A tiny token cap: the real first step's spend passes it, the run is cancelled, one card recommends Stop, nothing starts without Give it more, and Give it more carries on |
| 48 unsigned merge refused | **real** | The broker's real launcher, run as Archon runs it from the project, asks to merge with a signed CLEAN review and an unsigned approval: refused, never forwarded |
| 62 red main held | **real** | With a red-main incident open in the record, the real broker refuses an ordinary merge, naming the incident |
| 47 planted review refused | recorded | Signing a review needs the run's own pull request and lenses in Archon's record, and a real run reaches them only through the pull-request step against GitHub, which is stood in. A planted file refused for want of a finished review would pass for the wrong reason |
| 42, 43, 44, 49, 50, 51 to 55, 60, 61 | recorded | Each needs a step to ask on cue, a preview, a clash, a red main reported by the merge queue, or the small lane's rounds, which a real step can't be made to give deterministically |

The safety legs come first: the guards' trial, All stop, the cap, the unsigned merge, the red main line held.

## Files

- `scripts/eval/archon-world.js` (new): the engine's cache, the world, the proof, the stood-in host and `gh`.
- `scripts/eval/engine-world.js`: `archon` in `ENGINES`; `runEngineScenario` chooses the world and says `played: real | recorded`.
- `scripts/eval/run.js` and `scripts/eval/summary.js`: the run record keeps `played`, and the report shows it.
- `tests/eval/build-loop/45, 46, 48, 62`: an `engine.real` play each.
- `tests/scripts/eval/archon-world.test.js` (new): the world with a stand-in Archon command line (no real Archon), the choice of world, the report's marks. CI runs only these and the fake world.

`docs/evals/build-loop.md` is left alone (part 3d's pull request changes it); how to run the real set is at the top of `scripts/eval/archon-world.js` and below.

## Running it

```
npm run eval -- --suite build-loop --engine archon
```

The first run builds the engine into the cache (a few minutes, network, no Claude). Then the health trial (one cheap Claude step), the four real plays, and the recordings. Expected spend of one run: under $1 of Claude use on haiku, most of it scenario 45's one finished build step; 48 and 62 use no model, and 46 cancels its runs as soon as they are running.

## What was tried before the pull request

The world's tests run against a stand-in for Archon's command line. On the real build, without the counted evaluation: the world's engine folder passed the adapter's health check, and a real quick run started by the helper's dispatcher read its ticket in its `order` step, bound its build step to haiku, and was cancelled before that step did any work.

## Done

The world's tests and the touched scenario and report tests pass; an independent review of the whole branch holds no BLOCKER or HIGH; the pull request is up; the main session is told the expected spend of one real run. The real run itself is the main session's, from main, after merge.

## After the first real run (30 October 2026)

- **The health trial failed with no reason.** The pinned kits weren't installed at project scope in the world's project, so the session start held edits and commands, and the hold refused the trial step's structured output. The world now installs the kits at project scope before the first commit and removes them when it closes. A failed trial, or any real run that ends badly, now gives Archon's error and the refusal the step was told.
- **Scenario 45.** Archon names its workspace after the project's remote. Setup's fetch mirror makes that mirrors/<owner>__<name>, where the adapter looks for a run's artefacts and its ticket. The world's remote now stands where the mirror would (`<root>/mirrors/o__p.git`, read through `<root>/o/p` by the project's own git), so the order step finds its ticket. The build step still can't read its order file: Archon gives Claude only the project and user settings, never `.claude/settings.local.json`, so the run's overlay isn't loaded (the engine's to fix). The report now says when a run stops to ask, and quotes the question, and gives the error of the step that failed.
- **Scenario 46** pressed All stop before Archon listed the just-started run, so nothing was cancelled. The play now waits for the first step before it presses All stop. The engine's All stop still misses a run in that first second, which is for the adapter to fix.
- **Scenario 43** failed once in its recorded play and couldn't be made to fail again.
