<!-- docs/specs/2026-11-07-watch-the-crew-design.md -->

# Watch the crew: design (7 November 2026)

## 1. What the director saw

On 7 November 2026 the director saw a piece of work "being built" in the pane for their project, but no session for it in Claude Desktop's sidebar. That is fine for them, they said, but some directors will want to see what is going on.

Today the only views of a build are the pane's "Being built" line and the Logbook's Build tab (`boardTab: build`). Both say *what* is being built, not *what the crew is doing right now*. The one setting about seeing the engine, `engineRoom`, covers only the Archon engine.

## 2. Why the sessions are invisible

The background sessions are not Desktop sessions. The watcher starts them headless, detached and with no window (`scripts/watcher/waker.js`, `spawnDetached`):

- **the foreman** (Shape 1): a fresh `claude -p "Wheelhouse foreman: …"` at each wake, with no session id given;
- **a feature session**: `claude -p --session-id <id>` the first time, then `claude -p --resume <id>` at each later wake, in the feature's worktree (`adapters/claude-code/sessions.js`).

Claude Desktop's sidebar lists only sessions Desktop itself runs. But every `claude -p` run still writes its full transcript, one JSON event per line, to `<Claude config folder>/projects/<folder>/<session id>.jsonl` (the config folder is `~/.claude`, or `CLAUDE_CONFIG_DIR` when set; `scripts/statusline.js` finds it the same way). So everything a watcher needs is already on disk; nothing new has to be run to see it.

## 3. The options weighed

| Option | What the director gets | Safety | Token cost | Verdict |
|---|---|---|---|---|
| **A. A visible Desktop session per crew session** | A sidebar row per session they can open | Poor. A Desktop session has a prompt box: anything typed there goes to the crew session, which is steering it. Opening the same session id in two places at once also risks two writers on one transcript. There is no documented way to add a session to the sidebar read-only. | None extra, but a Desktop-run crew would change how the watcher starts, stops and counts sessions | Rejected |
| **B. A terminal tail** (`tail -f` on the transcript) | Raw JSON scrolling past | Safe: a tail can't write | None | Rejected as the answer: unreadable for a product owner, and differs on Windows. Fine for a developer by hand; the note says where the file is. |
| **C. A read-only view drawn from the transcript, in the pane and the Logbook** | Plain lines: what the crew is doing now, and, on request, the whole run | Safe by construction (section 5) | None from models: a script reads the file and the mod draws it; nothing goes through a model's context | **Recommended** |

## 4. The recommendation

**A setting, `watchCrew`, "Watch the crew", in the advanced group, kept in the director's profile. Levels: `off`, `steps`, `transcript`. Default `off`.**

- **`off`** (the default): as today. The pane and the Logbook say what is being built, nothing more.
- **`steps`**: each "Being built" line in the pane gains its crew session's latest step in plain words, for example "Running the tests", "Changing `src/login.ts`", "Waiting for its next wake", and the Logbook's Build tab shows the last few steps under each piece of work. The foreman gets one line too ("The Bosun is checking the queue").
- **`transcript`**: everything `steps` gives, plus a **Watch** link on each piece of work in the Logbook's Build tab. It opens a read-only page in the pane with that session's run so far: what it said, and each tool it used with a one-line summary of the result, newest at the bottom, refreshed on the pane's own tick. It has no input field.

Three levels and not two because most directors who want this want reassurance ("it's doing something sensible"), which `steps` gives in one glance; the full run is for the curious, and is long.

### 4.1 How it works

1. **Finding the transcript.** A feature session's id is already recorded by the waker. The foreman's fresh `claude -p` has none, so the waker passes it a `--session-id` too and records it in the foreman's running record. The reader looks for `<id>.jsonl` under the config folder's `projects/`, by id alone, so it doesn't depend on how Claude Code names the folder for a worktree path.
2. **Reading it.** A new script, `scripts/crew/watch.js`, reads the file's tail (capped, as `readCapped` does elsewhere), parses the events and turns them into plain lines: tool uses become verbs ("Reading", "Changing", "Running"), and assistant text is cut to its first sentence for `steps`. Unknown events are skipped, so a change in Claude Code's event format shows less, never breaks.
3. **Drawing it.** The mod's pane and the Logbook ask that script on their own tick, as they ask for the board today. Its output never goes into the First Mate's or the foreman's context.

## 5. Safety: a watcher can't answer or steer

These rules hold at every level, and the build plan tests each one:

1. **No path back.** The view has no input, and no button on it sends anything to a crew session. It never starts, resumes or messages a session; it only opens a file for reading. Stopping a build stays wherever it is today, not on the watch page.
2. **Read-only by construction.** The script opens the transcript with a read-only flag, refuses a link or anything not a plain file, and never writes beside it. A crew session can't tell it is being watched.
3. **Data, not instructions.** Transcript text is shown as escaped text and is never handed to a model, so nothing a crew session or a web page it read wrote can act through the view.
4. **Questions stay cards.** If a crew session is blocked on a question for the director, the watch page shows "Waiting for your answer" with a link to the card, never the question as something to answer in place. The card is still the only way to answer (design section 23).
5. **Kept on this computer.** Transcripts can hold file contents and command output. The view shows them only in this computer's pane; nothing of it goes to the board's records, the repository or a remote. Lines that look like keys or tokens are masked.
6. **Off means off.** At `off` the script doesn't run and no transcript is opened.

## 6. Token cost

None from models at any level: reading and summarising are done by a script, and drawing by the mod. The cost is a file read per pane tick per running session, capped by size; at `off`, nothing. The one change to how sessions start, a `--session-id` for the foreman, costs no tokens.

## 7. What changes

- `scripts/settings/catalogue.js`: `watchCrew: { label: 'Watch the crew', group: 'advanced', levels: ['off', 'steps', 'transcript'], default: 'off', home: 'profile' }`, and the design's section 14.2 lists it.
- The waker gives the Shape 1 foreman a session id and records it.
- `scripts/crew/watch.js`: finds, reads and summarises a crew session's transcript.
- The pane's "Being built" lines, the Logbook's Build tab and a read-only Watch page in the pane read from it.
- Section 12 (Safety) gains the six rules of section 5.

`engineRoom` stays as it is: it is about the Archon engine's own views. With Archon as the engine, `watchCrew` shows what Archon's logs give, or says the view isn't available for that engine.

## 8. Left out

- **A Desktop session per crew session** (option A), unless Claude Desktop later offers a read-only session view; then it is worth a second look.
- **Answering from the watch page.** Never: answers are cards.
- **History beyond the transcript's own file.** When Claude Code removes old transcripts, the Watch page for that run says it is no longer kept.
