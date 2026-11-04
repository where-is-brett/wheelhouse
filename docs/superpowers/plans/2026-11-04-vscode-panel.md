<!-- docs/superpowers/plans/2026-11-04-vscode-panel.md -->
# The Wheelhouse panel in VS Code: the build plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan part by part. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The VS Code add-on that Parts C and D built becomes the director's real panel on Copilot: the Inset look and every pane state, one card answered in one place, a checked `.vsix` on each release, and an offer card. Sitting S6 then tries the finished panel.

**Architecture:**
- The add-on (`vscode/`) keeps drawing HTML from the desk's pane model. Shared pane-state fixtures hold it to the mod.
- A per-project mark (`<wheelhouseHome()>/panes/`) says a VS Code panel is live. Only Copilot's card commands and the board tool read it.
- `pack.js` is already byte for byte the same each run, so the tagged commit carries the `.vsix`'s hash, and CI and the install check against it.

**Tech Stack:** Node.js (ES modules) for the scripts, CommonJS at the add-on's edge, `node:test`, GitHub Actions. No dependency, no npm tool in the add-on.

**Spec:** `docs/specs/2026-11-04-vscode-panel-design.md` (the director's decisions D1 to D6 are in its section 11). Also read `docs/specs/2026-10-31-pane-design.md` (Inset) and `docs/specs/2026-11-04-one-card-design.md`.

**How to use this plan.**
- Each part is one fresh session, working from this file, the spec and the repository.
- Each part ends with a pull request and one message to the main session.
- Run the test files a change touches; leave `npm test` to CI. The add-on's tests run as `node --test --import ./tests/helpers/test-home.js tests/vscode/<file>.test.js`. Also run `node scripts/addon/validate.js` after any change in `vscode/`.
- Builders ask the main session, never the director.

**Starts after the one-card build lands (D5).** Parts 5 and 7 consume one-card names that its Parts 2, 4, 5, 6 and 9 produce (`docs/superpowers/plans/2026-11-04-one-card.md`). Parts 1, 2, 3, 4 and 6 touch nothing the one-card build does, so the main session may start them as soon as that build's mod parts (7 and 9) have merged.

## Global Constraints

- Every new file starts with its repository-relative path comment. JSON files are exempt.
- British English. Dates as day month year (4 November 2026).
- No model names and no AI attribution in code, comments, commits or pull requests.
- Never name the director's projects, company or their content: the repository is public. Tests use made-up cards.
- Scripts are Node.js and run on macOS and Windows; paths come from `node:path`.
- The add-on registers no command but `wheelhouse.openPane`, no URI handler, no public API, and only the chat tools `wheelhouse_record` and `wheelhouse_board`. Only `onPaneMessage` reaches a press. `scripts/addon/validate.js` must pass.
- Every word that came from a record is escaped in the pane. No hex colour anywhere in the page: colours are `var(--vscode-…)` only.
- The pane never starts a Copilot turn and never spends a Copilot request.
- No builder runs Copilot for real. No release tag. `ADDON_LEAN_READY` stays false.
- The words, the order of a card's parts and each button's key stay as the mod's: a press is checked by its words.

## Review Focus

1. **A hidden pane shown again.** The page drawn before it hid must count for nothing: with no `retainContextWhenHidden`, the new draw gets a new nonce and a message with the old one is refused. Tested in Part 4.
2. **A half-written or unreadable mark** (`panes/vscode-<id>.json` holding `{`, or an unsafe project id such as `../x`). It reads as not live and never throws. Tested in Part 4.
3. **A Claude Code project with a live VS Code panel.** Its cards must still be asked in the chat, or they vanish from the only place that director looks. Tested in Part 5.
4. **A `.vsix` that doesn't match `vscode/vsix.sha256`** on a release tag. The install refuses in plain words and nothing is installed. Tested in Part 6.
5. **An allow list that can't be read** (no registry key, a policy file with a syntax error). The answer is "can't tell", never "blocked": the offer still comes, and a refused install says IT may block it. Tested in Part 6.

## Order and what can run together

| Part | Name | Needs | Can run alongside |
|---|---|---|---|
| 1 | Shared pane-state fixtures and labels | one-card's mod parts merged | 4, 6 |
| 2 | The Inset look | 1 | 4, 6 |
| 3 | A card's states | 2 | 4, 6 |
| 4 | The live mark and the trust guards | none | 1, 2, 3, 6 |
| 5 | Copilot's chat held back and told | 4, one-card Parts 2, 4, 5, 6, 9 | 6 |
| 6 | The checked `.vsix` and the allow list | none | 1 to 5 |
| 7 | The offer, the skills and the papers | 3, 5, 6 | none |

---

### Part 1: Shared pane-state fixtures and labels

**Files:**
- Create: `tests/fixtures/pane-states/*.json` (one pane model per state, named below)
- Create: `tests/fixtures/pane-states/index.js` (`STATES`: the names, in the pane design's order)
- Create: `scripts/desk/pane-labels.js`
- Modify: `vscode/pane/render.js` (take the six labels from `pane-labels.js`, through `vscode/desk.cjs`'s copy of the scripts; the page still draws when it can't load them)
- Modify: `scripts/addon/pack.js` (`pane-labels.js` in `ENTRIES`, if the walk doesn't reach it)
- Test: `tests/vscode/states.test.js`, `tests/mod/pane.test.ts`

**Interfaces:**
- Produces: `STATES`, the 16 names: `first-reading`, `calm`, `card-of-parts`, `why-open`, `feature-question`, `suggest-open`, `steered`, `revised`, `recording`, `answered-elsewhere`, `several-cards`, `all-stop`, `to-watch`, `out-of-date`, `settings`, `settings-changed`. Each file is a full pane model as `scripts/desk/mod-pane.js` gives it, plus `"view"` (`main`, `board` or `settings`), `"open"` (`why`, `suggest` or null) and, for `recording`, `"recording": "<card id>"`. `settings` and `settings-changed` also hold `"settings"` (the groups `settingsGroups` gives).
- Produces: `PANE_LABELS = Object.freeze({ stop: 'STOP', lift: 'Lift STOP', board: 'Board', settings: 'Settings', briefing: 'Briefing', done: 'Done' })` in `scripts/desk/pane-labels.js`.

- [ ] **Step 1: Write the fixtures.** Build each model by calling `paneModel` with made-up inputs (as `tests/scripts/mod/status.test.js` does) and saving its output, so each fixture is a model the desk really gives. Keep the script that made them out of the repository.
- [ ] **Step 2: Write the failing tests.**
  - `tests/vscode/states.test.js`, `every state draws`: for each name in `STATES`, `renderPane(fixture, { nonce, view, … })` returns HTML with no `couldn't be drawn` notice, and every `label` of every button on every drawn card appears in it as a `<button`.
  - `the labels are the shared ones`: each value of `PANE_LABELS` appears in `render.js`'s output where it is used, and `render.js`'s source holds none of the six as a string literal.
  - In `tests/mod/pane.test.ts`, `the mod draws every state`: each fixture of `STATES` with `view: 'main'` or `'board'` draws without throwing; and `the mod's labels are the shared ones`: `calm.tsx`'s source holds each `PANE_LABELS` value. The mod keeps its own literals (it can't import scripts), and this test holds them equal. *Designer's call* (spec section 5.3).
- [ ] **Step 3: Run them.** The label tests FAIL; some state tests may FAIL where `render.js` drops a state's buttons. Note which; Parts 2 and 3 make them pass. Mark those with `{ todo: 'Part 2' }` or `{ todo: 'Part 3' }` so CI stays green.
- [ ] **Step 4: Implement `PANE_LABELS` and use it in `render.js`.**
- [ ] **Step 5: Run** `tests/vscode/states.test.js`, `tests/vscode/render.test.js`, `tests/scripts/addon/pack.test.js` and `node scripts/addon/validate.js`. All PASS, todos aside.
- [ ] **Step 6: Commit** "Shared pane-state fixtures and labels for the mod and the VS Code add-on".

### Part 2: The Inset look

**Files:**
- Modify: `vscode/pane/style.css`, `vscode/pane/render.js` (`drawVerdict`, `drawBoard`, `drawSettings`, `drawFoot`, `renderPane`)
- Test: `tests/vscode/render.test.js`, `tests/vscode/states.test.js`

**Interfaces:**
- Consumes: `STATES` and the fixtures (Part 1).
- Produces: CSS classes `panel` (a raised group with the quiet line), `band` (the recommendation), `rows` with `row-name` and `row-value` (name left, value right), `launch-bar` with an inner `launch-fill` whose `style` width is set from the model only through a class (`w-0` to `w-100` in steps of 5, since the page's policy allows no inline style).

The look follows the pane design's direction A and its "The build" list, with the spec's section 5.1 table as the starting variables:

| Inset | VS Code variable |
|---|---|
| raised panel | `--vscode-sideBarSectionHeader-background`, else `--vscode-editorWidget-background` |
| quiet line | `--vscode-widget-border`, else `--vscode-panel-border` |
| recommendation band | `--vscode-textBlockQuote-background` |
| launch bar fill and track | `--vscode-progressBar-background`, `--vscode-input-background` |
| All stop | `--vscode-inputValidation-errorBackground` |
| filled, default, quiet buttons | `--vscode-button-background`/`-foreground`, `--vscode-button-secondaryBackground`, `--vscode-descriptionForeground` |
| high contrast | `--vscode-contrastBorder` on every line, no fills (`body.vscode-high-contrast`) |

Sizes 11, 12, 13, 14 and 20 px, in `--vscode-font-family`.

- [ ] **Step 1: Write the failing tests.**
  - `the card is the first panel`: in `calm` with a card, the first element with class `panel` holds the card's question.
  - `group names sit above their panels`: in `to-watch`, the heading "To watch" is outside and immediately before its `panel`.
  - `rows put the name left and the value right`: a health line and a settings row each draw as `row-name` then `row-value`.
  - `the launch bar is drawn`: a model with `launch: { gained: 3, total: 4 }` draws `launch-bar` with `w-75`; `gained` above `total`, or a negative, draws `w-100` or `w-0`.
  - `the verdict doesn't repeat`: "Nothing needs you." appears once when the verdict already says it, and still appears under any other verdict.
  - `out of date shows the warning and no figures`: the `out-of-date` fixture draws its warning line, and the verdict carries no digits.
  - `first reading draws the mod's line`, not "Nothing to show yet".
  - `high contrast has borders and no fills`: the stylesheet has a `body.vscode-high-contrast` block setting `background: transparent` on `.panel` and `.band`.
  - Keep the existing `no hex colour` and `theme variables` tests.
- [ ] **Step 2: Run** `tests/vscode/render.test.js`. The new tests FAIL.
- [ ] **Step 3: Implement it.** Remove Part 1's `todo: 'Part 2'` marks as their states pass.
- [ ] **Step 4: Run** `tests/vscode/render.test.js`, `tests/vscode/states.test.js` and `node scripts/addon/validate.js`. All PASS.
- [ ] **Step 5: Look at it.** Write each fixture's HTML to the scratchpad and open it in the built-in browser with three body classes (`vscode-light`, `vscode-dark`, `vscode-high-contrast`) and a stand-in stylesheet defining the variables above. Adjust the variables by eye at 300 px and 450 px wide. Attach three screenshots to the pull request.
- [ ] **Step 6: Commit** "The VS Code pane in the Inset look".

### Part 3: A card's states

**Files:**
- Modify: `vscode/pane/render.js` (`drawCard`, `drawCards`, the page's script), `vscode/extension.cjs` (`state.at`, `state.recording`), `vscode/press.cjs` (set and clear `recording`; pass the press answer's `notice` on)
- Test: `tests/vscode/render.test.js`, `tests/vscode/press.test.js`, `tests/vscode/states.test.js`

**Interfaces:**
- Consumes: the fixtures (Part 1); the press answer's `notice` from one-card Part 9 (`scripts/mod/press.js`).
- Produces: `renderPane(model, { …, at = 0, recording = null })`: `at` is the index of the card shown; `recording` a card id. New message types from the page: `next` and `back` (no `card`; they change `state.at` only, and never reach a press).
- Produces: `onPaneMessage` calls `deps.marking(cardId | null)` before and after a press, and `deps.answered(notice)` when the press answer has a `notice`.

- [ ] **Step 1: Write the failing tests.**
  - `one card at a time`: `several-cards` draws only the first waiting card's buttons, the next card's subject, and a `next` button; with `at: 1` it draws the second card and a `back` button. `at` past the end shows the last.
  - `recording replaces the button`: `recording: 'c1'` draws "Recording…" in place of c1's filled button, and none of c1's other press buttons.
  - `steered and revised`: a card with `steered: '14:10'` draws "You suggested a change at 14:10"; with `revised: true` its kind reads "Approval · revised" and its `parts.changed`, when there is one, shows under "What changed:". Take the exact words from the mod's `hooks/mod/cards.tsx`.
  - `answered elsewhere`: a card with no buttons and a `note` draws the note and no `<button`.
  - In `press.test.js`: `next and back press nothing` (no press function called; `state.at` moves); `a press marks recording, then clears it`, also when the press throws; `an answered notice reaches deps.answered`, and none comes for Not now or a stale press.
- [ ] **Step 2: Run them.** They FAIL.
- [ ] **Step 3: Implement it.** In `extension.cjs`, `answered(notice)` shows `vscode.window.showInformationMessage(notice)` and sets `state.notice` to it until the next draw that changes the model.
- [ ] **Step 4: Run** `tests/vscode/render.test.js`, `tests/vscode/press.test.js`, `tests/vscode/states.test.js`, `tests/vscode/activate.test.js` and `node scripts/addon/validate.js`. All PASS, with no `todo` left.
- [ ] **Step 5: Commit** "The VS Code pane draws a card's states, one card at a time".

### Part 4: The live mark and the trust guards

**Files:**
- Create: `scripts/lib/vscode-pane.js`
- Modify: `vscode/desk.cjs` (`LOADS` gains `vscodePane: 'scripts/lib/vscode-pane.js'`), `vscode/extension.cjs`
- Modify: `vscode/pane/render.js` (the untrusted-folder line)
- Test: `tests/scripts/lib/vscode-pane.test.js`, `tests/vscode/activate.test.js`, `tests/scripts/addon/pack.test.js`

**Interfaces:**
- Produces, in `scripts/lib/vscode-pane.js`, every path under `path.join(wheelhouseHome(), 'panes')`. An unsafe project id (one `stateDir` refuses) names no file: readers give false or null, writers false. Readers never throw; writers are atomic, as `session-files.js`'s are.
  - `markVscodePane(project, { at: number, visible: number | null, window: string }) -> boolean`: writes `vscode-<project>.json` as `{ at, visible, surface: 'vscode', window }`.
  - `vscodePaneLive(project, now: number) -> boolean`: true when `at` and `visible` are both within `LIVE_MS` (imported from `session-files.js`) of `now`.
  - `markVscodeHere(project, cardIds: string[], now: number) -> boolean` and `takeVscodeHere(project, cardIds: string[], now: number) -> boolean`: as `markHere`/`takeHere`, in `vscode-<project>.here.json`, with `HERE_MS`.
- Produces, in `extension.cjs`: the mark written on each tick and on `view.onDidChangeVisibility`, with `visible` set to now when `view.visible` is true and left as it was otherwise; `window` is 16 random hex bytes made once per activation.

- [ ] **Step 1: Write the failing tests.**
  - `vscodePaneLive` is true at 44 seconds and false at 46; false for a missing file, a file holding `{`, `visible: null`, and project `../x`.
  - `takeVscodeHere` gives true once, false the second time, false after 121 seconds.
  - In `activate.test.js`:
    - `the webview loads no files`: after `resolveWebviewView`, `view.webview.options` deep-equals `{ enableScripts: true, localResourceRoots: [] }`.
    - `no context is retained`: the provider is registered with no `webviewOptions.retainContextWhenHidden`.
    - `a page drawn before the pane hid counts for nothing`: draw, take the nonce, fire visibility false then true, then post a `press` with the old nonce; no press function is called.
    - `the mark follows visibility`: visible writes a fresh `visible`; hidden leaves it, so 46 seconds later `vscodePaneLive` is false.
    - `an untrusted folder draws no cards`: with `vscode.workspace.isTrusted === false`, the page holds the line "Wheelhouse runs only in a folder you trust, since it signs your clicks with this computer's key." and no `<button` but STOP.
- [ ] **Step 2: Run them.** They FAIL.
- [ ] **Step 3: Implement it.**
- [ ] **Step 4: Run** the two test files, `tests/scripts/addon/pack.test.js` (the pack must carry `vscode-pane.js`) and `node scripts/addon/validate.js`. All PASS.
- [ ] **Step 5: Commit** "The VS Code panel marks itself live, loads no files and keeps no hidden page".

### Part 5: Copilot's chat held back and told

**Files:**
- Modify: `scripts/frontdesk/cli.js` (`cards`, `again`, `pull-cards`, `review`, `views waiting`), `scripts/desk/views.js` (mirror `waiting`'s "since" lines)
- Modify: `vscode/chat-tools.cjs` (`wheelhouse_board`)
- Test: `tests/scripts/frontdesk/cli.test.js`, `tests/scripts/frontdesk/desk-parity.test.js`, `tests/vscode/chat-tools.test.js`

**Interfaces:**
- Consumes: `vscodePaneLive`, `markVscodeHere`, `takeVscodeHere` (Part 4); `agentOfProject` (`scripts/agents/names.js`); from one-card: `PANE_LEAD` (Part 4, `scripts/hooks/card-check.js`), `--here` and `RECENT_LEAD` (Part 5), `SINCE_LEAD` (Part 6), `answeredWords` and `subjectOf` (Part 2, `scripts/cards/answered.js`).
- Produces: `heldForVscode(project, now) -> boolean` in `cli.js`: `agentOfProject(project) === 'copilot' && vscodePaneLive(project, now)`. When true, the card commands print `{ "panel": "<PANE_LEAD's line for n cards>" }` in place of `questions`, still mark the cards as asked, and `--here` (with no Claude Code session id) writes `markVscodeHere` and lets those ids through once.
- Produces: `views waiting --since <iso>` adds, after any `RECENT_LEAD` block, a `SINCE_LEAD` line naming each card decided after `<iso>` with `where` not `'chat'`, as "<subject>: <answeredWords>". Without `--since`, nothing changes.
- Produces: `wheelhouse_board`'s result gains `panel` (the same line, when `heldForVscode` is true, and then no `cards`) and `since` (the `SINCE_LEAD` line for answers after the tool's previous call in this window, kept in memory; the first call gives none).

- [ ] **Step 1: Write the failing tests.**
  - `a live VS Code panel holds Copilot's cards`: project agent `copilot`, a fresh mark; `cards` prints `panel` and no `questions`, and the cards are marked asked.
  - `a Claude Code project's cards are never held by a VS Code panel`: agent `claude-code`, a fresh mark; `cards` prints `questions` as today.
  - `a stale mark holds nothing`: mark 46 seconds old; `questions` as today.
  - `--here lets them through once on Copilot`: `cards --here` with no session id writes the VS Code here-mark; the next `cards` prints `questions`; the one after prints `panel` again.
  - `views waiting --since names panel answers only`: one card answered `where: 'panel'` and one `where: 'chat'` after `--since`; only the first is named. The desk-parity test holds `scripts/desk/views.js` to the same lines.
  - In `chat-tools.test.js`: `the board tool gives the panel line, not the cards, while live`; `the board tool's since names answers after its last call, once`.
- [ ] **Step 2: Run them.** They FAIL.
- [ ] **Step 3: Implement it.** `heldForVscode` fails open: any error gives false, so cards are asked in the chat.
- [ ] **Step 4: Run** the three test files, `tests/scripts/mod/desk-parity.test.js` and `node scripts/addon/validate.js`. All PASS.
- [ ] **Step 5: Commit** "Copilot's chat leaves cards to a live VS Code panel and is told the panel's answers".

### Part 6: The checked `.vsix` and the allow list

**Files:**
- Create: `vscode/vsix.sha256` (one line: the hex digest, then two spaces, then the file name, as `shasum -a 256` prints)
- Create: `scripts/addon/hash.js`, `scripts/addon/allowed.js`
- Create: `.github/workflows/release.yml`
- Modify: `scripts/addon/install.js`, `.github/workflows/ci.yml` (validate job: `node scripts/addon/hash.js --check`)
- Test: `tests/scripts/addon/hash.test.js`, `tests/scripts/addon/allowed.test.js`, `tests/scripts/addon/pack.test.js` (where `installAddon`'s tests already are)

**Interfaces:**
- Produces, in `scripts/addon/hash.js`: `vsixHash({ root }) -> { hash: string, name: string }` (packs to a temporary file, hashes it, removes it); `recordedHash({ root }) -> { hash, name } | null` (reads `vscode/vsix.sha256`); `checkHash({ root }) -> { ok: boolean, line: string }`. Run as `node scripts/addon/hash.js --write` (the commit that sets a version runs it) or `--check` (CI; exit 1 with the line on a mismatch).
- Produces, in `scripts/addon/allowed.js`: `addonAllowed({ platform, run, readFile, env, home }) -> Promise<{ allowed: true | false | null, why: string }>`. `false` only when an allow list was read and names neither `wheelhouse.wheelhouse` nor `wheelhouse` with a true, `"stable"` or version-list value; `null` when nothing could be read or a value can't be parsed. It reads, in order: on Windows `reg query HKLM\Software\Policies\Microsoft\VSCode /v AllowedExtensions` and the same under `HKCU`; on a Mac `defaults read /Library/Managed\ Preferences/com.microsoft.VSCode AllowedExtensions`; then the user's `settings.json` `extensions.allowed` (`%APPDATA%\Code\User` or `~/Library/Application Support/Code/User`). A policy wins over the setting. Never throws.
- Produces, in `install.js`: before installing, on a checkout at a release tag (`git describe --exact-match --tags`), `checkHash`; a mismatch returns `{ ok: false, line: MISMATCH }`. `NO_CODE` now returns `{ ok: false, line: CLICKS, file }`, where `CLICKS` = "VS Code's command line isn't on this computer's path, so the add-on is ready for you to add by hand: in VS Code, open Extensions, choose ⋯, then Install from VSIX…, and pick " + the file's path + ".". A refusal by VS Code returns `REFUSED` + " Your company may allow only some extensions; your IT can allow wheelhouse.wheelhouse."
- `release.yml`: on `push` of tags `v*`, packs with `node scripts/addon/pack.js`, runs `hash.js --check`, and attaches the `.vsix` to that tag's release with `gh release upload` (creating a draft release when none exists). It never creates or moves a tag. Actions pinned by commit, as `ci.yml`'s are; `permissions: contents: write` on that job only.

- [ ] **Step 1: Write the failing tests.**
  - `two packs hash the same`: `vsixHash` twice on the same root gives the same hash.
  - `check passes on the recorded hash and fails on another`: a temporary root with a written `vsix.sha256`; change one packed file; `checkHash` gives `ok: false` with a line naming both hashes' first 12 characters.
  - `allowed`: no policy and no setting gives `null`; a policy `{"wheelhouse.wheelhouse": true}` gives `true`; `{"github": true}` gives `false`; `{"wheelhouse": "stable"}` gives `true`; a policy that isn't JSON gives `null`; a policy saying false while the setting says true gives `false`; a `run` that throws gives `null`.
  - `install refuses a mismatch on a tag`, `install without code gives the clicks and the file`, `a refusal names IT`.
- [ ] **Step 2: Run them.** They FAIL.
- [ ] **Step 3: Implement it.** Write `vscode/vsix.sha256` with `--write` last.
- [ ] **Step 4: Run** the three test files, `tests/scripts/addon/pack.test.js`, `node scripts/addon/hash.js --check` and `node scripts/addon/validate.js`. All PASS. Read `release.yml` once more against `ci.yml`'s pins: there is no YAML parser without a dependency.
- [ ] **Step 5: Commit** "A checked .vsix on each release, and the company's allow list read before an offer".

Note for the pull request: every later change under `vscode/` or the scripts the add-on carries changes the hash. CI's check then fails until `node scripts/addon/hash.js --write` is run and committed. Say so in `CLAUDE.md`'s Testing line, in one sentence.

### Part 7: The offer, the skills and the papers

**Files:**
- Modify: `scripts/agents/copilot/start-helper.js` (`addon-check`, below)
- Modify: `skills/front-desk/SKILL.md` and Lean's kit source (`adapters/copilot/` skills: `wheelhouse-front-desk`, `wheelhouse-setup`), then rebuild the committed kit with `npm run copilot-home`
- Modify: `README.md` (one sentence), `docs/data.md`, `docs/copilot/it-note.md`, `docs/specs/2026-11-04-one-card-design.md` (its "Copilot has no panel" lines point to the panel spec), `docs/checks/README.md` (check 72's row gains S6's added steps), `HANDOVER.md` (item 27)
- Test: `tests/scripts/agents/copilot-start-helper.test.js`, `tests/skills/front-desk.test.js`, the kit's tests

**Interfaces:**
- Consumes: `addonAllowed` and `installAddon` (Part 6); `panel`, `since` and `views waiting --since` (Part 5).
- Produces: `start-helper.js addon-check` prints `{ offer: boolean, line: string }`: `offer` false, with a line, when the add-on is already installed (`code --list-extensions` names `wheelhouse.wheelhouse`), when `addonAllowed` gives `false` (the line: "Your company's VS Code settings don't allow the Wheelhouse add-on, so it isn't offered. Wheelhouse works in the chat as it does now, and your IT can allow wheelhouse.wheelhouse if you'd like the panel."), or when no Node.js-run helper is here (`ADDON_LEAN_READY` false and Lean with no Node.js, D3). Otherwise `offer` true.
- The offer card (D2), composed by the front desk with `card`, topic `vscode-panel`, asked once: after the first feature finishes at Lean, or at the end of setup elsewhere, only when `addon-check` says `offer: true`. What: "Would you like Wheelhouse's panel beside the chat?" Options: **Yes, add it** ("Wheelhouse adds its VS Code add-on; VS Code may ask you to allow it."), **Not now** ("Nothing changes; cards stay in the chat."). Why: the panel shows the board and the cards with buttons, and nothing in it spends Copilot requests. Meanwhile: work carries on in the chat. On Yes, the front desk runs `start-helper.js addon` and says its line.

- [ ] **Step 1: Write the failing tests** for `addon-check`: installed gives no offer; `allowed: false` gives the line above; Lean with no Node.js gives no offer; otherwise an offer.
- [ ] **Step 2: Run them.** They FAIL. Implement `addon-check`. Run again: PASS.
- [ ] **Step 3: The skills.** In the front-desk skill (and Lean's copy), in the skill's own voice:
  - when a card command prints `panel`, say its one line and nothing of the cards; when the director wants them here, run it again with `--here`;
  - on Copilot, at the start of each turn, read `views waiting --since <the last turn's time>` (or `wheelhouse_board` where the add-on is), and state each `SINCE_LEAD` answer in one plain line first, never asking that card again;
  - the offer card's when and how, above.
  In the setup skill: the offer card at the end of setup, outside Lean.
- [ ] **Step 4: The papers.**
  - `README.md`, Lean paragraph, after "Wheelhouse installs nothing.": "If you'd like a panel beside the chat, Wheelhouse can offer its optional VS Code add-on later; you never need it."
  - `docs/data.md`: the marks in `panes/` (what, how long, removed on uninstall).
  - `docs/copilot/it-note.md`: a paragraph on the add-on: its id `wheelhouse.wheelhouse`, that it runs with VS Code's permissions like any extension, signs the person's own clicks with the computer's key, starts no Copilot turn, and is allowed with `AllowedExtensions`.
  - `docs/checks/README.md`, check 72: add S6's steps from the spec's section 8.
  - `HANDOVER.md` item 27: one line that the panel is built and S6 tries it.
- [ ] **Step 5: Run** `tests/scripts/agents/copilot-start-helper.test.js`, `tests/skills/front-desk.test.js`, `tests/scripts/agents/copilot-home.test.js`, `tests/skills/lean.test.js`, `tests/skills/setup-lean.test.js`, and `node scripts/install/private-words.js`. All PASS.
- [ ] **Step 6: Commit** "Offer the VS Code panel once, teach the front desk the panel's lines, and bring the papers up to date".

## After the parts

For the main session, sitting S6 (checks 55, 65, 67, 72), as the spec's section 8 lists. It needs the director's yes for its two or three Copilot chat turns. The agent does every step it can; the director's only steps are Install from VSIX and pressing a card.

**Left for after S6** (D3): at Lean with no Node.js, the front desk's own fetch, hash check (`shasum -a 256` or `certutil -hashfile … SHA256`) and install steps from the release, once `ADDON_LEAN_READY` is on; and the Marketplace route (D1), with Trusted Publishing from GitHub Actions.
