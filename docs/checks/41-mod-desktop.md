<!-- docs/checks/41-mod-desktop.md -->

# Check 41: the mod in Desktop

**Answer:** Partly, on the Mac.
- **What works:**
  - the pane opens beside the front desk and draws the bridge's cards;
  - every press made in it records what a click would (Approve, Not now, an answer, a setting, STOP and Lift STOP), signed and verifying where the record is a signed kind;
  - a press made while a turn was open was kept;
  - a settings choice is in force at once;
  - the mod's timer kept ticking every 15 seconds through 20 minutes of locked screen, and the courier woke the front desk 15 seconds after a card arrived;
  - the agent's own bridge run as a pane press signed nothing.
- **Seven things need changing before real use:**
  - the courier's wake can be lost after the director presses Esc, though it is marked as sent (two were);
  - Claude's notification for the locked-screen card was skipped as "this terminal is active", with no second try;
  - under STOP the STOP guard refuses loading the notification tool and the front desk's own read commands;
  - Wheelhouse's connector guard refuses the app's own turn tools;
  - a `Wheelhouse:` line from another session reaches the conversation, because Desktop wraps it so its first line isn't the message's own;
  - the front desk explained the wrong card on a pane's Explain more, and wrongly told the director their answer to a question in the chat may not have been recorded;
  - the mod's first opening of the pane shows an error line before Desktop is ready, though the pane opens.
- **Not confirmed:** whether Desktop draws a separate status line (41-1).
- **Not run, at the director's request:** typing in the Desktop session (33-2's `/go`, 33-3's typed code, 41-9's `/digest`), and a press made while the session is still writing.
- **Windows:** follows when the director is next at that computer.
- **Check 33** (the mod's first piece in Desktop), folded into the same sitting: **Partly**. The usage readings and every phone line passed; its two typed-in-Desktop steps weren't run.

## Question

The mod in Desktop. The pane, the status line, the buttons, the settings pane, STOP, the courier and `/digest` work in Claude Desktop on the Mac and on Windows:
- the pane opens beside the front desk;
- the status line shows;
- each press records what a click would, including one made while a turn runs;
- a settings choice is in force at once;
- STOP and Lift STOP work from the pane;
- the courier's wake reaches the director's phone while they are away, which shows the mod's timer keeps running while the Desktop window is hidden;
- the agent's own run of the bridge as a press signs nothing;
- a `Wheelhouse:` line sent from another session with `SendMessage` is kept out of the front desk's conversation, which also asks whether `session.receive` fires on the Mac (check 9's open point).

## Tested on

- The sitting ran on 20 October 2026, 07:58 to 09:37 UTC, on macOS 27.0.1, with Claude Desktop 2.42304.2. The test session's Claude Code was 2.1.299, the floor.
- The plugin it loaded is a copy of this branch as committed at 424a49c.
- It took three attempts. The director found the first two hard to follow, and the third had its own numbered list (see "How the sitting ran").
- Windows: not tried.

## Method

**How the mod is loaded for one session.** Hot reloading, as in check 9.
- A session that loads the `plugin-authoring` skill watches its own mods folder, `~/.claude/dev-mods/<that session's id>/`.
- The first file written there makes Claude Code ask the person at that session, once, "Enable hot reloading for this session?".
- On the director's **Enable for this session**, the folder joins that session's plugins and loads at the start of its next turn. No other session loads it.
- The main session opened the test session on the scratch project in auto mode, the same mode as the agent running the sitting, so the agent's messages weren't held.
- The test session loaded the skill and said it was ready. The agent then copied the plugin, and a small observer mod, into that session's mods folder, and the director clicked.

**A scratch project with its own Wheelhouse home.** A pretend project in the computer's temporary folder, given to the test session by the project's local settings (`env.WHEELHOUSE_HOME`), with:
- a pretend product;
- a stand-in host: a local folder standing in for GitHub, with pull request 7 open;
- a test signing key;
- the real helper, with `gh` and `glab` stood in for, as the end-to-end tests do.

Nothing touched the director's real `~/.wheelhouse`: it was listed before and after, and nothing was added, changed or removed. Undo: stop the helper, delete the folder and the session's copy of the plugin.

