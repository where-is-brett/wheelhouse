<!-- docs/plans/2026-11-24-builders-and-user-settings.md -->

# Builders in Claude Desktop, the launch command and user settings: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** builders start, sign in and stop on any computer where the director's own Claude works (Desktop, terminal, or a terminal behind a wrapper); a sign-in fault is found once and said plainly; the director's usual setup answers are kept per computer.

**Architecture:** two routes behind the agent seam, `desktop` and `background`, chosen per computer and per agent and read through one module (`scripts/lib/route.js`). The background route keeps today's detached starts, with an optional launch command and a sign-in gate. The Desktop route has the watcher queue wakes as files and a foreman Desktop session start, wake and stop builders with Desktop's session tools, nested under the foreman where part 0 shows Desktop can do it.

**Tech stack:** Node.js 22 (ES modules), `node:test`, `node:assert/strict`. No new dependencies.

**Spec:** `docs/specs/2026-11-24-builders-and-user-settings-design.md` (approved 24 November 2026, decisions in its section 16). Section numbers below are the spec's.

## Global constraints

- Each part is one fresh session's work, on its own branch from `main`, and ends with the test files it touches passing (`node --test <files>`). Never `npm test` (about 40 minutes); CI runs it.
- British English; dates as day month year; the director is "the director", they/them.
- Every new file starts with its repository-relative path comment (JSON exempt).
- No "enhanced", "improved" or "fixed" in names, comments or user text. No model names, no AI attribution in code, commits or pull requests.
- Core scripts never name an agent. Claude Code specifics live in `adapters/claude-code/`; Copilot's in `adapters/copilot/` only.
- Scripts and hooks are Node.js and must run on macOS and Windows. `spawn` with `shell: false`; Windows `.cmd`/`.bat` only through `quoteForCmd` (`scripts/lib/claude.js`).
- No free text from a file a session can write ever becomes a command, a prompt or a program name (spec section 3, anti-goals).
- A builder start can never loop on the same fault (section 10.2): one sign-in failure stops the route; three same-kind failures in a row hold the piece.
- The route never changes except by the director's setting; no automatic fallback from `desktop` to `background` (section 7.5).
- Wheelhouse never writes `~/.claude/settings.json` without the director's click.
- Exact values the spec pins: builder sign-in check timeout 90 s; foreman check-in fresh under 2 min (setup) and away over 3 min (watcher); heartbeat every 60 s; `wait-wake.js` exits after 50 min with no wake; launch command at most 8 words, each under 200 characters; sign-in excerpt up to 200 characters; start output files deleted after classifying or 24 h; hourly sign-in re-check; helper timeout line at 15 s; builder titles under 60 characters; detached sessions ended 30 min after a background-to-Desktop change; own-files shrink refused above one half.

## Review focus

1. **A launch command that smuggles shell text** (a `;`, `$(`, `%PATH%`, a quoted `&`, a `.ps1`, a trailing backslash) must be refused at typing, at storage read and at start, and named, never run. Owner: part 3.
2. **A malformed `sign-in.json`, route value or profile view** must read as unknown and be named with file, line and column; never as "no fault" (which would restart the loop) and never as empty. Owners: parts 1, 2, 5.
3. **All stop while a sign-in fact stands, or during the hourly re-check,** must freeze both: no re-check runs, nothing is cleared, and lifting All stop doesn't fire a burst of queued starts before the gate is read. Owner: part 2b.
4. **Two "Start the foreman" clicks, or a foreman left running after a route change to `background`,** must never leave two foremen starting builders for one project. Owners: parts 5 and 6.
5. **A builder row the director typed in (the helm) while a wake for that piece is queued** must not receive the wake by `send_message`. Owner: part 7.

Each line has its pinning test in the owning part, marked "(review focus N)".

## Parts at a glance

