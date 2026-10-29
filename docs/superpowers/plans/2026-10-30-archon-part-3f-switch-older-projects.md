<!-- docs/superpowers/plans/2026-10-30-archon-part-3f-switch-older-projects.md -->
# Part 3f: a project set up before v0.2.0 switches to the build engine

**Goal:** a project set up before v0.2.0 is offered the switch too. Confirming it makes the helper open a pull request that adds the project's `.archon/` files. That pull request merges through the helper's own gate, with the director's signed approval, like any other level-3 change. The engine is on for that project only once the merge lands. Until then nothing changes, and work runs on the old engine.

**Design:** `docs/specs/2026-10-29-wheelhouse-on-archon-design.md`, section 14.3 ("A project set up already gets it by a pull request that the helper merges through its own route, after the director's approval card"), and section 17, step 2. Part 3d's plan, Task 3: the test `a project set up already gets it by an approved pull request`.

**Also closes** two of part 3d's MEDIUMs, from pull request #120:
- **M2.** Uninstall checks `pluginAtScope()` before `claude plugin uninstall`, so a plugin the director removed by hand doesn't stop it.
- **M4.** Uninstalling one project while others stay cancels that project's engine runs, by run id. The other projects' runs carry on.

## How it works

1. **The card.** `switchDue` no longer needs the policy file in the folder. On the Mac, on GitHub and with the engine installed, a project with no engine chosen is offered the switch once. The card's reason says a pull request comes first.
2. **On the engine** means the `engine` setting is Archon *and* the engine can read the project: its fetch-mirror rule is in `<engine>/mirrors/rules.json`. A new setup writes the rule in step 7. A switched project gets it only when the switch's pull request has merged. `engineReady(project)` (`scripts/engine/switch.js`) is the one test. Both engines read it:
   - the helper's `engineForProject` (no dispatcher before then);
   - the foreman's `onNewEngine`, through `/state/views`' `engineOn`, so the old engine keeps taking quick work until then.
3. **The helper's route `/engine-switch`** (`{ cwd }`, placed like the front desk's). It does nothing unless the setting is Archon, the project is on GitHub and the engine isn't on yet. Each call takes the next step:
   - The policy file is already on the default branch: the rule is written, and the engine is on.
   - No open switch pull request: the helper builds one commit in its mirror on top of the default branch. The commit adds the policy (naming the login the helper posts as) and Archon's project settings. The helper pushes it to `wheelhouse-engine-switch`, opens the pull request and keeps `{ pr, head }` beside the project's engine records.
   - An open one: the helper asks its own gate to merge it. When only the director's approval is missing, it writes a `gate-asks` record (work `engine-switch`). The front desk then makes the usual level-3 approval card from that record. When the approval is on record, the merge goes on, and the rule is written.
   - Merged by hand on the host: as the first case.
4. **The gate** (`mergeAnswer`): the switch's pull request on its own branch, changing exactly the two engine files, with the exact texts the helper writes, has no review and no provenance to check. The helper wrote every byte. CI, the lock, All stop, incidents and the director's approval all still hold, and `.archon/**` is a guardrail, so the approval is always needed.
5. **Who calls it:** the director's visit (`scripts/desk/visit.js`), each prompt, while the setting is Archon and the engine isn't on. One step a visit: open, then ask for the approval, then merge.

## Files

- Modify: `scripts/engine/switch.js` (offer without the policy file; `engineReady`; the switch's names), `scripts/engine/lanes.js` (`onNewEngine` needs `views.engineOn`), `scripts/foreman/wake.js` (carries `engineOn`), `scripts/host/helper-main.js` (`engineForProject` needs `engineReady`), `scripts/host/helper.js` (the route, the gate's switch check, `engineOn` in `/state/views`), `scripts/host/github.js` (`login()`), `scripts/host/helper-client.js`, `scripts/desk/visit.js`, `scripts/frontdesk/cli.js` (the approval card names the switch).
- Create: `scripts/engine/switch-pr.js` (the switch's commit texts and the check of a pull request against them).
- Modify: `scripts/setup/uninstall.js` and `uninstall-run.js` (M2, M4).
- Tests: `tests/scripts/setup/switch.test.js`, `tests/scripts/host/helper-switch.test.js`, `tests/scripts/setup/uninstall.test.js`, and eval scenario 80 if the setup suite fits.

## Tests first

- `the switch is offered to a project set up before, with no policy file yet`
- `a switched project stays on the old engine until its pull request merges`
- `a project set up already gets it by an approved pull request` (part 3d's Task 3)
- `the switch's pull request changing anything else needs its review`
- `uninstall goes on when the plugin was already removed by hand` (M2)
- `uninstalling one project cancels its own runs and leaves the others'` (M4)

- A switch pull request closed on the host without merging is left closed. No other one is opened in its place, and the engine stays off for that project.

## Left open

- **Uninstalling a switched project.** Its `.archon/` files weren't in setup's commit, so uninstall's pull request doesn't take them out yet. Its fetch-mirror rule isn't in setup's journal either, so it stays in the engine folder's list until the last uninstall removes the engine folder.
- **The GitHub App connection.** The policy names the login that the connection's `gh api user` gives. An app's key can't read that, so the switch says so and waits. This is the same open question as part 3d's verdicts posted as the app.
- **No eval scenario.** The engine world (`scripts/eval/engine-world.js`) has no git remote to push the switch to. The helper test plays the whole flow against a bare remote instead.
