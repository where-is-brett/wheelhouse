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
