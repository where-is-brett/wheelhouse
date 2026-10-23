<!-- docs/superpowers/plans/2026-10-24-wheelhouse-project-under-way.md -->

# Fitting around a project already under way: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wheelhouse fits around whatever project it finds (design section 15, "Fitting around a project already under way", rulings A1 to A8, approved by the director on 24 October 2026): a read-only survey when setup finishes, mentioned once in the first briefing; work in flight left as it is and carried on only through the intake; other instructions left in place under Wheelhouse's own, archived only on a click; rules followed as they are, with no cards at setup.

**Architecture:** A read-only survey (`scripts/survey/look.js`) runs in the helper when setup finishes and is recorded as a `survey` event in the project's state; the briefing reads it and mentions it once (`scripts/survey/words.js`, `scripts/briefing/`). Carrying a change on, or archiving another setup's instructions, starts work from a ready-made commit: the helper puts the commit into the project's folder under `refs/wheelhouse/from/<work>` (`scripts/survey/ready.js`, helper routes `/survey/*`), the work event names it (`from`), and the foreman starts the feature from it on `feature/<work>`, so the change's own line of work is never pushed to. Step 5 only reads the rules.

**Tech Stack:** Node.js 22 or later, ESM, `node:test`, no npm dependencies.

**Spec:** `docs/specs/2026-10-17-wheelhouse-design.md`, section 15, "Fitting around a project already under way" (A1 to A8), and section 9's note on the rules found.

## Global Constraints

- British English; dates as 24 October 2026; a path comment heads every file.
- No "enhanced", "improved" or "fixed" in names, comments or words; the director is "the director", they/them; no model names or AI attribution anywhere.
- Node.js scripts, working on macOS and Windows.
- The survey only reads. Nothing in flight is closed, deleted, moved or pushed to; nothing is force-pushed.
- Words the director sees use no "commit", "branch" or "worktree", and name the host as it is ("on GitHub", "on GitLab").
- Assume no shape: every part of the survey may be empty, and an empty part is never mentioned.
- Tests never reach a real `gh`, `glab` or `curl` (`tests/helpers/host-stand-ins.js`). Never `pkill` or kill by pattern.
- Fixtures are generic; no real project of the director's is named or described.
- Done when `npm test` (also under `GIT_CONFIG_NOSYSTEM=1 GIT_CONFIG_GLOBAL=/dev/null`) and `npm run mod-check` pass.

## How it runs

- Subagent-driven, one task at a time, test-first, each reviewed. Well-defined tasks on the everyday model; judgement tasks (2, 6, 7) on the stronger model at medium effort.
- **Safety: yes** marks a task touching the helper, pushes, the foreman's start or archiving: a safety review on the stronger model at medium effort.
- Ledger: `.superpowers/sdd/2026-10-24-wheelhouse-project-under-way/progress.md` (git-ignored), with rulings from P1.

## Rulings made in this plan

- **P1.** The survey runs in `finishSetup` (`scripts/setup/health.js`), after the run's records are copied into state and before the first briefing; best effort: a failure is recorded as a survey with `hostReached: false` and never stops setup.
- **P2.** Work pushed with no request comes from the folder's own `refs/remotes/origin/*` as last fetched, not from the host: host-neutral, and ready for git alone. Wheelhouse's own lines (`wheelhouse-state`, the lock's, `feature/*`) are left out.
- **P3.** A survey whose host part failed is taken again, once, the next time a briefing is built (`/survey/again`), and the briefing says in one line that it couldn't look at the host.
- **P4.** Both carrying on and archiving start work from a ready-made commit (`from: { sha, ref, request? }` on the work event). One mechanism, one safety review.
- **P5.** The archive is a commit the helper builds with plumbing (no working copy touched): the files moved under `.wheelhouse-archive/` keeping their paths, plus `.wheelhouse-archive/archived.json` (`{ v: 1, moved: [{ from, to }] }`) and a `README.md`. Restoring is the reverse commit, built from that manifest. Its quick-lane session only checks and opens the pull request; it never writes those files. The merge needs the director's approval, as any guardrail change does.
- **P6.** Uninstall reads `.wheelhouse-archive/archived.json` on the default branch and moves the files back in its own pull request.
- **P7.** Step 5 settles at once, recording how many rules it found; the rules themselves go into the survey event (`rules`), so the intake can confirm one when it first matters.
- **P8.** The once-only mention is kept in the briefing's `seen.json` (`surveyAt`: the survey event's id), marked only when the text showed it, as the weekly lines are.

