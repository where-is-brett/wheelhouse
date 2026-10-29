<!-- docs/superpowers/plans/2026-10-29-archon-part-3a-engine-seam.md -->
# Wheelhouse on Archon, part 3a: the engine seam, its records and its safety

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The core reaches a build engine only through one interface, with two adapters (Archon, and a fake for every test), a continuation host the helper supervises, the new record kinds, and Wheelhouse's guards extended to Archon. No lane runs on Archon yet.

**Architecture:** `scripts/engine/contract.js` names the interface (spec 6.1). `scripts/engine/fake.js` plays back recorded Archon events. `scripts/engine/archon/` is the only place in the repository that knows an Archon word: its environment, its command line, its JSON and its asks. The helper supervises one `archon workflow wake --watch` and one attention stream per computer, writes `run` and `ask` events from them, and keeps the stream's cursor beside the private record. All stop cancels every run and ends every process tree the adapter started.

**Tech Stack:** Node.js (ES modules), `node:test`, `node:child_process` behind injected `run` and `spawn`, Archon v0.13.0's command line.

**Spec:** `docs/specs/2026-10-29-wheelhouse-on-archon-design.md`, sections 6 (all), 4.2 to 4.4, 8.1 to 8.2, 12.1 to 12.3, 17 step 2.

**Plan index:** `docs/superpowers/plans/2026-10-29-wheelhouse-on-archon.md`.

**Waits on:** part 1 merged (the desk interface: All stop and views go through it); part 2's checks 75 (E2: how a run is told which artefacts are its own, and whether the guards hold) and 78 (E5: whether the stream lost asks, resume after cancel, leftovers after cancel). Read both notes in `docs/checks/` first. If check 75 found a guard failing, Task 7 adds the one-line patch route (spec 12.1) before anything else.

## Global Constraints

- **The main session** is the session that started you (reply with SendMessage to the `from` id of your first message). Questions, cards for the director and the hand-over go there, never to the director directly.
- British English; dates as 29 October 2026; a repository-relative path comment atop every file. No words such as "enhanced", "improved" or "fixed"; no model names; no AI attribution anywhere. Scripts in Node.js. Don't touch `.github/workflows/ci.yml`. Run only the test files a change touches.
- **No module outside `scripts/engine/archon/` knows an Archon word** (workflow, node, attention item, run id format, CLI flag), and no module outside the host adapter knows `gh` (spec 3).
- **Every Archon command has the same environment** (spec 6.3): `ARCHON_HOME`, `ARCHON_TELEMETRY_DISABLED=1`, `DO_NOT_TRACK=1`, `POSTHOG_API_KEY=off`, a `PATH` with the pinned Bun and the `gh` broker and **not** the real `gh`, `CLAUDE_BIN_PATH`, and `COPILOT_BIN_PATH` for Copilot. Nothing runs Archon any other way.
- Wheelhouse calls `cancel`, never `abandon` (spec 12.2).
- Spend is marked reported, estimated or unknown; **unknown is never zero** (spec 6.1).
- Answers are idempotent: a second answer to the same ask, or one to an ask that moved on, is refused, never applied twice.
- Tests never run a real `archon`, `bun` or `gh`: they are stood in (`tests/helpers/stood-in.js`).

## Review Focus

1. **The helper restarts while an ask is waiting.** The cursor kept beside the record means the ask is seen again, not lost; the `ask` event's id is stable, so it isn't written twice. Test in Task 5.
2. **An Archon command started without the telemetry switches** (a new call site that builds its own environment). `archonCli` takes no environment argument from callers; it always builds it. Test in Task 3.
3. **An Archon ask nobody recognises** (a new kind in a later release). It becomes a level-3 ask recommending the work stop, with the reason in plain words, never dropped. Test in Task 4.
4. **All stop while a run's child run and a script are alive.** `stopAll` cancels, waits ten seconds, ends every process tree the adapter started, and reports any survivor. Test in Task 8.
5. **An Archon Claude step marks bypass mode.** The STOP guard's bypass marker would make the helper refuse every push for two hours. Steps started by the adapter carry `WHEELHOUSE_ENGINE_RUN`, and the guard doesn't mark bypass for them. Test in Task 7.

