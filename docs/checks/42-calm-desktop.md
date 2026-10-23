<!-- docs/checks/42-calm-desktop.md -->

# Check 42: Calm in Desktop

**Answer:** Partly, on the Mac. The director's verdict: **Calm is good enough to start real use once three faults are put right.** Those three are the one-line Suggest box, an Undo that stays drawn after its minute, and the usage line shown twice. Desktop draws the pane, its cards, its groups and Settings as section 23 means them, in light and dark. Desktop's own buttons keep their own colours, so labels stay plain, Approve is filled with Desktop's main colour (light grey in dark mode, black in light) and STOP's label isn't red. Each of those is the fallback the design already names. Every press recorded what it should. `$.prompt.fill` works. The pane doesn't show on the phone. VoiceOver wasn't tried (the director declined it), and neither was Availability's "no value in force" row.

- **What the director said:** VoiceOver doesn't matter to them. The Suggest box is "a bit weird": past a few words the text runs out of sight. They asked that real use start once the faults are fixed.
- **Three faults before real use:**
  - **The Suggest box is one line.** Past a few words, what the director types runs beyond its width and can't be seen.
  - **Undo after its minute.** Undo is still drawn after the minute is up, because the pane hasn't redrawn. Pressed then, it does nothing and says nothing. Pressed inside the minute, it works.
  - **The usage line is doubled.** "Usage this week: 1% of your weekly allowance." shows twice in Health and this week: once as a line, once dimmed.
- **Put right on 24 October 2026** (on `main` once its pull request merges; the director sees them at their next look in Desktop):
  - **The Suggest box is four lines tall.** A sentence or two stays in sight, and a longer text scrolls inside it. Enter still sends.
  - **Undo leaves when its minute is up.** The pane draws the settings again at that moment, so Undo is gone without anything else redrawing it. If it is pressed late all the same, the toast says "It's too late to undo that. Undo lasts one minute." rather than "There's nothing to undo now", which stays for a setting with no change to undo.
  - **The usage line shows once** in Health and this week: the week's share line, and the usage line only for a pane model that has no week line.
  - Shown by the mod's tests (`npm run mod-check`) and the settings pane's tests; not yet seen in Desktop.
- **Smaller points seen:** the Suggest box doesn't take focus when it opens (the director had to click it). In Health the "To watch" label wraps onto two lines. The foot shows Settings only, with no Board button.

## Question

Does Claude Desktop draw Calm (design section 23) as the design says? Section 23.10 lists what only the real thing can show, and the build added four more:

1. Does a theme colour show inside Desktop's own button, and is Desktop's link colour the tint?
2. What fills the main button?
3. Is the contrast enough in light, dark and higher contrast?
4. Does a group draw its outline and background from `subtle`, and does a `Box` draw the launch bar?
5. Does a screen reader read the pane in order, naming each button?
6. Does the pane show on the phone, without a text box or pop-ups?
7. Does `$.prompt.fill` work in Desktop?
8. How does a Settings pop-up look, and does a pick of the value already in force send nothing?
9. Does the Suggest box take focus, and does Enter in it send?
10. Does a Select with no option picked ever send by itself?
11. Does Not now sit at the card's right?
12. Is STOP's label red inside Desktop's button?

## Tested on

23 October 2026, 12:17 to 12:31 UTC, on macOS 27.0.1 with Claude Desktop 3.6556.2, in the third Mac sitting. The plugin was a copy of `main` at f070089, loaded as a dev mod in a scratch session started from the sitting's own session ("Wheelhouse test project", `probes/mac-sitting/`). The scratch project held six cards, including an approval with a Show me link and the launch figure "3 of 5". The director looked, pressed and sent screenshots. The agent read the pane's records (`check.mjs records`, `settings`, `observer`). Windows: not tried.

## Method

The run sheet, for the director at the Mac, about 15 minutes. The agent sets up a scratch project with an approval card, a feature's question and a settings pane before the director starts, as check 41 did, and reads the results from the pane's records afterwards. Each step says what to look at and what to tell the agent; "Fallback" says what the build does if the answer is no.

