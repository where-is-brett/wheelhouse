<!-- docs/specs/2026-11-07-core-cut-design.md -->

# The core cut: design (7 November 2026)

**Status:** draft, for the director's approval. The director answered its open questions on 7 November 2026 (section 9); the design as a whole still awaits their approval. Design only: nothing is built, and no build plan is written, until then.

## 1. In plain words

Wheelhouse grew fast. By v0.2.10 it had two build engines, two coding agents, three front ends (the chat, the pane and a VS Code add-on), two code hosts and a store on the computer, each with its own sittings still to run. Real use has needed only a small part of that.

On 7 November 2026 the director asked to rethink the mods and the UI-first approach and get the core right. This design cuts Wheelhouse back to that core:

- **Kept:** what the director actually uses to get work built and merged safely (section 3).
- **Parked:** finished or half-finished work that stays in the history, switched off, and is neither installed nor maintained (section 4).
- **Dropped:** Matt Pocock's plugin, with the two skills Wheelhouse still needs copied in (section 5).

A project already on Wheelhouse moves to the cut by one run of the update command, with nothing lost (section 6).

## 2. Why

### 2.1 What the review found

A review in the session that wrote this brief found that Wheelhouse is still needed: no outside tool gives a non-developer a First Mate that turns their words into signed decisions, an intake that sizes work, a merge gate only the helper holds the key to, and STOP. But most of what was built around that core serves front ends, agents and hosts that real use hasn't reached.

### 2.2 The landscape, in short

The director had the agentic coding landscape researched in November 2026 (kept outside the repository). Its findings, summarised:

- **The bottom has converged.** Nearly every coding agent now runs the same plain tool loop, reads the same instruction file, loads the same skill format and speaks the same tool protocol. There is little to win by switching agent, and every extra front end or agent Wheelhouse supports is upkeep with no gain in what gets built.
- **Keep exactly one process framework.** Superpowers v7 has answered most of the "too heavy" complaints: it sizes the work before it plans, and has a cheaper execution mode. The research's strongest advice is not to stack another framework's pipeline on top of it, since each one wants its own brainstorm, plan, execute and review loop.
- **Matt Pocock's skills overlap Superpowers where it matters.** Its `tdd`, `code-review` and `diagnosing-bugs` compete with Superpowers' test-driven development, code review and debugging, so two skills try to fire for the same moment. The research recommends keeping only the Pocock skills Superpowers lacks, as editable copies, and not keeping both the plugin and copies.
- **Every installed plugin costs context on every turn**, so fewer always-on parts is cheaper as well as simpler.
- **The real levers are elsewhere:** deterministic checks (tests and hooks as part of "done"), low context overhead, and guardrails enforced by the system rather than by prompts. Those are exactly the parts of Wheelhouse this cut keeps.

### 2.3 Why not BMad

BMad isn't a replacement for Wheelhouse. It overlaps only on planning: a persona-based agile lifecycle (analyst, product manager, architect, scrum master) that writes the product brief, the requirements and the stories. It has no merge gate, no keys kept away from agents, no STOP, no sandbox rules, no cards a non-developer clicks, and no headless build sessions; those are most of Wheelhouse. Its planning would also be a second process framework beside Superpowers, which the research advises against. So BMad isn't adopted, in whole or in part.

### 2.4 Why Archon is parked

On 29 October 2026 the director chose to build on a maintained open-source engine, and Wheelhouse moved its building to Archon, pinned at v0.13.0, built from source with three patches (`scripts/engine/archon/patch/`). An independent review in November 2026 reached its own verdict: park it, and build on Wheelhouse's own engine. Its reasons:

- **No merging for a project kept on this computer.** Archon's only forge plugin is GitHub's; its pull requests, CI and merge queue need GitHub (engine trial notes, 29 October 2026). Wheelhouse had to write its own local queue for that case.
- **No GitLab.** GitLab projects never left the old engine.
- **It wants WSL2 on Windows**, which the director's ruling of 19 October 2026 rules out for company computers ("try to keep it stock Windows").
- **No one upstream owns its Copilot connection.** It is a community provider.
- **In effect one person maintains it, and it moves fast.** Of about 2,500 commits in the three months to 29 October 2026, 96% came from one author. Each monthly upgrade risked breaking the broker's allow list and the merge queue's verdict form.
- **Real use hasn't needed it.** The own engine (the watcher, the foreman and headless feature sessions) builds every project Archon can't, and did all real work before v0.2.0.