**The cards.** Six waiting cards, composed by `cli.js card`:
1. an approval of pull request 7;
2. a confirmation of a setting (Show before building: always);
3. a feature's question (the export's separator: Comma or Tab);
4. a product question (the sign-in button's colour);
5. a confirmation with a reply code, for check 33, to be typed;
6. a confirmation with a reply code, for check 33, to be sent from the phone.

A seventh card, "Which photo goes on the home page?", was added once the screen locked.

**The steps as planned.** Check 33 is the board-and-usage plan's Task 19, Step 2; check 41 is this plan's Task 14, Step 2.

| Step | Who | What | Pass |
|---|---|---|---|
| 33-0 | agent | read the scratch home's `usage/` | the allowance windows, a cost line for the session, and the session recorded as the front desk's, by the mod |
| 33-1 | director | answer both coded cards **Not now** in the chat | two `shown` records and two card answers. The test session then writes the first code with **Confirm** in its own reply and runs the bridge in its own sandboxed Bash: nothing is recorded for either |
| 33-2 | agent, then director | the agent turns STOP on; the director types `/go` | a signed `lift-stop`; STOP off |
| 33-3 | director | type the first card's code with **Confirm** | a signed confirmation of that setting; the setting in force |
| 33-4 | director | send "stop" from the phone | STOP on |
| 33-5 | director | send `/go` from the phone | a signed `lift-stop`; STOP off |
| 33-6 | director | send the second card's code with **Confirm** from the phone | a signed confirmation of that setting |
| 41-1 | director | say whether the pane and the status line are there | both drawn beside the test session |
| 41-2 | director | **Approve** on card 1 | a signed approval of pull request 7 at its head commit; nothing in the helper's queue; card 1 gone |
| 41-3 | director | **Not now** on the settings card | a card answer, no confirmation; the card still drawn |
| 41-4 | director | **Explain more** on the separator card, then **Comma** while that turn runs | a signed answer labelled Comma inside the turn |
| 41-5 | director | **Settings**, **2** on the Pace row, **Board** | a setting of pace 2 and a signed confirmation; pace 2 in force |
| 41-6 | director | **STOP**, then **Lift STOP** in the pane | STOP set by the mod, then a signed `lift-stop` |
| 41-7 | director, then agent | lock the screen; a card is added at once | a wake inside the three minutes, after the card; the timer ticking while locked; a notification on the phone |
| 41-8 | agent | send the test session a line led `Wheelhouse:` with `SendMessage`, and one with the app's `send_message` | neither reaches the conversation; each origin and first line recorded |
| 41-9 | director | type `/digest` | the briefing as the command's output, with no model turn after it |

**The agent's own press as a bridge run.** The test session ran it in its own sandboxed Bash, not the agent's: a press of **Confirm** on card 2 with `origin: 'pane'`. The agent's own session runs outside any sandbox, where the bridge can read the signing key and would sign a pane press (check 32).

**The sources.**
- The records, with their signatures checked.
- `courier.json`.
- The session's transcript, whose user rows carry an origin.
- The observer mod's log, which notes each `session.receive` and `prompt.submit` with its origin kind and first line.
- A watcher reading the screen-lock state (`ioreg`: `IOConsoleLocked`, `CGSSessionScreenIsLocked`) every second.
- The director's answers, relayed by the main session.

**How the sitting ran.**

1. **First attempt (07:58 to 08:18).** Each step was a card relayed by the main session.
   - Wheelhouse loaded and ticked on the scratch home, and 33-0 and 33-1 passed.
   - The director found it confusing, and the session was archived.
   - Two findings came from it, both below: the notification tool's load refused under STOP, and the connector guard refusing the app's turn tools.
2. **Second attempt (about 08:20 to about 08:35).** The test session's brief led the director itself.
   - It ended, in the director's words, "corrupted", with a reply of only the mod's status-line text ("wheelhouse: Wheelhouse · 5 waiting · week 75%").
   - The session was deleted with its transcript, so the cause can't be read.
   - Its records survive: one pane **Approve** on card 1, signed and verifying.
3. **Third attempt (09:01 to 09:37).** The main session gave the director a numbered list, and the test session gave no instructions.
   - The agent started the session's turn after Enable with a plain message.
   - A watcher added the locked-screen card when the screen locked, and the agent sent 41-8's lines on unlock.
   - At the director's request nothing was typed in the Desktop session, so 33-2, 33-3 and 41-9 weren't run.
   - The evidence below is from this attempt unless it says otherwise.

## Evidence

**Loading.**
- The director clicked **Enable for this session** at 09:02:33. The notice ("The person enabled mod hot-reloading for this session and the mods … loaded") was queued and came at the start of the next turn.
- The front desk skill loaded from the mods folder.
- `courier.json` held the session, ticking every 15 seconds, and `usage/` was written in the scratch home, so the project's `WHEELHOUSE_HOME` reached the bridge.
- No lineage hold was set (`hold.json`: `held: false`), as expected if the session start's command hook doesn't run for a plugin loaded mid-session.
- The command hooks did load: the prompt record wrote `shown` records and recorded the phone's lines.

**A line at load (finding).** The director saw a line from the mod: "ui.open: no-surface: no surface is attached ($.session.surfaces() is empty)", yet the pane was showing:
- on the right of the session;
- titled "Wheelhouse · 6 waiting · week 75%";
- with STOP and card 1 of 6 (Proposed change #7, reply code XVFM), with **Approve**, **Not now**, **Explain more**, **Show me**, **Next** and **Settings**.

The mod's first `ui.open` runs before Desktop attaches the surface, fails and says so, and the pane opens anyway. The line isn't in the session's transcript file.

**33-0: pass.** In the scratch home's `usage/`:
- `allowance.json` holds the five-hour window and the seven-day window (74% used);
- `mod/2026-10-20.jsonl` holds a cost line for the session (about US$0.50);
- `sessions/<id>.json` records the session as the front desk's, `by: "mod"`.

The first attempt showed this; the third ticked the same way.

**33-1: pass.**
- Both coded cards were asked in one question in the chat: `shown` records for 92DH and ZT9Z, signed and verifying. The director answered both **Not now**: two card answers, and no confirmation.
- Before that, the test session wrote "92DH Confirm" in its own reply and ran the bridge twice in its sandboxed Bash:
  - the typed reply answered `{"ok":false,"says":"This isn't a Wheelhouse project"}`;
  - the pane press (card 2, **Confirm**) answered the same.
- Nothing was recorded for either.
- The refusal shows the sandbox hides the scratch home, and its key with it, so the bridge never found the project. It doesn't show that a found project's key was refused.
- In the first attempt, the auto-mode safety check blocked the pane press before it ran; in the third, it ran and was refused by the sandbox.
- The sandboxed runs also printed many lines of "ERROR: failed to copy trust settings of system certificate", from the sandbox: harmless.

**33-2, 33-3: not run** (they need typing in the Desktop session). The first attempt showed one thing for 33-2: the courier woke the session at once for the agent's STOP.

**33-4: pass.** The phone's "stop" arrived as a `user` row with origin `human`, and STOP went on, marked by the prompt record (`by: "prompt"`).
- The turn it started answered it. Then the courier woke the session once, after the turn: `courier.json` `sent` holds the STOP once.
- Claude's notification under STOP **was sent**: "Wheelhouse: STOP is on." answered "Mobile push requested". This was because the test session had loaded the notification tool before STOP (see "Under STOP", below).

**33-5: pass.** The phone's `/go` arrived with origin `human` (as `<command-name>/go</command-name>`): a `lift-stop` action labelled `/go`, signed and verifying; STOP off.

**33-6: pass.** The phone's "ZT9Z Confirm" made a confirmation of that card's setting, signed and verifying, and a card answer. The setting is in force: Token efficiency, Lean, "from this project".

**41-1.** The director saw the pane with its card, and the glance "Wheelhouse · 5 waiting" in the pane's title. No separate status line was reported.

**41-2: pass.**
- **Approve** on card 1 made an `approval` of pull request 7 at the prepared head commit, signed and verifying, and a card answer.
- Nothing was left in the helper's queue, and the next tick drew four cards.
- The second attempt's **Approve** recorded the same way.

**41-3: pass.** **Not now** on Show before building made a card answer and no confirmation. The card is still drawn, with Confirm, Not now, Explain more and Show me.

**41-4: the press while a turn was open, pass; a press during the writing, not shown.**
- **Explain more** on the separator card submitted "Wheelhouse pane: the director pressed Explain more on card 2 (055d8943-…)", origin `plugin`, at 09:10:21, and recorded a card answer.
- The session wrote its explanation and asked the card again in the chat (09:10:47). The director pressed **Comma** in the pane at 09:11:11, while that question was still open and the turn not ended: an `answer` action for `q-export-csv-1`, labelled Comma, signed and verifying.
- The director thinks they didn't press during the writing itself, which lasted about 26 seconds, so a press made while the session is writing isn't shown either way. It wasn't repeated. `HIDE_WHILE_BUSY` stays off: no press was seen lost.

**The wrong card explained (finding).** On that Explain more, the session explained Show before building, not the export's separator ("It's like asking a builder to show you the drawings before they lay any bricks…").
- It explained first, from a guess (`cli.js explain showFirst`, which failed, then the glossary). Only then did it run `again 2`, which gave the right card, and ask that.
- After the approval, card 2 had become the separator card. The session went by the earlier numbering, or by the earlier press on Show before building, not by the card the prompt named, by number and id.

**41-5: pass.** **Settings**, **2** on the Pace row, **Board** made a `setting` of pace 2 and a confirmation of it, signed and verifying. Pace shows 2, "from this project".

**After Esc, the courier's wake was lost (finding).**
- The director pressed Esc on the chat's question (09:11:43). The session was left interrupted ("Request interrupted by user for tool use") and took no turn.
- The director then pressed **STOP** in the pane twice (09:12:55, 09:13:54). STOP went on each time, and the courier marked a STOP wake sent each time.
- But neither wake reached the conversation: no row in the transcript, and no `prompt.submit` in the observer. The director saw a toast: "Wheelhouse couldn't hand that to the front desk."
- So the mod's hand-on failed and said so, but the courier had already marked the wake as sent and doesn't try again. No notification went to the phone for either STOP.
- A plain message from the agent then gave the session a turn, and from then on the mod's prompts came through again.

**41-6: STOP and Lift STOP in the pane, pass (the presses); the wake as above.** STOP went on from the pane both times. **Lift STOP** made a `lift-stop` action each time (09:13:28, 09:14:34), signed and verifying. STOP was off before the lock.

**41-7: the timer and the wake, pass; the phone, no.**
- The screen locked at 09:15:04 (both lock keys true), and the card was recorded at once (09:15:04.3). The courier's ten-minute gap had been set by STOP's wake 70 seconds before, so the card's script moved `lastWakeAt` back, as the end-to-end test does.
- The courier woke the front desk at 09:15:19, 15 seconds later: "Wheelhouse courier: 1 new card (4). Send Claude's notification in one line, then ask any new cards now, once." `sent` holds the card once.
- The session called Claude's notification ("Wheelhouse: 1 new card (4) is waiting for you."), which answered **"Not sent — this terminal is active, so your output here already reaches the user; a separate notification would be redundant."** It then asked the card in the chat.
- The screen stayed locked for 20 minutes, until 09:35:49. Through all of it the session's entry in `courier.json` moved on every 15 seconds, with an occasional 30, so the mod's timer runs with the screen locked.
- The director got nothing on the phone. They aren't sure whether the Claude app was open on the phone at the time.
- **Reading, not settled.** Two readings fit:
  - the call came 48 seconds after the director's last press in the pane (Lift STOP at 09:14:34), and Claude Code likely counts a person as active for a while after they act, locked screen or not (check 4 saw a push go out two minutes after the last message, and another reach the phone with the screen locked);
  - "your output here already reaches the user" may mean the Claude app on the phone was showing the session, which the director can't rule out.

  On the first reading, the wake came too soon after the director left and nothing tries again once they are truly away. A push after a real absence, in the second sitting, decides between them.

**The locked-screen card's answer (finding, the front desk's).** On return the director answered the photo card **The product** in the chat. The session said the card "came without an answer line or reply code, so your choice may not have been recorded". The prompt record had in fact written a `card-answer` "The product" at 09:36:32, so the answer was on record, and the session's words were wrong. Whether that answer closed the card wasn't checked before the tidy-up.

**41-8: neither line was kept out.** Both arrived after the director answered that card, at 09:36:39 and 09:36:47:

| Line | Origin the hooks saw | What the conversation got |
|---|---|---|
| `Wheelhouse: check 41 trial A`, sent with `SendMessage` | `sdk` (the user row carries none); `prompt.submit`'s first line `<system-reminder>` | a system-reminder block, then `<cross-session-message from="local_…" name="…">`, the line, `</cross-session-message>` |
| `Wheelhouse: check 41 trial B`, sent with the app's `send_message` | `peer`, `from` the sending session, `hostInjected: true`; first line `<cross-session-message from=…>` | "Another Claude session sent a message:", the same wrapper around the line, then a paragraph on how to treat a peer's message |

- `session.receive` fired once at 09:36:39 and consumed nothing. The observer's own read-then-write lost its first line, so which of the two it was isn't known.
- It also fired for each phone line (origin `bridge`: "stop", "/go", "ZT9Z Confirm").
- So check 9's open point is answered on the Mac: **`session.receive` fires there**, for Remote Control lines and for at least one session's message.
- The traffic rule in `hooks/mod/messages.ts` reads the first line, and neither origin puts the message's own first line first: the `Wheelhouse:` line sits inside the wrapper.

**41-9: not run** (it needs typing in the Desktop session).

**Under STOP (findings, from the first and third attempts).**
- **Loading the notification tool is refused.** PushNotification is a deferred tool: a session loads it with `ToolSearch` first. In the first attempt the courier's STOP wake asked for the notification, and the STOP guard refused the `ToolSearch` ("STOP is on: only reading, reporting and the runbook carry on"), so nothing was sent. Ruling 48 lets PushNotification itself through by name, but not the load before it. In the third attempt the session had loaded it before STOP, and it went.
- **The front desk's read commands are refused.** On the phone's "stop", the front desk ran `cli.js cards` to show the Lift STOP card. The STOP guard refused it, so the director saw no Lift STOP card in the chat. `cards` and `again` only read, apart from marking a card as asked, which the helper refuses under STOP and the command takes in its stride.

**The app's own tools (finding, first attempt).** The test session's call to the app's wrap-up tool (`mcp__ccd_turn__wrap_up`) was refused by Wheelhouse's connector guard: "This project has not listed that connector: ask the helper to do it". The guard treats the Desktop app's built-in `mcp__ccd_*` tools as connectors the project must list.

## What it means for the design

- **The pane, its presses and the settings pane** (section 17.1) work in Desktop on the Mac as designed: each press records what the matching click would, signed where the record is a signed kind, and a settings choice is in force at once.
- **The status line** (section 5.2): the glance shows in the pane's title. Whether Desktop draws a separate status line wasn't confirmed, so section 5.2 stands until the second sitting looks.
- **A press during a turn** (sections 17.1 and 21): a press while the turn waited on its question was kept; one during the writing isn't shown. `HIDE_WHILE_BUSY` stays off until a press is seen lost.
- **The timer while the screen is locked** (section 13): it keeps running, so the courier can wake the front desk while the director is away.
- **Claude's notification** (section 13): it was skipped 48 seconds after the director's last action, with the screen locked, and the courier wakes within seconds of a new card. If, as is likely, Claude skips a push for a while after the director acts, a card that comes just after they leave never reaches the phone. **Change likely needed:** while the card is still unanswered and the director is away, the courier wakes once more, a few minutes later, for the notification alone. The second sitting's push after a real absence settles it first. Check 4's "the phone stays a second channel" holds: the card waited on the board and in the chat.
- **The courier's hand-on** (section 17.1, the courier): **change needed.** A wake is marked sent before the mod has handed it to the front desk. In this sitting, after the director pressed Esc on a question, the hand-on failed twice (with the toast), and neither wake was tried again. Mark it sent only once the prompt is handed on, or try again at the next tick.
- **STOP** (section 12.7): **change needed.** Under STOP the guard should let through the tool search that loads the notification tool, and the front desk's read commands (`cards`, `again`, `views`), as it lets through PushNotification and reading. A guard change, made with its tests.
- **The connector rule** (section 12): **change needed.** The Desktop app's own built-in tools (`mcp__ccd_*`: its task list, wrap-up, session tools) aren't connectors the project chose. Which of them pass needs a ruling; the turn tools at least.
- **Traffic from other sessions** (section 17.1; `hooks/mod/messages.ts`, Ruling 49): **change needed.** For origins `sdk` and `peer`, the rule should read the first line inside the `<cross-session-message>` wrapper, after any leading system-reminder block or "Another Claude session sent a message:" line, and keep it out when that line is led `Wheelhouse:`.
- **The front desk's playbook** (section 17.1, Explain more; Ruling 11): **change needed.**
  - On "Explain more on card N (id)", the front desk reads that card first (`again N`, checking its id) and explains only that card.
  - After a question's answer in the chat, the front desk checks `views waiting` and says only what it shows, never guessing that the answer went unrecorded.
  - The command finding a card by its id stays a front desk build item.
- **The mod's first `ui.open`**: it runs before Desktop has a surface and shows an error line though the pane opens. It should stay quiet, or open on the first tick once a surface is attached.
- **Check 33** (section 20): the mod reads the weekly figure in Desktop, and every phone line made a record that verifies. The typed-in-Desktop steps remain to be seen.

## Needs the director

- **Not now.** The Mac sitting is done.
- **When the changes above are made:** a short second sitting on the Mac for the steps not run (`/go` and a code typed in the Desktop session, `/digest`, a press during the writing), whether Desktop draws a separate status line, and the courier's notification after a real absence.
  - If the courier's reminder ten minutes on is still "Not sent — this terminal is active", the phone's Claude app showing the session is the likely cause (the second reading). Then setup's notification step should tell the director to close the Claude app on the phone. That step is setup's, so it isn't changed here.
- **Windows:** with that visit's other checks.
