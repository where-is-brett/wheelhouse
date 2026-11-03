<!-- docs/specs/2026-11-03-compaction-design.md -->

# Compaction that loses nothing: design (3 November 2026)

## 1. The problem in plain words

When a conversation gets too long, Claude Code squeezes it into a summary, and anything that existed only in the conversation can be lost. Three parts of Wheelhouse's answer don't work. The hold never holds, because nothing writes its marker. The "prepare" warning reaches a session only when someone types, so unattended runs never get it. And after a compaction, the reload gives back the project's records but not where this session had got to.

## 2. What the evidence changes in the director's direction

- **Most unattended work already saves at step boundaries.** Archon nodes start fresh (`"context": "fresh"` across the pack), builders commit each green step (`prompts/implement.md`, step 5), task records and `order.json` live in the run's artefacts, the goal ledger belongs to the helper, and the foreman starts fresh at every wake. So item 3 mostly exists. What's missing is a backstop for the odd long node and for `claude -p --resume` sessions (section 3.4).
- **The hold can't make anything save.** For an automatic compaction the block's reason is never shown to the model (hooks docs, PreCompact). A hold only delays, and nothing tells the model to use the delay. It has a second cost: the hook can't tell a planned compaction from one recovering from a context-limit error, and blocking the recovery kind "fails the current request". In a headless step, that means a failed step.
- **Notes the model writes go stale; records don't.** A per-session handover file only helps if the model keeps it up to date, and a stale one misleads. Most of "where I am" can be read from records that already exist. A model-written note is kept for the one thing records can't hold, the session's intent, and is optional (decision 1).

## 3. The pieces

### 3.1 "Where you were" digest (new, no model tokens to write)
- **What:** a block of at most 1,500 characters, added to the existing reload when `source` is `compact`. It sits inside the reload's 9,000-character cap.
- **Built from:** the session's role (`scripts/lib/role.js`); the feature ledger path; branch, last commit subject and uncommitted file count (git, 1-second limit); this session's open cards where the record carries the session id (else the waiting list, as now); the running goal's ledger pointer; and the session note (3.2) with its age and commits since.
- **Written by** `session-start.js` through a new `scripts/hooks/where.js`, **triggered** by SessionStart `compact` (manual, automatic and idle alike). The same start clears `preparedAt` (3.4), so no PostCompact hook is needed.

### 3.2 Session note (optional: decision 1)
- **Where:** `<wheelhouse home>/projects/<project>/sessions/<id>.md`, next to the gauge's `<id>.json`. It is outside every repository, so it never reaches the public repo and works for a project of any shape.
- **Who writes it and when:** the model, through `<Wheelhouse command> note` (standard input, up to 1,200 characters, written to a temporary file and renamed), after a commit, an answered card, a step's end, or the gauge's warning. Four lines: task, done, next, open decisions. One line in the front desk's skill and in the warning asks for it. Archon nodes don't write it; their commits and artefacts do the job.

