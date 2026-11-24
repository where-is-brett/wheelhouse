<!-- probes/97-desktop-builders/README.md -->
# Check 97: Desktop builders (builders part 0)

Settles the points in section 4 of `docs/specs/2026-11-24-builders-and-user-settings-design.md` that are still inferred, and the nesting question of decision 16.1. Parts 6 and 7 of `docs/plans/2026-11-24-builders-and-user-settings.md` follow what it finds.

## What the director does

**One click: Start all**, on the card of probe sessions the driving session offers. Nothing else. The driving session does everything else and reads every result itself.

If the director is asked for anything more (a password, a second click, a typed word), the step is wrong: stop and record it as a finding.

## For the driving Desktop session

You are a Desktop Code session on the Mac, working in this repository's checkout or any folder. Run the steps in order. Never use `user_asked` for a start the director did not type. Every start is `initiation: offer`.

1. **Scratch project.** `node probes/97-desktop-builders/run.js prepare ~/.wheelhouse-trials/desktop-probe`. It makes a git project with a session-start hook that leaves `.probe/hook-ran.txt`.
2. **Read the tool.** Read your own `start_session` tool description in full. List every option or field that could set a parent, owner, group or "started by" (none is a finding too). Record the list with `run.js note nesting '...'` at the end.
3. **One offer set.** Call `start_session` once for each try below, all with `initiation: offer`, so the director sees one **Start all**. Each probe session's prompt is the same: "Run `node <this checkout>/probes/97-desktop-builders/run.js report <try-name> <your folder>`, then call `send_message` to the session that started you with the line `probe-done <try-name>`, then stop." Title each `probe-<try-name>`.
   - `cwd`: the scratch project passed as `cwd`. Records `cwdOnOffer`: whether the session's folder is the scratch project or the tool ignored it.
   - `worktree-on`: scratch project, worktree on. Records `worktreePath` and `worktreeBranch`.
   - `worktree-off`: scratch project, worktree off. For comparison.
   - one try per parent option from step 2, each with that option set to your own session's id, named `parent-<option>`. If step 2 found none, no try.
   Pass `wake_when_done` on every start. Record in `wakeWhenDone` whether you were woken, and when.
4. **After the click, read, don't ask.** For each try, read `~/.wheelhouse/probes/97-desktop-builders/reports/<try>.json` (written by the probe session) and note:
   - `projectHooks`: `hookRan` true or false, per try (worktree and not).
   - `entrypoint`: the `entrypoint` value.
   - `pluginLoad`: whether the probe session listed Wheelhouse's skills (`pluginRoot` set, or the skill listing as the session reports it).
   - `sendMessage`: whether each `probe-done` line reached you, how, and how long it took.
5. **Nesting.** For each try: `node probes/97-desktop-builders/run.js scan probe-<try>` looks in Desktop's own files for a parent-like field on that session. Then look at the sidebar: take a screenshot with the computer-use or browser tool if you have one, and describe in words whether each probe session shows nested under yours or as a top-level row. If there is no way to see the sidebar, say that, and rely on the scan. Record `nesting` as `{ nested, how, sidebar }`: `how` is the option or field that gave nesting (the one try that nested), or `null`.
6. **`claude --desktop`.** From a terminal, run `claude --desktop --help`, and record what it says it does in `desktopFlag`. Do not start a session with it unless the help says it needs no click and sends a prompt; if it does, try it once with the report prompt and record what you saw.
7. **Quit and reopen** (`quitAndReopen`) needs Desktop closed, which would end this session. Record `not tried: needs Desktop to be closed` unless a probe session started in step 3 is still running and a detached helper outside Desktop can watch it; then record what the helper saw.
8. **Write the note.** For each key, `node probes/97-desktop-builders/run.js note <key> '<json>'`. Then `node probes/97-desktop-builders/run.js assemble docs/specs/notes/2026-11-24-desktop-probe.md`, and commit it to the probe's branch. A key nobody tried is written "not tried"; if nothing nests, the note says so plainly and names what the sidebar shows.
