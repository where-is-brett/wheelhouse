<!-- docs/specs/2026-11-04-vscode-panel-design.md -->

# The Wheelhouse panel in VS Code: design (4 November 2026)

> **Parked or reversed on 7 November 2026,** see `docs/specs/2026-11-07-core-cut-design.md`. Parked, with the VS Code add-on (core cut, section 4.2). What is parked, and how it comes back, is in `docs/parked.md`.

**Status:** approved. The director took every recommendation on 4 November 2026 (section 11). Nothing here is built yet; it is built after the one-card build lands (D5).

## 1. Why this, and why now

On 4 November 2026 the director asked whether a director using VS Code with Copilot could have the same panel they have in Claude Code: the board, cards with buttons, and All stop, beside the chat.

**It can, and most of it already exists.** Part C of Copilot's remaining parts (#222) built a VS Code add-on in `vscode/`, and Part D (#225) taught it Lean:

| Built | Where |
|---|---|
| A webview view with the wheel icon in the activity bar, opened by a click on the status bar | `vscode/package.json`, `vscode/extension.cjs` |
| The status bar's "Wheelhouse · 2 need you" | `statusText` in `vscode/pane/render.js` |
| The pane drawn from the desk's pane model (`read('glance', { pane: true })`), the same model the mod draws | `vscode/pane/render.js`, `scripts/desk/mod-pane.js` |
| Buttons that sign in the add-on's own process with the computer's key, proof `add-on`, through the mod's `pressCard` | `vscode/press.cjs`, `scripts/mod/press.js` |
| STOP and Lift STOP; Board, Settings and Briefing views | `vscode/pane/render.js` |
| A package check that nothing but the pane's own buttons can press | `scripts/addon/validate.js` (CI's validate job) |
| A `.vsix` packed without npm tools, installed by the helper's card with `code --install-extension` | `scripts/addon/pack.js`, `scripts/addon/install.js`, `start-helper.js addon` |
| The helper run inside VS Code's process where no Node.js may run, behind `ADDON_LEAN_READY` (off) | `vscode/lean.cjs` |
| Two chat tools that bind nothing (`wheelhouse_board`, `wheelhouse_record`) and an inbox | `vscode/chat-tools.cjs` |

So the question is not whether VS Code can show the panel, but what stands between this add-on and a director using it for real. Four things do:

1. **It has never run in a real VS Code.** Checks 55, 65, 67 and 72 (sitting S6) have not run.
2. **It looks like the 20 October sketch,** not the Inset design the director chose for the mod on 31 October (`docs/specs/2026-10-31-pane-design.md`), and it draws only some of the pane's states.
3. **A director at Lean can't get it.** The only install route packs the add-on with Node.js and installs it with VS Code's `code` command. Lean promises neither.
4. **It doesn't follow the one-card rule** (`docs/specs/2026-11-04-one-card-design.md`). That design says "Copilot has no panel", which the add-on makes untrue, so a card could be asked in Copilot's chat and shown in the panel at once.

This design covers those four. It is a design for finishing the add-on, not a new one.

## 2. Goals, non-goals and anti-goals

**Goals**

- **The same panel in VS Code.** A director on Copilot sees what a director on Claude Code sees in the mod: the same states, words and order, in the Inset look, in VS Code's own light, dark and high-contrast themes.
- **One card, one answer,** as in Claude Code: a card is answered in the panel when the panel is live, the chat doesn't ask it as well, and an answer given in one place is never asked again in the other.
- **A director with no admin rights and no Node.js can install it,** in a few clicks, when their company allows it.
- **A click in the panel is as trustworthy as a click in the mod.** No new way for an agent to press.

**Non-goals**

- Skills and agents contributed through the add-on (check 55 decides only Part D's chat tools; Lean's kit carries the skills).
- Running Copilot from the panel. The panel never starts a Copilot turn, so it never spends a Copilot request.
- A panel for Copilot CLI with no VS Code.
- Moving the panel into the secondary side bar for the director. VS Code doesn't let an extension do it (section 9); check 67 says whether a command can.

**Anti-goals** (failure even if it works)

