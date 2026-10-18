<!-- probes/27-sessions/run.md -->

# Check 27: the director's sittings

What this finds out: whether a background program, with no one at the keyboard, can start a Claude session and later send it a one-line message. The answer decides whether the watcher is a background process (Shape 1) or lives inside a long-running foreman session (Shape 2).

The script starts short sessions in throwaway projects under the temporary folder. When it ends, or when you press Ctrl+C, it stops the background sessions it started and removes the throwaway projects. What stays: Claude's own transcripts of those sessions, the script's log (times, token counts and session ids, no conversation text), and, after any run that uses `claude --bg`, Claude's background service, which Claude starts by itself and which exits by itself when its last client disconnects (per `claude daemon --help`). Don't stop the service by hand: it also hosts any background sessions of your own. If a session whose name starts with `probe27` is ever left (`claude agents` lists them), stop just that one with `claude stop <id>`. Each run costs a few cents of usage. The Mac shell run is already done; these two sittings add what only you can see.

You need: the Wheelhouse checkout, Node.js 22 or newer, and `claude` working in a terminal.

**The agent running the sitting supplies the model name** in the commands below (written `<model name>`); you don't need to know it. It is never saved in the repository.

## Sitting 1: the Mac, with Desktop open (about 5 minutes)

1. Open Claude Desktop on the Code tab. Leave its session list visible on the left.
2. In a terminal, in the Wheelhouse checkout, run:

   ```
   node probes/27-sessions/trials.js --model <model name> --wait-for-trust --pause-at-end
   ```

3. Each trial prints one line, pass or fail, with the time and tokens. Nothing for you to type until it stops.
4. **The background route needs trust, and this part has not been tried.** Claude Code will not start a background session in a folder it doesn't trust, and a script cannot answer the question. If the script says `Workspace not trusted. In another terminal, run claude in <folder>...`, open a second terminal, go to that folder, run `claude`, accept the trust question, press Ctrl+C twice to quit, then press Enter in the first terminal. Nobody has yet seen this wait-and-retry work. If the trust question doesn't appear, or the retry still says "Workspace not trusted", note exactly what you saw, press Ctrl+C, and run the background route on its own another way:

   ```
   node probes/27-sessions/trials.js --model <model name> --routes bg --worktrees-of .
   ```

   That makes each throwaway project a temporary worktree of the Wheelhouse checkout you are standing in, which Claude Code already trusts. (It loads the checkout's own instructions, so those sessions are slower and use more tokens. The temporary worktrees are removed afterwards.)
5. **At each pause** (the script says a route is done and waits for Enter), look at Desktop and note, for that route (`print`, `stream`, `bg`):
   - Did any new session row appear in Desktop's list for the sessions the script just started? How many, and what are they called?
   - Can you open one? Does it show the conversation ("write pong-1 to pong.txt")?
   - For the `print` pause only: copy the session id from the line `print 2 start a second in a worktree` and run `claude --desktop --resume <that id>`. Does Desktop open that session?
6. Press Enter to let the script clean up and go on. At the end it prints `PASS` or `FAIL` and the path of its log.
7. Send back: the printed lines, your Desktop notes for each route, and whether step 4 happened.

## Sitting 2: Windows (about 10 minutes)

1. In a terminal, run `claude auth status`. Note what it says. Check 1 found that the command line's own sign-in failed on this computer (`claude auth login` gave a 403 error and `claude -p` said "Not logged in").
2. Run the same command, without the pause:

   ```
   node probes/27-sessions/trials.js --model <model name> --wait-for-trust
   ```

   (The trust wait is untried, as in Sitting 1 step 4; if it fails, use `--routes bg --worktrees-of .` the same way.) If the first trial prints `Not logged in` or an authentication error, note the exact text and go to step 3. If trials pass, note which routes passed and the times, and do the Desktop notes from Sitting 1 step 5 with `--pause-at-end` added.
3. **If the command line's sign-in fails, try Desktop's sign-in.** Open a session in Desktop, in the Wheelhouse checkout, and open Desktop's terminal pane (Ctrl+`). Run:

   ```
   node probes/27-sessions/trials.js --model <model name> --inherit-env --routes print,stream
   ```

   `--inherit-env` lets the new sessions use the environment Desktop gives the terminal, which on the Mac was enough for them to sign in. Note whether they signed in.
4. If `claude` is not found, the script says so; note whether `claude` runs by itself in the same terminal (`claude --version`).
5. Send back: the printed lines, the `claude auth status` text, and which of steps 2 and 3 worked.

## What to note, in short

- Pass or fail for every printed line, on both computers.
- Whether script-started sessions show in Desktop's list, and whether you can open one.
- Whether the trust wait-and-retry worked, or what you saw if it didn't.
- Whether the Windows command line could sign in, and if not whether Desktop's terminal could.
- Anything that stuck or took far longer than the times printed.
