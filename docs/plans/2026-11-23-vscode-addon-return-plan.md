<!-- docs/plans/2026-11-23-vscode-addon-return-plan.md -->

# Bringing back the VS Code add-on: build plan

> **Parked on 23 November 2026:** the director chose to work as Claude Desktop does, with question cards in the chat only and no panel, so the VS Code add-on was parked again. The build is kept at the tag `parked/vscode-addon-2`. What is parked, and how it comes back, is in `docs/parked.md`.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring the VS Code add-on back as a thin, paired desk/1 client: a panel beside Copilot chat in VS Code first, and Claude Code's later.

**Architecture:** The add-on speaks only desk/1 to the helper's socket or pipe, signs each act and its watch with its own ed25519 key (kept in SecretStorage), and is paired by the director's signed Pair it. The core gains three seams it lacks today: a paired app's answer is limited to what a chat click may decide, the helper's window signs Pair it and Unpair it, and a signed watch marks the panel live per project. Merge approval from the panel (decision 2) is a separate part on top.

**Tech Stack:** Node.js (ES modules for core, CommonJS `.cjs` for the add-on), `node:test`, `node:crypto` ed25519, the VS Code extension API, `@vscode/vsce` for packing, GitHub Actions.

**Spec:** `docs/specs/2026-11-23-vscode-addon-return-design.md` (the old design `docs/specs/2026-11-04-vscode-panel-design.md` stands where it is silent: `git show parked/vscode-addon:docs/specs/2026-11-04-vscode-panel-design.md`).

## Global Constraints