## Review Focus

1. A project with nothing in flight and no other instructions: the briefing says nothing about the survey at all. Test in Task 4.
2. A host that can't be reached at setup's finish: setup still finishes; the briefing says it couldn't look, and the next briefing looks again once. Tests in Tasks 3 and 4.
3. A request whose head moved between the director's "carry it on" and the foreman's start: the start refuses unless the ref still names the recorded commit. Test in Task 6.
4. A request from someone's own copy of the project: the fetch uses the host's pull ref (`refs/pull/<n>/head`, `refs/merge-requests/<n>/head`). Test in Task 7.
5. An archive asked for when an instructions file has changed on the default branch since the survey: the commit is built from the default branch as it is now and lists what it moves; a file no longer there is left out. Test in Task 7.

---

### Task 1: The host adapter lists open requests

**Files:** Modify `scripts/host/adapter.js`, `scripts/host/github.js`, `scripts/host/gitlab.js`; Test `tests/scripts/host/open-requests.test.js`

**Interfaces — Produces:**
- `adapter.openRequests() -> Promise<Request[]>`, `Request = { number, title, body, branch, head, draft, fork }` (`head` 40 hex; sorted by number; at most 100).
- `adapter.requestDetails(number) -> Promise<{ files: [{ path, additions, deletions }], commits: string[] }>` (subjects, oldest first, at most 50 each).
- `adapter.pullRef(number) -> string`: `refs/pull/<n>/head` (GitHub), `refs/merge-requests/<n>/head` (GitLab).

- [ ] **Step 1:** Failing tests with a fake `run`: GitHub `gh pr list -R o/p --state open --json number,title,body,headRefName,headRefOid,isDraft,isCrossRepository --limit 100`, `gh pr view <n> -R o/p --json files,commits`; GitLab `glab mr list -R o/p --output json` and `glab api projects/<url-encoded o/p>/merge_requests/<n>/changes` and `.../commits` (lines counted from each diff). A non-JSON answer throws `gh pr list did not answer in JSON`; a head not 40 hex throws.
- [ ] **Step 2:** Run `node --test tests/scripts/host/open-requests.test.js`: fails.
- [ ] **Step 3:** Implement in each host's commands; wrap in `makeAdapter` with `wholeNumber`.
- [ ] **Step 4:** Run it and `node --test tests/scripts/host/`: pass.
- [ ] **Step 5:** Commit "List a project's open requests through the host adapter".

### Task 2: The survey and its words

**Files:** Create `scripts/survey/look.js`, `scripts/survey/words.js`; Test `tests/scripts/survey/look.test.js`, `tests/scripts/survey/words.test.js`

**Interfaces:**
- Consumes: Task 1.
- Produces:
  - `INSTRUCTION_PATHS`: `.claude/skills/**`, `.claude/agents/**`, `AGENTS.md`, `.cursor/rules/**`, `.cursorrules`, `.github/copilot-instructions.md`, `.windsurfrules`.
  - `instructionsOf(folder) -> { files: string[], sections: [{ heading, line }] }`: files repo-relative with `/`, sorted, regular files only, never through a link, at most 200, nothing under `.wheelhouse-archive/`; sections are `CLAUDE.md` headings matching `/\b(?:agents?|sub-?agents?|orchestrat\w*|delegat\w*|command cent(?:re|er)|manager|dispatch\w*)\b/i`.
  - `scheduledOf(folder) -> number`: `cron` entries under `on.schedule` in `.github/workflows/*.yml|yaml`, plus `.gitlab-ci.yml` jobs whose `rules` or `only` name `schedule` (read line by line, no YAML parser).
  - `secretFilesOf(folder) -> number`: names starting `.env`, except `.env.example`, `.env.sample`, `.env.template`, to a depth of 4, skipping `node_modules` and `.git`.
  - `inFlightOf(git, { defaultBranch, requestHeads }) -> { pushed: Item[], local: Item[] }`, `Item = { name, head, commits, subject, at }`: `local` from `refs/heads/*` and worktrees other than the main folder (a branch checked out in a worktree is one item; a detached worktree is named by its folder); `pushed` from `refs/remotes/origin/*` (ruling P2); each with commits not on `refs/remotes/origin/<default>`, leaving out the default, requests' heads and Wheelhouse's own lines.
  - `surveyOf({ folder, git, adapter, defaultBranch, rules }) -> Promise<Survey>`, `Survey = { v: 1, hostReached, requests: [{ number, title, draft }], pushed, local, instructions, scheduled, secrets, rules }`. A host failure gives `hostReached: false` and `requests: []`, never a throw.
  - `briefingLines(survey, { host }) -> string[]` (`host` is `github`, `gitlab` or `null`), the design's words: in-flight line ("Already under way here: 2 changes waiting to be merged on GitHub, and 3 pieces of unfinished work on this computer. Say if you'd like me to carry any of them on."), instructions line ("This project also has instructions for another agent setup (AGENTS.md and 4 more files). Mine come first where they differ. I can move them into an archive folder, which you can undo at any time."), host-missed line ("I couldn't look at GitHub for changes waiting to be merged; I'll look again next time."). Parts with nothing are left out; "pushed" counts as unfinished work "on GitHub"; one of each is singular. No line holds "commit", "branch" or "worktree".

