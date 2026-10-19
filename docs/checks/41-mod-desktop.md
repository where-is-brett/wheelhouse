<!-- docs/checks/41-mod-desktop.md -->

# Check 41: the mod in Desktop

**Answer:** Deferred — the sitting needs the director at the Mac and is held until they are back (about 08:00 on 20 October 2026); Windows follows when the director is next at that computer. Board-and-usage check 33 (the mod's first piece in Desktop) is folded into the same sitting and is likewise Deferred (held for the director's sitting).

## Question

The mod in Desktop: that the pane, the status line, the buttons, the settings pane, STOP, the courier and `/digest` work in Claude Desktop on the Mac and on Windows: the pane opens beside the front desk; the status line shows; each press records what a click would, including one made while a turn runs; a settings choice is in force at once; STOP and Lift STOP work from the pane; the courier's wake reaches the director's phone while they are away, which shows the mod's timer keeps running while the Desktop window is hidden; the agent's own run of the bridge as a press signs nothing; and a `Wheelhouse:` line sent from another session with `SendMessage` is kept out of the front desk's conversation, which also asks whether `session.receive` fires on the Mac (check 9's open point).

## Tested on

Not yet tried in Desktop. The preparation ran on 20 October 2026 on macOS 27.0.1 with Claude Code 2.1.302; the Claude Desktop installed then is 2.42304.2. The plugin it loads is a copy of this branch as committed (made again at fa9a5af the same day); the sitting first checks the copy is still the branch's latest and makes it again if not. Windows: not prepared yet.

## Method

**How the mod is loaded for one session.** Hot reloading, as in check 9: a session that loads the `plugin-authoring` skill watches its own mods folder, `~/.claude/dev-mods/<that session's id>/`. The first file written there makes Claude Code ask the person at that session, once, "Enable hot reloading for this session?". On the director's **Enable for this session** the folder joins that session's plugins and loads when its turn ends. No other session loads it. The agent opens the test session on the scratch project with `start_session`, in the agent's own permission mode (so a message sent to it later isn't held for the director's approval); the test session loads the skill and says it is ready; the agent then copies the plugin, and a small observer mod, into that session's mods folder; the director clicks.

**A scratch project with its own Wheelhouse home.** The sitting uses a pretend project in the computer's temporary folder: a pretend product, a stand-in host (a local folder standing in for GitHub, with pull request 7 open), a test signing key, and the real helper with `gh` and `glab` stood in for, as the end-to-end tests do. Its Wheelhouse home is a folder of its own, given to the test session by the project's local settings (`env.WHEELHOUSE_HOME`), so nothing touches the director's real `~/.wheelhouse`: STOP there would hold any real project, and the test key would become the computer's signing key. The real home is listed before and after. Undo: stop the helper, delete the folder and the session's copy of the plugin.

