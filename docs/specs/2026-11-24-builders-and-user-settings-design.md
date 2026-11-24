<!-- docs/specs/2026-11-24-builders-and-user-settings-design.md -->

# Builders in Claude Desktop, the launch command and user settings: design (24 November 2026)

**Status:** approved, with the director's answers to the section 16 cards (24 November 2026). It builds on the core cut (`docs/specs/2026-11-07-core-cut-design.md`) and changes how builder sessions are started, checked and stopped. It touches crew visibility (`docs/specs/2026-11-08-crew-visibility-design.md`) and two parked pieces (section 13). The build plan is `docs/plans/2026-11-24-builders-and-user-settings.md`.

## 1. In plain words

On the work laptop, setup finished and work was approved, but nothing was built. Wheelhouse started about 30 builder sessions in the background as the plain `claude` command. That command can't sign in on that laptop, because a company block stops its sign-in. Only Claude Desktop's own sign-in and a company gateway wrapper work there. Every session died with "Not logged in". Nobody told the director. The First Mate guessed at a cause. Retries never stopped. Switching to Desktop meant killing processes by hand.

This design does five things:

1. **Builders can run as Claude Desktop sessions.** A foreman session in Desktop starts one Desktop session per piece. Each shows in the sidebar with the piece's name, nested under the foreman where Desktop allows it (section 7.4), signs in the way Desktop does, and can be opened. The background route stays for computers where plain `claude` signs in.
2. **A launch command**, such as a company gateway wrapper, is an advanced setting for this computer. Wheelhouse uses it in place of `claude` for every background start.
3. **Sign-in is proved before setup says done.** A sign-in failure stops all starts at once. It gives the director one plain card saying what's wrong and the way out. The First Mate repeats recorded facts and never guesses.
4. **Moving from the terminal to Desktop is a setting, not a clean-up.** The helper and watcher stay running and change what they do. Nobody kills anything.
5. **The director's usual answers** (host, git, connection, notifications, how builders start) are kept once per computer. Setup offers them as "Use your usual". A settings file that can't be read is named, never skipped.

## 2. What happened, in facts

- The watcher (`scripts/watcher/waker.js`) starts the foreman and builders as detached `claude -p` processes through `scripts/lib/claude.js` and the Claude Code adapter (`adapters/claude-code/sessions.js`).
- `sessionEnv` drops host variables, including `ANTHROPIC_BASE_URL`, and keeps only the named sign-in variables. On the work laptop it had nothing to keep. The plain CLI had no sign-in, and the company block stops it from getting one.
- Each failed start ended with "Not logged in · Please run /login". The watcher read that as a session that ended and started it again on the next wake, with no limit.
- Setup's health check (`scripts/setup/health.js`, step 10) tries the host, the merge gate, STOP, the sandbox and the installed skills. It never starts a builder.
- The helper and each watcher are computer-level processes. The sign-in start restarts them every minute, so they outlive any session. Nothing told them the director had moved to Desktop.
- An earlier fault: a project's `.claude/settings.local.json` held Windows paths with single backslashes. That is invalid JSON, so Claude Code skipped the whole file without a word. `scripts/setup/settings-check.js` reads that file only during setup.

## 3. Goals, non-goals, anti-goals

**Goals**

- Builders start, and sign in, on any computer where the director's own Claude works: Desktop, terminal, or a terminal behind a wrapper.
- The director can see every builder and open it.
- A sign-in fault is found in setup, or within one start in use. It is said once, plainly, with the way out.
- Changing how builders start needs one click and no clean-up.
- Answers that belong to the director, not to the project, are asked once per computer.

**Non-goals**

- No sign-in of Wheelhouse's own. Wheelhouse uses the director's Claude sign-in, wherever it lives.
- No change to Copilot's crew (section 9.6).
- No syncing of settings across computers in this design (decision 16.2: per computer only).
- No change to the merge gate, the keys, STOP or the record.

**Anti-goals** (it fails if any of these happen, even when it works):

- A builder start that can loop on the same fault.
- A cause stated that Wheelhouse didn't observe.
- The launch command, or anything a session writes, becoming a way to run arbitrary shell text.
- A new click on every piece. The director already approves the work.
- Builders that silently go back to the background route when Desktop is closed.

## 4. What Desktop offers (the research, 24 November 2026)

Sources: Claude Code's documentation, and a read-only look at the strings in the installed Desktop app. "Confirmed" means documented, or a tool description seen in the app. "Inferred" means not run. Part 0 (section 15) tries every inferred point before anything else is built.

| Point | Status |
|---|---|
| A Desktop Code session has a `start_session` tool. It takes title, prompt, fresh or forked context, worktree on/off, and a permission mode no higher than its own. | Confirmed (app strings) |
| `start_session` starts at once only when the director asked in words (`user_asked`). Otherwise it shows a card with **Start** (`offer`), or a proposal. Desktop's docs show **Start all** for several suggested tasks. | Confirmed |
| `cwd` (folder) on `start_session` is described as for `user_asked` only. | Confirmed (app strings), behaviour inferred |
| With the worktree on, Desktop makes its own worktree under `<root>/.claude/worktrees/` on a new branch. | Confirmed (docs) |
| `send_message` sends a message to another of the director's sessions. `stop_session` and `archive_session` exist. `wake_when_done` tells the starting session when a started one finishes. | Confirmed (app strings) |
| Desktop sessions use Desktop's own sign-in, not the CLI's. | Confirmed (docs); a token held only by the CLI is inferred not to be used |
| The `env` in `~/.claude/settings.json`, user plugins and skills load in Desktop sessions. Project hooks load in worktree sessions. | Mostly confirmed; project hooks partly (truncated doc) |
| Desktop's own cross-session view sees only sessions the app runs, not terminal ones. A sidebar row for a CLI session: none found. | Confirmed for the view; sidebar likely |
| Deep links `claude://code/new?folder=…` exist. A link fills the prompt box but never sends it, and always needs a click. | Confirmed |
| `claude --desktop` opens a session in Desktop. | Exists in `--help`; what it does is untested |
| Desktop sessions report `CLAUDE_CODE_ENTRYPOINT` as `claude-desktop`. | Inferred from the app's value list |
| Local Desktop sessions stop when the app quits. | Inferred (only cloud and SSH are documented) |
| Cross-session messages arrive only between sessions of the same mode class. Otherwise they are held, and Desktop can't show the dialog for them, so they are dropped after 5 minutes. | Confirmed (docs) |
| A session started by another shows in the sidebar nested under the one that started it. Which `start_session` option or parent field does this, if any, is not known. | Unknown; part 0 finds out |
| Cowork's Dispatch can start Code sessions, but not on Team or Enterprise plans. | Confirmed (docs); not used, since the work laptop's plan is unknown |