- [ ] **Step 1:** Failing tests on a temporary repository (`tests/helpers/git-fixture.js`) with a bare origin: a local branch one commit ahead; a merged branch (not listed); two worktrees each one commit ahead; a pushed branch with no request; a request's head (not listed); `.claude/skills/helper-skill/SKILL.md`, `.claude/agents/writer.md`, `AGENTS.md`, a linked `.cursorrules` (not listed); `CLAUDE.md` with "## Agents and delegation"; two crons and a GitLab schedule job (3); `.env`, `api/.env.local`, `.env.example`, `node_modules/x/.env` (2); an empty project (every part empty, `briefingLines` gives `[]`); a host that throws. `briefingLines` exact words for GitHub, GitLab and `null` ("on this computer" only), singular and plural; the survey run twice deep-equal.
- [ ] **Step 2:** Run `node --test tests/scripts/survey/`: fails.
- [ ] **Step 3:** Implement with read-only git (`for-each-ref`, `rev-list --count`, `log -1 --format=%s%x00%cI`, `worktree list --porcelain`) through `scripts/setup/git.js`'s fenced git.
- [ ] **Step 4:** Run: pass.
- [ ] **Step 5:** Commit "Survey what a project already holds, reading only".

### Task 3: The survey recorded when setup finishes (Safety: yes)

**Files:** Modify `scripts/state/events.js` (`survey` kind), `scripts/setup/health.js` (`finishSetup`), `scripts/host/helper.js` (route `/survey/again`), `scripts/host/helper-client.js`; Test `tests/scripts/setup/health.test.js`, `tests/scripts/state/events.test.js`, `tests/scripts/host/helper.test.js`

**Interfaces:**
- Consumes: Task 2's `surveyOf`.
- Produces: a plain `survey` event (`must: ['v', 'hostReached', 'requests', 'pushed', 'local', 'instructions', 'scheduled', 'secrets', 'rules']`), each part checked, secret-scanned as every event is; `finishSetup` records one after copying the run's records (ruling P1); `/survey/again { project }` records a new one only when the latest has `hostReached: false` and none was taken since that latest (ruling P3), answering `{ ok, taken }`; the views gain `survey` (the latest event).

- [ ] **Step 1:** Failing tests: finishing setup records exactly one survey; a throwing adapter still finishes setup with `hostReached: false`; `/survey/again` takes one when the host was missed and none when it wasn't, and only once.
- [ ] **Step 2:** Run the three files: fail. **Step 3:** Implement. **Step 4:** Run, plus `node --test tests/scripts/setup/ tests/scripts/host/`: pass.
- [ ] **Step 5:** Commit "Record a survey of the project when setup finishes".

### Task 4: The briefing mentions it once

**Files:** Modify `scripts/briefing/model.js`, `scripts/briefing/text.js`, `scripts/briefing/seen.js`, `scripts/frontdesk/cli.js` (`views survey`), `scripts/hooks/board-context.js` where the briefing is given; Test `tests/scripts/briefing/*.test.js`, `tests/scripts/frontdesk/cli.test.js`

