<!-- docs/checks/56-registration.md -->

# Check 56: where Copilot loads hooks from, and what loads twice

**Answer:** Yes. Register Wheelhouse's hooks once, in the person's hook folder (`$COPILOT_HOME/hooks/*.json`): it ran once per event in the main folder, a git worktree and a folder with no `.git`, trusted or not, and nothing loaded twice. A project hook file holding `disableAllHooks: true` switched off nothing, including the person's hooks. Project files (`.github/hooks/*.json`, `.claude/settings.json`) load only in a folder Copilot trusts.

## Question

Where should Wheelhouse register its Copilot hooks so that they run once, in every folder a Wheelhouse session runs in, and can't be switched off by a project file? Which of the plugin's root `plugin.json` and `.claude-plugin/plugin.json` Copilot reads first, and whether it reads both; whether plugin hooks, the project's `.claude/settings.json` hooks, `.github/hooks/*.json` and `$COPILOT_HOME/hooks/*.json` each load in a main folder, a git worktree and a folder with no `.git`; which load twice; and what a project hook file holding `disableAllHooks: true` does to the person's hooks.

## Tested on

21 October 2026, on macOS, with Copilot CLI 1.0.101 (the pinned copy under `~/.wheelhouse-probes/`), signed in through a scratch Copilot home. Twenty-four real model runs by `probes/56-registration/run.js` (the same twelve cases twice), all exit 0. The raw results (every run's arguments, output, hook log lines and counts) are kept with the build's working papers, not in the repository.

## Method

`node probes/56-registration/run.js`. The same small logger (`probes/lib/copilot-hook-logger.js`) is registered, with a tag of its own, on `sessionStart` and `preToolUse` in five places:

- `plugin-agent`: the plugin's `com.github.copilot/hooks/hooks.json`, beside a root `plugin.json` (Agent Plugins format);
- `plugin-legacy`: the same plugin's `hooks/hooks.json`, beside a `.claude-plugin/plugin.json` with a different name;
- `claude-settings`: the project's `.claude/settings.json`, in Claude Code's format (PascalCase events);
- `github-hooks`: the project's `.github/hooks/probe.json`, in Copilot's format (camelCase events);
- `home-hooks`: `$COPILOT_HOME/hooks/probe.json`.

The plugin was installed into a scratch Copilot home with `copilot plugin install <path>`. Copilot then ran once, `copilot -p "Read README.md and say done" --allow-tool view`, in three folders: a scratch git project, a worktree of it made with `git worktree add`, and a copy with no `.git`. Each folder was run as it was and again with `.github/hooks/off.json` added; and all six runs once without and once with `--trust-folder`, because Copilot's own help says a trusted folder is what lets its hooks load. Each run's hook log was emptied first, so counts are per run.

### Undo

The probe makes everything under the system's temporary folder and removes it itself, also on Ctrl-C: the scratch Copilot home (with the installed plugin and the person's hook file), the scratch project, its worktree, the plain copy, the plugin's working copy and Copilot's log folders. Nothing was written to the real `~/.copilot` or `~/.wheelhouse`. The only thing left is the results file in `<temporary folder>/wheelhouse-probe-results/`, which can be deleted. Nothing needs undoing by hand.

## Evidence

Counts per run were the same in all three folders. Each cell is the number of times the tag fired, `sessionStart` and `preToolUse` both.

| Tag | Untrusted | Trusted |
| --- | --- | --- |
| `plugin-agent` | 1 | 1 |
| `plugin-legacy` | 0 | 0 |
| `home-hooks` | 1 | 1 |
| `github-hooks` | 0 | 1 |
| `claude-settings` | 0 | 1 |

- **Plugin manifests.** The install named the plugin after the root `plugin.json`, so the root manifest wins when both exist. Only the hooks under `com.github.copilot/` ran; the `hooks/hooks.json` beside `.claude-plugin/` never did. Copilot's log lists the plugin as loaded either way.
- **Direct installs are going.** `copilot plugin install <path>` works with no network, and prints "Direct plugin installs (repos, URLs, local paths) are deprecated. Only plugin@marketplace installs will be supported in a future release."
- **The person's folder** `$COPILOT_HOME/hooks/*.json` ran once per event in the main folder, the worktree and the plain copy, trusted or not.
- **Project files need trust.** In an untrusted folder `-p` ran neither `.github/hooks/*.json` nor `.claude/settings.json`, with no error. With `--trust-folder`, Copilot's log says "Loading repo hooks in prompt mode (folder is trusted or opt-in set)" and both ran. The worktree and the plain copy carried their own copies of those files (committed files travel with a worktree, and the copy was a plain copy), so this does not show Copilot looking up to a parent folder.
- **Nothing loaded twice.** Every tag fired at most once per event. The tags are separate files, so the same hook registered in two places would run once for each place.
- **Input shapes differ by file.** The hooks from `.claude/settings.json` received Claude Code's shape (`hook_event_name`, `session_id`, `tool_name: "Read"`, `tool_input`, `initial_prompt`). Every other place received Copilot's camelCase shape (`sessionId`, `toolName: "view"`, `toolArgs`, `initialPrompt`, `source`). The same read is named `Read` in one and `view` in the other.
- **The off file.** The first run's file, `{ "version": 1, "disableAllHooks": true }`, was rejected whole by Copilot ("Invalid hook configuration in .github/hooks/off.json: hooks: hooks must be an object"), so that run proved nothing. The probe then wrote `{ "version": 1, "disableAllHooks": true, "hooks": {} }` and ran all twelve cases again. Copilot's debug log carries no "Invalid hook configuration" line in any of the twelve, so the file was accepted (the log has no line that says so outright). With it in `.github/hooks/off.json`, every count was the same as without it: the person's hooks, the plugin's hooks and, in a trusted folder, the project's own hooks all still ran, in all three folders.
- **Two `preToolUse` calls in one run is two tool calls, not double loading.** In `plain-untrusted-off` and `plain-trusted-off` every tag that fired showed `preToolUse` twice, and `sessionStart` once. The log shows one session, and two different tool calls in it: a `glob` for `README.md`, then a `view` of the file (different arguments, about two seconds apart). Each tag fired once for each call. The model chose to search first in those two runs.
- **Not covered:** `disableAllHooks` set in a settings file rather than a hook file (see below).

