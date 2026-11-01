<!-- docs/checks/88-blind-card.md -->

# Check 88: a card with no recommended option

**Answer:** Yes on all three surfaces, once the card check's one refusal is lifted. A question card with no recommended option is shown by the chat, the pane and the phone, each took the director's click, and the first option's order was seen in chat. The card check refuses such a card today, on one line. The pane's and the phone's option order was not confirmed by eye (see Evidence), so part 1d need not limit blind cards to the pane, but its tests should pin the order. One mod fault to look at: the pane's press hook ran past its 10 seconds (see Evidence).

## Question

Design note 88 (delegated decisions, D4). About one question card in five goes to the director with no recommendation. The card check requires one. Can the pane, a chat card and the phone each show such a card, take the click and keep the options in their order? If not, part 1d limits blind cards to the pane.

## Tested on

1 November 2026, on the Mac, in a scratch Wheelhouse project made by `probes/mac-sitting` (its own home, a stand-in host; nothing in `~/.wheelhouse`, the installed plugin or the director's settings). The plugin was the copy at `397bb874`, with one local trial change in the scratch copy only: the `names no recommended option` line of `scripts/hooks/card-check.js` switched off. The cards were made by `scripts/cards/compose.js`, then had the recommendation line, the `Recommended:` mark and the card's recommended option taken out.

## Method

- **The card check.** `node probes/88-blind-card/card.js` builds the card and runs it through `cardProblems` and the hook's `decide`, as it stands and then with the trial change.
- **The prompt record.** Read for any use of a recommendation. It has none: it matches a click by the card's text and option labels.
- **Three cards, three surfaces.** Each had a question of its own and two options of its own, with the automatic "Suggest a change…" last: the dashboard card in chat, the price list heading card in the pane, the footer colour card asked in chat and answered on the phone. The director clicked or tapped each; the records come from the scratch home.

## Evidence

| Part | Result | What showed it |
|---|---|---|
| Card check, as it stands | Refuses | `scripts/hooks/card-check.js:93`, "names no recommended option". The reason the model sees: "The director has not seen this card, which is not in the form their cards take. Question 1 ("Question") names no recommended option. Ask each question again exactly as `cli.js card` or `cli.js cards` returns it; do not write or change a card by hand." Nothing else about the card is refused |
| Card check, trial change | Lets it through | The same card gives no problems and the hook returns nothing |
| Prompt record | Takes the click | `prompt-record.js` has no use of a recommendation. A product question has no set line, so it earns no signed record either way, only a `card-answer` |
| Chat | Pass | Shown. Click taken: `card-answer` "Weekly view", 04:57:13 UTC. The director confirmed the order: Weekly view, Daily view, Suggest a change |
| Pane | Pass, order not seen | Click taken: `card-answer` "Prices", 05:07:16 UTC, and the session received "Wheelhouse pane: the director chose "Prices" on card 4". The order Prices, What it costs, Suggest a change comes from the pane's buttons as `check.mjs tick` listed them, not from the director's eye. The look of the card was not reported |
| Phone | Pass, order not stated | The director said the card shows correctly and the tap on Navy worked: `card-answer` "Navy", 05:09:49 UTC, and the test session reported the answer as Navy. The order was not stated beyond "shows correctly" |
| Pane press hook | Ran too long | At 05:07:26 UTC, ten seconds after the pane press of "Prices", the test session was told "wheelhouse: ui.press hook skipped: ran past its 10s budget". Nothing was lost that shows: the answer was recorded at 05:07:16 and the session got the pane message. What the skipped hook would have done after that was not seen. Whether an ordinary card's press is as slow was not tried; the scratch helper and stand-in host may be the cause |

## What it means for the design

Part 1d can show blind cards on the pane, in chat and on the phone. The change it needs is the card check's: accept zero recommended options when the card is marked blind, and keep refusing two or more. The press hook's ten seconds is for the main session to weigh; no mod change was made here.

## Needs the director

Nothing more. The director's clicks are in the evidence. The scratch project is in the system's temporary folder.