## 3. What stays: the core

| Piece | Where it lives | Why it stays |
|---|---|---|
| **The First Mate**, with cards and signed clicks | `skills/front-desk/`, `scripts/frontdesk/`, `scripts/desk/`, `scripts/cards/`, `scripts/hooks/card-check.js`, `prompt-record.js`, `front-desk-writes.js`, `board-context.js`, `commands/` | The director's one way in: their words become work, and every decision is a card whose click is signed. Cards are asked in the chat (AskUserQuestion, with `card-check` and `prompt-record` around it, as the one-card design's chat path already does); reply codes typed in the chat still count |
| **The intake lanes** | `skills/intake/`, `templates/brief/lanes/`, `scripts/intake/` | Sizing work into quick, small, bug and feature is what keeps small changes cheap and large ones planned |
| **The watcher and the foreman** | `scripts/watcher/`, `scripts/foreman/`, `skills/foreman/`, `scripts/host/foreman-run.js` | They are the own engine: they wake on events, start work in the First Mate's order and recover lost wakes (`scripts/watcher/recover.js`) |
| **Headless feature sessions in worktrees** | `scripts/feature/`, `agents/builder.md`, `reviewer.md`, `tester.md`, `scripts/hooks/feature-status.js`, `adapters/claude-code/` | One `claude -p` session per piece of work, each in its own worktree, resumed by its session id |
| **Superpowers v7's loops** | pinned in `.claude-plugin/marketplace.json` and `scripts/lineage/manifest.js` | The one process framework (section 2.2), with the written Wheelhouse override on top |
| **The helper**, with its keys and the merge gate | `scripts/host/helper*.js`, `keys.js`, `scripts/gate/`, `scripts/host/local/queue.js` | The only process that holds a host key and merges, and only with a signed review and, where needed, the director's signed approval |
| **STOP and the sandbox** | `scripts/engine/stop.js`, `scripts/hooks/stop-guard.js`, `stop-word.js`, `tool-guard.js`, `read-only-shell.js`, `scripts/protection/` | Guardrails the system enforces, not the prompt (section 2.2) |
| **Local hosting** (`home.git`) | `scripts/host/local/`, `scripts/setup/local.js` | A project with no code host is kept and merged on this computer |
| **GitHub hosting** | `scripts/host/github*.js`, `app-manifest.json`, `app.json` | The host most projects use |
| **GitLab hosting** | `scripts/host/gitlab*.js`, `adapter-for.js`, `company-ca.js`, `connection.js`, setup's host step | The director needs a company GitLab for real use (ruling of 3 November 2026, kept on 7 November 2026). It keeps the host-access design's routes: "use my git as it is" for pushes, and `glab` where it works, else GitLab's REST API through `curl` |
| **The update command** | `commands/update.md`, `scripts/update/`, `lineage/release.json` | How every computer and project reaches this cut, and every release after it |

Kept alongside, because the core needs them: setup and uninstall (minus the parked steps), the Logbook and the briefing (shown in the chat and by `/wheelhouse:logbook`), the context gauge, Windows at Standard with its Guarded build commands, lineage for Superpowers and Claude Code, and the evaluation.

**Two things the mod did that move.** The pane's timer checked once a minute that the watcher was running and started it again (build-loop design, section 13). Without the mod, the session-start hook and the helper's own tick do that check. And the watcher's Shape 2, which ran inside the mod's timer (`watcherShape: 2`, `scripts/mod/watch.js`), is parked with the mod; Shape 1 is the only shape.

## 4. What is parked

### 4.1 What "parked" means, for every item