1. **Open the pane (1 minute).** In the front desk's chat, type `/wheelhouse`. The pane opens beside the chat with a verdict at the top, one card, and a foot with Board and Settings. Say whether it opened and whether anything is cut off.
2. **Theme colour and links (1 minute).** Look at the small buttons (Why?, Not now, Board, Settings) and at "See the example ↗". Is the label of each a blue tint, or plain text? Is the link blue, or Desktop's usual link look? Fallback: the outline alone marks a button, nothing plain is ever blue, and a link that is not blue still reads as a link by its arrow, or becomes a small outlined button.
3. **The filled button (30 seconds).** Look at Approve. Is it filled with the blue tint, or with Claude's dark colour? Either is fine if it is the only filled button on the card. Fallback: if it is filled with a dark colour, Approve is still the one filled button and stays the main one; say which.
4. **Contrast (2 minutes).** Do steps 2 and 3 again in light, then dark, then with the Mac's Increase contrast turned on (System Settings, Accessibility, Display). Is the blue easy to read on each? Fallback: if it falls short, labels go back to plain text and the outline carries them.
5. **Groups and the launch bar (1 minute).** Scroll to the Launch and Health groups. Does each sit in a rounded, quiet outline? Is there a thin bar for "3 of 5 blockers cleared", or only the words? Fallback: no outline means spacing alone groups; no bar means the count and "+1" stand alone, as built.
6. **Not now and STOP (1 minute).** On a card, is Not now at the right of the header row, level with the card's kind and place? Then look at STOP at the top: is its label red inside the button? Fallback: Not now moves to the foot; a STOP label that is not red keeps its words and its place apart from the filled button.
7. **A screen reader (2 minutes).** Turn on VoiceOver (Command and F5), click into the pane and move through it with Control, Option and the right arrow. Does it read the verdict, the card's question, its line, the buttons by name, and the checking line, in that order? Turn it off. Fallback: report the order it gave; the order of the parts in the file is the design's.
8. **The Suggest box (2 minutes).** Press Suggest a change…. Does the cursor sit in the box at once, or must the director click it? Type a few words and press Enter. Does it send (a toast "Sent to the front desk. A new proposal will follow.")? Press Suggest a change… again, leave the box empty and look at Send: it should be switched off. Fallback: if Enter does nothing the filled Send is the way; if the box does not take focus, a click does.
9. **`$.prompt.fill` (1 minute).** The agent asks the pane to put a few words into the chat's message box. Does Desktop fill it, or refuse? Fallback: the pane's own box is used either way; nothing depends on this.
10. **Settings (2 minutes).** Press Settings. Open the Autonomy pop-up: is it the Mac's own pop-up button? Pick another value: the row should read "Changed just now" with Undo. Open it again and pick the value now in force: nothing should be sent and nothing recorded. Open Availability when it has no value in force (away for a while): there should be no pop-up, only its words and Change…. Open any pop-up and close it without picking: nothing should send by itself. Press Undo. Fallback: a pop-up that draws oddly is reported; picks still work.
11. **The phone (2 minutes).** On the phone (Remote Control), open the pane. Does it show? There should be no text box and no pop-ups: Suggest a change… tells the director to type in the chat, and a Settings row shows its value with "›" and opens its choices on their own page. Fallback: if the pane does not show on the phone, the cards and their reply codes still come through the chat.

The agent then reads the pane's records, checks that every press made in steps 8 and 10 recorded what it should (and nothing for the empty Send, the closed pop-up and the pick of the value in force), and writes the answers into this note.

## Evidence

Step by step, as the method numbers them:

1. **The pane opens:** yes. It opened when the mod loaded, before `/wheelhouse` was typed. It showed a verdict ("Six things need you. Nothing is broken."), a card, the Launch and Health groups, and a foot with Settings. Nothing was cut off at the width the director used. The foot has no Board button.
2. **Theme colour and links:** the small buttons (Why?, Not now, Next, Settings) have plain labels in Desktop's grey button, not a blue tint. "Show me ↗" is blue in both light and dark. *Fallback in force:* the outline marks a button; the link reads as a link.
3. **The filled button:** Approve is filled with Desktop's main colour, light grey with a dark label in dark mode and black with a white label in light, never blue. It is the card's only filled button, so it stays the main one. Lift STOP, under STOP, is filled the same way.
4. **Contrast:** dark and light are both easy to read (screenshots). With Increase contrast on, the director said "Show me" looks the same and stays readable.
5. **Groups and the launch bar:** Launch, Health and this week, and the foot each sit in a rounded outline. Desktop draws it at full strength rather than quiet. There is no bar: Launch shows "3 of 5 blockers cleared" in words only. *Fallback in force:* the count stands alone.
6. **Not now and STOP:** Not now sits at the right of the card's header row, level with "Approval · 1 of 6". STOP's label is plain, not red, in both modes. *Fallback in force:* STOP keeps its words and its place apart from the filled button. Under STOP the pane put a "STOP is on" box at the top with a filled Lift STOP.
7. **VoiceOver:** not tried. The director declined it ("I dont care about voice over").
8. **The Suggest box:** pressing Suggest a change… shows "What would you change?" with a one-line field, and Send and Cancel under it.
   - The cursor isn't in the field: the director had to click it.
   - Enter sent: the card's line became "You suggested a change at 23:23. A new proposal is on its way, and nothing goes live meanwhile." The front desk received "Wheelhouse pane: the director suggested a change on card 1 (id): make the button bigger". The chat shows it as a bubble, with Desktop's own words "The wheelhouse plugin sent a message:".
   - With the field empty, Send is drawn as dim plain words (off).
   - The press recorded one unsigned `card-answer` ("Suggest a change…").
   - **The director's finding:** longer text runs beyond the field's width and can't be seen.
9. **`$.prompt.fill`:** works. `/probe-fill` gave "wheelhouse-observer: probe-fill: filled" (observer log, 12:29:03).
10. **Settings:** Settings replaces the main view, with Done and three groups (STOP, This project, You in every project). Each row is a pop-up button with a chevron, and the director didn't remark on how the menus looked.
    - Picking Cautious in Autonomy showed "Changed just now" and Undo. It recorded a `setting` (autonomy = cautious) and a signed confirmation that verifies (12:25:41).
    - Picking the value in force, and opening Briefing length and closing it without a pick, recorded nothing (no records 12:26 to 12:28).
    - **Undo after its minute:** the director pressed Undo while it was still drawn, a little over a minute after the change. Nothing was recorded and Autonomy stayed Cautious. The likely cause:
      - `justChanged` in `hooks/mod/settings.tsx` decides at draw time, and the pane hadn't redrawn since;
      - the bridge refuses an Undo once `UNDO_MS` is past (`scripts/mod/settings-pane.js`), with no word to the director.
    - **Undo in time:** picking Balanced (12:28:40), Undo (12:28:46, back to Cautious) and Balanced again (12:28:53) each recorded a setting and a signed confirmation that verifies.
    - Availability's "no value in force" row wasn't tried, to save time.
11. **The phone:** the pane doesn't show on the phone (Remote Control). *Fallback in force:* the cards and their reply codes come through the chat.

Also seen: Health and this week shows "Usage this week: 1% of your weekly allowance." twice, once as a line and once dimmed under it. Its "To watch" label wraps onto two lines beside its text.

## What it means for the design

- **Section 23 stands, with its fallbacks in force.** Desktop keeps its own colours in its own buttons. Labels stay plain, the main button takes Desktop's main colour, groups take a full-strength outline, there is no launch bar, and STOP isn't red. Those answers need no change to the pane; section 23 changes only to say what Desktop showed.
- **Before real use (the director's condition):**
  - the Suggest box shows all of what the director types;
  - Undo goes when its minute is up, or says so when pressed late;
  - the usage line shows once.
- **The phone has no pane.** Cards on the phone reach the director through the chat only, as check 4 already has it.
- **Not yet seen:** the screen-reader order and Availability's "no value in force" row. Neither holds up real use.

## Needs the director

The three faults are put right (24 October 2026). What is left is a short look at the Suggest box, Undo after its minute and the Health group in Desktop, which can be folded into the first real use. Windows follows when the director is next at that computer, with check 41's.
