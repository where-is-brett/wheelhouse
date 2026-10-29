<!-- docs/superpowers/plans/2026-10-29-archon-part-1-desk-interface.md -->
# Wheelhouse on Archon, part 1: the desk interface (v0.1.4)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every front end (the front desk's command, the board-context hook, the mod's bridge and courier, and the Copilot front end) reads and changes Wheelhouse through one interface, `desk/1`, with nothing the director can see changed, so a UI can be built later without reworking the core.

**Architecture:** A deep module, `scripts/desk/core.js`, holds the three operations (`read`, `act`, `watch`) over a versioned vocabulary. It is built from a *source* (where views, events and settings come from) and a *recorder* (how a decision is written), both injected: the helper gives it the files under `~/.wheelhouse` and its own record route; the stand-in helper gives it memory. The helper carries it on its existing socket as three routes; `scripts/desk/client.js` is the one client every front end uses. Views come back finished, in Calm's words, built by the same modules that build them today. Decisions need evidence: records signed with this computer's key (the prompt-record hook, the pane), the helper's confirm window (Copilot), or a paired client's key (a later UI).

**Tech Stack:** Node.js (ES modules), `node:test`, the helper's `node:http` server on a unix socket (a named pipe on Windows), ed25519 signatures from `scripts/state/signing.js`.

**Spec:** `docs/specs/2026-10-29-wheelhouse-on-archon-design.md`, section 5 (5.1 to 5.5), with 3 (the seams) and 17 step 1 (v0.1.4).

**Plan index:** `docs/superpowers/plans/2026-10-29-wheelhouse-on-archon.md`. This part depends on no early check and nothing of Archon. It can run beside part 2.

## Global Constraints

- British English; dates as 29 October 2026; a repository-relative path comment atop every file. No words such as "enhanced", "improved" or "fixed"; no model names; no AI attribution anywhere. Scripts in Node.js, running on macOS and Windows.
- **Nothing the director sees changes.** Every front end's output is the same text, buttons and cards as before. Each front-end task starts by pinning today's output as a fixture.
- The vocabulary is exactly spec 5.2's: views `glance`, `briefing`, `logbook` (tab), `waiting`, `card` (id), `work`, `settings`, `usage`, `preview` (card id), `why` (card id), `survey`; commands `answer` (card, option), `suggest` (card, words), `not-now` (card), `request` (words), `set` (setting, value), `all-stop`, `lift-all-stop`, `pair` (client); watch events `card-added`, `card-closed`, `glance-changed`, `work-changed`, `all-stop`, `notice`.
- **Evidence:** every `act` needs it except `request`, `not-now` and `all-stop` (spec 5.2). `suggest` needs it.
- **A stale act is refused, not applied**, with the line saying which answer counted.
- Front ends never read `~/.wheelhouse`, Archon or the host directly once moved, except the local fallback in Task 5, which runs the same core in process.
- Agents can reach the helper's socket and read views, and never decide: they hold no key.
- Don't touch `.github/workflows/ci.yml`. Run only the test files a change touches; the e2e files named in each task count as touched.

## Review Focus

1. **The helper isn't running when the board-context hook or the pane's tick runs** (a fresh sign-in, a crash). The briefing and the glance still show, from the local fallback; an act other than `all-stop` is refused with a plain line and kept where today's code keeps it (the pending folder). Tests in Tasks 5 and 7.
2. **A card changes between being shown and being clicked.** The answer names the card's hash and is refused, with the line saying which answer counted. Test in Task 3.
3. **An agent posts `/desk/act` with made-up evidence** (a record signed by a key that isn't this computer's, a client id that was never paired, a record for another card). Refused, and nothing is written. Test in Task 3.
4. **A watch cursor that is old, from another version, or damaged.** Treated as no cursor: the whole current state comes back as events (at least once), never an error. Test in Task 4.
5. **All stop pressed while the helper is down.** `act('all-stop')` still sets STOP through the local fallback. Test in Task 5.

---

### Task 1: The vocabulary and the core's shape

**Files:**
- Create: `scripts/desk/vocabulary.js`, `scripts/desk/core.js`
- Test: `tests/scripts/desk/core.test.js`