- Every file starts with a comment giving its repository-relative path (`// scripts/x.js`, `<!-- docs/x.md -->`); JSON is exempt.
- British or Australian English; dates as day month year (23 November 2026).
- The product owner is "the director", they/them.
- No "enhanced", "improved" or "fixed" in names, comments or user-facing words.
- No model names and no AI attribution in commits, pull requests, code or docs.
- The repository is public: no Wheelhouse records, no names of companies, employers or private projects.
- Scripts and hooks are Node.js and run on macOS and Windows.
- desk/1 stays `desk/1`: names are only added (`ask-here`, `unpair`, the watch's evidence), never renamed or changed in meaning (spec section 3).
- `CLIENT_WINDOW_MS` is 5 minutes (`scripts/desk/evidence.js`); a signed watch's `at` must be within it.
- The panel is live for `PANEL_LIVE_MS = 45000` after its last signed watch (the same span as today's `LIVE_MS`); the add-on watches at least every 15 seconds.
- An Ask me here mark lasts `ASK_HERE_MS = 120000` (today's `HERE_MS`) and is taken once.
- No VS Code command, URI handler, public API, chat tool or language-model tool reaches an act. The add-on contributes one command: open the panel.
- Lean, the mod and pane, and `vscode/chat-tools.cjs`, `vscode/lean.cjs`, `vscode/versions.cjs` stay out.
- Run the test files a change touches: `node --test --import ./tests/helpers/test-home.js <file>`. Leave the whole suite to CI.
- Copilot trials use the cheapest Copilot model and count requests against the month's allowance of 200.

## Review Focus

1. **An agent fakes a live panel to hide cards.** An unsigned watch, a watch signed by an unpaired key, or one with an `at` older than five minutes marks nothing live; the front desk then asks cards in the chat. Tests in Task 1.3.
2. **A paired app decides what a chat click can't.** A `client` answer with a signing option on a non-merge card, on a confirmed step, or on a decision is refused and names where to answer. Tests in Task 1.1.
3. **A panel Approve on a project with real users.** Refused before anything is written, naming the window or the code host; and a signed approval naming `proof: 'client'` never counts in the gate on such a project. Tests in Tasks 2.1 and 2.2.
4. **The window's Pair it confirms but enrols nothing.** A window click on a Pair card must leave the key in `keys/clients.json`; Unpair it must remove it, and the app's next act is refused at once. Tests in Task 1.2.
5. **An older helper meets a newer add-on.** A command the helper doesn't know comes back "Wheelhouse can't …", and the add-on shows "Update Wheelhouse" and decides nothing. Test in Task 3.2.

---

## Parts and parallel groups

A part is one branch and one pull request, built by one session. Parts in the same group touch no file in common and can run at the same time. A group starts once the groups it needs are merged.

| Group | Parts (run together) | Needs | Main files |
|---|---|---|---|
| A | 1 Core seam · 3 Add-on shell · 4 Panel drawing | nothing | 1: `scripts/desk/*`, `scripts/host/helper.js`, `scripts/agents/chat-clicks.js`, `scripts/agents/copilot/numbers.js`, `scripts/frontdesk/cli.js` (the `unpair` command only). 3: `vscode/extension.cjs`, `vscode/desk-client.cjs`, `vscode/resolver.cjs`, `vscode/key.cjs`, `vscode/package.json`. 4: `vscode/pane/*`, `vscode/media/*`, `tests/vscode/render.test.js` |
| B | 2 Merge approval from the panel · 5 Acts and guards · 6 One card, one answer for Copilot | A | 2: `scripts/gate/conditions.js`, `scripts/desk/evidence.js`, `scripts/desk/acts.js`, `scripts/host/helper.js`. 5: `vscode/press.cjs`, `vscode/nonce.cjs`, `vscode/extension.cjs` (message handler), `scripts/addon/validate.js`. 6: `scripts/frontdesk/cli.js`, `skills/front-desk/SKILL.md`, `adapters/copilot/tool-sheet.md`, `adapters/copilot/first-mate/` |
| C | 7 Pack, hash, CI, release · 8 Offer, install and update | B (5) | 7: `scripts/addon/pack.js`, `scripts/addon/hash.js`, `vscode/vsix.sha256`, `.github/workflows/ci.yml`, `.github/workflows/release.yml`. 8: `scripts/addon/install.js`, `scripts/addon/allowed.js`, `scripts/update/addon.js`, `scripts/update/cards.js`, `scripts/update/finish.js`, `scripts/update/routes.js`, `scripts/setup/` |
| D | 9 Trial: Copilot chat in VS Code | B and C, all merged | trial records outside the repository; fixes go in their own small branches |
| E | 10 Claude Code in VS Code · 11 Papers | D | 10: `scripts/hooks/card-check.js`, `scripts/lib/session-files.js`. 11: `docs/parked.md`, the main design's section 22, `HANDOVER.md`, `README.md` |

Part 3 builds against Part 1's interfaces as written below, with a stand-in helper in its tests, so the two run together. Part 2 and Part 6 both read what Part 1 adds and touch no file in common: Part 2 owns `helper.js`, `evidence.js` and `acts.js` in group B, and Part 6 owns `cli.js`. Part 7 rewrites `vscode/vsix.sha256` last; a later change to `vscode/` reruns `node scripts/addon/hash.js --write`. Part 8 uses Part 7's `vsixName(version)` and `checkHash()` as written below, so it runs alongside.

No part waits on a decision. The director is needed only for the Windows laptop sitting in Part 9 (the steps an agent can't do there), and Part 10 starts when the director uses Claude Code in VS Code; it isn't on Copilot's path.

---

## Part 1: Core seam (group A)

The three core gaps the design names (spec sections 2, 3 and 4), plus the Unpair card and `ask-here`. The guard that proof `add-on` decides nothing is in Task 2.1, which owns the gate.

### Task 1.1: A paired app decides only what a chat click may

**Files:**
- Modify: `scripts/desk/evidence.js` (`checkClient`, `checkEvidence`)
- Test: `tests/scripts/desk/evidence.test.js`

**Interfaces:**
- Consumes: `signsOn(label, question)` from `scripts/hooks/prompt-record.js`; `CONFIRMED_STEPS` from `scripts/agents/chat-clicks.js`; `isDecisionCard(data)` from `scripts/decisions/pending.js`.
- Produces: `checkEvidence(...)` for `form: 'client'` returns `{ ok: true, records: [], client, decides: boolean }`, where `decides` is true when the option signs on a merge card. Part 2 reads `decides`.

- [ ] **Step 1: Write the failing tests** in `tests/scripts/desk/evidence.test.js`, with a paired client and a signature made as the add-on makes it (`crypto.sign(null, Buffer.from(canonicalJson({ command, args, at })), privateKey)`):

```js
test('a paired app\'s answer to a signing option on a non-merge card is refused, naming the window', () => {
  const got = checkEvidence('answer', { card: 'c1', option: 'Confirm' }, signed('answer', { card: 'c1', option: 'Confirm' }), { clients, views: waitingWith('c1', SETTING_CARD), now });
  assert.equal(got.ok, false);
  assert.match(got.refused, /window/);
});
test('a paired app\'s answer on a confirmed step is refused', () => { /* card id 'lift-stop-…', option 'Lift STOP' -> ok false */ });
test('a paired app\'s answer on a decision is refused, naming the window or a typed reply', () => { /* decision card -> ok false, /window|reply/ */ });
test('a paired app\'s Approve on a merge card passes, marked as deciding', () => {
  const got = checkEvidence('answer', { card: 'merge-12', option: 'Approve', commit: SHA }, signed(...), { clients, views: waitingWith('merge-12', MERGE_CARD), now });
  assert.deepEqual([got.ok, got.decides, got.client], [true, true, 'vscode-panel']);
});
test('a paired app\'s plain option on any card passes, deciding nothing', () => { /* Not now / a non-signing option -> ok true, decides false */ });
```

- [ ] **Step 2: Run them and see them fail.** `node --test --import ./tests/helpers/test-home.js tests/scripts/desk/evidence.test.js`. Expected: the refusal tests fail (`checkClient` passes any card today).

- [ ] **Step 3: Implement.** In `checkEvidence`, after `checkClient` succeeds for a card command, apply the same order as `doChatClick` in `helper.js`: a confirmed step with a signing option is refused ("That step is confirmed in Wheelhouse's window, never from the panel"); a decision is refused ("A decision is answered in the window or by a typed reply"); a signing option on a card that isn't `merge-` is refused ("The panel can't decide that card: answer it in Wheelhouse's window"). Otherwise pass, with `decides: signsOn(...) && CHAT_DECIDES.test(card)`. The question is found with `questionOf(views, card)`, as the chat-click branch finds it.

- [ ] **Step 4: Run them and see them pass.** Same command. Expected: PASS, and the file's other tests still pass.

- [ ] **Step 5: Commit.** `git commit -m "Limit a paired app's answer to what a chat click may decide"`

### Task 1.2: The window signs Pair it and Unpair it, and enrols or removes the key; the Unpair card

**Files:**
- Modify: `scripts/host/helper.js` (`ACTION_STEPS`, the window's refusal words listing what it confirms, `doConfirm`'s write at the `writeEvent` after `proof: 'window'`)
- Modify: `scripts/agents/chat-clicks.js`, `scripts/agents/copilot/numbers.js` (`CONFIRMED_STEPS` gains `'pairing'`)
- Modify: `scripts/desk/vocabulary.js` (`COMMANDS` gains `'unpair'`; `NO_EVIDENCE` gains `'unpair'`; the header note narrowed as spec section 3 says)
- Modify: `scripts/desk/acts.js` (`unpair` act)
- Modify: `scripts/frontdesk/cli.js` (`unpair <app id>` command)
- Test: `tests/scripts/confirm/window.test.js`, `tests/scripts/desk/acts.test.js`, `tests/scripts/frontdesk/cli.test.js`, `tests/scripts/host/helper-chat-click.test.js` (where `CONFIRMED_STEPS` is tested today)

**Interfaces:**
- Consumes: `pairClient({ id }, signedAction, { now })`, `unpairClient(id, signedAction)`, `fingerprintOf` from `scripts/desk/clients.js`; `unpairLine(client, fingerprint)` and `UNPAIR_LABEL` from `scripts/state/card-lines.js`; `composeCard`.
- Produces: desk/1 command `unpair` with args `{ client: string }` -> `{ ok, changed: ['card'], card }`; the card is `kind: 'unpair'`, level 4, its set line `unpairLine(id, fingerprint)`, its one option `Unpair it`. Front desk: `node scripts/frontdesk/cli.js unpair <app id>` prints `{ "card": <id> }` or a refusal. Step name `'pairing'` in `ACTION_STEPS` for actions `pair-client` and `unpair-client`.

- [ ] **Step 1: Write the failing tests.**
  - `window.test.js`: "the window's Pair it enrols the app's key": raise a Pair card through `act('pair')` in a throwaway home, confirm it through `/confirm` with label `Pair it`; assert `pairedClients()` holds the app with the card's fingerprint, and a client-signed `request` from it now passes.
  - `window.test.js`: "the window's Unpair it removes the key, and the app's next act is refused": then raise the Unpair card, confirm it; assert `pairedClients()` no longer holds it and a client-signed `answer` is refused with "never paired".
  - `window.test.js`: "a Pair card whose fingerprint differs from the kept request enrols nothing".
  - `acts.test.js`: "unpair raises one level-4 card naming the app and its key"; "unpair for an app that isn't paired is refused, raising nothing".
  - `cli.test.js`: "unpair <id> raises the card through the desk".
  - The `CONFIRMED_STEPS` test: both lists hold `'pairing'` and are equal.

- [ ] **Step 2: Run them and see them fail.** `node --test --import ./tests/helpers/test-home.js tests/scripts/confirm/window.test.js tests/scripts/desk/acts.test.js tests/scripts/frontdesk/cli.test.js`. Expected: the window refuses the Pair card (no step), and `unpair` is not a command.

- [ ] **Step 3: Implement.**
  - `ACTION_STEPS` gains `'pair-client': 'pairing', 'unpair-client': 'pairing'`; the window's refusal text names "pairing an app".
  - In `doConfirm`, after the window's event is written, call `pairClient` or `unpairClient` exactly as `doRecord` does (helper.js, after `writeEvent` in `doRecord`). Put both calls in one small function, `enrolOn(event, { now })`, used by both paths.
  - `acts.unpair(args, checked, { recorder })`: find the app in `pairedClients()`, refuse if absent, compose the card as `acts.pair` does (what: "Unpair the app …, key …?", why: "Only you can unpair an app, at level 4.", meanwhile: "The app keeps working until you unpair it."), write it.
  - The front desk's `unpair` calls `act('unpair', { client })` through `scripts/desk/client.js`.

- [ ] **Step 4: Run them and see them pass.** Same command, plus `node --test --import ./tests/helpers/test-home.js tests/scripts/host/helper-chat-click.test.js tests/scripts/desk/clients.test.js`. Expected: PASS.

- [ ] **Step 5: Commit.** `git commit -m "Let the window sign Pair it and Unpair it, and raise the Unpair card"`

### Task 1.3: A signed watch marks the panel live, per project

**Files:**
- Create: `scripts/desk/panel-live.js`
- Modify: `scripts/desk/core.js` (`watch(cursor, evidence)`), `scripts/host/helper.js` (`deskRoute('watch')` passes `body.evidence`; `deskOf` gives the source `panelLive()`), `scripts/desk/views.js` (the `waiting` view's `paneLive`)
- Test: `tests/scripts/desk/panel-live.test.js`, `tests/scripts/desk/core.test.js`, `tests/scripts/desk/views.test.js`, `tests/scripts/host/helper-desk.test.js`

**Interfaces:**
- Produces, in `scripts/desk/panel-live.js` (state in the helper's process, never in a file):
  - `export const PANEL_LIVE_MS = 45000;`
  - `markPanel(project: string, client: string, nowMs: number): void`
  - `panelLive(project: string, nowMs: number): boolean`
  - `clearPanels(): void` (tests only)
- Produces, on the wire: `POST /desk/watch` body `{ v, project, cursor, evidence? }` with `evidence = { form: 'client', client, at, sig }`, the signature over `canonicalJson({ command: 'watch', args: { cursor }, at })`. The answer is the same as today. A watch with good evidence marks the project's panel live; one with none, or with evidence that doesn't check, is still answered and marks nothing.
- Produces: the `waiting` view's `data.paneLive` is `panelLive(project, now)`, with or without `args.session`. The front desk's existing `{ "panel": … }` output then follows the panel with no change to `cli.js`.

- [ ] **Step 1: Write the failing tests.**
  - `panel-live.test.js`: "a marked panel is live for 45 seconds, then not"; "a mark is per project".
  - `core.test.js`: "a watch with a paired app's signature marks the panel live"; "an unsigned watch is answered and marks nothing"; "a watch signed by a key that isn't paired marks nothing"; "a watch whose `at` is six minutes old marks nothing"; "a watch signature over another cursor marks nothing".
  - `views.test.js`: "waiting says paneLive true while the project's panel is live, with no session named".
  - `helper-desk.test.js`: "the helper's /desk/watch passes the evidence through" (signed watch, then `/desk/read waiting` says `paneLive: true`).

- [ ] **Step 2: Run them and see them fail.** `node --test --import ./tests/helpers/test-home.js tests/scripts/desk/panel-live.test.js tests/scripts/desk/core.test.js tests/scripts/desk/views.test.js tests/scripts/host/helper-desk.test.js`

- [ ] **Step 3: Implement.** `deskCore.watch(cursor, evidence)` checks `evidence` with `checkClient('watch', { cursor }, evidence, { clients, now })` (export `checkClient` from `evidence.js`) and on success calls `markPanel(source.project, checked.client, now().getTime())` before reading. The source the helper builds gains `panelLive: () => panelLive(project, now().getTime())`; the `waiting` reader uses `source.panelLive?.() === true` in place of the session file. The session-file `paneLive` stays for the card-check hook until Part 10.

- [ ] **Step 4: Run them and see them pass.** Same command. Expected: PASS.

- [ ] **Step 5: Commit.** `git commit -m "Mark the panel live per project from a signed watch"`

### Task 1.4: Ask me here

**Files:**
- Modify: `scripts/desk/panel-live.js` (Ask me here marks), `scripts/desk/vocabulary.js` (`COMMANDS` gains `'ask-here'`), `scripts/desk/acts.js` (`ask-here` act), `scripts/desk/views.js` (`waiting` with `askHere: true`)
- Test: `tests/scripts/desk/acts.test.js`, `tests/scripts/desk/views.test.js`

**Interfaces:**
- Produces, in `scripts/desk/panel-live.js`: `export const ASK_HERE_MS = 120000;` `markAskHere(project, cardId, nowMs): void`; `takeAskHere(project, nowMs): string[]` (returns the live marks and clears them).
- Produces: desk/1 command `ask-here` with args `{ card: string }`, which needs `client` evidence (it is not in `NO_EVIDENCE`: only the paired app moves a card), -> `{ ok, changed: ['ask-here'] }`; refused when the card isn't waiting.
- Produces: the `waiting` view read with `args.askHere === true` adds `data.askHere: string[]` from `takeAskHere`. Part 6 reads it.

- [ ] **Step 1: Write the failing tests.** "ask-here marks a waiting card, and waiting with askHere gives it once"; "ask-here on a card that isn't waiting is refused"; "ask-here without a paired app's signature is refused"; "a mark older than two minutes is not given".

- [ ] **Step 2: Run them and see them fail.** `node --test --import ./tests/helpers/test-home.js tests/scripts/desk/acts.test.js tests/scripts/desk/views.test.js`

- [ ] **Step 3: Implement** the marks and the act as the Interfaces say.

- [ ] **Step 4: Run them and see them pass.** Same command. Expected: PASS.

- [ ] **Step 5: Commit.** `git commit -m "Add Ask me here for the panel"`

---

## Part 2: Merge approval from the panel (group B; decision 2)

### Task 2.1: The gate counts a `client` approval only where no real users are

**Files:**
- Modify: `scripts/gate/conditions.js` (`approvalOf`, and the comment on ruling P5-48)
- Modify: `scripts/host/helper.js` (the `gateDecision({ … })` call passes `realUsers: launchedIn(project)`)
- Test: `tests/scripts/gate/conditions.test.js`

**Interfaces:**
- Produces: `const CLIENT_PROOF = 'client'` in `conditions.js`. A signed approval whose `data.proof` is `client` counts as any signed approval does, except when `realUsers` is true.

- [ ] **Step 1: Write the failing tests.** "a signed approval naming proof add-on never counts" (the old add-on's proof: a stale record must decide nothing), and the same for a `card-answer` naming it in `cardOutcomes`; "a signed approval naming proof client counts on a project with no real users"; "a signed approval naming proof client doesn't count on a project with real users"; "an unsigned card-answer naming proof client never counts" (it isn't a chat proof, and `CHAT_PROOFS` in `scripts/agents/chat-clicks.js` must not gain `client`: that list is what `/cards/chat-click` accepts).
- [ ] **Step 2: Run** `node --test --import ./tests/helpers/test-home.js tests/scripts/gate/conditions.test.js`; the real-users test fails.
- [ ] **Step 3: Implement.** In `approvalOf`, `signedTaken` is false when `i.approval?.data?.proof === 'add-on'`, or when `realUsers && i.approval?.data?.proof === CLIENT_PROOF`. If `cardOutcomes` counts an `add-on` answer, make it ignore that proof too. Update the P5-48 comment: it is widened by decision 2 of the add-on's return design (23 November 2026). Pass `realUsers` from the helper; read the gate's other uses of `realUsers` and confirm none changes for a signed-hook approval.
- [ ] **Step 4: Run** the same file and `tests/scripts/gate/self-merge.test.js`. Expected: PASS.
- [ ] **Step 5: Commit.** `git commit -m "Count a panel approval in the gate on projects with no real users"`

### Task 2.2: The helper turns the panel's Approve into the approval the card earns

**Files:**
- Modify: `scripts/desk/evidence.js` (refuse `decides` on a project with real users), `scripts/desk/acts.js` (`onCard` with `checked.decides`), `scripts/host/helper.js` (`deskOf` recorder gains `panelApprove`; new `doPanelApprove`)
- Test: `tests/scripts/desk/acts.test.js`, `tests/scripts/host/helper-desk.test.js`

**Interfaces:**
- Consumes: `checked.decides` and `checked.client` from Task 1.1; `windowEarned(project, card, label, ctx)` in `helper.js`; `launchedIn(project)`.
- Produces: recorder `panelApprove({ card, label, hash, client }) -> { ok, id } | { ok: false, refused }`. The helper finds the waiting card, checks the hash as `doConfirm` does, earns the record with `windowEarned`, requires `made.kind === 'approval'`, and writes it signed by the helper with `data: { ...made.data, proof: 'client', by: client }`. On a launched project it refuses with "This project has real users, so approve it in Wheelhouse's window or on the code host."

- [ ] **Step 1: Write the failing tests.** In `helper-desk.test.js`, on a throwaway project with an open pull request card `merge-<n>`: "a paired app's Approve writes a signed approval naming proof client and the head commit"; "the gate then lets the merge through" (`gateDecision` sees `approvalMissing` false); "on a launched project the panel's Approve is refused and nothing is written"; "an Approve for a head that moved is refused as a changed card". In `acts.test.js`: "a deciding client answer goes to panelApprove, not write".
- [ ] **Step 2: Run** `node --test --import ./tests/helpers/test-home.js tests/scripts/desk/acts.test.js tests/scripts/host/helper-desk.test.js`; they fail.
- [ ] **Step 3: Implement** as the Interfaces say. The refusal on a launched project is made in the helper (the desk's verifier has no project phase), before any write.
- [ ] **Step 4: Run** the same command plus `tests/scripts/gate/conditions.test.js`. Expected: PASS.
- [ ] **Step 5: Commit.** `git commit -m "Record the panel's Approve as the approval its merge card earns"`

---

## Part 3: Add-on shell (group A)

From the tag, reworked onto desk/1. Read the old files with `git show parked/vscode-addon:vscode/extension.cjs` and so on; bring back only what the spec's section 5 lists.

### Task 3.1: Resolver and desk/1 client

**Files:**
- Create: `vscode/resolver.cjs`, `vscode/desk-client.cjs`
- Test: `tests/vscode/resolver.test.js`, `tests/vscode/desk-client.test.js`

**Interfaces:**
- Produces: `helperAddress({ platform, home, user }) -> string` (a copy of `scripts/lib/paths.js`'s, which a test compares against core for macOS and Windows inputs); `projectIdFor(folder) -> string | null` (a copy of how core finds a project's id; the same CI test compares them).
- Produces: `deskClient({ address, sign }) -> { read(view, args), act(command, args), watch(cursor) }`. Each call posts `{ v: 'desk/1', project, … }`; `act` and `watch` add `evidence: sign(command, args)` where `sign` returns `{ form: 'client', client, at, sig }`. An answer whose `v` isn't `desk/1`, or a refusal starting "Wheelhouse can't", resolves to `{ ok: false, update: true }`.

- [ ] **Step 1: Write the failing tests.** "the resolver's helper address matches core's on macOS and on Windows"; "the resolver's project id matches core's for a project folder and a folder inside it"; "act signs the command, its arguments and the time"; "watch signs `{ command: 'watch', args: { cursor } }`"; "a helper that answers another version asks for an update"; "a helper that doesn't know a command asks for an update". The client tests run against a stand-in helper on a socket in the test's home.
- [ ] **Step 2: Run** `node --test --import ./tests/helpers/test-home.js tests/vscode/resolver.test.js tests/vscode/desk-client.test.js`; they fail.
- [ ] **Step 3: Implement** in plain CommonJS with no import from `scripts/` (the add-on packs alone).
- [ ] **Step 4: Run** them. Expected: PASS.
- [ ] **Step 5: Commit.** `git commit -m "Add the add-on's resolver and desk/1 client"`

### Task 3.2: The key, pairing, the watch loop, the status bar

**Files:**
- Create: `vscode/key.cjs`, `vscode/extension.cjs`, `vscode/package.json`
- Test: `tests/vscode/helpers.js` (the VS Code stand-in, from the tag), `tests/vscode/activate.test.js`, `tests/vscode/states.test.js`, `tests/vscode/key.test.js`

**Interfaces:**
- Produces: `loadKey(secrets) -> { client, publicKey, sign(command, args) }`: makes an ed25519 pair on first start and keeps the private key (PKCS8, base64) in `context.secrets` under `wheelhouse.panelKey`; `client` is `vscode-panel-<8 hex of the public key's fingerprint>`.
- Produces: `activate(context)`: registers the one webview view `wheelhouse.panel` and the one command `wheelhouse.openPanel`, a status bar item ("Wheelhouse · 2 need you"), and a watch loop every 10 seconds while the view is visible. `package.json`: `capabilities.untrustedWorkspaces.supported: false`, no `uriHandler`, no `api`, no `languageModelTools`, no `chatParticipants`, `engines.vscode` as the tag's.
- Produces: panel states the drawing part draws: `no-helper`, `update`, `unpaired` (with the fingerprint), `pairing` (asked, waiting for Pair it), `live`, `stopped`.

- [ ] **Step 1: Write the failing tests.** "the key is made once and kept in SecretStorage, never in a file"; "an unpaired add-on asks to pair once and shows the fingerprint the card shows"; "while paired and visible it watches every 10 seconds, signed"; "when hidden it stops watching, so the panel stops being live"; "with no helper it says so and starts nothing"; "on another desk version it shows Update Wheelhouse and decides nothing"; "it registers exactly one command".
- [ ] **Step 2: Run** `node --test --import ./tests/helpers/test-home.js tests/vscode/*.test.js`; they fail.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** them. Expected: PASS.
- [ ] **Step 5: Commit.** `git commit -m "Bring back the add-on's shell as a paired desk/1 client"`

---

## Part 4: Panel drawing (group A)

### Task 4.1: The Inset look, every state, and pictures

**Files:**
- Create: `vscode/pane/render.js`, `vscode/pane/style.css`, `vscode/media/wheel.svg` (from the tag, reworked), `tests/vscode/fixtures/*.json`
- Test: `tests/vscode/render.test.js`

**Interfaces:**
- Consumes: the desk/1 view shapes: `glance`, `waiting` (cards with `id`, `data.question`, options), `card`, `work`; the states from Task 3.2.
- Produces: `render(state, { nonce }) -> string` (HTML for the webview, every button carrying `data-act`, `data-card`, `data-option`, `data-hash` and the nonce). Buttons: each option, Not now, Ask me here (per card), All stop, Pull cards, Unpair, Pair (when unpaired). No button for Lift All stop, settings or safekeeping: those say where they happen (spec section 2).

- [ ] **Step 1: Write the failing tests.** "every state draws from its fixture with a nonce on every script and button"; "a card offers its options, Not now and Ask me here"; "a merge card on a project with real users says to approve in the window"; "a confirmed step says to answer in the window and offers no deciding button"; "no state draws a Lift All stop, settings or safekeeping button"; "text from the record is escaped".
- [ ] **Step 2: Run** `node --test --import ./tests/helpers/test-home.js tests/vscode/render.test.js`; they fail.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** them. Expected: PASS.
- [ ] **Step 5: Pictures.** Draw every fixture in light, dark and high contrast in a headless browser, save the screenshots outside the repository, and read each one. Fix what reads badly.
- [ ] **Step 6: Commit.** `git commit -m "Draw the panel in the Inset look"`

---

## Part 5: Acts and guards (group B)

### Task 5.1: Only the pane's buttons reach an act

**Files:**
- Create: `vscode/press.cjs`, `vscode/nonce.cjs` (from the tag), `scripts/addon/validate.js` (from the tag, reworked)
- Modify: `vscode/extension.cjs` (the webview's message handler)
- Test: `tests/vscode/press.test.js`, `tests/scripts/addon/validate.test.js`

**Interfaces:**
- Consumes: `deskClient().act` (Task 3.1), `render` (Task 4.1).
- Produces: `press(message, { latestNonce, client }) -> Promise<{ ok, says }>`: takes only a message carrying the latest draw's nonce and one of the acts `answer`, `suggest`, `not-now`, `all-stop`, `pull-cards`, `ask-here`, `unpair`, `pair`; anything else is dropped. A merge card's Approve sends `args.commit` from the card. `validate.js <vsix>`: fails when the package contributes any command but `wheelhouse.openPanel`, a URI handler, an API, a chat participant or a language-model tool, or when any file but the webview's message handler calls `act`.

- [ ] **Step 1: Write the failing tests.** "a press with a stale nonce does nothing"; "a press naming an act outside the list does nothing"; "an Approve on a merge card carries the commit"; "a refusal is shown in the helper's words"; `validate.test.js`: "a package with a second command fails", "one registering a language-model tool fails", "the built add-on passes".
- [ ] **Step 2: Run** `node --test --import ./tests/helpers/test-home.js tests/vscode/press.test.js tests/scripts/addon/validate.test.js`; they fail.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** them. Expected: PASS.
- [ ] **Step 5: Commit.** `git commit -m "Let only the pane's buttons reach the desk's acts"`

---

## Part 6: One card, one answer for Copilot (group B)

### Task 6.1: Ask me here in the front desk, and the First Mate's words

**Files:**
- Modify: `scripts/frontdesk/cli.js` (`cards`, `again`, `pull-cards` read `waiting` with `askHere: true` and hand those cards out in the chat even while the panel is live)
- Modify: `skills/front-desk/SKILL.md` (the "One place for a card" lines: the panel is VS Code's, and an Ask me here from the panel arrives as a card to ask)
- Modify: `adapters/copilot/tool-sheet.md` (where the panel line means stop and say it; Pair it and Unpair it go to the window), then `npm run copilot-first-mate`
- Test: `tests/scripts/frontdesk/cli.test.js`, `tests/scripts/agents/copilot/first-mate.test.js`

**Interfaces:**
- Consumes: `waiting`'s `paneLive` (Task 1.3) and `askHere` (Task 1.4).
- Produces: under a live panel, `cards` prints `{ "panel": <line>, "questions": [<the Ask me here cards>] }` when any are marked, else `{ "panel": <line> }` as today.

- [ ] **Step 1: Write the failing tests.** "while the panel is live, cards gives the panel line and no questions"; "a card the panel moved here is asked once, then held again"; "with no live panel, cards asks as before"; "the built First Mate instructions match the build" (the existing drift test, rerun after the rebuild).
- [ ] **Step 2: Run** `node --test --import ./tests/helpers/test-home.js tests/scripts/frontdesk/cli.test.js tests/scripts/agents/copilot/first-mate.test.js`; the cli tests fail.
- [ ] **Step 3: Implement**, then `npm run copilot-first-mate`.
- [ ] **Step 4: Run** them. Expected: PASS.
- [ ] **Step 5: The since line in Copilot.** Check that a card answered in the panel reaches Copilot's next turn with the since line (`scripts/cards/panel-words.js` through `board-context.js`, as Copilot's prompt hook carries it). If Copilot's hook doesn't carry it, add a test and make it so in the hook that carries the board context.
- [ ] **Step 6: Commit.** `git commit -m "Hold cards in the panel for Copilot, with Ask me here"`

---

## Part 7: Pack, hash, CI and the release job (group C)

### Task 7.1: Pack and hash the thin add-on, check it in CI, build it on release

**Files:**
- Create: `scripts/addon/pack.js`, `scripts/addon/hash.js` (from the tag, reworked: no packed core scripts), `vscode/vsix.sha256`, `.github/workflows/release.yml` (from the tag, with only the `vsix` job's steps that still apply)
- Modify: `.github/workflows/ci.yml` (steps: `node scripts/addon/hash.js --check`, `node scripts/addon/validate.js <built vsix>`)
- Test: `tests/scripts/addon/pack.test.js`, `tests/scripts/addon/hash.test.js`

**Interfaces:**
- Produces: `vsixName(version: string) -> 'wheelhouse-panel-<version>.vsix'`; `pack({ out }) -> Promise<{ file, sha256 }>`; `checkHash() -> { ok, expected, actual }`; `hash.js --write` rewrites `vscode/vsix.sha256`. The release attaches `wheelhouse-panel-<version>.vsix` and its `.sha256` to the GitHub release.

- [ ] **Step 1: Write the failing tests.** "pack holds only vscode/ files, no scripts/ copy"; "the same sources pack to the same hash"; "a changed source fails the check"; "the version in the add-on's package.json is the plugin's".
- [ ] **Step 2: Run** `node --test --import ./tests/helpers/test-home.js tests/scripts/addon/pack.test.js tests/scripts/addon/hash.test.js`; they fail.
- [ ] **Step 3: Implement**, then `node scripts/addon/hash.js --write`.
- [ ] **Step 4: Run** them, and run `release.yml`'s steps locally with `act` or by hand on a scratch tag in a fork-free way (no tag pushed to this repository). Expected: PASS and a `.vsix` that `validate.js` passes.
- [ ] **Step 5: Commit.** `git commit -m "Pack the add-on on each release and check its hash in CI"`

---

## Part 8: Offer, install and update (group C)

### Task 8.1: Setup and the update command offer to install or update the panel

**Files:**
- Create: `scripts/addon/install.js`, `scripts/addon/allowed.js` (from the tag, reworked to install the release's `.vsix`)
- Modify: `scripts/update/addon.js` (the removal offer becomes "Install the panel" or "Update the panel"), `scripts/update/cards.js`, `scripts/update/finish.js`, `scripts/update/routes.js`, the setup step list in `scripts/setup/` (one optional offer, after the agent is set up)
- Test: `tests/scripts/update/addon.test.js`, `tests/scripts/addon/allowed.test.js`, `tests/scripts/addon/install.test.js`, the setup test that lists its steps

**Interfaces:**
- Consumes: `vsixName`, `checkHash` (Task 7.1).
- Produces: `addonOffer({ run, platform, env, pluginVersion }) -> null | { kind: 'install' | 'update', from?: string, to: string }` (`code --list-extensions --show-versions`); `ADDON_ID` stays `'wheelhouse.wheelhouse'`. `install({ file, run }) -> { ok, says }`: refuses a file whose hash doesn't match, installs with `code --install-extension`, and with no `code` on the path says the clicks ("Install from VSIX…") and names the file. `allowed({ settings, policy }) -> boolean` reads `extensions.allowed` and the `AllowedExtensions` policy before any offer.

- [ ] **Step 1: Write the failing tests.** "no add-on installed: setup offers it once, as optional"; "an older add-on: the update offers Update the panel"; "the same version: nothing is offered"; "Not now is remembered as the old offer's was"; "a policy that blocks it: no offer, and one plain line why"; "no code on the path: the card gives the clicks and the file"; "a file whose hash differs is refused and nothing is installed".
- [ ] **Step 2: Run** `node --test --import ./tests/helpers/test-home.js tests/scripts/update/addon.test.js tests/scripts/addon/allowed.test.js tests/scripts/addon/install.test.js`; they fail.
- [ ] **Step 3: Implement.** Render each new card on the exact path it is shown and read it before the pull request.
- [ ] **Step 4: Run** them, and the setup test file. Expected: PASS.
- [ ] **Step 5: Commit.** `git commit -m "Offer to install and update the panel from setup and the update command"`

---

## Part 9: Trial with Copilot chat in VS Code (group D)

Run by agents. The director is not needed.

- [ ] **Step 1: The Mac.** In a throwaway `WHEELHOUSE_HOME` and a throwaway project with no real users, with Copilot on its cheapest model, agents drive a real VS Code (`@vscode/test-electron`, or the tag's `probes/lib/vscode-click.mjs` through tmux). The agent holds the test computer's key, so it signs Pair it in the window itself.
- [ ] **Step 2: The checks**, each recorded with a screenshot read by an agent:
  1. Pair through the window: the panel shows the same fingerprint as the card; the key is enrolled.
  2. During a long Copilot turn, a card is answered in the panel; Copilot's next turn starts with the since line.
  3. While the panel is open, `cards` in Copilot's chat says the cards are in the panel and asks none.
  4. Ask me here moves one card to the chat, where it is asked once.
  5. A merge approved from the panel merges once checks pass; on a project marked launched the panel's Approve is refused, naming the window.
  6. All stop from the panel stops the work.
  7. Closing the panel brings the cards back to the chat within a minute.
  8. Unpair through the window; the panel's next act is refused.
- [ ] **Step 3: Count Copilot's requests** for the run and record them against the month's allowance. Stop and report if the run would pass a quarter of it.
- [ ] **Step 4: The Windows laptop.** Ship the release's `.vsix` and a trial brief to the laptop the usual way, and run the same checks there with Copilot in VS Code. Steps an agent can't do on the laptop are the only ones handed to the director, grouped into one sitting.
- [ ] **Step 5: Fix** what the runs find, each in its own small branch with its test, and rerun the failed checks.

---

## Part 10: Claude Code in VS Code (group E)

Waits for the director to start using Claude Code in VS Code. It isn't on Copilot's path.

### Task 10.1: The card-check hook holds per project

**Files:**
- Modify: `scripts/hooks/card-check.js` (read the project's live panel from the helper, as the front desk does, in place of the session file), `scripts/lib/session-files.js` (drop `paneLive`, `markPane`, `markHere`, `takeHere` once nothing reads them)
- Test: `tests/scripts/hooks/card-check.test.js`

- [ ] **Step 1: Write the failing tests.** "while the project's panel is live, AskUserQuestion for a held card is refused with the panel line"; "a card moved here by Ask me here is let through once"; "with no live panel, the card is asked".
- [ ] **Step 2: Run** `node --test --import ./tests/helpers/test-home.js tests/scripts/hooks/card-check.test.js`; they fail.
- [ ] **Step 3: Implement.** The hook asks the helper with `/desk/read waiting` (`askHere: true`), as `cli.js` does.
- [ ] **Step 4: Run** them. Expected: PASS.
- [ ] **Step 5: Trial on the Mac** with Claude Code in VS Code: checks 2, 3, 4, 6 and 7 of Part 9, with Claude Code's own signed Pair it.
- [ ] **Step 6: Commit.** `git commit -m "Hold cards for the panel in Claude Code, per project"`

---

## Part 11: Papers (group E)

- [ ] **Step 1:** `docs/parked.md`: the add-on leaves the list (its entry moves to a "Brought back" line, as Copilot's did), naming the return design and this plan.
- [ ] **Step 2:** The main design's section 22 gains a row: "The VS Code add-on comes back | Decided 23 November 2026 (…)", with decisions 1 to 5 in a line each, and that decision 2 widens ruling P5-48.
- [ ] **Step 3:** `HANDOVER.md` and `README.md`: the panel, how to get it (each release; setup and the update command offer it), and that Claude Code's hold follows Part 10.
- [ ] **Step 4: Commit.** `git commit -m "Record the add-on's return in the papers"`
