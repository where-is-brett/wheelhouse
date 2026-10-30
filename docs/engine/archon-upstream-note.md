<!-- docs/engine/archon-upstream-note.md -->
# Archon: Claude steps in a mode that keeps Claude Code's sandbox

A short note to go with Wheelhouse's patch when it is offered upstream to Archon (coleam00/Archon). The patch is `scripts/engine/archon/patch/claude-permission-mode.patch`, against v0.13.0 (commit 0d39c1f2).

## What happens today

The Claude provider starts every step with `permissionMode: 'bypassPermissions'` and `allowDangerouslySkipPermissions: true` (`packages/providers/src/claude/provider.ts`, `buildBaseClaudeOptions`). In that mode Claude Code doesn't apply the project's `sandbox` settings. A project that turns the sandbox on with `allowUnsandboxedCommands: false` gets no sandbox inside an Archon step. In a trial on macOS on 29 October 2026, a `curl` to a site outside the project's allowed network list got through in an Archon step and in a plain `claude -p --permission-mode bypassPermissions` session. In the default mode, the same project refused it (`deny network-outbound`). Hooks and permission deny rules still applied in bypass mode.

## The change

One environment variable, read where the options are built:

- `ARCHON_CLAUDE_PERMISSION_MODE=acceptEdits` starts Claude steps in `acceptEdits` mode, without `allowDangerouslySkipPermissions`. Edits in the working folder are allowed without asking, and with the sandbox on, sandboxed shell commands are allowed without asking (`autoAllowBashIfSandboxed`, on by default). The project's sandbox then applies.
- Without the variable, or with any other value, nothing changes.

It follows the provider's existing `ARCHON_CLAUDE_FIRST_EVENT_TIMEOUT_MS`, which is also read from the environment. A setting in `assistants.claude` would be the fuller form, and we'd be glad to write that instead if the maintainers prefer it.

## Why it matters to us

Wheelhouse runs Archon for a product owner who doesn't read code. Its guards rest on hooks, deny rules and the sandbox together. Without the sandbox, a step's shell can read anything the user can, including Archon's own database, and reach any host.

## What isn't changed

The root check in the provider's constructor stays as it is. Per-node `sandbox:` settings pass through as before.

## A second patch: COPILOT_BIN_PATH in a source build

`scripts/engine/archon/patch/provider-cli-path.patch`, added 30 October 2026 after check 74's real Copilot run. Archon's Copilot provider resolves the CLI only in a compiled build (`if (!BUNDLED_IS_BINARY) return undefined`). A source build, which Wheelhouse always runs, ignores `COPILOT_BIN_PATH`, and the Copilot SDK runs its own bundled runtime. So the CLI that setup pins and checks never ran. That runtime doesn't set `COPILOT_CLI_BINARY_VERSION`, so Wheelhouse's guards, registered as the CLI's hooks, took every step for an unknown chat and refused its edits. The patch makes a source build honour the variable, as a compiled build does. Without the variable, Archon behaves as released. The upstream request is the same change: honour `COPILOT_BIN_PATH` whatever the build.

## A report: the merge queue's ruling loses why its follow-up run didn't start

Not a patch; Wheelhouse works around it. Found in check 81 on 30 October 2026, against v0.13.0.

`launchDetached` (`.archon/workflows/sdlc/.shared/launch.ts`) starts `workflow run … --detach --json` and, when it exits non-zero, reports its standard error. With `--json` the CLI puts its refusal on standard output, as `{ "ok": false, "error": … }`, so the ruling logs only "archon-merge-queue did not start:", with nothing after it. Reading `error` from standard output would keep the reason.

We couldn't recover the refusal from our run. The same start, from a copy of the engine's database, in a script step of a real paused-and-woken run, with the same environment shape, started. So we don't know what refused it.

Wheelhouse no longer relies on that start, for a reason of its own: a follow-up from the step names no `--project`, `--workflow-source` or model bindings, and the host that started the first run doesn't know the new one. Without `--project`, on the copy above, it ran under the repository's own project, not the mirror's. So when a ruling merges, Wheelhouse's helper starts the next queue run itself, once the answered run ends. If the step's start works too, the two runs may overlap. Each item's claim keeps them from sweeping it twice.
