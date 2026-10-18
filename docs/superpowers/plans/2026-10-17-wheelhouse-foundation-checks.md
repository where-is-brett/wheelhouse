<!-- docs/superpowers/plans/2026-10-17-wheelhouse-foundation-checks.md -->

# Wheelhouse foundation and checks: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Set up the Wheelhouse repository as a working, tested Claude Code plugin, and answer the design's checks (section 20), so that the later build plans rest on facts rather than assumptions.

**Architecture:** The repository is the plugin from the first commit (`.claude-plugin/`). Each check gets a small probe under `probes/<nn>-<slug>/`, unit tests for any logic the probe contains, and a findings note under `docs/checks/`. Probes run in throwaway projects under the system's temporary folder and log outside the repository. Three probes produce code the later plans keep: the telemetry receiver (check 7), the token-page link builder (check 14) and the secret box (check 16).

**Tech Stack:** Node.js 22 or later, plain JavaScript modules (ESM), the built-in `node:test` runner, no npm dependencies. GitHub Actions for CI.

**Spec:** `docs/specs/2026-10-17-wheelhouse-design.md` (approved 17 October 2026). Section 20 lists the checks; section 17.2 the build order.

## Scope

The design covers several subsystems, so it is built through a series of plans (see "After this plan" at the end). This is the first. It builds no product behaviour beyond the three pieces of reusable code named above. Its output is a working plugin skeleton, CI, and a findings note for each check, with any design change each one calls for.

## Global Constraints

- **Node.js:** 22 or later (`"engines": { "node": ">=22" }`). *Plan's call*: the current long-term-support line, and the version on the director's Mac (v22.22.1).
- **No npm dependencies** in `probes/`, `scripts/` or tests. Only Node's built-in modules. This follows the design's pinning rule (section 12.4) by having nothing to pin.
- **Modules:** ESM (`"type": "module"`), `.js` files, no build step, no TypeScript.
- **Tests:** `node:test` and `node:assert/strict`, in `tests/**/*.test.js`, run by `npm test` (`node --test`).
- **Both operating systems:** every script runs on macOS and Windows. Use `node:path`, `node:os` and `os.tmpdir()`/`os.homedir()`, never hard-coded `/` paths, shell syntax or shebangs. Hooks are configured as `node "${CLAUDE_PLUGIN_ROOT}/…"` or `node "<absolute path>"`, always quoted.
- **Path comment:** every file starts with a comment giving its repository-relative path (`// probes/lib/log.js`, `<!-- docs/checks/01-foreman.md -->`, `# .github/workflows/ci.yml`). JSON files are exempt.
- **Language:** British or Australian English everywhere; dates as "17 October 2026". No "enhanced", "improved" or "fixed" in names, comments or text.
- **No model identifiers** in commits, pull requests, code comments or other repository content. Commit messages carry no `Co-Authored-By` line naming a model.
- **Secrets:** a probe never prints, logs or commits a secret, and never passes one as a process argument. Probe logs go to `~/.wheelhouse-probes/<nn>-<slug>/`, outside the repository.
- **Throwaway projects:** a probe that needs a project creates one with `makeScratchProject()` (Task 1) under `os.tmpdir()`. No probe runs in this repository or in the first project.
- **The director's computer:** a probe that changes anything outside its scratch project (user settings, a computer-wide settings file, the keychain, a status line) is run only after the director has agreed on a card saying exactly what changes, and its task ends by undoing the change and checking that it is undone.
- **The director's time:** steps marked **Director** need the director at their computer. Batch them (see "The director's sittings").
- **Findings notes** follow the format fixed in Task 1 and checked by its test.

## Review Focus

