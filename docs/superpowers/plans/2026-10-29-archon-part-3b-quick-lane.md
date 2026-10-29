<!-- docs/superpowers/plans/2026-10-29-archon-part-3b-quick-lane.md -->
# Wheelhouse on Archon, part 3b: the quick lane, the broker and previews

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wheelhouse's workflow pack holds the quick lane, its steps use pinned skill copies inside the Wheelhouse plugin, reviews are signed from Archon's record, every `gh` call Archon makes goes through Wheelhouse's broker, and visible work gets a preview, so a quick change can run from work order to a pull request ready for the merge queue.

**Architecture:** The pack (`engine/archon/pack/`) is data: workflows and prompts, checked by `scripts/engine/pack-check.js` and identified by a digest. Wheelhouse's own steps are Node.js scripts called from `bash` steps, so they don't depend on Bun. Steps ask the helper for what they need (the work order, a signed review, a preview copied into the record) by the run's id; nothing that guards reads from the run's artefacts. The broker is the `gh` on Archon's `PATH`: a small Node.js program that sends the exact command to the helper, which allows by list and refuses a merge without the permit.

**Tech Stack:** Node.js (ES modules), `node:test`, Archon v0.13.0's workflow language (YAML), the screens module, the host adapter.

**Spec:** `docs/specs/2026-10-29-wheelhouse-on-archon-design.md`, sections 7.1, 7.2 (the quick row), 7.4, 7.5, 9, 11 (protected tests, done checks, the lesson step, the review lenses), 12.4.

**Plan index:** `docs/superpowers/plans/2026-10-29-wheelhouse-on-archon.md`.

**Waits on:** part 3a merged; part 2's checks 75 (E2), 76 (E3) and 77 (E4). Read their notes first. Check 76 gives the broker's first allow list (every `gh` call the merge queue made), the verdict comment's exact form, and whether the maintainers policy can come from `--config`. Check 77 decides whether steps carry the method as skill copies or as prompt text (prompt text wins a tie), and whether the pack writes one form of skill name or two. If check 76 found Archon's merge queue unusable, Task 6's permit grows into the full gate (`scripts/gate/conditions.js`) and the merge stays with the helper's own route: say so in the pull request.

## Global Constraints

- **The main session** is the session that started you (reply with SendMessage to the `from` id of your first message). Questions, cards for the director and the hand-over go there, never to the director directly.
- British English; dates as 29 October 2026; a repository-relative path comment atop every file (YAML files take `# engine/archon/pack/x.yaml`). No words such as "enhanced", "improved" or "fixed"; **no model names anywhere in the pack**; no AI attribution. Scripts in Node.js. Don't touch `.github/workflows/ci.yml`. Run only the test files a change touches.
- **Every Claude step names the Wheelhouse plugin and no other** (`plugins: [wheelhouse@wheelhouse]`). No step names the Superpowers plugin.
- **No person in a step.** Every prompt says: decide within the rules and record an assumption, or take the blocked exit. Loop prompts say earlier rounds' committed code stands and the full suite runs once, at the end. Steps name their skills in the prompt's words.
- **The quick lane's steps, in order** (spec 7.2): read the work order; implement with `tdd`, as a loop until the done checks pass (`until_bash`, at most 5 rounds); protected-tests check; review (the standards and spec lenses side by side, and the others that apply); push and open the pull request through the broker, its text written with `pr`; preview of its head, if the change is visible; approval wait, if the work is shown first; mark ready for the merge queue; lesson.
- Caps for the quick lane: 20 minutes, 1M tokens (enforced in part 3c; the pack carries `max_iterations: 5` and the node budget from the order).
- Only BLOCKER and HIGH findings hold work back.
- The director's words never pass through Archon's command line or its database (spec 7.4).

## Review Focus

1. **An agent edits the run's copy of the work order** to loosen its done checks or protected files. Guards and checks ask the helper by run id, so the change does nothing. Test in Task 2.
2. **An agent writes a review into the artefacts folder** to get a CLEAN verdict. The helper signs only from `archon workflow get`, checking the pack's digest and the step's identity. Test in Task 5.
3. **A `gh` call not on the broker's list** (a new call in a later Archon release). Refused with a plain reason in the run's log, never forwarded. Test in Task 6.
4. **A merge for a head other than the one reviewed and approved** (a push after review). The permit checks the signed review and approval name that exact head. Test in Task 6.
5. **A project with no preview command and no host preview.** The preview step says so in one plain line and the card shows the change's before-and-after summary instead of pictures, never a blank card. Test in Task 7.

---

### Task 1: The skill copies in the Wheelhouse plugin

