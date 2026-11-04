<!-- README.md -->

# Wheelhouse

**Direct AI agents building your product, in plain words, with checks they can't skip.**

Wheelhouse is for a product owner who isn't a developer. You say what you want in plain words. Your First Mate asks you short questions about what is yours to decide, each with buttons to click. Behind it, the Crew builds the work and Lookouts check it, and nothing reaches the main version of your product until it has passed checks the agents can't skip. You make the product decisions; the agents do the building.

`v0.2.6` is an early release for trying Wheelhouse out. It hasn't yet been used from start to finish on a real product.

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

**Leaving work running.** Soon you will be able to sign one goal with its bounds and go away. When you come back, the report on it is made by a script from the record, with no model in between: what was added, what waits, what went wrong and what it spent, with nothing rounded up. A goal can't be started yet.

**What it costs.** Wheelhouse is free and open source (Apache 2.0). The agents run on your own Claude plan, so their work comes out of your plan's usage, and Wheelhouse's Logbook shows this week's usage, including the share of your weekly allowance.

**Who makes it.** Wheelhouse is an independent open-source project. It isn't made by, or affiliated with, Anthropic.

**What it protects.** Agents never hold your GitHub or GitLab keys, your clicks are signed so an agent can't approve for you, and on a Mac the agents' commands run fenced off from the rest of your computer. What it doesn't protect you from is in [`SECURITY.md`](SECURITY.md).

