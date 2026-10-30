<!-- docs/superpowers/plans/2026-10-30-archon-copilot.md -->
# Part 4.9: Copilot projects on the Archon engine (stub 4.5)

**Goal:** a Copilot project's work runs through Archon's Copilot provider, from the CLI pinned into the engine folder and a clean home, on the routing table's Copilot column, with every prompt counted by the spend meter.

**Spec:** `docs/specs/2026-10-29-wheelhouse-on-archon-design.md`, sections 10 and 13. **Checks:** 74 (E1) and 79 (E6), both deferred for want of the director's yes to Copilot spend.

## Ground rules for this part

- **No Copilot requests at all.** The account has no included model (check 74: only `auto`, at 1x, 200 a month). Everything is built and tested on stand-ins and recordings. Nothing installs or signs in to the Copilot CLI on this Mac.
- Core files name no Copilot; only `scripts/engine/archon/` and `scripts/agents/` (and `adapters/`) do.
- Each piece has tests that fail first.

## What Archon v0.13.0 does, read from its source at the tag

- A `--model <tier>=copilot/<model>` binding selects the Copilot provider for that tier (Archon's CLI reference). An unprefixed model keeps the binding's provider, so a Copilot project's bindings must carry the prefix.
- The provider resolves a node's `skills:` names only in `<cwd>/.agents/skills/`, `<cwd>/.claude/skills/`, `$HOME/.agents/skills/` and `$HOME/.claude/skills/` (`packages/paths/src/skills.ts`). A name it can't find is a warning, and the step runs without it.
- It passes the environment to the CLI, so `COPILOT_HOME` reaches it; `COPILOT_BIN_PATH` names the CLI.
- It loads no plugins and no Archon node hooks; `allowed_tools` and `denied_tools` become the session's tool lists.

## Tasks

1. **The CLI at its pin, in the engine folder** (`scripts/engine/archon/copilot-cli.js`). The pin is Copilot CLI 1.0.101's native package for each Mac (`@github/copilot-darwin-arm64` and `-x64`), with the sha512 integrity npm recorded for it. The installer fetches the tarball from the npm registry only, refuses any other host or a checksum that differs, unpacks it in a folder of its own and moves the one program to `<engine>/copilot/bin/copilot`, recording the change in setup's journal first. `archonEnv` names it as `COPILOT_BIN_PATH`, and the clean home as `COPILOT_HOME`, whenever they are there. Tested on a stand-in tarball and fetch.
2. **The clean home** (`scripts/agents/copilot/engine-home.js`; the stub named `home.js`, which already builds the Lean kit, so the engine's home sits beside it). `<engine>/copilot/home/` holds Wheelhouse's hook registration (the guards as the CLI's own `preToolUse` and other hooks), the pack's skill copies by their plain names, and `config.json` with the sign-in keys alone, written last. Anything else in the folder but Copilot's own state is removed; a link is never followed. A test runs the registered guard command on a planted `.env` read inside a run's worktree and sees it refused.
3. **The pack's Copilot form** (`scripts/engine/archon/copilot-pack.js`). Each workflow gets a `<name>-copilot` twin in the same pack tree (one digest): every skill named plainly, no `plugins`, every AI step on the Copilot provider, the Claude tool names in tool rules mapped to Copilot's, and a first step that writes the named copies into the worktree's `.agents/skills/`, kept out of git by the worktree's exclude file and never over a project's own. `buildPack` takes the adapter's forms; the adapter starts the twin when the run's bindings are on Copilot, and refuses a run whose bindings mix providers.
4. **The routing table's Copilot column under Archon** (`scripts/agents/engine-parts.js`, `scripts/agents/copilot/column.js`). The column's models come from the account's list at setup: an included model (0x) where there is one, else Copilot's own pick, `auto`. The helper's bindings for an agent's own column carry the agent's provider prefix, from the adapter, so the core still names no agent.
5. **The spend meter's premium-request estimate** (`scripts/engine/archon/record.js`, `scripts/engine/archon/copilot-meter.js`). Each Copilot attempt counts at its model's rate from the account's list (included 0, `auto` 1, an unknown model 1, never 0), marked estimated. A daily comparison reads GitHub's figure (`copilot_internal/user`'s `premium_interactions`) through a stand-in in tests, and keeps GitHub's as the true one; a difference of more than one request is a Logbook line.
6. **Setup's Copilot line.** For a Copilot project the one card's engine line names Copilot and the allowance the director set (check 74: no included model), from the adapter.
7. **Scenarios 38 to 41 retargeted** to the pack on the fake engine: the hung guard (the step's tool rules and the protected-tests check still hold), an unknown tool (refused by the guard registered in the clean home), an agent-filled answer (an ask's answer only from a signed record) and a fake verdict (the review signed from the engine's record, never a Copilot step's words).
8. **Independent whole-branch review**; BLOCKER and HIGH fixed test first.

## Left unrun, for the director's yes

The stub's Done: a Copilot project builds a quick and a small change on included models with no premium requests used, and the meter's estimate matches GitHub's figure. On this account there is no included model, so the run reads as "the requests used match the estimate". Expected count: a quick change is at least 3 prompts (build, then two reviews) and a small change at least 6, each at 1x on `auto`; with E1 (about 3) and E6 (about 23) the whole is within the 40 requests the queued card asks for.
