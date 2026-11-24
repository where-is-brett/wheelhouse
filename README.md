<!-- README.md -->

# Wheelhouse

**Direct AI agents building your product, in plain words, with checks they can't skip.**

Wheelhouse is for a product owner who isn't a developer. You say what you want in plain words. Your First Mate asks you short questions about what is yours to decide, each with buttons to click. Behind it, the Crew builds the work and Lookouts check it, and nothing reaches the main version of your product until it has passed checks the agents can't skip. You make the product decisions; the agents do the building.

`v0.3.0` is an early release for trying Wheelhouse out. It hasn't yet been used from start to finish on a real product.

## How it works

1. **You ask.** In a Claude Desktop conversation, you write what you want: "Add a page where customers can book a time."
2. **The First Mate checks with you.** It asks only what is really yours to decide, as a card with clickable answers, and decides the rest itself, telling you so.
3. **The Crew builds it.** The Bosun hands each piece of work to the Crew, and to Lookouts who check it. A piece waiting on you no longer holds up other work.
4. **Nothing ships unchecked.** The work reaches your main product only after its checks pass and a Lookout has looked. Anything that changes the safety rules needs your click as well.
5. **You get a short briefing** of what's done, what's under way and what needs you. Type "all stop" at any time and the whole Crew halts until you click to carry on.

A card looks like this (an illustration):

> **Approve** · Add the booking page to your product?
> It lets customers pick a time from your calendar. The checks passed and a Lookout has looked.
> [ Approve ] [ Change it ]

And a briefing opens like this:

> Since you were last here at 09:10: the booking page is ready for you to look at. One thing needs you. Nothing is broken.

**Leaving work running.** Signing a goal and going away is parked for now (`docs/parked.md`); it will come back on Wheelhouse's own engine.

**What it costs.** Wheelhouse is free and open source (Apache 2.0). The agents run on your own Claude plan, so their work comes out of your plan's usage, and Wheelhouse's Logbook shows this week's usage, including the share of your weekly allowance.

**Who makes it.** Wheelhouse is an independent open-source project. It isn't made by, or affiliated with, Anthropic.

**What it protects.** Agents never hold your GitHub or GitLab keys, your clicks are signed so an agent can't approve for you, and on a Mac the agents' commands run fenced off from the rest of your computer. What it doesn't protect you from is in [`SECURITY.md`](SECURITY.md).

**What builds it.** Wheelhouse's own engine: quick changes, small pieces of work, bugs, features (in slices, each with its own pull request) and the fix when the main version breaks, each built by a Claude Code session in a work folder of its own, on GitHub, GitLab or a project kept on your computer. Wheelhouse's checks and guards wrap every step, and the agents never hold your keys. From `v0.3.0` some pieces are parked: the build engine Archon, GitHub Copilot, the VS Code add-on, the pane, leaving work running unattended, and screenshot approvals. What each was, and what bringing it back takes, is in [`docs/parked.md`](docs/parked.md). A project on Archon moves to Wheelhouse's own engine with `/wheelhouse:update`, with nothing lost.

**How to take it out again.** Type `/wheelhouse:uninstall` in a conversation on your product. What it removes, and what it keeps, is in [`docs/data.md`](docs/data.md).

## Install