What follows from this:

- Only a session inside Desktop can start a Desktop session without the director typing. So the foreman must be a Desktop session.
- A start the director didn't ask for in words shows a **Start** card. Wheelhouse doesn't claim `user_asked` for a start the director didn't type. Section 7.3 keeps this to one click per batch.
- Nothing outside Desktop can wake a Desktop session reliably. The foreman waits for its own work (section 7.2).

## 5. Approaches considered

**A. A foreman in Desktop starts builder sessions in Desktop (chosen for Desktop).**
The foreman is a Desktop session the director starts with one click. It waits for wakes from the watcher, and starts one titled Desktop session per piece with `start_session`. It wakes them with `send_message`. Builders show in the sidebar and use Desktop's sign-in.
Trade-offs: a **Start** click per batch of new pieces, and nothing runs while Desktop is closed.

**B. The background route with a launch command (kept, for terminals).**
Today's detached starts, with the launch command in place of `claude`. Nothing to click and it runs with Desktop closed, but builders stay out of sight. On the work laptop it works only if the wrapper's sign-in works for background runs.

**C. Builders as subagents inside the First Mate.** Ruled out by the director (decision 1).

**D. Deep links or `claude --desktop` from the watcher.** A link always needs a click and never sends the prompt. `--desktop` is untested. If part 0 shows that `--desktop` starts and sends a prompt in Desktop with no click, it becomes a later choice for the waker, not a rewrite. Not relied on now.

**E. Cowork's Dispatch.** Not open to Team or Enterprise plans, and it skips project hooks in some cases. Ruled out.

**Choice:** A and B, as two **routes** behind the agent seam, chosen per computer (section 6). A is the recommended route wherever the director works in Desktop. B is for terminals, with or without a launch command.

## 6. Routes and the route record

A **route** is how this computer starts builder sessions. There are three:

| Route | Who starts builders | Sign-in | When |
|---|---|---|---|
| `desktop` | the foreman's Desktop session, through `start_session` | Desktop's | the director works in Desktop |
| `background` | the watcher, detached, as `claude` | the CLI's | plain `claude -p` signs in |
| `background` with a launch command | the watcher, detached, as the launch command | the wrapper's | a gateway wrapper is needed |

The route is a per-computer, per-agent setting in the profile: `builders:<computerId>`, with the value `desktop` or `background`. The launch command is a separate key (section 8). It is in the catalogue's **advanced** group, `home: 'profile'`, like `windowsBuildCommands:<computerId>`. The setting is per computer because the work laptop and the Mac differ, and per agent because Copilot's crew has its own route (section 9.6).

- **Default.** None. Setup sets it from the sign-in check (section 10.1): `desktop` when setup runs in a Desktop session, otherwise `background`. A route is never guessed outside setup.
  - **Ruling, 24 November 2026.** The director ruled that with no route saved, builders start in the background, as they always have. The Builders line says so: "Builders: not chosen · starting in the background". A saved value or settings file that can't be read still starts nothing and is named.
- **One reader.** A new module, `scripts/lib/route.js`, has `builderRoute({ agent, computer })`. It returns `{ route, launch?, from }` and is the only place that reads the setting. The waker, the helper's `/foreman/run`, health and the First Mate's facts all use it.
- **Changing it** is a setting change, like any other: a card, a signed decision, a profile event. Section 11 says what happens to running sessions.

## 7. The Desktop route

### 7.1 Who starts the foreman

- **Setup's last card** on the Desktop route is "Start the foreman". It finishes setup only once the foreman has checked in (section 10.1). The First Mate calls `start_session` with `initiation: user_asked`, because the director clicked a card that says, in words, "Start the foreman session". Fresh context, worktree **off** (it works in the project's main checkout, as today's foreman does), and the title "Wheelhouse · Foreman · <project>". The prompt is the foreman's brief from `scripts/foreman/start.js`, with the route marked `desktop`.
- **Later**, the First Mate's session-start facts show "Foreman: not running" when work is waiting and no check-in is fresh (section 7.5). The First Mate offers the same card. Nothing starts the foreman without that click.
- **Builders are the foreman's children.** The director asked (24 November 2026) that builders show in Desktop's sidebar as the foreman's child sessions, nested under its row. The foreman starts every builder itself, so that it is their parent. Part 0 finds which `start_session` option or parent field gives the nesting, and the foreman sets it on every start. If part 0 shows Desktop can't nest them, section 7.4 says what the director sees instead; nothing promises nesting that part 0 hasn't seen.
- **One foreman per project.** It writes a check-in file with its session id and a heartbeat (section 7.2). A second "Start the foreman" for a project with a fresh check-in is refused, and the card says the foreman is already running.

### 7.2 How the watcher hands it work

The watcher still decides **what** needs a session: the same wake rules, holds (`helmHeld`, `controlHeld`), STOP and record reads as now. On the Desktop route it doesn't start a process. It writes a **wake file**:

- Where: `<stateDir>/wakes/`, one file per wake, named by time and id, written atomically.
- What: one JSON object, `{ kind: 'foreman' | 'feature-start' | 'feature-wake', work?, file, at }`. These are the same three kinds as the parked Shape 2's `WAKE`/`START` lines (section 13). There is no free text. A builder's prompt is built by the foreman's own script from the record, never from the wake file.
- Coalescing: the same as today. A wake for a piece that already has one waiting replaces it.

The foreman session keeps one background command running: `node scripts/foreman/wait-wake.js --project <p>`, started with Bash's `run_in_background`. It:

- updates the check-in heartbeat every 60 seconds;
- exits as soon as a wake file exists, or after 50 minutes with no wake, printing what it found.

Claude Code wakes the session when a background command ends. The foreman runs `act` through the helper as today, deletes the wake files it took, and starts `wait-wake.js` again. This uses only Claude Code's own tools. Cross-session messages are not used for wakes: the watcher is not a session, and a message between different mode classes is dropped in Desktop.

### 7.3 How the foreman starts and wakes builders

- **Start.** For each `feature-start` wake, the foreman's `act start` prepares the record and gives back the builder's title ("Wheelhouse · <piece title>", under 60 characters) and prompt. The prompt is the feature brief as today, plus one marker line naming the project and work id. The foreman then calls `start_session` with:
  - `initiation: offer`;
  - fresh context, worktree **on**;
  - its own permission mode, or lower (the foreman runs in Auto, decision 16.4);
  - `wake_when_done: true`;
  - the option or parent field that nests the builder under the foreman, if part 0 found one (section 7.4).

  Several wakes in one turn give several offers, so the director sees one **Start all**. That is one click per batch of new pieces, and none for wakes of pieces already running (decision 16.1).
- **The worktree.** Desktop makes the builder's worktree and branch. The builder's `SessionStart` hook sees the marker line and its own role. It records `{ sessionId, worktree, branch }` on the piece through the helper, as a `builder-started` event. Wheelhouse adopts that worktree and branch, and does not make its own.

  If part 0 shows that `cwd` is accepted on an `offer` start, the foreman passes Wheelhouse's own worktree instead, and the adoption step is dropped. That is the builder's call, after the probe.
- **Wake.** For a `feature-wake` of a piece with a recorded session id, the foreman uses `send_message` to that session, with the wake's prompt from the record. Builders started by the foreman run in its mode class, so the message arrives.
- **Finished.** `wake_when_done` brings the foreman back when a builder ends its turn. It reads the record as today. The watcher's own record watch still raises the same wakes, so a missed notice costs one wait, not the piece.
- **Stopped.** STOP or a pause: the foreman calls `stop_session` for the piece's session. A piece removed or merged: `archive_session`, so the sidebar keeps only live work.

### 7.4 Seeing builders, and the helm

Each builder is a sidebar row with the piece's name.

- **Nested, where Desktop allows it.** Builders show as the foreman's child sessions, under the row "Wheelhouse · Foreman · <project>". This is a requirement (decision 16.1), but it rests on part 0: the design doesn't promise it until part 0 has seen Desktop nest a session the foreman started.
- **If Desktop can't nest them,** each builder is a top-level row. Its title then carries the project, "Wheelhouse · <project> · <piece title>" (under 60 characters, the piece's title shortened first), so the rows read as one group beside the foreman's. The First Mate's Builders line (section 10.5) lists the running builders by title, so the director can find each one. Part 0 records which of the two it saw, and part 6 builds that one.

Opening a row is the native way to watch or take the helm. Crew visibility's levels still choose what goes to the Logbook.

Taking the helm on this route: when the director types in a builder's row, the builder's `UserPromptSubmit` hook sees a prompt that didn't come through the foreman. The foreman's messages carry a marker line the hook checks. The hook writes the helm hold file `helm/<work>.json`, as the front desk's "take the helm" does. `helmHeld` then gates every wake for that piece. "Hand back" at the front desk ends the hold as now. On this route the session stays open and is never ended by `SessionEnd`.

Crew visibility section 9.3 says a crew session never shows in the sidebar. That stays true for the background route and is no longer true for the Desktop route. Part 8 updates that line.

### 7.5 When Desktop is closed

Local Desktop sessions are inferred to stop when the app quits (part 0 checks this). So:

- The watcher keeps writing wake files. Nothing is lost; wakes coalesce.
- When the foreman's heartbeat is more than 3 minutes old and a wake is waiting, the watcher records the fact `foreman-away` once. If phone notifications are on, it sends one notice: "Wheelhouse has work waiting. Open Claude to carry on." The notice is sent again at most once a day.
- It **never** falls back to the background route. On the work laptop that route is the one that fails. A route changes only by the director's setting.
- When Desktop opens and the director opens the First Mate, its session-start facts show "Foreman: not running · 3 wakes waiting". It offers the one-click "Start the foreman" card. The new foreman reads the waiting wakes.

  Builders whose sessions stopped are woken with `send_message` if Desktop brings their rows back. If the message fails, the foreman offers a fresh start for that piece, which counts as a resume: the same worktree and the record's resume brief. Part 0 checks which of the two happens.

## 8. The launch command

### 8.1 Where it lives

- Profile key `builderLaunch:<computerId>`, advanced group, `home: 'profile'`. It is per computer, because a wrapper on the work laptop means nothing on the Mac.
- Value: an **array of words**, such as `["wrap", "claude"]`. It is never one string, because a string invites shell parsing.
- It is used only on the `background` route. It is set by setup's advanced question (section 12.3) or the settings card.

### 8.2 How it is set safely

