<!-- docs/superpowers/plans/2026-11-02-copilot-remaining-parts.md -->
# What is left of Copilot's Parts 9, 10 and 11: the build plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Copilot gets the sandbox, company settings, Locked, the person's approval on GitHub, the safety look after risky periods, and the VS Code add-on with its pane, as the build stands today on Archon, with every real step behind a switch that stays off until its sitting passes.

**Architecture:** The old plan (`docs/superpowers/plans/2026-10-21-wheelhouse-copilot.md`, Parts 9 to 11) predates the Archon design. Its targets move: the sandbox goes round Copilot nodes through the clean home, not round the old background sessions; the host's approval becomes a condition of the broker's permit, on GitHub only; the add-on is a desk client that signs its own records. Everything else is reused: the desk, the mod's press code, the confirm window, the Lean store and the helper.

**Tech Stack:** Node.js (ES modules), `node:test`; the add-on is CommonJS at its edge, loaded by VS Code, with no npm tool and no dependency.

**Spec:** `docs/specs/2026-10-20-other-agents-design.md` (sections 6.3, 6.4, 8.5, 8.6, 11, 14) and `docs/specs/2026-10-29-wheelhouse-on-archon-design.md` (sections 4.5, 4.6, 5.3, 12, 13). Where they differ, the Archon design wins.

**How to use this plan.** Each part is one fresh session with this file, the specs and the repository. Each ends with a pull request and one message to the main session. Run the test files a change touches; leave `npm test` to CI. Builders ask the main session, never the director.

## What became of each task

Every task of the old Parts 9 to 11, decided from the code on 2 November 2026.

| Old task | Decision | Why, and where it goes |
|---|---|---|
| 9.1 Sandbox level and test | **Changed** | Still needed: `scripts/engine/archon/adapter.js:228` says Copilot steps have no sandbox, while the Archon design (line 614) counts on one. The target moves from the background sessions (`adapters/copilot/sessions.js`, off, and deleted at v0.3.0) to the clean home (`scripts/agents/copilot/engine-home.js`). The test runs per computer and CLI version, not per session. Task A1 |
| 9.2 Company settings and baseline | **Changed, slightly** | Still needed. The IT note also names Archon, Bun and the clean home. Task A2 |
| 9.3 Locked on Copilot | **Changed** | Still needed. The entry is `scripts/agents/copilot/hook-entry.js` (`scripts/hooks/copilot-entry.js` never existed), and Locked waits for this Mac's sandbox test. Task A3 |
| 9.4 Chat click that binds | **Changed** | Still needed, same entry correction. `postToolUse` is registered in the policy hook file alone, and the record passes through the proof option Part C adds. Task D3 |
| 9.5 Approval on the host | **GitLab half replaced; GitHub half changed** | GitLab is lost under Archon (Archon design, lines 200 and 713), so `setGitlabApproval`, the Free ready-branch `/push` refusal, Premium's fixtures and `approvals_required: 2` are not built. The second-person approval existed for chat reviews, and Archon's reviews are nodes signed by the helper (line 217). Merges now pass `brokerDecision`'s permit (`scripts/engine/broker/rules.js:317`) and, until v0.3.0, the helper's `/merge` gate. Task B1 |
| 9.6 New keys and the look at own files | **Changed** | Still needed. `renewalDue` is taken (`scripts/host/connection.js:200`), so it is named `keyRenewalDue`. The look also covers the clean home, and the risky-period rule gains Copilot steps run outside the sandbox. Tasks B2 and B3 |
| 9.7 Middle and Full end to end | **Replaced** | Archon runs the build: `tests/e2e/engine-*.test.js` with the fake engine, and scenarios 38 to 41 retargeted (Archon design, line 220). A short test of what this plan adds remains. Task B4 |
| 10.1 Manifest and proof | **As written** | Task C1 |
| 10.2 Pane and status bar | **Changed** | The model comes from the desk (`read('glance', { pane: true })`, as `scripts/mod/bridge.js:585`), not from `status.json`, which only the mod's tick writes. The add-on also starts the helper on a work computer (section 8.5). Task C2 |
| 10.3 Buttons that sign | **Changed** | Reuses `pressCard`, which already signs locally and acts through the desk with signed evidence (`scripts/mod/press.js:173`, `scripts/desk/evidence.js`). It gains the proof `add-on`. Not a paired client: section 6.3 has the add-on sign with the computer's key, as the mod's bridge does. Task C3 |
| 10.4 Versions and packing | **Changed** | Still needed. The `.vsix` must carry its own copy of the scripts it imports, since the add-on may run with no Wheelhouse release on the computer. A local `.vsix` has no update to switch off. Task C4 |
| 11.1 The add-on's Lean jobs | **Changed** | Lean is kept (Archon design, line 212). Rather than copying the helper's checks, the add-on starts the helper itself in VS Code's process, where no helper answers. Tasks D1 and D2 |
| 11.2 VS Code's Claude harness | **Changed** | A front end only now: builds stay on Archon. Built behind a switch, and check 54 turns it on. Task A4 |
| 11.3 Designs, data note, handover | **Changed** | Also marks what Archon replaced, and retires Task 9.7's and GitLab's lines. Task D4 |