**Interfaces:**
- Consumes: Tasks 2 and 3.
- Produces: `Briefing.found: string[]` (`briefingLines` of the latest survey whose id isn't `seen.surveyAt`), placed after `first`; the caller marks `surveyAt` only when the text showed the lines (ruling P8); with `hostReached: false` the briefing asks `/survey/again` before it is built; `views survey` prints the survey as short lines, the rules found among them, numbered, with their sources.

- [ ] **Step 1:** Failing tests: shown once, then not again; a briefing cut short leaves it due; Review Focus 1 and 2; `views survey`.
- [ ] **Step 2:** Run: fail. **Step 3:** Implement. **Step 4:** Run `node --test tests/scripts/briefing/ tests/scripts/frontdesk/`: pass.
- [ ] **Step 5:** Commit "Mention what the survey found in the first briefing, once".

### Task 5: Step 5 only reads the rules

**Files:** Modify `scripts/setup/rules.js` (`rulesStep`), `scripts/setup/health.js` (the survey's `rules`), `scripts/lib/calm-words.js` (step 5's line), `skills/intake/SKILL.md` (one line), design table row 5 and section 9 note brought to "built"; Test `tests/scripts/setup/rules.test.js`, `tests/scripts/setup/steps.test.js`, the setup end-to-end helpers that answer step 5's cards (`tests/helpers/setup-*.js`)

**Interfaces:**
- Produces: `rulesStep().plan` settles at once with `record: { rules: <n> }` and the `say` line "Found <n> rules in the project; they're followed as they are." ("No rules found to follow." for none); `findRules` also reads `instructionsOf(folder).files`; `finishSetup` passes `rulesOf(...)` as the survey's `rules`; the intake skill says: when a rule from `views survey` first matters to a decision, record it as a ruling with its words and source and ask its confirm card.

- [ ] **Step 1:** Failing tests: step 5 asks nothing and settles with the count; rules from `AGENTS.md` are found with their source; the e2e helpers no longer answer step 5's cards.
- [ ] **Step 2:** Run: fail. **Step 3:** Implement; remove step 5's card code from `rules.js` (keep `findRules`, `rulesOf`, `matchWords`, `readTranscripts`, `folderEntries`). **Step 4:** Run `node --test tests/scripts/setup/ tests/e2e/setup.test.js`: pass.
- [ ] **Step 5:** Commit "Follow a project's rules as they are, with no cards at setup".

### Task 6: Work started from a ready-made commit (Safety: yes)

**Files:** Modify `scripts/state/events.js` (work's `from`), `scripts/foreman/act.js` (`start`, `makeWorktree`), `scripts/feature/files.js` (`BRIEF_KEYS` gains `from`), `scripts/feature/brief.js`, `templates/brief/brief.md`, `skills/foreman/SKILL.md` (one line); Test `tests/scripts/foreman/act.test.js`, `tests/scripts/feature/brief.test.js`, `tests/scripts/state/events.test.js`

**Interfaces:**
- Produces: the work event may carry `from: { sha: 40 hex, ref: 'refs/wheelhouse/from/<id>', request?: whole number }`; `start` for such work makes `feature/<work>` from `from.sha` after `rev-parse --verify <ref>^{commit}` equals it, else refuses "The change this work starts from isn't there as it was recorded: ask the director" (Review Focus 3); the brief's fields carry `from`; its text says the work starts from a ready-made change, to read it (`git diff <default>...HEAD`) and the work's document first, and, with `request`, that the pull request's body begins "Carries on #<n>."; nothing pushes to the request's own line.

- [ ] **Step 1:** Failing tests: start from a recorded commit; a moved ref refused; the brief's paragraph with and without `request`.
- [ ] **Step 2:** Run: fail. **Step 3:** Implement. **Step 4:** Run `node --test tests/scripts/foreman/ tests/scripts/feature/ tests/scripts/state/`: pass.
- [ ] **Step 5:** Commit "Start work from a ready-made change".

### Task 7: Carrying on, archiving and restoring (Safety: yes)

**Files:** Create `scripts/survey/ready.js`; Modify `scripts/host/helper.js` (routes `/survey/carry-on`, `/survey/archive`, `/survey/restore`), `scripts/host/helper-client.js`, `scripts/frontdesk/cli.js` (`carry-on <n>`, `archive`, `restore`); Test `tests/scripts/survey/ready.test.js`, `tests/scripts/host/helper.test.js`, `tests/scripts/frontdesk/cli.test.js`

**Interfaces:**
- Consumes: Tasks 1, 2, 6.
- Produces:
  - `carryOn({ git, adapter, remoteUrl, number, work }) -> { sha, ref, request, title, body, files, commits }`: fetches `adapter.pullRef(number)` into `refs/wheelhouse/from/<work>` in the project's folder with the director's git environment (as step 7's `gitFor`), checks the ref against the request's head, and gives what a brief is written from (the body left out when the secret scan finds anything).
  - `archiveCommit({ git, defaultRef, files, work }) -> { sha, ref, moved }` and `restoreCommit({ git, defaultRef, work }) -> { sha, ref, moved }`: plumbing only (`read-tree`, `update-index`, `write-tree`, `commit-tree` with a temporary index), ruling P5, built on the default branch as it is now (Review Focus 5), author the signed-in host account as step 7's commit.
  - Routes answer `{ ok, work, from, ... }`; refused under STOP. `cli.js carry-on <n>` prints the details and the `from` to record; `cli.js archive` / `restore` print the moved list and the `from`. The front desk then records the work as the intake does (quick lane for archive and restore, with an approval card in the design's archive card words; the lane the intake chooses for carrying on) — words in `skills/front-desk/SKILL.md`, one short section.

- [ ] **Step 1:** Failing tests: a fork's request fetched by its pull ref (Review Focus 4); a head that moved refused; the archive commit moves exactly the files, writes the manifest and README, touches no working copy; restore reverses it; a missing file left out.
- [ ] **Step 2:** Run: fail. **Step 3:** Implement. **Step 4:** Run `node --test tests/scripts/survey/ tests/scripts/host/ tests/scripts/frontdesk/`: pass.
- [ ] **Step 5:** Commit "Carry on a change, or archive another setup's instructions, from a ready-made change".

### Task 8: Wheelhouse's instructions come first

**Files:** Modify `templates/brief/override.md`, `skills/front-desk/SKILL.md`, `skills/foreman/SKILL.md`; Test `tests/scripts/feature/brief.test.js`, `tests/skills/*.test.js` where they pin playbook lines

**Interfaces — Produces:** one sentence in each, first among their rules: "Where instructions from another agent setup in this project differ from Wheelhouse's, Wheelhouse's come first; follow the project's own rules wherever they don't clash."

- [ ] **Steps:** failing test that the override begins with the sentence after its heading; add it; run `node --test tests/scripts/feature/ tests/skills/`; commit "Put Wheelhouse's instructions first over another agent setup's".

### Task 9: Uninstall puts the archive back (Safety: yes)

**Files:** Modify `scripts/setup/uninstall.js`, `scripts/setup/uninstall-run.js`; Test `tests/scripts/setup/uninstall.test.js`

**Interfaces — Produces:** when the default branch holds `.wheelhouse-archive/archived.json`, uninstall's pull request also moves each file back and removes the folder, and its card says "the other agent setup's instructions, back where they were" (ruling P6); a shared project leaves it as it is.

- [ ] **Steps:** failing tests for the pull request's files and the card line; implement; run `node --test tests/scripts/setup/uninstall.test.js`; commit "Put archived instructions back at uninstall".

### Task 10: End to end, the design and the handover

**Files:** Create `tests/e2e/project-under-way.test.js`; Modify `HANDOVER.md`, the design's section 15 (A1 to A8 marked built, with this plan named)

- [ ] **Step 1:** The end-to-end test, with a made-up project shaped like one in flight: an older agent setup (`.claude/skills/helper-skill/SKILL.md`, `.claude/agents/writer.md`, `.claude/agents/checker.md`, `AGENTS.md`), an open request on the stand-in host, two worktrees each one commit off the default branch, two scheduled workflows, `.env` and `.env.local`. It finishes setup through the helper, asserts the survey event and that nothing in the folder or on the stand-in host changed (no close, delete or push in the stand-ins' log), the first briefing's lines once, then `carry-on` and `archive` giving ready-made changes and the foreman starting from one.
- [ ] **Step 2:** Run `node --test tests/e2e/project-under-way.test.js`: pass.
- [ ] **Step 3:** `npm test`; `GIT_CONFIG_NOSYSTEM=1 GIT_CONFIG_GLOBAL=/dev/null npm test`; `npm run mod-check`; `npm run private-check`.
- [ ] **Step 4:** HANDOVER.md item; design marked built.
- [ ] **Step 5:** Commit "Test fitting around a project under way end to end, and bring the handover up to date".
