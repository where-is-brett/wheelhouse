<!-- HANDOVER.md -->

# Handover

Written on 17 October 2026, when Wheelhouse moved into its own repository. Read this first, then the design.

## The director

The director is a product owner, not a developer. They want their product built the way they want it, with as much of the work automated as can be trusted, and without having to manage the engineering.

**How they work:**

- They mostly use Claude Desktop, on macOS and Windows, and rarely the terminal.
- They work locally and never use cloud sessions.
- Downloads go in `~/Downloads`. Projects live under `~/Projects`.

**How to talk to them:**

- Briefly and plainly, as to a product owner. Explain any concept from scratch, with an everyday example. They often won't remember the context, and that's expected.
- Ask each question once, as a card with clickable options:
  - what this is;
  - why it comes to them;
  - the options;
  - a recommendation;
  - what happens meanwhile.
- Bring them only the decisions that are really theirs, and make the rest yourself, saying so.
- Never talk to other agents in front of them.

**Tools and skills they use:**

- Claude Design for visual design.
- Superpowers: since 18 October 2026, its own loops run the feature sessions (brainstorming, writing-plans, subagent-driven development, executing-plans and the per-task skills), with a written Wheelhouse override on top. Neither kit is edited.
- Matt Pocock's skills as the everyday engineering kit.
- The taste skill and Emil Kowalski's design-engineering skill, for implementing designs.
- The Apple design skill.

## Where the work stands

1. **Design:** `docs/specs/2026-10-17-wheelhouse-design.md`, second draft, **approved by the director on 17 October 2026**. It is now about Wheelhouse in general, with nothing specific to the first project. It folds in the standards review, open source, a 15-minute setup, the two protection levels and the rule on secrets. Section 22 lists the director's decisions, including read-only live data (no), the licence (Apache 2.0) and what goes public (a fresh, scrubbed history), and what is still theirs for later. Section 21 lists the designer's calls, which the director may override. Section 20 lists what was verified first, with each answer; the answers are folded in (pull request #2).
2. **The build loop and lineage:** `docs/specs/2026-10-18-build-loop-design.md`, **approved by the director on 18 October 2026**. It completes the design: the intake, the three lanes and which skill runs where, one thin foreman per project and one Claude session per feature, the feature files and the watcher, the override on Superpowers' loops, running features side by side, and lineage (how Superpowers, Matt's skills and Claude Code are pinned, tracked and upgraded). The visual page the director approved: https://claude.ai/artifact/BPHxgGWFa91LCqSG6A4y1x. Its section 14.1 records that nothing was actually pinned on the Mac on 18 October 2026.
3. **Builder check:** `docs/reviews/2026-10-17-builder-check.md`. Folded into the design.
4. **Standards review:** `docs/reviews/2026-10-17-standards-review.md`. Folded into the design (section 12 and elsewhere), along with an independent check of the second draft.
5. **The mock-up** of what the director sees is kept privately.
6. **Research and evidence:** `docs/research/`. It holds the general research reports.
7. **Reference:** `reference/first-version/` holds the first version's builder and reviewer agents. Their prompts can be adapted.

## Next steps, in order