- **It stays in the history.** Before it is lifted out, the last commit where the piece is whole is tagged `parked/<piece>` (for example `parked/archon`), and `docs/parked.md` gets one entry: what it was, its tag, its designs and plans, why it was parked, and what bringing it back would take.
- **It is lifted out of the main line.** Its files, tests, CI steps, pins and setup steps are removed in one commit per piece. Where core code calls into it, the call is replaced by the behaviour the parked state gives (each item says which). So it isn't installed, isn't tested, isn't upgraded and has no sittings.
- **It stays off unless the director switches it on.** Switching a piece back on is the director's request through the First Mate, like any feature: a short design that brings it up to date against the core of that day, then a build from its tag. Nothing switches itself back on.
- **The records it left are kept.** Settings and records a parked piece wrote stay in the project's record and the director's profile. The settings catalogue still accepts their keys, so old records never fail a check, but nothing reads them.

### 4.2 Each parked item

| Item | What is lifted out | What happens instead | Settings retired |
|---|---|---|---|
| **The pane, the status line and the courier** (the mod and the UI-first approach) | `hooks/register.ts` and the `modules` line in `hooks/hooks.json`; `hooks/mod/`; `scripts/mod/`; `scripts/desk/mod-*.js`; `scripts/statusline.js`; setup's status-line write (`scripts/setup/project-files.js`, `scripts/protection/settings.js`); `npm run mod-check` and its CI step | Cards are asked in the chat only. The Logbook and the briefing are shown in the chat. With no courier to wake the front desk, what waits on the director is shown when they next speak (the board-context hook), and phone notifications go only by section 13's routes that don't need the mod. The watcher's keep-alive moves (section 3). The Calm words stay where the chat uses them | `watcherShape` (Shape 1 only); the pane's own view settings |
| **Copilot**, with its Lean tier | `scripts/agents/copilot/`; `adapters/copilot/`; `scripts/lean/`; `scripts/engine/archon/copilot-*.js`; `scripts/lib/copilot-numbers.js` and its switches; the Copilot pin in `lineage/manifest.json`; `npm run copilot-home`; `docs/copilot/` | Claude Code is the only agent. The agent seam (`scripts/agents/contract.js`) stays, with Claude Code as its one adapter, so another agent could be plugged in later, as the engine's can. Sittings S1 to S7 are cancelled, and no Copilot spend is asked for | `capRequests` |
| **Archon** | Section 4.3 | Section 4.3 | `engine`, `engineLanes`, `engineRoom` |
| **The VS Code add-on** | `vscode/`; `scripts/addon/`; `scripts/agents/vscode-held.js`; CI's `addon/validate.js` and `hash.js --check` steps; `release.yml`'s `vsix` job; the `.vsix` hash rule in `CLAUDE.md` | No editor panel. The helper stops answering the add-on's `add-on` proof, so an add-on still installed is inert. The update offers to remove it (section 6) | none |
| **Delegation and concept learning** | `scripts/delegation/`; `scripts/frontdesk/learning.js`'s proposals; the `chat-question` count; blind cards | Every decision at levels 3 and 4 is the director's card, as before delegation; nothing is decided on their behalf beyond the table of standing answers. Explanations follow the `explanations` setting alone; no "concept you know" cards | `delegationReviewDays`, `blindCards`, `known:*` |
| **Screenshot approvals** | `scripts/screens/`; the helper's carry-over through `compareCommits` | When a branch is brought up to date after the director approved it, the approval card is asked again, in one click. Previews themselves stay: the director still sees a change before approving it | none |
| **Windows Locked** | The Windows branch of `scripts/protection/locked.js` and `managed.js`, and the plan to try it | Windows projects use Standard, with the Guarded build commands, as ruling 18 of section 22 already has them. Decided 7 November 2026 | none |

Parked with them, because they stand on parked pieces:

- **Unattended goals,** which were partly built on Archon's dispatcher, caps and delegation (`scripts/engine/goal-*.js`). Decided 7 November 2026: they come back later on the own engine, with their own design.
- **The engine's side of the core** that only an engine behind the connector uses: the dispatcher, the card router (`scripts/engine/runner.js`), the spend meter and its caps, the broker (`scripts/engine/broker/`), the engine room and the pack checks. The own engine has its own queue, pace and usage reading.

### 4.3 Archon, in detail

**Wheelhouse's own engine is the only engine.** The `engine` setting is retired, and every lane is built by the watcher, the foreman and headless feature sessions.

