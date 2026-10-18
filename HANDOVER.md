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
- Superpowers, of which only brainstorming and writing-skills are wanted here.
- Matt Pocock's skills as the everyday engineering kit.
- The taste skill and Emil Kowalski's design-engineering skill, for implementing designs.
- The Apple design skill.

## Where the work stands

1. **Design:** `docs/specs/2026-10-17-wheelhouse-design.md`, second draft, **approved by the director on 17 October 2026**. It is now about Wheelhouse in general, with nothing specific to the first project. It folds in the standards review, open source, a 15-minute setup, the two protection levels and the rule on secrets. Section 22 lists the director's decisions, including read-only live data (no), the licence (Apache 2.0) and what goes public (a fresh, scrubbed history), and what is still theirs for later. Section 21 lists the designer's calls, which the director may override. Section 20 lists what was verified first, with each answer; the answers are folded in (pull request #2).
2. **Builder check:** `docs/reviews/2026-10-17-builder-check.md`. Folded into the design.
3. **Standards review:** `docs/reviews/2026-10-17-standards-review.md`. Folded into the design (section 12 and elsewhere), along with an independent check of the second draft.
4. **The mock-up** of what the director sees: https://claude.ai/artifact/B6kNuJPTwiC2DUdUgntTkn. Its figures are illustrative.
5. **Research and evidence:** `docs/research/`. It holds the general research reports.
6. **Reference:** `reference/first-version/` holds the first version's builder and reviewer agents. Their prompts can be adapted.

## Next steps, in order

1. **Merge the first build plan and its findings.** The plan, `docs/superpowers/plans/2026-10-17-wheelhouse-foundation-checks.md`, is done, on branch `design-and-build-plan` (draft pull request #1). Its answers are in `docs/checks/README.md`, one note per check. The design changes they brought were merged into #1 from pull request #2 on 18 October 2026.
   - **The director decided on 17 October 2026,** after the checks: the mod's first piece (the weekly usage figure, and the prompt record by origin) is built with the core; Locked is offered on macOS only until it is tried on a Windows computer with admin rights; the designer's new calls stand (design sections 21 and 22).
   - **The director decided on 18 October 2026,** after research (`docs/research/agent-host-access-2026-10.md`): Wheelhouse connects to GitHub or GitLab in one of two ways, chosen at setup. Quick uses the existing sign-in, with its risks shown plainly; narrow uses a Wheelhouse GitHub App, or a GitLab project key made by setup (or a pasted token where it can't). Locked requires narrow (design section 11). Checks 20 to 23 in design section 20 come first in the next plan.
   - **Decided without the director:** check 7's token figures on Windows aren't needed before the pilot, since the receiver is the same code and Windows did post to it; check 13's ruleset trial isn't worth running, since the documentation says it would be refused.
   - **Left for the pilot:** a foreman idle for ten minutes (check 1); whether `session.receive` fires on the Mac (check 9); the Locked install on Windows, when a computer with admin rights is available (check 12).
   - **Left on the Mac:** an empty folder, `/Library/Application Support/ClaudeCode/`, from the Locked trial. It is harmless; removing it needs the director's password.
2. **The state-and-host plan is built and reviewed** (`docs/superpowers/plans/2026-10-18-wheelhouse-state-and-host.md`, branch `state-and-host-plan`, draft pull request #3), approved by the director on 18 October 2026 to run subagent-driven. Tasks 1 to 16 are done, each reviewed, and the final review of the whole branch and its fixes are done. **Next:** the director decides on merging #3, once Windows CI is seen green on it. The ledger, `.superpowers/sdd/2026-10-18-wheelhouse-state-and-host/progress.md` (git-ignored, on the Mac), records every task and ruling: read it before doing anything.
   - **What it built:** the state branch and its events, with signed records for confirmations, approvals and reviews; the views built from them; the lock with its fencing counter; the weekly backup; the secret scan on every event; the merge gate's conditions; the host adapter for gh and glab; the quick and narrow connections; the host helper, which pushes through its own mirror and applies the push rules and the gate; and server-side protection of the default, state and lock branches. An end-to-end test runs two computers against one stand-in host (`tests/e2e/state-and-host.test.js`).
   - **Checks:** 20, 22 and 23 are answered (notes in `docs/checks/`); 21 stays Deferred, so the quick connection's warning on the Mac is the same as on Windows. Every test app, repository and key made for them is deleted or revoked; one GitLab test project is left with `main` protected. GitLab project keys default to Developer level.
   - **Still needs a real run:** the gh and glab outputs for creating, updating and merging, which were written from the documentation; a merge made with a Developer-level GitLab key; the helper on Windows in CI.
   - **Decisions made while the director was away** are listed as rulings in the ledger. They will be brought to the director in the final message of this plan.
   - **A slip to know about:** eight commits made on 17 and 18 October carry a model-naming Co-Authored-By line, against CLAUDE.md. They're pushed; the director was told, and the public release starts from a fresh history. Never add that line.
3. **The next plan: safety.** The hooks, the sandbox and deny settings, the Standard and Locked protection levels, STOP, and the runbook.
   - **First item (Ruling 19): helper routes for state and the lock.** With the narrow connection on a private repository, only the helper holds a key, so the state and lock work done outside it can't fetch: `cloneState`, `writeEvent`'s pull-and-retry, `syncState`, and `takeLock`, `touchLock` and `readLock`. The helper needs routes that run these inside it with the connection's environment (for example `/state/clone`, `/state/sync`, `/lock/take`, `/lock/touch`, `/lock/read`), and an end-to-end case whose stand-in host refuses keyless fetches. Until then it fails closed: the lock can't be taken and an event that meets a moved branch stays unpushed.
   - **A known gap (Ruling 15):** `/merge` takes `approvalRequired` and `touchesGuardrails` from the caller, so a caller can pass them as `false` and skip the director's approval (a signed CLEAN review, green CI and the lock are still needed). The safety plan closes it by working these out in the helper from the pull request's changed paths (the guardrails in design section 12.4). Don't put the helper in front of agents before then.
4. **Next design round:** budget allocation (section 9.1), which the director asked for once usage could be read.
