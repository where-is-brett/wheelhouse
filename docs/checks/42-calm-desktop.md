<!-- docs/checks/42-calm-desktop.md -->

# Check 42: Calm in Desktop

**Answer:** Deferred, held for the director's sitting at the Mac. Calm's pane, cards and Settings are built and proved in the test kit (`npm run mod-check`, the mod's tests and the end-to-end run); nothing below has been seen in Desktop yet. Each question has a fallback already built, so none of them holds up real use.

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

Not yet run. The test kit (the mod's own proof and tests) has drawn the pane, the cards and Settings and pressed their buttons, but it cannot show Desktop's colours, its focus or its keyboard, and cannot reach a Select's pop-up or the Enter key in the Suggest box.

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

Nothing seen in Desktop yet. What the test kit does show: the pane's and Settings' models are built with theme keys only (no literal colour), each pressable is one of the four shapes, and a pick raises its own press, which the mod's rule records as a signed confirmation. What the test kit cannot show is the list in the Question.

## What it means for the design

Until the sitting, section 23.10 stands as written with the four added checks. Each answer that is no changes only the fallback named in the step, and each fallback is already what the pane does, so the design's section 23 changes only to say what Desktop showed.

## Needs the director

Yes, a sitting at the Mac, about 15 minutes: the steps above, with the agent at the other end to set up the cards and read the records. Windows follows when the director is next at that computer, with check 41's.