**What stays, so an engine could be plugged in later:**

- the engine connector, `scripts/engine/contract.js`: what the core asks of any engine, and the normalised events it reports;
- its test stand-in, `scripts/engine/fake.js`, with the contract tests that run against it.

**What goes:**

- **Installing Archon in setup.** `scripts/engine/install.js`, `scripts/setup/engine.js` and `engine-parts.js`, the pinned Bun, telemetry settings and the engine folder's mirror rules. Setup is shorter by the engine build, which was its longest step.
- **The monthly Archon upgrades.** The Archon entry in `scripts/engine/pins.js` and `lineage/manifest.json`, its digests and patches, and its leg of `scripts/lineage/upgrade.js`. The monthly look at Superpowers and Claude Code stays.
- **The connector to Archon itself:** `scripts/engine/archon/`, `engine/archon/` (the pack and its configuration), `scripts/protection/archon.js`, the tool guard's Archon rules, the Archon evaluation worlds and the probes that test Archon.

**When to look again.** On **7 February 2027**, or sooner if any of these happens:

- Archon adds merging for a project kept on one computer;
- Archon supports GitLab;
- its Copilot connection gets an owner upstream, and Archon gains a second regular maintainer;
- Wheelhouse's own engine repeatedly loses work in real use.

The look is a short report to the director, with a card: stay parked, or bring it back.

**What parking Archon costs:**

| What Archon gave | What the own engine has instead |
|---|---|
| **Crash resume.** A run killed mid-way resumed and skipped its finished steps | A feature session is resumed by its session id at its next wake, and its worktree and commits are on disk. Approved work that never started is raised again (`scripts/watcher/recover.js`). But a session that dies mid-step isn't noticed until something else wakes it, and nothing tells it which steps are done |
| **Its merge queue,** bringing each pull request up to date and merging one at a time | The helper's own merge gate and local queue, which already serve projects kept on this computer and GitHub projects with checks run on this computer |
| **Per-step cost records** | Usage read per session from Claude Code's own records, and the weekly usage view. Nothing per step |
| **Upstream work,** for free with each upgrade | None. Wheelhouse's own engine gets better only when Wheelhouse works on it |

**Decided: teach the own engine to resume after a crash.** The watcher, when it starts and on each tick, looks for feature sessions whose process has gone with no report written. It wakes each one with `--resume` and "carry on from what's there", naming the plan's ticked tasks and the commits on the branch, and counts the resumes: a piece that dies three times becomes a card. **Rough size:** one build part, about a day of build sessions, mostly in `scripts/watcher/` with tests on the fake session. It is the one thing in the table above worth building now. The director said yes on 7 November 2026, and it is part 3 of section 8.

### 4.4 How PR #370, "Watch the crew", fits

PR #370 (draft) proposes a `watchCrew` setting (`off`, `steps`, `transcript`) so the director can see what each headless crew session is doing, read from that session's own transcript file by a script, with no model and no way back to the session.

The cut makes the need stronger, not weaker: with only the own engine, every build is a headless session the director can't see in Claude Desktop's sidebar. But the PR draws its views in the pane, which this cut parks, and has a branch for Archon's views. So it fits once re-scoped:

- **`steps`:** the latest step of each piece of work appears in the Logbook's build view, shown in the chat by `/wheelhouse:logbook`, rather than in the pane's "Being built" lines.
- **`transcript`:** a read-only page of the run so far is a chat command ("watch <work>"), printed by the same script, rather than a Watch page in the pane.
- **The Archon branch goes,** and with it `engineRoom`.
- **Its safety rules stay word for word,** and its script, `scripts/crew/watch.js`, is unchanged.

The recommendation is to update PR #370 after this design is approved, and to build it after part 4 of section 8.

## 5. What is dropped: Matt Pocock's plugin

The plugin is no longer installed or pinned. Wheelhouse keeps copies of the two of its skills that Superpowers lacks, and uses Superpowers for the rest (section 2.2).

