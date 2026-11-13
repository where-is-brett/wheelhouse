<!-- docs/superpowers/plans/2026-11-13-haiku-trial-method.md -->

# Haiku Trial Method Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Haiku trial cheaper per fault. The work has three parts: the runner carries on past faults that leave later steps meaningful, it keeps snapshots it can resume from (with a fresh GitHub repository and counts taken relative to the snapshot), and it gathers the director's clicks into announced sittings.

**Architecture:** The step loop in `probes/haiku-trial/runner.js` gains foundation steps, `needs` and findings. The in-step stop sites become soft where the design says so. Two new modules sit beside the runner: `snapshot.js` copies the local side and `github-snapshot.js` captures and rebuilds the GitHub side, including the `snapshotGh` wrapper. Each new real-world call goes through `io`, as today, so every task tests against `fakeIo` with nothing outside the scratch area. The director's clicks move from their own steps into `sitting-<n>` steps that reuse the existing step bodies.

**Tech Stack:** Node.js 22 ES modules, `node:test`, `node:fs` (`cpSync`), `gh`, `git`, `tmux`.

**Spec:** `docs/specs/2026-11-13-haiku-trial-method.md` (section numbers below are the spec's). Background: `docs/specs/2026-11-08-haiku-trial-design.md`.

## Global Constraints

- **Path comment** on every new file (`// probes/haiku-trial/snapshot.js`). JSON is exempt.
- **Language.** British or Australian English. Dates as day month year. The director is "the director", they/them. No "enhanced", "improved" or "fixed" in names, comments or text.
- **No model identifiers and no AI attribution** in commits, pull requests or comments. The value `haiku` stays where the kit already needs it.
- **The repository is public.** Snapshots and run folders live under `~/.wheelhouse-trials/` and never in the repository.
- **Tests touch nothing outside the scratch area.** They make no GitHub calls, no tmux sessions and no network calls. New outward calls take an injected `io` member, and the real one goes in `host.js`.
- **Never touch a run that is going on.** Nothing in this plan reads or writes `~/.wheelhouse-trials/haiku-2026-11-11-r`. While building, use only temporary folders.
- **Keep the log notes the signal rows read.** The rows read `f6-lift`, `f6-stop`, `LOG.fault('F5a')` and `LOG.fault('F5b')` from the run log by step name. Any step that moves keeps those notes word for word.
- **Testing.** Run the test files a task touches:
  ```
  node --test --import ./tests/helpers/test-home.js tests/probes/haiku-trial/<file>.test.js
  ```
  Leave the whole suite to CI.

## Review Focus

- **A torn jsonl line in a snapshot.** A copy caught mid-write must come back readable, with the cut noted. Task 4 tests it.
- **A resume whose number padding drifts.** This happens when GitHub skips a number or a reopened pull request gets a different one. The resume must stop with a reason, not go on with wrong counts. Task 7 tests it.
- **A carried-on step that leaves state half-set.** For example, `f6-stop` failing with All stop actually set. The sitting must still check the record for the stop before it waits for clicks. Task 8 tests it.
- **`--from auto` after a failed step.** It must move past a step logged as failed, and `--from <step>` must run it again. Task 1 tests it.
- **A window given in local time across midnight**, such as `22:00-02:00`. Task 8 tests it.

## Calls made for this plan

- **Attempts reuse the label (spec §3.1).** No rewriting of records. `resume` renames the old repository and folder to `-a<n>`.
- **Default sitting point `w4`, with `--sitting` repeatable (§5.2).** The original order is `--sitting w3 --sitting w4`.
- **The F6 and F5 step ids leave `STEPS`.** Their bodies become functions that the sitting step calls in order. The log notes stay as they are.
- **The snapshot capture uses the same `io.gh` path strings the kit already calls.** The wrapper matches on those strings.

## File structure

| File | Change |
|---|---|
| `probes/haiku-trial/runner.js` | Step loop (foundation, needs, findings). Soft stop sites. Snapshot points. `resume` command. Sittings. `--sitting`/`--window`/`--snapshot`/`--keep-plugin` arguments. `plan` output. |
| `probes/haiku-trial/snapshot.js` | New. Local copy and restore of a run folder and its transcripts, torn-line trimming, snapshot listing, `SNAPSHOT_POINTS`. |
| `probes/haiku-trial/github-snapshot.js` | New. `captureGithub`, `snapshotGh`, `rebuildGithub`. |
| `probes/haiku-trial/sittings.js` | New. Click list, window parsing, time estimates, `director.md` text. |
| `probes/haiku-trial/signals.js` | `notExercised` faults and findings in rows 14, 15, 23 and 36–40. |
| `probes/haiku-trial/results.js` | Findings section, resumed heading, `claimLost`. |
| `probes/haiku-trial/host.js` | Real `io.snapshot` and `io.github` members (copy, mirror clone and push, settings read and apply, rename). |
| `probes/haiku-trial/README.md` | Resume, carry on, sittings. |
| `tests/probes/haiku-trial/runner.test.js` | Loop, soft sites, points, resume flow and sittings, all on `fakeIo`. |
| `tests/probes/haiku-trial/snapshot.test.js`, `github-snapshot.test.js`, `sittings.test.js` | New. |
| `tests/probes/haiku-trial/signals.test.js`, `results.test.js` | New wording. |

Tasks 1–3 (carry on) stand alone and are worth landing first. Tasks 4–7 (resume) depend on each other in order. Task 8 (sittings) needs only Task 1. Task 9 comes last.

---

### Task 1: The step loop carries on

**Files:**
- Modify: `probes/haiku-trial/runner.js` (`STEPS` flags, `run()` at lines 1024–1081, `main()` exit code)
- Test: `tests/probes/haiku-trial/runner.test.js`

**Interfaces:**
- Produces:
  - A step field `foundation: true` on `stage`, `create-repo`, `install`, `seed`, `setup-s0` and `front-desk`.
  - An optional step field `needs: string[]`.
  - `ctx.state.findings: Array<{ step, what, at, claimLost? }>`.
  - `run()` returns `{ done: string[], findings, failed: string[], skipped: string[], stoppedAt?, why? }`.
  - A failed step logs `{ at, step, note: 'failed: <message>', done: true, outcome: 'failed' }`.
  - A skipped step logs `{ ..., done: true, outcome: 'skipped', note: 'skipped: needs <id>, which failed' }`.
  - `main` returns 1 when `stoppedAt` is set or `findings.length > 0`.

- [ ] **Step 1: Write the failing tests**

  ```js
  test('a failing step that is not a foundation step is a finding and the run goes on', async () => {
    // fakeIo whose faults.f1WrongShape throws new Error('boom'); run({ mode: 'full', from: 'f1', until: 'f1c', ... })
    assert.deepEqual(result.failed, ['f1']);
    assert.ok(result.done.includes('f1b'));
    assert.equal(result.stoppedAt, undefined);
    assert.match(result.findings[0].what, /boom/);
    assert.equal(readLog(folder).find((e) => e.step === 'f1').outcome, 'failed');
  });
  test('a foundation step that fails still stops the run', async () => { /* install exec status 1 → stoppedAt 'install' */ });
  test('a step whose need failed is skipped with the reason', async () => { /* make a test step list via a needs on f1b: ['f1'] */ });
  test('--from auto moves past a failed step; --from <step> runs it again', async () => { /* withLog plus an outcome:'failed' entry */ });
  test('the owner check still stops before anything is created', async () => { /* no HAIKU_TRIAL_GH_OWNER → stoppedAt 'create-repo' */ });
  test('main exits 1 when the run has findings', async () => { /* stub run via buildIo; expect 1 */ });
  ```

- [ ] **Step 2: Run them and see them fail**

  Run: `node --test --import ./tests/helpers/test-home.js tests/probes/haiku-trial/runner.test.js`. Expected: the six new tests fail.

- [ ] **Step 3: Implement**

  In the `catch` of the step loop, stop (as today) only when `step.foundation`, the missing-owner `Stop` or a declined go happened. Otherwise push the finding, log the failed entry, write state and `continue`.

  Before running a step, skip it if any id in `step.needs` is in `failed` or `skipped`.

  Mark these needs:
  - `f1b` and `f1c` need `f1`;
  - `w2-audit` needs nothing;
  - `review-card` needs `raise-decision-3` only for its typed-answer part, which Task 2 handles, so leave it without needs.

  `lastDone` already treats `done: true` as done, so `--from auto` needs no change. Check it with the test.

- [ ] **Step 4: Run the tests and see them pass.** Same command. Expected: all pass, the old tests included.

- [ ] **Step 5: Commit**: `git commit -m "Haiku trial: carry on past a failed step unless it is a foundation step"`

---

### Task 2: Soft stop sites inside steps

**Files:**
- Modify: `probes/haiku-trial/runner.js`, at the sites in the spec §4.2 table (`ghDo` callers in `spareBugCheck`, `mustBeAlive`, `waitMerged`, `answerPicker`, `pieceEnv`, `auditStep`, `raise-decision-3`, `review-card`)
- Test: `tests/probes/haiku-trial/runner.test.js`

**Interfaces:**
- Consumes: Task 1's findings (`addFinding(ctx, step, what, extra)`, a helper added here that pushes to `ctx.state.findings` and writes `io.log`).
- Produces:
  - `waitMerged(ctx, count, wave)` has no `soft` option. It always records `state.shortfall` and returns.
  - `pieceEnv` returns `null` and sets `ctx.state.noSession[id] = true`. Once that is set, a later call does one look and no 40-minute wait.
  - `answerPicker` returns `false`. It records the question in `ctx.state.pickersMissed` once per question, and throws only when `ctx.directorStep === false && ctx.inSetup`, so setup still has its own time limit.
  - Desk restarts are counted in `ctx.state.deskRestarts[wave]`.
  - `faults.<id> = { notExercised: string }` for F1, F1b, F1c and the s9 steps when there is no session.
  - An audit offence adds `{ claimLost: 'model audit' }` to its finding.

- [ ] **Step 1: Write the failing tests**, one per row of the spec §4.2 table that changes:
  - `a short wave 3 is a shortfall and wave 4 asks for that many fewer` (counts from `mergesBy`);
  - `f1 with no feature session records notExercised and f1b does not wait another 40 minutes` (assert the fake clock advanced less than `45 * MINUTE` across f1 → f1c);
  - `a front desk that ends is started again once in a wave, and a second loss stops` (tmux `list` drops `front-desk`; the timeline shows one `tmux.start` for the desk; a second drop sets `stoppedAt`);
  - `a picker that never highlights is recorded once and the run goes on`;
  - `a model offence is a finding with claimLost`;
  - `the spare bug's failed pull request makes P5 not covered` (`ghDo` throws on `pr create` → `state.p5 === 'not-covered'`, `state.p5Why` set);
  - `decision 3 not raised is a finding and review-card shows the card without the typed answer` (`raise-decision-3` faults `secondDecision` returns code 1; `review-card` logs `typed answer not covered`).

- [ ] **Step 2: Run them and see them fail.**

- [ ] **Step 3: Implement** each site as the spec §4.2 table says. `mustBeAlive` keeps throwing for `setup`. For `front-desk` it calls `desk(ctx, DESK)` again under the restart count. The trust prompt (line 405) stays a `Stop`; Task 1's loop turns it into a finding outside foundation steps.

- [ ] **Step 4: Run the tests and see them pass.**

- [ ] **Step 5: Commit**: `git commit -m "Haiku trial: record missing sessions, short waves, pickers and audit offences, and go on"`

---

### Task 3: Rows and summary say what was not covered and why

**Files:**
- Modify:
  - `probes/haiku-trial/signals.js`: rows 14, 15 and 23 (line 356 and its siblings); rows 36–40 (lines 591–629).
  - `probes/haiku-trial/results.js`: `writeSummary`.
  - `probes/haiku-trial/runner.js`: the `results` step passes `findings`, `claimLost` and `resumedFrom`.
- Test: `tests/probes/haiku-trial/signals.test.js`, `tests/probes/haiku-trial/results.test.js`

**Interfaces:**
- Consumes: `faults.<id>.notExercised` and `state.findings` (Tasks 1–2). `state.resumedFrom` comes from Task 7; until then it is `undefined`.
- Produces: `writeSummary({ ..., findings = [], resumedFrom })`.
  - The summary gains a `## Findings` section listing each finding as `- <step>: <what>`.
  - With `claimLost` set, its first line is `This run cannot pass: <claimLost>.`
  - With `resumedFrom` set, its first line is `Resumed from <snapshot> (attempt <n>). Not a run for the record: a passing claim needs one whole run.` That is followed by the spec §3.6 list, filled from `resumedFrom`, with "would pass" or "would not pass" in place of "passed" or "not passed".
  - A row whose evidence step is in `findings` reads `not covered: <step> failed (<what>)`.

- [ ] **Step 1: Write the failing tests**:
  - `row 14 reads notExercised as not covered with the reason`;
  - `row 36 says the F5a step failed rather than the run stopped`;
  - `the summary lists findings`;
  - `claimLost heads the summary`;
  - `a resumed summary is headed as resumed and says would pass, never passed`.

- [ ] **Step 2: Run them and see them fail.**
- [ ] **Step 3: Implement.** `NOT_REACHED` stays for steps never logged. Add `FAILED = (step, what) => \`not covered: ${step} failed (${what})\``.
- [ ] **Step 4: Run the tests and see them pass.**
- [ ] **Step 5: Commit**: `git commit -m "Haiku trial: rows and summary name findings and steps not exercised"`

---

### Task 4: Local snapshots

**Files:**
- Create: `probes/haiku-trial/snapshot.js`
- Modify:
  - `probes/haiku-trial/host.js`: real `io.snapshot`.
  - `probes/haiku-trial/runner.js`: take a snapshot at the points.
- Test: `tests/probes/haiku-trial/snapshot.test.js`, `tests/probes/haiku-trial/runner.test.js`

**Interfaces:**
- Produces from `snapshot.js`:
  - `SNAPSHOT_POINTS`: `Array<{ point: string, after?: string, before?: string, mode: 'full'|'smoke'|'both' }>`. It holds the spec §3.2 table. `after-front-desk` is for smoke only, `after-ntfy` for full only, and `before-sitting-<n>` is added by Task 8.
  - `snapshotsDir(label, base = path.join(os.homedir(), '.wheelhouse-trials'))` returns `<base>/haiku-<label>.snapshots`.
  - `takeLocal({ folder, dest, configDir, transcripts: string[] })` returns `{ torn: Array<{ file, cut: number }> }`. It copies `project`, `wheelhouse-home` (leaving out sockets and `*.sock`), `plugin`, `state.json` and `run-log.jsonl` into `dest/run/`. It copies the transcripts into `dest/transcripts/` relative to `<configDir>/projects`. Then it trims the torn last line of every `.jsonl` under `dest/run`.
  - `restoreLocal({ dest, folder, configDir })` copies back. It refuses if `folder` exists.
  - `listSnapshots(dir)` returns `Array<{ name, meta }>`, sorted by name.
  - `writeMeta(dest, meta)` and `readMeta(dest)`.
- Produces from `runner.js`:
  - `snapshotAt(ctx, point)` waits for quiet on `after-` points (up to `10 * MINUTE`, using the record as `tick` does) and calls `io.snapshot.take({ ... })`. It logs `snapshot <nn>-<point>`.
  - The real `io.snapshot.take` (in `host.js`) calls `takeLocal`. Task 5 adds the GitHub part.
  - A failed snapshot is a finding and never a stop.

- [ ] **Step 1: Write the failing tests** in `snapshot.test.js`, on `fs.mkdtempSync` folders:
  - `takeLocal copies the run and leaves out sockets`;
  - `a torn last jsonl line is cut and reported` (write `{"a":1}\n{"b":` and expect `torn[0].cut === 1` and the file to parse);
  - `restoreLocal puts the run back and refuses an existing folder`;
  - `listSnapshots sorts by number`.

  In `runner.test.js`:
  - `a full run takes after-ntfy, after-w2-audit, before-f1 … in order` (fake `io.snapshot.take` records the points);
  - `after- points wait for quiet up to ten minutes and record quiet false`;
  - `a snapshot that fails is a finding`.

- [ ] **Step 2: Run them and see them fail.**
- [ ] **Step 3: Implement.** Use `fs.cpSync(src, dst, { recursive: true, filter })`, with a filter that drops sockets (`fs.lstatSync(p).isSocket()`). `nn` is the next two-digit number in the snapshots folder. The meta holds the spec §3.3 fields (`label, point, step, at, attempt, pluginSha, quiet, running, torn`). `maxNumber` comes in Task 5.
- [ ] **Step 4: Run the tests and see them pass.**
- [ ] **Step 5: Commit**: `git commit -m "Haiku trial: keep a local snapshot at each wave's end and before fault steps"`

---

### Task 5: The GitHub capture

**Files:**
- Create: `probes/haiku-trial/github-snapshot.js` (capture part)
- Modify: `probes/haiku-trial/host.js` (`io.snapshot.take` adds the GitHub side, plus a real `io.github`)
- Test: `tests/probes/haiku-trial/github-snapshot.test.js`

**Interfaces:**
- Consumes: `io.gh(args)`, the same call shape as today (`['api', '<path>']`, scoped by `host.useRepo`).
- Produces `captureGithub({ gh, github, slug, dest, seedSha })`, which returns `{ maxNumber }`. It writes:
  - `dest/github/capture.json`, keyed by the exact path strings the kit calls:
    - `repos/{slug}/pulls?state=all&per_page=100`
    - `repos/{slug}/pulls/{n}/commits`
    - `repos/{slug}/commits/{sha}`
    - `repos/{slug}/commits/{sha}/statuses`
    - `repos/{slug}/commits/{sha}/pulls`, for each main commit since `seedSha`
    - `repos/{slug}/actions/runs`
    - `repos/{slug}/branches`

    Before writing this task, grep `runner.js`, `signals.js` and `score/` for `io.gh(` and `gh(`, and list every path in a constant `CAPTURED`, so the capture and the wrapper share one list.
  - `dest/github/settings.json`: `repos/{slug}` merge fields, `branches/main/protection` (404 → `null`), `rulesets`.
  - `dest/github/open.json`.
  - `dest/github/mirror.git`, through `github.mirror({ slug, dir })` (`git clone --mirror`, then `git for-each-ref refs/pull --format='delete %(refname)' | git update-ref --stdin`).
  - `maxNumber`: the highest `number` across `issues?state=all&per_page=1&sort=created&direction=desc` and the pulls list.

- [ ] **Step 1: Write the failing tests** with a fake `gh` that serves a small repository (three merged pull requests, one open, two main commits):
  - `capture.json holds every CAPTURED path the fake served`;
  - `maxNumber counts issues as well as pull requests`;
  - `a 404 for protection is stored as null`;
  - `open.json holds only open pull requests with head, base, title, body and draft`.
- [ ] **Step 2: Run them and see them fail.**
- [ ] **Step 3: Implement.** Pages: follow `per_page=100` with `&page=N` until a short page, as the kit's lists would see them. The meta gains `maxNumber`.
- [ ] **Step 4: Run the tests and see them pass.**
- [ ] **Step 5: Commit**: `git commit -m "Haiku trial: capture the GitHub side of a snapshot"`

---

### Task 6: Counts relative to the snapshot

**Files:**
- Modify: `probes/haiku-trial/github-snapshot.js` (add `snapshotGh`), `probes/haiku-trial/runner.js` (`contextFor` wraps `io.gh` when `state.resumedFrom` is set)
- Test: `tests/probes/haiku-trial/github-snapshot.test.js`, `tests/probes/haiku-trial/runner.test.js`

**Interfaces:**
- Consumes: `capture.json`, `maxNumber`, and `reopened: number[]` (from `state.resumedFrom.reopened`).
- Produces: `snapshotGh(gh, { capture, maxNumber, reopened, since })`, which returns an `io.gh`-shaped function. It follows the spec §3.5:
  - **List paths** return the captured items plus the live items with `number > maxNumber` or in `reopened`, the live copy winning. Runs use `created_at > since`.
  - **Item paths** in the capture are answered from it, except `pulls/{n}/…` for `n` in `reopened`.
  - **Everything else, and every non-GET** (`-X`, `-f`, `pr create`, `pr merge`), goes live.

- [ ] **Step 1: Write the failing tests**:
  - `the pulls list joins captured and new pull requests`;
  - `a reopened pull request is read live`;
  - `a captured commit's statuses come from the capture`;
  - `writes always go live`;
  - in `runner.test.js`, `after a resume, the wave-3 merge wait counts merges from before the snapshot` (state with `resumedFrom`, a capture with three merged pull requests, a live repository with one new one, so `mergedPulls` gives four).
- [ ] **Step 2: Run them and see them fail.**
- [ ] **Step 3: Implement.** Match on the path with its query string left out for item paths. Keep the query for lists.
- [ ] **Step 4: Run the tests and see them pass.**
- [ ] **Step 5: Commit**: `git commit -m "Haiku trial: read GitHub counts relative to a resumed run's snapshot"`

---

### Task 7: The `resume` command

**Files:**
- Modify:
  - `probes/haiku-trial/github-snapshot.js`: add `rebuildGithub`.
  - `probes/haiku-trial/runner.js`: `resume()`, `parseArgs` for `--snapshot` and `--keep-plugin`, and `main`.
  - `probes/haiku-trial/host.js`: real `io.github` members.
- Test: `tests/probes/haiku-trial/github-snapshot.test.js`, `tests/probes/haiku-trial/runner.test.js`

**Interfaces:**
- Consumes: `restore()`, `restoreLocal`, `readMeta`, `snapshotsDir` and the `STEPS` ids.
- Produces:
  - **`io.github`** (real in `host.js`, faked in tests):
    - `rename({ slug, to })`
    - `create({ slug, public: true, description })`
    - `pushMirror({ dir, remote })`, which runs `git push --mirror` after the `refs/pull` delete from Task 5
    - `openPull({ slug, head, base, title, body, draft })`, which returns `{ number }`
    - `placeholder({ slug, title })`, which creates and closes an issue and returns `{ number }`
    - `applySettings({ slug, settings })`
  - **`rebuildGithub({ github, slug, src, maxNumber, open, attempt, snapshot, sleep })`** returns `{ reopened: number[] }`. It numbers 1…`maxNumber`, pacing with `sleep(1000)`. If any returned number differs from the one wanted, it throws `Stop('number <want> came back as <got>: the fresh repository is out of step with the snapshot')`.
  - **`resume({ folder, label, snapshot, io, keepPlugin, configDir })`** returns the result of `run(...)` from the next step, or `{ stoppedAt: 'resume', why }`. It follows the spec §3.4 order:
    1. check;
    2. refuse while the label's tmux sessions are alive, then call `restore({ force: true })`;
    3. one `io.ask` with the spec's wording;
    4. rename the folder to `haiku-<label>-a<n>` and move the transcripts to its `transcripts-moved/`, then `github.rename`;
    5. `restoreLocal`;
    6. `rebuildGithub`, then apply the settings last;
    7. set `state.resumedFrom = { snapshot, attempt, pluginBefore, pluginNow, maxNumber, quiet, running, reopened, since }`, and append to `attempts.jsonl`;
    8. `run({ from })`, with `stage` and `install` run first unless `keepPlugin`, then `front-desk`, then the step after an `after-` point or the step itself for a `before-` point.
  - **`main`**: `node runner.js resume --date <label> --snapshot <nn-point> [--keep-plugin]`. A missing `--snapshot` prints the list from `listSnapshots`.

- [ ] **Step 1: Write the failing tests**:
  - `rebuildGithub numbers placeholders and reopened pull requests in order` (open pull request #4 of `maxNumber` 5 → calls: placeholder ×3, openPull, placeholder);
  - `a number out of step stops the rebuild`;
  - `settings are applied after the pushes` (order in the fake's timeline);
  - in `runner.test.js`, `resume asks once and does nothing on another answer`;
  - `resume refuses while the label's sessions are alive`;
  - `resume moves the attempt aside, renames the repository, restores, rebuilds and goes on from the step after the point` (fake `io.github` and `io.snapshot`, a temporary snapshots folder, and `run` asserted through the timeline: `stage`, `install`, `front-desk`, then the next step);
  - `a before- point runs its own step again`;
  - `--keep-plugin skips stage`.
- [ ] **Step 2: Run them and see them fail.**
- [ ] **Step 3: Implement.** `n` is one more than the attempt count in `attempts.jsonl`, or 1 if there is none. The ask text is the spec §3.4 step 3 wording, word for word.
- [ ] **Step 4: Run the tests and see them pass.**
- [ ] **Step 5: Commit**: `git commit -m "Haiku trial: resume a run from a snapshot as a new attempt"`

---

### Task 8: Director's sittings

**Files:**
- Create: `probes/haiku-trial/sittings.js`
- Modify: `probes/haiku-trial/runner.js` (replace the steps `f6-stop`, `f6-undo`, `f6-wait-5m`, `f6-lift`, `f5a-undo-p6` and `f5b-undo-p2` with sitting steps; `parseArgs` for `--sitting` and `--window`; `director.md` at the start, at each wave's end and on a resume)
- Test: `tests/probes/haiku-trial/sittings.test.js`, `tests/probes/haiku-trial/runner.test.js`

**Interfaces:**
- **`sittings.js`** produces:
  - `SITTING_POINTS = { w3: 'f1c', w4: 'w4-type', end: 'w5-midnight' }`: the step after which each sitting goes.
  - `CLICKS = [{ id: 'F6', ready: ['p6Merged', 'building'] }, { id: 'F5a', ready: ['F6'] }, { id: 'F5b', ready: ['p2Merged', 'p3Merged'] }]`.
  - `placeClicks(points: string[])` returns `Array<{ n, after, clicks: string[] }>`. Each click goes in the first sitting at or after the earliest point where it can be ready: F6 and F5a from `w3`, F5b from `w4`. The default `['w4']` gives `[{ n: 1, after: 'w4-type', clicks: ['F6', 'F5a', 'F5b'] }]`, and `['w3', 'w4']` gives F6 and F5a in 1 and F5b in 2.
  - `parseWindow('HH:MM-HH:MM')` returns `{ start, end }` in minutes, with `end < start` meaning it crosses midnight.
  - `windowState(windows, nowLocal)` returns `'open' | 'before' | 'past'`.
  - `TYPICAL_MS`, a table per step id. Take the values from the finished runs' log times, and say in a comment that they are rough.
  - `estimate({ remaining: string[], now })` returns `{ early, late }`. The late edge sums each remaining step's time limit (`WAVE_WAIT_MS` and the step's own `timeoutMs` constants).
  - `directorNote({ sittings, estimates, windows })` returns the markdown of spec §5.3.
- **`runner.js`** produces:
  - The step bodies of today become `clickSteps.F6(ctx, io)`, `.F5a` and `.F5b`.
  - F6's typed steps stay the same (`all stop`, refused undo, five minutes, `lift all stop`). Its watch for `lift-stop` now waits up to `15 * MINUTE` and, if the lift does not come, is followed by the one terminal ask of spec §5.4.
  - F5a and F5b wait for `undo-merge` or `keep-main` naming the merge, up to `15 * MINUTE`, with no "done" ask.
  - Each keeps its log note (`f6-stop`, `f6-lift`, `LOG.fault('F5a')`, `LOG.fault('F5b')`).
  - Before F5a, `undoClash(ctx, sha)` (from `git log <sha>..main --name-only` through `io.host.git`) adds the finding `F5a will clash: <commit> touched <file>`.
  - `sittingSteps(points, windows)` returns `{ id: 'sitting-<n>', wave, smoke: false, director: true, run }`, inserted after `SITTING_POINTS[point]`. `planRun({ mode, sittings, windows })` takes them.
  - With no windows, the step asks once (`Sitting <n>: <k> clicks in the helper window, about <m> minutes. Answer ready when you are at the screen.`).
  - With windows, it waits while the window is `'before'`, calling `tick`, starts on `'open'`, and is skipped with a finding on `'past'`.
  - Before waiting for any click, the sitting reads the record. If All stop is set and no `lift-stop` follows it, F6's lift comes first.
  - A `before-sitting-<n>` point joins the snapshot points from Task 4.

- [ ] **Step 1: Write the failing tests.**

  In `sittings.test.js`:
  - `placeClicks defaults to one sitting at w4 with all three clicks`;
  - `w3 and w4 keep the original order`;
  - `a window across midnight is open at 01:00`;
  - `estimate gives early before late`;
  - `the director note names each sitting, its clicks and its time range`.

  In `runner.test.js`:
  - `the default plan has sitting-1 after w4-type and no f6 or f5 step ids`;
  - `a sitting asks once and the trial never clicks` (assert no `tmux.keys` call carries a click on a card, and one `ask`);
  - `F5a and F5b finish on the signed action without a done ask`;
  - `a lift that does not come leads to one terminal ask, and the run waits for it`;
  - `a sitting before its window keeps ticking and starts when the window opens`;
  - `a sitting after every window is skipped with a finding, and rows 36–40 say so`;
  - `an F5a target touched later is a finding before the undo is typed`;
  - `All stop already set by a failed f6 step is lifted first`.
- [ ] **Step 2: Run them and see them fail.**
- [ ] **Step 3: Implement.** Local time for windows comes from `new Date(io.clock.now())` with `getHours()`/`getMinutes()`. Tests set `TZ=UTC` in the test or pass an offset through `ctx`. `director.md` is written to the run folder, and its first line goes to `io.log`.
- [ ] **Step 4: Run the tests and see them pass.** Then run `signals.test.js` too, since the rows read the moved notes.
- [ ] **Step 5: Commit**: `git commit -m "Haiku trial: gather the director's clicks into announced sittings"`

---

### Task 9: The plan output and the README

**Files:**
- Modify: `probes/haiku-trial/runner.js` (`plan` command), `probes/haiku-trial/README.md`
- Test: `tests/probes/haiku-trial/runner.test.js`

**Interfaces:**
- Consumes: `SNAPSHOT_POINTS` (Task 4) and `placeClicks` (Task 8).
- Produces: `plan` prints these extra lines after each mode's steps:
  - `snapshots: <point> …`
  - `sittings: sitting-1 after w4-type (F6, F5a, F5b)` (or as `--sitting` sets)
  - a legend line that adds `# snapshot point`.

- [ ] **Step 1: Write the failing test**: `plan prints snapshot points and sittings`.
- [ ] **Step 2: Run it and see it fail.**
- [ ] **Step 3: Implement**, and add three short README sections:
  - **Carrying on**: foundation steps, findings and the exit code.
  - **Snapshots and resume**: the command, what a snapshot holds, where it lives, the one go, and the spec §3.6 list of what a resumed run cannot claim, in full.
  - **The director's sittings**: `--sitting`, `--window`, `director.md`, and the fact that the trial never clicks.

  Update the go points and "the director's four steps" sections to match.
- [ ] **Step 4: Run the test and see it pass.**
- [ ] **Step 5: Commit**: `git commit -m "Haiku trial: plan output and README for resume, carrying on and sittings"`

---

## Self-review

- **Spec coverage:**
  - §3.1–3.2: Tasks 4 and 7.
  - §3.3: Tasks 4 and 5.
  - §3.4: Task 7.
  - §3.5: Task 6.
  - §3.6: Tasks 3 and 9.
  - §4.1: Task 1.
  - §4.2: Task 2.
  - §4.3: Task 3.
  - §5.1–5.4: Task 8.
  - §6: the Global Constraints, Task 7's refusal while sessions are alive, and Task 7's ask.
  - §7: nothing is built.
- **Names checked across tasks:**
  - `addFinding`, `state.findings`, `notExercised`, `claimLost` and `resumedFrom` (fields listed in Task 7, read in Task 3).
  - `snapshotGh`, `captureGithub`, `rebuildGithub`, `CAPTURED`.
  - `SNAPSHOT_POINTS`, `SITTING_POINTS`, `placeClicks`.
- **Proportion:** the plan carries signatures, test names and ordering, not bodies. The one fixed wording is the resume ask, which points at the spec.
