<!-- docs/research/self-hosting-2026-10.md -->

# Wheelhouse managing its own repository: October 2026

What goes wrong when Wheelhouse is set up on the Wheelhouse repository itself, so its front desk and builders work on Wheelhouse. Studied on 26 and 27 October 2026, before v0.1.2, by reading the code and by running setup headless on a copy of this repository.

## How it was studied

- **Reading:** design sections 12 (safety, the guardrails and the merge gate) and 15 (setup), the build-loop design's section 14 (lineage), `scripts/hooks/`, the gate (`scripts/gate/`), the helper (`scripts/host/helper.js`), setup (`scripts/setup/`), the survey and the brief templates.
- **The repository as it stands:** public on GitHub; `main` has a ruleset blocking deletion and force pushes, with no pull request required; 3 open pull requests; 95 local branches, 14 of them holding commits not on `main`; 32 worktrees, nearly all Claude Desktop's under `.claude/worktrees/`, kept out of git by the main checkout's own `.git/info/exclude`. The director's Wheelhouse is installed from a `git` marketplace in `~/.claude/plugins/marketplaces/wheelhouse`, not from the working copy. A CI run takes 35 to 75 minutes end to end (Windows is the slowest leg).
- **The simulation** (`tests/e2e/self-hosting.test.js`): this repository's committed tree on a stand-in host, a fake computer with its own home and Claude Code folder, Desktop-style worktrees under `.claude/worktrees/`, other lines of work, and a change not yet committed in `HANDOVER.md`. Setup's ten real steps run against it, as `tests/e2e/setup.test.js` runs them. Nothing real was reached: no real config, no real host, and the main checkout untouched.

Before the changes below, setup finished green on the copy and pushed `wheelhouse-state` to the repository it was given, and step 5 said "Found 1274 rules in the project".

## Findings

Ranked BLOCKER, HIGH, MEDIUM, LOW. Each says what happens, why, and what to do about it: **done** in this change, or **recommended**.

### BLOCKER

**1. Wheelhouse's records would be pushed to the public repository.**
The state branch (`wheelhouse-state`) and the lock branch live on the product's own repository (`scripts/state/clone.js`, `scripts/state/lock.js`), and nothing asked whether that repository is public. On this repository anyone could then read:
- the director's own words: rulings "exactly as given", requests, ideas, glossary entries, a typed suggestion on a card (`scripts/state/events.js`);
- every card, brief, question and report, and each session's commands (`activity`);
- the survey, which lists work on this computer not yet pushed (branch names and commit subjects), and up to 500 "rules", some of them matched to the director's own sentences in past Claude Code transcripts (`scripts/setup/rules.js`);
- computer ids and signatures.

The secret scan catches keys and tokens, not words.

**Done:** setup refuses, with no card, a product repository or profile repository that the host doesn't say is private (a `visibility` of `private`, or GitHub's `private` where it gives no visibility; an `internal` repository on GitHub or GitLab counts as not private, and an answer that says nothing counts as not private). It refuses before anything is made or pushed: no profile, no record, no state branch, and a joining computer's folder isn't checked out (`notPrivate` and `mustBePrivate` in `scripts/setup/host.js`; tests in `tests/scripts/setup/host.test.js` and `tests/e2e/self-hosting.test.js`). Design section 22 records the ruling.

**Left:** Wheelhouse can't manage its own repository until its records can live somewhere private. That needs the director (the questions at the end). A repository made public *after* setup is still caught only by the level-4 card for changing visibility (design section 12.8); see finding 12.

### HIGH

**2. Wheelhouse's own safety code wasn't a guardrail here.**
The guardrails are `.claude/`, `CLAUDE.md`, `.mcp.json`, CI files, the agent-control files and the critical areas' checks. In this repository that left out `hooks/`, `skills/`, `agents/`, `commands/`, `.claude-plugin/plugin.json` (the agent-control pattern `plugin.json` is root-only) and every script behind the hooks, the gate and the helper. A builder's change to the tool guard or the gate would have merged on a clean review and CI alone, with no director approval and no independent review, and gone out to every user in the next release. Design section 16 already says such changes need the maintainer's level-4 approval.

