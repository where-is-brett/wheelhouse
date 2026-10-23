<!-- docs/superpowers/plans/2026-10-21-wheelhouse-calm-interface.md -->

# Wheelhouse's Calm interface: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Calm interface the director chose on 20 October 2026: cards made of parts, drawn in the pane with one tint and four button shapes, two buttons a card, Why? in place, Suggest a change… everywhere, Settings as a grouped list with pop-ups and Undo, and the same verdict and words on the board, the briefing, `/digest`, setup and notifications.

**Architecture:** The composer (`scripts/cards/compose.js`) gives each card's parts as well as its text, and keeps the parts in the card event. The chat's text is built from the parts in section 23.4's order, without part labels, and the card check reads that form. The bridge's model (`scripts/mod/status.js`) sends each card's parts and its buttons by shape, never one text to draw, and the mod (`hooks/mod/`) draws them with theme keys and type sizes only. Every rule stays in `scripts/`; the mod draws, keeps time and relays. Two new pane presses go through the bridge under the origin `pane`: Why? (a quiet note for learning, opening in place) and Suggest a change… (the director's words handed to the front desk, never an answer). A pick in a Settings pop-up raises `ui.select`, and goes through the same press code as a button.

**Tech Stack:** Node.js 22 or later, ESM, `node:test`, no npm dependencies, for every script and test. The mod is TypeScript and TSX against Claude Code 2.1.299's mod types, tested by `claude plugin test .` and proved by `npm run mod-check`.

**Spec:** `docs/specs/2026-10-17-wheelhouse-design.md`, section 23 (all of it), with sections 5.3, 5.5, 13, 14 and 17.1, which point to it. The design handover is `interface-design-surfaces.md` in the command centre's shared notes folder (outside the repository); its facts about the mod's elements are repeated where a task needs them.

## Scope

Every row of section 23.9's table. Not in this plan: anything section 23.11 set aside; budget allocation (in the backlog); a picture of a switch (section 23.6 says none is drawn); the evaluation's real runs (`npm run eval`), which cost real sessions and are left for the evaluation plan, though scenario 36's files are changed here so the next run tests Calm.

## How each part runs

- **Three parts.** Part 1 is the cards' model and the presses (Tasks 1 to 7). Part 2 is the pane's drawing and Settings (Tasks 8 to 13). Part 3 is the words everywhere else, the playbooks, the evaluation's files, the end-to-end test and the design brought up to date (Tasks 14 to 21). A part may run in one session with the next where the session has room; otherwise it ends with its handover note in the shared notes folder and stops.
- **Task model.** Every task is written to run on the everyday task model: files, names, test names and commands are spelled out.
- **Safety review.** A task marked **Safety: yes** touches STOP, approvals, the prompt record, the card check, signing, or a card that carries an approval. Its review is a safety review: the stronger review model at medium effort, never high. Other tasks get the usual task review on the everyday model.
- **Ledger.** `.superpowers/sdd/2026-10-21-wheelhouse-calm-interface/progress.md` (git-ignored), one line per task and per ruling (C1 onwards).
- **Merges** go through the command centre with the director's yes. No part pushes.
- **The Mac sitting.** What only the director's eyes can settle (section 23.10) goes into one run sheet, `docs/checks/42-calm-desktop.md`'s steps, written in Task 21. None of it blocks a task: each item has its fallback built in.
- **Clashes.** Copilot's Part 3 edits `skills/front-desk/SKILL.md`, `skills/intake/SKILL.md`, `skills/setup/SKILL.md` and some hooks at the same time. This plan changes those playbooks only in Task 19, by the fewest lines the design needs, each listed in the done note.

## Where this plan builds on built code

Everything named here is on `main` at de206c6.

| What | Where |
|---|---|
| The composer: `composeCard`, `answerInput`, `PART_LABELS`, `HEADERS`, `DECIDING`, `NO_REPLY_CODE`, `whatProblem` | `scripts/cards/compose.js` |
| The card check: `cardProblems(question)`, `decide` | `scripts/hooks/card-check.js` |
| Labels a click never answers with: `PUT_OFF`, `KEEP_AS_IS`, `CARD` limits | `scripts/lib/front-desk.js` |
| The prompt record: `SIGNED_LABELS`, `earned`, `keepEarned`, `sendKept` | `scripts/hooks/prompt-record.js` |
| Card answers that aren't answers: `NOT_AN_ANSWER` | `scripts/state/events.js` |
| The waiting view and `explained` times | `scripts/state/views.js` (around line 187) |
| Learning from Explain more | `scripts/frontdesk/learning.js` |
| The front desk's command (`card`, `cards`, `again`, `views`, `explain`, `preview`) | `scripts/frontdesk/cli.js` |
| The pane's model: `paneModel`, `hashOf`, `cardTextOf`, `writePaneStatus` | `scripts/mod/status.js` |
| A card's buttons: `cardButtons`, `kindOf`, `CANT_ANSWER` and the setup, trust and uninstall notes | `scripts/mod/buttons.js` |
| A press on a card: `pressCard`, `SAYS`, `promptOf` | `scripts/mod/press.js` |
| Reply codes and the shared claim: `claim`, `viewsNow`, `CLICK_ONLY_LABELS` | `scripts/mod/reply.js` |
| The bridge's commands (`COMMANDS`, `lineOf`) | `scripts/mod/bridge.js` |
| Settings rows and presses: `settingsRows`, `choiceOf`, `pressSetting`, `SAYS`, `PANE`, `LEVEL_WORDS` | `scripts/mod/settings-pane.js` |
| The catalogue's labels | `scripts/settings/catalogue.js` |
| The proof: `paneOrigin` and the allowed and forbidden lists | `scripts/mod/validate.js` |
| The mod: pane, cards, settings, messages, numbers, ask | `hooks/mod/*.ts(x)`, `hooks/register.ts`, `types/index.d.ts` |
| The mod's tests | `tests/mod/*.test.ts` (`claude plugin test .`) |
| The board, the glance and the briefing | `scripts/board/render.js` (`glanceLine`, `GLANCE_CHARS`), `scripts/board/model.js` (launch: `resolved`, `total`, `blockers`, `next`), `scripts/briefing/model.js`, `scripts/briefing/text.js`, `scripts/mod/digest.js`, `scripts/statusline.js` |
| The courier's wake words | `scripts/mod/courier.js` |
| Setup's step words and health check | `scripts/setup/steps.js`, `scripts/setup/health.js`, `scripts/setup/notify.js` |
| The preview address | `scripts/host/helper-client.js` (`preview`, route `/pr/preview`) |
| Scenario 36 | `tests/eval/mod/36-pane-explain.js`, `tests/scripts/eval/scenarios-36-37.test.js` |

## The mod's elements, as Claude Code 2.1.299 types them

Read from the types that ship with the plugin-authoring skill (`types/claude-code.d.ts`); a task that needs more greps that file.

- `$.ui.resolve(e)` gives the surface's table. `e.surface` is `terminal`, `desktop`, `vscode` or `mobile`. Desktop and the terminal have `Box`, `Text`, `Button`, `Input`, `Select`, `Link`, `Code`, `Markdown`; **mobile has no `Input` or `Select`**.
- `Text`: `size` (`caption`, `footnote`, `body`, `heading`, `title`), `weight` (`regular` to `bold`), `mono`, `color` (a theme key), `dimColor`, `wrap`.
- `Box`: flex layout, `gap`, `padding`, `margin` in steps (`xs` to `xl`), `borderStyle` (`round` and others) with `borderColor` (a theme key), no one-sided border.
- `Button`: `key`, `label` or children of strings and `Text` (so a label can be `<Text color="suggestion">`), `variant` (`primary` or `secondary`), `dimColor`, `onPress`. Desktop draws every Button natively. `role="dismiss"` closes the whole pane, so it is never used for a card.
- `Link`: `href` (on a remote surface only `https:` draws as a link), `label`.
- `Input`: `key`, `label`, `placeholder`, `value`, `submitLabel`, `autoFocus`, `onInput(value)`, `onSubmit(value)`; a change or Enter raises `ui.input`.
- `Select`: `key`, `label`, `options: { value, label? }[]` (at least one, values unique), `value`, `onSelect(value)`; a pick raises `ui.select`, not `ui.press`.

