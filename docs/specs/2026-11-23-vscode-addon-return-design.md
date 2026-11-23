<!-- docs/specs/2026-11-23-vscode-addon-return-design.md -->

# Bringing back the VS Code add-on: design (23 November 2026)

The director unparked the VS Code add-on on 23 November 2026. This is the short design `docs/parked.md` asks for before it comes back. It builds on the old design (`docs/specs/2026-11-04-vscode-panel-design.md`, read with `git show parked/vscode-addon:<path>`) and says only what is new or different. Where this design is silent, the old one stands.

The director answered its decisions on 23 November 2026 (section 11). The build plan is `docs/plans/2026-11-23-vscode-addon-return-plan.md`.

## 1. What it is for now

Since the core cut, the director works in the chat alone. The chat serves a turn at a time. It leaves four needs that only something beside it can meet:

- **Seeing where things stand without asking.** A status bar item ("Wheelhouse · 2 need you") and a board that is always there.
- **Answering while the agent is busy.** A card can be answered in the panel during a long chat turn, so work isn't left waiting for the turn to end.
- **STOP one click away,** whatever the chat is doing.
- **A click that proves itself, for Copilot directors.** In Copilot chat a click is recorded as `chat-click`, "not proven", and the binding steps go to the helper's window. A panel click is signed by a paired app, so it is stronger than a chat click (section 3).

It serves both chats in VS Code: Copilot chat in agent mode first, and Claude Code's after (decision 4). The director's words: "Claude Code in VS Code doesn't work on the Windows laptop; let's start with Copilot in VS Code." The add-on itself knows nothing about which chat runs. It reads and acts on the project through the helper. What differs between the chats is how each holds a card back while the panel is live (section 3), and Copilot's is built and tried first.

Out of scope: Lean, the parked mod and pane, a panel in the terminal or Desktop, the VS Code Marketplace until after real use (decision 5), and anything that lets an agent ask for or decide something.

## 2. What it shows and does

One webview view in the activity bar, in the Inset look (old design section 5), and one status bar item.

| Shows | From desk/1 |
|---|---|
| Glance line, and the count of cards waiting | `read('glance')`, `watch` `glance-changed` |
| The waiting cards, each with its options and Not now | `read('waiting')`, `read('card')`, `watch` `card-added` / `card-closed` |
| The board: work in progress, by piece | `read('work')`, `watch` `work-changed` |
| All stop on or off | `watch` `all-stop` |
| Notices | `watch` `notice` |

What a panel click can do mostly follows from the evidence rules already on main (`scripts/desk/evidence.js`, `scripts/desk/acts.js`). It needs one new rule. Today `checkClient` takes a paired app's `answer` on any card. Unlike a chat click, it doesn't check whether the option signs (`signsOn`) or whether the card is one of Copilot's confirmed steps. So part 1 refuses a `client` answer to either kind of card and names where to answer it instead, as the chat-click branch does. The one exception is a merge card (decision 2): there the panel's Approve counts on a project with no real users, as a chat click's would (section 4). With that rule:

| The panel can | The panel can't, and where it happens instead |
|---|---|
| Answer a card, suggest, Not now (`answer`, `suggest`, `not-now`), including Approve on a merge card on a project with no real users (decision 2) | Lift All stop (`lift-all-stop` needs a signed record): the chat or the helper's window |
| Ask for something (`request`) | Change a setting (`set` needs a signed confirmation): the chat or `/wheelhouse:settings` |
| All stop (`all-stop`) | Safekeeping buttons (`safekeeping` needs a signed press) |
| Ask for an Unpair card for itself (`unpair`) | Approve a merge on a project with real users: the helper's window or the code host |
| Bring held-back cards up (`pull-cards`), and move a card back to the chat (`ask-here`, section 3) | Any of Copilot's confirmed steps (lifting STOP, guardrail change, unattended running, runbook step, CI push, allowance): the helper's window, as now |

A card answered in the panel reaches the chat at its next turn with the "since" line that is still on main (`scripts/cards/panel-words.js`, through `board-context.js`). VS Code has no way to add a chat line without a turn (old design 6.3).

## 3. How it talks to the helper

