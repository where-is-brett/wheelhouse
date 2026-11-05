<!-- docs/copilot/trial-harness.md -->

# Trial harness: running Lean in a scratch VS Code, and answering its cards

For an agent running a Lean trial or a sitting. None of this is part of the product.

## A scratch window

- **A profile of its own.** `--user-data-dir <short path> --extensions-dir <short path>`. Keep the paths short: VS Code's socket path must stay under about 100 characters, and a long scratch folder makes it exit at start with "listen EINVAL … is longer than 103 chars".
- **No `CLAUDE_*` variables** in the environment (a card command takes the chat for a Claude Code session when they are set), and a scratch `COPILOT_HOME` and `WHEELHOUSE_HOME`. Setup follows `COPILOT_HOME` (the clone, the kit and the hook folder), so a trial with it set leaves the real `~/.copilot` alone.
- **Workspace trust off** (`--disable-workspace-trust`) if a driver extension must start.
- Stop only the window you started: match its own `--user-data-dir` with `pkill -f`.

## Why an agent can't click a card

A Lean card is a question form in VS Code's chat. Computer-use grants VS Code the "click" tier, and a scratch window started this way often isn't one it can see, so `app_click` has nothing to press. No command answers the form, and typing "Confirm" in the chat is refused by design ("Lean requires the approval card click"). That stays so.

## What works: a real click over the debugging port

Start the scratch window with `--remote-debugging-port=9333`. Then `probes/lib/vscode-click.mjs` finds the card's buttons on the screen and sends a mouse press and release to the middle of one:

```bash
node probes/lib/vscode-click.mjs list  --port 9333
node probes/lib/vscode-click.mjs click "Approve" --port 9333
```

`list` prints the visible buttons and options; `click` presses the one whose text is that label, and refuses when none or several match (narrow it with `--within '<css selector>'`). Read the card with `list` first and press only what it offers.

Tried on 5 November 2026 on the Mac, VS Code 1.144.1, in a scratch profile: the window answered on the port, `list` named its buttons, and a click on Toggle Panel opened the panel (its height went from 0 to 292). A Copilot card was not raised, since that costs a premium request; the first trial that does should use `list` first and confirm its buttons are named as the card shows them.

## Why this is safe

- It is a click, not typed text. The product's rule is unchanged: nothing answers a card but a click, and a typed "yes" is refused.
- The port exists only on a scratch window the trial started, on 127.0.0.1, with a profile of its own. The director's own VS Code profile never has it.
- The trial records the click as the trial's, not the director's. A card clicked this way proves the flow works; it is not an approval by the director, and a trial never presses a card for real work.
- Nothing in the product, the kit or the add-on reads the port or the script.