**Files:**
- Create: `skills/tdd/`, `skills/codebase-design/`, `skills/verification-before-completion/`, `skills/pr/`, `skills/review-standards/`, `skills/review-spec/`, `skills/frontend-design/`, `skills/emil-design-eng/`, `skills/apple-design/` (each `SKILL.md`, its extra files, `LICENSE` from its source, and `SOURCE.md`: upstream, version, date taken, and the adaptations made), only those check 77 kept as copies
- Modify: `scripts/lineage/manifest.js` (`UPSTREAMS`: the copies' sources and pinned versions), `lineage/register.json` (the carried text), `scripts/lineage/upgrade.js` (an upgrade reads the new upstream version and lists each copy's upstream diff for review, never overwriting an adapted copy by itself)
- Test: `tests/skills/copies.test.js`, `tests/scripts/lineage/manifest.test.js`

**Interfaces:**
- The adaptations are spec 7.1's, in the copies: `tdd` takes its seams from the work order or the plan's task, or records them as an assumption, never "confirm with the user"; `review-standards` and `review-spec` are Matt Pocock's `code-review` halves as single review steps (the fixed point is the base branch, the spec is the work order), with no helpers and no setup file, drawing on Superpowers' `requesting-code-review` reviewer template for wording; `pr` keeps every private record out; each skill's description begins "For Wheelhouse's build steps:" so the First Mate doesn't reach for it.
- Produces: `SKILL_COPIES` (the list, from the folder) for the pack check.

- [ ] **Tests first:** `every copy carries its licence and a SOURCE.md naming a version`; `no copy says to ask the user or a human partner`; `no copy names subagent-driven-development or a helper agent`; `every copy's description begins For Wheelhouse's build steps`; `the manifest pins each copy's upstream version`.
- [ ] Run: fail. Copy and adapt. Run: pass. Commit: `Carry pinned, adapted skill copies for the build steps`.

### Task 2: The work order and the done check

**Files:**
- Create: `scripts/engine/order.js`, `scripts/engine/done-check.js`
- Modify: `scripts/host/helper.js` (routes `/engine/order` and `/engine/start` registration of a run's order), `scripts/host/helper-client.js`
- Test: `tests/scripts/engine/order.test.js`, `tests/scripts/engine/done-check.test.js`, `tests/scripts/host/helper-order.test.js`

**Interfaces:**
- Produces: `workOrder({ work, views, settings, routing, config }) -> Order`, with exactly spec 7.4's contents: `goal`, `notInScope`, `done` (each `{ test } | { command, expect } | { page, mustShow }`), `rulings`, `decisionRules` (what is level 3 or 4 and must become a blocked exit), `caps` (`minutes`, `tokens`, the node budget), `protectedFiles` (the files the protected-tests check may let change), `preview` (`pages`, `styleGuide`) for visible work, `bindings` (the role's model bindings from the routing table in force).
- Produces: `/engine/order { runId }` answers the order registered for that run at start, and nothing for any other id; the first step of every lane writes it to the run's artefacts as `order.json` for reading only.
- Produces: `node scripts/engine/done-check.js --run <id>` asks the helper for the order, runs each check in the worktree, prints one line per check and exits 0 only when all pass. It is the quick loop's `until_bash`.

- [ ] **Tests first:** `the order carries the done checks as the First Mate wrote them`; `the order names no model directly, only bindings from the routing table`; `/engine/order refuses an unknown run id`; `done-check reads the helper's order, not order.json` (a changed `order.json` changes nothing); `done-check exits 1 when one check fails and names it`.
- [ ] Run: fail. Implement. Run: pass. Commit: `Give each run its work order through the helper`.

### Task 3: Protected tests

**Files:**
- Create: `scripts/hooks/protected-tests.js`, `scripts/engine/protected-check.js`, `scripts/engine/control-check.js` (the agent control-file watch as a check step before each review, spec 4.3, calling `checkControlFiles` from `scripts/watcher/control-files.js`)
- Modify: `hooks/hooks.json` (the hook on file and shell tools, `onFailure: block`)
- Test: `tests/scripts/hooks/protected-tests.test.js`, `tests/scripts/engine/protected-check.test.js`

**Interfaces:**
- Produces: the hook refuses an edit that deletes a test file or adds a skip marker (`.skip`, `xit`, `@pytest.mark.skip`, `t.Skip`, `test.todo` and their kin), unless the run's order (from the helper, by `WHEELHOUSE_RUN_ID`) lists that file. Outside an engine run it does nothing.
- Produces: `node scripts/engine/protected-check.js --run <id> --base <ref>` compares the change: deleted tests, fewer assertions in a changed test file, new skip markers, loosened coverage or test settings. It prints findings and exits 1 on any. A first failure goes back to the builder; the pack makes a second one a blocked exit.

