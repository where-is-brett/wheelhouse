<!-- README.md -->

# Wheelhouse

Wheelhouse is a Claude Code plugin that lets one person who is not a developer direct a team of AI agents building their product.

- **Front desk.** The director talks only to the front desk, which brings them short briefings and plain-English questions with clickable answers.
- **Foreman.** Behind it, a foreman runs builders and reviewers.
- **Merge gate.** Nothing reaches the main version without passing checks the agents can't skip.

**Status:** built, and not yet released. Its tests pass, and the next step is trying it from start to finish on a real product before the first release. The design is in `docs/specs/2026-10-17-wheelhouse-design.md`, and where things stand is in `HANDOVER.md`.

**Visibility:** public and open source, under the Apache 2.0 licence (`LICENSE`).

**First project:** a pilot project, where the first version of this system (the "Command Centre") ran from 12 to 17 October 2026.

## Install

You need Claude Desktop, signed in, and about 15 minutes. A GitHub or GitLab account helps; setup shows you where to make one if you have neither.

1. **Open a session on your product's folder.** For a new product, start a new session in Claude Desktop, and in its folder picker make an empty folder under `Projects` in your home folder, named after the product; open the session on it. For a product you already have, open the session on its folder. For a product you set up with Wheelhouse on another computer, make an empty folder here too: setup brings the product into it.
2. **Check for Node.js.** Wheelhouse needs Node.js 22 or later. If this computer has none or an older one, or a Wheelhouse session refuses every tool with a message naming a Wheelhouse script and "node: command not found", install the LTS from nodejs.org, then ask again in the same conversation; if it still refuses, start a new session.
3. **Install Wheelhouse.** Paste this line into the session, with the latest release's name (such as `v1.0.0`, from Wheelhouse's releases page) in place of `<tag>`, and press Enter:

   ```text
   /plugin install wheelhouse --marketplace where-is-brett/wheelhouse#<tag>
   ```

   Claude asks you to confirm where Wheelhouse comes from, then where to install it. Choose **this project** ("for all collaborators on this repository"), not "for you". If it asks to reload, say yes. Setup then starts.
4. **If the line doesn't work** in your Desktop, use the plugin browser instead: click the **+** button beside the message box, then **Plugins**, then **Add plugin**. Add Wheelhouse from `where-is-brett/wheelhouse`, choose **this project** when asked where, then start a new session on the folder.

Setup goes one step at a time. Each step shows you a card listing exactly what it will change, and nothing changes until you click **Go ahead**. You can stop at any card and carry on later: setup picks up where it left off. To take Wheelhouse out of a project again, type `/wheelhouse:uninstall` in a session on it.

Where your conversations, transcripts and records go, and what uninstall removes and keeps, is in [`docs/data.md`](docs/data.md).

What Wheelhouse protects you from, what it doesn't, and how to report a problem are in [`SECURITY.md`](SECURITY.md). Setup switches these protections on by itself; on a Mac you can also choose **Make it stricter** when it asks how to connect to GitHub or GitLab.

## On GitHub Copilot

Wheelhouse also runs in VS Code with GitHub Copilot, with nothing else installed. This is its lean tier ("Lean"): you need VS Code with Copilot, and git. You don't need Node.js, a code host, administrator rights or anything else, and Wheelhouse installs nothing. Everything stays on your computer, and Copilot builds in your own chat, one feature at a time.

**Status:** `v0.1.0` is the first release, an early one for trying Wheelhouse out. Where this page says `v0.1.0`, use the latest release's name.

Open your product's folder in VS Code, open Copilot's chat in agent mode, and paste this line:

```text
Set up Wheelhouse from https://github.com/where-is-brett/wheelhouse at release v0.1.0
```

Copilot asks you before it runs each command, as it always does. What the line does, one step at a time:

1. **Checks git is here.** Without it, setup stops and tells you where to get it. Nothing has changed.
2. **Gets Wheelhouse with git.** It fetches the release into `~/.copilot/wheelhouse/<tag>/`, copies Wheelhouse's skills, agents and instructions into `~/.copilot/`, and checks every copied file against the fingerprint the release lists for it. A file that doesn't match stops setup.
3. **Asks the computer what it can run,** and says in one sentence which tier this is.
4. **Sets up your project.** It adds Wheelhouse's VS Code settings to `.vscode/settings.json` (your own file is only changed after you click **Approve**), makes the record folder `.wheelhouse/record/` and the board `wheelhouse/board.md`, and makes one commit of the files it added.
5. **Asks where the copy goes:** a folder you choose, such as a company drive, holding a bare copy of your project's history.
6. **Compares your versions of VS Code and Copilot** with the list of versions Wheelhouse has tested, and says when yours haven't been tested yet.

Then the chat follows Wheelhouse's own playbook for Lean: the record, the board, cards, building, merging, undo and the copy, all with git. The board's first lines say plainly what is and isn't enforced on your computer. At Lean nothing enforces STOP, an approval is a click in the chat that the chat records itself, and the VS Code settings are conveniences, not controls. **Lean is not for projects with real users.**

**For the chat reading this:** check `git --version` first; then `git clone --depth 1 --branch <tag> https://github.com/where-is-brett/wheelhouse.git "$HOME/.copilot/wheelhouse/<tag>"`, and follow `adapters/copilot/skills/setup-lean/SKILL.md` in that clone, step by step.
