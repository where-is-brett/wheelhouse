<!-- docs/checks/29-hold.md -->

# Check 29: the hold

**Answer:** Partly — on macOS a PreToolUse hook registered in a project's settings refused an Edit, a Write and a shell command in a headless session, and let a Read through, and it did so even though the shell command had an allow rule and edits were set to be accepted. With no marker file the same hook did nothing and all four ran. Windows is still to be run, in the Windows sitting.

## Question

That a pre-tool hook can refuse edits and commands in a session whose fingerprints did not match, on macOS and Windows.

## Tested on

18 October 2026, on macOS with Claude Code 2.1.302, the two sessions below run twice over, with the default model. Windows was not tried.

## Method

`node probes/29-hold/run.js`, which starts two short headless sessions (`claude -p`, stream-json events, `--setting-sources project,local` so only the throwaway project's settings load, `--permission-mode acceptEdits`, at most 12 turns). Each runs in its own throwaway git project under the temporary folder, which is removed afterwards.

- **The hook.** `probes/29-hold/hold.js`: when the session's folder holds a file named `.hold-probe`, it refuses every tool except `Read`, `Grep` and `Glob`, answering with a `PreToolUse` decision of `deny` and the reason "probe: held". Without that file it prints nothing. The throwaway project's `.claude/settings.json` registers it for all tools, with the command `node "<absolute path to hold.js>"`.
- **The allow rule.** The same settings allow the one shell command the prompt asks for (`Bash(mkdir bash-ran)`, and the PowerShell equivalent), so that nothing but the hook can stop it. `acceptEdits` already lets Edit and Write run without asking. A refusal can therefore only be the hook's.
- **The prompt**, the same in both sessions: Read `notes.txt` (which holds the word "before"); Edit it so "before" becomes "after"; Write a new file `new.txt`; run `mkdir bash-ran`; one tool call each, in that order, and carry on if one is refused.
- **Held session:** the project holds `.hold-probe`. It passes when the Read ran, the Edit, Write and shell command were each tried and refused with "probe: held", and nothing was left on disk (`notes.txt` still "before", no `new.txt`, no `bash-ran` folder).
- **Free session:** no marker. It passes when all four ran, none refused, and all three changes are on disk.
- **How it is judged.** A refused call still appears as a tool call in the events, so the events alone cannot show that it did not run. The probe pairs each call with its result and also looks at the files left on disk.

## Evidence

Both sessions passed in both runs (log kept outside the repository, at `~/.wheelhouse-probes/29-hold/run.jsonl`).

- **Held:** "Read ran, Edit refused (probe: held), Write refused (probe: held), shell refused (probe: held)". The Read returned the file's contents. The three refusals came back as errors reading "PreToolUse:Edit hook error: probe: held" (and the same for Write and Bash), so the reason the hook gives is what the session sees. `notes.txt` still read "before", and there was no `new.txt` and no `bash-ran` folder.
- **Free:** "Read ran, Edit ran, Write ran, shell ran". `notes.txt` read "after", `new.txt` existed, and the `bash-ran` folder existed. No result mentioned "probe: held".
- **The hold beat permission settings.** In the held session the shell command had an allow rule and Edit and Write were being accepted automatically; the hook refused them all the same.
- **The hook loaded from the throwaway project's settings alone** (`--setting-sources project,local`), in a headless session, with no prompt to trust the folder.
- **Tokens (first run):** held 176,957 in / 614 out, 5 turns, about 18 seconds, about 0.36 US dollars; free 204,499 in / 574 out, 5 turns, about 15 seconds, about 0.21 US dollars. A second run gave held 178,059 in / 673 out and free 177,278 in / 573 out. "In" counts everything the session read, cache reads included, as in the evaluation harness.

## What it means for the design

- **A pre-tool hook is a hold that works as designed on the Mac:** it refuses by tool name, whatever the permission rules and mode say, and the session is told why. A session whose fingerprints did not match can be held by a hook that checks for a marker (or, in the real design, the fingerprints) and refuses all but the reading tools.
- **Marker or fingerprints are read from the session's folder** (`cwd` in the hook's input). The real hold would read whatever the design decides records the mismatch; this check shows only that a hook can act on a file in the folder.
- **Reading stays open.** Only `Read` was exercised among the three open tools; `Grep` and `Glob` are let through by the same list and were not asked for.
- **The real hold must fail closed.** The repository's guards do (`scripts/hooks/kit.js` turns a throw into a deny); this probe's hook does not, so a crash was not shown, and the real hold (Task 26) has to refuse when it cannot decide.
- **Not shown:** that a hook which crashes, or fails to start, still holds (the probe's hook only ran correctly); that a subagent's tool calls are held (the session used none); an interactive or Desktop session; or more than two runs of each session, so the model's behaviour is two samples.
- **Windows:** the same probe is written to run there unchanged; the harness finds `claude` as `claude.exe` or as a `.cmd` shim run through `cmd.exe` with the prompt on stdin. The hook command is `node "<path>"` with forward slashes; whether Windows takes it is what the sitting shows.

## Needs the director

The Windows run, in the Windows sitting (about 5 minutes): in the Wheelhouse folder on the Windows computer, run `node probes/29-hold/run.js`. It makes two short sessions in throwaway folders, each a small task (about 200,000 tokens read and under 1,000 written on the Mac, about 0.60 US dollars together). The last lines say `Check 29 on win32: PASS` or `FAIL`; if it fails, send what it printed. Nothing is needed on the Mac.