**Over desk/1, and nothing else.** The add-on is a thin client of the desk interface (`/desk/read`, `/desk/act`, `/desk/watch` on the helper's socket, `scripts/desk/client.js`). The old add-on packed its own copy of Wheelhouse's scripts and loaded the mod's modules. That is gone. Nearly every core change then rewrote `vscode/vsix.sha256`, which caused a long run of "the add-on's hash rewritten" merges. A thin client changes only when desk/1 changes.

The add-on needs two things from core without importing it. These are the helper's address (`helperAddress()` in `scripts/lib/paths.js`: `<home>/helper.sock` on macOS, a named pipe `\\.\pipe\wheelhouse-<user>[-<hash>]-helper` on Windows) and the project id. A small resolver kept in the add-on copies both, and a CI test checks it against core. On connect the add-on checks the helper says `desk/1`. If the helper says anything else, it shows "Update Wheelhouse" and decides nothing.

**How a click is trusted: the add-on pairs as an app (the design's choice, decision 1).** desk/1 already has paired apps:

1. On first start the add-on makes an ed25519 key pair and keeps the private key in VS Code's SecretStorage. It never reads this computer's key.
2. It sends `act('pair')` with its id, name and public key. The helper raises the level-4 "Pair this app" card, which shows the key's fingerprint, and the panel shows the same fingerprint.
3. The director clicks Pair it where signed clicks are made. The key is enrolled in `<WHEELHOUSE_HOME>/keys/clients.json`. Unpair it removes it. Nothing raises an Unpair card today (`unpairLine` exists, but no act composes the card), so part 1 adds one: the front desk's `unpair` command raises it, which works when the panel is gone or its key is in doubt, and the panel's Unpair button asks for the same card through a desk/1 `unpair` act.
4. Each act carries `{ form: 'client', client, at, sig }`, a signature over the command, its arguments and the time, good for five minutes. The helper checks it (`checkClient`) and writes the answer as `card-answer { where: 'panel', proof: 'client', by }`. A stale or changed card is refused, and the refusal says which answer counted.

Pairing needs a signed Pair it. In Claude Code the prompt-record hook signs it. In Copilot no chat click can, because `CHAT_DECIDES` allows merge cards only. So the Pair card joins the steps the helper's window confirms (`CONFIRMED_STEPS` in `scripts/agents/chat-clicks.js`). A confirmation alone isn't enough, because the helper enrols a key only on a signed `pair-client` action. So the window's Pair it must make that signed action, and the window's own write must enrol the key as `/state/record` does (today only `/state/record` calls `pairClient`). Unpair it works the same way. That is part 1. Since Copilot comes first, this is the pairing path the first trial uses.

The alternative, which the old add-on used, is to sign records with this computer's key inside VS Code's process (proof `add-on`). It reuses more code. It also brings back the packed core scripts and the hash churn, and it puts the computer's key in reach of every extension host. Section 6 compares the two. It is not taken (decision 1).

**The one-card rule (decision 3).** A card is answered in one place. While the panel is live, a card it shows waits in the panel and is held back from the chat. The chat then says "These cards are in the panel beside the chat", and each card in the panel offers "Ask me here" to move it back to the chat. The hold code is still on main and dormant (`paneLive`, `HOLD_FOR_PANE` in `scripts/lib/session-files.js`). Three things change:

- **Per project, not per session.** The add-on can't know which chat session is open.
- **Live means a paired app's watch is open on the helper,** not a file an agent might write. Today `/desk/watch` takes no evidence, and on Windows any process run as the director can reach the helper's pipe. So part 1 makes the panel's watch carry the app's signature, renewed within the five-minute window. Only then can an agent not fake it without the app's private key. Faking it would let an agent hide cards from the director, so this matters.
- **Ask me here is kept by the helper, per project.** The panel can't write a chat session's files. Its Ask me here is a desk/1 act, `ask-here`, signed by the app. The helper keeps the card's mark for the project, and the front desk hands that card out in the chat once, as `--here` does today. A card the chat asks with `--here` stays as it is.

How each chat holds a card back differs. Copilot has no hook that can stop `ask_user`, so its hold is the front desk's: `cards`, `again` and `pull-cards` print the panel line in place of the questions, and the First Mate's playbook (`adapters/copilot/tool-sheet.md`) says to tell the director the cards are in the panel and to stop there. Claude Code's hold is the card-check hook's, and it comes later with Claude Code (decision 4).

The new commands (`ask-here`, `unpair`) and the signed watch are additions to desk/1. Nothing that a desk/1 client sends today changes meaning, so the version stays `desk/1`. The vocabulary's note that "a new name is a new version" is narrowed to match: a name removed, renamed or changed in meaning is a new version, and a name added is not. An unsigned watch is still answered, but marks nothing live. An older helper refuses a command it doesn't know ("Wheelhouse can't …"), and the add-on reads that refusal as "Update Wheelhouse".

The alternative, no hold (cards in both places, the first answer counts), is not taken (decision 3).

## 4. What changed in the core since the tag

Tag `parked/vscode-addon` is commit b9d9aad4, an ancestor of main. The lift-out (PR #380) and the core cut removed what the old add-on loaded:

| The old add-on loaded | Now |
|---|---|
| `scripts/desk/mod-desk.js`, `scripts/desk/mod-pane.js`, `scripts/desk/pane-labels.js` | Gone. desk/1 views (`glance`, `waiting`, `card`, `work`) |
| `scripts/mod/press.js` (`pressCard`), `scripts/mod/settings-pane.js`, `scripts/mod/digest.js` | Gone. `act` with `client` evidence. Settings stay in the chat |
| `scripts/lib/vscode-pane.js`, `scripts/lib/pane-mark.js` (live mark file) | Gone. The helper's own record of an open watch |
| `scripts/agents/copilot/start-helper.js` | Now `scripts/host/start-helper.js`. The add-on starts nothing, and with no helper it says so |
| `scripts/lib/copilot-numbers.js` | Now `scripts/agents/copilot/numbers.js`. Not needed |
| `scripts/lean/project.js` | Gone with Lean. Not needed |
| `scripts/host/helper-client.js`, `scripts/hooks/prompt-record.js`, `scripts/hooks/kit.js`, `scripts/lib/stop.js`, `scripts/state/card-lines.js`, `scripts/lib/paths.js`, `scripts/lib/run.js` | Still there. The thin add-on imports none of them |

Other changes the build must meet:

- **Copilot is back on its own engine** (10 November). Its `cards.binding` is `['policy-hook', 'window', 'host']` and no longer names `add-on`. Claude Code's is `['signed-hook']`.
- **The gate** (`scripts/gate/conditions.js`) counts an unsigned approval only for the chat proofs, and the helper's own call passes it only signed approvals. A `proof: 'client'` answer on a merge card doesn't count today. Decision 2 widens ruling P5-48 so that it does, on a project with no real users. The helper turns the panel's Approve on a merge card into the approval the card earns, as it does the window's click (`windowEarned`), signed by the helper and naming `proof: 'client'` and the app. The gate counts an approval naming `client` only on a project with no real users, and the helper passes `realUsers` (`launchedIn(project)`) to the gate so it can tell. On a project with real users the panel's Approve is refused before anything is written, and the refusal names the window or the code host.
- **The update command** (`scripts/update/addon.js`) now offers to remove an installed add-on. It turns back into an offer to install or update it.
- **Proof `add-on`.** The helper doesn't refuse it outright. It is inert because nothing makes it any more. The audit still lists it (`scripts/audit/report.js`, `scripts/agents/copilot/numbers.js`). With pairing it stays unused, and part 1 adds a test that a record naming it decides nothing.

## 5. What comes back from the tag, and what doesn't

| Comes back (reworked onto desk/1) | Stays out |
|---|---|
| `vscode/extension.cjs` (view, status bar, one command to open the panel) | `vscode/lean.cjs` and every Lean branch |
| `vscode/nonce.cjs`, and the press guard in `vscode/press.cjs` (only the pane's buttons, latest nonce) | `vscode/chat-tools.cjs`: no chat or language-model tools at all, not even read-only ones |
| `vscode/pane/render.js`, `vscode/pane/style.css`, `vscode/media/wheel.svg` | `vscode/versions.cjs` (the Copilot versions record) |
| `vscode/package.json` (`untrustedWorkspaces: false`, no URI handler, no API) | The packed `wheelhouse/` copy of core scripts, and `vscode/desk.cjs` as it was |
| `scripts/addon/pack.js`, `validate.js`, `hash.js`, `install.js`, `allowed.js` | `scripts/agents/vscode-held.js` and the old Copilot-only hold (the hold is now per project, section 3) |
| CI's `addon/validate.js` and `hash.js --check` steps, and `release.yml`'s vsix job | `probes/lib/vscode-click.mjs` as a director step (agents drive it instead, section 9) |
| `tests/vscode/*`, `tests/scripts/addon/*` | |

## 6. Security

The add-on must not widen what any agent can do. The webview rules of old design section 7 stand: a fresh nonce for each draw, a strict CSP, `localResourceRoots: []`, no `retainContextWhenHidden`, no panel in untrusted workspaces, and `validate.js` in CI checking that only the pane's buttons reach an act. New or different:

- **No VS Code command, URI, public API, chat tool or language-model tool reaches an act.** Copilot agent mode can run VS Code commands, so the only command is "open the panel". `validate.js` checks the contributed commands and that no `lm`/chat tool is registered.
- **A panel click decides only what desk/1 lets a paired app decide** (section 2). Lifting STOP, settings, safekeeping and Copilot's confirmed steps stay where they are.
- **The app's key is only as safe as the place that keeps it.** On macOS, SecretStorage uses the Keychain. On Windows it uses DPAPI, which any process run as the director can decrypt. In Windows Standard with no sandbox, Copilot's terminal runs as the director, so there the panel key is no stronger than what guards this computer's key today. Copilot on the Windows laptop is the first real use (decision 4), so this is the case that matters first. A panel Approve there is about as strong as a chat click, which is why decision 2 keeps it to projects with no real users. The design says so plainly and claims no more. With the computer-key way (not taken) the same holds, and the computer's key is in reach too.
- **Unpairing is one click** and stops the app at once. The app can't pair itself, because the Pair card needs a signed click.
- **What it can't defend against** is unchanged from old design 9: another extension in the same VS Code, or an agent that can read keys. The sandbox, which denies agents `WHEELHOUSE_HOME`, stays the boundary on macOS.

## 7. Windows and macOS

- **The extension** runs in VS Code's extension host on both, unsandboxed, as the director. It is plain Node.js, and its only platform split is the helper's address (socket or named pipe).
- **Install.** On both, `code --install-extension <vsix>` when `code` is on PATH (often not on macOS until the director adds it). Otherwise "Install from VSIX…", and the card names the file. Company policy (`extensions.allowed`, the `AllowedExtensions` policy) is read before the offer, as `scripts/addon/allowed.js` did.
- **Tests run on both,** as CI does now: Linux and macOS in CI, Windows by hand on the laptop, as for the rest of Wheelhouse.
- **Copilot first.** Claude Code in VS Code doesn't work on the Windows laptop, so the first target there is Copilot chat in VS Code (decision 4). On the Mac both chats run, and Claude Code's turn comes after Copilot's.

## 8. Packaging and updates

- **A `.vsix` built on each release** by `release.yml`, with its sha256 in `vscode/vsix.sha256` and checked by CI. Because the add-on no longer packs core scripts, the hash changes only when the add-on does.
- **The add-on carries the desk version it speaks.** Wheelhouse's update command compares it with the installed add-on (`code --list-extensions --show-versions`). It offers one card, "Install the panel" or "Update the panel", in place of today's removal offer. Setup offers it once, as optional.
- **The Marketplace** is revisited after real use (decision 5). Until then the `.vsix` ships with each GitHub release only.

## 9. Testing without the director

The director is never needed for testing. Agents do all of it:

- **Unit tests** with a stand-in for the VS Code API (`tests/vscode/helpers.js` from the tag), and the desk/1 client against a real helper in a throwaway `WHEELHOUSE_HOME`.
- **`validate.js`** on the built `.vsix`, in CI.
- **Pictures.** Every pane state drawn from fixtures in light, dark and high contrast, then screenshotted and read by an agent.
- **A real VS Code driven by agents** (`@vscode/test-electron`, or the tag's probe driven through tmux), on the Mac, then on the Windows laptop. In a trial's throwaway home the agent holds the test computer key, so it signs Pair it itself. Pairing is not a director step in testing.
- **A trial run as for the rest of Wheelhouse,** Copilot chat in VS Code first (decision 4): on the Mac, driven by agents, then on the Windows laptop. A card answered in the panel during a busy turn, a merge approved from the panel on a test project with no real users, STOP from the panel, a held card brought back with Ask me here, pairing and unpairing through the window. Copilot runs on its cheapest model, and the trial counts its requests against the month's allowance. Claude Code in VS Code is tried later, on the Mac.

## 10. Build parts

The plan (`docs/plans/2026-11-23-vscode-addon-return-plan.md`) splits the work into parts that separate sessions can build, and says which can run at the same time. In short:

1. **Core seam.** Refuse a paired app's answer on a card whose option signs (merge cards aside) or on a confirmed step. Make the window's Pair it and Unpair it signed actions that enrol and remove the key. Add the Unpair card and the `ask-here` act. Require a signed watch, renewed within five minutes, and keep the panel's live mark per project. Add a test that proof `add-on` decides nothing.
2. **Merge approval from the panel** (decision 2): the helper's earned approval with `proof: 'client'`, the gate's rule, and `realUsers` passed to the gate.
3. **Add-on shell** from the tag, thin over desk/1: resolver, version check, pairing, its key in SecretStorage, the signed watch.
4. **Panel drawing:** Inset look, every state, fixtures and pictures.
5. **Acts and guards:** the press guard, client signatures, the Ask me here and Unpair buttons, and `validate.js` reworked for the new rules.
6. **One card, one answer for Copilot:** the per-project hold in the front desk, Ask me here, the First Mate's playbook, the since line.
7. **Pack, hash, CI steps and the release `.vsix` job.**
8. **Offer, install and update** through setup and `/wheelhouse:update`, with the allow-list read.
9. **Agent-run trial** with Copilot chat in VS Code, on the Mac, then the Windows laptop.
10. **Claude Code in VS Code:** the card-check hook's hold per project, and its trial on the Mac.
11. **Papers:** `docs/parked.md`, design section 22, `HANDOVER.md`, README.

## 11. Decisions

The director answered on 23 November 2026. Each card is kept below as it was asked, with the answer above it.

**1. How should the panel prove a click is yours?**

**The design's choice: pair it as an app, with its key in SecretStorage.** This card was not put to the director, so its recommendation stands as the design's own choice.

- *What this is:* the panel needs a way to show the helper that you, not an agent, clicked.
- *Why it comes to you:* it sets how safe the panel is and how much work it takes to build.
- *Options:* **Pair it as an app.** You click Pair it once, and you can unpair it with one click. The panel never touches this computer's key. **Or sign with this computer's key**, as the old panel did. That reuses more old code, but the panel would then need rebuilding with nearly every Wheelhouse change, and every VS Code extension would be near the key.
- *Recommendation:* pair it as an app.
- *Meanwhile:* nothing is built until you choose.

**2. Should a click in the panel count as approving a merge?**

**Decided 23 November 2026: yes, on the same terms as a chat click** (projects with no real users only). This widens ruling P5-48, under which an unsigned answer counted only as a chat click does: a paired app's signed click now counts as well. Section 4 says how.

- *What this is:* today a merge needs your signed approval, or for Copilot a chat click on a project with no real users. A panel click is neither yet.
- *Why it comes to you:* it decides whether merges can be approved from the panel.
- *Options:* **Yes, on the same terms as a chat click** (projects with no real users only). **Yes, everywhere.** **No:** approve merges in the chat or the helper's window as now.
- *Recommendation:* yes, on the same terms as a chat click. This widens an earlier ruling (P5-48), under which an unsigned answer counts only as a chat click does. On a Mac, where the sandbox keeps agents from the panel's key, a panel click is better proof than a chat click. On a Windows laptop with no sandbox it is about the same. Either way, projects with real users still need the window.
- *Meanwhile:* the panel shows merge cards and says where to approve them.

**3. When the panel is open, should cards leave the chat?**

**Decided 23 November 2026: hold them in the panel.** While the panel is open, cards wait in it, and "Ask me here" moves one back to the chat.

- *What this is:* a card could show only in the panel, or in both places.
- *Why it comes to you:* it changes where you look for questions.
- *Options:* **Hold them in the panel.** The chat says they're there, and "Ask me here" brings one back. **Show them in both,** and the first answer counts.
- *Recommendation:* hold them in the panel. One card in one place is the rule Wheelhouse was built on, and "Ask me here" is the way out.
- *Meanwhile:* the build can start with the parts that don't depend on this.

**4. Both chats at once, or one first?**

**Decided 23 November 2026: Copilot chat in VS Code first, Claude Code later.** This was not an option on the card. The director's words: "Claude Code in VS Code doesn't work on the Windows laptop; let's start with Copilot in VS Code." The build and the trial put Copilot in VS Code first (sections 9 and 10). Copilot ships; this changes nothing else that is parked (Lean stays out, section 1).

- *What this is:* the panel can serve Claude Code in VS Code and Copilot chat in VS Code.
- *Why it comes to you:* doing one first is quicker to try. Doing both is the whole job.
- *Options:* **Both together.** **Claude Code first, then Copilot.**
- *Recommendation:* both together. The panel doesn't depend on which chat runs, and Copilot directors gain the most from a click that proves itself.
- *Meanwhile:* nothing waits on this but the trial's plan.

**5. Where do people get the panel?**

**Decided 23 November 2026: from each Wheelhouse release.** Setup and the update command offer to install it. The Marketplace is revisited after real use.

- *What this is:* the panel is a file VS Code installs.
- *Why it comes to you:* the VS Code Marketplace needs a publisher account in your name and a review for each release.
- *Options:* **From each Wheelhouse release only.** Wheelhouse offers to install and update it. **The Marketplace as well,** later.
- *Recommendation:* from each release only, for now. Revisit the Marketplace after real use.
- *Meanwhile:* releases carry the `.vsix`.
