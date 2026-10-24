<!-- docs/superpowers/plans/2026-10-24-thoroughness-preset.md -->

# Thoroughness preset: build plan

**Spec:** `docs/specs/2026-10-17-wheelhouse-design.md`, section 14.6, with sections 8, 9.1 and 14. Research: `docs/research/model-presets-2026-10.md`.

**Goal.** The everyday setting `efficiency` (Lightest · Lean · Balanced · Thorough) decides, at each session start, the model and thinking effort every Wheelhouse session and subagent gets, with the premium model only at Thorough and only on the director's own opt-in. The front desk offers the usage cards. The settings pane shows the new rows.

**Left for a later plan** (said in the PR and HANDOVER): the daily and setup probes, the premium opt-in's card flow (pinning its alias and running its evaluation), the paused card when the weekly limit is hit, Copilot's columns and effort, and the counted evaluation that marks Lean and Lightest ready.

## Global constraints

- British English. Every file starts with its path comment. No full model IDs in repository files, and Claude Code's aliases only as the constants in `scripts/setup/best-model.js`, as today: tests use stand-in names such as `model-top`, `model-mid`, `model-premium`.
- Node.js only, runs on macOS and Windows. Tests are `node --test` files under `tests/scripts/<area>/`, as the repository's own are. Run the files you touch, then `npm test` before reporting.
- Never use the words "enhanced", "improved" or "fixed" in names, comments or user-facing text.
- Required reviews, tests and the merge gate are the same at every level. Nothing in this plan touches `scripts/gate/` beyond the configuration's shape in `guardrails.js`.
- The front desk's model is never set by this plan: `frontDesk` keeps today's pin and no effort.
- A setting value that isn't allowed, or a configuration that can't be read, never widens anything: it falls back to Balanced.

## Task 1: the routing columns and the resolver

**Files:** `scripts/routing/thoroughness.js` (new), `scripts/gate/guardrails.js`, tests in `tests/scripts/routing/thoroughness.test.js` and the existing guardrails tests.

1. `guardrails.js`: the configuration may hold `tiers: { pins: { mostCapable?, midSized?, premium? } }`, each a name `isModelName` passes, or null. Anything else in `tiers` makes the configuration unreadable. Add `feature` and `builderCritical` to `ROLES`, so a flat `routing` may name them (null by default). Document the key in the file's header comment in the file's own style.
2. `thoroughness.js` exports:
   - `LEVELS = ['lightest', 'lean', 'balanced', 'thorough']`, `EFFORTS = ['low', 'medium', 'high', 'xhigh']`.
   - `COLUMNS`: frozen, every role but `frontDesk`, each cell `{ class: 'mostCapable' | 'midSized', effort }`, exactly design section 14.6's table: Lightest, Lean, Balanced, Thorough. `builder` and `tester` share the "well-defined builds" row; `feature` and `builderCritical` the "design and critical work" row. Lean's and Lightest's builder cell also carries `rework: 'high'`.
   - `EXTRA = { lightest: { secondReviewer: false, trials: 3, screenshots: 'shown-first', builderCap: 1 }, lean: { … same }, balanced: { secondReviewer: false, trials: 3, screenshots: 'visual', builderCap: null }, thorough: { secondReviewer: true, trials: 5, screenshots: 'every-size', builderCap: null } }`.
   - `resolveRouting({ config, level, ready = [], premium = 'off', billing = 'unknown' })` returns `{ level, roles: { <role>: { model, effort, fallback } }, extra, lines: [string] }`:
     - `level` not in `LEVELS` → `balanced`. A level other than `balanced` that isn't in `ready` → `balanced`, with the line "Thoroughness: <Level> isn't ready yet, so work runs at Balanced."
     - No `tiers.pins` in the configuration → only Balanced: each role's model is the flat `routing[role]` (null when unset, as today), its effort Balanced's cell; a level other than Balanced gives the line "Thoroughness: only Balanced until setup sets the models for each level."
     - With pins: a cell's model is its class's pin. A missing mid-sized pin → the most capable pin, with the line "The lighter model isn't set, so its work runs on the most capable model." A missing most capable pin → the flat `routing[role]`, as today.
     - `fallback`: the other class's pin when both pins exist; null for `reviewerCritical` and whenever it would equal `model`.
     - The premium model: only at `thorough`, only for `feature` and `builderCritical`, only when `premium` is `within-plan` or `paid-too`, `tiers.pins.premium` is set and `ready` includes `premium`. Then: if `premium` is `paid-too`, or `billing` is `within-plan`, those two roles get the premium pin at effort `high`, with the most capable pin as `fallback`. Otherwise they keep their cell, with the line "Premium model not used: it might have been paid from credits."
     - `frontDesk` is never in `roles`.
   - `levelOf(settings)`: `efficiency` from a settings view (`{ efficiency: { value } }`) if `LEVELS` holds it, else `balanced`. `premiumOf(settings)` the same for `premium`, else `off`.
3. Tests cover every bullet above, with stand-in model names.

## Task 2: the settings, their words and the pane

**Files:** `scripts/settings/catalogue.js`, `scripts/settings/effective.js`, `scripts/mod/settings-pane.js` and `hooks/mod/settings.tsx` where the rows are drawn, their tests.

