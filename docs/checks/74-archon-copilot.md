<!-- docs/checks/74-archon-copilot.md -->

# Check 74: Copilot through Archon's compiled binary (early check E1)

**Answer:** Partly. Run on 30 October 2026, with the director's yes, for 10 premium requests (GitHub: 37 used before, 47 after; the stop was 15). With two defects fixed, a Copilot project's quick change ran on real Archon on Copilot's Auto:
- a build that added the function and its test, with the checks passing;
- two clean reviews and the pull request's text, each step on Copilot (the signing step comes after the pull request opens, so it didn't run).

It stopped at opening the pull request, because another check held the trial repository's lock. The small change was not run, to stay within the stop. The meter's check against GitHub's figure worked as designed, and it showed that the meter's own estimate undercounts cancelled runs.

The earlier tries found:
- two defects, now fixed: pull request #141 (merged) and pull request #144;
- three findings, left for later parts.

The real run is the first part of Evidence; the rest of the note is the 29 October one, kept as it was.


## Question

Spec 15's E1, five items. (1) Does Archon v0.13.0's compiled binary run a Copilot step with the CLI found by `COPILOT_BIN_PATH`, signed in by `copilot login`? (2) Does an included model run with no premium requests used? (3) Do Wheelhouse's guards, registered as the CLI's own hooks in a clean home, fire under Archon (a planted `.env` read refused)? (4) Does the run record show the step's tokens? (5) Does a skill from the clean home load?

## Tested on

29 October 2026, on the Mac (macOS 27, Apple silicon), with Node.js 22.22.1. The scratch engine was Archon v0.13.0's `archon-darwin-arm64` and Bun 1.4.3, both checked against pinned checksums (`probes/lib/archon.js`), with Archon's home under the temporary folder and telemetry reported off. Copilot CLI 1.0.101 was the probes' own copy in `~/.wheelhouse-probes`, with its native program, signed in from the probes' login home. No Copilot step was run through Archon.

## Method

The probe, `probes/74-archon-copilot/run.js`, has four steps: `setup`, `trial`, `tally` and `clean`.

- **setup** makes a clean Copilot home under the temporary folder. It holds only three things:
  - the sign-in's `config.json`;
  - the Lean kit's guard (`adapters/copilot/home/hooks/wheelhouse-lean-guard.sh`), registered as the CLI's own `preToolUse` hook through `hook-wrap.js`, which logs each answer;
  - a copy of Matt Pocock's `tdd` skill (1.3.1, with its licence), with one probe-marker line added.

  It also makes a scratch project: a Lean project, with `.git` and `.wheelhouse/record/` committed, a planted fake `.env`, and a local bare remote. The project carries `hello.yaml`, one Copilot step that quotes the skill's marker and then tries to read `.env`.
- **trial** reads GitHub's premium-request figure, runs the workflow through `archonRun` with `COPILOT_BIN_PATH` and `COPILOT_HOME` set, waits, and reads the record. It reads the figure again a minute later.
- **tally** scores the five items with `tallyE1`. A run that never started, a figure that couldn't be read or an empty hook log fails, never passes (`tests/probes/74-archon-copilot/run.test.js`).