---

### Task 1: Settings and record kinds

**Files:**
- Modify: `scripts/settings/catalogue.js`, `scripts/settings/effective.js` (`sayValue` words), `scripts/mod/settings-pane.js` (`LEVEL_WORDS`, `PANE`), `scripts/state/events.js` (kinds and shapes), `scripts/state/views.js` (`runs`, `asks`, `costs`, `previews`, `lessons`), `scripts/eval/stand-in-helper.js` (shares `PLAIN_KINDS`), `scripts/lib/build-loop.js`
- Test: `tests/scripts/settings/catalogue.test.js`, `tests/scripts/state/events.test.js`, `tests/scripts/state/views.test.js`

**Interfaces:**
- Produces settings (all `home: 'project'`, group `advanced` unless said): `engine` (levels `['wheelhouse', 'archon']`, default `'wheelhouse'`); `engineLanes` (check: an array drawn from `['quick', 'small', 'bug', 'feature']`, default `['quick']`); `cardsPerDay` (group `everyday`, check: an integer 1 to 10, default 3); `capMinutes` (check: `{ quick, small, slice, bug }` positive integers, default `{ quick: 20, small: 60, slice: 120, bug: 30 }`); `capTokens` (default `{ quick: 1000000, small: 4000000, slice: 10000000, bug: 2000000 }`); `bundleApprovals` (levels `[false, true]`, default `false`); `engineRoom` (levels `[false, true]`, default `false`).
- Produces: `PACE` in `scripts/lib/build-loop.js` stays the default; a new `paceOf(settings) -> { building, featureLane }` reads the `pace` setting and falls back to `PACE`, so the dispatcher (part 3c) has one source.
- Produces plain kinds, with `PLAIN_SHAPES`: `run { work, lane, engine, runId, state, branch?, pr?, outcome? }` (`state` one of `started`, `paused`, `ended`); `ask { id, runId, work, kind, level, topic?, recommend?, options, preview?, setLine? }` (`kind` one of `question`, `approval`, `blocked`, `usage-limit`, `trouble`); `cost { runId, work, tokens, dollars, premiumRequests, minutes, source, byRole }` (`source` one of `reported`, `estimated`, `unknown`; `dollars` and `premiumRequests` may be null, never 0 for unknown); `preview { work, head, folder, pages }`; `lesson { work, text }`. `run` and `ask` and `cost` and `preview` are helper-only (`HELPER_ONLY_KINDS`).

- [ ] **Tests first:** `engine accepts wheelhouse and archon only`; `engineLanes refuses an unknown lane`; `cardsPerDay refuses 0 and 11`; `paceOf reads the pace setting and falls back to three`; `a run event with an unknown state is refused`; `a cost event with source unknown keeps null dollars`; `a run event can't be written through /state/write` (helper-only); `views gather runs by work, latest state last`.
- [ ] Run: fail. Implement. Run: pass. Commit: `Add the engine's settings and record kinds`.

### Task 2: The engine interface and the fake

**Files:**
- Create: `scripts/engine/contract.js`, `scripts/engine/fake.js`, `tests/fixtures/engine/quick-approved.jsonl`, `tests/fixtures/engine/quick-blocked.jsonl`, `tests/fixtures/engine/merge-hold.jsonl`
- Test: `tests/scripts/engine/contract.test.js`, `tests/scripts/engine/fake.test.js`

