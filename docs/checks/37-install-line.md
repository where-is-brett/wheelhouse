<!-- docs/checks/37-install-line.md -->

# Check 37: the pasted install line in Desktop

**Answer:** Partly — the documentation and a command-line trial answer what the line is and what the project's settings do; what Desktop shows when the line is pasted is not seen. The documented form is `/plugin install wheelhouse --marketplace where-is-brett/wheelhouse#<tag>` only by inference (the session form and the `#<tag>` pin are each documented, never together), and for Desktop the documentation names a plugin browser, not a pasted command. With the `claude` command line standing in for Desktop, the combined form installed the tag's commit, and the project's settings alone registered the marketplace but did not install Superpowers or Matt's skills; those need `claude plugin install … --scope project`. The Desktop clicks, the trust question and the timing wait for the director's sitting.

## Question

What the install line `/plugin install wheelhouse --marketplace <owner>/wheelhouse#<tag>` does when pasted into a Desktop session (check 15 left it for this plan): which confirmations it asks, where the scope is chosen, how the reload is done, and whether plugins named in a project's settings (`enabledPlugins` with the Wheelhouse marketplace) are installed on that reload or need their own step; and whether Desktop asks the director to trust the folder.

## Tested on

19 October 2026, on macOS with Claude Code 2.1.302 on the command line (`claude --version`); the Desktop app carries 2.1.299 and 2.1.295 copies, which are above the documented version floors for the forms below (2.1.275 for the session form, 2.1.292 for the shell form). The command line stood in for Desktop in every trial; no Desktop window was opened. The trials needed no network: GitHub's address was redirected to a local clone by a git setting in a scratch home. Documentation read the same day:

- https://code.claude.com/docs/en/plugins/install (install and scope steps, "Add a marketplace and install in one command", the Desktop tab)
- https://code.claude.com/docs/en/plugins/marketplace-reference (marketplace sources, `extraKnownMarketplaces`)
- https://code.claude.com/docs/en/plugins/loading ("Plugins and marketplaces that aren't on disk at session start", "Enabled in project settings but not installed")
- https://code.claude.com/docs/en/plugins/org ("Require plugins per repository", "When each surface applies the plugin keys")
- https://code.claude.com/docs/en/permissions ("What runs before you trust a folder")
- https://code.claude.com/docs/en/desktop (installing plugins; the feature comparison table)

The `…/plugins/discover` page named in the brief returns "not found"; its content is on the install page.

## Method

Reading, then a trial in a scratch folder under the temporary folder, with `HOME` and `CLAUDE_CONFIG_DIR` pointing into it. The director's `~/.claude` and `~/.claude.json` were not used as the configuration home. The scratch held a clone of this repository (the branch, carrying `.claude-plugin/marketplace.json`), a tag `v0.0.0-probe37` on its head, one later commit so the tag and the branch's tip differed, and a git setting that sent `https://github.com/where-is-brett/wheelhouse.git` to the clone. The trial tried, in a scratch project:

- `claude plugin marketplace add` with a local path, a local path with `#<tag>`, a `file://` address with `#<tag>`, and `where-is-brett/wheelhouse#<tag>`, each with `--scope project`;
- `claude plugin install wheelhouse@wheelhouse --scope project` after the last;
- `claude plugin install wheelhouse --marketplace where-is-brett/wheelhouse#<tag> --scope project` from nothing;
- the project's settings written with the plugin keys of `projectSettings` (build-loop Task 24: the Wheelhouse marketplace at the tag, `autoUpdate` off, the pins on, the other copies off), the folder marked trusted in the scratch configuration, and one `claude -p` start (no sign-in in the scratch home, so it ended at "Not logged in" after the plugin step, at no cost), read through its `init` event and the debug log.

Everything in the scratch was removed afterwards. The director's four plugin and settings files were compared with copies taken first: `settings.json` and `installed_plugins.json` were identical. `known_marketplaces.json` and `~/.claude.json` had changed, which is what the Claude Code sessions open on this Mac do on their own (check 24 recorded the same drift: Anthropic's marketplace `lastUpdated`, and Claude Code's running state); `known_marketplaces.json` held only its two earlier entries, and neither file named the scratch folder or Wheelhouse's marketplace. No trial command ran against them, since each ran with the scratch `HOME` and `CLAUDE_CONFIG_DIR` set (every path in the debug logs was in the scratch).

