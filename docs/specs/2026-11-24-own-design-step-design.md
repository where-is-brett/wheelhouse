<!-- docs/specs/2026-11-24-own-design-step-design.md -->

# A feature design step that Wheelhouse owns: design (24 November 2026)

**Status:** for the director's calls in section 8. Nothing is built yet.

## 1. The fault

At the rehearsal on the work laptop on 24 November 2026 (fault 19), the feature design step:

- ran on the director's own Superpowers plugin, which Wheelhouse doesn't ship to that chat;
- asked the director no questions;
- ended on an approval card that said "the design you shaped" (the director shaped nothing), didn't show the design, said "Nothing is built until you approve" on top of two other lines that say the same, and showed a broken character in "Suggest a change…".

## 2. How the step works today

**Where Superpowers comes in.** The First Mate has no design step of its own. It borrows `superpowers:brainstorming` from three places:

- `skills/intake/SKILL.md`, route 9: "any `true` is a feature: design it with `superpowers:brainstorming`", and later "When brainstorming says to invoke `superpowers:writing-plans`, stop", with a red-flag row on the same.
- `skills/front-desk/SKILL.md`, the overview: "When you start `superpowers:brainstorming` and the request already answers its questions, skip brainstorming's questions…". This line is why no question was asked: the model judged the request answered them all.
- `adapters/copilot/first-mate/agents/wheelhouse-first-mate.agent.md`, built from the front desk playbook, carries the same line into Copilot.

In Claude Code, setup installs Superpowers as a pin (`.claude-plugin/marketplace.json`, `scripts/setup/project-files.js`). In Copilot, only the background sessions get kept copies of its skills (`scripts/agents/copilot/kits.js`); the director's own chat gets none, so the step ran on whatever the director had installed. Brainstorming is also written for a developer: many questions one at a time in plain chat, a spec under `docs/superpowers/specs/`, a commit, and a review in chat. Most of that the front desk has to switch off line by line.

**Where the card's words come from.** `approveWorkInput` in `scripts/frontdesk/cli.js`:

- `why` for a feature: "It is built from the design you shaped, so it starts only once you approve it."
- `because` for a feature: "it is the design you shaped, and you'll see the result before it goes live".
- `meanwhile`, every lane: "Nothing is built until you approve."
- Approve's `says`: "Wheelhouse builds it and tests it, then shows you the result. It only goes into your product when you say yes to that."

So a feature card says three times that building waits for the click. The question, "Approve this work as written?", comes from `ASKS` in `scripts/cards/compose.js`. The buttons after Approve (Suggest a change…, Show me, Not now) are `USUAL_AFTER` there; the label `Suggest a change…` is `SUGGEST` in `scripts/lib/calm-words.js`, with U+2026 as its last character. Show me on this card has nothing behind it: the playbook's Show me runs `preview <n>`, which is for pull requests.

## 3. Wheelhouse's own design skill

Wheelhouse ships a small skill, `skills/design/SKILL.md` (`wheelhouse:design`; `wheelhouse-design` in Copilot), and stops naming `superpowers:brainstorming` anywhere in the First Mate's playbooks. Superpowers stays for the build sessions (plans, test-driven development, review), where it is pinned or kept.

The skill, in order:

1. **Read.** The request, the project's README and the parts of the code it touches. Anything the code answers is never asked.
2. **Shape.** Two or three ways to build it, and the one to recommend.
3. **Ask** (section 4). One to three `question` cards, asked together in one call.
4. **Write** the design at `.wheelhouse/work/<id>.md`, in this shape:
   - `## For the director`: at most 250 words, under four plain headings: *What you get*, *What it won't do*, *How you'll see it* (the slices in plain words, and the demo), *Calls I made for you* (one line each).
   - `## How it works`: for the builders, technical.
   - `## Tests`: the checks each slice must pass.
   - the `wheelhouse-facts` and `wheelhouse-slices` blocks, as today.
5. **Record** it with `record work` in the feature lane, print the summary it gives (section 5) as a message of its own, then ask the approval card it gives.

It never writes a plan, code or a commit, never asks in plain text, and never writes under `docs/`.

## 4. The questions

Few, and always at least one:

1. **First version** (always asked). What the first version holds: the recommended scope, a smaller one and a larger one, each in a line. It is the call with the most effect on cost and time, and only the director can make it.
2. **Demo** (only with three slices or more). See it working half way, or only at the end. It fills the slices block's `demo`.
3. **One open product call** (only when the request leaves one). The single choice the director would notice most, such as where a new page sits.

Each is a `question` card with `proposal: true`, topic `design-<work id>`, three options at most, and a recommendation. A design card is never decided at level 2: each is the first of its kind for that work. When the director's words already pick an option, the card carries them as `said`, as cards do now.

## 5. How the design reaches the director

A card holds 1,200 characters of plain lines, too few for a design. So the design goes **beside the card**: a message of its own, sent just before it, with a link to the whole file.

- **The summary.** `record work` for a feature prints `show`: the design's "For the director" section, word for word, then the line `The whole design: [<id>.md](.wheelhouse/work/<id>.md)`. A new command, `show <work id>`, prints the same for any recorded work (a small or bug lane's brief, the same way). The First Mate prints it word for word, as it does a decision.
- **Show me** on an approval card for work runs `show <work id>`, then asks the card again.
- **Refusals.** `record work` refuses a feature design with no "For the director" section, or one over 250 words, as it refuses one with no slices block.