**Interfaces:**
- Produces: `ENGINE_EVENTS = ['run-started', 'step-finished', 'ask', 'ask-resolved', 'run-ended']`; `ASK_KINDS = ['question', 'approval', 'blocked', 'usage-limit', 'trouble']`; `SPEND_SOURCES = ['reported', 'estimated', 'unknown']`; `checkEngine(adapter) -> string[]` (missing methods); `checkEvent(event) -> string | null`.
- The interface every adapter satisfies: `health() -> { ok, findings: string[] }`; `start(order) -> { ok, runId } | { ok: false, refused }`; `watch(cursor) -> { events: EngineEvent[], cursor }` (also usable as an async iterator `follow(cursor)`); `act(runId, { answer: { ask, choice, words? } } | { cancel: { reason } } | { resume: {} }) -> { ok } | { ok: false, refused }`; `inspect(runId) -> { status, steps: [{ id, role, provider, model, tokens, dollars, minutes, source }], branch, pr, digest }`; `stopAll(reason) -> { cancelled: string[], survivors: string[] }`.
- `EngineEvent`: `{ type, runId, at, … }`; `ask` carries `{ id, kind, labels, options, context }`; `step-finished` carries `{ step, role, spend: { tokens, dollars, source } }`; `run-ended` carries `{ outcome, branch, pr }`.
- Produces: `fakeEngine({ recordings, now }) -> Engine` that plays a recording's events in order, records every `start` and `act`, refuses a second answer to the same ask, and gives `stopAll` its cancelled list.

- [ ] **Tests first:** `checkEngine names a missing method`; `the fake plays a recording's events in order`; `the fake refuses a second answer to the same ask`; `the fake's watch resumes from a cursor`; `a step with unknown spend has source unknown and null dollars`.
- [ ] Run: fail. Implement. Run: pass. Commit: `Add the engine interface and a fake engine`.

### Task 3: Archon's environment and command line

**Files:**
- Create: `scripts/engine/archon/env.js`, `scripts/engine/archon/cli.js`
- Modify: `scripts/lib/paths.js` (`engineDir()` = `<WHEELHOUSE_HOME>/engine`, `archonHome()` = `<home of the user>/.wheelhouse-engine` — outside `~/.wheelhouse`, spec 6.4), `tests/helpers/stood-in.js` (`archon`, `bun` added to `STOOD_IN`)
- Test: `tests/scripts/engine/archon/env.test.js`, `tests/scripts/engine/archon/cli.test.js`

**Interfaces:**
- Produces: `archonEnv({ engine = engineDir(), home = archonHome(), claudeBin, copilotBin, run } = {}) -> Record<string,string>`: the spec 6.3 environment, `PATH` = `<engine>/broker/bin:<engine>/bun/bin:` then the system folders, with `WHEELHOUSE_ENGINE_RUN=1` so the guards know a step is the engine's (Task 7).
- Produces: `archonCli(args, { run, cwd, timeout }) -> Promise<{ code, json, stdout, stderr }>`: runs `<engine>/archon/bin/archon` with `archonEnv()` and `--json` where the command takes it; callers can't pass an environment.

- [ ] **Tests first:** `archonEnv sets the three telemetry switches`; `archonEnv's PATH has the broker before anything and no folder holding a real gh`; `archonEnv sets ARCHON_HOME outside the Wheelhouse home`; `archonCli always runs with archonEnv` (a fake `run` sees the switches); `archonCli parses JSON output and keeps stderr`.
- [ ] Run: fail. Implement. Run: pass. Commit: `Run Archon one way, with telemetry off`.

### Task 4: The Archon adapter