| Part | What | Depends on | Needs the Mac's Desktop | Helps the work laptop now |
|---|---|---|---|---|
| 0 | Desktop probe, including nesting | none | **yes** (one Start click, decision 16.3) | no |
| 1 | Malformed files named | none | no | yes |
| 2 | The sign-in gate | 1 (`readJsonNamed`) | no | yes |
| 2a | Homes and processes | 1 | no | yes |
| 2b | All stop reaches everything (background half) | 2 | no | yes |
| 2c | Sessions know what they are | none | no | yes |
| 3 | The launch command | 1 | no | yes |
| 4 | The builder sign-in check | 2, 3 | no | yes |
| 5 | Routes | 1, 2, 3 | no | partly (the setting and setup question) |
| 6 | The Desktop foreman | 0, 5, 2b | **yes** (its sitting) | yes, once built |
| 7 | Desktop closed | 6 | **yes** (its sitting) | yes, once built |
| 8 | Usual answers | 5 | no | yes |
| 9 | Trial on the work laptop | 1 to 8 | no (the work laptop's Desktop) | it is the proof |

**Parallel waves.** A part starts when everything it depends on is merged.

- **Wave 1, in parallel:** 0, 1, 2c. (0 waits only for the director's click, and blocks nothing until part 6.)
- **Wave 2, in parallel, once 1 is merged:** 2, 2a, 3.
- **Wave 3, in parallel:** 2b (after 2), 4 (after 2 and 3), 5 (after 2 and 3).
- **Wave 4:** 6 (after 0, 5 and 2b) and 8 (after 5) in parallel.
- **Wave 5:** 7 (after 6).
- **Wave 6:** 9.

Parts 1, 2, 2a, 2b, 2c, 3 and 4 help the work laptop now: with a wrapper as the launch command on the background route, they may be enough to build there before the Desktop route exists.

**Files touched by more than one part** (merge one before starting the next where waves overlap): `scripts/watcher/waker.js` (2, 2b, 5, 7), `scripts/setup/health.js` (2b, 4, 6), `scripts/hooks/session-start.js` (1, 2, 2c, 7), `scripts/settings/catalogue.js` (3, 5, 8), `skills/front-desk/SKILL.md` (2, 2c, 7, 8). Parts in one wave that share a file are 2 and 2a (`keep-alive.js` only in 2a, gate only in 2) and 4 and 5 (`health.js` only in 4): no shared file in fact; keep it so.

---

### Part 0: Desktop probe

**Depends on:** nothing. **Needs the Mac's Desktop:** yes, a short sitting with one **Start** click by the director (decision 16.3). The First Mate sends the card when the probe is ready.

**Files:**
- Create: `probes/97-desktop-builders/run.js` (the pure parts: the findings record and its note writer), `probes/97-desktop-builders/README.md` (the sitting's steps, for the driving Desktop session)
- Create: `tests/probes/97-desktop-builders/run.test.js`
- Create (at the sitting): `docs/specs/notes/2026-11-24-desktop-probe.md`

**Interfaces:**
- Produces: `FINDINGS` (frozen list of finding keys) and `notesFor(findings) -> string` in `run.js`; the note file that parts 6 and 7 read. Keys: `cwdOnOffer`, `worktreePath`, `worktreeBranch`, `projectHooks`, `entrypoint`, `pluginLoad`, `sendMessage`, `wakeWhenDone`, `quitAndReopen`, `desktopFlag`, `nesting`.
- `nesting` is `{ nested: boolean, how: string | null, sidebar: string }`: `how` names the `start_session` option or parent field that gave the nesting, or `null`; `sidebar` is what the sidebar showed, in words.

- [ ] **Step 1: Write the failing tests**
  - `every finding is named in the note, and a missing one is written "not tried"`: `notesFor({})` contains each key in `FINDINGS` with `not tried`.
  - `nesting is reported plainly either way`: `notesFor({ nesting: { nested: false, how: null, sidebar: 'top-level row' } })` matches `/Desktop did not nest/` and doesn't match `/nested under the foreman: yes/`; with `nested: true, how: 'parent_session_id'` it matches `/nested under the foreman: yes, by `parent_session_id`/`.
  - `the note starts with its path comment and the date as day month year`.
- [ ] **Step 2: Run** `node --test tests/probes/97-desktop-builders/run.test.js`. Expected: FAIL (module missing).
- [ ] **Step 3: Implement `notesFor` and `FINDINGS`.** Write `README.md` with the sitting: from a Desktop session on a scratch project, call `start_session` with `initiation: offer` for a probe builder, trying in turn `cwd`, then each option the tool's own description lists that could set a parent; record each section 4 point and the sidebar as seen. One **Start** click per try is allowed only once; batch the tries into one offer set so the director clicks **Start all** once.
- [ ] **Step 4: Run the tests.** Expected: PASS.
- [ ] **Step 5: Commit** the probe and tests. Open the pull request.
- [ ] **Step 6 (the sitting, after the director's click):** run the README's steps, write `docs/specs/notes/2026-11-24-desktop-probe.md` from `notesFor`, commit it to the same branch. If Desktop can't nest, the note says so and names what the sidebar shows; parts 6 and 7 then build section 7.4's top-level titles.

---

### Part 1: Malformed files named

**Depends on:** nothing. **Needs the Mac's Desktop:** no.

**Files:**
- Create: `scripts/lib/read-json-named.js`
- Modify: `scripts/setup/settings-check.js` (the lone-backslash hint and mend), `scripts/hooks/session-start.js` (the check at every First Mate start), `scripts/watcher/waker.js` (the check before each start), `scripts/setup/computer.js`, `scripts/lib/claude.js` (`readRecordedClaude`), `scripts/profile/store.js` (`readProfileViews`): each moves to `readJsonNamed`.
- Test: `tests/scripts/lib/read-json-named.test.js`, `tests/scripts/setup/settings-check.test.js`, `tests/scripts/hooks/session-start.test.js`, `tests/scripts/watcher/waker.test.js`, `tests/scripts/setup/computer.test.js`, `tests/scripts/lib/claude-find.test.js`

**Interfaces:**
- Produces: `readJsonNamed(file: string) -> { ok: true, value } | { ok: true, missing: true } | { ok: false, file, line, column, hint }`. A missing file is `missing`, distinct from a fault. `faultLine(fault) -> string`, the health and facts line: `"<file> can't be read: line L, column C. <hint>"`.
- Produces: `settingsFault(file) -> null | { file, line, column, hint }` in `settings-check.js`, cached by the file's modification time.

- [ ] **Step 1: Write the failing tests**
  - `a file with a lone backslash in a path is named with its line and column and the Windows hint`: content `{\n "a": "C:\Users\x"\n}`; result `ok: false`, `line: 2`, hint is exactly `` a single `\` inside a path must be written `\\`, or use `/` ``.
  - `a missing file is missing, not a fault, and an unreadable one is never empty` (review focus 2): `readJsonNamed` of a malformed file never returns `value: {}`.
  - `the mend doubles each backslash that isn't a valid escape, and keeps a copy`: after `mend`, `JSON.parse` of the file gives `"C:\\Users\\x"` and the copy beside it holds the old bytes; a valid `\n` escape is left alone.
  - `the First Mate's start names a damaged project settings file`: `decide` with a malformed `.claude/settings.local.json` puts a line naming the file and position in the context.
  - `the waker waits and says why when a settings file is damaged`: the start decision for a waiting piece returns `not started: <file> can't be read`.
- [ ] **Step 2: Run** the six test files. Expected: the new tests FAIL.
- [ ] **Step 3: Implement.** Line and column come from the `JSON.parse` error's position (Node 22 gives `position N`; count lines up to it). The mend's rule: in string literals, a `\` not followed by one of `"\/bfnrtu` becomes `\\`.
- [ ] **Step 4: Run** the six files. Expected: PASS.
- [ ] **Step 5: Commit.**

---

### Part 2: The sign-in gate

**Depends on:** part 1. **Needs the Mac's Desktop:** no.

**Files:**
- Create: `scripts/lib/sign-in-gate.js` (the fact file and the gate), `adapters/claude-code/sign-in-patterns.js`
- Modify: `adapters/claude-code/index.js` (expose `signInPatterns`), `scripts/watcher/waker.js` (output file per start, classify on end, gate before every start and resume, three-in-a-row hold), `scripts/hooks/session-start.js` (the Builders line), the board's status lines in `scripts/board/` (the Builders line in `/status`), and per-piece `start-failing`, `skills/front-desk/SKILL.md` (the card and the facts-only rule, section 10.5)
- Test: `tests/scripts/lib/sign-in-gate.test.js`, `tests/scripts/agents/claude-sign-in-patterns.test.js`, `tests/scripts/watcher/waker.test.js`, `tests/scripts/hooks/session-start.test.js`, `tests/skills/front-desk.test.js`

**Interfaces:**
- Consumes: `readJsonNamed` (part 1).
- Produces, in `sign-in-gate.js`:
  - `signInFile(home) -> string` (`<home>/sign-in.json`)
  - `readSignIn(home) -> { ok: true, facts: { [agentRoute]: Fact } } | { ok: false, fault }`
  - `Fact = { kind: 'not-signed-in' | 'blocked' | 'no-program' | 'other', since: ISO, command: string, excerpt: string, starts: number }`
  - `writeSignInFact(home, agentRoute, fact)`, `clearSignInFact(home, agentRoute)`
  - `gateFor(home, agentRoute) -> { open: true } | { open: false, reason: string }`; a malformed file is `open: false` with the fault named (review focus 2).
  - `classify(output: string, exit: { code, signal, error }, patterns) -> kind`
- Produces, in the adapter: `signInPatterns = { notSignedIn: RegExp[], blocked: RegExp[] }`; `no-program` comes from `ENOENT`/`EACCES`/a `quoteForCmd` refusal, not from patterns.
- Produces, on the piece's record: event `start-failing` with `{ kind, starts }`.
- Produces: `buildersLine(...) -> string` in `scripts/lib/sign-in-gate.js` for the session-start facts; part 5 extends it with the route.

- [ ] **Step 1: Write the failing tests**
  - `"Not logged in · Please run /login" is not-signed-in`, `"Invalid API key"` and `"OAuth token has expired"` too; a 403 naming an organisation or policy is `blocked`; `ENOENT` is `no-program`; anything else is `other`.
  - `one sign-in failure writes the fact and nothing starts on that route for any project`: a waker with two projects and a fake detached start that prints "Not logged in" starts one process, writes `claude-code:background` with `starts: 1`, and the second project's start decision is `not started: builders can't sign in`.
  - `no retry after a sign-in failure`: ten further ticks start no process.
  - `three same-kind other failures in a row hold the piece and write start-failing`: the fourth tick starts nothing for that piece; another piece still starts.
  - `a malformed sign-in.json holds starts and names the file` (review focus 2).
  - `the excerpt is cleaned and at most 200 characters; command is the program's name only`.
  - `the start's output file is deleted after classifying, and one older than 24 hours is swept`.
  - `the Builders line states the recorded fact`: matches `Builders: background as \`claude\` · can't sign in since 14:02 (not signed in)`.
  - `the card is written once while the fact stands`: two ticks after the fact, one card in the outbox; text matches section 10.4.
  - `the playbook says the First Mate states only the Builders line and the board, says "I don't know yet" otherwise, and never suggests restarting a session unless a recorded fact names it` (test on `skills/front-desk/SKILL.md`).
- [ ] **Step 2: Run** the five files. Expected: new tests FAIL.
- [ ] **Step 3: Implement.** The output file goes under `<stateDir>/starts/<work>-<time>.out` and is passed as the waker's existing `output` option. The fact file is written atomically (temp then rename). Clearing is part 4's; this part provides `clearSignInFact` only.
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit.**

---

### Part 2a: Homes and processes (faults 4, 11, 23)

**Depends on:** part 1. **Needs the Mac's Desktop:** no.

**Files:**
- Create: `scripts/lib/standard-env.js`
- Modify: `scripts/watcher/keep-alive.js`, `scripts/lib/login-start.js`, `scripts/host/start-helper.js` (each starts with the standard environment), `scripts/host/helper-record.js` and the watcher's lock (`scripts/lib/start-lock.js` or the watcher's own) to record their home, `scripts/watcher/main.js` (the per-tick home check and held-project exit), `scripts/health/own-files.js` (the shrink guard), `scripts/lib/projects.js` (`held: true` read), `README.md` (the throwaway-home section)
- Test: `tests/scripts/lib/standard-env.test.js`, `tests/scripts/watcher/keep-alive.test.js`, `tests/scripts/health/own-files.test.js`, `tests/scripts/watcher/main.test.js` (create if absent), `tests/docs/readme-throwaway-home.test.js`

**Interfaces:**
- Produces: `standardEnv({ home: string, platform?: string, env?: object, claudePath?: string }) -> object`. Holds only `HOME`; on Windows also `USERPROFILE`, `APPDATA`, `LOCALAPPDATA`, `SystemRoot`, `TEMP`; `PATH` from `pathWithNode` and `claude-path.json`; `LANG`, `LC_ALL`, `LC_CTYPE` when set; `WHEELHOUSE_HOME` always.
- Produces: `homeOf(lockOrRecord) -> string`; the watcher exits when its project isn't registered in that home or the home is gone.

- [ ] **Step 1: Write the failing tests**
  - `nothing of the starting session's environment comes with it`: with `env` holding `ANTHROPIC_BASE_URL`, `CLAUDE_CODE_ENTRYPOINT` and `FOO`, none is in the result; `WHEELHOUSE_HOME` equals `home`.
  - `the Windows set holds the five named variables and no others besides PATH, locale and WHEELHOUSE_HOME`.
  - `a watcher whose project isn't registered in its home exits on its next tick and writes nothing outside it`.
  - `a held project has no watcher: keep-alive and the sign-in start skip it, and lifting the hold starts it on the next tick`.
  - `a write that would shrink own-files.json by more than half is refused and named on the board`; uninstall's write is allowed.
  - `the README has "Trying Wheelhouse without touching your usual setup" with the env line for WHEELHOUSE_HOME`.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.** The throwaway home's processes stop an hour after the last session of that home ends (section 12A.2): the keep-alive records the last session time in the home; the watcher exits past it, unless the home is the default.
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit.**

---

### Part 2b: All stop reaches everything (background half; fault 24)

**Depends on:** part 2 (the gates to freeze). **Needs the Mac's Desktop:** no. The Desktop half (the foreman's `stop_session` calls) is part 6.

**Files:**
- Modify: `scripts/watcher/waker.js` and `scripts/watcher/main.js` (idle under STOP: lock and heartbeat only; stop every detached session it started, recording which), `scripts/lib/sign-in-gate.js` (frozen under STOP), `scripts/lib/stop.js`, `commands/all-stop.md`, `skills/front-desk/SKILL.md` (the "All stopped" card), `scripts/setup/health.js` (`stopTrial`'s second half)
- Create: `scripts/lib/heartbeats.js` (who is still running, from heartbeats)
- Test: `tests/scripts/lib/stop.test.js`, `tests/scripts/watcher/waker.test.js`, `tests/scripts/lib/heartbeats.test.js`, `tests/scripts/setup/health.test.js`

**Interfaces:**
- Consumes: `gateFor`, `readSignIn` (part 2); `stopState` (`scripts/lib/stop.js`).
- Produces: `stillRunning(home, project) -> { stopped: string[], running: { name, why }[] }`, read from heartbeat files only. Part 6 adds the foreman and Desktop builders to `stopped`.
- Produces: the waker's start decision returns `not started: All stop` under STOP.

- [ ] **Step 1: Write the failing tests**
  - `under STOP the watcher starts nothing, writes no wake and no record, and keeps its heartbeat`.
  - `under STOP every detached session the watcher started is stopped with the existing stop, and the stopped ones are recorded`.
  - `under STOP the sign-in gate, the three-in-a-row count and the hourly re-check are frozen` (review focus 3): a standing fact is neither cleared nor re-checked across ticks; a failing start count doesn't grow.
  - `lifting STOP takes effect in one tick, and the gate is read before the first start` (review focus 3): with a sign-in fact standing, lifting STOP starts nothing.
  - `the All stopped card lists stopped and still-running parts from heartbeats`: text matches section 12A.6.
  - `health's STOP trial runs the waker's start decision under the scratch home and expects "not started: All stop"`.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.** Idle, not exited (section 12A.6); held projects still exit (part 2a).
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit.**

---

### Part 2c: Sessions know what they are (faults 7, 20)

**Depends on:** nothing. **Needs the Mac's Desktop:** no.

**Files:**
- Modify: `scripts/foreman/prompt-lead.js` (add `BUILDER_PROMPT_LEAD`), `adapters/claude-code/sessions.js` (`featureStartCall`, `featureResumeCall` lead with it), `scripts/lib/role.js` (role from the lead line), `scripts/hooks/session-start.js` (the First Mate's exact card command lines in its context), `scripts/hooks/tool-guard.js` (the plain refusal for sessions with no role; a command lookup's refusal prints the command lines), `scripts/setup/health.js` or `finishSetup` (setup's last card says the guards line once), `skills/front-desk/SKILL.md` (never ask the director for a command name; never re-ask an approval), `scripts/decisions/` (the signed-decision lookup)
- Test: `tests/scripts/lib/role.test.js`, `tests/scripts/hooks/tool-guard.test.js`, `tests/scripts/hooks/session-start.test.js`, `tests/skills/front-desk.test.js`, `tests/scripts/decisions/` (the lookup's file)

**Interfaces:**
- Produces: `BUILDER_PROMPT_LEAD` (exact text left to the builder of this part, one line, distinct from `FOREMAN_PROMPT_LEAD`); `signedDecisionFor(project, work, question) -> { at } | null`.
- The refusal's first sentence is exactly: "This folder is run by Wheelhouse; its guards apply to every Claude session here."
- Setup's last card carries: "Any Claude session in this folder now works under Wheelhouse's guards."

- [ ] **Step 1: Write the failing tests**
  - `a builder's first prompt starts with the builder lead, and the hook knows the role from the first tool call`.
  - `a refusal in a session with no role begins with the guards sentence and names the way out (a separate copy or /wheelhouse:aside)`.
  - `a refused command lookup prints the First Mate's command lines`.
  - `a set-up project's session-start context holds the exact card command lines`.
  - `an approval already signed for the same work and question gives "Already approved on <date>" and no card`: a fresh Desktop chat on approved work.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.** Guards stay on for every session; only the wording changes (section 12A.3).
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit.**

---

### Part 3: The launch command

**Depends on:** part 1. **Needs the Mac's Desktop:** no.

**Files:**
- Create: `scripts/lib/launch-words.js` (splitting and checks)
- Modify: `scripts/settings/catalogue.js` (key `builderLaunch:<computerId>`, advanced group, `home: 'profile'`, as `windowsBuildCommands`), `scripts/lib/claude.js` (`resolveClaude` gains `launch`; `recordClaudePath` records it), `scripts/host/helper.js` (the settings route refuses `builderLaunch` without a fresh signed click), `scripts/lib/settings-card.js` (the typed card that shows the words back), `scripts/watcher/waker.js` (passes `launch` to the adapter's start)
- Test: `tests/scripts/lib/launch-words.test.js`, `tests/scripts/lib/claude-find.test.js`, `tests/scripts/lib/settings-card.test.js`, `tests/scripts/settings/catalogue.test.js`, `tests/scripts/host/helper.test.js` (the settings route's file)

**Interfaces:**
- Produces: `splitLaunch(typed: string) -> { ok: true, words: string[] } | { ok: false, refused: string }`; `checkLaunch(words: string[], { platform, which }) -> { ok: true } | { ok: false, why }`.
- Refused characters: `'` `` ` `` `$` `;` `|` `&` `<` `>` `(` `)` `%` `!` `^`, a line break, NUL. Spaces separate words; double quotes group one word.
- Checks: first word matches `/^[A-Za-z0-9][A-Za-z0-9._-]*$/` and resolves on `PATH`, or is an absolute path to an existing executable; at most 8 words, each under 200 characters; no later word starts with `-p`, `--print`, `--resume`, `--session-id`, `--settings` or `--permission-mode`; a `.ps1` first word is refused with "use the wrapper's `.cmd` or `.exe`".
- Produces: `resolveClaude({ ..., launch?: string[] }) -> { command, args }`; with a launch, `command` is the resolved first word and `args` are its other words, then Wheelhouse's.

- [ ] **Step 1: Write the failing tests**
  - `each refused character is refused at typing` (review focus 1), one assertion per character, plus `"a & b"` (a quoted `&` is still refused).
  - `"ug claude" splits to ["ug", "claude"], and "\"C:\\Program Files\\ug.exe\" claude" to two words`.
  - `a stored value that fails a check is named and not used` (review focus 1): a profile value `["ug;rm", "claude"]` gives `checkLaunch` `ok: false`, and the waker doesn't start.
  - `nine words, a 200-character word, a later -p or --settings word, and a .ps1 first word are refused`.
  - `with a launch, resolveClaude runs the wrapper with shell false and Wheelhouse's arguments after its words`, on the POSIX path and the Windows path (fake `platform: 'win32'`): a `.cmd` wrapper goes through `cmd.exe /d /s /c` with every word quoted by `quoteForCmd`; a refusal there is caught and named.
  - `sessionEnv still drops ANTHROPIC_BASE_URL with a launch command`.
  - `the helper refuses a builderLaunch write without a fresh signed click`; no session, foreman or hook route can write it.
  - `the card shows the words back one per line: "Wheelhouse will run: \`ug\` then \`claude\`"`.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.** A fake wrapper for tests is a small Node script written to a temp folder that prints its arguments and "ready".
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit.**

---

### Part 4: The builder sign-in check

**Depends on:** parts 2 and 3. **Needs the Mac's Desktop:** no.

**Files:**
- Create: `scripts/setup/builder-sign-in.js`
- Modify: `scripts/setup/health.js` (check "Builders can sign in"; every helper timeout becomes a failed line; "All checks passed" counts only checks that ran and names the rest), `scripts/host/helper.js` (the hourly re-check while a fact stands; the "Check again" action), `scripts/lib/sign-in-gate.js` (clearing sends the queued wakes), `skills/setup/SKILL.md` (the failing card's three options, section 10.1)
- Test: `tests/scripts/setup/builder-sign-in.test.js`, `tests/scripts/setup/health.test.js`, `tests/scripts/host/helper.test.js`

**Interfaces:**
- Consumes: `resolveClaude` with `launch` (part 3), `sessionEnv`, `classify`, `clearSignInFact`, `writeSignInFact` (part 2), `stopState`.
- Produces: `builderSignInCheck({ home, agent, route, launch, run?, timeoutMs = 90_000 }) -> { ok: true } | { ok: false, kind, line }`. It runs `-p`, `--allowedTools ""`, `--max-turns 1`, prompt "Reply with the word ready.", cwd a scratch folder that isn't a repository. Pass: exit 0 and "ready" in the answer. On the `desktop` route it is replaced by part 6's check-in check; this part returns `{ ok: false, kind: 'other', line: 'not built yet' }` for `desktop`.

- [ ] **Step 1: Write the failing tests**
  - `a fake claude that prints "ready" and exits 0 passes; one that prints "Not logged in" fails as not-signed-in, and the line quotes the kind, never the raw output`.
  - `a fake that never answers fails at 90 seconds` (inject the clock).
  - `a passing check clears the fact and sends the queued wakes; a failing one keeps it`.
  - `the hourly re-check runs only while a fact stands, and not under STOP`.
  - `a helper call that times out during health is a failed line: "The helper didn't answer within 15 seconds (step 3)"`.
  - `"All checks passed" names any check that didn't run`.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit.**

---

### Part 5: Routes

**Depends on:** parts 1, 2 and 3. **Needs the Mac's Desktop:** no.

**Files:**
- Create: `scripts/lib/route.js`, `scripts/watcher/desktop-queue.js`
- Modify: `scripts/settings/catalogue.js` (key `builders:<computerId>`, per agent, advanced, `home: 'profile'`), `adapters/claude-code/index.js` (`sessions.routes = ['desktop', 'background']`), `adapters/copilot/` (its `routes = ['background']`, inside the adapter only), `scripts/host/adapter.js` (the seam's `routes`), `scripts/watcher/waker.js` (reads `builderRoute` every tick; `desktop` queues, `background` starts; the section 11 moves), `scripts/setup/questions.js` and `scripts/setup/choices.js` (the step 3 advanced question, by `CLAUDE_CODE_ENTRYPOINT`), `scripts/lib/sign-in-gate.js` (`buildersLine` gains the route)
- Test: `tests/scripts/lib/route.test.js`, `tests/scripts/watcher/desktop-queue.test.js`, `tests/scripts/watcher/waker.test.js`, `tests/scripts/setup/questions.test.js`, `tests/scripts/settings/catalogue.test.js`

**Interfaces:**
- Consumes: `readJsonNamed`, `checkLaunch`, `gateFor`.
- Produces: `builderRoute({ agent, computer, home, project? }) -> { route: 'desktop' | 'background' | null, launch?: string[], from: 'profile' | 'project' | 'unset' | 'fault', fault? }`. The only reader of `builders:` and `builderLaunch:`. `null` outside setup means nothing starts and the facts say "Builders: not chosen".
- Produces, in `desktop-queue.js` (the spec's "wake file"; its folder is `projects/<p>/watcher/desktop-queue/`, apart from the existing bundle folder `watcher/wakes/`, which keeps holding what the session reads):
  - `queueWake(project, { kind: 'foreman' | 'feature-start' | 'feature-wake', work?, file }) -> path`; atomic; a wake for a piece with one waiting replaces it.
  - `takeWakes(project) -> Wake[]`, `dropWakes(project, paths)`, `oldestWaiting(project) -> ISO | null`.
  - No free text: `file` must be inside the watcher's bundle folder; `work` must match the slug rule.
- Produces: the waker's section 11 moves (background to Desktop: no new detached starts, queued wakes carry the session id, detached sessions still running 30 minutes after the change are ended with STOP's stop; Desktop to background: queued wakes are started detached).

- [ ] **Step 1: Write the failing tests**
  - `builderRoute reads only the per-computer, per-agent key, and a malformed value is from: 'fault' with the file named` (review focus 2).
  - `a stored launch that fails checkLaunch makes the route count as unable to sign in`.
  - `on desktop the waker queues and starts nothing; on background it starts as now`.
  - `a queued wake for a piece with one waiting replaces it`.
  - `a wake whose file is outside the bundle folder, or whose work isn't a slug, is refused`.
  - `a route change takes effect within one tick; a detached session still running 30 minutes after a change to desktop is ended by the watcher`.
  - `a change to background starts the queued wakes detached`.
  - `the setup question offers Desktop as recommended when CLAUDE_CODE_ENTRYPOINT is claude-desktop, only background options in a terminal, and all three, saying so, when the value is unknown`.
  - `Copilot's adapter declares only background, and core scripts name no agent` (grep test over `scripts/`).
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.** The route is set only by setup's answer or the settings card (a signed profile event); never guessed outside setup.
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit.**

---

### Part 6: The Desktop foreman

**Depends on:** parts 0 (its note), 5 and 2b. **Needs the Mac's Desktop:** yes, a sitting at the end (a foreman started from a card, a batch of two pieces, one **Start all**, the sidebar seen).

**Files:**
- Create: `scripts/foreman/wait-wake.js`, `scripts/foreman/check-in.js`, `scripts/foreman/desktop-start.js` (builder title and prompt from the record)
- Modify: `scripts/foreman/start.js` (the Desktop brief, route marked `desktop`, Auto), `skills/foreman/SKILL.md` (the Desktop loop: `wait-wake.js` in the background, `act`, `start_session` offers, `send_message` wakes, `stop_session` on STOP and pause, `archive_session` on remove or merge, the "route changed" and "all stop" exits), `scripts/foreman/act.js` (`act start` returns `{ title, prompt }` and accepts the `builder-started` record), `scripts/hooks/session-start.js` (the builder's hook records `{ sessionId, worktree, branch }` from the marker line, unless part 0 showed `cwd` works on an offer), `scripts/setup/health.js` (the Desktop route's check: check-in under 2 minutes), `skills/setup/SKILL.md` and `skills/front-desk/SKILL.md` ("Start the foreman" card, `user_asked`), `scripts/lib/heartbeats.js` (foreman and Desktop builders in `stillRunning`), `docs/specs/2026-11-08-crew-visibility-design.md` (section 9.3's line)
- Test: `tests/scripts/foreman/wait-wake.test.js`, `tests/scripts/foreman/check-in.test.js`, `tests/scripts/foreman/desktop-start.test.js`, `tests/scripts/foreman/act.test.js`, `tests/skills/foreman.test.js`, `tests/scripts/setup/health.test.js`, `tests/scripts/hooks/session-start.test.js`

**Interfaces:**
- Consumes: `builderRoute`, `takeWakes`, `dropWakes` (part 5); `stillRunning` (part 2b); `BUILDER_PROMPT_LEAD` (part 2c); the probe note (part 0): `cwdOnOffer`, `nesting.how`.
- Produces: `node scripts/foreman/wait-wake.js --project <p>`: heartbeats the check-in every 60 s; exits printing `wakes: <n>` as soon as one is queued, `no wake` after 50 minutes, `route changed`, or `all stop`.
- Produces: `checkIn(project, { sessionId }) -> { ok: true } | { ok: false, running: { sessionId, at } }`; a second foreman for a project with a check-in under 3 minutes old is refused (review focus 4). `checkInAge(project) -> ms | null`.
- Produces: `builderStart(project, work) -> { title, prompt, nest? }`. Title "Wheelhouse · <piece title>" when part 0 found nesting, else "Wheelhouse · <project> · <piece title>"; always under 60 characters, the piece's title shortened first. `nest` is the option part 0 named, or absent.
- Every `start_session` from the foreman: `initiation: offer`, fresh context, worktree on (or `cwd` per part 0), permission mode Auto or lower, `wake_when_done: true`, plus `nest` when present.

- [ ] **Step 1: Write the failing tests**
  - `wait-wake exits at once when a wake is queued, after 50 minutes otherwise, and heartbeats every 60 seconds` (inject clock and poll).
  - `wait-wake exits with "route changed" when the route becomes background, and "all stop" under STOP`.
  - `a second foreman check-in for the project is refused while the first is fresh` (review focus 4).
  - `after a change to background, a running foreman's next heartbeat ends it, and the watcher starts nothing on desktop meanwhile` (review focus 4).
  - `the builder title is under 60 characters, shortens the piece's title first, and carries the project only when nesting isn't available`.
  - `the builder prompt starts with the builder lead and one marker line naming the project and work id, and nothing from the wake file`.
  - `a builder-started record from the hook is accepted only from a session whose first prompt held the marker`.
  - `the foreman skill names offer, Auto, wake_when_done, the nesting option from the probe note, stop_session on STOP and pause, archive_session on remove or merge`.
  - `setup's Desktop check passes on a check-in under 2 minutes old and fails otherwise`.
  - `All stopped lists the foreman and Desktop builders from heartbeats`.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.** Follow part 0's note: if `cwd` works on an offer, pass Wheelhouse's own worktree and drop the adoption; if nesting works, pass its option; if not, use the project title (section 7.4). Update crew visibility's section 9.3 line: crew sessions show in the sidebar on the Desktop route.
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit.**
- [ ] **Step 6 (sitting on the Mac):** setup's "Start the foreman" card, two pieces approved, one **Start all**; record the sidebar as seen (nested or top-level rows) in the pull request.

---

### Part 7: Desktop closed

**Depends on:** part 6. **Needs the Mac's Desktop:** yes, a sitting (quit Desktop with work queued; reopen; one "Start the foreman").

**Files:**
- Modify: `scripts/watcher/waker.js` (`foreman-away` once when the check-in is over 3 minutes old and a wake waits; the phone notice at most once a day; never a fallback), `scripts/alerts/` (the notice "Wheelhouse has work waiting. Open Claude to carry on."), `scripts/hooks/session-start.js` (the fact "Foreman: not running · <n> wakes waiting" and the card), `skills/foreman/SKILL.md` (resuming stopped builders: `send_message` first, a fresh start as a resume if it fails, per part 0's `quitAndReopen`), `scripts/hooks/prompt-record.js` or a builder `UserPromptSubmit` hook (the helm hold from a prompt without the foreman's marker), `scripts/foreman/act.js` (no `send_message` wake for a helm-held piece)
- Test: `tests/scripts/watcher/waker.test.js`, `tests/scripts/hooks/session-start.test.js`, `tests/scripts/hooks/prompt-record.test.js`, `tests/scripts/foreman/act.test.js`, `tests/skills/foreman.test.js`

**Interfaces:**
- Consumes: `checkInAge`, `oldestWaiting`, `builderRoute`, `helmHeld`.
- Produces: record fact `foreman-away` (once per away spell); helm hold file `helm/<work>.json` written by the builder's prompt hook.

- [ ] **Step 1: Write the failing tests**
  - `foreman-away is recorded once, the notice goes at most once a day, and nothing starts on background`.
  - `the First Mate's start shows "Foreman: not running · 3 wakes waiting" and offers the card`.
  - `a prompt in a builder row without the foreman's marker writes the helm hold`; one with the marker doesn't.
  - `a queued wake for a helm-held piece is not sent by send_message, and goes out after Hand back` (review focus 5).
  - `the foreman skill resumes a stopped builder with send_message, then a fresh start in the same worktree with the resume brief if that fails`.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.** On this route `SessionEnd` never ends a helm hold; "Hand back" at the front desk does, as now.
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit.**
- [ ] **Step 6 (sitting on the Mac):** quit Desktop with a wake queued; reopen; the First Mate's fact and card; one click; the queued wake taken.

---

### Part 8: Usual answers

**Depends on:** part 5. **Needs the Mac's Desktop:** no.

**Files:**
- Modify: `scripts/settings/catalogue.js` (`usual.host`, `usual.gitlabBase`, `usual.gitRoute`, `usual.connection`, each per computer, `home: 'profile'`), `scripts/settings/effective.js` (precedence unchanged: project, then profile, then default, with `from`), `scripts/setup/questions.js`, `scripts/setup/choices.js`, `scripts/setup/steps.js` ("Use your usual setup?" and "Keep these as your usual on this computer?"), `scripts/lib/settings-card.js` (advanced group), `README.md`, `skills/setup/SKILL.md`, `skills/front-desk/SKILL.md`, `docs/parked.md` (Shape 2's note: its wake kinds live on in the Desktop route)
- Test: `tests/scripts/setup/questions.test.js`, `tests/scripts/setup/choices.test.js`, `tests/scripts/settings/catalogue.test.js`, `tests/scripts/lib/settings-card.test.js`, `tests/skills/setup.test.js`

**Interfaces:**
- Consumes: `builderRoute` (part 5), `builderLaunch` (part 3), the existing `notifications` profile setting.
- Produces: setup answers marked `from: 'usual'`.

- [ ] **Step 1: Write the failing tests**
  - `with no usual answers, step 3 asks as today`.
  - `with usual answers, step 3's first card is "Use your usual setup?" listing them in words, and "Use my usual" records each as chosen with from: 'usual'`; the host is still reached and the builder sign-in still proved.
  - `"Choose each" asks as today, with the usual answer recommended`.
  - `"Keep these as your usual" is offered only when answers differ or none exist, and saving is a signed profile change`.
  - `never usual: the product, live data, real users, signs apps, protection, Locked, or anything naming a repository` (catalogue test).
  - `a project answer wins inside that project`.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.** Per computer only (decision 16.2): no export, import or sync.
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit.**

---

### Part 9: Trial on the work laptop

**Depends on:** parts 1 to 8 merged and a pre-release on `main` (the README installs from `main` until the director's own run works end to end, decision 16.5). **Needs the Mac's Desktop:** no; the work laptop's Desktop.

**Files:**
- Create: the sitting's notes under the director's private records (not this repository: it is public).

- [ ] **Step 1:** on the work laptop, a throwaway project under a throwaway home (part 2a's README section); setup with Desktop builders; two pieces approved; one **Start all**; both built; record the sidebar (nested or not).
- [ ] **Step 2:** the same with the wrapper as the launch command on the background route.
- [ ] **Step 3:** All stop, then delete the throwaway folder. The director's only steps are clicks.
- [ ] **Step 4:** the sitting's write-up says which route to recommend there. When the director's own Claude Code run works end to end, cut the `v0.3.0` tag and restore the README's tag line from its comment.