- **Copied in (vendored):** `domain-modeling` and `prototype`, as `skills/domain-modeling/` and `skills/prototype/`, each with `SOURCE.md` naming the upstream commit (v1.3.1, `24fe0ef7`) and the MIT licence beside it, as `codebase-design` and `pr` already are. The intake's "alongside any route" line (`skills/intake/SKILL.md`) names the copies.
- **Already copied in, unchanged:** `codebase-design`, `pr`, and the two review lenses adapted from its `code-review` (`review-standards`, `review-spec`). Their sources move from the kit's pin to `COPY_SOURCES` in `scripts/lineage/manifest.js`, so CI's lineage job still checks them.
- **The quick and bug lanes switch to Superpowers.** Their loop is no longer Pocock's `/implement` word for word: it is `superpowers:test-driven-development` for the change, then `superpowers:requesting-code-review` with its reviewers dispatched as Lookouts (`wheelhouse:reviewer`), then the same finish (`templates/brief/lanes/quick.md`, `bug.md`). The check that the installed `/implement` text matches the lane's lines (`scripts/feature/brief.js`) goes with it.
- **The pin is removed** from `.claude-plugin/marketplace.json`, `scripts/lineage/manifest.js`'s `UPSTREAMS`, `lineage/manifest.json`, setup's plugin list (`PIN_NAMES` in `scripts/setup/project-files.js`) and the upgrade command's examples.
- **A project already set up** has the project-scope install removed by the update (section 6). A copy the director installed for themselves, at user scope, is theirs and is left alone.

## 6. What changes for a project already on Wheelhouse

All of it happens through one run of the update command, at the release that carries the cut (v0.3.0). The Update card lists each change below that applies to that computer and project, in plain words. Nothing is deleted that can't be restored: what is removed from the computer is first kept in the update's journal or an archive folder, as the update design already does.