1. Catalogue: `efficiency` levels `['lightest', 'lean', 'balanced', 'thorough']`, default `balanced`. New `premium`: label "Premium model", levels `['off', 'within-plan', 'paid-too']`, default `off`, home project. New `usageMark`: label "Usage nudge", levels `['off', 50, 65, 75, 90]`, default 75, home profile.
2. Words (`sayValue`): `premium` → "off", "on, within your plan", "on, paid credits too"; `usageMark` → "off" or "at 75%"; `efficiency` → "Lightest", "Lean", "Balanced", "Thorough" wherever the pane shows a level's name.
3. Pane: Thoroughness's pop-up offers the four levels. While a level isn't ready (the `column-ready` view of Task 3, or until then nothing beyond Balanced), its option reads "<Level>: not ready yet" and a pick of it records nothing and says so. Premium model is a row the front desk changes (value and Change…, like Protection), shown only when the configuration has a premium pin. Usage nudge sits in the "You, in every project" group as a pop-up. While Lightest is in force, the "This project" group's note adds: "Lightest: the lighter model also designs and checks risky work, so mistakes are likelier to slip through. Every check still runs."
4. Tests for the catalogue, the words and the pane's rows, following the existing tests of each file.

## Task 3: readiness, and every session start takes the column in force

**Files:** `scripts/state/events.js` and `scripts/state/views.js` (the new plain kind `column-ready` and its view), `adapters/claude-code/sessions.js`, `adapters/copilot/sessions.js` (effort ignored, check 75), `scripts/watcher/waker.js`, `scripts/foreman/start.js`, `scripts/foreman/act.js`, `scripts/feature/brief.js` and its template, their tests.

1. `column-ready` is a plain event, `{ column: 'lightest' | 'lean' | 'premium', pins: { … } , records: [string] }`. The view `columnsReady` lists each column whose latest event's pins equal the configuration's pins now. Only this list counts as `ready` for Task 1's resolver.
2. Claude Code adapter: a call may carry `effort` and `fallback`, passed as `--effort <effort>` (one of `EFFORTS`, else refused) and `--fallback-model <name>` (isModelName, else refused). Never set `CLAUDE_CODE_EFFORT_LEVEL`. The foreman's call takes the `foreman` role; a feature session's call takes the `feature` role (falling back to `builder` in a flat table, as today).
3. Waker and start: at each wake, read the settings view and `columnsReady`, call `resolveRouting`, and give the adapter the role's model, effort and fallback. A wake already running is never changed. The resolver's lines go to the watcher's log, and to the board's line list where the waker already writes lines.
4. The feature wake's prompt carries the column for its subagents: one line per subagent role, "<role>: model <name or the session's own>, effort <effort>", and at Lean or Lightest, "When a task is sent back by its review, build it again at effort high." At Thorough, "Critical-area work gets a second fresh reviewer; both must report CLEAN." The brief's models section says the models and efforts come with each wake, and no longer lists them. `act.js` writes `routing: {}` in new briefs; an older brief's `routing` is still read and ignored.
5. The foreman's dispatch caps builders at once at 1 at Lean and Lightest, beside `pace`, and checks both reviewers' CLEAN at Thorough before asking the gate to merge critical-area work.
6. Tests: the adapter's flags and refusals; a wake at each level picks the right model and effort; the prompt's lines; the cap; a configuration with no pins behaves as today.

## Task 4: the usage cards

**Files:** `scripts/routing/nudge.js` (new), the front desk's session start where cards it raises are put on the waiting list, their tests.

1. `nudgeCard({ allowance, level, mark, week, now })` returns at most one card, or null. `allowance` is `usage/allowance.json`'s seven-day window: share used, reset time, and when it was read. No card when the reading is more than a day old or missing, or `mark` is `off`. `week` is what this allowance week has already seen: cards offered, declined, and the level switched from, recorded as events.
   - **Down:** used ≥ `mark`, level Balanced or Thorough, reset more than 24 hours away, not offered this week → "Switch to Lean until it resets?"
   - **Lightest:** level Lean, used ≥ 90%, reset more than 24 hours away, not offered this week → "Switch to Lightest until it resets?"
   - **Up:** used < 40%, reset under 48 hours away, level below Thorough, no switch down or decline this week → "Plenty left: switch to Thorough until it resets?"
   - **Return:** the first reading after a reset, when the level in force came from one of these cards → "Go back to <level before>?"
2. Each card's words are design section 14.6's, with the reset day and time in the director's own time zone, and the options as given there. The answer is a setting change confirmed the usual way (section 14.4).
3. The front desk's session start runs it with no reasoning, as it does for its other cards, and records what it offered.
4. Tests for each card, each refusal (stale reading, mark off, too near the reset, already offered) and the words.

## Task 5: setup pins the classes

**Files:** `scripts/setup/best-model.js`, `scripts/setup/project-files.js`, their tests.

1. Step 7 already asks what the most capable model's alias stands for. Ask the mid-sized model's alias the same way, its alias one constant beside the existing one.
2. The starter configuration writes `tiers: { pins: { mostCapable, midSized } }`; a project already set up gets them through the project-files card, as `frontDesk` does. The card says, once: "Lean and Lightest move most building and routine checking to the lighter model." A mid-sized alias that can't be resolved leaves `midSized` out, and the card says Lean and Lightest wait for it.
3. No premium pin is ever written here.