Before running, the agent read three things:
- the account's model list, from the Copilot CLI's ACP mode (`session/new`'s `availableModels`);
- the account's Copilot record, from `gh api /copilot_internal/user`, with the director's existing gh sign-in;
- Archon's Copilot provider source, at the v0.13.0 tag.

It also fed the guard two hand-made hook inputs.

## Evidence

### The real run, 30 October 2026

**Tested on.** The Mac, from a checkout of main at 72e0386e plus the fixes, with Node.js 22.22.1.
- **Engine and project.** Setup's own step 2 for a Copilot project (`engineChanges({ agent: 'copilot' })` and `applyEngine`) installed the engine, Copilot CLI 1.0.101 at its pin and the clean home into a scratch Wheelhouse home. The clean home was signed in from the probes' login home. The project was the throwaway private repository `where-is-brett/wheelhouse-merge-trial` (check 80's), with this computer's configuration naming Copilot.
- **The run.** The real helper ran with the real GitHub adapter. Every tier was bound to `copilot/auto` from the project's own routing (`engineRouting`). The probe is `probes/74-archon-copilot/lanes.js` (`prepare`, `quick`, `small`, `meter`). It watches GitHub's figure and cancels a run at a ceiling.

**The tries.**

| Try | What happened | Requests |
|---|---|---|
| 1 | The probe built its work order without the project's routing (the dispatcher adds it, the probe didn't), so Claude ran the build. It failed in 30 seconds. | 0 |
| 2 | The Copilot twin started. Every edit and command was refused: "Wheelhouse doesn't run in this kind of chat". Defect 2 below. | 3 |
| 3 | On the patched engine, the guard knew Copilot. Edits were then refused by the kits hold that try 1's Claude step had set. Finding 1 below. | about 3 |
| 4 | The pinned kits were installed at project scope. The hold stood: only a Claude session start re-checks it. | about 1 |
| 5 | The hold was lifted by the session start's own check (`checkLineage`, unchanged: the kits matched the manifest, so it removed the hold file itself). Then the quick change ran: the build (`double(n)` in `src/add.js`, a test, `node --test` green), review-spec CLEAN, review-standards CLEAN, the pull request's text. `open-pr` stopped: "this computer no longer holds the lock". Check 81's key had held the trial repository's lock since 02:05. | 4 |

GitHub's figure trailed the steps by a minute or two. Its total, read once it had settled, was 10.

**Defects, fixed.**
1. **Copilot's sign-in file was misread** (pull request #141, merged). CLI 1.0.101 starts `config.json` with two `//` comment lines. `signInOf` parsed the file as plain JSON, so a signed-in computer read as not signed in, and setup's step 2 refused to write the clean home.
2. **A source build of Archon ignores `COPILOT_BIN_PATH`** (pull request #144). The Copilot provider resolves the CLI only in a compiled build. Wheelhouse always builds from source (check 75), so the Copilot SDK ran its own bundled runtime, never the pinned and checked CLI. That runtime doesn't set `COPILOT_CLI_BINARY_VERSION`, so the guards in the clean home took every step for an unknown chat and refused its edits. They failed closed, but the run built nothing for 3 requests. A second Archon patch makes a source build honour the variable. With it, the SDK started the pinned CLI (ping: protocol 3), and the guard recognised Copilot.

**Findings, for later parts.**
1. **For a Copilot project, a lineage hold never lifts by itself.**
   - The kits hold (`lineage/hold.json`) is written by a Claude session start when the pinned Claude kits are missing, and only a Claude session start re-checks it. Copilot steps never do. Once any Claude session starts in the project without the kits, every Copilot step's edits are refused until a Claude session starts again with the kits in.
   - A Copilot-only Mac may have no Claude kits, or no Claude Code at all, so nothing there would ever lift the hold.
   - The Copilot steps don't use the Claude kits at all. They read Wheelhouse's own skill copies, which the pack's digest already covers.
   - **Recommendation:** the hold should accept the Copilot side's own skills, rather than setup installing Claude kits for a Copilot project. A Copilot step's start would check the skills Copilot actually uses, and re-check and lift a hold that doesn't apply to it. Installing Claude Code plugins on a Mac that runs Copilot only would add a tool the project doesn't use, just to satisfy a check meant for it.
2. **The meter's estimate undercounts cancelled and abandoned runs.**
   - The completed run's cost record estimated 4, one per Copilot step, which matches its steps.
   - The two cancelled Copilot runs' cost records carry `premiumRequests: null` (source `unknown`), and a run left paused at an ask wrote none. So the meter estimated 4 where GitHub counted 10.
   - The daily check caught it, and it wrote its Logbook line: "The meter estimated 4 Copilot requests and GitHub counted 10 since 2026-10-30. GitHub's figure is the one that counts, and the cap reads it." So the cap was right after the check, but between checks it reads low.
   - A cancelled run's counted steps should be counted at their rate, never as unknown.
3. **A run paused at an ask couldn't be cancelled.** The adapter's cancel answered "The run isn't running, so there is nothing to cancel". Here the paused run went away with the scratch home. On a real computer, it would stay paused in Archon's history.

**The five items, as far as they ran.**
1. A Copilot step runs with the pinned CLI only with defect 2's patch, since the engine is a source build.
2. No included model exists, so the item reads as requests matching the estimate. Each Copilot step counted one prompt at Auto. The estimate matched for the completed run and undercounted the cancelled ones (finding 2).
3. The guards, as the CLI's own hooks in the clean home, fired under Archon and failed closed in tries 2 to 4. The planted `.env` read was not repeated.
4. Each step's tokens are recorded with source `provider` (input and output; cache not reported).
5. The worktree skill copies were written (`copilot-skills`: codebase-design, frontend-design, pr, review-spec, review-standards). The reviews ran to clean verdicts. Whether each skill loaded was not read from the session.

**The account's model list, without a prompt.** Through the SDK on the pinned CLI, `listModels` gives `auto` alone, as `{ id, name, capabilities }` with no rate. Setup doesn't yet write the list (`writeAccountModels` has no caller), so the column falls back to Auto. That fits this account.

**Cleaned up.**
- The two kits were uninstalled, and Claude Code's record of installs names no trial folder.
- The scratch home was removed, with its engine, the CLI, the clean home and its sign-in copy, and Archon's history.
- The runs pushed no branch to the trial repository, and no pull request was opened.

### The deferred note, 29 October 2026

- **No included model.** The CLI's ACP model list for this account holds only `auto` ("Let Copilot pick the best model"), marked `copilotUsage: 1x`. Asking for any other model fails before a prompt is sent: "Model … is not available".
- **The plan and its allowance.** GitHub reports `access_type_sku: free_educational_quota`, `copilot_plan: individual` and token-based billing. Premium interactions: entitlement 200, 37 used, 162 remaining, resetting on 1 November 2026, with `overage_permitted: false`, so nothing can be spent beyond the plan. GitHub moved Copilot to usage-based billing on 1 June 2026, which retired the old "included models count zero" rule for most plans.
- **Where GitHub's figure comes from.** `quota_snapshots.premium_interactions` in `gh api /copilot_internal/user` (`credits_used`, `remaining`, `entitlement`). The documented billing endpoint (`/users/<user>/settings/billing/premium_request/usage`) needs gh's `user` scope, which the sign-in lacks.
- **The guard, by hand.**
  - The Lean guard acts only in a Lean project (`.git` and `.wheelhouse/record/`) and lets everything through elsewhere. So the scratch project commits the record folder, since Archon runs the step in a worktree made from the remote.
  - Inside it, a `view` of the planted `.env` was refused: `{"permissionDecision":"deny","permissionDecisionReason":"Wheelhouse does not let an agent read a .env file"}`, exit 2.
  - A `view` of `README.md` was allowed (exit 0).
- **What Archon's Copilot provider does with skills** (`packages/providers/src/community/copilot/provider.ts` and `packages/paths/src/skills.ts`).
  - It resolves a node's `skills:` names itself, against four places only: `<cwd>/.agents/skills/`, `<cwd>/.claude/skills/`, `$HOME/.agents/skills/` and `$HOME/.claude/skills/`.
  - It passes the folders it finds as the session's `skillDirectories`. A name it can't find becomes a warning: "Copilot ignored missing skills".
  - It runs the CLI with Copilot's own repository config discovery off by default (`enableConfigDiscovery: false`).
  - It passes the environment through, so `COPILOT_HOME` reaches the CLI. A `configDir` setting does the same.
  - Whether the CLI also loads the skills and hooks in `COPILOT_HOME` by itself is what items 3 and 5 would show.
- **Item 4 needs no Copilot run to settle its form.** Archon records a step's tokens as `execution.spend.tokens` with `source: provider` when the provider reports them. Its capability table says Copilot reports tokens but not cost. A Claude step in the same engine showed the shape (`tests/probes/79-archon-spend/run.test.js` reads it).

## What it means for the design

- **No included model on this account.** Spec 10.1, 10.2 and 13 assume Copilot's included models count zero. On this account, as on any plan under GitHub's usage-based billing, no model is free. The CLI offers only `auto`, at 1x.
  - The spend meter counts every Copilot prompt at the model's rate, `auto` at 1, and shows GitHub's figure from `copilot_internal/user` as the true one.
  - The cap "0 beyond included models" means no Copilot at all. A Copilot project needs the director's allowance for Wheelhouse, in requests a month, before any Copilot step runs. That is a level-4 card, as money.
  - Setup's line "uses the plan's included models" (spec 14.4) becomes the allowance the director set.
  - Part 3c and stub 4.5 take this up. It goes to the main session as a card.
- **Skills from the clean home.** Spec 13 says Copilot steps read Wheelhouse's skills from the clean home. Archon looks only in the project and `$HOME`, so the pack has three ways to supply them:
  - write the copies into the run's worktree (`.agents/skills/`, which the agents' sandbox can see), or
  - give Copilot steps a `HOME` whose `.agents/skills/` holds them, or
  - rely on the CLI loading `COPILOT_HOME/skills` itself, which item 5 would show.

  The first needs nothing from Archon and keeps the director's own home untouched. It is the recommendation, to settle when E1 runs.
- **The guard guards only a Lean project.** For item 3 to mean anything under Archon, the worktree must look like a Lean project to the guard. A Wheelhouse project's worktree will carry `.wheelhouse/` only if it is committed. Otherwise the guard needs to be told the project's root another way (part 4's Copilot stub).
- **When E1 runs**, spec 15's rules apply:
  - Item 1 failing starts the fallback ladder (spec 13). Each rung is tried in turn and recorded here.
  - Item 3 failing means Copilot steps run with only the check step and the sandbox behind them.
  - Item 2 now reads as "the requests used match the estimate". Failing it holds Copilot until the meter's estimate is right.

## Needs the director

- The director said yes to the spend on 30 October 2026, and the run used 10 premium requests.
- The small change, and the quick change's last steps (opening the pull request, signing, the lesson), are still unrun. Running them needs another yes for the requests: about 8 to 10 for the small change, and about 2 to finish the quick one. The trial repository's lock must also be free, or taken by the run's own home.