**Interfaces:**
- Produces: `DESK_VERSION = 'desk/1'`; `VIEWS`, `COMMANDS`, `WATCH_EVENTS` (frozen arrays, spec 5.2's names in its order); `NO_EVIDENCE = ['request', 'not-now', 'all-stop']`; `needsEvidence(command) -> boolean`.
- Produces: `checkVersion(message) -> { ok } | { ok: false, refused }`.
- Produces: `deskCore({ source, recorder, verifier, now }) -> { read(view, args), act(command, args, evidence), watch(cursor) }`, every method async, every answer `{ ok: true, v: 'desk/1', … }` or `{ ok: false, v: 'desk/1', refused: '<plain words>' }`, never a throw.
- Produces (the injected parts, as plain objects of async functions): `source = { views(names), events(), settings(), usage(), board({ offline }), stop(), preview(cardId), survey() }`; `recorder = { record(events), write(event), setStop(by), liftStop() }`; `verifier = { check(command, args, evidence) -> { ok, records?, refused? } }`.

- [ ] **Tests first:** `an unknown view is refused in plain words`; `an unknown command is refused`; `checkVersion refuses a message for another version` (`checkVersion({ v: 'desk/2' })`, exported from `core.js` and used by Task 5's routes); `an act that needs evidence is refused without it, and nothing is recorded` (a recorder spy sees no call); `request, not-now and all-stop need no evidence`; `a source that throws gives a refusal, never a throw`.
- [ ] Run `node --test tests/scripts/desk/core.test.js`: fails.
- [ ] Implement the vocabulary and the core's dispatch, with `read` and `act` delegating to per-view and per-command handlers that Tasks 2 and 3 fill (each unfilled one refuses "not built yet").
- [ ] Run: passes. Commit: `Add the desk interface's vocabulary and core`.

### Task 2: Views, finished in the core

**Files:**
- Create: `scripts/desk/views.js`, `scripts/desk/file-source.js`
- Modify: `scripts/frontdesk/cli.js` (move `workLines` and `surveyLines` out to `scripts/desk/views.js`, re-exported from the front desk for one release so nothing else breaks)
- Test: `tests/scripts/desk/views.test.js`, `tests/scripts/desk/file-source.test.js`

**Interfaces:**
- Consumes: Task 1.
- Produces: `readView(view, args, source, { now }) -> { ok, view, data, lines }`, where `data` is the structured model and `lines` the finished words. Each view is built by today's builder: `glance` by `glanceLine(model)` (`scripts/board/render.js`) from `boardModel` on the offline inputs; `briefing` by `briefingModel` and `briefingParts` (`scripts/briefing/`), with what `briefingIn` (`scripts/hooks/board-context.js`) adds today (survey, review, since, raise); `logbook` by `renderBoard(model, { tab })`, `tab` `'director'` or `'build'`; `waiting` by `numberedWaiting(views, events)`; `card` by the numbered card with `cardButtons(card, { preview })` and its 12-character `hashOf(text)` and its sha256 `dataHash`; `work` by `workLines`; `settings` by `effectiveSettings` and `settingsText`; `usage` by `usageFigures` and `weeklyShare`; `preview` by `previewFor`; `why` by the card's `Why?` lines; `survey` by `surveyLines`.
- Produces: `fileSource(project, { client, now }) -> source` reading `localViews`, `listEvents(stateDir(project))`, `readProfileViews`, `effectiveSettings`, `usageFigures`, `loadBoardInputs({ offline: true })`, `stopState()`, and `/pr/preview` through `client` (the helper's own, inside the helper).

- [ ] **Tests first**, each against a record fixture (`tests/helpers/record-fixture.js`) with a card, a work item, a setting and usage figures: `glance matches the status line's text for the same record`; `briefing matches what board-context gives today for the same record`; `waiting numbers cards as the Logbook does`; `card carries its buttons, its pane hash and its data hash`; `logbook build tab matches renderBoard`; `work matches the front desk's work lines`; `settings matches settingsText`; `survey matches surveyLines`; `a view for a project with no record refuses in plain words`.
- [ ] Run: fail. Implement. Run: pass.
- [ ] Run `tests/scripts/frontdesk/*.test.js`: still pass after the move.
- [ ] Commit: `Build the desk's views from today's builders`.

### Task 3: Acts and their evidence

**Files:**
- Create: `scripts/desk/acts.js`, `scripts/desk/evidence.js`
- Modify: `scripts/state/events.js` (the new kind `request`: `{ words, via }`, unprotected, in the kind list)
- Test: `tests/scripts/desk/acts.test.js`, `tests/scripts/desk/evidence.test.js`

**Interfaces:**
- Consumes: Tasks 1 and 2; `verify(record, enrolled)` and `readEnrolled()` from `scripts/state/signing.js`; `cardOutcomes(events, enrolled)` and the hash check `answersTo` from `scripts/state/views.js`; `SIGNED_LABELS` from `scripts/hooks/prompt-record.js`.
- Produces: evidence forms, exactly these:
  - `{ form: 'signed', records: Event[] }`: records made and signed with this computer's key, as the prompt-record hook and the pane make them today (`earned`, `keepEarned`). Checked as the helper's `doRecord` checks them (signature, this computer, id not held), and that each record is for the act's card and label (its set line).
  - `{ form: 'window' }`: the helper shows its confirm window (`doConfirm`'s path) and signs after the click. Copilot's way.
  - `{ form: 'chat-click', proof: 'chat-click' }`: an unsigned click in Copilot's chat, accepted only for a label outside `SIGNED_LABELS`, exactly as `/cards/chat-click` accepts it today.
  - `{ form: 'client', client: '<id>', at: '<ISO time>', sig: '<base64>' }`: a paired client's ed25519 signature over `canonicalJson({ command, args, at })`, within five minutes of `at`. Checked against `keys/clients.json` (Task 10).
- Produces: `checkEvidence(command, args, evidence, { enrolled, clients, views, events, now }) -> { ok, records?, refused? }`; `runAct(command, args, checked, { source, recorder }) -> { ok, changed, refused? }`.
- The acts: `answer { card, option, hash }` records the evidence's records and the plain `card-answer`; `suggest { card, words, hash }` the same, with the words; `not-now { card }` the card-answer `Not now`; `request { words, via }` writes a `request` event, which the `waiting` view shows and the board-context hook hands the First Mate; `set { setting, value }` writes the setting as `writeSetting` does, with its signed confirmation; `all-stop { by }` calls `setStop({ by })`; `lift-all-stop` needs a signed `lift-stop` action, then `liftStop()`; `pair { client }` is Task 10's.

- [ ] **Tests first** (`evidence.test.js`): `a record signed by another computer's key is refused`; `a record for another card is refused`; `a record already held is refused`; `a chat click on a signed label is refused`; `a chat click on Not now is accepted`; `a client id that was never paired is refused`; `a client signature older than five minutes is refused`.
- [ ] **Tests first** (`acts.test.js`): `an answer to a card that changed is refused with the line saying which answer counted` (the card's hash moved after it was shown); `an answer to a card already decided is refused, and the stale click is not recorded`; `answer writes the signed record and the card-answer once`; `set writes the setting and its confirmation`; `request is written and shows in waiting`; `lift-all-stop without a signed lift-stop action leaves STOP on`; `all-stop sets STOP with who set it`.
- [ ] Run: fail. Implement, reusing the helper's record path rather than copying it (move the checks inside `doRecord` into a function `checkRecord(record, { enrolled, held })` in `scripts/state/events.js` that both call). Run: pass.
- [ ] Run `tests/scripts/host/helper-answer.test.js`, `helper-stop.test.js` and every helper test touching `doRecord`: pass.
- [ ] Commit: `Add the desk's acts and the evidence they need`.

### Task 4: Watch, a resumable stream of changes

**Files:**
- Create: `scripts/desk/watch.js`
- Test: `tests/scripts/desk/watch.test.js`

**Interfaces:**
- Consumes: Task 2's views.
- Produces: `snapshotOf({ glance, waiting, work, stop, notices }) -> Snapshot` (card ids with their data hashes, the glance's text hash, each work item's state, STOP's `at` or null, notice ids); `encodeCursor(snapshot) -> string` (base64url JSON with `v: 'desk/1'`); `decodeCursor(string) -> Snapshot | null` (null for anything it can't read or another version); `changes(cursor, snapshot) -> { events, cursor }`.
- Events: `card-added { card, lines }`, `card-closed { card }`, `glance-changed { glance }`, `work-changed { work, state }`, `all-stop { on, at }`, `notice { id, lines }`. Notice ids are the courier's (`incident:<id>`, `health:<hash>`, `finished:<work>`), so the courier's sent set still holds.
- The helper answers each `watch` at once with the changes since the cursor (no long poll). The cursor holds the whole snapshot, so the helper keeps no state per watcher, and a client that loses its place passes its last cursor again and gets the same changes again (at least once).

- [ ] **Tests first:** `a new card gives card-added`; `a closed card gives card-closed`; `a card whose text changed gives card-closed then card-added`; `STOP turning on gives all-stop with its time`; `the same snapshot twice gives no events`; `a damaged cursor gives the whole state as events`; `a cursor from another version gives the whole state as events`.
- [ ] Run: fail. Implement. Run: pass. Commit: `Add the desk's watch stream`.

### Task 5: The helper's routes, the client, and the local fallback

**Files:**
- Create: `scripts/desk/client.js`, `scripts/desk/memory-source.js`
- Modify: `scripts/host/helper.js` (routes `/desk/read`, `/desk/act`, `/desk/watch`, added to `PLACED_ROUTES` and to `LEAN_ROUTES`, since Lean projects have a desk too), `scripts/host/helper-client.js` (a `desk` group: `read`, `act`, `watch`), `scripts/eval/stand-in-helper.js` (the same three routes over `memory-source.js`)
- Test: `tests/scripts/desk/client.test.js`, `tests/scripts/host/helper-desk.test.js`, `tests/scripts/eval/stand-in-helper.test.js`

**Interfaces:**
- Consumes: Tasks 1 to 4.
- Produces: route bodies `{ v: 'desk/1', project | cwd, view, args }`, `{ v, project | cwd, command, args, evidence }`, `{ v, project | cwd, cursor }`, answered by `deskCore` with `fileSource` and a recorder over the helper's own `doRecord`, `writeEvent`, `setStop` and `liftStop`. Desk writes run under the project's `oneAtATime` queue. Under STOP, reads, `watch`, `all-stop` and `lift-all-stop` are answered and other acts refused with `STOP_REFUSAL`, as today.
- Produces: `deskClient({ address, cwd, project, local = 'auto', timeout }) -> { read(view, args), act(command, args, evidence), watch(cursor) }`. It sends `v: 'desk/1'`. When the helper can't be reached and `local` is `'auto'` and the caller can read `~/.wheelhouse` (it isn't in the sandbox), `read`, `watch` and `act('all-stop')` run `deskCore` in process with `fileSource`; every other act is refused with a plain line ("Wheelhouse's helper isn't running; this is kept and sent when it is"), and the caller keeps its pending record as today. Inside the sandbox, `local` is never used.
- Produces: `memorySource(state) -> source` over the stand-in's in-memory events, views and settings.

- [ ] **Tests first** (`helper-desk.test.js`, built like `helper-answer.test.js`: `startHelper` on `testAddress`, `as(home, …)`, a signing key enrolled, a record fixture): `desk read returns the waiting view`; `desk act answer records a signed click`; `desk act with no evidence is refused and writes nothing`; `desk watch returns card-added for a new card, then nothing for the same cursor`; `under STOP, desk read answers and desk act answer is refused`; `a cwd inside the project is placed`; `a Lean project is served`.
- [ ] **Tests first** (`client.test.js`): `with no helper, read runs in process and gives the same view`; `with no helper, all-stop sets STOP`; `with no helper, answer is refused in plain words`; `local is never used when the home can't be read`.
- [ ] **Tests first** (`stand-in-helper.test.js`): `the stand-in answers desk read and desk act from memory`.
- [ ] Run: fail. Implement. Run: pass. Commit: `Carry the desk on the helper's socket, with one client`.

### Task 6: The front desk's command uses the desk

**Files:**
- Modify: `scripts/frontdesk/cli.js`
- Test: `tests/scripts/frontdesk/*.test.js`, `tests/e2e/front-desk.test.js`, a new `tests/scripts/frontdesk/desk-parity.test.js`

**Interfaces:**
- Consumes: `deskClient` (Task 5).
- Produces: `viewsOf` and every `client.state.views`, `client.profile.views` call become `desk.read`; card answers, `Why?`, `suggest`, `writeSetting` and `record` become `desk.act` with the evidence each makes today; `confirm` becomes `act(…, { form: 'window' })`. `readyIn` reads the column readiness through `read('settings')`. `keepAnswer` keeps its pending file when the act is refused for an unreachable helper, as today.

- [ ] **First, pin today's output:** `desk-parity.test.js` runs `cards`, `card`, `again`, `why`, `view` for each `VIEW_NAMES` entry, `suggest` and `preview` against a record fixture with the stand-in helper, and saves the text as fixtures under `tests/fixtures/desk-parity/frontdesk/`. Run it on the unchanged code and commit the fixtures: `Pin the front desk's output before the desk`.
- [ ] Move the calls. Run `desk-parity.test.js`: the output is byte-identical to the fixtures. Run the front desk's tests and `tests/e2e/front-desk.test.js`: pass.
- [ ] Commit: `Move the front desk's command onto the desk`.

### Task 7: The board-context hook uses the desk

**Files:**
- Modify: `scripts/hooks/board-context.js`
- Test: `tests/scripts/hooks/board-context.test.js`, `tests/e2e/board-and-usage.test.js`, `tests/scripts/hooks/desk-parity.test.js`

**Interfaces:**
- Consumes: `deskClient` with `local: 'auto'`.
- Produces: `briefingIn` and `cardsDue` read `read('briefing')` and `read('waiting')`; learning cards stay on `client.state.write` (the First Mate's own write, not a front-end decision); `markSeen` and `markRaised` stay where they are (they record what the director was shown, not state the desk owns).

- [ ] **Pin first:** the briefing and waiting context the hook gives for a fixture record, with the helper up and with it down, saved under `tests/fixtures/desk-parity/board-context/`. Commit the fixtures.
- [ ] Move the reads. Parity test: identical, helper up and down. Run the hook's tests and the e2e file: pass.
- [ ] Commit: `Move the board-context hook onto the desk`.

### Task 8: The mod's bridge and courier use the desk

**Files:**
- Modify: `scripts/mod/bridge.js`, `scripts/mod/status.js` (`paneModel`), `scripts/mod/press.js`, `scripts/mod/reply.js`, `scripts/mod/settings-pane.js` (`pressSetting`), `scripts/mod/courier.js`
- Test: `tests/scripts/mod/*.test.js`, `tests/e2e/mod.test.js`, `tests/scripts/mod/desk-parity.test.js`

**Interfaces:**
- Consumes: `deskClient` with `local: 'auto'`; `watch` (Task 4).
- Produces: `tick` builds the pane from `read('glance')` and `read('card', { id })`; `press`, `reply`, `why`, `suggest` and `setting` become `desk.act` with `{ form: 'signed', records }` made by `keepEarned` as today; `go` becomes `act('lift-all-stop', {}, { form: 'signed', records: [liftStopAction] })`; `stop` becomes `act('all-stop', { by: 'mod' })`. The courier keeps a cursor in `projects/<p>/mod/courier.json` beside its `sent` ids, calls `watch(cursor)` on each tick, and wakes on `card-added`, `all-stop` and `notice`, deduplicated by its `sent` set as today.

- [ ] **Pin first:** the pane model, the digest, and the courier's wake decisions for a fixture record over a sequence of ticks (a card added, STOP set, a card closed), saved under `tests/fixtures/desk-parity/mod/`. Commit.
- [ ] Move the calls. Parity test: identical. Run the mod's tests and `tests/e2e/mod.test.js`: pass. Run `npm run mod-check` (the TypeScript side reads `status.json`, which is unchanged).
- [ ] Commit: `Move the mod's bridge and courier onto the desk`.

### Task 9: The Copilot front end uses the desk

**Files:**
- Modify: `scripts/lean/cli.js` (`leanCommand`), `scripts/agents/copilot/hook-entry.js`
- Test: `tests/scripts/lean/cli.test.js`, `tests/e2e/copilot-lean.test.js`, `tests/scripts/agents/copilot/hook-entry.test.js`

**Interfaces:**
- Consumes: `deskClient` (inside the sandbox: never `local`).
- Produces: `click` becomes `act('answer', { card, option, hash }, { form: 'chat-click', proof: 'chat-click' })` (with `text` for Suggest a change… as `suggest`); `confirm` reads the card's hash with `read('card', { id })`, then `act(…, { form: 'window' })`; the Copilot stop word becomes `act('all-stop', { by: 'prompt' })`. `status`, `merge`, `undo` and `copy` stay on their Lean routes (they are the Lean store's own steps, not desk views or decisions).

- [ ] **Pin first:** `leanCommand`'s output for `click`, `confirm` and the stop word against the stand-in. Commit.
- [ ] Move the calls. Parity: identical. Run the tests named above: pass.
- [ ] Commit: `Move the Copilot front end onto the desk`.

### Task 10: Pairing a later app

**Files:**
- Create: `scripts/desk/clients.js`
- Modify: `scripts/desk/acts.js` (`pair`), `scripts/hooks/prompt-record.js` (`earned` learns the `pair-client` action from the Pair card's set line), `scripts/protection/settings.js` (deny `keys/clients.json` to agents, beside the keys already denied)
- Test: `tests/scripts/desk/clients.test.js`, `tests/scripts/hooks/prompt-record.test.js`, `tests/scripts/protection/settings.test.js`

**Interfaces:**
- Produces: `pairedClients() -> [{ id, name, publicKey, pairedAt }]`; `pairClient({ id, name, publicKey }, signedAction) -> { ok }` (only with a signed `pair-client` action naming that id and key's fingerprint); `unpairClient(id, signedAction) -> { ok }`; the file `<WHEELHOUSE_HOME>/keys/clients.json`.
- Produces: `act('pair', { client: { id, name, publicKey } })` needs no evidence to *ask*: it raises one card, **Pair this app**, composed by the existing composer at level 4, whose set line names the app and its key's fingerprint, with **Pair it** and **Not now**. The director's click on **Pair it** in the front desk or the pane signs the `pair-client` action, and the core enrols the key. An **Unpair** button on the settings view's row for each paired app signs `unpair-client`. (`pair` is the one command that may be sent without evidence, because it decides nothing until the click.)

- [ ] **Tests first:** `pair raises one Pair this app card naming the key's fingerprint`; `the click on Pair it enrols the key`; `an act signed by the paired key is accepted`; `an act signed by an unpaired key is refused`; `unpair removes it, and its next act is refused`; `agents are denied keys/clients.json`.
- [ ] Run: fail. Implement. Run: pass. Commit: `Pair a later app to the desk with its own key`.

### Task 11: The seam holds, and v0.1.4

**Files:**
- Create: `tests/scripts/desk/seam.test.js`
- Modify: `.claude-plugin/plugin.json`, `lineage/manifest.json`, `README.md`, `tests/scripts/agents/copilot-plugin.test.js` (the version, as the v0.1.3 release did in commit `3df86c32`), `types/index.d.ts` (the desk's types)

**Interfaces:**
- Produces: `seam.test.js` reads the front ends' files (`scripts/frontdesk/cli.js`, `scripts/hooks/board-context.js`, `scripts/mod/bridge.js`, `scripts/mod/status.js`, `scripts/mod/press.js`, `scripts/mod/reply.js`, `scripts/mod/settings-pane.js`, `scripts/mod/courier.js`, `scripts/lean/cli.js`, `scripts/agents/copilot/hook-entry.js`) and fails if any imports `localViews`, `listEvents`, `readProfileViews` or `loadBoardInputs`, or calls `state.views` or `profile.views`, outside `scripts/desk/`.

- [ ] Write the seam test; run it: passes (fails first if any call was missed in Tasks 6 to 9; move it).
- [ ] Bump the version to 0.1.4 in the four files, as `3df86c32` did. Add the desk's request and answer types to `types/index.d.ts`.
- [ ] Run every test file this part touched.
- [ ] Commit: `Release v0.1.4: the desk interface`.
- [ ] Open the pull request `The desk interface (v0.1.4)`. Message the main session with its link; the release tag is the main session's to make once CI is green.