- [ ] **Tests first:** `control-check fails a change to an agent control file`; `deleting a test file is refused in an engine run`; `the same deletion is allowed when the order lists the file`; `the hook does nothing outside an engine run`; `the check finds a new skip marker`; `the check finds fewer assertions`; `the check passes a change that only adds tests`.
- [ ] Run: fail. Implement. Run: pass. Commit: `Guard tests against being deleted or skipped`.

### Task 4: The pack, its check and its digest

**Files:**
- Create: `engine/archon/pack/wheelhouse-quick.yaml`, `engine/archon/pack/wheelhouse-hello.yaml` (a script step and one cheap AI step, for setup's health trial), `engine/archon/pack/prompts/` (`implement.md`, `review-standards.md`, `review-spec.md`, `review-security.md`, `review-design.md`, `pull-request.md`, `lesson.md`, `rules.md` holding the shared rules every prompt includes), `engine/archon/config.yaml` (Wheelhouse's `--config`: worktrees inside the project folder, telemetry off, and the maintainers policy if check 76 found it can live here), `scripts/engine/pack-check.js`, `scripts/engine/pack-build.js` (only if check 77 found two name forms are needed: writes `engine/archon/pack-built/claude/` and `…/copilot/` from one source)
- Test: `tests/scripts/engine/pack-check.test.js`, `tests/engine/pack.test.js`

**Interfaces:**
- Produces: `checkPack(dir, { skillCopies }) -> string[]` (problems), refusing: a Claude step not naming `wheelhouse@wheelhouse`; any other plugin; a skill name matching no copy; a loop without `max_iterations`; an AI step without a structured `blocked` field and a `when:` that sends it to a wait; a model name anywhere; a step that posts a review verdict or calls `gh` itself outside the broker's route; a prompt that lacks `rules.md`'s no-person and loop lines.
- Produces: `packDigest(dir) -> string` (sha256 over the sorted files), recorded in provenance with Archon's version (`scripts/lineage/provenance.js` gains `engine: { archon, packDigest }`) and checked by the helper before it trusts a run's review or outcome.
- The quick workflow's waits carry the labels of spec 8.2: `wh.kind`, `wh.level`, `wh.topic`, `wh.work`, `wh.recommend`, `wh.preview`, and the set line's pull request and head for approvals. Review lenses other than standards and spec run only where they apply: security on changes touching the project's critical areas or those words in paths and the diff, on the most capable model's binding; design on visible work.

- [ ] **Tests first:** `checkPack passes the shipped pack`; `checkPack refuses a Claude step without the Wheelhouse plugin`; `checkPack refuses a misspelt skill name`; `checkPack refuses a loop without max_iterations`; `checkPack refuses a model name`; `checkPack refuses an AI step with no blocked exit`; `packDigest changes when one prompt changes`.
- [ ] Run: fail. Write the pack and the check. Run: pass. Run `archon validate workflows` against the pack in the scratch engine from part 2 (if still present), and record the output in the pull request.
- [ ] Commit: `Add the workflow pack's quick lane`.

### Task 5: Reviews signed from Archon's record

**Files:**
- Modify: `scripts/host/helper.js` (route `/engine/review { runId, step }`), `scripts/state/events.js` (`checkReview` accepts `{ engine: 'archon', runId, step, digest }`), `scripts/host/adapter.js` and `scripts/host/github.js` (one call that posts the verdict comment in the form check 76 recorded)
- Test: `tests/scripts/host/helper-engine-review.test.js`, `tests/scripts/state/events.test.js`

**Interfaces:**
- Consumes: part 3a's `inspect`; Task 4's `packDigest`.
- Produces: `/engine/review` reads the step's output from `inspect(runId)`, refuses unless the run's digest is the installed pack's and the step is one of the pack's review steps, then signs a `review` event naming the pull request and head commit with the findings. Once every lens that ran is CLEAN (no BLOCKER or HIGH), it posts the merge queue's verdict comment for that head under the identity the policy trusts. The step after each review in the pack calls this route; no step posts a verdict.

- [ ] **Tests first:** `a review is signed from the run's record`; `a run with another digest is refused`; `a step that isn't a review step is refused`; `a review planted in the artefacts is not read`; `the verdict comment is posted only when every lens that ran is CLEAN`; `a HIGH finding blocks the verdict`.
- [ ] Run: fail. Implement. Run: pass. Commit: `Sign reviews from Archon's record and post the verdict`.

### Task 6: The broker and its permit

**Files:**
- Create: `scripts/engine/broker/gh.js` (installed by setup as `<engine>/broker/bin/gh`, a two-line launcher calling it), `scripts/engine/broker/rules.js`, `scripts/engine/broker/git-credential.js`
- Modify: `scripts/host/helper.js` (route `/broker/gh`, and `/broker/credential`), `scripts/gate/conditions.js` (export the checks the permit shares: `reviewCounts`, `approvalCounts`)
- Test: `tests/scripts/engine/broker/rules.test.js`, `tests/scripts/engine/broker/gh.test.js`, `tests/scripts/host/helper-broker.test.js`