- **Only the director sets it.** It is a typed answer on a card, through the helper's settings route, with a fresh click, like every profile setting. No session, foreman or hook can write it. The helper refuses a write without a fresh signed click, because this setting decides what program runs on every start.
- **Splitting.** The director types the command as they would in a terminal. The helper splits it into words with a small rule of its own: spaces separate words, and double quotes group a word. It refuses anything else: `'`, `` ` ``, `$`, `;`, `|`, `&`, `<`, `>`, `(`, `)`, `%`, `!`, `^`, a line break or NUL.

  The card shows the words back, one per line ("Wheelhouse will run: `wrap` then `claude`"). The director confirms before it is saved. So a wrapper is passed as data, and no shell ever reads it.
- **Checks** before saving, and again on every read by `builderRoute`:
  - the first word passes `resolveCommand`'s name rule (`/^[A-Za-z0-9][A-Za-z0-9._-]*$/`) and resolves on `PATH`, or it is an absolute path to an existing executable file;
  - at most 8 words, each under 200 characters;
  - none of the later words starts with `-p`, `--print`, `--resume`, `--session-id`, `--settings` or `--permission-mode`. Wheelhouse sets those itself.

  A stored value that fails a check is named (section 12.5) and is not used. The route then counts as having no working sign-in until the director mends it.

### 8.3 How it is run

- `resolveClaude` gains a `launch` input. With a launch command, the program is its first word, resolved as now (`.exe`, then `.cmd`, on Windows). The arguments are its other words, then Wheelhouse's own arguments as today. `spawn` runs with `shell: false`. The prompt goes on stdin, as now.
- **Windows.** A `.cmd` or `.bat` first word runs through `cmd.exe /d /s /c "<line>"`, quoting every word with `quoteForCmd`. That function already refuses `"`, `%`, `!`, line breaks and a trailing backslash. The splitting rule above already refuses these, so a stored value can't reach a refusal at start time. A refusal there is still caught and named, never swallowed. A `.ps1` first word is refused: its quoting is different, and it needs PowerShell's execution policy. The card says to use the wrapper's `.cmd` or `.exe`.
- **Environment.** `sessionEnv` is unchanged. Host variables are still dropped, so the project's own `ANTHROPIC_BASE_URL` can't steer a builder. A wrapper sets its own gateway variables inside its own process. That is why a wrapper works where a bare variable would be dropped.
- `recordClaudePath` records the resolved launch with the path, so the helper and watcher, which have no login shell, find the same program the director's terminal does.

## 9. Who starts builders, route by route

### 9.1 Desktop

Section 7. The watcher writes wakes, and the foreman session starts and wakes builders. The helper still holds the keys and the merge gate. The foreman's `act` commands still go through `/foreman/run`.

### 9.2 Background

As today, with three changes:

- the launch command is used if one is set (section 8);
- every start goes through the sign-in gate (section 10.2);
- the start's output is kept briefly to read the sign-in failure (section 10.3).

### 9.3 The route seam

The agent seam's `sessions` part gains `routes`: the list of routes the agent supports. Claude Code supports `['desktop', 'background']`. The waker asks `builderRoute`, then either calls the adapter's start functions (`background`) or writes a wake file (`desktop`). Core scripts never name an agent.

### 9.4 The terminal path

Where plain `claude -p` signs in (the Mac, today), the route is `background`, with no launch command, and nothing changes but the gate and the check. A director who works in the terminal keeps today's Wheelhouse.

### 9.5 Mixed use

A director may use Desktop on one computer and the terminal on another. The route is per computer, so each computer starts builders its own way. Two computers never share one project's sessions, because the watcher's lock is per computer, as today.

### 9.6 Copilot

Copilot's crew is unaffected. Its adapter starts the Copilot CLI with Copilot's own sign-in, not Claude's. It supports only `['background']`, and its route key is its own (`builders:<computerId>` is per agent). The sign-in gate and the sign-in check (section 10) apply to it through the same seam: its adapter supplies its own failure patterns and its own check call, inside `adapters/copilot/`. Nothing in this design names it in core scripts.

## 10. Sign-in: proved before done, and stopped at once when it fails

### 10.1 Setup's builder sign-in check

Step 10's health check gains check **"Builders can sign in"**. It runs the way builders will start on this computer, and setup isn't done until it passes.

- **Background route.** The helper starts one session the same way the waker does: the same `resolveClaude` with the launch command, `sessionEnv`, cwd in a scratch folder (not a repository), `-p`, no tools (`--allowedTools ""`), `--max-turns 1`, and the prompt "Reply with the word ready." It waits up to 90 seconds.
  - Pass: an exit code of 0 and "ready" in the answer.
  - Fail: everything else. The check's line quotes the classified kind (section 10.3), never raw output.
- **Desktop route.** A Desktop session is signed in by being alive, so the check is the foreman's check-in. The "Start the foreman" card is setup's last card on this route. The check passes when a check-in less than 2 minutes old is there.

  No probe builder is started: it would cost the director a **Start** click to prove what the First Mate's own session already proves (the same app, the same sign-in).
- **Which route to try.** Setup asks one question, in the advanced group of step 3 (section 12.3): "How should builders start on this computer?"
  - In a Desktop session, the options are "In Claude Desktop (you'll see each one)" (recommended), "In the background" and "In the background with a launch command".
  - In a terminal, only the background options are offered, with no launch command as the recommendation.
  - Setup reads `CLAUDE_CODE_ENTRYPOINT` to tell Desktop from a terminal. If the value is unknown, it says so and offers all three.
- **When the background check fails** during setup, the card says what happened: "A builder started as `claude` couldn't sign in: it said it isn't logged in." It offers the way out:
  - "Use Claude Desktop for builders", when setup runs in Desktop;
  - "Set a launch command";
  - "Sign in to Claude in a terminal (`claude /login`), then check again".

### 10.2 The sign-in gate

A computer-level fact file, `~/.wheelhouse/sign-in.json`, maps `<agent>:<route>` to `{ kind, since, command, excerpt, starts }`:

- `kind` is from section 10.3;
- `command` is the program's name only;
- `excerpt` is up to 200 characters of output, cleaned by the same cleaner as setup's journal lines;
- `starts` is how many starts failed.

It is per computer, not per project, because one sign-in serves every project on the computer.

- **The waker asks the gate before every start and resume**, beside `helmHeld` and `controlHeld`. While `<agent>:<route>` has a fact, nothing starts on that route, for any project, and wakes stay queued.
- **One failure is enough.** The first start classified as a sign-in failure writes the fact. No retry: a sign-in failure doesn't go away by trying again.
- **Other failures** (a crash, a timeout, an unknown exit) keep today's handling, with a limit. A third failure in a row of the same kind for the same piece holds that piece, writes `start-failing` on it, and tells the First Mate. The 30 sessions of the rehearsal can't happen on any route.
- **Clearing.** The fact is cleared only by a passing check, the same as section 10.1, run by:
  - the director's "Check again" card;
  - a route or launch-command change;
  - the helper once an hour while the fact stands, because a director may sign in without telling Wheelhouse. This costs one tiny session an hour, only while builders can't start.

  When the check passes, the queued wakes go out.

### 10.3 Reading a sign-in failure

The waker already accepts an `output` file for detached starts. On the background route it gives each start a short-lived output file under `<stateDir>/starts/`. When the process ends, it classifies:

- `not-signed-in`: "Not logged in", "Please run /login", "Invalid API key", "OAuth token has expired", or an exit with an authentication error.
- `blocked`: an authentication error naming a forbidden organisation or a policy (403).
- `no-program`: the program wasn't found or couldn't run (ENOENT, EACCES, a `cmd.exe` refusal).
- `other`: anything else.

The patterns live in the agent's adapter (Claude Code's in `adapters/claude-code/`), because each agent words them differently. The output file is deleted after classifying, or after 24 hours.

### 10.4 What the director sees

One card, through the First Mate, the first time the fact is written, and never again while it stands:

> **Builders can't sign in on this computer**
> What happened: 1 builder start failed at 14:02. `claude` said it isn't logged in. Work is waiting; nothing is retrying.
> Why it comes to you: only you can sign in, or choose how builders start.
> Options: **Use Claude Desktop for builders** (recommended here) · **Set a launch command** · **I've signed in; check again**
> Meanwhile: approved work waits. Nothing is lost.

- The recommended option is Desktop when the First Mate runs in Desktop. Otherwise it is "I've signed in; check again".
- The "Set a launch command" option opens the typed card from section 8.2.
- The phone gets the same title once, if notifications are on.

### 10.5 The First Mate states facts

- The First Mate's session-start facts and `/status` gain a **Builders** line, read from `builderRoute`, the gate and the foreman's check-in. For example: "Builders: Claude Desktop · foreman running" or "Builders: background as `wrap claude` · can't sign in since 14:02 (not signed in)".
- The playbook rule: when the director asks why work isn't moving, the First Mate reads the Builders line and the board, and says only what they say. When they don't explain it, it says "I don't know yet" and offers the check-again card. It never suggests restarting a session as a fix unless a recorded fact names that as the way out.

## 11. Lifetime: moving between routes without killing anything

The helper and watchers are meant to outlive sessions: they hold keys, guard merges, and watch the record. So they are not stopped. They change behaviour when the route record changes.

- **The watcher reads `builderRoute` on every tick**, before any start, so a change takes effect within one tick.
- **Background to Desktop:**
  - The watcher starts no new detached session. Each detached session it started (it keeps their pids and session ids, as now) ends its current turn and is not resumed. Its piece's next wake goes to the wake folder, with its session id.
  - Background sessions have no Desktop row, so the foreman starts a Desktop session for such a piece as a resume (the same worktree, the resume brief).
  - A detached session still running 30 minutes after the change is ended by the watcher, which started it, with the same stop as STOP uses. That is not by hand.
  - The foreman's own detached session, if one is running, finishes its wake and isn't started again.
- **Desktop to background:**
  - The foreman's `wait-wake.js` sees the route on each heartbeat and exits with "route changed". The foreman's brief tells it to say one line ("Builders now start in the background; this session can be closed") and stop.
  - The watcher starts the queued wakes as detached sessions.
  - Builder sessions in Desktop finish their turn. Their pieces resume in the background from the record, as a crash resume does today.
- **The sign-in start** (LaunchAgent, start-up entry) stays as it is. It restarts the helper and watchers, which is harmless now that they follow the route.
- **What the director does:** clicks the route option on a card. Nothing else.

## 12. User settings

### 12.1 Scope

Three scopes were considered:

- **Per user on this computer (chosen).** The profile (`~/.wheelhouse/settings`, design section 24.2) already is this. It is a private git record that is never pushed, and `effectiveSettings` already reads it below the project. The answers the director named differ by computer: the work laptop has the company GitLab and a wrapper; the Mac has GitHub and plain `claude`.
- **Global across computers.** There is no sync today. A synced file would carry per-computer values (launch command, host) to the wrong computer and need a store outside both. The director ruled it out for now (decision 16.2).
- **Per project.** This is the project config. It already exists and is not what was asked.

### 12.2 Where it lives and how it wins

- No new file. Usual answers are profile settings, written as profile events and read through the profile views, like `notifications` and `hours`.
- Precedence is unchanged: **project, then profile, then default**, with `from` recorded. A project answer always wins inside that project.
- A per-computer key (suffix `:<computerId>`) is used for values that only make sense on one computer: `builders`, `builderLaunch`, the GitLab address, and the git route.

### 12.3 What it holds, and what setup offers