## Global Constraints

Everything in the earlier plans' Global Constraints holds: Node.js 22 or later; no npm dependencies; ESM `.js`; `node:test` in `tests/**/*.test.js`; macOS and Windows; the path comment on every file; British English; dates as "21 October 2026"; times in 24 hours; no model identifiers anywhere and no `Co-Authored-By` line; every test with a home of its own (never the real `~/.wheelhouse`) and stand-ins for `gh` and `glab` first on the PATH. In addition:

- **Theme keys only.** The mod never writes a literal colour. The keys, each for one meaning: `text`, `dimColor` for secondary words, `subtle` for a group's outline and a quiet button, `suggestion` for **everything pressable and nothing else**, `error` for STOP, `warning` for to watch and out of date, `success` for all well.
- **Five type styles.** `title` semibold (the verdict, "STOP is on", a page's name); `heading` semibold (a card's question, a group's one fact); `body`; `footnote` dim; `caption` `mono` dim (the checking line and the reply code only). No capitals for emphasis; labels in sentence case.
- **Four shapes.** Filled: `Button variant="primary"`. Outlined: `variant="secondary"` with its label as `<Text color="suggestion">`. Small outlined: the same with the label at `size="footnote"`. Link: `Link` whose label ends " ↗". STOP: `variant="secondary"` with its label in `color="error"`, alone at the top, never beside a filled button.
- **Set words** (section 23.7) live once, in `scripts/lib/calm-words.js` (Task 1), and the mod's copies in `hooks/mod/numbers.ts`, kept in step by `tests/scripts/mod/validate.test.js`. Tests hold every one.
- **Words steer, never approve.** "Suggest a change…" is in `PUT_OFF`, so no click, press, reply or prompt carrying it signs anything; the director's typed words are never stored in state and never count as an answer.

## Decisions for the director

None: every choice follows section 23, or is a plan's call listed at the end. What only the director's eyes can settle is the run sheet of Task 21.

---

## Part 1: the cards' model and the presses

### Task 1: The set words and the labels a click never answers with

**Safety: yes** (what a click can answer with)

**Files:**
- Create: `scripts/lib/calm-words.js`, `tests/scripts/lib/calm-words.test.js`
- Modify: `scripts/lib/front-desk.js`, `scripts/state/events.js` (`NOT_AN_ANSWER`), `tests/scripts/state/events.test.js`

**Interfaces:**
- Produces, in `calm-words.js`: `SUGGEST = 'Suggest a change…'`; `WHY = 'Why?'`; `HIDE_WHY = 'Hide why'`; `SHOW_ME = 'Show me'`; `NOT_NOW = 'Not now'`; `TO_KNOW_MORE = 'To know more, just ask.'`; `SUGGEST_SAYS = 'Tell me what you\'d change; I\'ll come back with a new proposal.'`; `WHAT_WOULD_YOU_CHANGE = 'What would you change?'`; `SENT_TO_FRONT_DESK = 'Sent to the front desk. A new proposal will follow.'`; `suggestedAt(hhmm) -> 'You suggested a change at 14:10. A new proposal is on its way, and nothing goes live meanwhile.'`; `typeYourChange(n) -> 'Type your change in the chat, and I\'ll know it\'s about card 1.'`; `RECORDING = 'Recording…'`; `NOT_HANDED = 'That didn\'t reach the front desk. Type it in the chat instead.'`; `SETTING_UP = 'Setup is still running. This pane opens when it finishes.'`; `NOT_HERE = 'This pane lives in the front desk\'s chat. Type /wheelhouse there.'`; `SETTINGS_UNDER_STOP = 'Settings can\'t change while STOP is on. Lift STOP first.'`; `staleLine(failedAt, shownAt) -> 'Couldn\'t read the latest at 14:05. Showing 14:02\'s.'`; `NOTHING_NEEDS_YOU = 'Nothing needs you.'`; `CHANGED_WHILE_READING = 'That card changed while you were reading. Here is the new one.'`; `STOP_HALTS = 'Halts every builder at once.'`; `ONLY_YOU_LIFT = 'Only you can lift it.'`; `verdict({ waiting, broken }) -> string` ("Nothing needs you." / "One thing needs you." / "Two things need you." … "Nine things need you." / "12 things need you.", then " Nothing is broken." when `broken` is 0, else " One thing is broken." / " 2 things are broken."); `sinceLine(hhmm) -> 'Since you were last here at 09:10.'`.
- Changes `PUT_OFF` to `['Not now', 'Explain more', 'Show me', 'Why?', 'Suggest a change…']` (Explain more stays, so an old card's click still never signs). `NOT_AN_ANSWER` adds `'Why?'` and `'Suggest a change…'`.

- [ ] **Step 1: Write the failing tests.**

```js
test('verdict opens with words up to nine and figures after', ...)        // 0, 1, 2, 9, 12; broken 0, 1, 2
test('every set word is one line of British English with no exclamation mark', ...)
test('staleLine and suggestedAt say the times as given', ...)
test('PUT_OFF holds Why? and Suggest a change… and keeps Explain more', ...)
test('a card answer labelled Why? or Suggest a change… is not an answer', ...) // events.test.js
```

- [ ] **Step 2: Run** `node --test --import ./tests/helpers/test-home.js tests/scripts/lib/calm-words.test.js tests/scripts/state/events.test.js`. Expected: FAIL.
- [ ] **Step 3: Implement** the module and the two lists. Every comment says what a thing is.
- [ ] **Step 4: Run** the same command, then `npm test`. Expected: PASS. Any test elsewhere that pinned the old `PUT_OFF` is brought up to date in this task.
- [ ] **Step 5: Commit** `git commit -m "Name the Calm set words once, and never count Why? or Suggest a change… as an answer"`.

### Task 2: The composer gives a card's parts, and the chat's text is built from them

**Safety: yes** (approval cards' text and options)

**Files:**
- Modify: `scripts/cards/compose.js`, `tests/scripts/cards/compose.test.js`, `scripts/setup/rules.js` (its Explain more option), `scripts/lib/trust-clicks.js` (its Explain more), and every other test or fixture `npm test` shows pinning the old card text

**Interfaces:**
- Consumes: Task 1's words.
- New optional inputs to `composeCard`: `ask` (the question as a heading, one line; when absent, a per-kind default: approval "Put pull request #42 live?", confirm "Confirm this?", lift-stop "Lift STOP?", ci-push "Push this change to the checks?", runbook the step's title with "?", approve-work "Approve this work as written?", answer and question the `what`, amend "Change the approved work to this?", lift-incident "End the incident?", incident-fix "Merge this fix?", and setup's kinds their `what`); `size` (a few words, such as "Small feature"); `optional` (whole minutes, for "optional · 3 min"); `revises` (the id of the card a revised proposal replaces) and `changed` (one line, "What changed:"'s sentence; needed whenever `revises` is given).
- `composeCard` returns `{ question, card }` as before, and `card.parts`:
  `{ kind, header, ask, small, recommendation, options: [{ label, says, recommended }], why, meanwhile, checks?, changed?, line, code, optional?, revises? }`, where `small` is `[size, why].filter(Boolean).join(' · ')`, `recommendation` is `"<recommend>, because <because>."`, and `options` are in section 23.4's order. `card.revises` is kept beside the parts.
- **The options** (section 23.4 and 5.3):
  - A card that decides something: its deciding label, then `Suggest a change…`, then `Show me` (or `Keep as is` for a proposal), then `Not now`. Explain more is never offered.
  - Not offered Suggest a change… (plan's call 1): `lift-stop` (STOP is lifted or it isn't) and the kinds answered only in setup's or the session start's own chat, `setup`, `confirm-all`, `baseline`, `trust` and `uninstall`. Their lists lose Explain more: `confirm-all` is deciding, Correct some, Not now; `trust` and `uninstall` deciding, Not now; `baseline` Not now as now.
  - An answer or product question: up to three of its own options, then `Suggest a change…`; with four of its own, none added, and the question text says "To change it, type what you'd change." in place of `TO_KNOW_MORE`. Its own options may not be named Why? or Suggest a change… (they are put-off labels).
  - Each option's `description` is its `says`; the recommended one's is `Recommended: <says>` with the reason after it: `Recommended: <says without its full stop>, because <because>.`
- **The chat's text** (`question.question`), lines in this order: `ask`; `what`; `why`; `meanwhile`; for level 4 the checks line; for a revised card `What changed: <changed>`; `TO_KNOW_MORE` (or the four-options line); then the set line; then `Reply code: XXXX`. No part labels. `CHECKS_UNSAID` becomes "The build didn't say. Ask me why and I'll find out before you answer."
- `PART_LABELS` is removed. `scripts/frontdesk/cli.js` line 689 reads the first part from `card.parts.what`… the card event keeps `what` in `parts` too (add `what` to `parts`), and falls back to the old labelled line for an old card.
- The text's length limit, the set-line check (`setLineOf(text) === line`) and the baseline-words check stay as they are.

- [ ] **Step 1: Write the failing tests** in `compose.test.js` (replace the old form's tests; keep every refusal test):

```js
test('an approval card offers Approve, Suggest a change…, Show me and Not now, in that order', ...)
test('the recommended option\'s description starts "Recommended:" and carries the reason', ...)
test('the chat text is the question, what, why, meanwhile and "To know more, just ask.", then the set line and the code', ...)
test('no part label appears in the text', ...)
test('a level 4 card carries its checks line before "To know more, just ask."', ...)
test('an answer card with three own options adds Suggest a change…; with four it adds none and says to type a change', ...)
test('an answer card refuses an own option called Why? or Suggest a change…', ...)
test('lift-stop, setup, confirm-all, baseline, trust and uninstall cards offer no Suggest a change…, and none offers Explain more', ...)
test('a proposal offers Keep as is in place of Show me', ...)
test('card.parts holds every part, and rebuilding the text from the parts gives the same text', ...)
test('a revised card needs changed, keeps revises, and says "What changed:"', ...)
test('the default ask for each kind is one line ending in a question mark', ...)
```

- [ ] **Step 2: Run** `node --test --import ./tests/helpers/test-home.js tests/scripts/cards/compose.test.js`. Expected: FAIL.
- [ ] **Step 3: Implement.** Keep `composeCard`'s refusals naming the part. Add `textOf(parts) -> string`, exported, which the composer uses to build the text, so Task 3 and Task 6 build from one function.
- [ ] **Step 4: Run `npm test`.** Expected: the composer's tests pass; Task 3's card check now refuses the new text, so the card-check and front-desk tests that compose then check a card fail. Bring every test that pinned the old text or the old options up to date **except** `tests/scripts/hooks/card-check.test.js`, which Task 3 rewrites. Record the failing list in the ledger.
- [ ] **Step 5: Commit** `git commit -m "Give each card its parts, and build the chat's text from them in Calm's order"`.

### Task 3: The card check reads the new form

**Safety: yes** (the card check)

**Files:**
- Modify: `scripts/hooks/card-check.js`, `tests/scripts/hooks/card-check.test.js`

**Interfaces:**
- `cardProblems(question)` now takes either the question's text (a string) or the AskUserQuestion question object (`{ question, header, options }`); with an object it checks the options too. Each problem is still a clause after "the card".
- The form it checks:
  - The text has at least four lines before its last plain line, and that last plain line is `TO_KNOW_MORE` or the four-options line ("lacks its "To know more, just ask." line").
  - A card with a set line has exactly one, and the reply-code rules as now.
  - **Every plain line together** (all the lines before the set line) is judged by `whatProblem` with `abbreviated: true`, so the words name what the set line names and no other pull request or commit ("has words that must name pull request #42…").
  - With options: exactly one description starts `Recommended:` ("names no recommended option" / "names two recommended options"); and no option is called Explain more.
- `decide` passes the whole question object.

- [ ] **Step 1: Write the failing tests:**

```js
test('a composed card of every kind passes', ...)                    // compose each kind with Task 2's composer
test('a card missing "To know more, just ask." is refused', ...)
test('a card with fewer than four plain lines is refused', ...)
test('a card naming another pull request in any plain line is refused', ...)
test('a card naming another commit in its question line is refused', ...)
test('a card with no option recommended, or two, is refused', ...)
test('a card offering Explain more is refused', ...)
test('the reply-code rules hold as before', ...)                      // keep the existing cases
test('the baseline card is still judged as before', ...)
test('a failure of its own lets the card through', ...)
```

- [ ] **Step 2: Run** `node --test --import ./tests/helpers/test-home.js tests/scripts/hooks/card-check.test.js`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run `npm test`.** Expected: PASS, the list Task 2 recorded now passing.
- [ ] **Step 5: Commit** `git commit -m "Check a card in Calm's form: its plain lines, its one recommendation and no Explain more"`.

### Task 4: The waiting view: steered cards, revised cards, and Why? for learning

**Safety: yes** (what closes a card that carries an approval)

**Files:**
- Modify: `scripts/state/views.js`, `scripts/frontdesk/learning.js`, `tests/scripts/state/views.test.js`, `tests/scripts/frontdesk/learning.test.js`

**Interfaces:**
- A waiting card's entry gains `steered: <time> | null`: the time of its latest card answer labelled `Suggest a change…`. It stays waiting.
- **A revised card closes the one it revises,** once the revised card event is in the state, whatever answer the old one had: the waiting view drops a card whose id a later card's `data.revises` names, when the two cards are of the same kind and, for an approval or CI push, of the same pull request or branch (a revision naming a card of another kind or pull request closes nothing; plan's call 2). Nothing approved before carries over: the revised card has its own set line, so the prompt record and reply codes treat it as new.
- `explained` counts answers labelled `Why?` as well as `Explain more` (section 23.9's learning row), so learning reads a press of Why?, or a why asked in the chat (Task 5), as it read Explain more.

- [ ] **Step 1: Write the failing tests:**

```js
test('a card answered Suggest a change… stays waiting, marked steered at that time', ...)
test('a revised card closes the card it revises', ...)
test('a revision of another kind or another pull request closes nothing', ...)
test('a revised approval card has its own set line, so an approval of the old commit does not decide it', ...)
test('Why? counts as Explain more for a concept known and for plain explanations', ...)  // learning.test.js
```

- [ ] **Step 2: Run** the two test files. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run `npm test`.** Expected: PASS.
- [ ] **Step 5: Commit** `git commit -m "Keep a steered card waiting, close it with its revision, and learn from Why?"`.

### Task 5: The front desk's command: why, and revised cards

**Safety: no**

**Files:**
- Modify: `scripts/frontdesk/cli.js`, `tests/scripts/frontdesk/cli.test.js`

**Interfaces:**
- `card` and `cards` take `revises` and `changed` in their JSON input and pass them to the composer; `revises` must name a card waiting now, or the command refuses ("revises names no waiting card").
- New command `why <n>`: writes card `n`'s answer labelled `Why?` (as Not now writes its answer through the helper, kept in `pending/` when it doesn't take it) and prints one line, "Noted that you asked why about card n." Under STOP it notes nothing and says so. It never prints the card again: the front desk explains, then runs `again <n>`.
- `views waiting` shows each card's `steered` time when it has one.
- The header comment lists `why`.

- [ ] **Step 1: Write the failing tests:**

```js
test('why n notes a Why? answer for card n and prints one line', ...)
test('why n under STOP notes nothing and says so', ...)
test('card with revises and changed composes a revised card; revises naming no waiting card is refused', ...)
test('views waiting shows a steered card\'s time', ...)
```

- [ ] **Step 2: Run** `node --test --import ./tests/helpers/test-home.js tests/scripts/frontdesk/cli.test.js`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run `npm test`.** Expected: PASS.
- [ ] **Step 5: Commit** `git commit -m "Add why to the front desk's command, and let a card revise a waiting one"`.

### Task 6: The pane's model: parts, buttons by shape, the preview link, and the glance's groups

**Safety: yes** (which buttons record on a card that carries an approval)

**Files:**
- Modify: `scripts/mod/buttons.js`, `scripts/mod/status.js`, `types/index.d.ts`, `tests/scripts/mod/buttons.test.js`, `tests/scripts/mod/status.test.js`
- Create: `scripts/mod/previews.js`, `tests/scripts/mod/previews.test.js`

**Interfaces:**
- `cardButtons(card)` returns `{ buttons, note }` where each button is `{ label, does, shape, href? }`; `does` is `record`, `turn`, `why` (opens in place and notes Why?, Task 7) or `suggest` (opens the box, Task 7); `shape` is `filled`, `outlined`, `small` or `link`. `corner: true` marks Not now, drawn in the header row.
  - A card that decides something and passes the check: the deciding label `filled`/`record`; `Suggest a change…` `outlined`/`suggest`; `Not now` `small`/`record`/`corner`; `Why?` `small`/`why`; `Show me` as `link` with `href` when the model has a preview address for it, else `small`/`turn`; `Keep as is` (a proposal) `outlined`/`record`.
  - An answer card: each own option `record`, the recommended one `filled`, the rest `outlined`; `Suggest a change…` `outlined`/`suggest`; `Why?` `small`/`why`; its own Not now (a build-command question) `small`/`record`/`corner`.
  - A card whose form fails the check: only `Why?`, `small`/`turn` (the front desk is asked, since its parts can't be trusted to show).
  - A question with no set line: each own option `turn`, the recommended one `filled`, the rest `outlined`.
  - Setup's, trust, uninstall, baseline and the Unattended cards: no buttons, their notes as now.
  - The check is `cardProblems` on the card's whole question (`{ question, header, options: descriptions }`), and for a card with `parts` also `textOf(parts) === question`: parts that don't build the card's text get only Why? (plan's call 3).
- `paneModel` adds, per card: `parts` (the card's parts with every line made plain by the glossary, the set line and code left word for word; null for an old card with none, which the pane then draws as its text); `steered` (an `HH:MM` in the computer's own time, or null); `waited` ("asked 2 hours ago", from the card event's time); `revised: true` for a card with `revises`. And at the top level:
  - `verdict` (Task 1's `verdict`, with `waiting` the cards and `broken` the health lines at `stop` level other than STOP's own) and `since` (`sinceLine` of the director's last visit, the time the briefing reads as `since`, or null);
  - `launch`: `{ resolved, total, gained, next: [{ text, yours }] } | null` from the board model's launch, null with no blockers; `gained` counts blockers resolved since the last visit;
  - `health`: as now, plus `allWell: true` when no line is at `watch` or `stop`; `protection` (Standard or Locked, as the board says it); `week` (the week's share line, as the briefing's usage line);
  - `ideas`: `{ count, fresh }` from the ideas list, `fresh` those added since the last visit;
  - `building`: each `{ text, see }`, `see` the "You'll see it" words the board's work table has;
  - `updated`: the model's time as `HH:MM`.
- `previews.js`: `previewFor({ project, pr, sha, client, now })` returns a cached `https:` address or null. The cache is `projects/<project>/previews.json`, keyed by pull request and commit, kept ten minutes, an answer of none kept too. At most one helper call per tick, with a 1.5-second limit (`/pr/preview` is read-only and answered under STOP); a slow or failed call counts as none until the next tick. Only an `https:` address is kept. `paneModel` takes `previews` (a function, for tests) and calls it for approval cards only.
- `glanceLine(model)` is Task 14's; `paneModel` keeps using it.

- [ ] **Step 1: Write the failing tests:**

```js
test('an approval card gets Approve filled, Suggest a change… outlined, Not now small in the corner, Why? small and Show me', ...)
test('Show me is a link with the preview address when there is one, else a small button that turns', ...)
test('an answer card\'s recommended option is filled and the others outlined', ...)
test('a card failing the check gets only Why?, which turns', ...)
test('a card whose parts do not build its text gets only Why?', ...)
test('setup, trust, uninstall, baseline and Unattended cards get no buttons', ...)        // keep the existing cases
test('the model carries each card\'s parts in plain words, with its set line and code word for word', ...)
test('the model carries the verdict, the since line, launch, health, ideas, building and updated', ...)
test('a steered card carries its time; a revised card is marked revised', ...)
test('previewFor keeps an https address ten minutes, asks at most once a tick and never waits past 1.5 seconds', ...)
```

- [ ] **Step 2: Run** the three test files. Expected: FAIL.
- [ ] **Step 3: Implement**, and declare the new fields in `types/index.d.ts` (`WheelhouseCardButton` gains `shape`, `href`, `corner`; `WheelhousePaneCard` gains `parts`, `steered`, `waited`, `revised`; the model gains `verdict`, `since`, `launch`, `ideas`, `updated`, and `health` becomes `{ lines, allWell, protection, week }`; keep reading the old `health` list shape for one release where the mod reads a model an older bridge wrote).
- [ ] **Step 4: Run `npm test`.** Expected: PASS.
- [ ] **Step 5: Commit** `git commit -m "Send each card's parts and its buttons by shape, with the preview link and the pane's groups"`.

### Task 7: The presses: Why?, Suggest a change…, and Undo on a setting

**Safety: yes** (presses under the origin `pane`, STOP, and a setting's signed confirmation)

**Files:**
- Modify: `scripts/mod/press.js`, `scripts/mod/bridge.js`, `scripts/mod/settings-pane.js`, `tests/scripts/mod/press.test.js`, `tests/scripts/mod/bridge.test.js`, `tests/scripts/mod/settings-pane.test.js`

**Interfaces:**
- Bridge command `why`, `{ cmd: 'why', origin: 'pane', cwd, card, hash }`: for a waiting card whose hash matches, writes its answer labelled `Why?` (kept in `pending/` when the helper doesn't take it); answers `{ ok: true }` with no `says` (it is quiet: the pane has already opened the reasons). Under STOP, or for a card that changed, it notes nothing and still answers `{ ok: true }`. It never hands a prompt.
- Bridge command `suggest`, `{ cmd: 'suggest', origin: 'pane', cwd, card, hash, words }`:
  - `words` is folded to one line, trimmed and cut at 500 characters; empty words are refused ("Write what you'd change first").
  - For a waiting card whose hash matches: writes its answer labelled `Suggest a change…` (the words are **not** in it), and answers `{ ok: true, says: SENT_TO_FRONT_DESK, submit: ['Wheelhouse pane: the director suggested a change on card <n> (<id>): <words>'] }`.
  - The words are never parsed as a reply code, never signed, never kept in `pending/` or the state; only the prompt carries them.
  - Under STOP the answer isn't noted (the helper refuses plain writes), but the prompt is still handed, since explaining and revising carry on; `says` is still SENT_TO_FRONT_DESK.
  - A card that changed or closed: `{ ok: false, says: CHANGED_WHILE_READING }`, no prompt.
- `pressCard` keeps every rule it has; `Why?` and `Suggest a change…` are refused by `press` itself ("That card doesn't offer that"), since they have their own commands.
- Bridge command `setting` takes `choice: 'undo'`: it sets the value in force before the row's latest change, when that change was confirmed less than `UNDO_MS = 60000` ago (a number in `scripts/lib/mod-numbers.js`), signed and confirmed as any pick is; otherwise "There's nothing to undo now". `settingsRows` gives a row `changed: { at, undo: true }` while that holds. Under STOP every pick, Undo included, records nothing and says `SETTINGS_UNDER_STOP`.
- `SAYS.stopOn` in `settings-pane.js` becomes `SETTINGS_UNDER_STOP`.

- [ ] **Step 1: Write the failing tests:**

```js
test('why notes a Why? answer quietly and hands no prompt', ...)
test('why under STOP notes nothing and still answers ok', ...)
test('suggest hands one prompt naming the card by number and id, with the words on one line, cut at 500', ...)
test('suggest never stores the words: neither the answer nor pending/ holds them', ...)
test('suggest words shaped as a reply code ("K7QD Approve") sign nothing and record no approval', ...)
test('suggest under STOP notes nothing but still hands the prompt', ...)
test('suggest on a card that changed hands nothing and says it changed', ...)
test('suggest with no words is refused', ...)
test('press refuses Why? and Suggest a change…', ...)
test('undo within a minute sets the value before, signed and confirmed', ...)
test('undo after a minute, or with nothing changed, records nothing', ...)
test('undo under STOP records nothing and says Settings can\'t change while STOP is on', ...)
test('a pane origin is the only one the bridge takes for why, suggest and setting', ...)
```

- [ ] **Step 2: Run** the three test files. Expected: FAIL.
- [ ] **Step 3: Implement.** Use `reply.js`'s `claim` for `suggest` as `pressCard` does, so a suggestion and a press at once can't both write.
- [ ] **Step 4: Run `npm test`.** Expected: PASS.
- [ ] **Step 5: Commit** `git commit -m "Add the Why? and Suggest a change… presses and Undo on a setting"`.

**End of Part 1:** run `npm test` and `npm run mod-check`, write `calm-interface-part-1-done.md` in the shared notes folder if the session stops here.

---

## Part 2: the pane's drawing and Settings

### Task 8: The pane, top to bottom

**Safety: yes** (STOP and Lift STOP)

**Files:**
- Modify: `hooks/mod/pane.tsx`, `hooks/mod/numbers.ts`, `tests/mod/pane.test.ts`, `tests/scripts/mod/validate.test.js` (the words kept in step)
- Create: `hooks/mod/calm.tsx` (the drawing kit), `tests/mod/calm.test.ts`

**Interfaces:**
- `calm.tsx` exports small functions that take the resolved table and draw one Calm piece each, so every file draws alike: `title(t, text)`, `heading(t, text)`, `body(t, text)`, `footnote(t, text)`, `caption(t, text)` (mono, dim), `group(t, children, note?)` (a `Box` with `borderStyle="round"`, `borderColor="subtle"`, padding `sm`, and its note under it in footnote), `filled(t, key, label, onPress)`, `outlined(t, key, label, onPress)`, `small(t, key, label, onPress)`, `link(t, href, label)` (label ends " ↗"), `stop(t, onPress)`, and `status(t, word, level)` (a word in `success`, `warning` or `error` beside its plain words). No other file sets a colour or a size.
- The pane, top to bottom (section 23.3): the stale line, if any, in `warning`; STOP (outlined, red label) with `STOP_HALTS` beside it in footnote, or under STOP the "STOP is on" group: "STOP is on" as a title, since when, what still carries on, the filled Lift STOP and `ONLY_YOU_LIFT`; the verdict as a title, with the since line under it in footnote; the card (Task 9); "Next: <its ask> · optional · 3 min" for the next card, and small Back and Next; "Being built", one row per piece with its state and when the director sees it; "Launch": "3 of 5 blockers cleared", "+1 since 09:10", what's next marking the director's own; "Health and this week": all well in `success` or what to watch in `warning`, the protection level, the week's line, "4 ideas · 1 new since yesterday"; the foot: small Board and Settings, and "Updated 14:02". Each of those parts is a `group`; an empty part is left out. "Nothing needs you." in `success` stands in the card's place when no card waits.
- A thin launch bar is drawn only as text ("3 of 5"); a `Box` bar is left for the Mac sitting (run sheet).
- The words: `RECORDING`, `NOT_HERE`, `SETTING_UP`, `staleLine` from Task 1, copied into `numbers.ts`.

- [ ] **Step 1: Write the failing tests** (`claude plugin test .`, with the engine's mock):

```ts
test('the pane draws STOP outlined with its label in error, and its line beside it', ...)
test('under STOP the pane leads with the STOP is on group and a filled Lift STOP', ...)
test('the verdict is a title, and the since line follows it', ...)
test('Nothing needs you. stands in the card\'s place, in success', ...)
test('each part is a rounded subtle group, and an empty part is left out', ...)
test('no element carries a literal colour', ...)         // walk the tree: every color is a theme key
test('the stale line is in warning and the figures are not shown as current', ...)
test('Back and Next are small, and the next card\'s subject is shown', ...)
```

- [ ] **Step 2: Run** `claude plugin test .`. Expected: FAIL.
- [ ] **Step 3: Implement.** Keep every rule the pane has today: one tick at a time, the pane opening only at the session start and on `/wheelhouse`, a pane the director closed staying closed, buttons live during a turn.
- [ ] **Step 4: Run** `claude plugin test .` and `npm run mod-check`. Expected: PASS.
- [ ] **Step 5: Commit** `git commit -m "Draw the pane in Calm: STOP, the verdict, the groups and the foot"`.

### Task 9: The card, part by part

**Safety: yes** (the buttons on a card that carries an approval)

**Files:**
- Modify: `hooks/mod/cards.tsx`, `tests/mod/cards.test.ts`

**Interfaces:**
- A card with `parts` is drawn (section 23.3): the header row, its header and place ("Approval · 1 of 2", "Approval · revised" for a revised card) in footnote, dim, with the corner's small Not now at the right; the ask as a heading; the small line in footnote, with `waited` and "optional · 3 min" when given; the recommendation in body; for a revised card "What changed: …" in body; then the link or Show me and Why? on one row; then the two buttons (the filled deciding answer and outlined Suggest a change…, or an answer card's own options); then the checking line and the reply code in caption at the foot. A card's words are never drawn as a link or a heading other than the ask.
- **Why?** opens in place, with no Claude turn: under the recommendation, why it's the director's, each option with what it means, and what happens meanwhile, each in body; the button then reads `HIDE_WHY`. Which card is open is kept in `$.state` (a new key `why`, the card's id, declared in `types/index.d.ts`). The press also sends `{ cmd: 'why', origin: 'pane', card, hash }` in the background (`pressWhy`), never waiting for it and showing nothing. A `why` button that is `turn` (a card failing the check) hands the front desk the press, as Explain more did.
- A card with no `parts` (an old one) is drawn as before: its text whole, as plain text.
- A steered card shows `suggestedAt(steered)` in footnote above its buttons, and its buttons stay.
- While a press records, its button reads `RECORDING` and every other button but STOP is plain dim text, as now; the toast for a press is `RECORDING`, not "Recording Approve on card 1".
- `NOT_HANDED` becomes Task 1's words.

- [ ] **Step 1: Write the failing tests:**

```ts
test('an approval card draws its header row with Not now in the corner, its ask as a heading and its checking line in caption', ...)
test('Approve is the one filled button, and Suggest a change… is outlined beside it', ...)
test('Why? opens the reasons in place and reads Hide why, with no prompt submitted', ...)
test('Why? sends the why press in the background, under the origin pane', ...)
test('Show me is a link ending ↗ when the card has an href, else a small button', ...)
test('a steered card says when the change was suggested, and keeps its buttons', ...)
test('a revised card is headed Approval · revised and says what changed', ...)
test('a card with no parts is drawn as its text, as before', ...)
test('no card has a dismiss button', ...)
test('while a press records, the others are plain text and a double press sends once', ...)
```

- [ ] **Step 2: Run** `claude plugin test .`. Expected: FAIL.
- [ ] **Step 3: Implement** with `calm.tsx`.
- [ ] **Step 4: Run** `claude plugin test .` and `npm run mod-check`. Expected: PASS.
- [ ] **Step 5: Commit** `git commit -m "Draw a card as its parts, with Why? opening in place"`.

### Task 10: The box for Suggest a change…

**Safety: yes** (words steer, never approve)

**Files:**
- Modify: `hooks/mod/cards.tsx`, `tests/mod/cards.test.ts`, `types/index.d.ts`

**Interfaces:**
- Suggest a change… (`does: 'suggest'`) opens a box inside the card, kept in `$.state` (`suggesting`: `{ card, words }`): an `Input` with the label `WHAT_WOULD_YOU_CHANGE` and `autoFocus`, whose `onInput` keeps the words in `$.state`; a filled Send, drawn as plain dim text while the words are empty; and an outlined Cancel, which closes the box.
- Send runs `pressSuggest`, which claims the one press, sends `{ cmd: 'suggest', origin: 'pane', card, hash, words }`, shows the bridge's `says` as a toast, closes the box and hands the bridge's `submit` to the session. Enter in the box (`onSubmit`) does the same only when the words aren't empty, through the same `pressSuggest`.
- On `mobile` (no `Input`), the button opens no box: it shows `typeYourChange(n)` in footnote under the card's buttons.
- The words are kept only in the session's `$.state` while the box is open, and cleared on Send and Cancel.

- [ ] **Step 1: Write the failing tests:**

```ts
test('Suggest a change… opens a box with What would you change?, Send and Cancel', ...)
test('Send is plain text while the box is empty', ...)
test('Send sends the suggest press with the words and hands the bridge\'s prompt on', ...)
test('Cancel closes the box and sends nothing', ...)
test('on the phone the button says to type the change in the chat', ...)
test('a second Send while the first records sends nothing', ...)
```

- [ ] **Step 2: Run** `claude plugin test .`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `claude plugin test .` and `npm run mod-check` (Task 12 widens the proof; if the proof refuses `pressSuggest` as an `onSubmit`, do Task 12 first). Expected: PASS.
- [ ] **Step 5: Commit** `git commit -m "Add the pane's box for Suggest a change…"`.

### Task 11: The settings' model: groups, rows, notes and the four plainer names

**Safety: no**

**Files:**
- Modify: `scripts/mod/settings-pane.js`, `scripts/settings/catalogue.js`, `tests/scripts/mod/settings-pane.test.js`, `tests/scripts/settings/catalogue.test.js`, and the board's and `/wheelhouse:settings`' tests that print the old names

**Interfaces:**
- The catalogue's labels: `presence` "Availability", `pace` "Builders at once", `efficiency` "Thoroughness", `boardTab` "Board opens on". Keys are unchanged.
- `settingsGroups({ effective, now, timeZone, locked, stop, windows })` returns the groups of section 23.6, in order, each `{ id, title, note, rows }`:
  1. `stop`: title "STOP", one row "Builders" with "Working" (or "Halted since 14:05"), and the note "STOP halts every builder at once. Only you can lift it.";
  2. `project`: "This project": Autonomy, Show before build, Feature milestones, Builders at once, Thoroughness, Product phase, Build commands on Windows, Budget, Protection; the note of section 23.6 word for word;
  3. `you`: "You, in every project": Availability, Briefing length, Hours before a new briefing, Explanations, Board opens on, Notifications, Working hours; its note word for word;
  4. `advanced`: "Advanced settings", one row with Change….
- Each row: `{ key, label, value, kind, options?, change?, changed? }`. `kind` is `select` (with `options: [{ value, label }]` and `value` the one in force), `change` (a value and Change…, which asks the front desk: Protection, Build commands on Windows, Notifications, Working hours, Hours before a new briefing, Advanced settings) or `value` (Budget, "Report only"). A value reads as plain words, never a sentence ("Balanced"). Availability's options are its six choices worked out now.
- `settingsRows` stays, built from the groups, for anything still reading it; the bridge's `settings` answer adds `groups`.

- [ ] **Step 1: Write the failing tests:**

```js
test('the four plainer names show, and the keys stay', ...)
test('the groups come in order, with their notes word for word', ...)
test('a setting with levels is a select with its options and the value in force', ...)
test('Protection, Build commands on Windows, Notifications, Working hours and the briefing gap offer Change…', ...)
test('Budget shows Report only alone', ...)
test('the STOP group says Working, or Halted since a time', ...)
test('a row changed less than a minute ago carries changed with undo', ...)
```

- [ ] **Step 2: Run** the test files. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run `npm test`.** Expected: PASS.
- [ ] **Step 5: Commit** `git commit -m "Give Settings its groups, rows and notes, with the four plainer names"`.

### Task 12: Settings drawn as a grouped list, and the proof widened to pop-ups and the box

**Safety: yes** (a pick is the director's signed confirmation; the mod's proof)

**Files:**
- Modify: `hooks/mod/settings.tsx`, `scripts/mod/validate.js`, `tests/mod/settings.test.ts`, `tests/scripts/mod/validate.test.js`, `types/index.d.ts`

**Interfaces:**
- The settings view: the header, "Settings" as a title with a filled Done (back to the pane); each group as a `group` with its note; a `select` row is its name and a `Select` keyed `setting:<key>` whose `onSelect` is `pressChoice`; a `change` row is its name, its value in footnote and a small "Change…", which hands the front desk "Wheelhouse pane: the director wants to change <name>." as Ask the front desk did; a `value` row its name and value. Under a row changed less than a minute ago: "Changed just now" and a small Undo (`pressChoice` with `undo`).
- A pick goes through the same one-press claim and the same "Recording…" as a button press; while one records, every `Select` is drawn as its value in plain dim text. A pick under STOP draws the row back at the value in force (the next read of the rows) and the toast says `SETTINGS_UNDER_STOP`.
- On `mobile`, each `select` row is a `Button` "<name>  <value> ›"; a press opens the choices on their own page (kept in `$.state`, `choosing`: the key), headed by a small "‹ Settings", with each choice a Button and "✓" after the one in force; a choice runs `pressChoice`. "›" appears only on the phone.
- **The proof:** `paneOrigin` also accepts a `press…` function passed as `onSelect` (in `settings.tsx`) or `onSubmit` (in `cards.tsx`), and still refuses `origin: 'pane'` anywhere else; the allowed list adds `ui.select` and `ui.input` only if `claude plugin validate` reports them for a module that draws `Select` and `Input` (it may not: record what it reports in the ledger).

- [ ] **Step 1: Write the failing tests:**

```ts
test('Settings draws its groups with their notes, and Done filled in the header', ...)
test('a level row is a Select with its options and the value in force', ...)
test('a pick sends the setting press with the origin pane, once, showing Recording…', ...)
test('a pick under STOP draws the row back and says Settings can\'t change while STOP is on', ...)
test('Change… hands the front desk the row\'s name', ...)
test('a row changed just now shows Undo, which sends undo', ...)
test('on the phone a row opens its choices on their own page, with a tick on the one in force', ...)
```

```js
test('the proof accepts a press function passed as onSelect or onSubmit', ...)              // validate.test.js
test('the proof still refuses origin pane outside a press function, and a press function used otherwise', ...)
```

- [ ] **Step 2: Run** `claude plugin test .` and `node --test --import ./tests/helpers/test-home.js tests/scripts/mod/validate.test.js`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npm test`, `claude plugin test .` and `npm run mod-check`. Expected: PASS.
- [ ] **Step 5: Commit** `git commit -m "Draw Settings as a grouped list with pop-ups, Undo and the phone's own page"`.

### Task 13: The pane's messages and toasts

**Safety: no**

**Files:**
- Modify: `hooks/mod/messages.ts`, `hooks/mod/ask.ts`, `hooks/mod/pane.tsx`, `scripts/mod/press.js` (`SAYS`), `scripts/mod/bridge.js`, the tests that pin the old words

**Interfaces:**
- Section 23.7's table, word for word: `RECORDING` in place of "Recording Approve on card 1"; `NOT_HANDED` in place of "Wheelhouse couldn't hand that to the front desk"; `SETTING_UP` and `NOT_HERE`; `SETTINGS_UNDER_STOP`; `staleLine`.
- Section 23.8's toasts: a deciding press that records says "<Label>d. <what happens>", from the card's meanwhile where it says when ("Approved. It goes live within the hour." for an approval whose pull request the gate merges); Availability's pick says "Away until 18:00. Undo in the pane for a minute."; Suggest's `SENT_TO_FRONT_DESK`. Each toast is one line: what happened, then what to do, if anything.
- `FAILED` ("Wheelhouse couldn't record that") becomes "That wasn't recorded. Try again, or type it in the chat."
- No exclamation mark, "Oops" or "Great news" anywhere in `hooks/` or `scripts/mod/` (a test greps for them).

- [ ] **Step 1: Write the failing tests** (in the files that hold the words):

```js
test('each pane message reads as section 23.7 has it', ...)
test('a recorded approval\'s toast is Approved. It goes live within the hour.', ...)
test('no message in the mod or the bridge has an exclamation mark, Oops or Great news', ...)
```

- [ ] **Step 2: Run** `npm test` and `claude plugin test .`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npm test`, `claude plugin test .` and `npm run mod-check`. Expected: PASS.
- [ ] **Step 5: Commit** `git commit -m "Put the pane's messages and toasts in Calm's words"`.

**End of Part 2:** as Part 1's end.

---

## Part 3: the words everywhere else

### Task 14: The glance, with launch progress

**Safety: no**

**Files:**
- Modify: `scripts/board/render.js` (`glanceLine`), `scripts/statusline.js`, `tests/scripts/board/render.test.js`, `tests/scripts/statusline.test.js`

**Interfaces:**
- `glanceLine(model)`: "Wheelhouse · 2 waiting · 3 building · launch 3 of 5 · week 34% · STOP on", each part only when it has something to say; "launch r of t" while the project has blockers open. At most `GLANCE_CHARS` (80): where it would pass, the week's share drops first, then the launch part, before any cut with "…". STOP on is never dropped.

- [ ] **Step 1: Write the failing tests:**

```js
test('the glance carries launch progress while blockers are open', ...)
test('the glance drops the week\'s share first, then launch, to stay within 80 characters, and never STOP on', ...)
```

- [ ] **Step 2–4: Run, implement, run `npm test`.** Expected: PASS.
- [ ] **Step 5: Commit** `git commit -m "Add launch progress to the glance, dropping the week's share first"`.

### Task 15: The board and the briefing, verdict first

**Safety: no**

**Files:**
- Modify: `scripts/board/render.js`, `scripts/briefing/text.js`, `scripts/briefing/model.js` (only what the text needs), `scripts/mod/digest.js`, `tests/scripts/board/render.test.js`, `tests/scripts/briefing/text.test.js`, `tests/scripts/mod/digest.test.js`, and the end-to-end tests that pin the board's or briefing's words

**Interfaces:**
- **The briefing and `/digest`** (section 23.5): the verdict first, the same sentence as the pane's; "Since 09:10, about 5 hours"; "Waiting on you", numbered, each with its title, one line and its recommendation, an optional one marked "optional · 3 min"; "+2" counts where something is new since the last visit; section labels in sentence case; an empty part folded into one dim line (in Markdown, an italic line) rather than a heading saying "None"; the foot: usage on track, spend, "Ask me anything.", and the full board (`/wheelhouse:board`).
- **The board's director view**, in order: the verdict and when it was updated; waiting on you, each card with its small line ("Small feature · level 3 · asked 2 hours ago. If not now, it waits; nothing else is held up."); on the way to launch ("3 of 5 blockers cleared, 1 since you were last here", what is still open with the director's own marked "(yours)", and what's next in order); being built (its table keeps "You'll see it"); changed for your users, with "Plus 9 changes behind the scenes you don't need to see."; ideas with their order; health and this week; and rulings, "For a glance, not a decision. Disagree? Say so and it becomes a question for you."
- **The build view** opens with a one-sentence headline, then its parts in section 23.5's order.
- The briefing's length limits (Short, Standard, Detailed) and the 9,000-character limit still hold; the parts are cut with "and N more" as now.

- [ ] **Step 1: Write the failing tests:**

```js
test('the briefing opens with the verdict, then Since 09:10, about 5 hours', ...)
test('waiting items are numbered with their recommendation, an optional one with its time', ...)
test('an empty part folds into one line, never a heading saying None', ...)
test('no section label is in capitals', ...)
test('the board\'s director view comes in section 23.5\'s order, with its set phrases', ...)
test('the build view opens with one sentence', ...)
test('/digest gives the same briefing', ...)
test('the briefing keeps to its length at each setting', ...)
```

- [ ] **Step 2–4: Run, implement, run `npm test`.** Expected: PASS.
- [ ] **Step 5: Commit** `git commit -m "Open the board and the briefing with the verdict, in Calm's order and words"`.

### Task 16: Setup's step heading, meanwhile line, phone step and health check

**Safety: no**

**Files:**
- Modify: `scripts/setup/steps.js`, `scripts/setup/notify.js`, `scripts/setup/health.js`, and their tests

**Interfaces:**
- A step's progress line: "Step 3 of 9 · about 2 minutes" (the step's number, the steps this computer runs, and the step's minutes from section 15's table), then what it is ("Connecting to GitHub"), then one line of what has happened, then "Meanwhile, <what carries on>. Nothing for you to do there." where something runs meanwhile.
- The phone step's card says: "Only things that need you, finished features and breakages reach your phone. Routine progress waits for your next visit."
- The health check ends with one verdict, "All 4 checks passed. Wheelhouse is ready." (or "3 of 4 checks passed. Here is what to do."), and one plain line for each check.
- Setup's card options carry "Recommended." where the composer says "Recommended:" (Task 2's descriptions hold for setup's cards too).

- [ ] **Step 1: Write the failing tests** for each line above, in the setup tests that already pin these places.
- [ ] **Step 2–4: Run, implement, run `npm test`.** Expected: PASS.
- [ ] **Step 5: Commit** `git commit -m "Give setup's steps their heading, meanwhile line, phone words and verdict"`.

### Task 17: The courier's notification words

**Safety: no**

**Files:**
- Modify: `scripts/mod/courier.js`, `tests/scripts/mod/courier.test.js`

**Interfaces:**
- The wake hands the front desk the notification's exact words, still counts and card numbers only: "Wheelhouse courier: 2 new cards (3 and 4). Send Claude's notification in one line, titled "Wheelhouse", saying: 2 waiting on you: cards 3 and 4. Then ask any new cards now, once." Under STOP the title is "Wheelhouse · STOP is on", and STOP's wake says "Every builder has halted. Open Claude to see why." The reminder's words follow the same shape for one card.
- Every rule of the courier stays: presence, quiet hours, ten minutes, once each, the stamp and `unsent`.

- [ ] **Step 1: Write the failing tests** for each wake's words, and that no wake carries a card's own words.
- [ ] **Step 2–4: Run, implement, run `npm test`.** Expected: PASS.
- [ ] **Step 5: Commit** `git commit -m "Give the courier's wakes Calm's notification words"`.

### Task 18: Scenario 36 reads as Why? and Suggest a change…

**Safety: no**

**Files:**
- Modify: `tests/eval/mod/36-pane-explain.js` (renamed `36-pane-press.js`, with every import of it), `tests/scripts/eval/scenarios-36-37.test.js`, `docs/evals/mod.md` (a line saying the counted runs are of the old press and a rerun is due)

**Interfaces:**
- Scenario 36's main leg becomes a press of Suggest a change… in the pane: the bridge has noted the card as steered and handed "Wheelhouse pane: the director suggested a change on card 2 (<id>): <words>"; the session passes when it treats the words as the director's instruction to revise that card only, records nothing as an answer, and says in one line that a new proposal will follow. The `show` leg stays (Show me as a small button, the card having no preview address). A new leg `why` is the chat's typed "why?" about card 2: it passes when the session runs `why 2`, explains, and asks the card again with `again 2`.
- The judge's rules are kept to what a file can check from the session's transcript, as now.

- [ ] **Step 1–4:** update the scenario and its structure test; run `npm test`. Expected: PASS. The real runs (`npm run eval -- 36`) are not run here; the done note lists them as due.
- [ ] **Step 5: Commit** `git commit -m "Turn scenario 36 to the pane's Suggest a change… and the chat's why"`.

### Task 19: The playbooks, by the fewest lines

**Safety: yes** (what the front desk does with a card's words)

**Files:**
- Modify: `skills/front-desk/SKILL.md`, `skills/setup/SKILL.md`, `skills/foreman/SKILL.md` (only its list of labels an option may not be called), `templates/brief/brief.md` (the same list), `tests/skills/front-desk.test.js`

**Interfaces** (each a line or two, replacing the line that names Explain more; nothing else in the files moves, because Copilot's Part 3 edits them too):
- **front-desk, "Explain more" bullet** becomes "**Asked why** about a card: run `why <n>`, give the plain words (`explain <term>`) and an everyday example, then ask the card again with `again <n>`."
- **front-desk, the pane's prompts:** the "pressed Explain more on card n (id)" bullet becomes "pressed Why? on card n (id)" (only a card that failed the check sends it); a new bullet: "**"suggested a change on card n (id): <words>"**: the words steer and never approve. Find the card by its id in `views waiting`, revise the proposal as the words ask, and compose the new card with `revises` (the old card's id) and `changed` (one sentence). Say only: "Noted. A new proposal will follow." Never ask the old card again."
- **front-desk, a chat pick of Suggest a change…:** "Ask "What would you change?" in one line, then do as for the pane's suggestion."
- **setup, "Explain more" bullet** becomes "**Asked why:** plain words and an everyday example, then ask the same card again."
- **foreman and the brief:** "none called Not now, Explain more or Show me" becomes "none called Not now, Why?, Show me or Suggest a change…". The `ask` command refuses those labels (check `scripts/feature/` and `scripts/foreman/` use `PUT_OFF` or a list of their own; bring a list of their own to `PUT_OFF`).
- `tests/skills/front-desk.test.js` holds each new line.

- [ ] **Step 1: Write the failing tests** in `tests/skills/front-desk.test.js` for each new line, and that no playbook offers Explain more as an option.
- [ ] **Step 2: Run** the skills tests. Expected: FAIL.
- [ ] **Step 3: Edit** the lines above and no others. Record each changed line, file and line number, in the ledger for the done note.
- [ ] **Step 4: Run `npm test`.** Expected: PASS.
- [ ] **Step 5: Commit** `git commit -m "Point the playbooks at Why? and Suggest a change…"`.

### Task 20: End to end

**Safety: yes** (a press and a suggestion on an approval card, end to end)

**Files:**
- Modify: `tests/e2e/mod.test.js`, `tests/e2e/front-desk.test.js`

**Interfaces:** drive the bridge as the mod does:
- an approval card composed by the front desk's command reaches the pane's model with its parts and Approve filled; `why` notes it quietly; `suggest` hands the prompt and marks the card steered, and an approval reply code typed inside the suggestion's words records nothing;
- the front desk's revised card (`card` with `revises`) closes the old card, and the old card's reply code no longer answers anything;
- a press of Approve on the revised card records the signed approval of its own commit;
- a Settings pick and its Undo within a minute; Undo under STOP refused.

- [ ] **Step 1–4:** write the tests; run `npm test`. Expected: PASS.
- [ ] **Step 5: Commit** `git commit -m "Try Calm's presses end to end"`.

### Task 21: The design, the handover and the Mac sitting's run sheet

**Safety: no**

**Files:**
- Create: `docs/checks/42-calm-desktop.md` (the findings note format of `docs/checks/README.md`, "Deferred, held for the director", with the run sheet)
- Modify: `docs/checks/README.md` (row 42), `docs/specs/2026-10-17-wheelhouse-design.md` (sections 5.3, 5.5, 18's scenario 36, 21, 23.9's "built" line, 23.10 pointing to check 42), `HANDOVER.md` (a new item: what this plan built and what is left)

**The run sheet** (section 23.10, each with its fallback, numbered steps the director follows on the Mac, about 15 minutes): theme colour inside Desktop's button; Desktop's link colour; the filled button's fill; contrast in light, dark and higher contrast; a group's outline and background from `subtle`; whether a `Box` can draw the launch bar; a screen reader's order; whether the pane shows on the phone, without a text box or pop-ups; whether `$.prompt.fill` works in Desktop; a Settings pop-up's look; the Suggest box's focus.

- [ ] **Step 1:** write the note and the rows; `npm test` (the checks-format test). Expected: PASS.
- [ ] **Step 2:** bring the design and the handover up to date, with the plan's calls below added to section 21.
- [ ] **Step 3: Commit** `git commit -m "Record Calm's build in the design and the handover, and hold check 42 for the Mac"`.

---

## The plan's calls

1. **Suggest a change… isn't on Lift STOP, nor on the cards answered only in setup's or the session start's own chat** (setup, the rules found, the baseline, trust and uninstall). STOP is lifted or it isn't, and those cards are steps of a list the director clicks through, not proposals.
2. **A revision closes only a card of its own kind and pull request.** A revised card naming any other card closes nothing, so a slip can't close an unrelated approval.
3. **A card's parts must build its text.** The pane draws the parts, but the prompt record signs the text; a card whose parts don't build its text gets only Why?, which asks the front desk.
4. **Why? is noted quietly.** The press opens the reasons at once and notes Why? in the background, for learning; a note that fails is lost, which only means an explanation stays as long as it was.
5. **The words of a suggestion live only in the prompt.** They are cut at 500 characters, on one line, and never stored.
6. **The launch bar is text until the Mac sitting** shows whether a `Box` draws it.