The sitting is written out in `probes/37-install-line/run.md`; it runs as step 10b of check 35's Mac sitting, in the same throwaway account.

## Evidence

**What the documentation says.**

- `/plugin install <plugin> --marketplace <source>` is documented for a session (2.1.275 or later; "the source can't contain spaces"). The source "takes the same forms as `/plugin marketplace add`", and that table gives `owner/repo`, with `#ref` "to pin a branch or tag", the example `your-org/plugins#v1.2.0`. No page shows the two together.
- In a session, if the marketplace is new, Claude Code "shows the source it resolved and asks you to confirm before adding it"; then "the plugin's details open and you choose an installation scope". The three scopes are: for you (user), for all collaborators on this repository (project), for you in this repository only (local). The summary's last sentence says `Plugin is now active.` or `Run /reload-plugins to apply.`, in which case the panel runs the reload itself (and, if the reload would spoil the prompt cache, warns and leaves it pending until `/reload-plugins --force`).
- From the shell, `claude plugin install <plugin> --marketplace <source>` (2.1.292 or later) "adds the marketplace without a confirmation step" and "is declared in your user settings even when you pass `--scope project`".
- For Desktop the install page gives the plugin browser: the **+** button, **Plugins**, **Add plugin**, then a scope. The Desktop page's table lists plugins as "`/plugin` command" for the command line and "Plugin manager UI" for Desktop; its slash-command text lists skills and built-in commands without saying `/plugin` is among them. Whether a pasted `/plugin …` line works in the Code tab is not documented.
- The trust dialog is not described on the Desktop page. The permissions and organisation pages say: `extraKnownMarketplaces` from a repository's settings apply only in a trusted folder, and "in an untrusted folder Claude Code ignores them without a message"; in an interactive session the marketplace is registered after the director accepts the workspace trust dialog; in a `-p` run only if trust was already accepted.
- A plugin whose marketplace entry points at an external source (Superpowers and Matt's skills are `url` sources) is not fetched from the project's `enabledPlugins` alone: "Plugin "<name>" is enabled in project settings but isn't installed here" in the Errors tab, until `claude plugin install <name>@<marketplace> --scope project` is run. A plugin with a relative-path source (Wheelhouse itself, `./`) loads from the marketplace copy once the marketplace is registered.

**What the trial showed** (Claude Code 2.1.302, command line).

- A local path or `file://` address cannot carry a tag: `<path>#<tag>` is refused ("Path does not exist"), `file://…#<tag>` is refused ("Invalid marketplace source format"). A local folder was added as a `directory` source with no `ref`. Only `owner/repo#<tag>` takes a ref, and it recorded `"ref": "v0.0.0-probe37"` in a `github` source in the project's settings.
- `claude plugin marketplace add where-is-brett/wheelhouse#<tag> --scope project` printed "Cloning repository … (ref: v0.0.0-probe37)" and "Successfully added marketplace: wheelhouse (declared in project settings)". `claude plugin install wheelhouse@wheelhouse --scope project` then installed with `gitCommitSha` the tag's commit (`952462c…`), although the clone's branch had moved one commit on, version 0.0.0 (the manifest's), under `plugins/cache/wheelhouse/wheelhouse/0.0.0`, and the project's settings gained `"enabledPlugins": {"wheelhouse@wheelhouse": true}`.
- The one-line form `claude plugin install wheelhouse --marketplace "where-is-brett/wheelhouse#<tag>" --scope project`, from nothing, printed "Successfully added marketplace: wheelhouse (declared in user settings)" and installed at project scope, again at the tag's commit. The marketplace entry with the `ref` went into the user's settings; the project's settings got only `enabledPlugins`. So a project that was installed this way does not itself carry the tag.
- With no install at all, the project's settings holding the plugin keys of `projectSettings` and the folder trusted, a headless start printed `plugin_install started` and `completed`, read "1 marketplace(s): wheelhouse(install)", cloned the marketplace at the tag and recorded it in `known_marketplaces.json` with `autoUpdate: false`. It resolved the pins ("Using pre-resolved git SHA for superpowers@wheelhouse: bb92a7774141", "mattpocock-skills@wheelhouse: 24fe0ef7737e") and then reported both as not installed: `Plugin "superpowers" is enabled in project settings but isn't installed — run claude plugin install superpowers@wheelhouse --scope project`. `installed_plugins.json` stayed empty. Before the folder was marked trusted the same start said "no marketplaces declared" and registered nothing, without a message, as the documentation says (the first attempts marked the wrong path: the scratch configuration file is `$CLAUDE_CONFIG_DIR/.claude.json` when that variable is set, not `~/.claude.json`).
- `projectSettings` enables only Superpowers and Matt's skills (`@wheelhouse`) and switches the other copies off; it does not enable `wheelhouse@wheelhouse`. That entry comes from the install itself, at the scope the director picks.
- Not tried: a pasted `/plugin …` line (`/plugin` does not run in `claude -p`), any Desktop window, the trust dialog, an install of Superpowers or Matt's skills (it needs the network; check 24 did it), Windows.

## What it means for the design

- **The line.** Give `/plugin install wheelhouse --marketplace where-is-brett/wheelhouse#<tag>` first, since each half is documented and the shell form took it; if Desktop does not run it, the fall-backs are, in order, the two documented lines (`/plugin marketplace add where-is-brett/wheelhouse#<tag>`, then `/plugin install wheelhouse@wheelhouse`), the plugin browser's clicks, and the helper running `claude plugin marketplace add … --scope project` and `claude plugin install wheelhouse@wheelhouse --scope project`, which is proven here (command line) and needs no pasting. The sitting finds out which one Desktop takes.
- **Say "this project" at the scope question.** The pasted line opens a scope choice, and "for you" is the first of three. Task 13's wording must tell the director to choose the project option, or the plugin is turned on in every project. The confirmations to expect (source, then scope, then possibly a reload) are the documented ones until the sitting says otherwise.
- **The project's settings carry the tag, not the line.** The one-line shell form declares the marketplace in the user's settings; Wheelhouse's project settings (`projectSettings`) also declare it, with `ref` and `autoUpdate: false`, so the release tag lives in the committed file, which is what the release route moves (build-loop section 14.4). Two declarations of one name (user and project) exist after the line; which wins is for the sitting (steps I5 and I7).
- **Superpowers and Matt's skills do not install from the project's settings.** Task 13 and Task 16 should plan on the helper running `claude plugin install superpowers@wheelhouse --scope project` and `claude plugin install mattpocock-skills@wheelhouse --scope project`, as check 24 already advised for a second computer, and on the session-start warning treating "not installed here" as a case. This is from the command line; the sitting repeats it in Desktop (I8, I9), and if Desktop installs them by itself, the helper's step stays harmless.
- **The marketplace is registered only in a trusted folder, silently.** Task 13 writes settings into a folder Desktop has probably already trusted; if it has not, the `extraKnownMarketplaces` entry does nothing and says nothing. The sitting records whether Desktop asks for trust when a session opens in a new folder (I2).
- **A tag is needed on the host** for the sitting and, in the real set-up, the release tag the line names; a local folder cannot be pinned to a tag. R3 of the plan keeps it out of this task: the main session pushes `v0.0.0-probe37` (`probes/37-install-line/run.md`, "The tag") and deletes it afterwards, and the repository must be readable without a login because the throwaway account has none.

## Needs the director

The sitting, as step 10b of check 35's Mac sitting (about ten minutes of the director's time, in the throwaway account, after check 36; `probes/37-install-line/run.md` gives the same figure):

- Starting a new Desktop session in a scratch project with the folder picker and saying yes if Desktop asks to trust the folder (I2).
- Pasting the line into that session, clicking what Desktop shows and reading it out, including all the scope choices, and choosing the project one, "for all collaborators on this repository" (I3); the same for lines 2 to 4 if line 1 fails.
- Typing `/reload-plugins` in that session up to three times (after the install, after the settings are written, and after the helper's install of the pinned plugins: I6, I8, I9), reading out each answer and whether `/` lists the plugins' skills, and saying whether Desktop showed anything of its own; starting a new session in the folder if the plugins appear only there.

The agent does the rest, including the timing from the session's transcript, the settings and the undo. Before it, the main session pushes the tag `v0.0.0-probe37` and shows that it is readable without a login. Windows (a few of the same steps in the director's own account) is optional and follows check 35's W7.
