<!-- docs/checks/53-windows-grants.md -->

# Check 53: granting build commands to a feature session on Windows

**Answer:** Deferred — waiting for the director's Windows sitting. The probe is written and tried on the Mac against a stand-in for `claude`; no Windows output exists yet.

## Question

Whether a `claude -p` feature session started through `claude.cmd` refuses an unallowed `npm test` at once rather than waiting, and runs it when `--allowedTools` names it, and runs the Guarded runner's rule; whether Claude Desktop on Windows applies any sandbox of its own (the research found conflicting reports, section 2.1 of `docs/research/windows-build-commands-2026-10.md`); and, only if check 27 gives Shape 2, whether a running Desktop session picks up an allow rule written into its worktree's `.claude/settings.local.json`.

## Tested on

19 October 2026, on macOS only, which cannot answer it: the probe refuses to run off Windows. What was done there:

- The pure parts (the judgement of each trial from the session's stream, the option parsing, the runner's allow-rule form) have tests that run on any system (`tests/probes/53-windows-grants/run.test.js`, `tests/probes/lib/windows.test.js`), and the stand-in runner script was run on the Mac.
- The whole probe was run on the Mac with `--allow-off-windows` against a stand-in `claude` that printed a stream of the shape `claude -p --output-format stream-json` prints and refused or ran the command by the rule it was given. That showed the four trials, the cleanup and the log work; it says nothing about Claude Code.
- The shape of the stream the judgement reads (a `result` event with `permission_denials`, `tool_use` blocks for Bash, error `tool_result` blocks) was taken from the fields `scripts/eval/harness.js` already reads and from Claude Code's headless documentation; it has not been checked against a real refusal on Windows.

## Method

`probes/53-windows-grants/run.js --model <name>`, on Windows, finds `claude` as `claude.exe` or `claude.cmd` the way check 27's probe does (`resolveClaude` and `invocation` from `scripts/lib/claude.js`, so a `.cmd` shim gets its prompt on standard input). The model is named on the command line or in `WHEELHOUSE_PROBE_MODEL`, never in the repository. Each trial is one `claude -p` session in a scratch project (a package whose `npm test` writes `ran.txt`), with `--permission-mode default` and project and local settings only (so the director's own rules can't change the result), the host session's variables left out of its environment as check 27's trials do, and a 3-minute limit. The prompt is made up: "Run `npm test` in this project with the Bash tool. When it has finished, reply with the single word DONE and nothing else."

1. `grants-no-allow-rule`: no allow rule. PASS if the session was refused (the result lists a permission denial) within the limit and `ran.txt` was not written; FAIL if it was still waiting at 3 minutes, or the command ran.
2. `grants-npm-test-allowed`: `--allowedTools "Bash(npm test:*)"`. PASS if `ran.txt` was written and nothing was refused.
3. `grants-runner-rule`: the runner's rule in Task 6's form, built with the path form `scripts/foreman/tools.js` makes (forward slashes, a drive letter, single quotes, which pass through `claude.cmd`'s `cmd.exe` line): `Bash('<low node.exe>' '<runner>':*)`, with the session told to run exactly `'<low node.exe>' '<runner>' npm test`. The runner is a stand-in script (`probes/53-windows-grants/standin-runner.js`) that notes its integrity level and runs the rest of its command line; the probe makes its own low copy of `node.exe` as check 52 does, labels the scratch project low, and uses the normal `node.exe` instead, saying so on the `low-copy` line, if the copy won't start. `grants-runner-integrity` reports the level the runner noted.
4. `grants-plain-npm-test-with-runner-rule-only`: the same rule, but a plain `npm test`. PASS if it was refused (the runner's rule must not allow anything else).

Each line carries the time and the command the session tried. The Desktop question is by hand (`probes/53-windows-grants/run.md`, Part 2: Settings, Claude Code, a "Local sandbox" row; `touch ~/sandbox-probe` in a local session, the research's section 8.4, item 9). The last question applies only if check 27 gives Shape 2 (Part 3 of the run sheet).

## Evidence

None from Windows yet. The lines will be pasted here, per computer, after the sitting.

## What it means for the design

Task 6 builds the runner on the answers; Tasks 2 to 4 (the cards and the grants) wait on the first two lines too.

- **`grants-no-allow-rule` PASS (refused at once):** a feature session that wants a build command it has no rule for gets a refusal it can report, and the waker's grant flow (Task 3) can rely on a refusal arriving instead of a hung session; the session then asks for the command with `ask --kind build-command`. **FAIL because it waited:** the session cannot be left to discover it needs a grant; the waker must decide before starting the session which commands it gets, and the card's wording ("the feature will wait") is changed. **FAIL because the command ran:** something on the computer already allows `npm test` (a managed policy); the line says so, and the level cards must not claim the command was held.
- **`grants-npm-test-allowed` PASS:** the `--allowedTools` route works through `claude.cmd`, so "allow this time" and the run grants (Task 3) can use it unchanged. **FAIL:** the rule needs another form on Windows (the lines show the command the session tried, which says whether the rule or the quoting was at fault), and Task 3's rule builder changes with it.
- **`grants-runner-rule` PASS:** the single allow rule for Guarded, `<commandPath(lowNode)> <commandPath(guarded.js)>`, matches the command the session runs, and `commandPath` in `scripts/lib/command-path.js` (Task 6) is the right form. `grants-runner-integrity` says whether the runner really ran at low when started that way. **FAIL:** the rule form does not match (the quoted forward-slash paths are the likely cause) and the plan's call 6 (an explicit runner with one rule, rather than a hook rewriting commands) is revisited before Task 6.
- **`grants-plain-npm-test-with-runner-rule-only` PASS:** the Guarded rule opens nothing but the runner. **FAIL:** the rule is wider than it reads, and Guarded's card can't claim the runner is the only route.
- **Desktop's sandbox:** if Desktop applies a sandbox of its own on Windows (a "Local sandbox" row, and `touch ~/sandbox-probe` blocked), the Unattended and Guarded cards say what that adds and Desktop sessions are treated as already contained for writes; if there is none (the likely result, from the documentation: "On native Windows, Claude Code runs commands unsandboxed"), nothing changes and the cards stand. The answer goes in the design's section 12.2 either way.
- **A running Desktop session picking up `.claude/settings.local.json`** (Shape 2 only): if it does, the grant can be written into the worktree's local settings for a Shape 2 foreman; if not, a grant takes effect at the next start of the session.

## Needs the director

One Windows sitting, about 20 minutes together with check 52 (this one is about 10 minutes: 5 for the script, 5 for Desktop). The run sheet is `probes/53-windows-grants/run.md`, on the work computer (managed, the case that matters most) as a standard user, and on a personal one if to hand.

- **The agent running the sitting** runs `node probes/53-windows-grants/run.js --model <model name>` (the agent supplies the model name), reads the lines and fills this note in, and sets the Answer.
- **Only the director** can be at the computer, and can look at Claude Desktop's Settings, Claude Code, for the "Local sandbox" row and run `touch ~/sandbox-probe` in a local Desktop session. If the command line's own sign-in fails there, as check 27 found, the script has to be run from Desktop's terminal pane with `--inherit-env`.

Until then the Answer stays Deferred.