1. **Merge the first build plan and its findings.** The plan, `docs/superpowers/plans/2026-10-17-wheelhouse-foundation-checks.md`, is done, on branch `design-and-build-plan` (draft pull request #1). Its answers are in `docs/checks/README.md`, one note per check. The design changes they brought were merged into #1 from pull request #2 on 18 October 2026.
   - **The director decided on 17 October 2026,** after the checks: the mod's first piece (the weekly usage figure, and the prompt record by origin) is built with the core; Locked is offered on macOS only until it is tried on a Windows computer with admin rights; the designer's new calls stand (design sections 21 and 22).
   - **The director decided on 18 October 2026,** after research (`docs/research/agent-host-access-2026-10.md`): Wheelhouse connects to GitHub or GitLab in one of two ways, chosen at setup. Quick uses the existing sign-in, with its risks shown plainly; narrow uses a Wheelhouse GitHub App, or a GitLab project key made by setup (or a pasted token where it can't). Locked requires narrow (design section 11). Checks 20 to 23 in design section 20 come first in the next plan.
   - **Decided without the director:** check 7's token figures on Windows aren't needed before the pilot, since the receiver is the same code and Windows did post to it; check 13's ruleset trial isn't worth running, since the documentation says it would be refused.
   - **Left for the pilot:** a foreman idle for ten minutes (check 1); whether `session.receive` fires on the Mac (check 9); the Locked install on Windows, when a computer with admin rights is available (check 12).
   - **Left on the Mac:** an empty folder, `/Library/Application Support/ClaudeCode/`, from the Locked trial. It is harmless; removing it needs the director's password.
2. **The state-and-host plan is built and reviewed** (`docs/superpowers/plans/2026-10-18-wheelhouse-state-and-host.md`, branch `state-and-host-plan`, draft pull request #3), approved by the director on 18 October 2026 to run subagent-driven. Tasks 1 to 16 are done, each reviewed, and the final review of the whole branch and its fixes are done. **Done since:** pull request #3 was merged into `design-and-build-plan` as 23e4808. Pull request #1, `design-and-build-plan` into `main`, is still open, and `main` has not moved. The ledger, `.superpowers/sdd/2026-10-18-wheelhouse-state-and-host/progress.md` (git-ignored, on the Mac), records every task and ruling: read it before doing anything.
   - **What it built:** the state branch and its events, with signed records for confirmations, approvals and reviews; the views built from them; the lock with its fencing counter; the weekly backup; the secret scan on every event; the merge gate's conditions; the host adapter for gh and glab; the quick and narrow connections; the host helper, which pushes through its own mirror and applies the push rules and the gate; and server-side protection of the default, state and lock branches. An end-to-end test runs two computers against one stand-in host (`tests/e2e/state-and-host.test.js`).
   - **Checks:** 20, 22 and 23 are answered (notes in `docs/checks/`); 21 stays Deferred, so the quick connection's warning on the Mac is the same as on Windows. Every test app, repository and key made for them is deleted or revoked; one GitLab test project is left with `main` protected. GitLab project keys default to Developer level.
   - **Still needs a real run:** the gh and glab outputs for creating, updating and merging, which were written from the documentation; a merge made with a Developer-level GitLab key; the helper on Windows in CI.
   - **Decisions made while the director was away** are listed as rulings in the ledger. They will be brought to the director in the final message of this plan.
   - **A slip to know about:** eight commits made on 17 and 18 October carry a model-naming Co-Authored-By line, against CLAUDE.md. They're pushed; the director was told, and the public release starts from a fresh history. Never add that line.
3. **The safety plan is built and reviewed** (`docs/superpowers/plans/2026-10-18-wheelhouse-safety.md`, branch `safety-plan`), approved by the director on 18 October 2026 to run subagent-driven. Tasks 1 to 17 and 19 are done, each reviewed, and Task 18's code step is done. The final review of the whole branch is done: it found two seams in the runbook (the project placed from inside the sandbox, and the restore's approval after access is cut), which are now closed, and a few smaller gaps, also closed. What it left is in the ledger: probe tests still leave a few temporary folders, PowerShell's dash forms of `-EncodedCommand` are not refused, and the Claude Code version line shows only once a session has a transcript entry. The ledger, `.superpowers/sdd/2026-10-18-wheelhouse-safety/progress.md` (git-ignored, on the Mac), records every task and ruling (1 to 50): read it before doing anything. **Nothing has been pushed yet, and CI on all three systems (macOS, Windows, Linux) has not run.** Ask the director before pushing.
   - **What it built:**
     - *The helper:* routes for state and the lock that work on a private repository, where only the helper holds a key. It works out for itself, from the pull request's changed files, whether the director must approve (the caller can only add conditions). It never pushes the default branch, and it refuses pushes and merges under STOP and in bypass mode.
     - *The hooks:* STOP (the word "stop" turns it on, only the director's click on Lift STOP turns it off); the tool guard (host tools, pushes, secret files and unlisted connectors); the prompt record (signs the director's clicks, and only a click on a button the card really offered counts); the report check; the session start; the context gauge; and the pre-compact guard.
     - *The settings:* Standard protection (the sandbox and deny settings written to each project) and Locked on the Mac (a computer-wide file that only the director's password can change).
     - *The runbook:* five numbered steps that still work under STOP, each but the first needing the director's click on its card.
     - *The tests:* `tests/e2e/safety.test.js` runs the scenarios end to end (STOP mid-build, an approval file pushed by hand, a workflow change, a card answered by the agent, bypass mode, and two computers on a private repository) beside the earlier `tests/e2e/state-and-host.test.js`. All pass; the whole suite is 698 tests.
   - **The director's two cards, as decided:**
     - *A, changes to CI files: "One click from me."* The helper never pushes a CI change with the project's key. The agent drafts it, a card says in plain words what it changes, and the director's click lets the helper push that exact commit with the director's own sign-in. It then needs a review and the director's approval to merge.
     - *B, what Locked changes on the Mac: "Locked projects only."* Locked's computer-wide file holds the hooks and the deny rules that are safe everywhere, but doesn't switch the sandbox on for every project. Locked's own hook refuses commands in a Locked project whose settings don't have it on. The director's other projects stay as they are.
   - **Rulings that matter to the director,** in plain words:
     - Every card line names a commit by 12 characters, not 7, so a look-alike commit can't be made in practice (22).
     - Guardrail matching ignores capital letters, since Mac and Windows folders do; the cost is an occasional extra approval card (6).
     - Under STOP, one merge still goes through: the restore pull request that puts the product back to an earlier release, after the director's click (42, 47).
     - The runbook command is the only shell command STOP lets through, and it checks its arguments strictly (12, 43).
     - If the helper can't read a pull request's changed files, the director's approval is needed (Task 2).
     - A host that queues merges instead of merging them is refused for now (50).
     - Locked's network list covers every project registered on this computer, so a project added later needs Locked updated (41).
     - The pre-compact guard and the report check inform rather than block when they crash, so a fault can never wedge a session (23, 27).
     - The guards need Claude Code 2.1.295 or later. From that version a guard that fails stops the tool call (`onFailure` in `hooks/hooks.json`); an older one lets the call through, and the session start says so (52).
   - **The director's sitting is still to come** (Task 18 Steps 2 to 5, about 25 minutes on the Mac): Standard sandboxed, then Locked with the password twice. It is arranged with a card. Update this file with what it finds.
     - **Open risk:** a sandboxed agent may not be able to reach the helper's socket inside the Wheelhouse folder in the home folder. If so, the fallback is a ruling that moves the socket to a folder outside the denied one (`~/.wheelhouse-run/helper.sock`), with the local settings following it.
     - Locked on Windows stays untried until a computer with admin rights is available.
   - **A known gap closed:** Ruling 15 of the state-and-host plan (the caller supplying `approvalRequired` and `touchesGuardrails`) is closed; the helper now works them out.
   - **The next plan: the board, briefing and usage** (design section 17.2).
4. **The build-loop plan is written:** `docs/superpowers/plans/2026-10-18-wheelhouse-build-loop.md`, on branch `claude/build-loop-plan-832a69` (cut from `build-loop-design`), not yet reviewed by the director or pushed. It starts once the safety work has merged.
   - **Part 1 is checks 24 to 30.** Checks 24 (its shell part), 25, 29 (on the Mac) and 30 need nobody and run first. The rest make one Mac sitting of about 20 minutes and one Windows sitting of about 25 (the plan's "The director's sittings"), after one card covering every change to the computer.
   - **Check 27 picks the watcher's shape.** Only Tasks 13 and 19 wait for it, and each says what it builds for either answer; check 26 runs only for the fallback.
   - **A numbering clash to know about:** the safety sitting's note was planned as `docs/checks/24-safety-live.md`, but the build-loop design owns 24 to 30. The plan's Task 1 renames it to check 31.
   - **Then the build, Parts 2 to 7:** the records in state and the four feature files; the status hook; the watcher; the queue, clash check, brief and lanes; the builder, read-only reviewer and tester; the intake and the foreman; the gate's new conditions (up to date, provenance, incidents, shown first); lineage (fingerprints, manifest, pins, register, the session-start warning and the hold, provenance, the upgrade path, the release install and the undo); end-to-end tests for scenarios 26 and 28 to 32, and evaluation runs for 20 to 27 and 33 to 35.
   - **The plan's calls** are listed in its "Plan's calls" section, for the director to see.
5. **The board-and-usage plan is written:** `docs/superpowers/plans/2026-10-18-wheelhouse-board-and-usage.md`, on branch `claude/lucid-nobel-4d36b4`, not yet reviewed by the director or pushed. It is the rest of the core (design section 17.2, step 1): usage (the receiver's store, the mod's readings, the week's figures, unusual use), settings, the weekly official-sources check, the profile layer, health, the board, the glance and the briefing, and the mod's first piece (the usage figure, `/go`, "stop" from the phone, and reply codes).
   - **Two cards for the director** are in its "Decisions for the director": whether to build it alongside the build loop or after it, and whether a card can be answered by typing or from the phone with its reply code.
   - **Agents can't read `~/.wheelhouse/`,** so the board, briefing and settings reach the front desk as a hook's context, never from a script it runs. Check 32 (no sitting) confirms the hook can answer a command, and that the mod's own commands run outside the sandbox; check 33 is a 10-minute Desktop sitting per computer.
   - **Its calls** are in its "Plan's calls" section, including Pace defaulting to 3 (the build-loop design's limit) rather than the main design's 2.
6. **Next design round:** budget allocation (section 9.1), which the director asked for once usage could be read.
