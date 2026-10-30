<!-- docs/specs/2026-10-31-pane-design.md -->

# The pane's visual design

31 October 2026. Design notes for the pane's first real design pass, with **the choice of direction left open** for the director. The chosen direction is recorded here, and in section 23 of the design, before it is built.

Calm (design section 23) settled what the pane says and in what order. It was built as far as the drawing kit knew how, and never had a look of its own. The director found the cards "ugly" and hard to read on 20 October 2026. These notes keep Calm's order, words and rules, and change how it looks.

## What the pane shows

Every direction covers the same states, drawn from the same pane model (`scripts/desk/mod-pane.js`):

| State | What it holds |
|---|---|
| First reading, or no pane here | One line: reading, setup still running, or the First Mate's chat |
| Calm | The verdict, what is being built, launch, health and this week |
| A card of parts | Kind and place, the question, what it is, the small line, the recommendation, Why? and Show me, the answers, the checking line |
| Why? opened | Why it is the director's, what each choice means, what happens meanwhile |
| A feature's question | Its own options, the recommended one filled |
| Suggest a change… | The box, Send and Cancel |
| Steered | "You suggested a change at 14:10…" |
| Revised | "Approval · revised", with "What changed:" |
| Recording | "Recording…" in place of the button, the rest plain words |
| A card answered elsewhere | No buttons, with the line saying where, or a card still to be made |
| Several cards | The next card's subject, Back and Next |
| All stop on | It leads the pane, with Lift All stop |
| To watch | Health lines at watch or stop level, and what couldn't be read |
| Out of date | The warning line, and no figures in the title |
| Settings | Groups of rows: pop-ups, Change…, values, notes, Done |
| Settings, just changed | "Changed just now" and Undo |

The foot holds Settings and "Updated 14:02". The glance and status line are outside the pane body.

## What the surface can draw

Read from the engine's types and from Desktop's own renderer (the build of 29 October 2026), so these are facts about Desktop and not guesses. They replace several of section 23's assumptions.

**Text.** Five sizes: caption 11px, footnote 12px, body 13px, heading 14px, title 20px. Weights regular, medium, semibold and bold; mono; tabular digits; colour; and wrapping. A Text beside another in a row can break inside a word, because Desktop wraps "anywhere"; `wrap="end"` holds it on one line. This is why "To watch" broke over two lines in check 42.

**Boxes.** Flex layout, spacing steps, and percentage and fractional widths and heights. `backgroundColor` works and takes theme keys, so a filled group that follows light and dark can be drawn. Section 23.6's "the theme has no colour for one" no longer holds:

| Theme key | Desktop draws | Good for |
|---|---|---|
| `composerSidebarBackground` | the raised panel colour | a raised group |
| `selectionBg` | a 10% wash of the blue | a soft emphasis |
| `rate_limit_fill`, `rate_limit_empty` | solid blue and its pale track | a progress bar |
| `diffRemovedDimmed` | a 20% wash of red | All stop's panel |
| `promptBorder` | a stronger line | a thin rule |

**Borders.** A `borderStyle` of `round` draws the theme's quiet line. `borderColor` replaces it. `subtle` is the muted text colour, which is why check 42 saw a full-strength outline. Leaving `borderColor` off gives the quiet one. A border can't be set per side, so a rule is a Box a fraction of a line tall.

**Buttons.** Desktop draws `label` only and ignores a Button's children, so the blue label and the red All stop in `calm.tsx` never show. There are three looks: `primary` (filled), the default (a soft fill with a ring) and `plain` (no chrome, with a hover wash). `plain` with `dimColor` gives a quiet text button at full strength on hover, which suits Why?, Not now, Back, Next and Settings. Check 42's "labels stay plain" is the rule, not a fallback.

**Others.** Link draws in the accent blue. Select draws its own pop-up. Input with `rows` above 1 is a text area, and its `label` sits beside the field and takes its width, so the label belongs on a line above. Svg draws in Desktop, the phone and VS Code but not the terminal. Markdown is left out, because a card's words are never drawn as a heading or a link.

**Elsewhere.** The terminal has one size and draws Box fills as blocks, so every fill, bar and rule is checked there and left out where it reads badly. The phone shows no pane.