You need **Node.js** (a free program; [download the version marked LTS](https://nodejs.org/en/download)), Claude Desktop, signed in, and about 15 minutes. A host is optional: a project can stay on your computer with git alone, its checks run here, and nothing goes online. You can move it to GitHub or GitLab later: one card, with every line of work and each open change carried over. A GitHub or GitLab account helps; setup shows you where to make one if you have neither.

1. **Open a session on your product's folder.** For a new product, start a new session in Claude Desktop, and in its folder picker make an empty folder under `Projects` in your home folder, named after the product; open the session on it. For a product you already have, open the session on its folder. For a product you set up with Wheelhouse on another computer, make an empty folder here too: setup brings the product into it.
2. **Check for Node.js.** Wheelhouse needs Node.js 22 or later. If this computer has none or an older one, or a Wheelhouse session refuses every tool with a message naming a Wheelhouse script and "node: command not found", install the LTS from nodejs.org, then start a new conversation. Wheelhouse also says so itself, in plain words, when a conversation starts.
3. **Install Wheelhouse.** Paste this message into the session and press Enter:

   ```text
   Please run these two commands in this folder, one after the other, even if wheelhouse is already listed by `claude plugin marketplace list`.
   claude plugin marketplace add "where-is-brett/wheelhouse#main" --scope project
   claude plugin install wheelhouse@wheelhouse --scope project
   When both have finished, say only this, and do nothing else in this chat: "Wheelhouse is installed. Open a new chat on this folder now, and setup starts there."
   ```

   <!-- Until v0.3.0 is tagged, the line above installs from main. Once tagged, restore: claude plugin marketplace add "where-is-brett/wheelhouse#v0.3.0" --scope project -->

   Claude asks before it runs each one: allow it. The first adds Wheelhouse's own catalogue, at its main line until `v0.3.0` is tagged; a computer that already has the catalogue is moved to it by that line, so it is run every time, never skipped (it is refused only where the catalogue was added from a different address, and then it says so); the second installs Wheelhouse from that catalogue, for this project only. Both name Wheelhouse's catalogue, so nothing else with a similar name can be installed by mistake. The install writes the plugin's files into Claude Code's shared plugin folder: a release under its version number, and an install from the main line under the number of its commit, so installing one never changes the files another project is running. Two projects on this computer that use the same release share its folder. (A later release, from Wheelhouse's [releases page](https://github.com/where-is-brett/wheelhouse/releases), goes in place of `v0.3.0`.) If you prefer a terminal, the same two commands work there, run in the product's folder.
4. **Open a new chat on the same folder now.** This is the only restart: this chat started before Wheelhouse was installed, so it never loads it, and a new one does. Wheelhouse loads there and setup starts by itself. Don't ask this chat for anything else first.
5. **If the commands don't work,** use the plugin browser instead: click the **+** button beside the message box, then **Add plugins** (or **Plugins**, then **Browse plugins**). Add the catalogue as `where-is-brett/wheelhouse#main` (the part after `#` names what you install: the main line until `v0.3.0` is tagged, then the release; without it you get whatever is newest), choose **Wheelhouse** from it, choose **this project** when asked where, then start a new session on the folder.

   <!-- Until v0.3.0 is tagged, the plugin browser line installs from main. Once tagged, restore: `where-is-brett/wheelhouse#v0.3.0` -->

Setup goes one step at a time. Each step shows you a card listing exactly what it will change, and nothing changes until you click **Go ahead**. You can stop at any card and carry on later: setup picks up where it left off. To take Wheelhouse out of a project again, type `/wheelhouse:uninstall` in a session on it.

Where your conversations, transcripts and records go, and what uninstall removes and keeps, is in [`docs/data.md`](docs/data.md).

What Wheelhouse protects you from, what it doesn't, and how to report a problem are in [`SECURITY.md`](SECURITY.md). Setup switches these protections on by itself; on a Mac you can also choose **Make it stricter** when it asks how to connect to GitHub or GitLab.

## Trying Wheelhouse without touching your usual setup

Wheelhouse keeps its records on a computer in one folder, `.wheelhouse` in your home folder. To try it in a folder of its own (a rehearsal, or a second set-up that must not touch the first), give the folder to the session in one of two ways.

**In the product's Claude settings.** Put this in `.claude/settings.json` in the trial project's folder (or `.claude/settings.local.json`, which stays on your computer), before the first Wheelhouse chat there, with a full path. It reaches Desktop and terminal sessions alike:

```json
{ "env": { "WHEELHOUSE_HOME": "/Users/you/wheelhouse-trial" } }
```

On Windows, the path in that file must be valid JSON: write it with forward slashes (`"C:/Users/you/wheelhouse-trial"`) or doubled backslashes (`"C:\\Users\\you\\wheelhouse-trial"`). Single backslashes make the file invalid JSON, and Claude Code then skips the whole file without saying so, so the home is never set.

**In a terminal's environment.** Set it before starting Claude Code from that terminal:

```text
export WHEELHOUSE_HOME="$HOME/wheelhouse-trial"         # macOS
$env:WHEELHOUSE_HOME = "$HOME\wheelhouse-trial"          # Windows PowerShell
```

Wheelhouse's own background processes (its helper and each project's watcher) start with a clean environment of their own and serve one home each, so a trial's processes never write to your usual home. A trial's processes stop an hour after the last session in that home ends. The build engine's folder moves with it, to the same name with `-engine` added. A computer with a home of its own gets no start-up entry (no Run entry on Windows, no launch agent loaded on a Mac), on purpose: that entry belongs to the real home, and a trial must never replace it. Ending a trial is All stop, then deleting the folder.

## Updating

Type `/wheelhouse:update` in a session on your product to update Wheelhouse. A computer on `v0.2.6` or earlier has no such command, so it updates once from Terminal, with one paste. Run it yourself: open Terminal (PowerShell on Windows) in your product's folder, and replace `<tag>` with the release you are moving to, such as the next version on Wheelhouse's [releases page](https://github.com/where-is-brett/wheelhouse/releases).

macOS:

```text
rm -rf ~/.wheelhouse/update/bootstrap/<tag> && git -c advice.detachedHead=false clone -q --depth 1 --branch <tag> https://github.com/where-is-brett/wheelhouse.git ~/.wheelhouse/update/bootstrap/<tag> && node ~/.wheelhouse/update/bootstrap/<tag>/scripts/update/cli.js bootstrap "$PWD"
```

Windows PowerShell:

```text
Remove-Item -Recurse -Force "$HOME\.wheelhouse\update\bootstrap\<tag>" -ErrorAction SilentlyContinue; git -c advice.detachedHead=false clone -q --depth 1 --branch <tag> https://github.com/where-is-brett/wheelhouse.git "$HOME\.wheelhouse\update\bootstrap\<tag>"; if ($LASTEXITCODE -eq 0) { node "$HOME\.wheelhouse\update\bootstrap\<tag>\scripts\update\cli.js" bootstrap "$PWD" }
```

Each line removes an earlier copy of that release's folder first, so pasting again is safe. It checks the release first, so a clone that doesn't check out stops with nothing changed. It then shows you what the update does, in words, and waits for you to type `1` to update or `2` for not now. Only you can answer it: it refuses to run unless you are typing at the Terminal yourself. After a `1` it installs the release on this computer, hands over to the new helper, and opens a small change in your product naming the release. That change is reviewed and merged like any other; until it is, the board says the change is waiting to be merged. If the change is refused or closed, this computer is put back to the release it had. Every update after this one is `/wheelhouse:update`.

**If you can't run the paste,** close your Wheelhouse sessions, then do these steps by hand in Terminal, in your product's folder, with the new release's name in place of `<tag>`:

```text
claude plugin marketplace list
claude plugin marketplace add "where-is-brett/wheelhouse#<tag>" --scope project
claude plugin update wheelhouse@wheelhouse --scope project
```

Run the `add` even when the first command lists `wheelhouse`: adding it again at the new release is what moves it, and it is refused only when it names a different address. Then run `claude plugin update`, not `claude plugin install`, because Wheelhouse is already installed here and `install` answers "already installed" and changes nothing. (Where Wheelhouse is also installed for your whole account, run the `update` again with `--scope user`.) If your account's own settings (`~/.claude/settings.json`, or the folder `CLAUDE_CONFIG_DIR` names) already name the Wheelhouse catalogue at an old release, Claude Code refuses the `add`: change the `ref` there to `<tag>` first. Then start a new session on the folder and type `/wheelhouse:update` to finish.

## On GitHub Copilot

Parked from `v0.3.0`, with its lean tier (Lean) and the VS Code add-on: Wheelhouse runs on Claude Code only. What was built, and what bringing it back takes, is in [`docs/parked.md`](docs/parked.md). A project that built with Copilot is offered, on one card, to carry on with Claude Code. Where Copilot is brought back, the level to choose in VS Code's chat is Allow all, never Autopilot: Autopilot answers Wheelhouse's cards itself. Under Allow all Wheelhouse's guards still refuse pushes, secret reads, forged card answers and carrying on past STOP. Setup writes no permission setting; the director picks the level.

## For developers

**Status:** `v0.3.0` is an early release for trying Wheelhouse out, with its tests passing. The design is in `docs/specs/2026-10-17-wheelhouse-design.md`. How to run the tests, find your way around and cut a release is in [`CONTRIBUTING.md`](CONTRIBUTING.md).
