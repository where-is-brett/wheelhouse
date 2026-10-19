<!-- probes/53-windows-grants/run.md -->

# Check 53: the director's sitting (granting build commands on Windows)

What this finds out: whether a `claude -p` session started through `claude.cmd` is refused at once, rather than left waiting, when it tries `npm test` with no rule allowing it; whether it runs `npm test` when `--allowedTools "Bash(npm test:*)"` names it; whether it runs a command allowed by the Guarded runner's rule in the form Task 6 will use (`Bash('<low node.exe>' '<runner script>':*)`); and, by hand, whether Claude Desktop on Windows applies a sandbox of its own.

The script runs on Windows only. It starts four short `claude -p` sessions in a throwaway project under the temporary folder and removes the project at the end or when you press Ctrl+C. The sessions load only the project's own settings, so your own allow rules cannot change the result; a computer-wide managed policy still applies, and if it allows `npm test` the first trial will say the command ran. Each session costs a few cents of usage. The log (times, session ids; no conversation text) goes to `<home>\.wheelhouse-probes\53-windows-grants\`.

You need: the Wheelhouse checkout, Node.js 22 or newer, and `claude` working in a terminal. Check 27's Sitting 2 found the command line's own sign-in failing on the Windows computer; if the first trial says `claude is not signed in here`, see step 4.

**The agent running the sitting supplies the model name** in the commands below (written `<model name>`); you don't need to know it. It is never saved in the repository.

## Part 1: the script (about 5 minutes)

1. Open a normal terminal in the Wheelhouse checkout.
2. Run:

   ```
   node probes/53-windows-grants/run.js --model <model name>
   ```

3. It prints one line per trial, with the time:
   - `grants-no-allow-rule`: PASS if the session was refused quickly and `npm test` did not run; FAIL if it waited or the command ran.
   - `grants-npm-test-allowed`: PASS if `npm test` ran.
   - `grants-runner-rule`: PASS if the command in the runner's form ran. `grants-runner-integrity` then says what level the stand-in runner ran at (low, if the probe's copy of `node.exe` started at low; the `low-copy` line says whether it did).
   - `grants-plain-npm-test-with-runner-rule-only`: PASS if a plain `npm test` was refused when only the runner's rule is given.
   Then a line for the Desktop step, a final count and the log's path.
4. If the first trial prints `claude is not signed in here`, note the exact text and run the same command from Desktop's terminal pane (open a session in Desktop, in the Wheelhouse checkout, then Ctrl+`) with `--inherit-env` added, as check 27's run sheet does.
5. If `claude` is not found, the script says so; note whether `claude --version` works in the same terminal.

## Part 2: Claude Desktop's own sandbox (about 5 minutes, only the director can do this)

This is the research's section 8.4, item 9, and settles the conflicting reports in its section 2.1.

1. In Claude Desktop on Windows, open Settings and then Claude Code. Note whether there is a "Local sandbox" row, and what it says.
2. Open a local session (not a remote or WSL one) in any project and ask Claude to run `touch ~/sandbox-probe`, or type it as a command if the session allows. Note whether it is blocked, asked about, or just runs.
3. If the file was made, delete it: `del %USERPROFILE%\sandbox-probe` (or `rm ~/sandbox-probe` in Git Bash).
4. Send back what you saw in steps 1 and 2.

## Part 3: only if check 27 gave Shape 2

If check 27's answer is Shape 2 (the foreman is a long-running Desktop session), also try whether a running Desktop session picks up an allow rule written into its worktree's `.claude/settings.local.json`: start a session, add `{"permissions":{"allow":["Bash(npm test:*)"]}}` to that file in its worktree while it is open, ask it to run `npm test`, and note whether it asks. Skip this part if check 27 answered Shape 1.

## What to note, in short

- Pass or fail for every printed line, on each computer (the managed work computer matters most).
- How long the refused session took (the time on the `grants-no-allow-rule` line), against the allowed one.
- What Desktop's Settings showed, and whether `touch ~/sandbox-probe` was blocked.
- Anything that hung or took far longer than the times printed.