### What was not tested

- The bare `{ "disableAllHooks": true }` form (it has no `hooks` object, which Copilot rejects).
- `disableAllHooks` in `.github/copilot/settings.json` or `settings.local.json`, or in the person's own `settings.json`.
- The plugin's `hooks/hooks.json` with Claude Code's PascalCase format, and a plugin that has only `.claude-plugin/plugin.json` (no root manifest). Here `plugin-legacy` held Copilot-format hooks and sat beside a root manifest, so it is unknown whether it would load alone or in Claude's format.
- Installing the plugin from a marketplace, and plugin hooks with the plugin enabled or disabled.
- Windows. The hook commands carry a `powershell` field but nothing was run there; the Windows part of the check is the director's sitting.
- A hook folder in a folder Copilot trusted by saved approval rather than `--trust-folder`, and `COPILOT_ALLOW_ALL`.

## What it means for the design

- **Part 5 Task 2 (the registration).** Write the registration to the person's hook file, `$COPILOT_HOME/hooks/wheelhouse.json`, as the plan says: it was the one place that ran once, in every folder, without trust. Do not also register in `.github/hooks/`, `.github/copilot/settings.json` (a third place that loads in a trusted folder, check 66) or `.claude/settings.json`: those would run a second time in a trusted folder, and not at all in an untrusted one. The entry script registered in the person's folder is camelCase (check 58), so it receives `toolName`/`toolArgs`; it need not accept Claude Code's shape for its own registration. Accepting both spellings is still worth keeping if the same script is ever registered from a project's `.claude/settings.json`, which reaches Copilot in Claude Code's shape, but that is a choice, not something this check requires.
- **Part 8 Task 1 (the plugin).** The root `plugin.json` is read first and its `com.github.copilot/` hooks do run, so the plan's rule stands: the root manifest carries no hooks and `com.github.copilot/` holds none. The `hooks/hooks.json` beside `.claude-plugin/` did not run in this layout, so `.claude-plugin/` needs no empty hooks list; that was seen only with Copilot-format hooks in it (see below). Because direct installs are deprecated, setup's `copilot plugin install` of a local path needs a marketplace route before Copilot drops it.
- **Background sessions in a worktree.** The brief's "if the answer differs" case does not apply for the person's folder: it reached the worktree and the plain folder, so no registration is written into each feature worktree's `.github/hooks/`. A project's own hooks do not run in a folder Copilot has not trusted, so the project's hooks (not Wheelhouse's) are what a background session may silently lack. This holds only if the session's `COPILOT_HOME` is the person's. Check 61's starter gives each background session its own home, and that home has no hook file unless Wheelhouse writes `hooks/wheelhouse.json` into it; Part 7 Task 1 must do so, and the first real run must check that a guard fired. Wheelhouse's sessions should not pass `--trust-folder`: it is not needed for the guards, and trust loads a project's hooks and `.mcp.json` servers (check 66), which are commands that run outside the permission rules check 61 relies on. Background builders run untrusted, not only the reviewer.
- **A project file switching hooks off.** It can't, in the form tested: a project `.github/hooks` file with `disableAllHooks: true` left the person's hooks running. So the person's hook file needs no second hold against that file, and the brief's "if `disableAllHooks` switches off the person's hooks" case does not apply. The watcher's control-file check (Part 7 Task 4) is still wanted for the other reasons it exists, but is not the only hold for this. The limit: `disableAllHooks` in `.github/copilot/settings.json` or `settings.local.json` is a different route and was not tried; until it is, the guardrail list should keep a project's `.github/copilot/` folder shut to agents as it does `.github/hooks/`.

## Needs the director

Nothing now. The Windows part is the director's sitting (plan session S2).