**What builds it.** On a Mac, for a product on GitHub, all the building runs on a build engine, [Archon](https://github.com/coleam00/Archon), which setup installs with its usage reporting off: quick changes, small pieces of work, bugs, features (in slices, each with its own pull request) and the fix when the main version breaks. Wheelhouse's checks and guards still wrap every step, and the engine never holds your GitHub keys. A product that builds with Copilot instead of Claude runs on the same engine too, except at Lean (below), which installs nothing. Products on GitLab, and work on Windows or Linux, are still built by Wheelhouse's own Crew for now. A project set up before `v0.2.0` is offered the switch once, on a card: you approve a pull request that adds the engine's files, and work already under way finishes where it started. How the engine fits, and its fallback, are in [`docs/engine/`](docs/engine/).

**How to take it out again.** Type `/wheelhouse:uninstall` in a conversation on your product. What it removes, and what it keeps, is in [`docs/data.md`](docs/data.md).

## Install

You need **Node.js** (a free program; [download the version marked LTS](https://nodejs.org/en/download)), Claude Desktop, signed in, and about 15 minutes. A host is optional: a project can stay on your computer with git alone, its checks run here, and nothing goes online. You can move it to GitHub or GitLab later: one card, with every line of work and each open change carried over. A GitHub or GitLab account helps; setup shows you where to make one if you have neither.

1. **Open a session on your product's folder.** For a new product, start a new session in Claude Desktop, and in its folder picker make an empty folder under `Projects` in your home folder, named after the product; open the session on it. For a product you already have, open the session on its folder. For a product you set up with Wheelhouse on another computer, make an empty folder here too: setup brings the product into it.
2. **Check for Node.js.** Wheelhouse needs Node.js 22 or later. If this computer has none or an older one, or a Wheelhouse session refuses every tool with a message naming a Wheelhouse script and "node: command not found", install the LTS from nodejs.org, then start a new conversation. Wheelhouse also says so itself, in plain words, when a conversation starts.
3. **Install Wheelhouse.** Paste this message into the session and press Enter:

   ```text
   Please run these two commands in this folder, one after the other, and tell me when both have finished. First run `claude plugin marketplace list`: if wheelhouse is already listed, skip the first command and run only the second.
   claude plugin marketplace add "where-is-brett/wheelhouse#v0.2.6" --scope project
   claude plugin install wheelhouse@wheelhouse --scope project
   ```

   Claude asks before it runs each one: allow it. The first adds Wheelhouse's own catalogue, at release `v0.2.6` (a Mac that already has it, from an earlier setup or install, lists it, and the first command is skipped: adding it again under another address is refused); the second installs Wheelhouse from that catalogue, for this project only. Both name Wheelhouse's catalogue, so nothing else with a similar name can be installed by mistake. (A later release, from Wheelhouse's [releases page](https://github.com/where-is-brett/wheelhouse/releases), goes in place of `v0.2.6`.) If you prefer a terminal, the same two commands work there, run in the product's folder.
4. **Start a new session on the same folder.** Wheelhouse loads, and setup starts.
5. **If the commands don't work,** use the plugin browser instead: click the **+** button beside the message box, then **Add plugins** (or **Plugins**, then **Browse plugins**). Add the catalogue `where-is-brett/wheelhouse`, choose **Wheelhouse** from it, choose **this project** when asked where, then start a new session on the folder.

Setup goes one step at a time. Each step shows you a card listing exactly what it will change, and nothing changes until you click **Go ahead**. You can stop at any card and carry on later: setup picks up where it left off. To take Wheelhouse out of a project again, type `/wheelhouse:uninstall` in a session on it.

Where your conversations, transcripts and records go, and what uninstall removes and keeps, is in [`docs/data.md`](docs/data.md).

What Wheelhouse protects you from, what it doesn't, and how to report a problem are in [`SECURITY.md`](SECURITY.md). Setup switches these protections on by itself; on a Mac you can also choose **Make it stricter** when it asks how to connect to GitHub or GitLab.

## Updating

From the first release that has it, `/wheelhouse:update` updates Wheelhouse: type it in a session on your product. A computer on `v0.2.6` or earlier has no such command, so it updates once from Terminal, with one paste. Run it yourself: open Terminal (PowerShell on Windows) in your product's folder, and replace `<tag>` with the release you are moving to, such as the next version on Wheelhouse's [releases page](https://github.com/where-is-brett/wheelhouse/releases).

macOS:

```text
rm -rf ~/.wheelhouse/update/bootstrap/<tag> && git clone --depth 1 --branch <tag> https://github.com/where-is-brett/wheelhouse.git ~/.wheelhouse/update/bootstrap/<tag> && node ~/.wheelhouse/update/bootstrap/<tag>/scripts/update/cli.js bootstrap "$PWD"
```

Windows PowerShell:

```text
Remove-Item -Recurse -Force "$HOME\.wheelhouse\update\bootstrap\<tag>" -ErrorAction SilentlyContinue; git clone --depth 1 --branch <tag> https://github.com/where-is-brett/wheelhouse.git "$HOME\.wheelhouse\update\bootstrap\<tag>"; if ($LASTEXITCODE -eq 0) { node "$HOME\.wheelhouse\update\bootstrap\<tag>\scripts\update\cli.js" bootstrap "$PWD" }
```

Each line removes an earlier copy of that release's folder first, so pasting again is safe. It checks the release first, so a clone that doesn't check out stops with nothing changed. It then shows you what the update does, in words, and waits for you to type `1` to update or `2` for not now. Only you can answer it: it refuses to run unless you are typing at the Terminal yourself. After a `1` it installs the release on this computer, hands over to the new helper, and opens a small change in your product naming the release. That change is reviewed and merged like any other; until it is, the board says the change is waiting to be merged. If the change is refused or closed, this computer is put back to the release it had. Every update after this one is `/wheelhouse:update`.

**If you can't run the paste,** close your Wheelhouse sessions, then follow the Install step above with the new release's name in place of `v0.2.6` (the catalogue and the plugin each move to the new release), start a new session on the folder, and type `/wheelhouse:update` to finish.

## On GitHub Copilot

Wheelhouse also runs in VS Code with GitHub Copilot, with nothing else installed. This is its lean tier ("Lean"): you need VS Code with Copilot, and git. You don't need Node.js, a code host, administrator rights or anything else, and Wheelhouse installs nothing. If you'd like a panel beside the chat, Wheelhouse can offer its optional VS Code add-on later; you never need it. Everything stays on your computer, and Copilot builds in your own chat, one feature at a time.

**Status:** `v0.2.6` is an early release for trying Wheelhouse out. Where this page says `v0.2.6`, use the latest release's name.

Open your product's folder in VS Code, open Copilot's chat in agent mode, and paste this line:

```text
Set up Wheelhouse from https://github.com/where-is-brett/wheelhouse at release v0.2.6
```

Copilot asks you before it runs each command, as it always does. What the line does, one step at a time:

1. **Checks git is here.** Without it, setup stops and tells you where to get it. Nothing has changed.
2. **Gets Wheelhouse with git.** It fetches the release into `~/.copilot/wheelhouse/<tag>/`, copies Wheelhouse's skills, agents and instructions into `~/.copilot/`, and checks every copied file against the fingerprint the release lists for it. A file that doesn't match stops setup.
3. **Asks the computer what it can run,** and says in one sentence which tier this is.
4. **Sets up your project.** It adds Wheelhouse's VS Code settings to `.vscode/settings.json` (your own file is only changed after you click **Approve**), makes the record folder `.wheelhouse/record/` and the Logbook `wheelhouse/board.md`, and makes one commit of the files it added.
5. **Asks where the copy goes:** a folder you choose, such as a company drive, holding a bare copy of your project's history.
6. **Compares your versions of VS Code and Copilot** with the list of versions Wheelhouse has tested, and says when yours haven't been tested yet.

Then the chat follows Wheelhouse's own playbook for Lean: the record, the Logbook, cards, building, merging, undo and the copy, all with git. The Logbook's first lines say plainly what is and isn't enforced on your computer. At Lean nothing enforces All stop, an approval is a click in the chat that the chat records itself, and the VS Code settings are conveniences, not controls. **Lean is not for projects with real users.**

**Beyond Lean.** A product on GitHub that builds with Copilot runs on the same build engine as one that builds with Claude, on a Mac. Several pieces are built but switched off until each has been tried on a real computer: Copilot's sandbox for every step, Locked for Copilot, the person's own approval on GitHub for a product with real users, and the choice to use VS Code's Claude chat as a front end. There is also an optional VS Code add-on, installed by hand, with a pane and buttons for the cards; at Lean it can run Wheelhouse's helper where Node.js is not allowed. Nothing in the add-on lets Copilot's chat press an approval: only the add-on's own buttons can. Wheelhouse spends none of your Copilot requests without asking you first. What is kept on your computer is in [`docs/data.md`](docs/data.md).

**For the chat reading this:** check `git --version` first; then `git clone --depth 1 --branch <tag> https://github.com/where-is-brett/wheelhouse.git "$HOME/.copilot/wheelhouse/<tag>"`, and follow `adapters/copilot/skills/setup-lean/SKILL.md` in that clone, step by step.

## For developers

**Status:** `v0.2.6` is an early release for trying Wheelhouse out, with its tests passing. The design is in `docs/specs/2026-10-17-wheelhouse-design.md`. How to run the tests, find your way around and cut a release is in [`CONTRIBUTING.md`](CONTRIBUTING.md).
