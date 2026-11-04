<!-- docs/specs/2026-11-04-one-card-design.md -->

# One card, one answer: design (4 November 2026)

## 1. What the director saw

On 4 November 2026, in real use of v0.2.6, the director asked the First Mate to start two queued pieces of work. Here is what happened, with the times from the session's own transcript:

| Time | What happened |
|---|---|
| 10:33:58 | The First Mate composed two approval cards with `card` and asked both in one AskUserQuestion call ("1 of 2", "2 of 2"). The pane showed the same cards. |
| 10:34 | The director pressed Approve in the pane. The pane's press signed the approvals and closed the cards. |
| 10:34 to 10:35 | The chat's question stayed open. Nothing can close it from outside. |
| 10:35:13 | The director pressed Esc to clear it. That interrupted the whole turn. The tool result read "The user doesn't want to proceed with this tool use… STOP what you are doing", followed by "[Request interrupted by user for tool use]". No PostToolUse hook ran, so nothing was recorded, which was correct. |
| 10:35:34 | On "Status?", the First Mate ran `views waiting`, which answered "Nothing is waiting for the director." It still said "The approval cards were closed without an answer, so the pieces are still waiting." That was a guess from the rejected tool result, and it was wrong. |
| 10:37 | On "approve them", the First Mate composed both cards again and asked them. The director clicked Approve. The prompt record answered that the card "was already decided, and 'Approve' counted, chosen at 10:34". `views work` showed both pieces approved and queued. |

**The panel's answer was never lost.** It counted at 10:34. What went wrong:

1. **The card was shown in two places at once,** so whichever one the director didn't use was left open.
2. **The chat's copy couldn't be closed,** and the only way out of it, Esc, stops the session.
3. **The First Mate misread the stopped question** as "closed without an answer". Nothing told it about the panel's answer, so it went by the error text.
4. **It composed and asked cards that were already decided.** `card` did not say so, and AskUserQuestion showed them again.
5. **Separately, the pane showed one board line twice:** "Safekeeping: Only on this computer, no backup".

A sixth thing is outside this design. The approved work then sat "queued, not started yet", because that session couldn't take Wheelhouse's lock: an old 0.2.2 helper was still running. Section 11 says so.

## 2. How it works today

**In the chat.** The First Mate gets a card's question from `cards`, `again`, `card` or `review` (`scripts/frontdesk/cli.js`) and gives it to AskUserQuestion. Two hooks surround the call:

- `scripts/hooks/card-check.js` (PreToolUse) checks the card's form. In a project's folder, it denies a card in the wrong form and a baseline card that isn't the very one composed, and lets everything else through.
- `scripts/hooks/prompt-record.js` (PostToolUse) turns the click into records. It writes the plain card answer, and for a deciding button on a card with a set line, the signed approval. It claims each answer exclusively first, with the reply code's marker and the shown record's marker, so two answers can't both count. A click on a card that was already decided records nothing, and its context says which answer counted and when. That part worked on 4 November.

`cards` marks the cards it hands out as `asked`, so a card dismissed without an answer isn't offered on every turn. `card`, which composes a card from scratch, does not check whether the same decision has already been taken.

**In the pane.** A press goes from `hooks/mod/cards.tsx` through the bridge (`scripts/mod/bridge.js`) to `scripts/mod/press.js`. A deciding press signs the same record a chat click would, through the prompt record's own code, under the same claim markers. Then it writes the card answer. It hands the First Mate no prompt. Only Show me, Why?, Suggest a change… and a question card's own options start a front-desk turn ("Wheelhouse pane: …").

**Setup's cards** are asked only in the chat. The pane draws them with no buttons (`scripts/mod/buttons.js`), with a line saying where they're answered. Their answers are claimed through `claimAnswer` in `scripts/lib/setup-clicks.js`. A claim left behind with no answer is taken back once stale.

**Copilot** asks with its own question tool (`ask_user`, or `askQuestions` in VS Code). Its VS Code add-on draws a panel, and how that panel holds Copilot's cards back, and how its answers reach the chat, is in `docs/specs/2026-11-04-vscode-panel-design.md` (section 6).

**What Claude Code offers** (hooks documentation, and the 4 November transcript):

- An AskUserQuestion that is already showing can't be closed or answered from outside.
- A PreToolUse hook can **deny** the call. The question then never shows, and the model reads the hook's reason and carries on. A PreToolUse hook can also allow it with `updatedInput` holding the answers, so it runs without showing anything.
- Esc on an open question interrupts the turn. No PostToolUse runs, and the model sees the rejection text above.
- The desktop question box also has a **Skip** button. Its result isn't documented (section 9).
- `askUserQuestionTimeout` is the director's own setting, and it submits what was already selected. Wheelhouse doesn't set it.