| Chat | What it can render | Chosen |
|---|---|---|
| Claude Desktop (Claude Code) | A reply renders Markdown: headings, lists, links. The card (`AskUserQuestion`) shows its question as plain lines and its options with a description; an option's `preview` shows as a fixed-width box, made for code, not a page of prose. | **Beside it.** The summary as a Markdown message just above the card, with the link. The summary carries all the director needs, so nothing depends on the link opening. |
| Copilot chat (VS Code) | A reply renders Markdown, and a link to a workspace file opens it in an editor tab. The card (`askQuestions`) shows its question and options; how it renders Markdown inside the question is untested. | **Beside it.** The same message above the card; the link opens the whole design in the editor. |

Not on the card, because of the 1,200 characters and because Copilot's card rendering is untested. Not as a link alone, because the director would have to leave the chat to see what they approve. Not in a window of its own: the director has ruled out Wheelhouse's pop-up windows.

## 6. The card's words

For every lane, the card says once that building waits for the click, in the Approve option:

| Part | Feature | Other lanes |
|---|---|---|
| Question | Approve this design? | Approve this work as written? (as now) |
| what | Work `<id>`: `<title>`. (as now) | as now |
| why | It is a new feature, so its design comes to you first. It is in the message above. | as now, without "before it is built" where the Approve option says it |
| Approve says | Wheelhouse builds it in slices and tests each one, then shows you the result. It goes into your product only when you say yes to that. | as now |
| because | you'll see it working before it goes live | as now |
| meanwhile | Other work carries on. | Other work carries on. |

"The design you shaped" goes everywhere. The playbook's model `because` ("it is a small change and you'll see it before it goes live") stays.

**The broken character.** The label is `Suggest a change…`. The likely cause is the Windows shell reading the command's output in the old console code page, so `…` (three bytes in UTF-8) reaches the model as three wrong characters. The build first confirms this from the laptop's transcript. The fix is at the source: every Wheelhouse command prints its JSON with each character outside ASCII written as `\uXXXX`, which the model reads back as the character, so no code page can break it. If the transcript shows the break is in Copilot's own card instead, the label loses its `…` everywhere (decision 3).

## 7. Tests

Test-first, each file run on its own:

- `tests/skills/design.test.js` (new): the skill exists with its path comment; it names no `superpowers:` skill; it asks one to three cards, never in plain text; it names the four headings, the 250-word limit, `record work` and printing `show` before the card.
- `tests/skills/intake.test.js`, `tests/skills/front-desk.test.js`: neither playbook names `superpowers:brainstorming` or `superpowers:writing-plans`; route 9 names `wheelhouse:design`.
- `tests/scripts/agents/copilot/first-mate.test.js`: the built agent names `wheelhouse-design` and no `superpowers:` skill; the built folder matches the playbook.
- The front desk's `record` and `show` tests: a feature design with no "For the director" section, or over 250 words, is refused; `record work` for a feature prints `show`; `show <id>` prints the section then the link line, and refuses an unknown work.
- `tests/scripts/cards/compose.test.js` and the front desk's approve-work tests: a feature card asks "Approve this design?"; no card says "you shaped"; no card says twice that nothing is built before the click; `meanwhile` is "Other work carries on.".
- The encoding test: every card command's output is ASCII only, parses back to the same labels, and reads the same after a Windows code-page decode.
- An evaluation scenario in `scripts/eval/front-desk.js`: a feature request gets one to three design cards, the summary before the approval card, and no Superpowers skill loaded.
- Before the next sitting: render the summary and the card on the exact Desktop and Copilot paths, as the sittings require.

## 8. For the director

**Decision 1: Wheelhouse's own design skill**
- *What this is:* the step that turns a feature request into a design now borrows another project's tool, which isn't there in Copilot and is made for developers.
- *Why it comes to you:* it changes how every feature starts.
- *Options:* **Ship a small design skill of Wheelhouse's own** (recommended: the same step in both chats, written for you, with Superpowers kept for the building); **Fold the steps into the First Mate's playbook** (one file fewer, but a long playbook grows longer); **Keep Superpowers and install it in Copilot too** (least work now, but the step stays written for developers).
- *Meanwhile:* features keep using today's step.

**Decision 2: How many questions a design asks**
- *What this is:* today's step asked you nothing.
- *Why it comes to you:* it is your time against your control over what is built.
- *Options:* **Always the first-version question, at most three in all** (recommended: you always choose the scope; the demo and one product call only when they matter); **Only when something is unclear** (fewest clicks, but today's fault can come back); **Up to five** (more say, more clicks).
- *Meanwhile:* nothing changes until the build.

**Decision 3: The "…" in Suggest a change…**
- *What this is:* the label showed a broken character on the laptop.
- *Why it comes to you:* it is a word on every card you see.
- *Options:* **Keep the "…" and stop the break at its source** (recommended: the same label in both chats, and the same fix protects every other word with an accent or a dash); **Drop the "…" everywhere** (a sure fix for this label only).
- *Meanwhile:* the label stays as it is.

**Decision 4: Where you see the design**
- *What this is:* the approval card can't hold a design.
- *Why it comes to you:* it is what you read before you approve.
- *Options:* **A short summary just above the card, with a link to the whole design** (recommended: you read it in the chat in both Desktop and Copilot, and Show me brings it back); **A link on the card only** (shorter chat, but you leave the chat to read it).
- *Meanwhile:* the card shows no design until the build.