**Done:**
- A project that is itself a Claude Code plugin (its default branch holds `.claude-plugin/plugin.json`) has its plugin parts as guardrails: `.claude-plugin/`, `hooks/`, `skills/`, `agents/`, `commands/`, `output-styles/` and `.lsp.json` (`PLUGIN_PARTS` in `scripts/gate/guardrails.js`). The helper reads that from the default branch's tree, never from the configuration file, which can't say otherwise. Elsewhere they stay ordinary folders, so a web app's `hooks/` costs no approval.
- They are gate-only: builders still write them, since here they are the product's source. The tool guard's write refusals (`scripts/lib/agent-control.js`) are unchanged, and touch only `.gitattributes` in this repository.
- This repository's `.claude/wheelhouse.json` adds a critical area, "safety checks", covering all of `scripts/` and `adapters/`, whose files are guardrails. The hooks import code from nearly every folder under `scripts/` (which folders count as a registered project, how clicks are trusted, the nested-agent refusal), so a narrower list would leave a way round. The `lineage` area stays.

**Cost:** nearly every code change to Wheelhouse comes to the director for approval, as design section 16 asks for safety changes; changes to docs, tests and templates don't. The approval card says what the change does to the checks.

**3. A 40-minute suite against a 10-minute command and the 20-minute stuck signal.**
The merge gate doesn't wait for CI. It refuses until CI is green on the exact head, and the watcher's `merge-ready` retries, so a slow CI only delays a merge. Nothing in the gate, the watcher or the foreman has a CI time limit. A feature session is different:
- Claude Code's Bash tool stops a command at 10 minutes;
- the watcher counts a feature as stuck after 20 minutes with no status update (`STUCK_MS`, `scripts/lib/build-loop.js`);
- the quick lane's loop (Matt Pocock's `/implement`, word for word) says to run "the full test suite once at the end".

On this repository a builder running `npm test` would be cut off, try again and look stuck.

**Done:** every brief says that one command runs for at most ten minutes. It tells the builder to run the test files the change touches and, when the whole suite takes more than a few minutes, to leave it to the pull request's checks, which the foreman waits for before merging (`templates/brief/brief.md`, "Long test runs"). The repository's `CLAUDE.md` says the same for this repository. Lean's 15-minute test limit (`LEAN_TEST_MS`) applies only to a project with no host, so not here.

**4. This repository's `CLAUDE.md` had rules that would mislead Wheelhouse's sessions.**
Setup's step 5 follows the rules it finds as they are (ruling A3). Two of them were wrong for sessions Wheelhouse starts:
- "**Design stage.** No product code is written until the director approves the design." This was stale: a builder could refuse its work.
- "Start every session by reading `HANDOVER.md`". That file is about 88 KB, so every feature session would spend tokens on it, and it competes with Wheelhouse's own records.

**Done:** `CLAUDE.md` says the design is approved and built. A session started by hand still reads `HANDOVER.md` first, while one Wheelhouse starts works from its brief and opens it only when its work needs it. It also says the repository is public and records never go into it, and how to test. Its other rules (British English, path comments, naming, "the director", no model identifiers) stay as they were.