## 3. Goals, non-goals and anti-goals

**Goals**

- **One card, one place.** At any moment, a card is answerable in one place: the pane when one is open beside the session, otherwise the chat.
- **One answer.** Whichever answer comes first counts. Every other copy says it was answered, and where and when. A decided card is never asked again.
- **No dead-end chat question.** The chat never shows a card that the pane can answer.
- **Esc never loses work.** A dismissed or stopped question records nothing and undoes nothing. The First Mate's next turn says correctly what was decided, and where.
- **The board line shows once.**

**Non-goals**

- Changing how a click is signed, claimed or recorded. That works.
- Changing the card's words, its form or the pane's look (direction A, Inset).
- The lock problem that kept approved work from starting (section 11).

**Anti-goals**

- **A card that can't be answered anywhere.** For example, the chat sends the director to a pane they have closed.
- **An answer counted that the director didn't give,** for example a hook answering a question for them.
- **An extra Claude turn for every press,** which costs usage for nothing the director needs.

## 4. Where a card is asked

**The chat is the main medium.** The director's words, 4 November 2026: "the panel is the only place I click … this is reflected in the chat so that the chat itself can still be the main medium of communication. The panel is there for assisting to make life easier for me but the session is still the main thing." So:

- **The director talks to the First Mate in the chat,** and the First Mate answers there, as today.
- **The panel is where cards are clicked.** It is an aid beside the chat, not a second conversation.
- **Every panel click shows in the chat** at once, as a line in the transcript (section 4.4).
- **Typing an answer in the chat still counts,** in the ways a typed answer counts today. A card's reply code typed with its option (`K7QD Approve`) records the click, as the mod's reply path does now. Saying "ask me here" brings the card into the chat as a question to click. Plain words such as "approve them" still steer and never approve on their own (design section 12.3): the First Mate answers with the card, in the panel or here, and says so in one line. This keeps the rule that only the director's own click or reply code decides, so text pasted from elsewhere can never approve anything.

### 4.1 The rule

**When a live pane is beside the session, cards are answered in the pane, and the chat doesn't ask them.** The chat says in one line where they are, for example "Two cards are waiting in the panel. Say if you'd rather answer them here." When no live pane is there (in the terminal, on Copilot, in a session the mod doesn't draw for, or when the pane has gone stale), the chat asks them as it does today.

The director chose this on 4 November 2026 (D1, section 10).

### 4.2 Knowing the pane is live

- **The mod keeps a mark.** Each tick (every 15 seconds, `TICK_MS`) already sends the bridge the session's id. The tick request gains `drawn`: when `ui.render` last drew the pane in that session. The bridge writes `<wheelhouseHome()>/sessions/<session id>/pane.json`, in the session folder that already holds `role.json` (`scripts/lib/role.js`), and is cleared with it, holding `{ "at": <tick time>, "drawn": <time>, "surface": <surface> }`. It's written atomically, like the other files there.
- **Live** means a tick within the last 45 seconds (`STALE_TICKS × TICK_MS`, the pane's own staleness rule) and a draw within the same window. A pane the director closed stops drawing, so it stops being live within 45 seconds. Builder to verify that `ui.render` doesn't run for a closed or hidden pane (section 9). If it does, the mark uses the nearest signal the surface gives.
- **The phone.** The pane drawn through Remote Control counts as live in the same way, so the phone also gets one place.

### 4.3 Holding the chat back

`card-check.js` (PreToolUse on AskUserQuestion) gains one check, after the baseline check and ahead of the form check. It applies only in a project's folder, and only in a session whose role is the front desk's (`sessionRole`). The pane opens only there, so a feature session, the foreman and a folder being set up pass as today. When the session's pane is live and every question in the call is a Wheelhouse card the pane can answer (a card with buttons, by `scripts/mod/buttons.js`'s own judgement), it **denies** the call. Its reason tells the First Mate what to say: one line naming how many cards wait in the panel and that it can ask them here instead, with no card's words, number or id. A setup card, a card with no pane buttons, and any non-card question go through as today. A call mixing both kinds is denied with a reason that says to ask only the others.

`cards`, `again`, `pull-cards` and `review` still hand out their questions and still mark them as asked. The hook decides whether they show, not the commands, so the First Mate's steps stay the same everywhere.

