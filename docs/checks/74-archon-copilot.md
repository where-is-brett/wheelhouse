<!-- docs/checks/74-archon-copilot.md -->

# Check 74: Copilot through Archon's compiled binary (early check E1)

**Answer:** Deferred. The account has no included Copilot model: every model it offers uses the monthly allowance. Running E1 would spend some of it, and that waits for the director's yes. The probe is built and its guard path was checked by hand. Two findings already change the design: no Copilot model is free on this account, and Archon finds a Copilot step's skills in the project or `$HOME`, not in the clean home.

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

- **A yes to spend part of the Copilot allowance.** The card went to the main session on 29 October 2026 and is queued for the director's return. It offers at most 40 requests from this month's 162, for E1 (about 3), E6 (about 23) and E4's item 11.
- If the yes comes, an agent runs `node probes/74-archon-copilot/run.js setup`, then `trial --allowance 3`, then `tally`, then `clean`, and this note is rewritten with the results.
- Nothing else is needed. The probes' Copilot sign-in from 21 October 2026 still works.