**The cards.** Six waiting cards, composed by `cli.js card`: an approval of the stand-in pull request; a confirmation of a setting (Show before building: always); a feature's question (the export's separator, Comma or Tab); a product question (the sign-in button's colour); and two confirmations with reply codes, for check 33 (one to be typed, one sent from the phone). The plan asked for four; check 33's two coded cards are added because both must be shown in the chat before STOP, since the helper refuses writes under STOP and the record a code needs would wait.

**Check 33 first (board-and-usage plan, Task 19, Step 2), about 5 minutes of the director's time.** One card per line for the director to type or send:

| Step | Who | What | Pass |
|---|---|---|---|
| 33-0 | agent | read the scratch home's `usage/` | the allowance windows (the weekly figure among them), a cost line for the session, and the session recorded as the front desk's, by the mod |
| 33-1 | director | answer both coded cards **Not now** in the chat | two `shown` records and two card answers, signed and verifying. The test session then writes the first code with **Confirm** in its own reply and runs the bridge in its own sandboxed Bash: nothing recorded for either |
| 33-2 | agent, then director | the agent turns STOP on; the director types `/go` | a `lift-stop` action labelled `/go`, signed and verifying; STOP off |
| 33-3 | director | type the first card's code with **Confirm** | a confirmation of that setting and a card answer, signed and verifying; the setting in force |
| 33-4 | director | send "stop" from the phone | STOP on |
| 33-5 | director | send `/go` from the phone | a second signed `lift-stop`; STOP off |
| 33-6 | director | send the second card's code with **Confirm** from the phone | a confirmation of that setting, signed and verifying |

**Check 41 (this plan's Task 14, Step 2), about 10 minutes of the director's time.** The agent reads the records after each press:

| Step | Who | What | Pass |
|---|---|---|---|
| 41-1 | director | say whether the pane and the status line are there (**I see both**, **Only the pane**, **Neither**) | both drawn beside the test session |
| 41-2 | director | **Approve** on card 1, the session idle | an approval of pull request 7 at its head commit, signed and verifying; nothing waiting in the helper's queue; card 1 gone from the pane |
| 41-3 | director | **Not now** on the settings card | a card answer, no confirmation; the card still drawn with the same buttons |
| 41-4 | director | **Explain more** on the separator card, then **Comma** on the same card while the turn it started is still running | an answer action for that question, labelled Comma, signed and verifying, whose time falls inside that turn. If it is lost, `HIDE_WHILE_BUSY` is turned on in `hooks/mod/pane.tsx` with its test, and this note says so. Also noted: how Desktop draws the Explain more sentence, and any longer text the session writes before a card |
| 41-5 | director | **Settings**, then **2** on the Pace row, then **Board** | a setting of pace 2 and a confirmation of it, signed and verifying; pace 2 in force for this project |
| 41-6 | director | **STOP**, then **Lift STOP** in the pane | STOP set by the mod, then a signed `lift-stop`; the pane draws STOP off |
| 41-7 | director, then agent | lock the screen for three minutes; the agent adds a fifth card at once; on their return, a card asks whether the phone heard | `courier.json`'s `lastWakeAt` inside the three minutes and after the card was recorded; one wake for the card; the session's entry moving on every 15 seconds while locked (the timer runs with the window hidden); the director says a notification came |
| 41-8 | agent | send the test session two lines led `Wheelhouse:`, one with `SendMessage` and one with the app's `send_message` | neither reaches the conversation (no user row in the transcript). Either way, the origin kind and first line each hook saw are recorded |
| 41-9 | director | type `/digest` | the briefing shown as the command's output with no model turn after it; the time of the last briefing moved on |

**The agent's own press as a bridge run.** The plan has the agent run the bridge with `origin: 'pane'` from its own Bash. The sitting runs it in the test session's sandboxed Bash instead (in step 33-1, a press of **Confirm** on the settings card): the agent's own session runs outside any sandbox, where the bridge can read the signing key and would sign a pane press (check 32: only the sandbox keeps an agent's run from signing). Pass: the run answers `ok: false` and no confirmation is recorded. Which refusal it was is recorded too: "This isn't a Wheelhouse project" shows the sandbox hides the scratch home, and with it the signing key, so the bridge never found the project; it doesn't show that a found project's key was refused.

**The sources.** The records with their signatures checked, `courier.json`, the session's transcript (whose user rows carry an origin), the observer mod's own log, and the director's answers on the cards.

## Evidence

None from Desktop yet. What follows was found by reading the code and by agent runs during the preparation, not by the sitting.

- **The bridge's tick on the scratch project draws the expected pane.** A front desk's tick on the copy made at fa9a5af, run again by the agent on 20 October 2026 through the bridge (and its files put back afterwards, so it counts as no session): role `front-desk`, a tick every 15000 ms, the glance and status line `Wheelhouse · 6 waiting`, STOP off, nothing submitted, the watcher not needed (Shape 2), one health line (agents act with the director's full GitHub or GitLab access, from the quick connection), and the six cards with their buttons: the approval, **Approve**, **Not now**, **Explain more** and **Show me**; each setting's confirmation, **Confirm**, **Not now**, **Explain more** and **Show me**; the feature's question, its two options (**Comma**, **Tab**) and **Explain more**; the product question, **Blue**, **Green** and **Explain more**, each of them starting a front-desk turn. The pane draws one card at a time with **Back** and **Next**, and the settings view behind **Settings**.
- **Another session's `SendMessage` probably won't be kept out.** The engine's types name a `SendMessage` delivery's origin `peer-send-message`, "framed as a notification", and say the app's `send_message` arrives labelled with the sender's title. The traffic rule in `hooks/mod/messages.ts` keeps out only origins `sdk` and `peer` whose first line is led `Wheelhouse…`. So the line is likely to reach the conversation, and its first line may not be the `Wheelhouse:` line itself. By Ruling 49 the rule changes only on the sitting's evidence: step 41-8 records the origin kind and the first line on each event.
- **The courier's STOP wake needed Claude's notification let through STOP.** The STOP guard refused `PushNotification`, so the courier's at-once wake for "STOP is on" could not reach the phone. By Ruling 48 it now passes STOP, matched by its exact name (commit eda68a7, with its tests); the lineage hold still refuses it. Whether it asks for permission in a real session is for the sitting to see.
- **A card made by `cli.js card` never wakes the courier, by design.** `card` records the card as asked, since it has just been put to the director in the chat, and the courier wakes only for cards no one has asked yet. So the locked-screen card in step 41-7 is composed with the same composer but recorded unasked, as the end-to-end tests do.
- **The mod keeps no log of its own,** and Desktop wrote no debug log for its sessions on this Mac. So whether `session.receive` fires is seen with an observer mod in the test session, which notes each `session.receive` and `prompt.submit` with its origin kind and first line, and the answer it saw; `claude plugin validate` passes for it.
- **The real home.** Before the preparation, the real `~/.wheelhouse` on this Mac had been written by tests. Since 8a95e31 (Ruling 50) each test process under `npm test` has a temporary home of its own, and the real home stayed unchanged across a run.

Not known until the sitting, and each seen in its first steps:

- whether the project's `env.WHEELHOUSE_HOME` reaches the bridge the mod runs (very likely, as the engine runs it as the session's user, but not verified; if not, the bridge's first usage reading lands in the real home, the sitting stops, and a card to the director offers the fallback, which writes the real home);
- whether a plugin loaded from a mods folder brings its command hooks as well as its mod (check 9's probe was a mod alone). The reply codes need the prompt record, a command hook; without it check 33's code steps can't pass this way, and loading the whole plugin needs check 31's local install and its own card;
- that the session start's command hook doesn't run for a plugin loaded mid-session (no helper start, no lineage check): harmless here, with the stand-in helper already running, but it differs from real use;
- whether Desktop asks to trust a folder in the temporary folder, and whether the hot-reloading question shows while the session is idle;
- whether the pane's times read in the computer's own time zone;
- how Desktop draws the Explain more sentence, and longer text before a card (a headless stream carries longer prose between tool calls only as a summary, `docs/evals/mod.md`), seen in step 41-4.

## What it means for the design

Settled already: section 12.7, Claude's notification (`PushNotification`) carries on under STOP, so the courier can tell the director's phone that STOP is on (Ruling 48, commit eda68a7).

The rest waits for the sitting. Which design lines depend on which answer:

- **The status line** (section 5.2): if Desktop draws no status line from the mod, the glance stays in the pane's title (both are set already), and section 5.2 says the status line serves the terminal and VS Code.
- **A press during a turn** (section 17.1, the card buttons; section 21): if it is lost, `HIDE_WHILE_BUSY` is turned on with its test, and the buttons are switched off during a turn.
- **The timer while the window is hidden** (section 13): if it stops, the courier can't wake the front desk while the director is away from the computer; needs-you items still wait on the board and in the next briefing (section 13 never relies on the phone alone), and the board's health line says the phone hears of them only while Desktop is open in front.
- **Traffic from other sessions** (section 17.1; `hooks/mod/messages.ts`): the origins kept out, and whether `session.receive` carries them on the Mac, follow what step 41-8 records (Ruling 49).
- **The courier waking for a STOP the director set themselves** (section 21): left for this check to judge from steps 41-6 and 33-4.
- **Check 33** (section 20): if the mod sees the weekly figure but not phone messages on one system, reply codes there wait for the rest of the mod, and the board's health line says so.

## Needs the director

Yes, when they are back at the Mac: one opening card, then one short card per step: about 20 minutes in all, 15 of the director's (check 33's 5 among them), plus 2 or 3 while the session opens. Then Windows, with that visit's other checks.

> **Trying Wheelhouse's pane in Claude Desktop**
>
> **What this is:** a sitting of about 20 minutes that tries Wheelhouse's pane, its buttons, STOP, the phone reply codes and the phone notification in a real Claude Desktop session, on a pretend project. It covers two checks at once (33 and 41).
>
> **Why it comes to you:** only the person at the computer can switch the add-on on for a session, and the presses and phone messages have to be yours. A press by an agent would prove nothing.
>
> **What it changes, and how each is undone:** Wheelhouse is switched on for one test session only, by your one click on **Enable for this session** (undone by closing that session and deleting its copy); a pretend project in the computer's temporary folder, with a small helper program running until the tidy-up (undone by stopping the helper and deleting the folder); a small observer in the same test session (removed with the copy). Nothing else: your real Wheelhouse folder, your Claude settings, Remote Control and your phone stay as they are.
>
> **Options:** **Go ahead**: start now, with one short card per step. **Not now**: nothing is changed, and the pretend project waits.
>
> **My recommendation:** Go ahead: it is the last check before the pane is used for real, and everything it makes is in one folder deleted at the end.
>
> **While you decide:** nothing changes; the build work carries on.