- **Breaking Lean's promise.** Lean must still work, start to finish, with VS Code, Copilot and git, and nothing installed. The add-on is an opt-in extra, offered after Lean works, never a step of it.
- **A button an agent can press.** If Copilot's agent, a chat tool, a command, a link or another extension's call can produce a binding click, the design has failed.
- **Spending the director's Copilot requests** from the panel.
- **A second, drifting copy of the pane.** The VS Code pane must not go its own way from the mod's in words, order or states.

## 3. Who installs it, and how

### 3.1 What VS Code allows (official docs, read 4 November 2026; pages dated 28 October 2026)

- **No admin rights are needed** to install an extension: VS Code installs it into the person's own extensions folder.
- **"Install from VSIX…"** in the Extensions view installs a local `.vsix` file. `code --install-extension <file>` does the same from a terminal. Neither needs the Marketplace or Node.js. (Publishing an extension: https://code.visualstudio.com/api/working-with-extensions/publishing-extension)
- **The Marketplace** scans each new version for malware, signs it at publish time, and VS Code checks that signature on install. The first install from a new publisher asks the person to trust the publisher. A verified-publisher badge needs six months of history and a domain held for six months. Publishing needs a publisher and the `vsce` tool. Azure DevOps' global personal access tokens are retired on 1 December 2026, and the recommended route is Trusted Publishing from GitHub Actions (`vsce publish --oidc`). (Extension runtime security: https://code.visualstudio.com/docs/configure/extensions/extension-runtime-security)
- **Companies can limit extensions.** The `extensions.allowed` setting, and the `AllowedExtensions` policy that overrides it on managed computers, allow extensions by publisher, extension id, version or platform. With a list in place, anything not on it is blocked. The rules **apply to a `.vsix` too**, by the id inside the package, and "do not verify the package's origin". An already-installed extension that isn't allowed is disabled. GitHub Enterprise customers can run a private marketplace. (Extensions in the enterprise: https://code.visualstudio.com/docs/enterprise/extensions)
- **An extension runs with VS Code's own permissions:** it can read and write files, use the network and start programs. So can every other extension the person has.

### 3.2 The route

**A `.vsix` attached to each Wheelhouse release, installed with Install from VSIX, is the route now; the Marketplace follows once the add-on has passed its sitting.** *The director's decision D1, 4 November 2026.*

- **CI packs it.** A new release job (CI has none today: `.github/workflows/ci.yml` only) runs `scripts/addon/pack.js` (already Node.js only, no npm tools) on a pushed tag and attaches `wheelhouse-<version>.vsix` to the GitHub release. It never makes a tag.
- **The hash is in the tagged commit.** `pack.js` already packs byte for byte the same each time (sorted names, a fixed time), so the expected hash can be known before the tag. The commit that sets a release's version also writes `vscode/vsix.sha256`, packed from that commit; CI's validate job fails when the file doesn't match a fresh pack. The release job packs again on the tag and refuses to attach a `.vsix` whose hash differs. A release with no `.vsix` is one the add-on isn't offered for.
- **The front desk fetches and checks it,** at Lean too: one download with the computer's own `curl` (built into macOS and Windows 10 and later), and the hash checked with `shasum -a 256` on a Mac or `certutil -hashfile … SHA256` on Windows, against `vscode/vsix.sha256` in the director's own copy of Wheelhouse at its pinned tag, which came by git, not with the download. A mismatch stops it, in plain words. Nothing is run.
- **Who runs these at Lean.** The front desk runs `curl`, the hash check and `code --install-extension` with Copilot's own terminal tool, so Copilot's approval prompt shows for each as usual and the director allows them there. The card's yes says what will be asked; it isn't itself the approval.
- **The director installs it** with one of two steps, whichever the computer allows: the front desk runs `code --install-extension <file>` where `code` is on the PATH (it usually is on Windows), after the director's yes on the card; or the card shows the two clicks (Extensions view, ⋯, Install from VSIX…) and the file's place. Either way it is the director's choice on a card, never a step of setup.
- **Where Node.js runs,** `start-helper.js addon` stays as it is today, except that on a release tag it checks its pack against `vscode/vsix.sha256`, so the add-on is the same bytes everywhere. Between tags (a branch, a test computer) it packs from the checkout as today and says the add-on is unreleased.
- **Updates.** A local `.vsix` takes no updates by itself, which suits the pinning rule (other-agents design, section 8.6). The update route (`/wheelhouse:update`, being designed now) offers the new release's `.vsix` with the rest. This design asks that route for one line; it doesn't design it.

**The Marketplace, later.** Once S6 passes, a release job publishes the same `.vsix` with Trusted Publishing from GitHub Actions. That buys malware scanning, the Marketplace's signature and one-click installs, at the cost of a publisher account in the project's name and VS Code's update setting, which the add-on then asks the director to turn off for it (as the design already says). Nothing in the add-on changes. A Marketplace install and a `.vsix` install have the same id, so a company's allow list treats them the same.

### 3.3 When a company blocks it

- **Before offering it,** the front desk reads whether an allow list is in force and whether it names `wheelhouse.wheelhouse` (or the publisher). It reads only what any user can: on Windows, `reg query HKLM\Software\Policies\Microsoft\VSCode /v AllowedExtensions`; on a Mac, the managed preference for VS Code, if any; and VS Code's user setting. The exact keys are for check 72 to confirm on a managed computer.
- **When it is blocked,** the add-on isn't offered. The director gets one line: Wheelhouse works in the chat as it does now, and their IT can allow `wheelhouse.wheelhouse` if they'd like the panel. The IT note (Part A's) gains a paragraph on what the add-on does and doesn't do.
- **When a policy later blocks an installed add-on,** VS Code disables it. The pane goes, the live mark (section 6.1) stops within 45 seconds, and cards go back to the chat. Nothing is lost.

### 3.4 Lean's promise

The promise in `README.md` stays true: Lean needs VS Code with Copilot, and git, and installs nothing. The panel is offered only after Lean is working, as an extra. The README's Lean paragraph gains one sentence, for example: "If you'd like the panel beside the chat, Wheelhouse can offer its optional VS Code add-on later; it installs nothing else, and you never need it." *The director's decision D6, 4 November 2026.*

## 4. Who gets it, and when

- **Where a helper runs** (Node.js 22 or later, at Lean with the helper or on the build engine): the panel works fully today, once installed.
- **At Lean with no Node.js:** the panel needs the helper that runs inside VS Code's process, which stays off until S6 passes (`ADDON_LEAN_READY`). Until then the add-on isn't offered there. *The director's decision D3, 4 November 2026.* The other route, a read-only panel drawn from Lean's files with "answer in the chat" in place of buttons, would show something sooner but is a second drawing path for a few weeks.
- **The offer** is one card, once, after the director's first feature is done at Lean, or at the end of setup elsewhere: "Would you like Wheelhouse's panel beside the chat?" with **Yes, add it**, **Not now** and **Why?**. *The director's decision D2, 4 November 2026.* Not during setup, which already asks enough, and not only on request, since a director who doesn't know it exists won't ask.

## 5. The look: Inset, in VS Code

The pane follows `docs/specs/2026-10-31-pane-design.md` (direction A, Inset) and the main design's section 23, in HTML and CSS, with VS Code's theme variables in place of Desktop's theme keys.

### 5.1 The theme mapping

| Inset's key (Desktop) | VS Code variable | For |
|---|---|---|
| `composerSidebarBackground` (raised panel) | `--vscode-sideBarSectionHeader-background`, falling back to `--vscode-editorWidget-background` | each panel |
| the quiet line | `--vscode-widget-border`, falling back to `--vscode-panel-border` | a panel's line |
| `selectionBg` (soft blue band) | `--vscode-textBlockQuote-background`, or `--vscode-button-background` at low opacity | the recommendation's band |
| `rate_limit_fill` / `rate_limit_empty` | `--vscode-progressBar-background` / `--vscode-input-background` | the launch bar |
| `diffRemovedDimmed` (All stop's panel) | `--vscode-inputValidation-errorBackground` | All stop |
| filled button | `--vscode-button-background`, `--vscode-button-foreground` | the one filled button |
| default button | `--vscode-button-secondaryBackground` | the others |
| `plain` with `dimColor` | `--vscode-descriptionForeground`, full strength on hover | Why?, Not now, Back, Next, Settings |
| type sizes 11, 12, 13, 14, 20 px | `--vscode-font-family`, the same sizes | |

The builder picks the final variables by looking at the pane in light, dark and high-contrast themes; this table is the starting point. *Designer's call.* High contrast uses `--vscode-contrastBorder` for every line and no fills, since VS Code's high-contrast themes rely on borders.

### 5.2 Every state the mod draws

The VS Code pane draws every state in the pane design's table. Today's `render.js` draws some of them. What it lacks:

| State | Today in VS Code | Change |
|---|---|---|
| Several cards | All drawn at once, one after another | One card at a time, with the next card's subject, Back and Next, as the mod |
| Steered, Revised | Not drawn (`steered`, `revised` are in the model) | Drawn as the mod draws them |
| Recording | Not drawn; the page is redrawn after the press | "Recording…" in place of the button until the press answers |
| A card answered elsewhere | Not drawn | No buttons, with the line saying where and when (section 6) |
| Out of date | A notice line only | The mod's warning line, and no figures in the verdict |
| Launch | Words | The bar |
| To watch | A list of lines | Name left, value right, as Inset's rows |
| Settings, just changed | Undo is drawn | "Changed just now" and Undo, value at the right |
| First reading, no pane here | "Nothing to show yet" | The mod's lines (reading, setup still running, or the chat) |
| Why? opened, Suggest a change… | Drawn | Kept, in Inset's look; Suggest's box at full width |

The words, the order of a card's parts and each button's key stay as the mod's, since a press is checked by its words.

### 5.3 One source of truth for the states

The mod draws with the engine's elements (`hooks/mod/calm.tsx`) and the add-on draws HTML, so two drawers stay. What keeps them together:

- **A shared set of pane models,** one per state in the pane design's table, kept as fixtures beside the desk's pane model (`tests/fixtures/pane-states/`). The mod's tests and the add-on's tests both draw every fixture.
- **A test that the add-on draws every state the mod draws,** by the fixture's name, and that every button key in a fixture shows as a button in the HTML.
- **The words come from the model,** never from `render.js`, except the few labels the mod also holds in its own code (STOP, Lift STOP, Board, Settings, Briefing, Done). Those move to one shared list both read.

*Designer's call.* A single renderer for both would remove the drift altogether, but the mod's surface and a webview are too different to share one without a translation layer of its own.

## 6. One card, one answer, in VS Code

This follows the one-card design and reuses what it builds: the answer words (`answeredWords`), the claim markers and the decided-card check. Its way out and its "since your last turn" line are per Claude Code session and come from Claude Code's hooks, so Copilot gets its own forms of both (sections 6.2 and 6.3). It must be built after that design lands.

### 6.1 Knowing the panel is live

- The add-on keeps a mark for each project it shows, at `<wheelhouseHome()>/panes/vscode-<project id>.json`, where the project id is the one `projectOf` gives for the open folder (`scripts/hooks/kit.js`), as the add-on's press already uses: `{ "at": <tick>, "visible": <time the view was last visible>, "surface": "vscode", "window": <a random id per window> }`, written atomically on each tick (every 15 seconds) and when the view's visibility changes (`onDidChangeVisibility`).
- **Live** means a tick and a visible view within the last 45 seconds, the same window as the mod's. A view the director has closed or hidden stops being live. A closed VS Code stops the ticks.
- Claude Code's mark is per session, because the mod knows the session. The add-on can't see which Copilot chat session is beside it, so its mark is per project. *Designer's call.* Two VS Code windows on one project share the mark; either live panel counts.
- **The VS Code mark holds back only Copilot's chat.** A Claude Code session on the same project keeps the one-card design's per-session mark, and a live VS Code panel never holds its cards back, or cards would vanish from the only place that director is looking. The card commands know which agent asks from the session start (`agent` in the project's settings for this computer, other-agents design section 8.1). *Designer's call.*

### 6.2 Holding the chat back

The chat asks cards with Copilot's question tool, and whether Wheelhouse's hooks reach that tool is check 59 (sitting S1). So the hold doesn't rest on a hook:

- **Where Node.js runs,** the front desk's card commands (`cards`, `again`, `pull-cards`, `review`) check the mark. When the panel is live, they return, in place of the questions, the one line the one-card design's hook would have given: "Two cards are waiting in the panel. Say if you'd rather answer them here." They still mark the cards as asked. `--here` lets them through for one turn. Since the add-on has no session folder, its way out is a short mark beside the pane mark (`panes/vscode-<project id>.here.json`, the card ids and a two-minute limit), not the one-card design's `here.json`.
- **At Lean with no Node.js,** where the front desk has no command to run, Lean's front-desk skill gains one step: read the cards through the add-on's `wheelhouse_board` tool before asking any, and the tool returns the same line in place of the cards when the panel is live. With the panel live, the add-on and its tool are always there.
- **When check 59 passes,** the one-card design's PreToolUse hold is added on Copilot's question tool as a backstop (`adapters/copilot/hooks.js`), as that design says.
- **What holds until then, and what doesn't.** Where Node.js runs, the hold is firm: cards come only from the card commands, and those return the panel line instead. At Lean with no Node.js it rests on the front desk following its skill and calling `wheelhouse_board`. If it asks a card anyway, the card shows in both places, and the first answer counts: a panel press on a decided card records nothing (the claim markers), and `wheelhouse_record` refuses a card that is already decided. So the worst case is a card asked twice and answered once, the failure the one-card design names, at Lean only, until check 59. S6 measures how often the front desk skips the tool. *Designer's call*; no stronger guard exists without a hook.

### 6.3 Answers in the panel reaching the chat

VS Code has no way for an extension to add a line to Copilot's chat without starting a turn, unlike the mod's `session.append`. The director asked on 4 November 2026 whether the add-on could do what the mod does. It was checked again that day against VS Code's extension docs (pages dated 28 October 2026):

| Way in | What it can do | Why it doesn't fit |
|---|---|---|
| Chat participants (`vscode.chat.createChatParticipant`) | Answer when the person sends `@participant …` | "Chat participants are deprecated and are not supported in the Copilot harness", which is the default (AI extensibility overview, Chat participant guide). They also answer only a request the person sends |
| The `vscode.chat` and `vscode.lm` APIs | `createChatParticipant`; `registerTool`, `invokeTool`, `selectChatModels` and the providers | None adds a line to a chat. `invokeTool` shows in a chat only inside a request (VS Code API reference) |
| Language model tools | Run when the model calls them during a turn | "Automatically invoked based on the user's chat prompt": only inside a turn (Language model tools guide) |
| MCP Apps | Draw buttons and forms in chat as a tool's result | Shown only as a tool call's result, in a turn. Their `sendMessage` "fills chat input box; does not auto-send", and `updateModelContext` adds an attachment for a later turn, not a visible line (MCP developer guide) |
| `workbench.action.chat.open` with `{ query, isPartialQuery: true }` | Puts words in the chat box without sending them | Not in VS Code's command reference: it is known only from extensions' code and a VS Code discussion. It fills the box rather than adding a line. A line sent from it is a turn, which spends a request |
| Copilot's hooks (`sessionStart`, `postToolUse`, `notification`) | Add context for the model | The person never sees it, and `userPromptSubmitted` can't add context in Copilot's harness |
| Agent plugins (the participants' replacement) | Carry skills, agents and MCP servers | They add no way to write into the chat |

So:

1. **In the panel, at once.** The card shows "You approved the Doubt plan at 10:34" in place of its buttons, and VS Code shows the same line as a notification.
2. **In the chat, the next time the director writes.** In Claude Code that line comes from a hook (`scripts/hooks/board-context.js`), and Copilot's `userPromptSubmitted` hook can't add context. So it is new work here: `views waiting` and `wheelhouse_board` gain a "since" field, the answers recorded since the front desk last read them, with the one-card design's words ("Since your last turn: the Doubt plan was approved in the panel at 10:34."). Copilot's front-desk skill reads one of them at the start of each turn, says each answer in one line before anything else, and never asks that card again. Like the hold at Lean, it rests on the skill until a hook can carry it; the firm part is that a decided card can't be answered twice.

*The director's decision D4, 4 November 2026.* The other route would prefill Copilot's chat box with a line ("I approved the Doubt plan in the panel") for the director to send, which shows it sooner but costs a Copilot request when sent and rests on `workbench.action.chat.open`'s arguments, which VS Code doesn't document.

### 6.4 Answered in the chat first

When a card is answered in the chat first (the panel wasn't live, or the director asked for it there), the panel's next read shows it as answered elsewhere, with no buttons. A press on a card already decided records nothing, as `pressCard` already ensures through the claim markers.

## 7. How a panel click is trusted

**The panel adds no new way to press.** Part C's model stays, and this design adds four guards to it.

**What stands today:**

- The pane's page names one nonce per draw, in its content security policy and on its body; the add-on takes a message only with the latest draw's nonce, so an old page or a forged message counts for nothing (`vscode/nonce.cjs`, `vscode/press.cjs`).
- A deciding press signs in the add-on's own process with the computer's key and acts through the desk with the signed record as evidence, as the mod's bridge does. The helper is never asked to sign (other-agents design, section 6.3).
- The add-on registers one command (open the pane), no URI handler, no public API, and two chat tools that bind nothing; `scripts/addon/validate.js` checks this from the code in CI.
- A typed "yes" in Copilot's chat never counts.
- Every word from a record is escaped; the page loads nothing from outside.

**Added by this design:**

1. **`localResourceRoots: []`** on the webview. The page loads no files, and today it leaves VS Code's default, which allows the workspace and the extension's folder.
2. **No `retainContextWhenHidden`.** A hidden pane is redrawn with a new nonce when it shows again, so no old page stays able to post.
3. **The live mark is not a permission.** It decides only where a card is asked, never whether a press counts. A forged mark can at worst move a card between the chat and the panel, and the director can always say "ask me here".
4. **Untrusted folders get no panel.** The package already declares `untrustedWorkspaces: false`; the pane says why instead of drawing cards.

**What the panel can't defend against, said plainly:**

- **Another extension.** Every extension runs with VS Code's permissions, in the same extension host, and could read the computer's key file or call the scripts directly. This is true of any program the person runs, and is why the add-on's IT note says to allow it alongside a company's normal extension rules. It is not a new risk of the panel.
- **Copilot's own agent at Lean with no sandbox.** An agent that can run shell commands as the person could read the key, with or without the panel. That is the Copilot tier's existing risk (other-agents design, section 6.4), closed by Copilot's sandbox (`COPILOT_SANDBOX_CHECKED`, sitting S3) and Locked, not by the panel.

**Lift STOP and Ask allowances.** With no panel, Copilot confirms these in the helper's own window (Part 8). With the panel live, Lift STOP is a binding click in the panel, as in the mod (other-agents design, section 8.6), and the helper's window stays the route without it. Ask allowances stay in the helper's window either way. *Designer's call*, matching the existing design.

## 8. What sitting S6 gains

S6 already runs checks 55, 65, 67 and 72. This design adds, all on the Mac first and in one sitting, with the agent doing every step it can:

- the release `.vsix` fetched, its hash checked and installed with Install from VSIX, on an account with no admin rights;
- the Inset pane in light, dark and high-contrast themes, in every state from the fixtures, with screenshots kept in the check note;
- a card asked in the chat and the panel, to see the hold (section 6.2) and the answer reach the chat on the next turn (section 6.3);
- `extensions.allowed` set in the user's own settings to leave Wheelhouse out: the add-on is disabled, the mark goes stale, and cards come back to the chat;
- the two questions Part D's final read left open (the helper in VS Code is the whole computer's helper; the inbox's reach).

Copilot use: the hold and the next-turn line need two or three chat turns. The S6 card states them and needs the director's yes, as the plan says. The director's only steps are the clicks a real person must make: Install from VSIX, and pressing a card.

## 9. What VS Code doesn't allow, and what follows

- **No view in the secondary side bar from an extension.** Views may be contributed to the activity bar or the panel only. The add-on keeps the activity bar and the first-run picture of the drag; check 67 says whether a command can move it for the director.
- **No line in Copilot's chat without a turn.** No documented API, command or hook adds a visible line to Copilot's chat without spending a request (section 6.3's table). Hence the panel, a notification, and the next message.
- **No signature check on a `.vsix` from a file.** Hence the hash check in section 3.2, and the Marketplace later.
- **A webview costs memory.** One view, redrawn only when the model changes (as today), with no retained context.

## 10. What changes, by file

| File | Change |
|---|---|
| `vscode/pane/render.js`, `vscode/pane/style.css` | Inset look; every state in section 5.2; one card at a time |
| `vscode/extension.cjs` | `localResourceRoots: []`; the live mark on tick and visibility; the answered line as a notification |
| `vscode/chat-tools.cjs` | `wheelhouse_board` returns the panel line in place of cards when live, and the "since your last turn" line |
| `scripts/frontdesk/cli.js` (card commands, `views waiting`) | The live-panel check for Copilot sessions, `--here`, and the "since" field |
| `vscode/vsix.sha256` (new), CI's validate job | The expected hash, checked against a fresh pack |
| `scripts/lib/pane-mark.js` (new, or the one-card build's module) | Read and write the marks; the 45-second rule |
| `tests/fixtures/pane-states/` (new) | One pane model per state, drawn by the mod's and the add-on's tests |
| `scripts/addon/install.js`, `scripts/agents/copilot/start-helper.js` | Install the release's `.vsix` when there is one |
| `.github/workflows/release.yml` (new) | Pack the `.vsix` on a pushed tag and attach it with its SHA-256; it never makes a tag |
| Lean's kit (`adapters/copilot/home/skills/wheelhouse-front-desk`, `wheelhouse-setup`) | The offer card; fetch, hash check and install steps; the policy read |
| `README.md`, `docs/data.md`, the IT note | The sentence in section 3.4; what the add-on keeps; a paragraph for IT |
| `docs/specs/2026-11-04-one-card-design.md` | Its "Copilot has no panel" lines point here |
| `docs/checks/README.md`, and check 72's note when S6 writes it | S6's added steps |

Kept out: the mod, the card and question hooks, and `scripts/update/`, which other work owns. The one-card build owns the shared pieces this reuses; this build adds the VS Code half after it.

## 11. Decided by the director (4 November 2026)

The director took every recommendation. The other options are kept for the record.

| | Decision | Decided | Other options, not taken |
|---|---|---|---|
| D1 | How the add-on is installed | **A `.vsix` on each release, fetched and hash-checked by the front desk, installed with Install from VSIX; the Marketplace after S6** | Marketplace now (needs a publisher account in the project's name, before the add-on has run for real); the `.vsix` committed into Lean's kit (no download, but a binary in every release's history) |
| D2 | When it is offered | **One card after the first feature at Lean, or at the end of setup elsewhere** | During setup; only when the director asks |
| D3 | Lean with no Node.js, before S6 | **Not offered until S6 turns the in-VS-Code helper on** | A read-only panel from Lean's files in the meantime |
| D4 | A panel answer reaching Copilot's chat | **In the panel and a notification at once; in the chat at the director's next message** | Prefill the chat box for the director to send (sooner, but a Copilot request each time, on an undocumented command) |
| D5 | Order | **Build after the one-card build lands; S6 then tries the finished panel** | Build the look now and the one-card half later; or wait for S6 on today's add-on first |
| D6 | README's Lean wording | **Add one sentence that the panel is an optional extra Lean never needs** | Leave the README as it is |

## 12. The designer's calls, marked

- The theme variable mapping (5.1), to be settled by eye.
- Two drawers kept, held together by shared fixtures (5.3).
- The live mark per project, not per chat session (6.1).
- The card commands and the board tool hold the chat back, with the hook only as a backstop after check 59 (6.2).
- `localResourceRoots: []` and no retained context (7).
- Lift STOP in the panel, Ask allowances in the helper's window (7).
- The policy keys read in 3.3, to be confirmed by check 72.