1. **A path with a space or non-English letters** (`C:\Users\Jo Smith\`, `/Users/zoë/`). Hooks and probes must quote paths. Owning task: Task 1 (`makeScratchProject` and `appendJsonl` tested under a folder named `with space é`).
2. **A secret leaking** into a log, a process's arguments, the console or the repository. Owning tasks: Task 1 (`appendJsonl` redacts values under keys named like `token`, `secret`, `password`), Task 13 (the secret box never puts the secret in an argument list).
3. **The telemetry receiver reachable from the network**, or recording content. Owning task: Task 7 (refuses any host but `127.0.0.1`; the env helper never turns on prompt or tool-detail logging).
4. **A probe's change left behind on the director's computer.** Owning tasks: Tasks 6, 9, 12, 13 (each ends with an undo and a check that it is undone), and Task 11, which runs `glab` from the temporary folder rather than installing it.
5. **A probe run against a real project.** Owning task: Task 1 (`makeScratchProject` refuses any folder outside `os.tmpdir()`).

## File structure

```
.claude-plugin/plugin.json          plugin manifest
.claude-plugin/marketplace.json     lets the repository be added as a plugin source (check 15)
.github/workflows/ci.yml            tests on macOS, Windows and Linux; plugin validation
.gitignore                          adds node_modules/ (exists)
LICENSE                             Apache 2.0, official text
package.json                        type module, engines, npm test
docs/checks/README.md               summary table of all checks
docs/checks/NN-slug.md              one findings note per check
probes/lib/log.js                   probe log folder, JSONL append with redaction
probes/lib/scratch.js               throwaway project maker
probes/lib/hook-logger.js           generic hook: logs its stdin JSON
probes/NN-slug/…                    one folder per check
scripts/telemetry/receiver.js       kept: local OTLP receiver (check 7)
scripts/telemetry/env.js            kept: the telemetry settings for a computer
scripts/host/token-url.js           kept: new-token page links (check 14)
scripts/secrets/secret-box.js       kept: ask for, store and read a secret (check 16)
tests/…                             one test file per module, *.test.js
```

## Findings note format

Each `docs/checks/NN-slug.md` has exactly these headings, in this order:

```markdown
<!-- docs/checks/NN-slug.md -->

# Check N: <short title>

**Answer:** Yes | No | Partly | Deferred — <one line>

## Question
<the check's wording, copied from design section 20>

## Tested on
<macOS version, Windows version, Claude Code version, Claude Desktop version, date>

## Method
## Evidence
## What it means for the design
<section numbers, and the exact change, or "None">

## Needs the director
<"No", or the card to bring them>
```

---

### Task 1: Plugin skeleton, test harness and probe library

**Files:**
- Create: `package.json`, `.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json`, `LICENSE`
- Create: `probes/lib/log.js`, `probes/lib/scratch.js`, `probes/lib/hook-logger.js`
- Create: `docs/checks/README.md`
- Modify: `.gitignore` (add `node_modules/`, already present; add nothing else)
- Test: `tests/probes/lib/log.test.js`, `tests/probes/lib/scratch.test.js`, `tests/probes/lib/hook-logger.test.js`, `tests/docs/checks-format.test.js`

**Interfaces:**
- Produces:
  - `probeLogDir(check: string, home?: string) -> string`: `<home>/.wheelhouse-probes/<check>`, created if missing. `home` defaults to `os.homedir()`.
  - `appendJsonl(file: string, record: object) -> Promise<void>`: appends one JSON line. Replaces the value of any key matching `/token|secret|password|authorization|cookie/i`, at any depth, with `"[redacted]"`.
  - `makeScratchProject({ name: string, settings?: object, files?: Record<string,string> }) -> Promise<{ dir: string, cleanup(): Promise<void> }>`: makes `<os.tmpdir()>/wheelhouse-probe-<name>-<random>/`, runs `git init`, writes `.claude/settings.json` from `settings` and any `files`, makes one commit. `cleanup()` removes the folder and throws if the folder is not under `os.tmpdir()`.
  - `probes/lib/hook-logger.js`, run as `node "<path>/hook-logger.js" <check> <event>`: reads all of stdin, parses it as JSON, appends `{ at, event, input }` to `<probeLogDir(check)>/hooks.jsonl`, exits 0 with no output.

- [ ] **Step 1: Write `package.json`** with `"name": "wheelhouse"`, `"private": true`, `"type": "module"`, `"engines": { "node": ">=22" }`, `"license": "Apache-2.0"`, `"scripts": { "test": "node --test" }`.

- [ ] **Step 2: Write the plugin manifests.** `.claude-plugin/plugin.json`: `name` `wheelhouse`, `version` `0.0.0`, `description` "Lets a director who is not a developer run AI agents that build their product.", `license` `Apache-2.0`. `.claude-plugin/marketplace.json`: `name` `wheelhouse`, `owner.name` `Wheelhouse`, one plugin `{ "name": "wheelhouse", "source": "./", "description": <same> }`.

- [ ] **Step 3: Add `LICENSE`.** Download the official text from `https://www.apache.org/licenses/LICENSE-2.0.txt` and save it unchanged. The path comment rule doesn't apply to the licence text, which must stay verbatim; note that exception in the commit message.

- [ ] **Step 4: Write the failing tests.**

```js
// tests/probes/lib/log.test.js
test('probeLogDir puts logs under .wheelhouse-probes in the home folder', ...)
  // assert.equal(probeLogDir('07-telemetry', home), path.join(home, '.wheelhouse-probes', '07-telemetry'))
  // assert.ok(fs.statSync(that).isDirectory())
test('appendJsonl writes one line per record', ...)
test('appendJsonl redacts secrets at any depth', ...)
  // record { input: { headers: { Authorization: 'Bearer abc' }, gh_token: 'x', note: 'ok' } }
  // line parsed: input.headers.Authorization === '[redacted]', input.gh_token === '[redacted]', input.note === 'ok'
test('appendJsonl works in a folder whose name has a space and an accent', ...)
  // folder: path.join(os.tmpdir(), 'with space é')

// tests/probes/lib/scratch.test.js
test('makeScratchProject makes a git repository under the temp folder with the settings given', ...)
  // dir starts with os.tmpdir(); .git exists; JSON.parse(.claude/settings.json) deep-equals settings
  // `git log --oneline` has exactly one line
test('cleanup removes the folder', ...)
test('cleanup refuses a folder outside the temp folder', ...)
  // call the exported internal assertUnderTmp(path.join(os.homedir(), 'x')) → throws /outside the temporary folder/

// tests/probes/lib/hook-logger.test.js
test('hook-logger appends its stdin to hooks.jsonl and prints nothing', ...)
  // spawn node hook-logger.js 99-test UserPromptSubmit with HOME/USERPROFILE set to a temp folder,
  // stdin '{"prompt":"hi"}' → exit 0, stdout '', last line has event 'UserPromptSubmit', input.prompt 'hi'

// tests/docs/checks-format.test.js
test('every findings note has the required headings in order and a valid answer', ...)
  // for each docs/checks/[0-9][0-9]-*.md: first line is its path comment;
  // '**Answer:** ' line value starts with Yes|No|Partly|Deferred;
  // headings in order: Question, Tested on, Method, Evidence, What it means for the design, Needs the director
test('the summary table lists every findings note', ...)
  // each NN-slug.md file name appears in docs/checks/README.md
```

`hook-logger` must find the home folder through `os.homedir()`, which honours `HOME` on macOS and `USERPROFILE` on Windows, so the test can redirect it.

- [ ] **Step 5: Run `npm test`.** Expected: the new tests FAIL (modules not found); the format test passes vacuously only if `docs/checks/README.md` exists, so it fails too.

- [ ] **Step 6: Implement `probes/lib/log.js`, `probes/lib/scratch.js` (export `assertUnderTmp` as well), `probes/lib/hook-logger.js`**, and write `docs/checks/README.md` with a path comment, one line saying what the folder is, and an empty table: `| # | Check | Answer | Note |`.

- [ ] **Step 7: Run `npm test`.** Expected: all PASS.

- [ ] **Step 8: Validate the plugin.** Run `claude plugin validate .`. Expected: no errors. Record the Claude Code version it ran with (`claude --version`) in the commit message.

- [ ] **Step 9: Commit.**

```bash
git add package.json .claude-plugin LICENSE probes/lib tests docs/checks/README.md
git commit -m "Add the plugin skeleton, test harness and probe library"
```

### Task 2: CI on macOS, Windows and Linux

**Files:**
- Create: `.github/workflows/ci.yml`

**Interfaces:**
- Consumes: `npm test` (Task 1).

- [ ] **Step 1: Write the workflow.** On `pull_request` and on `push` to `main`. Matrix `os: [ubuntu-latest, windows-latest, macos-latest]`. Steps: checkout, set up Node 22, `npm test`. A second job on `ubuntu-latest` installs Claude Code at the version recorded in Task 1 (`npm install -g @anthropic-ai/claude-code@<that version>`) and runs `claude plugin validate .`. `permissions: contents: read` at the top. Pin every action by its full commit SHA, with the version in a comment (look up the current release's SHA for `actions/checkout` and `actions/setup-node`).

- [ ] **Step 2: Push the branch and open a draft pull request** through `gh pr create --draft`, so CI runs. Expected: all four jobs green. If `claude plugin validate` needs a login in CI, remove that job, note it in the commit message, and keep validation as a local step in later plans.

- [ ] **Step 3: Commit** any change made in Step 2.

```bash
git add .github/workflows/ci.yml
git commit -m "Run the tests on macOS, Windows and Linux"
```

### Task 3: Check 2, clickable questions in Desktop

**Files:**
- Create: `docs/checks/02-clickable-questions.md`
- Modify: `docs/checks/README.md` (add its row)

- [ ] **Step 1: Record the macOS evidence already in hand.** On 17 October 2026, in Claude Desktop on macOS (Claude Code 2.1.278), four multiple-choice questions were shown as clickable cards and answered by clicks. Write the note with **Answer:** Partly — macOS confirmed, Windows not yet.

- [ ] **Step 2: Director (Windows, 2 min).** In Claude Desktop on Windows, opened on this repository, the session asks one multiple-choice question with two options. Record whether the options were clickable, with a screenshot saved outside the repository, described in Evidence.

- [ ] **Step 3: Update the answer** to Yes or No, fill "What it means for the design" (if No: section 5.3 needs a fallback, typed numbers), run `npm test`, and commit.

```bash
git add docs/checks
git commit -m "Record check 2: clickable questions in Desktop"
```

### Task 4: Check 7, the telemetry receiver

**Files:**
- Create: `scripts/telemetry/receiver.js`, `scripts/telemetry/env.js`, `probes/07-telemetry/run.js`
- Create: `tests/fixtures/otlp-metrics.json`, `docs/checks/07-telemetry.md`
- Test: `tests/scripts/telemetry/receiver.test.js`, `tests/scripts/telemetry/env.test.js`

**Interfaces:**
- Produces:
  - `parseOtlpMetrics(body: object) -> Array<{ sessionId: string, model: string, type: string, tokens: number, at: string }>`: reads OTLP/HTTP JSON metrics and returns one record per data point of the metric `claude_code.token.usage`, taking `session.id`, `model` and `type` from the data point's attributes. Ignores every other metric.
  - `startReceiver({ port?: number, host?: string, onRecords: (records) => void }) -> Promise<{ port: number, close(): Promise<void> }>`: an `http` server accepting `POST /v1/metrics` with JSON. `host` defaults to `127.0.0.1`; any other value throws `"The receiver listens only on 127.0.0.1"`. `port` 0 picks a free one.
  - `telemetryEnv(port: number) -> Record<string,string>`: the environment settings that switch Claude Code's telemetry to this receiver:
    `CLAUDE_CODE_ENABLE_TELEMETRY: '1'`, `OTEL_METRICS_EXPORTER: 'otlp'`, `OTEL_EXPORTER_OTLP_PROTOCOL: 'http/json'`, `OTEL_EXPORTER_OTLP_ENDPOINT: 'http://127.0.0.1:<port>'`. It never sets `OTEL_LOG_USER_PROMPTS` or `OTEL_LOG_TOOL_DETAILS`, and never sets `OTEL_LOGS_EXPORTER`.

- [ ] **Step 1: Capture a real fixture.** Run `node probes/07-telemetry/run.js`, which starts a receiver on a free port, saves every request body to its probe log folder, and runs `claude -p "Say OK" --max-turns 1` in a scratch project with `telemetryEnv(port)` in the child's environment. Copy one metrics body into `tests/fixtures/otlp-metrics.json`, replacing the session ID and any account or user identifiers with obvious placeholders. Check the exact metric and attribute names against https://code.claude.com/docs/en/monitoring-usage and use those in the tests.

- [ ] **Step 2: Write the failing tests.**

```js
test('parseOtlpMetrics returns token usage by session, model and type', ...)
  // from the fixture: at least one record; every record has sessionId, model, type in
  // ['input','output','cacheRead','cacheCreation'], tokens > 0
test('parseOtlpMetrics ignores other metrics', ...)
  // a body with only claude_code.session.count → []
test('startReceiver delivers posted records', ...)
  // POST the fixture to http://127.0.0.1:<port>/v1/metrics → status 200, onRecords called with parse result
test('startReceiver refuses any host but 127.0.0.1', ...)
  // host '0.0.0.0' → rejects with /only on 127.0.0.1/
test('telemetryEnv points at the receiver and records no content', ...)
  // keys exactly the four above; no key matching /LOG_USER_PROMPTS|LOG_TOOL_DETAILS|LOGS_EXPORTER/
```

- [ ] **Step 3: Run `npm test`.** Expected: FAIL, modules not found.

- [ ] **Step 4: Implement `scripts/telemetry/receiver.js` and `scripts/telemetry/env.js`.** Use `node:http` only. Answer non-metrics paths with 404, and bodies over 1 MB with 413.

- [ ] **Step 5: Run `npm test`.** Expected: PASS on the Mac.

- [ ] **Step 6: Run the probe on the Mac,** and then on Windows (**Director**, Windows, 3 min: open Claude Desktop on this repository there and ask the session to run `node probes/07-telemetry/run.js`). Pass: the receiver starts with no install, and records arrive on both. Note whether Windows Firewall asked anything; a loopback-only listener shouldn't.

- [ ] **Step 7: Write the findings note** (design sections 9.1 and 15, step 6), add its row to the summary, run `npm test`, and commit.

```bash
git add scripts/telemetry probes/07-telemetry tests docs/checks
git commit -m "Add the local telemetry receiver and record check 7"
```

### Task 5: Checks 3 and 8, compaction and prompt-record hooks

**Files:**
- Create: `probes/03-precompact/guard.js`, `probes/03-precompact/run.js`, `docs/checks/03-precompact-retry.md`
- Create: `probes/08-prompt-record/run.md` (the steps, for the director's sitting), `docs/checks/08-prompt-record.md`
- Test: `tests/probes/03-precompact/guard.test.js`

**Interfaces:**
- Consumes: `makeScratchProject`, `probeLogDir`, `appendJsonl`, `hook-logger.js` (Task 1).
- Produces: `guard.js`, run as a PreCompact hook: reads stdin JSON, appends it to `<probeLogDir('03-precompact')>/guard.jsonl` with a running count, and blocks (exit code 2, reason on stderr "probe: blocking compaction <n>") while the count is 3 or less; from the fourth call it exits 0.

- [ ] **Step 1: Write the failing test** for `guard.js`: run it four times with `HOME`/`USERPROFILE` set to a temp folder; expect exit codes `[2, 2, 2, 0]` and four lines in `guard.jsonl`.

- [ ] **Step 2: Run it,** expect FAIL; **implement `guard.js`;** run again, expect PASS.

- [ ] **Step 3: Run check 3.** `probes/03-precompact/run.js` makes a scratch project whose settings set `"autoCompactWindow": 100000` and a `PreCompact` hook (matcher `auto`) running `guard.js`, then runs one headless session that reads large generated files until compaction triggers, continuing with `--resume` for up to ten turns. Answer from `guard.jsonl`: was a blocked compaction tried again on the next request, and after how many? Does the session carry on normally after a block? Record the Claude Code version.

- [ ] **Step 4: Prepare check 8.** Write `probes/08-prompt-record/run.md`: a scratch project whose settings register `hook-logger.js 08-prompt-record UserPromptSubmit` on `UserPromptSubmit`, and `hook-logger.js 08-prompt-record PostToolUse` on `PostToolUse` with matcher `AskUserQuestion`. Then four trials:
  1. the director types a message;
  2. another session sends this one a message (SendMessage);
  3. the session asks the director a multiple-choice question and they click an answer;
  4. the session calls the question tool with `answers` already filled in, as an agent forging a click would.

  (The mod-submitted prompt is tried in Task 6, with the probe mod.)

- [ ] **Step 5: Director (Mac, 5 min).** Run the four trials in Claude Desktop. Then compare the four logged inputs: which fields tell a typed message, a relayed message, a real click and a pre-filled answer apart? Does trial 4 show the director anything at all?

- [ ] **Step 6: Write both findings notes.** For check 8, "What it means for the design" names the exact field or fields the prompt-record hook (section 12.3) will rely on, or, if none is reliable, says so and proposes that approvals wait for the mod's buttons (section 17.1). Add rows, run `npm test`, commit.

```bash
git add probes/03-precompact probes/08-prompt-record tests docs/checks
git commit -m "Record checks 3 and 8: compaction guard and prompt record"
```

### Task 6: Checks 1, 6 and 9, sessions and the probe mod

**Files:**
- Create: `probes/01-foreman/run.md`, `probes/06-usage/statusline.js`, `probes/09-mod/` (a minimal mod, per the `plugin-authoring` skill)
- Create: `docs/checks/01-foreman.md`, `docs/checks/06-usage-in-desktop.md`, `docs/checks/09-mod.md`

**Interfaces:**
- Consumes: `hook-logger.js`, `probeLogDir`, `appendJsonl` (Task 1).
- Produces: none kept. The findings feed the foreman and mod plans.

- [ ] **Step 1: Load the `plugin-authoring` skill** before writing the mod.

- [ ] **Step 2: Write the status line probe.** `probes/06-usage/statusline.js` reads its stdin JSON, appends it to `<probeLogDir('06-usage')>/statusline.jsonl`, and prints `rate_limits.seven_day.used_percentage` if present, else `no weekly figure`.

- [ ] **Step 3: Write the probe mod** in `probes/09-mod/`, as its own small plugin, which:
  - logs `$.session.usage().rateLimits` and every change event to its probe log (check 6);
  - adds a button that writes `{ clicked: <time> }` to `<probeLogDir('09-mod')>/click.json` and then starts a turn with the text "probe: mod button" (check 9, and check 8's mod-submitted prompt);
  - logs every cross-session message it can see (checks 1 and 9).

  Validate it with `claude plugin validate probes/09-mod`, and note which calls the validator reports it makes (design section 17.1: the proof that it never approves prompts).

- [ ] **Step 4: Write `probes/01-foreman/run.md`:** the trials for check 1, in the design's order of preference (section 8):
  1. a second Desktop session in the same scratch project, started by the first, that the director never opens. Messages both ways: does each arrive within 60 seconds, and does the receiving session wake?
  2. a headless session started by a script (`claude -p … --resume`, or the background-session form the current version documents). Can a cross-session message reach it?
  3. does each keep working while the director's session is idle for 10 minutes?

- [ ] **Step 5: Director (Mac, then Windows; 10 minutes each).** The user-settings change is shown first as a card: a status line command pointing at `statusline.js` in `~/.claude/settings.json`, plus the probe mod installed for the scratch project only. Then run the trials in `run.md`, click the mod's button, and look at the status line.

- [ ] **Step 6: Undo and check.** Remove the status line setting and uninstall the probe mod on both computers. Confirm `~/.claude/settings.json` is byte-for-byte as before (keep a copy taken before Step 5, outside the repository).

- [ ] **Step 7: Write the three findings notes:**
  - check 1: which of the three options works on each operating system;
  - check 6: whether the weekly figure reaches a status line and a mod in Desktop;
  - check 9: whether a button can write a file and start a turn, whether the turn's `UserPromptSubmit` input shows it came from a mod, and whether a mod sees cross-session messages.

  Add rows, run `npm test`, commit.

```bash
git add probes/01-foreman probes/06-usage probes/09-mod docs/checks
git commit -m "Record checks 1, 6 and 9: background sessions, usage and the mod"
```

### Task 7: Checks 10 and 11, the sandbox and the host helper

**Files:**
- Create: `probes/11-helper/helper.js`, `probes/11-helper/start.js`, `probes/11-helper/trials.js`, `probes/11-helper/settings.json`
- Create: `docs/checks/10-sandbox-windows.md`, `docs/checks/11-host-helper.md`
- Test: `tests/probes/11-helper/helper.test.js`

**Interfaces:**
- Consumes: `makeScratchProject`, `probeLogDir`, `appendJsonl` (Task 1).
- Produces (probe only; the real helper comes in the state-and-host plan):
  - `helper.js`: an `http` server on `127.0.0.1`, random port, answering `GET /ping` with `{ ok: true, pid }`, and `GET /host` by fetching `https://api.github.com/zen` and returning its status code.
  - `start.js`, run as a `SessionStart` hook: starts `helper.js` detached, writes its port to `<probeLogDir('11-helper')>/port`, exits 0.
  - `trials.js`, run by the agent inside the sandbox: tries each of the trials below and appends `{ trial, ok, detail }` for each to `trials.jsonl`.

- [ ] **Step 1: Write the failing test** for `helper.js`: start it with port 0, `GET /ping` returns 200 and `ok: true`; it listens on `127.0.0.1` only.

- [ ] **Step 2: Run, expect FAIL; implement; run, expect PASS.**

- [ ] **Step 3: Write `settings.json`** for the scratch project: `sandbox.enabled: true`; filesystem read denied for `~/.ssh`, `~/.config/gh`, `~/.npmrc` and `.env*`; writes allowed only in the project folder; network allowed only to `127.0.0.1` (the helper's port) and `registry.npmjs.org`; the `SessionStart` hook running `start.js`. Use the setting names the current sandboxing page documents (https://code.claude.com/docs/en/sandboxing), and record which version's names were used.

- [ ] **Step 4: Write `trials.js`.** Each trial passes when the sandbox refuses the first five and allows the last two:
  1. reading `~/.config/gh/hosts.yml`;
  2. reading a `.env.local` the probe placed in the scratch project;
  3. reading the keychain (`security find-generic-password -s wheelhouse-probe` on macOS; the Credential Manager on Windows);
  4. fetching `https://api.github.com/zen` directly;
  5. starting a second copy of `helper.js` itself and asking it for `/host`;
  6. `GET /ping` on the helper started by the hook;
  7. `GET /host` on that helper: it reaches GitHub.

- [ ] **Step 5: Run on the Mac.** Ask a session in the scratch project to run `node trials.js` through Bash. Record each result.

- [ ] **Step 6: Director (Windows, 5 min).** The same on Windows. If the sandbox setting has no effect there (check 10), say so plainly. The note's "Needs the director" section then carries the card the design promises (section 20, check 10): the options are to accept a weaker Standard on Windows, to use WSL, or to make Locked the only level on Windows, with a recommendation.

- [ ] **Step 7: Write both findings notes.** "What it means for the design" for check 11 says whether the helper design in section 11 stands as written, and lists any route an agent still has to the host or the keys. Add rows, run `npm test`, commit.

```bash
git add probes/11-helper tests docs/checks
git commit -m "Record checks 10 and 11: the sandbox and the host helper"
```

### Task 8: Check 18, connectors and the deny rule

**Files:**
- Create: `docs/checks/18-connectors.md`

- [ ] **Step 1: Record what this session already shows.** On 17 October 2026, a local Claude Desktop session on macOS listed claude.ai connectors as tools named `mcp__<id>__<tool>`. Connectors do reach local sessions.

- [ ] **Step 2: Try the deny rule.** In a scratch project with `permissions.deny: ["mcp__*"]`, ask the session to call one read-only connector tool. Then try `permissions.deny: ["mcp__<one id>"]`. Record which form refuses the call, and whether an allow entry for one connector can coexist with a wildcard deny (design section 12.2's allowlist). Use the exact rule syntax from https://code.claude.com/docs/en/permissions.

- [ ] **Step 3: Write the note,** add its row, run `npm test`, commit.

```bash
git add docs/checks
git commit -m "Record check 18: connectors and the deny rule"
```

### Task 9: Check 12, Locked's computer-wide settings

**Files:**
- Create: `probes/12-locked/managed-settings.json`, `probes/12-locked/locked-hook.js`, `probes/12-locked/install.js`, `probes/12-locked/remove.js`
- Create: `docs/checks/12-locked.md`
- Test: `tests/probes/12-locked/locked-hook.test.js`

**Interfaces:**
- Consumes: `makeScratchProject` (Task 1).
- Produces:
  - `locked-hook.js`, a PreToolUse hook: reads stdin JSON; if `cwd` has no `.wheelhouse-locked-probe` file, exits 0; otherwise, if the Bash command starts with `echo locked-probe`, denies it (`permissionDecision: "deny"`, reason "probe: refused by the managed hook"); otherwise exits 0.
  - `install.js` and `remove.js`: write or remove the managed settings file through the operating system's own administrator prompt: macOS `osascript` "with administrator privileges" to `/Library/Application Support/ClaudeCode/`; Windows an elevated PowerShell (`Start-Process -Verb RunAs`) to `C:\Program Files\ClaudeCode\`. Check both paths against https://code.claude.com/docs/en/settings at run time. The hook script is copied into the same folder.

- [ ] **Step 1: Write the failing tests** for `locked-hook.js`: no marker → exit 0, no output; marker and `echo locked-probe x` → deny; marker and `ls` → exit 0.

- [ ] **Step 2: Run, expect FAIL; implement; run, expect PASS.**

- [ ] **Step 3: Director's card first.** What this is: a test file in the computer's administrator-only settings folder that refuses one harmless command, only in a test folder. Why: to learn whether Locked can work. What changes: one file, removed at the end of this task. Run only on a yes.

- [ ] **Step 4: Director (Mac, then Windows; 5 minutes each).** Run `install.js` (they type their password at the system's prompt). Then, in a marked scratch project:
  1. `echo locked-probe` is refused;
  2. the same command in an unmarked scratch project runs (the hook limits itself);
  3. a project-level hook that answers `allow` for the same command doesn't override the refusal;
  4. with the Task 6 probe mod installed, its approval path can't override it either.

- [ ] **Step 5: Undo and check.** Run `remove.js` (password again). Confirm the folder no longer holds the probe file or the hook, and that `echo locked-probe` runs in the marked project.

- [ ] **Step 6: Write the findings note.** If item 3 or 4 overrode the refusal, "Needs the director" carries the card from design section 12.1 (limiting plugins to an approved list of sources, computer-wide). Add the row, run `npm test`, commit.

```bash
git add probes/12-locked tests docs/checks
git commit -m "Record check 12: Locked's computer-wide settings"
```

### Task 10: Check 13, server-side protection

**Files:**
- Create: `docs/checks/13-server-protection.md`

- [ ] **Step 1: Try it on this repository,** which is private, on GitHub Free. With the director's own login (already on the Mac):
  1. `gh api repos/<owner>/wheelhouse/rulesets` (read);
  2. after the director's yes on a card (it changes this repository's settings), creating a ruleset for `main` that blocks force-pushes and deletion and requires the CI checks from Task 2;
  3. if refused, the classic branch protection endpoint for `main`.

  Record each status code and message. If one succeeds, keep it: protecting this repository's `main` is wanted anyway. Tell the director in the next briefing.

- [ ] **Step 2: GitLab Free,** from its documentation only (no GitLab project exists): are protected branches, blocked force-pushes and required pipelines available for private projects on the free tier? Quote the page and date.

- [ ] **Step 3: Write the note** (design section 12.3), add its row, run `npm test`, commit.

```bash
git add docs/checks
git commit -m "Record check 13: server-side protection on the free plans"
```

### Task 11: Check 5, `glab` coverage

**Files:**
- Create: `probes/05-glab/coverage.js`, `tests/fixtures/glab-help/*.txt`, `docs/checks/05-glab.md`
- Test: `tests/probes/05-glab/coverage.test.js`

**Interfaces:**
- Produces: `checkCoverage(helpTexts: Record<string,string>) -> Array<{ operation: string, command: string, flag: string|null, covered: boolean }>`, using this table of adapter operations (design section 11):

| Operation | Command | Flag that must exist |
|---|---|---|
| open MR | `mr create` | `--source-branch` |
| update MR | `mr update` | `--description` |
| CI status for a commit | `ci status` | `--branch` |
| watch CI | `ci status` | `--live` |
| mergeability | `mr view` | `--output` |
| merge exact head | `mr merge` | `--sha` |
| issues | `issue create` | `--description` |
| issue checklist | `issue update` | `--description` |

- [ ] **Step 1: Get `glab` without installing it.** Download its official macOS release archive into a new, empty folder under `os.tmpdir()` (it isn't on the Mac), check the archive against the release's published checksum, and run the binary from there. Save `glab <command> --help` for each command above into `tests/fixtures/glab-help/<command>.txt`. Record the version.

- [ ] **Step 2: Write the failing test:** with the fixtures, every row is `covered: true`; with a fixture whose `mr merge` help lacks `--sha`, that row is `covered: false`.

- [ ] **Step 3: Run, expect FAIL; implement `checkCoverage`; run, expect PASS.**

- [ ] **Step 4: Write the note.** **Answer:** Partly — the commands exist; a live run waits for a GitLab project (design section 11). Add the row, run `npm test`, commit. Delete the temporary folder.

```bash
git add probes/05-glab tests docs/checks
git commit -m "Record check 5: glab covers the adapter's operations"
```

### Task 12: Check 15, installing at a pinned release

**Files:**
- Create: `docs/checks/15-install-and-pinning.md`

- [ ] **Step 1: Read the current pages** https://code.claude.com/docs/en/plugins/install and https://code.claude.com/docs/en/plugins/marketplaces. Note how a plugin source names a tag or commit, how auto-update is set per source, and whether `plugin.json` can declare dependencies with versions.

- [ ] **Step 2: Tag and try it.** Tag the Task 1 commit `v0.0.0-probe` and push the tag. In a scratch project, install Wheelhouse from this repository's marketplace at that tag, for the project only. Confirm what is installed (`claude plugin list`), that the source's auto-update is off, and that a later commit on `main` doesn't arrive by itself.

- [ ] **Step 3: Director (Mac, 3 min).** In Claude Desktop, paste a single line that asks for the install, as setup step 1 would (design section 15). Record what Desktop could do by itself, how many clicks the reload took, and the exact line that worked.

- [ ] **Step 4: Undo.** Uninstall from the scratch project, remove the source, delete the probe tag locally and on the host.

- [ ] **Step 5: Write the note.** Add the row, run `npm test`, commit.

```bash
git add docs/checks
git commit -m "Record check 15: installing at a pinned release"
```

### Task 13: Checks 16 and 14, the secret box and the token page

**Files:**
- Create: `scripts/secrets/secret-box.js`, `scripts/host/token-url.js`
- Create: `docs/checks/16-secret-box.md`, `docs/checks/14-token.md`
- Test: `tests/scripts/secrets/secret-box.test.js`, `tests/scripts/host/token-url.test.js`

**Interfaces:**
- Produces:
  - `askSecretCommand(platform: 'darwin'|'win32', { title: string, prompt: string }) -> { file: string, args: string[] }`: the command that opens the operating system's own hidden-entry dialog. macOS: `osascript` with `display dialog … default answer "" with hidden answer`; Windows: `powershell -NoProfile -Command` with a WinForms box whose text field uses `UseSystemPasswordChar`. The entered text comes back on stdout.
  - `askSecret({ title, prompt }) -> Promise<string>`: runs that command and returns the trimmed text. Rejects with `"Cancelled"` on cancel.
  - `storeSecretCommand(platform, { service, account }) -> { file, args, stdin: true }` and `storeSecret({ service, account, secret }) -> Promise<void>`: macOS `security add-generic-password -U -s <service> -a <account> -w` with the secret given on stdin, never in `args` (if `security` won't take it from stdin, Step 3 will show it, and the module uses `security -i`, which reads its whole command from stdin); Windows a PowerShell script that reads the secret from stdin and saves it with the `Windows.Security.Credentials.PasswordVault` API.
  - `readSecret({ service, account }) -> Promise<string|null>`.
  - `tokenUrl({ host: 'github'|'gitlab', owner: string, repos: string[], name: string, days: number }) -> string`: GitHub: the fine-grained token page with the name, description, owner, expiry and permissions (contents, pull requests and issues: write; metadata: read) filled in, using the query names GitHub documents at run time. GitLab: `https://gitlab.com/-/user_settings/personal_access_tokens?name=<name>&scopes=api`.

- [ ] **Step 1: Write the failing tests.**

```js
test('askSecretCommand opens a hidden dialog on each platform', ...)
  // darwin: file 'osascript', args joined contains 'with hidden answer'
  // win32: file 'powershell', args joined contains 'UseSystemPasswordChar'
test('storeSecretCommand never puts the secret in its arguments', ...)
  // for both platforms, with secret 'S3CRET-probe': no arg contains 'S3CRET-probe'; stdin === true
test('tokenUrl fills in the GitHub page', ...)
  // new URL(result).hostname === 'github.com'; searchParams.get('name') === name;
  // the contents, pull requests and issues permissions are 'write'
test('tokenUrl fills in the GitLab page', ...)
  // pathname ends '/personal_access_tokens'; searchParams.get('scopes') === 'api'
```

- [ ] **Step 2: Run, expect FAIL; implement both modules; run, expect PASS.**

- [ ] **Step 3: Check 16. Director (Mac, then Windows; 2 minutes each).** From Claude Desktop, the session runs a probe line that calls `askSecret`, then `storeSecret` under service `wheelhouse-probe`, then `readSecret`, and prints only "received N characters, stored, read back: yes/no". The director types any made-up text, never a real secret. Check the transcript and the probe log for the text: it must appear in neither. Then delete the `wheelhouse-probe` item from the keychain and Credential Manager, and confirm `readSecret` returns `null`.

- [ ] **Step 4: Check 14. Director (Mac, 5 min).** Open `tokenUrl` for this repository in the director's browser. Record which fields arrived filled in, the longest expiry offered, and whether "no expiry" is allowed. The director creates the token and enters it through `askSecret`; the probe stores it, then tries with it:
  1. reading this repository (expect allowed);
  2. changing a repository setting, such as the description (expect 403);
  3. creating and merging a throwaway pull request into a throwaway branch (expect allowed), then deleting both branches.

  The director then deletes the token on GitHub's page, and the probe deletes it from the keychain.

- [ ] **Step 5: Write both notes** (design sections 11 and 15, step 3), add rows, run `npm test`, commit.

```bash
git add scripts/secrets scripts/host tests docs/checks
git commit -m "Add the secret box and token links; record checks 14 and 16"
```

### Task 14: Check 4, phone notifications and STOP by message

**Files:**
- Create: `docs/checks/04-remote-control.md`

- [ ] **Step 1: Director (Windows, then Mac; 5 minutes each).** With Remote Control switched on in Claude Desktop and the Claude app on their phone:
  1. a session sends a notification: does it reach the phone?
  2. the director sends "stop" from the phone: does `UserPromptSubmit` (Task 5's logger, in a scratch project) see it, and does its input show it came through Remote Control?

- [ ] **Step 2: Write the note** (design sections 12.7 and 13), add the row, run `npm test`, commit.

```bash
git add docs/checks
git commit -m "Record check 4: phone notifications and STOP by message"
```

### Task 15: Checks 17 and 19, recorded as deferred

**Files:**
- Create: `docs/checks/17-keyless-signing.md`, `docs/checks/19-setup-time.md`

- [ ] **Step 1: Check 17.** **Answer:** Deferred — to the release plan. Why: keyless signing writes an entry to a public transparency log that names the repository, which would publish a fact about a private repository (level 4), and GitHub's attestations need a public repository on the free plan. Record from the documentation, with dates, how `gitsign` and GitHub artifact attestations work, so the release plan can choose.

- [ ] **Step 2: Check 19.** **Answer:** Deferred — to the setup plan, since there is no setup to time yet. Record now, from the official pages: the download size and installer steps for git (macOS: Apple's command-line tools), Node.js LTS and `gh` on both operating systems. These set the budget for setup step 2.

- [ ] **Step 3: Add rows, run `npm test`, commit.**

```bash
git add docs/checks
git commit -m "Record checks 17 and 19 as deferred, with what is known"
```

### Task 16: Bring the findings back into the design

**Files:**
- Modify: `docs/specs/2026-10-17-wheelhouse-design.md` (sections named by the findings notes; section 20's list gains each answer)
- Modify: `docs/checks/README.md`, `HANDOVER.md`

- [ ] **Step 1: Check the summary.** `docs/checks/README.md` lists all 19 checks with their answers; `npm test` passes.

- [ ] **Step 2: Apply each "What it means for the design"** to the design, as a pull request on its own, with each change citing its findings note. A change that alters a decision the director made, or a designer's call that changes what the director sees, is listed for them.

- [ ] **Step 3: Collect every "Needs the director" card** into one batch, most important first, and bring it to the director.

- [ ] **Step 4: Update `HANDOVER.md`:** where the work stands, and the next plan to write.

- [ ] **Step 5: Commit.**

```bash
git add docs HANDOVER.md
git commit -m "Bring the check findings into the design"
```

## The director's sittings

The steps marked **Director** add up to about 45 minutes on the Mac and 30 on Windows. Run them in two or three sittings, each prepared so the director only clicks, types made-up text, or types their computer password:

| Sitting | Computer | Tasks | About |
|---|---|---|---|
| 1 | Mac | 5 (check 8), 6, 9, 12, 13 (checks 16 and 14) | 30 min |
| 2 | Windows | 3, 4 (check 7), 6, 7, 9, 13 (check 16), 14 | 30 min |
| 3 | Mac | 14 | 5 min |

Before each sitting, the session preparing it shows the director one card listing every change it will make to their computer and how each is undone.

## After this plan

Each later plan is written once this plan's findings are in, because they change its details. In the design's build order (section 17.2):

1. **State and the host** (done: `docs/superpowers/plans/2026-10-18-wheelhouse-state-and-host.md`): events and built views, the lock and fencing counter, the secret scan, the weekly backup, the adapter, the host helper, both ways to connect to the host (design section 11, with checks 20 to 23 first), signing keys, server-side protection.
2. **Safety:** the hooks (gate, STOP, prompt record, report check, reload, gauge, PreCompact guard), the sandbox and deny settings, Standard and Locked, the runbook and the data note.
3. **Scripts and settings:** board, briefing and usage (using Task 4's receiver), settings, the weekly official-sources check, the profile.
4. **Agents and skills:** front desk, foreman, builder, reviewer, written and tested with Superpowers writing-skills.
5. **Setup and uninstall,** with the timed runs (check 19), using Task 13's secret box and token links.
6. **The evaluation,** then the pilot on the first project, then installing there.
7. **The rest of the mod.** Its first piece (the usage figure, and the prompt record by origin) comes with step 2, by the director's decision after the checks (design section 17.1).
8. **The first public release,** on the director's approval: a fresh, scrubbed history, the security policy, keyless signing (check 17).