**The way out.** When the director says to answer here, for example "ask me here" or "show them in the chat", the First Mate runs `cards --here` (or `again <n> --here`). That writes a one-turn mark in the same session folder (`here.json`, with the card ids and a two-minute limit), and the hook lets those cards through once. *Designer's call.*

### 4.4 Answers in the pane reaching the chat

**At once, as a line in the chat.** The desktop mod can add a row to the session's conversation without starting a turn: `$.session.append` (the mod's engine types, `SessionAppendArgs`). A row of `type: "system"` is a notice the director sees in the chat and the model never reads. A row of `type: "user"` is one the director doesn't see as typed, and the model reads it with its next request. Both are "listed at once", with text blocks only, and neither starts a turn. A plugin's append comes in by the door `note`, and a hook above may refuse it, which the call answers as `{ deny }`.

So after a deciding press is recorded (the bridge's press answer says it counted), the mod appends two rows to the First Mate's main conversation:

1. **A notice for the director,** in the chat: "You approved the Doubt plan in the panel at 10:34." The words come from the bridge (`answeredWords`, the same words as everywhere else), in the second person, one line, with no card id.
2. **A hidden line for the First Mate:** "Wheelhouse pane: the director approved the Doubt plan in the panel at 10:34 (card <id>). The chat already shows this to them: don't repeat it, and never ask that card again." The First Mate reads it at its next turn, with no turn spent now.

A press that only hands the First Mate a prompt (Show me, Why?, Suggest a change…, a question card's own options) is shown by that prompt's turn, as today, and adds no notice.

**The fallback: the next time the director writes.** When the append is refused, or the build has no `session.append`, or the answer came another way (a reply code from the phone, or a click in another session), `scripts/hooks/board-context.js` adds the context line on the next prompt: "Since your last turn: card 2 was approved in the panel at 10:34." It uses the card's subject, not its id, and only the First Mate reads it. It leaves out any answer whose hidden line is already in the transcript's tail, so nothing is said twice. The First Mate's next words, before anything else, state each answer that line names, in one plain line ("You approved the Doubt plan in the panel at 10:34."). It never asks that card again, and never calls a card waiting once that line or `views waiting` says it was decided.

The director chose the panel for clicks and the chat as the main medium (D1), and, before this was found, the next time they write (D2). The notice keeps D2's no-extra-turn rule and shows the answer sooner. The next-time line stays as the fallback (section 10).

## 5. One answer

The claim markers already make the first answer the only one. These changes stop the other copies from asking again:

- **The hook won't ask a decided card.** Before the pane check, `card-check.js` finds each question's card as the prompt record already does: `cardOutcomes` and `standing` in `prompt-record.js` match a question to its card by the card's question text or its chat copy, and say whether it was decided and how. They are exported and shared, not written again. A question that matches no card is no card, and goes through. When a card is no longer waiting because it was answered, it denies the call. Its reason names each decided card's subject, the answer that counted, where and when ("approved in the panel at 10:34"), and tells the First Mate to ask only the cards still waiting, through `again`. This covers a stale question the First Mate had kept from earlier in the session.
- **`card` won't compose a decided approval.** For `approve-work`, and for any kind whose set line names a hash, `card` refuses when the same decision at the same hash is already signed. It says "Already approved in the panel at 10:34; nothing to ask." For other kinds it says the same of a card with the same set line that was answered within the day. The First Mate tells the director in one line.
- **`views waiting` names the recent answers.** After the cards waiting, or after "Nothing is waiting for the director.", it adds "Decided in the last hour:" with one line each: the subject, the answer, where (panel, chat, reply code or phone) and when. The First Mate's answer to "Status?" then comes from a record, not from a guess.

## 6. Esc never loses work

The Esc case today has two parts:

- **Recording.** A stopped or skipped question runs no PostToolUse, so it records nothing and wipes nothing. That's correct, and it stays that way. A test pins it.
- **What the First Mate says next.** On the next prompt after a turn that ended on a stopped card question, `board-context.js` reads the transcript's tail (as `chat-question.js` already does). For each card that question held, it adds its state now: decided (with what, where and when) or still waiting (with its number on the Logbook). The front-desk skill gains a rule: a stopped, skipped or rejected question says nothing about an answer. Never call a card "closed without an answer" or "not approved". Go by that line and `views waiting`.

The skill also tells the director, the first time it happens, that Esc stops the First Mate and that they can just write to it again. In the pane, Not now is the way to put a card off. *Designer's call.*

### 6.1 The question already open when the pane answers

The pane rule makes this rare, but it can still happen. The pane might become live while a question is already showing, or the director might open the pane mid-question. For that case:

- **The hook notes what is open.** When `card-check.js` lets a card question through, it writes `open.json` in the session folder: the card ids and the time. `prompt-record.js` clears it after the click. So does the next prompt, through `board-context.js`. A mark older than the turn that wrote it counts for nothing, since the mod's `turn.complete` sends the bridge `idle`.
- **The pane marks the card.** While a card is open in the chat, its small line adds "Also open in the chat." After a press on it, the toast reads: "Counted. The copy in the chat now changes nothing: pick anything or press Skip." This is the one place the pane mentions Skip, which doesn't stop the session (builder to verify, section 9).
- **A later pick in the chat** goes through the prompt record's existing "already decided" path. The First Mate says in one line which answer counted and when, as the skill already says.

## 7. Setup's cards and Copilot

- **Setup's cards** have no pane buttons, so the pane rule never holds them back. They stay chat-only, and the pane keeps its line saying they're answered in the chat. Esc on a setup card records nothing (no PostToolUse). `claimAnswer` takes back a stale claim, and the setup step asks again through `plan <n>`, as today. Setup's skill gains the same rule as the front desk's: a stopped question is no answer. No other change.
- **Copilot** has a panel, the VS Code add-on, but it does not yet mark itself live, so the pane rule never holds Copilot's cards back and they are asked in its chat, as today. The VS Code panel plan (`docs/superpowers/plans/2026-11-04-vscode-panel.md`) gives it that mark later. Nothing there is shown twice. The decided-card check keeps a card that was already answered (by a reply code, say) from being asked again. The decided-card check (section 5) applies where Copilot's hooks reach its question tool (`adapters/copilot/hooks.js`). Where they don't, `card`'s refusal and `views waiting`'s recent answers still keep it from asking a decided card. The builder checks which applies and says so in the build report.

## 8. The repeated board line

**Cause.** The pane builds the safekeeping line twice. `healthLines()` (`scripts/board/health.js:244`) adds "Safekeeping: …" as a watch line, flagged `safekeeping: true`. `scripts/desk/mod-pane.js:265-269` copies every watch line into the pane's `health` and drops the flag. Then `mod-pane.js:272-276` reads the safekeeping status again for the pane's own Safekeeping row, the one with Details. `hooks/mod/pane.tsx` draws both. The briefing already leaves the flagged line out (`scripts/briefing/model.js:306`). The pane never got the same guard.

**Fix.** Filter `l.safekeeping !== true` in `mod-pane.js`'s health lines, keeping the richer row with Details. Apply the same filter to `healthNote.allWell` (`mod-pane.js:285`), so the pane reads "All well" exactly when the briefing would. *Designer's call*, and it matches the briefing. A test in `tests/scripts/mod/status.test.js` writes a watch-level safekeeping status and checks that `health` holds no "Safekeeping:" line while `safekeeping` still holds the row.

## 9. To verify on a real build

Each of these is checked at the Mac sitting, before the part that leans on it is called done:

1. A PreToolUse **deny** on AskUserQuestion, in the desktop Code tab and on the phone, shows the director nothing and lets the turn carry on with the reason.
2. What **Skip** returns to the model, and whether it ends the turn. If Skip also stops the session, the toast in section 6.1 drops its mention of Skip.
3. Whether `ui.render` runs while the pane is closed or hidden (section 4.2).
4. `$.session.append` on the current desktop build: a `system` row shows in the chat as a notice, on the desktop and on the phone, and starts no turn; a `user` row reaches the model at its next request and isn't shown as typed. The engine types read on 1 November 2026 say so, and they have to be checked on the build in use. If the notice doesn't show, the fallback in section 4.4 is all there is, and the director is told so.
5. The Esc tool result's exact words, so the board-context hook's match on a stopped question is right. Today they are "The user doesn't want to proceed with this tool use" and "[Request interrupted by user for tool use]". The match also accepts an `is_error` tool result on AskUserQuestion with no answers.

### 9.1 If a check fails

- **The deny doesn't behave (item 1).** The live-pane deny sits behind one constant and is shipped off. The design then falls back to D1's second option: both places, kept in step by section 6.1. That's why section 6.1 is built whatever D1's answer is: it's the safety net for the race, and the fallback if the deny can't be used.
- **No draw signal (item 3).** Liveness goes by the tick alone. The chat's line always ends by saying the director can have the cards here instead, so a closed pane is never a dead end.

## 10. Decided by the director (4 November 2026)

**D1. Where cards are answered while the panel is open: in the panel only.** In the director's words: "Chat shows in panel. Also text asks here in chat but the answer from panel should reflect here in chat right?" So cards go to the panel, and the chat says in one line that they're there. When the chat speaks of a card, the panel's answer shows in the chat: the First Mate's next words state it, and it never asks again (section 4.4).

**D2. When the chat hears of a panel answer: the next time the director writes.** No extra turn per press.

**The chat is the main medium** (the director's clarification, 4 November 2026): the panel is the only place they click, every click is reflected in the chat, and typing an answer in the chat still counts (section 4). With that came the finding that the mod can add a line to the chat with no turn (`$.session.append`), so a panel answer now shows in the chat at once, and D2's next-time line is the fallback (section 4.4).

**Copilot,** which the director asked about: until its VS Code panel marks itself live, cards stay in the chat, and the decided-card check stops a repeat (section 7).

The alternatives set aside were both places kept in step (the chat's copy is left open after a panel answer), the chat alone while it asks, and a First Mate turn at once for each press. Section 6.1 is still built, as the safety net for the race and the fallback in section 9.1.

## 11. Out of scope

- **Approved work that didn't start** ("queued, not started yet"). The session couldn't take Wheelhouse's lock, because an old 0.2.2 helper was still running. That is known and handled elsewhere.
- The `/wheelhouse:update` command and the status line are being changed in other sessions. Nothing here touches them.

## 12. What changes, by file

| File | Change |
|---|---|
| `hooks/mod/cards.tsx` | After a recorded deciding press, `$.session.append` the notice and the hidden line (section 4.4), with the words the bridge's press answer gives |
| `scripts/mod/press.js` | Its answer gains `notice` and `note`, the two lines' words |
| `hooks/mod/pane.tsx`, `hooks/register.ts` | Keep when `ui.render` last drew. Send `drawn` with each tick. Mark a card "Also open in the chat" from the model. Show the toast in section 6.1 |
| `scripts/mod/bridge.js` | Write `sessions/<id>/pane.json` on each tick. Put the open-in-chat card ids into the pane's model |
| `scripts/desk/mod-pane.js` | The safekeeping filter (section 8). Add `openInChat` to a card |
| `scripts/hooks/card-check.js` | The decided-card deny (section 5) and the live-pane deny (section 4.3), each with the First Mate's reason. Honour `here.json`. Write `open.json` |
| `scripts/hooks/prompt-record.js` | Clear `open.json` after a click |
| `scripts/hooks/board-context.js` | The "since your last turn" line (section 4.4) and the stopped-question line (section 6). Clear `open.json` |
| `scripts/frontdesk/cli.js` | `--here` on `cards`, `again` and `pull-cards`. `card` refuses a decided decision. `views waiting` lists recent answers |
| `scripts/lib/paths.js` | The session folder's three file names |
| `skills/front-desk/SKILL.md` | The panel line. "Ask me here". A stopped question is no answer. The pane-press lines that end in "call your clickable-question tool" (Why?, Show me) are asked only when no live pane is there, and otherwise end on the one line |
| `skills/setup/SKILL.md` | A stopped question is no answer |
| `adapters/copilot/hooks.js` | The decided-card check, as a conditional task: only if its PreToolUse reaches `ask_user` today. Its PostToolUse still waits on a sitting. Otherwise nothing changes there (section 7) |
| `docs/specs/2026-10-17-wheelhouse-design.md` | Sections 23.3 and 23.4 gain the one-place rule, and section 22 gains the director's rulings of 4 November 2026 (section 10) |

**Tests**, beside each: a live and a stale `pane.json`; the deny for a pane card, a setup card going through, and a mixed call; `here.json` letting cards through once; the decided-card deny naming the answer; `card`'s refusal at the same hash; `views waiting`'s recent answers; the notice and the hidden line appended after a deciding press, none after a Show me, and the next-time line left out when the hidden line is in the tail; the stopped-question line from a transcript tail holding the 4 November tool result; no record on a stopped question; the safekeeping line once. Run the test files touched, and leave the whole suite to CI.

## 13. The designer's calls, marked

- The 45-second live window (the pane's own staleness rule).
- The `here.json` way out and its two-minute limit.
- The file names under `sessions/<id>/`.
- The safekeeping filter on `allWell`.
- Telling the director once that Esc stops the First Mate.
- "Decided in the last hour" as the window for `views waiting`.