1. **The engine.** A project set to the Archon engine moves to the own engine, with nothing lost:
   1. **No new work goes to Archon** from the moment the update starts: the `engine` setting is read as `wheelhouse`.
   2. **Work under way on Archon** is given until the next quiet point to finish. A run still going then is cancelled with its worktree and branch kept, and its work goes back on the queue as "carry on from what's there", which the own engine picks up on the same branch. It is the existing **Carry on** route, the other way round.
   3. **A question Archon asked** is already a card in Wheelhouse's record. An unanswered one stays waiting, and its answer goes into the carried-on work's order. An answered one is already in the record.
   4. **Open pull requests** stay open, and the helper's own gate merges them as usual. The review verdict comments the helper posted for Archon's queue are left as they are.
   5. **Wheelhouse's records** of Archon's runs (runs, asks, costs, previews, lessons) stay in the project's record as they are.
   6. **Archon's own files in the project** (`.archon/`, the merge queue's policy file) are removed by one helper pull request, on the director's approval card, as the switch's own pull request added them.
   7. **Archon on the computer** (the engine folder, the pinned Bun and Archon's own database) is moved to an archive folder under `~/.wheelhouse/archive/`, once no project on the computer uses it. It is deleted only on the director's own later card.
2. **The mod and the status line.** The plugin update stops loading the mod. The update removes Wheelhouse's own status line from the project's local settings (`isOwnStatusLine`), and leaves a status line the director set themselves.
3. **The VS Code add-on,** where installed: one line on the Update card offers to remove it. Not now leaves it installed and inert.
4. **Matt Pocock's plugin:** the project-scope install is removed (section 5).
5. **Copilot, delegation, goals, screenshot approvals:** nothing to move. Their settings and records stay in the record, unread (section 4.1). A Copilot project, if any, gets one card saying Copilot is parked and offering to carry on with Claude Code.
6. **GitLab and Windows Locked:** nothing changes for a GitLab project. Windows projects were never offered Locked, so they stay at Standard with nothing to move.

`docs/data.md` (what Wheelhouse keeps and what uninstall removes) is brought up to date in the same release.

## 7. The rulings that change

### 7.1 In section 22 of the main design

| Row | Ruling | What changes |
|---|---|---|
| The mod | Designed from day one; everything is built, with the mod last | The mod is parked (section 4.2). The core is complete without it |
| Settings | Settings the director can change, "including from the mod" | Settings are changed in the chat only |
| The designer's calls from the checks | Approvals by card click "until the mod's first piece" | Approvals by card click, with no end date |
| Locked on Windows (check 12) | macOS only until tried on Windows with admin rights | Parked: not tried. Windows stays at Standard with Guarded build commands (decided 7 November 2026) |
| Answering a card by typing or from the phone | Reply codes stay beside the mod's card buttons | Reply codes stay; there are no card buttons outside the chat |
| The interface: Calm | Calm in the pane | The pane is parked. Calm's words and card shape stay in the chat |
| Suggest a change | Offered "in the pane, the chat and on the phone" | In the chat and on the phone |
| Comparing screenshots to save a second approval | **Compare them** | Parked: an approval that a later update would have carried over is asked again, in one click |
| One card, one answer | Panel and chat rules; Copilot's cards in its chat | The chat rules alone. The panel and Copilot parts go |
| Updating Wheelhouse | D3's "the helper's window with another agent"; D4, Lean's update skill | D3 keeps only the Claude Code route; D4 is parked with Lean |

### 7.2 Elsewhere

- **Build on a maintained open-source engine** (the director, 29 October 2026; `docs/specs/2026-10-29-wheelhouse-on-archon-design.md`): reversed. Wheelhouse's own engine is the engine, with a date to look again (section 4.3).
- **Copilot ships in the first public release** (the director, 23 October 2026) and **other agents** (`docs/specs/2026-10-20-other-agents-design.md`, approved 21 October 2026): reversed. Copilot and Lean are parked.
- **The build loop's lineage** (`docs/specs/2026-10-18-build-loop-design.md`): "Superpowers' and Matt Pocock's skills used as they are" becomes Superpowers alone, with the copies in section 5.
- **The delegated decisions and unattended goals designs** (1 November 2026): parked (decided 7 November 2026). Goals come back later on the own engine, with their own design.
- **The pane design and the VS Code panel design** (31 October and 4 November 2026): parked.

## 8. A rough order for the build

Each part is its own fresh session, run on the build plan the director's approval leads to. Each runs the tests of the files it touches; the whole suite is left to CI.

1. **The parking frame.** `docs/parked.md`, the `parked/<piece>` tags, and the settings catalogue accepting retired keys unread. Small, and every later part needs it.
2. **Drop Matt Pocock's plugin.** Copy in the two skills, switch the quick and bug lanes, remove the pin. Independent of the rest.
3. **The own engine as the only engine.** The update's move off Archon (section 6, item 1), setup without Archon, no Archon upgrades, and the own engine's crash resume (section 4.3). The Archon connector's cancel and inspect stay in this release, since the move needs them.
4. **Lift out Archon and the engine's side of the core**, keeping `contract.js` and `fake.js`. This is the next release after part 3, once the update has moved every project.
5. **Lift out the mod, the pane, the status line and the courier.** Move the watcher's keep-alive, park Shape 2, chat-only cards. PR #370, re-scoped, follows this part.
6. **Lift out Copilot, Lean and the VS Code add-on**, with their CI and release jobs.
7. **Lift out delegation, concept learning, unattended goals and screenshot approvals.**
8. **Lift out Windows Locked.** GitLab stays as it is.
9. **The documents and the release.** Section 22 and the other designs marked as section 7 says, `HANDOVER.md`, `CLAUDE.md` and `docs/data.md`. Then a trial of the update on a project already on Wheelhouse, run by an agent, before the director's real use goes on.

Parts 2, 6 and 7 touch separate files and can run side by side. Part 3 must land before part 4, and part 5 before PR #370.

## 9. Decided 7 November 2026

The director answered the design's open questions on 7 November 2026, each as recommended:

1. **GitLab stays in the core.** It moves from parked to kept, with the REST route and "use my git as it is" (section 3).
2. **Locked on Windows is parked.** Windows stays at Standard, with the Guarded build commands (section 4.2).
3. **Unattended goals are parked** with Archon and delegation, and come back later on the own engine with their own design (section 4.2).
4. **The own engine learns to resume after a crash,** built as part of the core cut (section 4.3, and part 3 of section 8).

The design as a whole still awaits the director's approval.
