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