**Interfaces:**
- Produces: `classifyCall(argv) -> { kind: 'read'|'push'|'create'|'comment'|'verdict'|'merge'|'other', pr?, sha? }` (merge covers `gh pr merge` and the REST merge call with its `sha`); `BROKER_ALLOW` (from check 76's call list, each entry a pattern and its kind); `brokerDecision(call, { stop, lockHeld, incident, review, approval, shownFirst, level, guardrail }) -> { allow, reason? }`. Reads pass. Pushes, pull-request creation and comments pass under the existing push rules (never the default branch, the lock held, All stop off). A verdict comment passes only with a signed CLEAN review for that head. **A merge passes only with the permit:** All stop off, the lock held by this computer, no incident open (unless the work is the fix), a signed CLEAN review of that head, and the director's signed approval of that head where the change is shown first, is level 4 or touches a guardrail (carried over an update by the screenshot comparison, as today). Anything not on the list is refused.
- Produces: `gh.js` sends `{ argv, cwd, stdin }` to `/broker/gh` and writes back the real `gh`'s stdout, stderr and exit code unchanged; it interprets nothing.
- Produces: `git-credential.js` (a git credential helper) asks `/broker/credential` and gets an answer only for this project's feature branches, with the narrow connection's short-lived token where the project has one; with Quick, the helper does the push from its own copy instead.

- [ ] **Tests first:** `a pull-request read passes`; `a push to the default branch is refused`; `a merge without a signed CLEAN review of that head is refused`; `a merge of a shown-first change without the director's approval of that head is refused`; `a merge during an incident is refused unless it is the fix`; `a call not on the list is refused with a plain reason`; `gh.js passes the real output through unchanged`; `the credential helper answers only for a feature branch`.
- [ ] Run: fail. Implement. Run: pass. Commit: `Broker every gh call Archon makes, with a permit for merges`.

### Task 7: The preview step

**Files:**
- Create: `scripts/engine/preview.js`
- Modify: `scripts/gate/guardrails.js` (`readConfig` accepts `preview: { command, port, ready }` in `.claude/wheelhouse.json`), `scripts/host/helper.js` (route `/engine/preview { runId }` copying the run's pictures and notes into `previews/<work>/<head>/` in the private record and writing a `preview` event)
- Test: `tests/scripts/engine/preview.test.js`, `tests/scripts/gate/guardrails.test.js`, `tests/scripts/host/helper-preview.test.js`

**Interfaces:**
- Produces: `node scripts/engine/preview.js --run <id>` (a `bash` step after review and before any approval): uses the host's preview deployment for the head where there is one (the helper's `/pr/preview`), else starts the project's `preview` command in the worktree under the build commands' sandbox; photographs the project's listed pages and up to five pages the change touches (from the diff's routes and templates; the slice lane's tester names them instead, stub 4.4) at 1280×800 and 390×844 in a hidden Chrome with a fresh profile, with the screens module; runs the accessibility check (contrast and labels, a permissively licensed tool the builder picks); writes pictures and notes to the run's artefacts; then calls `/engine/preview`. A change with nothing to look at writes a short before-and-after summary instead.

- [ ] **Tests first:** `the host's preview is used when there is one`; `the project's preview command is started when there is no host preview`; `pictures are taken at both sizes`; `the helper copies the pictures into the record, so a planted picture in another run's folder isn't taken`; `a project with no preview gives a one-line summary, not a blank`.
- [ ] Run: fail. Implement. Run: pass. Commit: `Add the preview step`.

### Task 8: The lesson step, and the quick lane end to end with the fake

**Files:**
- Modify: `scripts/host/helper.js` (route `/engine/lesson { runId, text }`: at most one `lesson` event per run, none if empty), `tests/fixtures/engine/` (a recording of a whole quick run from the scratch engine, taken once Tasks 1 to 7 work there)
- Test: `tests/scripts/host/helper-lesson.test.js`, `tests/e2e/engine-quick.test.js`

**Interfaces:**
- Produces: `engine-quick.test.js` runs the quick lane's recording through the fake engine and the real helper with a stood-in host: the order is fetched, the review signed, the broker forwards the push and pull request and refuses a merge without the permit, the preview is copied into the record, one lesson is written.

- [ ] **Tests first:** `a run writes at most one lesson`; the e2e test as above.
- [ ] Run: fail. Implement. Run: pass. Commit: `Run the quick lane end to end against the fake engine`.

### Task 9: Hand-over

- [ ] Run every test file this part touched.
- [ ] Open the pull request `The quick lane, the broker and previews`, and message the main session with its link and what checks 76 and 77 decided here.
