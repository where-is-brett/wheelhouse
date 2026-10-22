<!-- probes/52-low-integrity/run.md -->

# Check 52: the director's sitting (low-integrity runner)

What this finds out: whether a copy of Node.js labelled "low integrity" starts and keeps everything it starts at low; which writes Windows then refuses it (Wheelhouse's own files and hooks, the `.claude` folder, the Startup folder, the registry's Run key); what it can still read; whether a "no read up" label, which would hide the helper's keys folder from it, can be set with the tools Windows ships; whether `git commit` and `npm test` work from low, and how much slower; and whether a low process can start a normal one. The answers decide what the Guarded level's card says it holds and how Task 6 builds the runner.

The script runs on Windows only, as a standard user in an ordinary terminal (not "Run as administrator"). Everything it makes is under the temporary folder and is removed when it ends or when you press Ctrl+C. It never reads your own `~/.ssh`, `~/.wheelhouse` or credentials: the "secret folders" are marker files in a scratch folder, and `git credential fill` runs only against an empty scratch configuration. It costs no tokens. The log (the lines below and the exact scripts it used) goes to `<home>\.wheelhouse-probes\52-low-integrity\`.

**Security software may flag this on a managed computer.** The script copies `node.exe`, changes its integrity label with `icacls`, and (when the PowerShell language mode allows it) compiles a small piece of C# with `Add-Type` to set a "no read up" label. That last trial is on by default, and so are the label changes. Security software that watches for tampering could raise an alert with IT for any of them. If that matters on the work computer, tell whoever looks after it before running, or run the personal computer first.

**Three trials are off unless you ask for them,** because they ask Windows to keep something, which is the shape of what malware does. Add `--persistence-trials` to run them; whether to is the director's call, and without it each prints `SEEN <name>: skipped (--persistence-trials)` and the rest runs as usual:

- `write-startup-folder`: a `.txt` file in your Startup folder, `%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\wheelhouse-probe-52-<numbers and letters>.txt`.
- `write-hkcu-run`: a value of that same name under `HKCU\Software\Microsoft\Windows\CurrentVersion\Run`, holding `cmd.exe /c rem` (it does nothing).
- `low-cannot-schedule-task`: a scheduled task of that same name (set for 23:59, never left to run; it is only created if the low process is allowed to, and then run once to see what level it has).

The script prints the exact name on a `persistence-entry-name` line before it starts, and a normal-level step removes all three at the end, whatever the trials found. **If a run is killed before that (security software ending it, the computer shutting down), remove them by hand** from a normal terminal, using the name from that line or by looking for `wheelhouse-probe-52` in each place:

```
del "%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\wheelhouse-probe-52-*.txt"
reg query HKCU\Software\Microsoft\Windows\CurrentVersion\Run
reg delete HKCU\Software\Microsoft\Windows\CurrentVersion\Run /v <the name> /f
schtasks /query /fo list | findstr wheelhouse-probe-52
schtasks /delete /tn <the name> /f
```

(The `reg query` and `schtasks /query` lines only look; the other three remove.) A killed run also leaves its scratch folders in the temporary folder (`wheelhouse-probe-52-*`, `wheelhouse-probe-52-repo-*`); they are harmless and can be deleted.

You need: the Wheelhouse checkout, Node.js 22 or newer (Node 26.1 or newer is better: it may have `node:ffi`), and Git for Windows.

**The agent running the sitting** starts the script and sends back the printed lines. The director's part is being at the computer, and, for the work computer, being signed in as themselves.

## The sitting (about 6 minutes, once on each computer)

1. Open a normal terminal (PowerShell or Command Prompt, not elevated) in the Wheelhouse checkout.
2. Run:

   ```
   node probes/52-low-integrity/run.js
   ```

   Add `--persistence-trials` only if the director has said to (see above).

3. It prints one line for each trial, `PASS <name>`, `FAIL <name>` or `SEEN <name>`, then the lines `LOCK_READS_ROUTE <icacls|powershell|ffi|none>` and (if a route held) `LOCK_READS_CALL <the exact call>`, and a final count and the log's path. Nothing to type. If it stops for more than a couple of minutes on one step, press Ctrl+C: it cleans up and leaves.
4. If it says `low-node-refused-by-policy`, the computer's policy (AppLocker or App Control) stops a copied `node.exe` from starting, or stops the label. That is a result, not a fault: the remaining low trials are skipped and the line says why. Note whether it also says `applocker-policy-keys: present`.
5. Run it again on the other computer (the managed work computer is the one that matters most) and keep the two outputs apart.
6. Send back: every printed line, for each computer.

## What the lines mean

- `PASS` means the protective thing held: a write was refused, a lock held, git worked at low. `FAIL` means it did not. `SEEN` is an observation with no right answer (what could be read, a time, a language mode).
- `write-...` trials: PASS means Windows refused the low process. The two controls are `write-inside-worktree` (should be allowed) and `medium-copy-starts`.
- `rename-...` and `remove-...` trials: PASS means Windows refused the low process renaming or removing the worktree's `.git` file, `.claude`, `.mcp.json` or `.vscode`, which are kept at the normal level inside the low worktree. A FAIL says the entry was put back afterwards.
- `read-...` trials are `SEEN`: they say whether the low process could read a marker in an ordinary scratch folder.
- `credential-manager-low` is `SEEN`: a made-up generic Windows Credential (target `wheelhouse-probe-52`, a random value, the kind `gh` keeps its token as) is written at the normal level with `CredWriteW`, the low process tries to read that target only with `CredReadW`, and it is deleted with `CredDeleteW`. The line says `read n characters`, `refused` (Windows error 5, access denied) or `inconclusive` with the error (for example PowerShell's language mode stopping `Add-Type`). `credential-manager-item: removed` follows. It names no other credential. If a run is killed before the removal, delete it by hand: `cmdkey /delete:wheelhouse-probe-52` (it appears under Windows Credentials in Credential Manager). It tells check 73 whether Guarded keeps a low build from `gh`'s token on Windows.
- `lock-reads-...` lines are the "no read up" attempts by each route; `LOCK_READS_ROUTE` is the first one that held (low can neither list nor read, and the probe itself still can).
- `git-label-worktree`, `git-add-low`, `git-commit-low`: the labelling Task 6 will do, then git from low.
- `npm-test-time` gives the normal and low times side by side.

## What to note, in short

- Whether the low copy started, and what its refusal said if not.
- Every `FAIL`, with its line.
- The `credential-manager-low` line.
- `LOCK_READS_ROUTE`, and the `powershell-language-mode` and `node-version` lines.
- Anything that looked like a window opening, or took far longer than the times printed.