**5. Work in flight here belongs to live sessions.**
The survey would find 3 open pull requests and 14 lines of unfinished work. At Balanced, setup ends with a card recommending **Carry on with it**, and one click would start a brief for each, on top of sessions already working on them (most open pull requests come from the director's own Desktop sessions and their worktrees). That means duplicate work and clashing branches.

**Done (operational):** the setup-day checklist below. On this repository the director answers **Leave it for now**, and the open work is finished or closed first.

**Recommended (code, later):** leave out of the carry-on count, or name apart, a line checked out in a worktree under `.claude/worktrees/` that another session is using.

**6. Model names in public pull requests.**
The helper appends provenance to every pull request body (`scripts/lineage/provenance.js`), including a `Models:` line with the model identifiers. This repository's `CLAUDE.md`, and the director's own rule, allow no model identifiers in pull requests, and here every pull request is public.

**Not done:** the gate reads the provenance block back (`bodyProvenance`), and the line is the build-loop design's own (section 14.6), so changing it is the director's call. See the questions.

**7. Hand-made maintenance stops working in the registered folder.**
Once this repository is registered, the tool guard holds every session in it and its worktrees: no `gh`, no `git push`, no pull requests except through the helper. The director's current way of working (sessions that open and merge their own pull requests, and pushing release tags) would be refused, and the helper has no route for tags.

**Done (operational):** the setup-day checklist. Release work and any hand-made maintenance run from a separate clone outside the registered folder.

### MEDIUM

**8. Step 5 reads the evidence as rules.** On this repository it found 1,274 "rules", most of them sentences from `docs/checks/` and `docs/research/` ("Read the hooks reference."), and the survey keeps 500 of them. **Recommended:** leave evidence folders (`docs/checks/`, `docs/research/`, `docs/evals/`, `probes/`) out of the rules scan, or let the configuration name where rules live.

**9. The committed `.claude/settings.json` reaches every contributor.** Setup's commit puts Wheelhouse's deny rules, the sandbox, and the marketplace and plugin switches into the public repository. Anyone who clones Wheelhouse and trusts the folder in Claude Code gets the sandbox, the denied `gh` and `git push`, and a prompt to install Wheelhouse and the pinned kits. **Recommended:** a line in the README's contributing section.

**10. The helper never restarts after an update.** It runs from the installed copy of whichever session started it first, and keeps running the old gate and provenance code after a release pin moves. The only sign is the session start's note when the versions differ. That matters more here, where releases are frequent. **Recommended:** the helper stops itself when the installed version differs from its own and no request is in flight, and the next session start starts the new one.

**11. Wheelhouse loaded from the working copy.** With `--plugin-dir`, or this repository added as a directory marketplace, the plugin root is the repository. The tool guard then refuses every file edit in it, and the working copy's hooks and helper run in place of the reviewed release. There is no sign of this today: the director installs from `git`. **Recommended:** the session start says plainly when the plugin root is inside a registered project.

**12. A repository made public after setup.** Nothing notices. **Recommended:** the weekly job asks the host and, when the repository is no longer private, holds pushes to the state branch and puts a line on the board.

**13. `.claude/worktrees/` is shared.** Desktop and the foreman both make worktrees there. Only the main checkout's local exclude keeps them out of git, and setup adds no line for them. A name clash between a Desktop worktree and a work id is possible but unlikely. **Recommended:** setup adds `.claude/worktrees/` to the folder's `.git/info/exclude`, as it does `.wheelhouse/`.

**14. The pins-only release route can't pass yet.** No release tag holds `lineage/release.json`, so every pull request moving the release pin needs the director's approval. It fails closed. **Recommended:** the release steps write the file at the tagged commit once `manifest.js verify` passes.

### LOW

- **CI's time limits** (15 minutes on Linux, 30 on macOS, 60 on Windows, `.github/workflows/ci.yml`) fit today's runs. CI cancels a running check when a new commit is pushed, so a busy pull request waits longer.
- **The lock branch** shows only timing and computer ids. It goes with finding 1.
- **The survey counts Desktop's worktree branches** as unfinished work (finding 5 covers the effect).
- **Two marketplaces named `wheelhouse`** would clash if the repository were added as a local marketplace beside the declared one.
- **`scripts/lineage/upgrade.js` and `manifest.js write`** must run from the working copy, never the cache. They do today.
- **Step 7's protection** adds branch protection beside the existing ruleset, including CI before merge. The director's own merges already wait for CI.

## The setup-day checklist for this repository

For whenever finding 1's question is settled and the repository can be set up:

1. Merge or close the open pull requests. Finish or archive the Desktop sessions working in `.claude/worktrees/`, and delete the lines of work already merged.
2. Commit or set aside changes not yet committed in the main checkout.
3. Run setup in the main checkout, and answer **Leave it for now** on the carry-on card.
4. From then on, do release work (tags and release notes) and any hand-made maintenance from a separate clone outside the registered folder.

## Questions for the director

1. **Where Wheelhouse keeps its records for a public project** (finding 1).
   - *Keep them in a private repository of their own, made by setup* (recommended): the project's code stays public, and the records live in a private companion repository beside the profile. This is about a day's work: setup, the helper's state and lock routes, joining a second computer and uninstall.
   - *Keep them in the private profile repository*, one branch per project: one repository fewer to make, but the profile's protections and backups would need reworking.
   - *Public projects stay out of scope:* Wheelhouse never manages its own repository.
   - Meanwhile setup refuses a public repository, so nothing can leak.
2. **Model names in pull request bodies** (finding 6).
   - *Leave them out everywhere, and keep them in the private record* (recommended): every pull request still names the Wheelhouse release, the kits and the Claude Code version.
   - *Leave them out only where the project's rules forbid them.*
   - *Keep them.*
   - Meanwhile nothing changes: this matters only once a public project can be set up.