**Also not built:** skills and agents contributed through the add-on (Lean's kit carries them, so check 55 only decides Part D's chat tools); the VS Code Marketplace; and any change to `adapters/copilot/sessions.js`, which goes at v0.3.0.

## The parts

| Part | What | Changes how work runs? | Waits on | Sittings it needs before its switch goes on |
|---|---|---|---|---|
| A | The sandbox, company settings, Locked and the Claude harness | No, switches off | nothing | S3, then S5; S1 for the harness |
| B | The host's approval, new keys, the look, the end-to-end test | No, switches off; the look is on | nothing | S4 |
| C | The add-on: pane, buttons, packing | No: optional and installed by hand | nothing | S6 |
| D | The add-on at Lean, the chat click, the close | No, switches off | A, B, C merged | S1, S6, then S7 |

**Side by side.** A, B and C run together, so the three waiting builders each take one. D runs alone, after them. The later of A, B and C to merge rebases on the rows below.

## Files shared

| File | Who changes it | Rule |
|---|---|---|
| `scripts/lib/copilot-numbers.js` | A (`COPILOT_SANDBOX_CHECKED`, `CLAUDE_HARNESS_CHECKED`), D (`ADDON_LEAN_READY`) | One line each. B keeps its switch in `scripts/host/approval-ready.js` |
| `scripts/hooks/prompt-record.js`, `scripts/mod/press.js` | C owns the `proof` option | D uses it; A and B don't touch these |
| `scripts/host/helper.js`, `scripts/gate/conditions.js` | B (the host's approval on both merge routes) | A, C and D don't touch them, except D's start-up option if the helper needs one |
| `scripts/setup/computer.js` | A | |
| `adapters/copilot/index.js`, `adapters/copilot/permissions.js` | A | |
| `scripts/board/health.js` | A (the sandbox line), B (the look's line) | One row each |

## Sittings

Agents do every step they can; each sitting reaches the director through the main session as one card, as the old plan's Held items describe. Those step lists stand, with these changes.

| Sitting | Checks | What it turns on | Copilot use |
|---|---|---|---|
| S1 (still held) | 59, 70, 54 | Task D3 (`C6_PASSED`), Task A4 (`CLAUDE_HARNESS_CHECKED`) | Real chat turns: the card states them and needs the director's yes |
| S3 | 57 | Task A1 (`COPILOT_SANDBOX_CHECKED`) | One sandboxed probe on Mac, one on Windows: the card states the requests and needs the director's yes (check 74 found that even Auto counts premium requests) |
| S4 | 68, GitHub half only | Task B1 (`HOST_APPROVAL_CHECKED`), or Task B5 | None |
| S5 | none; Locked's password | Task A3, on this Mac | None. Comes after S3, since Locked forces the sandbox on |
| S6 | 55, 65, 67, 72 | Task C2's move offer, Tasks D1 and D2 (`ADDON_LEAN_READY`) | Check 72's chat tools need a turn or two: the card states them and needs the director's yes. Check 55 moves here from S1, since the add-on is what it tries |
| S7 | Safety scenarios on Windows | Nothing; it closes the work | Runs scenarios 38 to 41 and the safety set under Archon: needs the director's yes for its spend, and comes after Part D |

S4's GitLab half and H3 are retired with GitLab, and sitting S2 is unchanged.

**No builder runs Copilot for real.** Parts A to D use stand-ins and recorded answers only: no `copilot` call against the account, no trial, no paid service. The first real use of each piece is its sitting.

## Choices this plan makes

1. **The sandbox settings live in the clean home,** so one set covers every Copilot step on the computer. A step's own worktree is named by the CLI's working-folder form if Copilot's documentation has one; otherwise by the engine's worktree folders, which lets one run write to another's worktree, and the level's record says so.
2. **The web list is the union of the domains of this computer's Copilot projects,** since the home is shared. A home per project is left for later.
3. **The sandbox test runs at setup and when the CLI version or the home's settings change, not per session.** A test per node would spend a request per node. The result is the computer's, kept outside any project, and carries the version and the settings' digest; a result that doesn't match counts as no test. The digest leaves the web list out, so a new project's domains don't undo the test.
4. **The add-on signs with this computer's key and acts through the desk,** with the proof `add-on`. It takes no client key: the design's client key is for a later app.
5. **The `.vsix` carries the closure of what it imports,** found by walking the imports, so it never loads code from a project, a checkout or a plugin folder. Its folder is already a control path the guards refuse (`scripts/lib/agent-control.js`, `.vscode/extensions`).
6. **At Lean, the add-on runs the real helper in its own process,** with no copy of its checks. It never starts VS Code's program as a Node.js process, which the design rules out without the company's agreement.
7. **GitHub's route is the person's review of a pull request.** The narrow connection's key may act as the person, and GitHub refuses a self-review. Then the route fails at S4, and Task B5 is the other route.
8. **Every switch starts off,** as the old plan's call 11 says, so code built before its sitting refuses rather than trusts.

## Global Constraints

- British or Australian English; dates as 2 November 2026; a path comment on line 1 or straight after front matter.
- No model name, no private project and nothing about the director's other work in the repository.
- Node.js only for scripts and hooks; they run on macOS and Windows. `vscode/` is CommonJS at its edge, per the old plan's call 8.
- Don't use "enhanced", "improved" or "fixed" in names, comments or user-facing text.
- Every word the director sees is plain, and passes through the same glossary and Calm words as the mod's.
- Key names of Copilot's and VS Code's settings are read from their documentation and recorded at the head of the file that uses them, with the date and address, as `scripts/protection/locked.js` does.
- No change to anything about the current release, and no version bump.
- Nothing here may change what a Claude Code project does.
- **Only the add-on's own pane's buttons can press a binding click.** No command, URI handler, chat tool or message without the pane's nonce reaches a press.

## Review Focus

1. **A press from anywhere but the pane:** a VS Code command, a URI, a chat tool, or a message without the nonce must record nothing. Pinned in Tasks C1 and C3.
2. **A stale pane:** a pane left open overnight, or reloaded, must not press with an old nonce or an old card. Pinned in Task C3.
3. **A sandbox test that has gone stale:** after a CLI update, the board must stop saying the sandbox holds, and the home must not keep a setting no test covered. Pinned in Task A1.
4. **Locked on a Mac whose sandbox doesn't work:** forcing it would stop all Copilot work there, so Locked must refuse first. Pinned in Task A3.
5. **Two VS Code windows, or a real helper starting while the add-on's runs:** one helper answers and no merge happens twice. Pinned in Task D1.

---

## Part A: The sandbox, company settings, Locked and the Claude harness

**Files in all:** see each task. **Tests:** `tests/scripts/agents/copilot-sandbox.test.js`, `tests/scripts/agents/copilot-company.test.js`, `tests/scripts/protection/locked-copilot.test.js`, `tests/scripts/agents/claude-in-vscode.test.js`. **Waits on:** nothing. **Done means:** the four tasks merged, both switches still false, no Copilot project's run changed, and check 57's probe ready for S3.

### Task A1: The sandbox round Copilot nodes, and its test

**Safety: yes**

**Files:**
- Create: `adapters/copilot/sandbox.js`, `adapters/copilot/settings.js`, `scripts/agents/copilot/sandbox-test.js`, `probes/57-copilot-sandbox/run.js`, `tests/scripts/agents/copilot-sandbox.test.js`
- Modify: `adapters/copilot/index.js` (the `settings` part built, `pending` emptied), `adapters/copilot/permissions.js:162` (`levelAllowed` takes the test's result), `scripts/agents/copilot/engine-home.js` (writes and checks the settings), `scripts/lib/copilot-numbers.js`, `scripts/board/health.js`, `tests/scripts/agents/copilot-adapter.test.js`

**Interfaces:**
- Produces: `COPILOT_SANDBOX_CHECKED = false`.
- Produces: `sandboxSettings({ worktreeBases, domains, helper, platform }) -> object`: the sandbox on, unsandboxed commands off, writes held to the working folder (choice 1), the network held to `domains` and the helper's socket, and reads denied for `keysDir()`, `~/.copilot`, `~/.agents`, the credential paths (`credentialPaths`), and Archon's private files (`scripts/protection/archon.js`).
- Produces: the adapter's `settings: { project: sandboxSettings, local: () => ({}) }`, with `checkAdapter` passing.
- Produces: `runSandboxTest({ run, version, settings, home }) -> { passed, version, digest, results: [{ name, refused }] }`, run in a scratch home holding `settings`, never the clean home, so the test comes before the home has them. A probe session tries: reading `keysDir()`'s files; `gh auth token`; `git credential fill`; a token in its environment; a write outside its folder; an unlisted host; the local network other than the helper; one tool call the guard must refuse. `passed` only if every one is refused, except the network on Windows, which is reported. The result is kept in `<wheelhouseHome>/agents/copilot-sandbox.json`, since it is the computer's. `digest` covers the settings without `domains` (choice 3). When a Copilot project's run starts, the helper records a `level` event for it (`data.level: 'sandbox'` when `sandboxLevel` holds), which `scripts/audit/report.js:192` already reads.
- Produces: `sandboxLevel({ result, version, digest, checked = COPILOT_SANDBOX_CHECKED }) -> boolean`: true only when the switch is on and the result passed for this version and digest.
- `writeEngineHome` writes the settings only when `sandboxLevel` is true, and removes them otherwise. When `sandboxLevel` is true, `engineHomeProblem` also compares the home's file with `sandboxSettings(...)`: a file missing or changed is a problem, so no Copilot step starts (`copilotEngineProblem`, `scripts/engine/archon/adapter.js:231`).
- The board keeps saying Copilot's steps run outside the sandbox until `sandboxLevel` is true.
- `run` is always given: nothing here starts `copilot`. The real `run` lives in the probe, and only S3 calls it.

- [ ] **Step 1: Read Copilot's documentation** for the sandbox's setting names and working-folder form; record them, dated, at the head of `adapters/copilot/sandbox.js`.
- [ ] **Step 2: Write the tests:** `one try let through fails the test`, `the network on Windows is reported, not failed`, `the result is kept for the computer`, `a run's level is recorded`, `the test runs in a scratch home`, `a new project's domains leave the test standing`, `a home whose settings were removed or changed starts no Copilot step`, `a result for another version counts as no test`, `a result for other settings counts as no test`, `the switch off keeps the settings out of the home`, `settings left in the home are removed when the test goes stale`, `the keys and the engine's private files are denied`, `the adapter lists nothing as pending`.
- [ ] **Step 3: Run them;** expect them to fail. **Step 4: Implement; run** `node --test --import ./tests/helpers/test-home.js tests/scripts/agents/copilot-sandbox.test.js tests/scripts/agents/copilot-adapter.test.js`. Expect them to pass.
- [ ] **Step 5: Commit** (`"Hold Copilot's steps in its sandbox once the test refuses every try"`).
- [ ] **After S3 (a later session):** run the probe on the Mac with the director's yes, write `docs/checks/57-copilot-sandbox.md`, update `docs/checks/README.md`, and set the switch by its own pull request. Check 57's answer goes to the director as a card.

### Task A2: Company settings and the published baseline

**Safety: yes**

**Files:**
- Create: `docs/copilot/baseline/managed-settings.json`, `docs/copilot/baseline/policy-hooks.json`, `docs/copilot/it-note.md`, `scripts/agents/copilot/company.js`, `tests/scripts/agents/copilot-company.test.js`
- Modify: `scripts/setup/computer.js` (around line 372, the Locked offer on a Copilot project)

**Interfaces:**
- Produces: the baseline of the spec's section 6.4: the sandbox forced on and failing closed, no unsandboxed commands, no "Allow all", reads of the keys, the credential folders and Copilot's own folders denied, `forceRemoteSettingsRefresh` on, every company repository marked as having real users, and the policy hook file running the guards.
- Produces: `readCompanySettings({ platform, read }) -> { managed: object | null, policyHooks: string[] }` from `/Library/Application Support/GitHubCopilot/`, `%ProgramFiles%\GitHubCopilot\`, `/etc/github-copilot/policy.d/` and `C:\ProgramData\GitHub\Copilot\policy.d\`, leaving out Wheelhouse's own file. Where company settings exist, setup offers the organisation route, not Locked.
- `it-note.md` is one page: what Wheelhouse installs and runs, where (Archon, Bun, Copilot's CLI, the clean home, the helper), what it changes, and the baseline.

- [ ] **Step 1: Write the tests:** `the baseline holds every rule the spec names`, `company settings found means no Locked offer`, `Wheelhouse's own file isn't read as the company's`, `the IT note fits one page (60 lines)`.
- [ ] **Step 2: Run them; expect failure. Step 3: Write; run the file; expect a pass. Step 4: Commit** (`"Publish the baseline a company applies, and read what it has set"`).

### Task A3: Locked on Copilot, on the Mac

**Safety: yes**

**Files:** Modify `scripts/protection/locked.js`, `scripts/setup/computer.js`; test `tests/scripts/protection/locked-copilot.test.js`.

**Interfaces:**
- Consumes: `sandboxLevel` (Task A1); `readCompanySettings` (Task A2).
- Produces: `lockedCopilotFiles({ dir, nodePath, address, domains }) -> [{ path, content, mode }]`: `/Library/Application Support/GitHubCopilot/managed-settings.json` (the baseline's rules, forcing the sandbox for all Copilot work on the computer) and `/etc/github-copilot/policy.d/wheelhouse.json`, running the managed copy of `scripts/agents/copilot/hook-entry.js` (already covered by `LOCKED_FOLDERS`), which does nothing outside a Locked project. Written by Locked's existing password step at S5.
- A file there that isn't Wheelhouse's refuses with `NOT_OURS`. `lockedCopilotReady({ result, version, digest }) -> { ready, why }` refuses until `sandboxLevel` is true on this Mac. The card says the sandbox is forced for every Copilot chat on this computer.

- [ ] **Step 1: Write the tests:** `the files force the sandbox computer-wide`, `the policy hook does nothing outside a Locked project`, `nothing is offered on Windows`, `Locked for Copilot refuses until this Mac's sandbox test passes`, `a company's file is never replaced`, `Claude Code's Locked files are unchanged`.
- [ ] **Step 2: Run them; expect failure. Step 3: Implement; run the file; expect a pass. Step 4: Commit** (`"Offer Locked for Copilot on the Mac once its sandbox test has passed"`).

### Task A4: VS Code's Claude harness

**Safety: yes** (it reuses Claude Code's guards in another front end)

**Files:** Modify `scripts/agents/index.js` (an identity `claude-in-vscode` sharing Claude Code's adapter, with its own safety line), `scripts/setup/computer.js`, `scripts/lib/copilot-numbers.js`; test `tests/scripts/agents/claude-in-vscode.test.js`.

**Interfaces:**
- Consumes: `readCompanySettings` (Task A2).
- Produces: `CLAUDE_HARNESS_CHECKED = false`. Setup offers it beside the Copilot route only with the switch on, and where company settings allow. It's a front end only: builds stay on Archon.
- If S1 finds check 54 failed, the identity is taken out by a later pull request and the ledger says so.

- [ ] **Step 1: Write the tests:** `setup offers it only where the check passed and the company allows it`, `its safety line names what differs from Claude Code`.
- [ ] **Step 2: Run them; expect failure. Step 3: Implement; run them; expect a pass. Step 4: Commit** (`"Offer VS Code's Claude agent as a front end once check 54 passes"`).

---

## Part B: The host's approval, new keys, the look and the end-to-end test

**Tests:** `tests/scripts/host/host-approval.test.js`, `tests/scripts/state/key-renewal.test.js`, `tests/scripts/health/own-files.test.js`, `tests/e2e/copilot-engine.test.js`. **Waits on:** nothing. **Done means:** Tasks B1 to B4 merged, `HOST_APPROVAL_CHECKED` false, no change to a Claude project's merge, and S4's test repository steps written for the agent.

### Task B1: The person's approval on GitHub, in the permit

**Safety: yes** (approvals)

**Files:**
- Create: `scripts/host/host-approval.js`, `tests/scripts/host/host-approval.test.js`
- Modify: `scripts/host/approval-ready.js`, `scripts/host/protection.js`, `scripts/host/github.js` (reading a pull request's reviews), `scripts/engine/broker/rules.js`, `scripts/gate/conditions.js`, `scripts/host/helper.js` (`brokerPermit`, around line 4476, and `doMerge`'s input to `gateDecision`, around line 3440), `scripts/board/health.js`

**Interfaces:**
- Produces: in `approval-ready.js`, `HOST_APPROVAL_CHECKED = false` and `hostApprovalReady({ host, plan } = {}) -> boolean`, true only for `host === 'github'` with the switch on. GitLab stays false, so `scripts/host/protection.js:454` and the waker are unchanged.
- Produces: `hostApproved({ adapter, number, sha, person }) -> Promise<boolean>`: the person's latest review of the pull request is `APPROVED`, with `commit_id === sha`. Any other head, a later dismissal or changes requested is false.
- Produces: `githubApprovalRules() -> object`, the `pull_request` rule with one required approval, stale approvals dismissed on push and last-push approval on; used by `switchOnGithub` only for a Copilot project with real users where `hostApprovalReady` is true.
- `hostApprovalNeeded(project) -> boolean`: a Copilot project with real users where `hostApprovalReady({ host: 'github' })` is true.
- `brokerDecision` and `gateDecision` both gain `hostApproval`: `undefined` where it isn't needed, else a boolean. Where given, a merge passes only when it is `true`, refusing with `the director's approval on GitHub of <short> isn't there`. A review that can't be read is `false`. `brokerPermit` and `doMerge` each build it, so neither merge route gets round it, and `checkPermit`'s early returns don't touch it.
- The bot's or anyone else's review never counts.

- [ ] **Step 1: Write the tests** from documented answers, hand-written into `tests/fixtures/github-reviews/` with a header saying so: `a review of the head counts`, `a commit added after the approval removes it`, `the bot's own approval doesn't count`, `a dismissed review doesn't count`, `GitHub is not ready until its check passes`, `GitLab is never ready`, `a Claude project's merge is unchanged`, `the broker refuses a merge the host's approval is missing from`, `the /merge route refuses it too`, `a failed review read refuses the merge, on both routes`.
- [ ] **Step 2: Run them; expect failure. Step 3: Implement; run the file, `tests/scripts/engine/broker*` and `tests/scripts/gate/`. Expect a pass. Step 4: Commit** (`"Require the person's own approval on GitHub for a Copilot project with real users"`).
- [ ] **After S4 (a later session):** the agent makes a test pull request with the narrow connection; the director approves it on GitHub's page. Write `docs/checks/68-host-approval.md`, and set the switch by its own pull request. If GitHub refuses the review because the connection acts as the person, go to Task B5. Either answer goes to the director as a card.

### Task B2: New keys after risky periods

**Safety: yes** (signing, secrets)

**Files:** Create `scripts/state/key-renewal.js`, `tests/scripts/state/key-renewal.test.js`; modify `scripts/state/signing.js`.

**Interfaces:**
- Produces: `keyRenewalDue({ events, now, lastRenewal }) -> { due, why }`, the name kept apart from `renewalDue` in `scripts/host/connection.js:200`: due after a period at Unattended ended, after a week with an Ask allowance (`level` events with `data.allowance`), and after a week in which a Copilot step ran outside the sandbox, each since `lastRenewal`.
- Produces: `replaceSigningKey({ enrolled, now }) -> { computer, publicKey }`: a new key, enrolled alongside the old so earlier records still verify; a card then asks the person to renew the connection (one code on the host's page).
- The card goes through the desk; nothing renews without the director's click.

- [ ] **Step 1: Write the tests:** `renewal is due after Unattended and after a week with an Ask allowance, and not otherwise`, `a week of Copilot steps outside the sandbox makes it due`, `records signed before the new key still verify`, `a key isn't replaced without the card's click`.
- [ ] **Step 2: Run them; expect failure. Step 3: Implement; run the file; expect a pass. Step 4: Commit** (`"Make a new signing key after risky periods, on the director's click"`).

### Task B3: A look at Wheelhouse's own files

**Safety: yes**

**Files:** Create `scripts/health/own-files.js`, `tests/scripts/health/own-files.test.js`; modify `scripts/board/health.js`.

**Interfaces:**
- Produces: `ownFilesBaseline({ home, root, engine }) -> Map<path, hash>` over Wheelhouse's install, `~/.copilot/hooks`, `~/.copilot/agents`, `~/.copilot/settings.json`, the login entry, the add-on's folder and the clean home's hook file and settings, never its sign-in; `ownFilesChanged(baseline, now) -> string[]`.
- The baseline is kept under the Wheelhouse home and made afresh after setup and each pinned update. The weekly lines of the board name any change, in plain words.

- [ ] **Step 1: Write the tests:** `a changed hook file is named`, `the sign-in is never read`, `an update of Wheelhouse makes a new baseline`, `no baseline yet says nothing`.
- [ ] **Step 2: Run them; expect failure. Step 3: Implement; run the file; expect a pass. Step 4: Commit** (`"Look for changes to Wheelhouse's and Copilot's own files each week"`).

### Task B4: Copilot on the engine, end to end

**Safety: no**

**Files:** Create `tests/e2e/copilot-engine.test.js`.

- [ ] **Step 1: Write the test** with the fake engine (`scripts/engine/fake.js`), a real helper and a stand-in GitHub: a Copilot project with real users, the switch set by the test; the permit refuses without the person's review; a commit after it removes it; the merge passes with it; the audit report shows the level and no gaps, then one gap after a merge made outside. No GitLab and no Middle or Full tier in it.
- [ ] **Step 2: Run it; expect a pass. Step 3: Commit** (`"Test a real-user Copilot project's merge end to end on the fake engine"`).

### Task B5 (held): The environment route

**Only if S4 finds that GitHub refuses the person's review.** The route is the spec's other one, a required check that waits on a protected environment the person approves. It needs a workflow file in the project, and protected environments on private repositories depend on the GitHub plan, so it goes to the director as a card first, and comes back here with their answer. `hostApproved` keeps its signature and reads the run's approvals; `githubApprovalRules` adds the required check.

---

## Part C: The add-on

**Tests:** `tests/scripts/addon/validate.test.js`, `tests/scripts/addon/pack.test.js`, `tests/vscode/*.test.js`. **Waits on:** nothing. **Done means:** the four tasks merged, CI running the proof; a packed `.vsix` installed into a scratch VS Code profile on the Mac (`code --user-data-dir <tmp> --extensions-dir <tmp> --install-extension <file>`, then `--list-extensions`), which uses no Copilot; and S6's steps ready. VS Code is a stand-in in every test: `activate(context, { vscode })` takes it, and `require('vscode')` is only the default.

### Task C1: The manifest, and the proof that nothing else can press

**Safety: yes** (binding clicks)

**Files:**
- Create: `vscode/package.json`, `vscode/extension.cjs` (CommonJS; whatever it takes from `scripts/` is loaded with dynamic `import()`), `scripts/addon/validate.js`, `tests/scripts/addon/validate.test.js`
- Modify: `.github/workflows/ci.yml` (the `validate` job at line 88 also runs `node scripts/addon/validate.js`)

**Interfaces:**
- Produces: `checkAddon({ pkg, sources }) -> string[]`: a problem for any `contributes.commands` entry other than `wheelhouse.openPane`; any `uriHandler` or `onUri` activation; any `languageModelTools` or chat participant whose handler reaches a press; `registerCommand` with any other id; a call to `pressCard`, `pressSetting`, `signedRecords` or `keepEarned` outside `onPaneMessage`; or a message handler that doesn't check the nonce. `extensionDependencies` none; `extensionKind: ['workspace']`.

- [ ] **Step 1: Write the tests:** one per forbidden form, each failing, and the add-on's own sources passing.
- [ ] **Step 2: Run them; expect failure. Step 3: Implement; run the file; expect a pass. Step 4: Commit** (`"Prove from the add-on's package and source that only its pane's buttons can press"`).

### Task C2: The pane and the status bar

**Safety: no**

**Files:** Create `vscode/pane/render.js`, `vscode/pane/style.css`, `vscode/desk.cjs`, `tests/vscode/render.test.js`, `tests/vscode/activate.test.js`; modify `vscode/extension.cjs`.

**Interfaces:**
- Consumes: `deskClient` (`scripts/desk/client.js`): `read('glance', { pane: true, helperUp, at, timeZone })` as `scripts/mod/bridge.js:585` asks it, and `watch(cursor)` to redraw; the Calm visual system (main design section 23) and the sketch in the spec's section 8.6; the pane design in the mod's pane.
- Produces: `renderPane(model, { nonce }) -> string`: HTML with every text escaped and a content security policy naming the nonce, colours from VS Code's theme variables: the name with STOP at the top right, the verdict, the cards with **Not now**, **See it ↗**, **Why?**, **Approve** and **Suggest a change…**, the smaller items with amber dots, and **Board**, **Settings** and **Briefing** at the foot.
- Produces: the status bar item `Wheelhouse · <n> need you`, opening the pane; the first-run offer **Put Wheelhouse on the right** behind `PANE_MOVES = false` in `vscode/pane/render.js`, showing the picture of the drag once until check 67 says VS Code allows the move.
- Produces: `startHelperIfNeeded({ ask, spawn, node, root }) -> Promise<void>`: where Node.js runs and the helper doesn't answer, runs `start-helper.js start` (spec section 8.5). Where neither runs, the pane says the helper isn't running and shows the last view it could read.

- [ ] **Step 1: Write the tests:** `card text with markup is shown as text`, `the status bar counts needs-you items`, `the first-run offer shows once`, `the helper is started when it doesn't answer`, `the pane says so when nothing answers`.
- [ ] **Step 2: Run them; expect failure. Step 3: Implement; run them; expect a pass. Step 4: Commit** (`"Draw the add-on's pane and status bar from the desk"`).

### Task C3: Buttons that sign

**Safety: yes** (binding clicks, All stop, signing)

**Files:** Create `vscode/press.cjs`, `tests/vscode/press.test.js`; modify `vscode/extension.cjs`, `scripts/mod/press.js:173` (a `proof` option), `scripts/hooks/prompt-record.js:777` (`keepEarned` writes `data.proof`), `tests/scripts/gate/*` (a case).

**Interfaces:**
- Consumes: `pressCard`, `whyCard`, `suggestCard` (`scripts/mod/press.js`); `pressSetting` (`scripts/mod/settings-pane.js`); `digestText` (`scripts/mod/digest.js`).
- Produces: `onPaneMessage(msg, deps)` takes `{ nonce, card, hash, choice }`. The nonce is 32 random bytes, made for each draw, kept in memory only, and replaced on each redraw. A message with no match records nothing. A deciding choice calls `pressCard({ ..., proof: 'add-on' })`, which signs in VS Code's own process, and acts through the desk with signed evidence, never asking the helper to sign.
- **STOP** calls `act('all-stop')` at once, which needs no evidence; **Lift STOP** is a binding press; settings press as the mod's settings pane; **Briefing** shows `digestText`'s text with no Copilot turn; VS Code's own notification for needs-you items, previews ready, features finished and All stop. A typed "yes" in the chat never counts.
- An approval with proof `add-on` already counts for a project with real users (`scripts/gate/conditions.js:54`, `adapters/copilot/index.js:30`).
- The option leaves every existing call as it was: no `proof` given, no field written.

- [ ] **Step 1: Write the tests:** `a press with a stale hash records nothing and says why`, `a press without the pane's nonce records nothing`, `a press with the last draw's nonce records nothing`, `a reloaded pane's old message records nothing`, `STOP is set at once`, `the add-on never calls the helper to sign`, `a press's record names the proof add-on`, `a press with no proof writes what it wrote before`.
- [ ] **Step 2: Run them; expect failure. Step 3: Implement; run them with `tests/scripts/mod/` and `tests/scripts/hooks/prompt-record*`; expect a pass. Step 4: Commit** (`"Sign the director's presses in the add-on's own process"`).

### Task C4: Versions, the closure and packing

**Safety: no**

**Files:** Create `scripts/addon/pack.js`, `tests/scripts/addon/pack.test.js`, `tests/vscode/versions.test.js`; modify `vscode/extension.cjs`, `scripts/agents/copilot/start-helper.js` (the `addon` command).

**Interfaces:**
- Produces: the add-on writes `versionsFile()`'s `{ vscode, runtime }` (`scripts/agents/copilot/versions.js:54`) at start and on change.
- Produces: `closureOf({ root, entries }) -> string[]`, walking static and dynamic imports from the add-on's entries; a bare import other than `node:` or `vscode` throws.
- Produces: `pack({ root, out }) -> file`: a `.vsix` (a zip holding `extension.vsixmanifest`, `[Content_Types].xml` and `extension/`, with the closure under `extension/wheelhouse/` beside a `package.json` of `{ "type": "module" }`), written with Node.js's own `zlib` and a small zip writer, no npm tool. The add-on's `import()` reads only from its own folder.
- Produces: `start-helper.js addon`: on the card's click, packs and installs with `code --install-extension <file>`. A local install takes no updates, so no setting changes.

- [ ] **Step 1: Write the tests:** `the .vsix lists every file and opens with unzip`, `the closure holds everything the add-on imports`, `a bare import refuses the pack`, `the versions file is written`, `the add-on imports nothing from outside its folder`.
- [ ] **Step 2: Run them; expect failure. Step 3: Implement; run them; expect a pass. Step 4: Install into a scratch profile as Done means says. Step 5: Commit** (`"Pack the add-on without npm tools and record VS Code's versions"`).

---

## Part D: The add-on at Lean, the chat click, the Claude harness and the close

**Tests:** `tests/vscode/lean.test.js`, `tests/vscode/chat-tools.test.js`, `tests/scripts/hooks/policy-click.test.js`. **Waits on:** Parts A, B and C merged. **Done means:** the tasks merged, every switch still off unless its sitting has passed, and S7 ready.

### Task D1: The helper in VS Code's process, and the merge

**Safety: yes** (merges, approvals)

**Files:** Create `vscode/lean.cjs`, `tests/vscode/lean.test.js`; modify `vscode/extension.cjs`, `scripts/lib/copilot-numbers.js`, `scripts/lean/store.js:66`.

**Interfaces:**
- Consumes: `startHelper` (`scripts/host/helper.js:1013`) and the Lean routes it serves; `adoptProject`, `makeSigningKey`, on a pane card the director clicks.
- Produces: `ADDON_LEAN_READY = false`. `SIGNED_LEAN_PROOFS` takes `add-on` only with the switch on, as `scripts/agents/chat-clicks.js:8` does for `C6_PASSED`, so the add-on's press merges nothing at Lean before S6.
- With the switch on, on a Lean project where no helper answers and no Node.js runs, `startLean({ address, run })` starts the real helper in VS Code's own process, at the usual address, and stops it on deactivation. It takes nothing but `git`, the project's test command, and the window's own programs. A failure to bind the address means another window or a real helper has it, and this window is a client. The one `process.execPath` in the helper (`scripts/host/helper.js:4723`, the foreman's route) refuses in this mode.
- Merges go through `/lean/merge` after an add-on press for that commit; the copy follows every approval.

- [ ] **Step 1: Write the tests:** `a merge runs only after an add-on press for that commit`, `the switch off starts nothing, and the add-on's proof isn't taken`, `the second window is a client`, `a real helper taking over leaves one helper`, `nothing spawns VS Code's own program, the foreman's route included`.
- [ ] **Step 2: Run them; expect failure. Step 3: Implement; run them; expect a pass. Step 4: Commit** (`"Run the helper inside VS Code where Node.js can't run"`).

### Task D2: The chat's way in, and what the add-on records

**Safety: yes** (All stop, records)

**Files:** Create `tests/vscode/chat-tools.test.js`; modify `vscode/package.json` (the chat tools), `vscode/lean.cjs`, `scripts/addon/validate.js` (the two tools named as allowed, and held to no press).

**Interfaces:**
- Produces: the chat tools `wheelhouse_record` and `wheelhouse_board`, writing nothing binding: only `/cards/chat-click` and the board. Where a company switches the tools off, `.wheelhouse/inbox/`: each file read once and removed, and never binding.
- Each terminal command the chat runs is recorded (`window.onDidStartTerminalShellExecution`); All stop also cancels the chat's running request where check 72 found a way.

- [ ] **Step 1: Write the tests:** `a chat tool's write is never binding`, `an inbox file is read once and removed`, `an inbox file can't approve`, `a terminal command is recorded`, `the proof still refuses a tool that reaches a press`.
- [ ] **Step 2: Run them; expect failure. Step 3: Implement; run them; expect a pass. Step 4: Commit** (`"Give the chat a way to Wheelhouse's state that binds nothing"`).

### Task D3: A chat click that binds, at Locked or under company settings

**Safety: yes** (approvals)

**Files:** Modify `scripts/agents/copilot/hook-entry.js`, `scripts/protection/locked.js` (`postToolUse` in the policy hook file); test `tests/scripts/hooks/policy-click.test.js`.

**Interfaces:**
- Consumes: `C6_PASSED` (`scripts/lib/copilot-numbers.js:33`), set after S1; `isInside(managedDir(), self)` as `scripts/hooks/kit.js:420` tells the managed copy; `earned` and `keepEarned` with `proof`.
- Produces: `policyClick(input, deps)`: when the entry runs as the managed copy and `C6_PASSED` is true, an `ask_user` answer in `postToolUse` is signed as Claude Code's is, with proof `policy-hook`; otherwise nothing changes. A project with real users doesn't take `policy-hook` unless the Copilot adapter's list and the gate's real-user list both name it, which the task leaves as it is.

- [ ] **Step 1: Write the tests:** `a policy hook signs only when C6_PASSED`, `the person's own hook copy never signs`, `the clean home's copy never signs`.
- [ ] **Step 2: Run them; expect failure. Step 3: Implement; run them; expect a pass. Step 4: Commit** (`"Sign a chat click only from a policy hook, once check 59 allows it"`).

### Task D4: The designs, the data note and the handover

**Safety: no**

**Files:** Modify `docs/specs/2026-10-20-other-agents-design.md` (status; a new section for the old plan's calls and this plan's choices that are design; section 13's stale line on Locked, as call 9 says; Middle, Full and GitLab marked as the Archon design has them), `docs/data.md` (Copilot's section, with spec section 6.6's lines), `docs/superpowers/plans/2026-10-21-wheelhouse-copilot.md` (a note at Part 9 pointing here), `README.md`, `HANDOVER.md`.

- [ ] **Step 1: Write;** run `npm run private-check`. Expect it to pass; CI runs the whole suite.
- [ ] **Step 2: Commit** (`"Bring the designs, the data note and the handover up to date for Copilot"`).

## Where the spec's sections are built

| Spec section | Task |
|---|---|
| Other agents 6.3 (the add-on's buttons; policy hook) | C3, D3 |
| Other agents 6.4 (levels, tests, Locked, company settings, real users) | A1, A2, A3, B1 |
| Other agents 6.4 (what stays exposed; new keys; own files) | B2, B3 |
| Other agents 6.4 (Lean with the add-on) | D1, D2 |
| Other agents 8.5 (the add-on starts the helper) | C2 |
| Other agents 8.6 (the add-on) | C1 to C4 |
| Other agents 11 (C1, C2, C4, C6, C12, C14, C15, C19) | S1, S3, S4, S6 |
| Archon 4.6 and 13 (clean home; the sandbox still stands) | A1 |
| Archon 5.3 (who may decide) | C3 |
| Archon 12.4 (the permit) | B1 |