## What is wrong today

Rendered with the real mod's drawing, in all the states above, in light and dark:

1. **The card is the only thing with no frame.** The card is the point of the pane, yet Being built, Launch and Health each get an outline and it gets none.
2. **Outlines are too strong and too many,** for the `borderColor` reason above.
3. **The card's parts run together.** The question is 14px against 13px, gaps are 6px, and the recommendation reads as one more sentence.
4. **The buttons come late and in the wrong order.** Why? sits above the answer, and Back and Next come after the checking line.
5. **The pane is long.** A card plus three groups runs to about 1,000px, and the groups repeat their headings in the same voice as their rows.
6. **Rows don't line up.** Names and values run on from each other, in Health and in Settings, and pop-ups start at different places.
7. **Nothing shows progress.** Launch is words, though the bar was designed.
8. **The verdict repeats:** "Nothing needs you. Nothing is broken." and then "Nothing needs you." in green. "Advanced settings" is said twice as well.
9. **Suggest a change…** loses a third of its width to its label.

## The directions

Each is built from the elements above, so each can be made. They are compared in a private page, beside today's pane, in 14 states in light and dark.

### A. Inset

Calm, finished. Each part sits on a raised panel with a quiet line, like a grouped list in iPhone Settings. The card is the first panel, and the recommendation sits in a soft blue band. Group names move above their panels, in the small footnote voice. Rows put the name left and the value right.

The smallest change and the safest. The pane stays about as long as it is today.

### B. One card

The question gets the pane to itself: no panel, the question at title size and what it is at heading size, under a verdict brought down to heading size. Each answer is drawn with its meaning under it ("It goes live within the hour."), so the card can be decided without opening Why?. Being built, Launch and Health fold into one line each, with a count, the launch bar or the health word, and Show. With no card waiting, or with something to watch, they open by themselves.

The easiest to read, and about half the length. It costs one press to see what is being built while a card waits, and adds a small piece of state for what is open. Its verdict and question swap sizes, so it departs furthest from section 23.2's table.

### C. Logbook

An open page with no panels. Thin rules divide the sections, a narrow blue bar marks the card, and figures sit right-aligned in tabular digits. It uses "Usage this week 34%" and "Spend $84" as separate rows, and shortens "Building x" to "x".

The most on screen. It is drier to read, its rules and bar draw only in Desktop, and those figures need small changes to the pane's model.

**The designer's recommendation is B.** The director's complaint was that the card is hard to read, and B answers that directly: the biggest type on the pane is the question, and each answer says what it does. A is the fallback if the director wants everything in view.

## The same in every direction

- The words, the order of a card's parts, and each button's key stay. A press is checked by its words, so no set word moves.
- All stop stays at the top, apart from any filled button.
- One filled button per card.
- The checking line stays whole and word for word, in caption.
- Colours stay theme keys. The keys in the table above join `calm.tsx`'s list.
- No motion of the pane's own. A press still shows "Recording…".
- Small buttons become `plain` and dim, and each Button's dead children go.
- The launch bar is drawn.
- Not a card's words as Markdown, and no literal colours.

## What building it changes in the tests

Words, keys, order and behaviour stay held as they are, and the mod proof (`scripts/mod/validate.js`) keeps reading presses through `filled`, `outlined` and `small`. A dozen or so assertions in `tests/mod/calm.test.ts`, `tests/mod/cards.test.ts` and `tests/mod/settings.test.ts` pin the look itself, and those change on purpose with the design:

- a group's `borderColor` and `padding`;
- the list of theme keys;
- the size of the Text inside a small Button;
- Not now's variant;
- the green "Nothing needs you." line;
- the Input's `label`, which moves to a line above.

B changes more: a folded group's rows aren't drawn while a card waits, and the question's size changes. C needs model changes in `scripts/desk/mod-pane.js` and `desk-parity` fixtures to match.

## After the choice

The director's choice goes here and into section 23, which gains the corrections from "What the surface can draw". Section 23.10's open questions on colour inside buttons are closed by those facts. The build is checked in Desktop itself, in light and dark, before it merges.