| Setup question | Usual setting (profile) | Per computer |
|---|---|---|
| Step 3: host kind (local, GitHub, GitLab) | `usual.host` | yes |
| Step 3: GitLab address | `usual.gitlabBase` | yes |
| Step 3: git route ("Use my git as it is" or Wheelhouse's own) | `usual.gitRoute` | yes |
| Step 3: connection (own app or the director's sign-in, where asked) | `usual.connection` | yes |
| Notifications (channels, quiet hours) | existing `notifications` | no (already profile) |
| Builders start (route) | `builders` | yes |
| Launch command | `builderLaunch` | yes |

Never usual: the product, live data, real users, signs apps (step 4), protection, Locked, or anything that names a repository. Those are the project's.

**Offering them.** When at least one usual answer exists, setup's first question card for step 3 becomes:

> **Use your usual setup?**
> Your usual on this computer: GitLab at the address you used before · your own git · phone notices · builders in Claude Desktop.
> Options: **Use my usual** (recommended) · **Choose each**

- "Use my usual" records each answer in the project's setup answers as if chosen, marked `from: 'usual'`, and skips those questions. The checks still run: the host is still reached, and the builder sign-in is still proved.
- "Choose each" asks as today, with the usual answer as the recommended option.

**Saving them.** At the end of setup, answers that differ from the usual (or the first time, when none exist) are offered once:

> **Keep these as your usual on this computer?**
> Options: **Keep them** (recommended) · **Not now**

Saving is a profile settings change and is signed as any other. No new click is added to setups that match the usual.

### 12.4 Changing them later

The settings card's advanced group lists the usual answers and the two builder settings. Changing one changes the profile, not any project. A project that took the usual keeps its own recorded answer.

### 12.5 Malformed files are named, never skipped

- **Wheelhouse's own files.** One reader, `readJsonNamed(file)` in `scripts/lib/`, gives `{ ok, value }` or `{ ok: false, file, line, column, hint }`. Every reader of a computer-level or settings file uses it: `computer.json`, `claude-path.json`, `sign-in.json`, profile views, the route and launch values, setup answers.

  A file that can't be read is never treated as empty. The setting counts as unknown, and a health line names the file, the line and column, and the hint. The First Mate's facts show it. The thing that needs it (a start, a setup step) waits and says why.
- **Claude Code's settings files**, which Wheelhouse doesn't own (the project's `.claude/settings.json`, `.claude/settings.local.json`, the director's `~/.claude/settings.json`), are read by `settings-check.js`:
  - now at every First Mate session start, as well as in setup. That is a read only, cached by file time;
  - and by the watcher before each start, since a skipped settings file changes what a builder may do.

  A file that is there but isn't a JSON object gives a card naming it and the position, with a **hint**. For the Windows case the hint is: "a single `\` inside a path must be written `\\`, or use `/`". The existing **Mend it** option keeps a copy beside the file. For a lone-backslash fault, it now doubles each backslash that isn't already a valid escape, instead of dropping the value.
- Wheelhouse never writes `~/.claude/settings.json` without the director's click, as today.

## 12A. The other rehearsal faults this design covers

The rehearsal's write-up (24 November 2026) numbers its faults. Fault 8 is sections 6 to 10. Faults 9, 10 and 11 are mostly covered above, and the rest are below. The setup wording faults belong to other builders.

### 12A.1 Faults 11 and 23: background processes belong to one home, with a clean environment

- **A clean environment.** Whoever starts the helper or a watcher (the session-start keep-alive, the helper's tick, the sign-in start) gives it the same standard environment, built from scratch:
  - `HOME` (on Windows, `USERPROFILE`, `APPDATA`, `LOCALAPPDATA`, `SystemRoot`, `TEMP`);
  - `PATH` from `pathWithNode` and `claude-path.json`;
  - locale variables;
  - `WHEELHOUSE_HOME` set explicitly.

  Nothing of the starting session's environment comes with it. So which session started the processes no longer matters, and moving from the terminal to Desktop leaves nothing stale behind (fault 11). The sign-in variables a background builder needs are not inherited either: on the background route the launch command or the CLI's own stored sign-in provides them.
- **One home per process.** The helper's `helper.json` and each watcher's lock file record the home they serve. On every tick, a watcher checks that its project is registered in that home and that the home still exists. If not, it exits. It never writes outside its home. A held trial's watcher can't rewrite the real home's journal or own-files list (fault 23), because it serves only the trial's home.
- **Held projects stop.** A project the director has set aside (All stop on, or `held: true` in its registration, which the trial hold sets) has no watcher: it exits on its next tick, and the keep-alive and the sign-in start skip it. The helper serves only reads for it. Lifting the hold starts the watcher again on the next tick.
- **A guard for own-files.** A write that would shrink `own-files.json` by more than half is refused and named on the board. That list only grows during use, except on uninstall.

### 12A.2 Fault 4: a throwaway home, documented

- The README gains a short section, "Trying Wheelhouse without touching your usual setup". Put `"env": { "WHEELHOUSE_HOME": "<a new folder>" }` in the trial project's `.claude/settings.json`. That reaches Desktop and terminal sessions alike. Section 12.5 now names that file when it can't be read.
- The sign-in start serves only the default home. A throwaway home's helper and watchers are started by its own sessions' keep-alive, with that home in their standard environment. They stop an hour after the last session of that home ends. Ending a trial is All stop, then deleting the folder.
- The route, the launch command and the sign-in fact live in the home. So a throwaway home has its own, and a failing trial can't hold the real home's builders.

### 12A.3 Fault 7: guards and other sessions in the folder

Wheelhouse's guards keep applying to every Claude session in a Wheelhouse folder. A guard that a session could skip by not claiming a role guards nothing (`scripts/lib/role.js`: a role decides what a session is shown, never what it may do). But it now **says so clearly**:

- A refusal in a session with no Wheelhouse role begins: "This folder is run by Wheelhouse; its guards apply to every Claude session here." It then says what was refused and why, and the way out: work in a separate copy of the project, or use `/wheelhouse:aside` for an ordinary session under the same guards.
- Setup's last card says it once: "Any Claude session in this folder now works under Wheelhouse's guards."

### 12A.4 Faults 9 and 10: health shows every failure, and the First Mate sees builder failures

- **Fault 9.** Section 10.1 adds the builder check. Also, every helper call that times out during setup or health becomes a failed check line: "The helper didn't answer within 15 seconds (step 3)". It is never dropped. "All checks passed" counts only checks that ran, and names any that didn't.
- **Fault 10.** Section 10.5's Builders line covers the route. Per piece, the board and the First Mate's facts show `start-failing` and its classified kind (section 10.2). When the director asks, the First Mate reads both. "Queued, I can't see a build" is replaced by the fact itself, for example "Not started: builders can't sign in since 14:02".

### 12A.5 Fault 20: every session starts knowing what it is, and approvals are never asked twice

- **Sessions Wheelhouse starts** (the foreman, builders, on either route) begin their first prompt with their role's lead line, as the foreman's does today (`FOREMAN_PROMPT_LEAD`). Builders get a matching lead. So the hooks know the role from the first tool call. A session never has to look for its command, and the guard never blocks it doing so.
- **The First Mate in a new Desktop chat.** The session-start hook of a set-up project gives the exact command lines the First Mate uses for cards in its context. The guard's refusal of a command lookup prints those lines. The First Mate never asks the director for a command name. Its playbook says so.
- **Never re-ask an approval.** Before any approval card, the First Mate checks the record for a signed decision on the same work and question. If one exists, it says "Already approved on <date>" and goes on. The foreman's start reads the signed decision too, never a fresh ask. A test covers a Desktop chat started fresh on approved work.

### 12A.6 Fault 24: All stop stops everything, and says what's left

All stop (`/wheelhouse:all-stop`, the STOP file) now reaches every moving part:

- **The watcher goes idle.** No starts, no wake files and no record writes. It keeps only its lock and a heartbeat, so lifting All stop takes effect in one tick, with nothing to restart. Idle, not exited, is the designer's call: an exited watcher is restarted by the sign-in start, and a restart is what the director had to fight. Held projects (section 12A.1) exit instead.
- **The gates.** The sign-in gate, the three-in-a-row hold and every retry are frozen. Nothing counts, re-checks or retries, and the hourly sign-in check (section 10.2) doesn't run.
- **Background route.** The watcher stops every detached session it started, with the existing stop, and records which ones.
- **Desktop route.** The foreman's `wait-wake.js` sees STOP on its heartbeat and exits with "all stop". The foreman's brief then calls `stop_session` for every builder it started, and ends itself with one line. If the foreman isn't running, the First Mate, in Desktop, does the same from the record's session ids when All stop comes on.
- **The helper** keeps running, because it holds the keys and refuses merges while STOP is on. It serves reads only.
- **The card.** After All stop, the First Mate shows one card:

  > **All stopped**
  > Stopped: 3 builders, the foreman.
  > Still running: the helper (holds your keys and refuses every change) and the watcher (idle, making no changes).
  > To carry on: **Lift All stop**. Work picks up where it stopped.

  The "still running" list comes from the processes' own heartbeats, not from a guess.
- **Health proves it.** Step 10's STOP trial gains a second half. Under the scratch home with STOP on, it runs the waker's start decision for a waiting piece, and expects "not started: All stop", as well as the agent's refused write.

## 13. Parked pieces and other designs touched

- **Watcher Shape 2 (parked with the mod).** The wake file reuses Shape 2's three kinds of wake, but as files read by a script the foreman runs, not lines fed to a mod or pane. Nothing of the mod, pane or courier comes back. `docs/parked.md`'s Shape 2 line gains a note that its wake kinds live on in the Desktop route.
- **The VS Code add-on (parked again, 23 November 2026).** Not touched. Builders in Desktop rows don't appear in VS Code. The route seam leaves room for a later `vscode` route, which isn't designed here.
- **Crew visibility (live).** Section 7.4 changes how the helm works on the Desktop route, and the line in its section 9.3.
- **One First Mate (live).** The First Mate stays the only session that talks to the director. The foreman and builders in Desktop must not ask the director questions. Their briefs keep the existing rule: questions go to the record, and the First Mate turns them into cards. The director may still read their rows.
- **Delegation and unattended goals (parked).** Not touched.

## 14. What the director sees and clicks

| Moment | What they see | Clicks |
|---|---|---|
| Setup, step 3 | "Use your usual setup?" (only once usual answers exist) | 1 |
| Setup, step 3 advanced | "How should builders start on this computer?" | 1 (or none with the usual) |
| Setup, end (Desktop) | "Start the foreman" | 1 |
| Setup, end | "Keep these as your usual?" (only when they changed) | 1 |
| New pieces start (Desktop) | Desktop's own **Start all** card for the batch | 1 per batch |
| Desktop reopened with work waiting | "Start the foreman" | 1 |
| Builders can't sign in | One card (section 10.4) | 1 |
| Changing route | A settings card | 1 |

Builders appear as sidebar rows named after the piece, so the director can open any of them. Everything else stays where it is: the board, the Logbook, the digest.

## 15. Build order

Each part fits one fresh session and ends with the touched test files passing (`node --test <files>`).

0. **Desktop probe.** A script and a short sitting on this Mac, driven from a Desktop session, with one **Start** click by the director (decision 16.3). It confirms the inferred points in section 4:
   - `cwd` on an `offer` start;
   - Desktop's worktree path and branch;
   - project hooks running in a started session;
   - the `CLAUDE_CODE_ENTRYPOINT` value;
   - plugin load;
   - `send_message` delivery between the foreman and a builder;
   - `wake_when_done`;
   - what a quit does to sessions, and what reopening does;
   - what `claude --desktop` does;
   - **nesting** (decision 16.1): whether a session the foreman starts shows nested under the foreman in the sidebar. It tries each `start_session` option or parent field that could do this, records which one does, and records what the sidebar shows (nested under the foreman, or a top-level row), with a screenshot description in words. If none nests, it says so plainly.

   It writes the findings to `docs/specs/notes/`, and parts 6 and 7 follow them.
1. **Malformed files named.** `readJsonNamed`; `settings-check.js` at the First Mate's session start and the watcher's start; the backslash hint and mend. It is independent and fixes the earlier fault.
2. **The sign-in gate.** The output file per start, classification patterns in the Claude Code adapter, `sign-in.json`, the gate in the waker, the three-in-a-row hold, the card, the Builders line and the per-piece `start-failing` fact (fault 10). It fixes the rehearsal's endless retries on today's route.
2a. **Homes and processes** (faults 4, 11, 23). The standard environment for the helper and watchers, one home per process, held projects stopping, the own-files shrink guard, and the README's throwaway home.
2b. **All stop reaches everything** (fault 24). The idle watcher, frozen gates, stopping background sessions, the card from heartbeats, and the health trial's second half. The Desktop half joins part 6.
2c. **Sessions know what they are** (faults 7, 20). Builder lead lines, the First Mate's command lines in its start context, the plain refusal for sessions with no role, never re-asking an approval.
3. **The launch command.** The setting and catalogue entry, the splitting and checks, `resolveClaude`'s `launch`, Windows `.cmd` handling, the typed card. Tests include the refused characters and a fake wrapper on both platforms' code paths.
4. **The builder sign-in check.** The health check for the background route, the hourly re-check while the gate stands, "Check again", and helper timeouts as failed check lines (fault 9).
5. **Routes.** `scripts/lib/route.js`, the `builders:<computer>` setting, the seam's `routes`, wake files in the waker, the background-to-Desktop and Desktop-to-background moves (section 11), the setup question.
6. **The Desktop foreman.** `wait-wake.js`, the check-in, the foreman's Desktop brief, `start_session` offers with titles, worktree adoption (or `cwd`, from part 0), `send_message` wakes, stop and archive, the Desktop-route health check, the "Start the foreman" card.
7. **Desktop closed.** `foreman-away`, the phone notice, the session-start fact and card, resuming stopped builders (from part 0's findings), the helm hold on the Desktop route.
8. **Usual answers.** The `usual.*` settings, "Use your usual" and "Keep these as your usual", the settings card's advanced group; the README, the playbook and the crew visibility and parked notes.
9. **Trial on the work laptop.** Setup on a throwaway project with Desktop builders, then with the wrapper, recorded as a sitting. The director's only steps are clicks.

Parts 1 to 4, with 2a to 2c, help the work laptop at once, even before Desktop builders exist. With the wrapper on the background route, they may be enough to build there.

## 16. Decided

The director answered the four cards on 24 November 2026.

### 16.1 One Start click per batch of new pieces (decided 24 November 2026)

**Accepted.** In Desktop, the foreman asks Desktop to offer each new piece, and the director presses **Start all** once per batch, "when sessions are ready to start". Wakes of pieces already running need no click.

The director also said the builders should be nested sessions under the foreman. That is now a requirement (sections 7.1 and 7.4): builders show in Desktop's sidebar as the foreman's child sessions. Part 0 finds which start option or parent field gives the nesting and records what the sidebar shows. If Desktop can't nest them, part 0 reports it, and the director sees top-level rows grouped by title instead (section 7.4).

### 16.2 Usual answers (decided 24 November 2026)

**This computer only.** Usual answers are kept per computer, in the existing profile. No export, import or sync is built. Part 8 builds them.

### 16.3 The probe's Start click (decided 24 November 2026)

**Yes, when the probe is ready.** Part 0's sitting has the director press **Start** once on the Mac; the First Mate sends the card when the probe is ready.

### 16.4 The foreman's permission mode (decided 24 November 2026)

**Auto.** The foreman runs in Auto, and builders start in Auto. Wheelhouse's hooks and settings keep guarding what builders do, as they do now.

### 16.5 The v0.3.0 tag (decided 24 November 2026)

**Tag after the director's own Claude Code run works end to end.** Until then, the README's install line installs from `main`, and the tag line waits beside it in a comment, ready to restore when the tag is cut.

## 17. Calls the designer made

- Two routes behind the seam, chosen per computer and per agent, never guessed outside setup, and no automatic fallback.
- The foreman as a Desktop session started by one card click; the watcher hands it work through wake files and a background wait command, not cross-session messages.
- `offer` starts, never a `user_asked` start the director didn't ask for.
- Desktop's worktree adopted, unless part 0 shows that `cwd` works on an `offer`.
- The launch command stored as an array of words, set only by a fresh signed click, split by a simple rule that refuses shell characters, and refused for `.ps1`.
- `ANTHROPIC_BASE_URL` stays dropped; wrappers set their own.
- One sign-in failure stops a route for every project on the computer. An hourly self-check clears it. Other start failures hold a piece after three in a row.
- No probe builder on the Desktop route; the foreman's check-in is the proof.
- User settings per user on this computer, in the existing profile, with a per-computer suffix where needed.
- Wheelhouse's own JSON read through one reader that names faults. Claude Code's settings checked at every session start and before every start.
- The helper and watchers get a standard environment and serve one home. Held projects have no watcher.
- Guards stay on for every session in the folder, and say so plainly (fault 7).
- Under All stop the watcher idles rather than exits. The helper stays for keys and refusals. The card lists what still runs, from heartbeats.

## 18. Left to the builder

- Exact sign-in failure patterns, from real output on both computers.
- The wake file's name scheme, and how often the watcher sweeps old ones.
- The marker lines' exact text (the builder's prompt marker and the foreman's message marker).
- How `wait-wake.js` waits (a file watch or a poll), within the 60-second heartbeat.