**Files:**
- Create: `scripts/engine/archon/adapter.js`, `scripts/engine/archon/asks.js`, `scripts/engine/archon/record.js`
- Test: `tests/scripts/engine/archon/adapter.test.js`, `asks.test.js`, `record.test.js`, with recorded Archon output in `tests/fixtures/archon/` (taken from part 2's trials: `workflow get --json --verbose`, `attention --watch --json` lines, `run --detach` output)

**Interfaces:**
- Consumes: Tasks 2 and 3.
- Produces: `archonAdapter({ cli = archonCli, packDir, configFile, now }) -> Engine`:
  - `health()`: the binary at the pinned version (`ENGINE_PINS` from part 3d, read through an injected `pins`), `bun` present, `archon provider list` has `claude`, `archon telemetry status` reports off. Any failure is a plain finding, and telemetry on fails closed.
  - `bindingsFor(order.bindings) -> string[]`: the routing table's column in force as Archon `--model` tier and alias bindings (`large=…`, `@implementer=…`), so nothing in the pack names a model (spec 7.6).
  - `start(order)`: `archon workflow run <workflow> --detach --workflow-source <packDir> --config <configFile> --branch <order.branch> --model <bindings>` with labels `wh.work=<order.work>`, returning the run id. The work order itself never goes on the command line (spec 7.4): only its id.
  - `watch(cursor)`, `follow(cursor)`: from `archon workflow attention --watch --json --after <cursor>`, through `normaliseAsk`.
  - `act`: `archon workflow answer <run> --occurrence <id> --choose <option> | --text <words> --json`; `archon workflow cancel <run>`; `archon workflow resume <run>`. A 409 or "already answered" becomes `{ ok: false, refused }`.
  - `inspect`: `archon workflow get <run> --json --verbose`, through `readRecord`.
  - `stopAll`: Task 8.
- Produces: `normaliseAsk(item) -> EngineEvent` (labels `wh.kind`, `wh.level`, `wh.topic`, `wh.work`, `wh.recommend`, `wh.preview`, and the set line's pull request and head, spec 8.2); `ARCHON_ASKS` (the fixed table, spec 8.3): `hold` on a red main line is level 1 with answer `hold`; rounds ended without a ready review (`rerun`, `finish`) level 3; a schema or permissions change level 3; `usage_limit` no card, only a Logbook line; anything else level 3 recommending the work stop, with the reason in plain words.
- Produces: `readRecord(json) -> inspect shape`, reading each node's `spend` (`costUsd.source: 'unavailable'` becomes `source: 'unknown'`, dollars null) and the run's `workflow_source` digest.

- [ ] **Tests first:** `start passes the pack, the config and the work's id, and never the order's words`; `a second answer is refused, not applied`; `normaliseAsk reads the pack's labels`; `hold on a red main line is level 1 with answer hold`; `an unknown ask kind is level 3 recommending stop`; `a usage limit is a line, not a card`; `readRecord marks unavailable cost as unknown with null dollars`; `health fails closed when telemetry reports on`.
- [ ] Run: fail. Implement. Run: pass. Commit: `Add the Archon adapter`.

### Task 5: The continuation host

**Files:**
- Create: `scripts/engine/host.js`
- Modify: `scripts/host/helper.js` (start and stop the host with the helper, for any project whose `engine` is `archon`), `scripts/host/helper-main.js`
- Test: `tests/scripts/engine/host.test.js`, `tests/scripts/host/helper-engine.test.js`

**Interfaces:**
- Consumes: Tasks 1, 2 and 4.
- Produces: `startEngineHost({ engine, spawn, write, cursorFile, now, backstopMs }) -> { stop() }`: keeps one `archon workflow wake --watch` process and one `follow(cursor)` stream alive, restarting either when it ends; writes a `run` event for `run-started` and `run-ended`, an `ask` event for each new ask (by its stable id, once), and `ask-resolved` as a `run` state change; saves the cursor to `cursorFile` (`projects/<project>/engine/cursor.json`, beside the record) after each write. If check 78 found the stream lost asks, it also reads `attention --json` every `backstopMs` (15 seconds) and writes any ask not yet seen.
- Produces: an `onAsk(event)` hook the card router (part 3c) attaches to; until then asks are only recorded.

- [ ] **Tests first:** `a restarted host resumes from the saved cursor and writes nothing twice`; `an ask seen twice is written once`; `a wake process that ends is started again`; `the backstop writes an ask the stream missed`; `the host stops both processes on stop()`.
- [ ] Run: fail. Implement. Run: pass. Commit: `Supervise Archon's continuation host from the helper`.

### Task 6: The helper starts at sign-in

**Files:**
- Modify: `scripts/lib/login-start.js` (already starts the helper for Copilot; used for every computer once `engine` is `archon` on any project), `scripts/setup/computer.js` (the change listed on setup's card of changes to this computer), `scripts/setup/uninstall.js` (removed by uninstall)
- Test: `tests/scripts/lib/login-start.test.js`, `tests/scripts/setup/computer.test.js`, `tests/scripts/setup/uninstall.test.js`

**Interfaces:**
- Produces: `needsLoginStart({ projects }) -> boolean` (true when any project's `engine` is `archon`, or the existing Copilot condition holds); setup lists "Start Wheelhouse's helper when you sign in, so the build carries on with no session open" as one line on the card of changes to this computer.

- [ ] **Tests first:** `login start is listed when a project uses the new engine`; `uninstall removes the login start`; `a computer with neither condition gets no login start`.
- [ ] Run: fail. Implement. Run: pass. Commit: `Start the helper at sign-in for the new engine`.

### Task 7: The guards learn Archon

**Files:**
- Modify: `scripts/hooks/tool-guard.js` (refuse `archon` beside `gh` and `glab`, by name, through wrappers and runners; refuse reads and writes of `archonHome()` except the step's own run, as check 75 found it can be told), `scripts/protection/settings.js` (deny rules and sandbox `denyRead`/`denyWrite`: `archon.db` and its journal files, `credential-key`, `.env`, `config.yaml`, `plugins/`, every `logs/` and `workflow-source/` folder, every run's artefacts but the step's own; `Bash(archon:*)`; the engine room's port), `scripts/hooks/stop-guard.js` (no bypass marker when `WHEELHOUSE_ENGINE_RUN` is set), `scripts/gate/guardrails.js` (`.archon/**` and `engine/archon/pack/**` in `GUARDRAILS`)
- Test: `tests/scripts/hooks/tool-guard.test.js`, `tests/scripts/protection/settings.test.js`, `tests/scripts/hooks/stop-guard.test.js`, `tests/scripts/gate/guardrails.test.js`, `tests/e2e/safety.test.js`

**Interfaces:**
- Produces: `archonDenyRules(home = archonHome()) -> { deny: string[], denyRead: string[], denyWrite: string[] }`, merged by `projectSettings`; `ownRunRules(runId) -> object` (the per-run overlay or the node's `sandbox` setting, whichever check 75 found works).

- [ ] **Tests first:** `archon is refused as a command`; `archon behind env, npx and a variable is refused`; `reading archon.db is refused`; `reading another run's artefacts is refused and its own is allowed`; `the STOP guard marks no bypass inside an engine step`; `a change to .archon/config.yaml is a guardrail`.
- [ ] Run: fail. Implement. Run: pass, including `tests/e2e/safety.test.js`. Commit: `Extend the guards to Archon`.

### Task 8: All stop reaches the engine

**Files:**
- Create: `scripts/engine/stop.js`
- Modify: `scripts/engine/archon/adapter.js` (`stopAll`), `scripts/host/helper.js` (`/stop/set` and the desk's `all-stop` call it), `scripts/runbook/runbook.js` (its first step cancels every run), `scripts/engine/host.js` (records every process it starts, with its start time)
- Test: `tests/scripts/engine/stop.test.js`, `tests/scripts/host/helper-stop.test.js`, `tests/scripts/runbook/runbook.test.js`

**Interfaces:**
- Produces: `stopEngine({ engine, processes, kill, wait = 10000, now }) -> { cancelled, survivors }`: calls `engine.stopAll(reason)`, waits `wait`, ends every recorded process tree (Unix process groups; Windows `taskkill /T` for later), checks none is left, and returns survivors by name. The Logbook says so when one is left. Lifting All stop resumes nothing; the cancelled work is listed for the First Mate's **Carry on** (resumes, skipping finished steps, or, if check 78 found resume after cancel unreliable, starts the lane again on the same branch with "carry on from what's there").

- [ ] **Tests first:** `All stop cancels every run`; `a process left after ten seconds is ended and named`; `lifting All stop starts nothing`; `the runbook's first step cancels every run`.
- [ ] Run: fail. Implement. Run: pass. Commit: `All stop cancels every engine run and ends its processes`.

### Task 9: Hand-over

- [ ] Run every test file this part touched.
- [ ] Open the pull request `The engine seam, its records and its safety`, and message the main session with its link and anything checks 75 and 78 changed in this part.
