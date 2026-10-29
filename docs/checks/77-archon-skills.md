<!-- docs/checks/77-archon-skills.md -->

# Check 77: skills inside Archon's steps (early check E4)

**Answer:** Partly. Of the eleven items the pass rule counts, nine passed. Item 7 did not show what it was meant to show. Item 11 (Copilot) is Deferred: it waits on the director's answer about Copilot spend. Item 10, the nice-to-have, also passed. In detail:

- Skills load inside Archon's Claude steps as section 7.1 needs. The allowlist is exact. Test-first shows in the transcripts, with the plugin's original and with Wheelhouse's copy. No step asked a person, and the three-round loop kept its earlier rounds' work. The pairing works, and a misspelt name only warns.
- Two results change the design's choices, not its shape. **The same rules written into the prompt did as well as the skill** (item 8), so the prompt text carries the method. **A plain name does find a plugin's skill, but it also lets in a project or user skill of the same name**, so Claude steps should keep the prefixed form.
- Matt Pocock's original `code-review` did not spawn helpers in two runs (item 7). The agent skipped the skill's own process instead.

## Question

Do skills inside Archon v0.13.0's Claude steps behave as section 7.1 of the Archon design needs? Spec section 15 lists twelve items: loading scope, test first, the Superpowers hook, no person, a loop that keeps earlier work, the pairing, a skill that orchestrates, skill against prompt text, a misspelt name, slash prompts, Copilot and the full suite. The check also asks whether a plain name (`tdd`) finds a plugin's skill. That answer decides whether the pack writes one name form or two (section 7.1, designer's call 34).

## Tested on

29 October 2026, on macOS. The engine was the scratch Archon v0.13.0 compiled binary with Bun 1.4.3, Claude Code 2.1.302, and the Claude provider on the Mac's subscription. Archon was always run through `archonRun` with the spec 6.3 environment, telemetry off. The skill sources were Matt Pocock's skills 1.3.1 (`mattpocock-skills@wheelhouse`) and Superpowers 7.0.0 (`superpowers@claude-plugins-official`), both already installed for Claude Code. Builder steps used the mid-sized model and listing or planning steps used the small model. There were 18 Claude steps over 14 runs, and every conclusion rests on one run of its case. They cost about $0.85 in all.

## Method

`probes/77-archon-skills/run.js` makes two scratch projects from `probes/77-archon-skills/task/`, each with a local bare remote, under `<temporary folder>/wheelhouse-archon-checks/e4/`. The task is a small Bun library, and its done check (`sh check.sh`) fails until `formatPrice` exists. The runner then runs each item's workflow from `probes/77-archon-skills/workflows/` with `archon workflow run <name> --detach`, `wait` and `get --json --verbose`. For each run it keeps the record, Archon's log and the Claude Code session transcripts. It reads the measures with the functions the tests cover: `testFirst`, `suiteRuns`, `skillsOpened`, `askedAPerson`, `tokensPerRound` and `sessionTokens`.

- **"The plugin's original"** is the installed plugin, named in the node: `plugins: [mattpocock-skills@wheelhouse]` and `skills: [mattpocock-skills:tdd]`.
- **"Wheelhouse's copy"** is a copy placed as a project skill in the second scratch project, under `.claude/skills/<name>/`, and named by its plain name (`skills: [tdd]`). The copies, with their licences and a note of their source and version, are in `probes/77-archon-skills/plugin/skills/`.
  - A scratch Wheelhouse-shaped plugin was not used. Archon's source (`packages/providers/src/claude/plugins.ts`) accepts only a `name@marketplace` id that `claude plugin list --json` reports. It checks the session's start-up frame against that id, so a local plugin folder cannot be named. Installing a new plugin would have written the director's Claude settings.
- **Items 2, 3 and 8** use the same task and prompt, and differ only in where the method comes from:
  - item 2 with the original, then with the copy
  - item 3 with Superpowers' `test-driven-development`, from the named plugin and from a copy
  - item 8 with no skill and `tdd`'s key rules written into the prompt
- **Every builder prompt carries the adapted rules of section 7.1.** No one will answer: record an assumption or take the blocked exit. Earlier rounds' committed code stands. Run the full suite once, at the end. Each builder step returns `{status: done|assumption|blocked, assumptions, summary}`.
- **Item 4:** an open request ("add discounts", with no seams given) under the original `tdd`. Then a bug with three failed fixes and no logs under the original `diagnosing-bugs`. Each step had a 3-minute idle limit, so neither could sit until Archon's idle timeout.
- **Item 5:** a `loop:` node with `fresh_context: true`, three rounds and `until_bash: bun run checks/loop.ts`. Each round does the next unticked task in `TASKS.md` with the copy of `tdd`.
- **Other items:** item 6 plans a change with `[tdd, codebase-design]`, then again with `[tdd]` alone. Item 7 reviews a planted commit with the original `code-review`, once on a 5-line change and once on a 22-line change across three files. Item 9 names `tddd`. Item 10 starts the prompt with `/tdd`. One more run (`e4-collide`) names the plugin and a plain `tdd` in the project that also holds the copy.

**Undo.** Afterwards, `<temporary folder>/wheelhouse-archon-checks/e4/` (projects, remotes, evidence) and the check's folder under the scratch Archon home (`home/workspaces/e4/`: its logs, worktrees and frozen workflow sources) went to the Trash. So did the Claude Code session transcripts that these runs' worktrees left under the user's `.claude/projects/`. The scratch Archon database still lists the two projects. It goes when the shared scratch engine is removed.

## Evidence

Tokens are a step's input plus output, as the run record gives them. Archon's `input` already includes the cached tokens, and 96 to 99% of every step's input was cache reads.

| Item | What ran | Result | Tokens (cost) |
|---|---|---|---|
| 1 Loading scope | small model, `skills: [mattpocock-skills:tdd]` | **Pass.** The model saw one skill, `mattpocock-skills:tdd`. Opening `mattpocock-skills:codebase-design` gave `Skill … is not in this session's skills allowlist`, and `superpowers:brainstorming` gave `Unknown skill`. Both are tool errors, and the step completed | 45,855 ($0.001) |
| 2 Test first, original | mid-sized model, the plugin's `tdd` | **Pass.** A test was written, run red (`Cannot find module`), then code was written | 170,768 ($0.130) |
| 2 Test first, copy | mid-sized model, the copy as `tdd` | **Pass.** It went test, red, code, then a second red slice for the negative case, then green | 119,806 ($0.054) |
| 3 Superpowers hook | Superpowers' TDD skill, with the plugin named and as a copy | **Pass.** With the plugin, `using-superpowers` was pasted in by its start-up hook (a `hook_additional_context` attachment). The first turn was 1,319 tokens larger (22,591 against 21,272), and the whole step was 9,293 tokens (6%) larger. The step did not brainstorm, ask or open other skills. Both runs were test-first | 165,563 ($0.071) with the plugin; 156,270 ($0.061) without |
| 4 No person, open request | original `tdd`, seams not given | **Pass.** It recorded an assumed seam (`applyDiscount` in `src/discount.ts`) with status `assumption` in 31 seconds, and asked no question | 195,387 ($0.067) |
| 4 No person, third failed fix | original `diagnosing-bugs`, no logs | **Pass.** It recorded its assumptions and finished in 29 seconds without a question. It did not take the blocked exit: it found a real rounding fault in the code the previous step wrote, and corrected it test-first | 187,211 ($0.080) |
| 5 Loop keeps earlier work | three rounds, fresh context, the copy | **Pass.** It opened `tdd` in every round, and each round was test-first and ran the suite once. There were three commits; rounds two and three added to `src/price.ts` and deleted nothing. The done check passed after round three | 384,932 ($0.199) for the loop; rounds 133,346, 135,174 and 112,053 |
| 6 Pairing | small model, `[tdd, codebase-design]`, then `[tdd]` | **Pass.** With both allowed, `tdd` led to `codebase-design`, which opened. With it left off, the call gave the allowlist error. The step went on and said in its report that its interface choices were its own reasoning, not the reference's | 75,553 and 96,232 ($0.004, $0.003) |
| 7 A skill that orchestrates | original `code-review`, 5-line and 22-line changes | **Not shown.** Neither run spawned a helper. In both, the agent wrote that it "reviewed the … diff directly instead of spawning sub-agents", noted that `docs/agents/issue-tracker.md` was missing, and used only the code-smell list | 123,443 and 97,675 ($0.058, $0.054) |
| 8 Skill against prompt text | mid-sized model, rules in the prompt, no skill | **Prompt text did as well.** It was test-first, in three vertical red-green slices (the skill runs did one or two). It ran the suite once at the end | 160,903 ($0.057) |
| 9 Misspelt name | `skills: [tddd]` | **Pass on Archon's side.** Archon logged the warning `claude.skills_unresolved` ("an unknown name is ignored rather than loaded"). The step ran with no skills at all and completed. The pack's own check is part 3b's to build; the probe's `unknownSkills` shows the rule | 23,075 ($0.001) |
| 10 Slash prompt | prompt starting `/tdd` | **Yes.** Claude Code took `/tdd` as the skill's command and put the copy's full text into the context before the first turn. No Skill tool call was made | 23,055 ($0.001) |
| 11 Copilot | | **Deferred**, pending the director's answer on Copilot spend. Not run | |
| 12 Full suite | items 2, 3, 5 and 8 | **Pass.** Every implement step and every loop round ran `bun test` on the whole suite once, at the end. The done check `sh check.sh`, run just before committing, runs the suite once more inside it. The one exception is item 4's open request, which ran it twice: its first commit carried a failing test, so it corrected that and ran the suite again | |

**Plain names (designer's call 34).**

- A plain `tdd` in `skills:`, with the plugin named and no project skill, selected the plugin's skill. The model saw it listed as `mattpocock-skills:tdd`, and a Skill call with `tdd` opened it.
- A Skill call with the plain `tdd` also opened it when the allowlist held the prefixed `mattpocock-skills:tdd`.
- In the project that also held the copy, a plain `tdd` with the plugin named listed **both** `tdd` and `mattpocock-skills:tdd`, and the call opened the project copy.
- Archon warns (`claude.skills_unresolved`) for every name it can't find on disk, prefixed names included. So the warning cannot tell a misspelt name from a plugin's skill.

**Run records and tokens per round.**

- Archon's run record keeps one row for a whole `loop:` node: its total tokens and cost, and one session id per round. The archon log has no per-round figures either.
- Each round's figure above comes from that round's Claude Code session transcript (`sessionTokens`). The three rounds add up to 380,573 tokens, within 1.2% of the record's total of 384,932.
- Every Claude step started at about 21,300 tokens before any work: the system prompt, the tool list and the user's Claude settings, which load by default.

**Plugins installed at another project's scope.**

- The first run of item 1 failed before the model started, with `Claude Code's plugin set does not match the node's plugins: named plugins did not load: mattpocock-skills@wheelhouse`.
- At that moment the plugin was installed for Claude Code only at the scope of a different project. Its user-scope install is dated four seconds later. Run again after that, the same workflow passed.
- `claude plugin list --json`, which Archon reads, lists plugins of every scope. So Archon's "is it installed" test passes for a plugin that Claude Code will not load in this project, and the node then fails.
- The scratch home's logs show check 75's runs failing the same way for `wheelhouse@wheelhouse`, which is installed only at another project's scope.

**Other observations.**

- The third-failed-fix step wrote a throwaway script to `/tmp/dbg`, outside its worktree, and removed it itself. These runs had no sandbox, which is check 75's subject.
- The item 4 step's first commit had a failing test in it, because a `sed` edit failed on macOS. It corrected this in a second commit.

### What was not tested

- Item 11 (Copilot).
- Superpowers' TDD skill on items 4 and 5.
- The Superpowers plugin with a builder that is told to brainstorm.
- The most capable model, and real lane-sized tasks: the measures come from one small task, and each case ran once.
- Copies inside a real Wheelhouse plugin (`wheelhouse:tdd`) rather than as project skills.
- A same-named skill at user level, rather than project level, competing with a plain name. Section 7.1 notes that one may exist; the project-level case suggests it would be selected too.

## What it means for the design

For part 3b:

- **The pack writes the prefixed form for Claude steps, and keeps two forms (designer's call 34 stands).** A plain name finds a plugin's skill, so one form would work. But a plain name also brings in any project or user skill of the same name, and the plain call then opened the project's copy rather than the plugin's. A project being built may well have its own `tdd`. So Claude steps name `wheelhouse:tdd`, which matches exactly, and Copilot steps use the plain name, as section 7.1 has it. The pack's own name check must do the catching, because Archon warns on prefixed names as well and so can't tell a misspelt name from a plugin's skill.
- **The prompt text carries the method.** Items 1, 2 and 5 passed for the copies, so the copies are not a fallback. But item 8's prompt text did as well as the skill, with cleaner slices and similar tokens, and by spec 15 a tie goes to the prompt text. Implement and fix steps write the method into the prompt in Archon's own way, and name the skill only in the prompt's words. A step keeps a skill copy on its allowlist only where a later counted evaluation shows the copy doing better. This check did not show that for `tdd`. `codebase-design` stays available as a reference: item 6 showed the call from `tdd` to it working.
- **Superpowers' pair does not replace Matt Pocock's.** Superpowers' TDD skill was test-first and ran the suite at the end, as `tdd` did: no clearly better result on items 2 or 12. It was not run on items 4 or 5. Item 3 confirms why no node names the Superpowers plugin: its hook adds about 1,300 tokens to every turn's context, 6% more on this step, for no change in behaviour.
- **`code-review`'s Adapt verdict stands, on different evidence.** The original did not spawn helpers. The agent set aside the skill's own process, and noted the missing setup file. Either way, a step cannot rely on the skill as written. Splitting it into the two lens steps keeps what matters and drops what the agent skipped anyway.
- **Tokens per round for the spend meter.** On the mid-sized model, a small task's implement round costs about 112,000 to 135,000 tokens (about 127,000 on average), or about $0.066 at the provider's figures. 96 to 99% of each round's input is cache reads, and about 21,300 tokens of every step is constant start-up context. The meter can't take per-round figures from Archon's record, which has one total per loop node. It should count per node from the record. Where it needs per-round figures (a round cap, the counted evaluation), it should read them from the rounds' session transcripts, which matched the record within 1.2% here.
- **No-person rules work as written.** The section 7.1 wording held under the original, unadapted skills: assumptions were recorded within about 30 seconds, and no question was asked. So the adapted copies need no stronger wording for this.
- **For setup, and for check 75:** a node can name only a plugin that Claude Code loads in that project. Setup must install Wheelhouse's plugin at user scope, or at the scope of the project being run. An install at another project's scope passes Archon's inventory test but fails every node that names it.

These go to the main session as cards: the prompt text taking over the method, the prefixed form staying, and the plugin scope for setup.

## Needs the director

Nothing for this check. Item 11 waits on the director's answer about Copilot spend, which the main session already holds.