### 3.3 Compact instructions (existing, extended)
`COMPACT_SECTION` in `scripts/setup/project-files.js` gains two bullets: "the ids of the cards, runs and goal pieces in play" and "the session note's path, if one was written". Today setup adds the section only once (`hasSection`). So a project already set up gets the new wording only when its section still matches an earlier Wheelhouse text exactly, compared by hash, the way `local-refresh.js` treats allow rules. A section the director has edited is left as it is. This is the only documented lever over an automatic summary (https://code.claude.com/docs/en/costs).

### 3.4 Prepare warning on tool use (the headless backstop)
`context-gauge.js` also runs on PostToolUse. PostToolUse may add `additionalContext`, which goes next to the tool result (hooks docs). On a tool call the gauge speaks only once per episode, the first time the context is at or past the prepare point (`compactPrepare`, after #236), and records `preparedAt` in the session file. It reads the transcript at most once every 5 seconds per session (it keeps `at`). On UserPromptSubmit it behaves as now. The warning says: "Context is about Nk tokens. Finish this step, commit, write your session note, then carry on."

### 3.5 Remove the pre-compaction hold (item 4; see section 6)

## 4. Exact hook changes (`hooks/hooks.json`)
- **PreCompact:** delete the entry, and delete `scripts/hooks/precompact-guard.js`.
- **PostToolUse `*`:** add `context-gauge.js` after `feature-status.js`, timeout 10.
- **UserPromptSubmit:** unchanged.
- **SessionStart:** unchanged matcher. On `compact`, `decide` adds the digest and resets the episode.
- Node built-ins and `path.join` only, no shell pipes: macOS and Windows alike.

## 5. What changes for the director
Nothing visible. `compactPrepare` and `compactWindow` (#236) keep their meaning; after a compaction the session simply knows where it was.

## 6. The test that decides item 4

**The documents agree with check 3.** The hooks page says a planned compaction that is blocked is "skipped and the conversation continues uncompacted". Check 3 (Claude Code 2.1.278) saw the blocks come back 11 to 17 seconds apart within one turn. The likely reading: compaction is re-checked before each API request while the context is over the window. If so, a held compaction comes back only while the model keeps making requests.

**Test (probe 03b, re-using `probes/03-precompact/` and its scratch project; about 10 minutes):**
1. Settings in a scratch project only: `autoCompactWindow: 100000`, and a PreCompact `auto` hook that logs each call (time and input) and always blocks. Use the smallest model to keep the cost low.
2. Turn 1: read the filler files up to about 110,000 tokens.
3. Turn 2, resumed: "Run `sleep 40` three times, one at a time, then reply 'done'." This makes four requests with 40-second gaps.
4. Compare the hook's call times with the times of the assistant entries in the transcript. Then check whether the model's replies mention the block, or the transcript holds its reason.
5. Turn 3: switch the hook to allow, and confirm a `compact_boundary` appears.

**Outcomes:**
- **A. Calls line up with requests, none come during the sleeps, and the model sees nothing (expected):** the hold is skipped and re-tried per request. Remove it.
- **B. Calls come on a timer, during the sleeps:** it is retried, but the model still isn't told. The 3.4 warning, at least 100,000 tokens earlier, does the same job without the recovery risk. Remove it.
- **C. The model sees the reason:** a real marker would then work. Make it real: PostToolUse writes `unsaved-<session>` after an edit or commit, and `note` clears it. Keep the two-minute give-up.

Cost: a few hundred thousand cached input tokens on the smallest model.
## 7. Risks and out of scope
- **Risks:** the PostToolUse gauge adds a hook on every tool call. The 5-second throttle and a tail-only reading keep it cheap; if it shows up in timing, fold it into `feature-status.js`. A note not yet written falls back to the digest and the summary, no worse than today. Removing the guard overlaps #236 ("window + 60,000"), so part 1 waits for #236 to merge.
- **Out of scope:** the window itself (#236), subagent windows, storing summaries, Copilot.

## 8. Build plan (one session each; run only the tests each touches)
1. **Remove the hold** (after #236): `scripts/hooks/precompact-guard.js` (delete), `hooks/hooks.json`, `tests/scripts/hooks/context.test.js`, `tests/scripts/hooks/kit.test.js`, `scripts/hooks/context-gauge.js` (header comment), the design's section 10 step 5 and the lists at about lines 717 and 1696, plus a ruling in section 22.
2. **Prepare warning on tool use:** `scripts/hooks/context-gauge.js`, `hooks/hooks.json`, `tests/scripts/hooks/context.test.js`, design section 10 step 3.
3. **Digest at compaction:** new `scripts/hooks/where.js`, `scripts/hooks/session-start.js` (`reload`, episode reset), `tests/scripts/hooks/where.test.js`, `tests/scripts/hooks/session-start.test.js`, design section 10 step 6.
4. **Session note and Compact instructions:** `scripts/frontdesk/cli.js` (`note`), the front desk's skill (one line), `scripts/setup/project-files.js` (wording and hash refresh), `tests/scripts/frontdesk/cli.test.js`, `tests/scripts/setup/project-files.test.js`.5. **Probe 03b**, before part 1 is merged: `probes/03-precompact/` and `docs/checks/03-precompact-retry.md` (addendum). If the outcome is C, part 1 becomes "make the marker real".

## 9. Decisions for the director
1. **Session note.** (a) Records only: the digest, no note. (b) Digest plus a note for the front desk and sessions started by hand. (c) A note in every session, Archon nodes included. **Recommend (b):** intent is the one thing records can't hold, and nodes already commit each step.
2. **The pre-compaction hold.** (a) Remove it now, on the documents and check 3. (b) Run probe 03b first, then act on what it shows. (c) Keep it as it is. **Recommend (b):** a 10-minute, low-cost probe on 2.1.302 before deleting a safeguard the design names.
3. **Projects already set up.** (a) Bring their Compact instructions up to date when they still hold Wheelhouse's own wording. (b) Only new setups get the new wording. **Recommend (a):** it leaves edited sections alone.

## Sources
- Hooks reference: PreCompact (block skips a planned compaction; a blocked recovery fails the request; `auto` carries no instructions), PostCompact (no decision control), PostToolUse and SessionStart `additionalContext`, the 10,000-character cap. https://code.claude.com/docs/en/hooks.md, read 3 November 2026.
- Compact instructions: https://code.claude.com/docs/en/costs
- Progress files for long-running work: https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents
- Repository: `docs/checks/03-precompact-retry.md`; design section 10; `scripts/hooks/{precompact-guard,context-gauge,session-start}.js`; `hooks/hooks.json`; `engine/archon/pack/*.yaml` and `prompts/implement.md`; PR #236's description.

## Director's decisions (3 November 2026)
- Session note: (b) the front desk and sessions started by hand; not engine nodes.
- The hold: run probe 03b first, then act on its outcome.
- Projects already set up: refresh their Compact instructions where they still hold Wheelhouse's own wording.
- Main session's change: the tool-use save warning rides on the existing PostToolUse `*` hook (`feature-status.js`) rather than adding a second hook process per tool call.
