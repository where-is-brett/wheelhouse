<!-- probes/37-install-line/run.md -->

# Check 37: the pasted install line in Desktop, for the director's sittings

What this finds out: what happens when the line that installs Wheelhouse is pasted into a Claude Desktop session on a fresh account. Which confirmations it asks, where the scope is chosen, how the reload is done, whether Desktop asks the director to trust the folder, how long the director's part takes, and whether the plugins named in a project's settings (Wheelhouse's marketplace, with Superpowers and Matt Pocock's skills pinned) install on their own once the settings are written, or each needs its own step. It runs inside the Mac sitting of check 35, in the same throwaway account: about ten minutes of the director's time, about three of them for starting the session, the trust question, the pasting and the boxes, and the rest for up to three `/reload-plugins` and reading out what each shows (more if line 1 fails and lines 2 to 4 are tried).

**It is not a sitting of its own.** On the Mac it is step 10b of `probes/35-node/run.md`, done in the throwaway account `wh35probe` while it exists, after check 36 (10a). Check 35's notes file, `/Users/Shared/wheelhouse-check35/notes.md`, takes every result, under a "Check 37" heading; check 35's cleanup removes this check's folder with the rest. Windows follows check 35's W7 (see the last section).

**What the documentation says (read 19 October 2026, `docs/checks/37-install-line.md`).** Sources: https://code.claude.com/docs/en/plugins/install, https://code.claude.com/docs/en/plugins/marketplace-reference, https://code.claude.com/docs/en/plugins/loading, https://code.claude.com/docs/en/plugins/org, https://code.claude.com/docs/en/desktop.

- The form in the plan, `/plugin install wheelhouse --marketplace <owner>/wheelhouse#<tag>`, is documented in part. `/plugin install <plugin> --marketplace <source>` is documented for a session (Claude Code 2.1.275 or later; the source can't contain spaces), and the source "takes the same forms as `/plugin marketplace add`", which the documentation says accept `owner/repo#ref` to pin a branch or tag. No page shows `--marketplace` and `#ref` together, so the combined line is inferred from the two.
- In a session the command asks the director to confirm the source it resolved (when that marketplace is new), then opens the plugin's details with three install choices: for you (user), for all collaborators on this repository (project), or for you in this repository only (local). It then prints a summary whose last sentence says `Plugin is now active.` or `Run /reload-plugins to apply.` (the panel then runs the reload by itself).
- For Desktop, the documentation names a plugin browser (the **+** button, **Plugins**, **Add plugin**), and its table of differences from the terminal lists plugins as "`/plugin` command" for the command line and "Plugin manager UI" for Desktop. Nothing says that a pasted `/plugin …` line works in the Code tab. That is what this check finds out.
- Project settings that name a marketplace (`extraKnownMarketplaces`) apply only in a folder the director has trusted. A plugin enabled in the project's `.claude/settings.json` whose marketplace entry points at an external source is not fetched onto a computer where it isn't installed; the Errors tab shows `Plugin "<name>" is enabled in project settings but isn't installed here`.

**What the agent trial found (command line standing in for Desktop, scratch `HOME` and `CLAUDE_CONFIG_DIR`, no network, Claude Code 2.1.302).**

- `claude plugin marketplace add <path>#<ref>` and `file://…#<ref>` are refused; `owner/repo#<tag>` is accepted and records `ref` in the settings. A local folder cannot be pinned to a tag.
- `claude plugin install wheelhouse --marketplace owner/repo#<tag> --scope project` is accepted: it added the marketplace at the tag **in the user's settings** (not the project's), and wrote only `enabledPlugins` to the project's. The installed commit was the tag's, not a later one.
- With the project's settings alone (`extraKnownMarketplaces` at the tag, the pins in `enabledPlugins`, folder already trusted) a headless session cloned the marketplace at the tag, and **did not install** Superpowers or Matt's skills: `Plugin "superpowers" is enabled in project settings but isn't installed — run claude plugin install superpowers@wheelhouse --scope project`.

Desktop is not the command line, so the sitting repeats each of these.

## The tag (the main session, before the sitting)

The install line names a tag of this repository. R3 of the setup plan forbids the agent that prepares this from making or pushing one, so the main session does it, once the branch with `.claude-plugin/marketplace.json` and `.claude-plugin/plugin.json` is on `main`:

```bash
git tag v0.0.0-probe37 <the commit on main to install>
git push origin v0.0.0-probe37
GIT_TERMINAL_PROMPT=0 git -c credential.helper= ls-remote https://github.com/where-is-brett/wheelhouse.git refs/tags/v0.0.0-probe37
```

The last command must print one line. It is run without the director's GitHub login on purpose: the throwaway account has no login, so the repository must be readable without one. If it fails, the sitting stops here; do not put a login into the throwaway account. Write the tag's full commit into the notes file. After the sitting, remove the tag: `git push origin :refs/tags/v0.0.0-probe37` and `git tag -d v0.0.0-probe37`.

## Before the sitting (the agent, in the director's own account)

Done together with step 1 of `probes/35-node/run.md`, from the Wheelhouse worktree, with the agent's own Node.js 22 or later by its full path (the system `node` is 20.9.0, below what the plugin's scripts need):

```bash
mkdir -p /Users/Shared/wheelhouse-check35/check37
<node 22> --input-type=module -e "import fs from 'node:fs'; import { projectSettings } from './scripts/protection/settings.js'; const s = projectSettings({ webDomains: [] }, { release: { ref: process.argv[1] } }); fs.writeFileSync(process.argv[2], JSON.stringify({ extraKnownMarketplaces: s.extraKnownMarketplaces, enabledPlugins: s.enabledPlugins }, null, 2) + '\n')" v0.0.0-probe37 /Users/Shared/wheelhouse-check35/check37/plugin-keys.json
cp probes/37-install-line/run.md /Users/Shared/wheelhouse-check35/check37/run.md
chmod -R a+rwX /Users/Shared/wheelhouse-check35/check37
```

`plugin-keys.json` is the part of build-loop Task 24's `projectSettings` that is about plugins: the Wheelhouse marketplace at the tag with auto-update off, and Superpowers and Matt's skills pinned (`superpowers@wheelhouse`, `mattpocock-skills@wheelhouse` on; `superpowers@claude-plugins-official`, `superpowers@synced`, `mattpocock-skills@synced` off). Check it holds those five names. (The permissions and sandbox keys are left out: they do not bear on this question, and they would deny the agent's own edits to the project's settings.)

## The lines to try, in order

`<tag>` is `v0.0.0-probe37`. Try the next line only when the one before gives an error or does nothing; write down the exact words each time, then undo whatever the failed line left behind (U1 below) before the next.

1. `/plugin install wheelhouse --marketplace where-is-brett/wheelhouse#v0.0.0-probe37`: the form in the plan, typed or pasted in a Desktop session (the documentation's session form, with the tag added).
2. Two lines, one after the other: `/plugin marketplace add where-is-brett/wheelhouse#v0.0.0-probe37`, then `/plugin install wheelhouse@wheelhouse`. Both are documented forms.
3. Desktop's own clicks: **+**, **Plugins**, **Add plugin**. Write down whether the browser can add a marketplace at all (the documentation does not say), the words of each step, and the scope choices.
4. Not in Desktop's prompt box: in Terminal.app in the throwaway user, in the project's folder, with the `claude` that Desktop keeps under `~/Library/Application Support/Claude/claude-code/<version>/` (the path used at step 5 of check 35):

   ```bash
   claude plugin marketplace add where-is-brett/wheelhouse#v0.0.0-probe37 --scope project
   claude plugin install wheelhouse@wheelhouse --scope project
   ```

   This is the form the agent trial ran. It is the fall-back that Task 13's helper can run; it needs no pasting by the director.

## In the throwaway user (step 10b of check 35)

Where it starts: check 36 (10a) is finished and Desktop is open normally. Two Desktop sessions are used. **Session X** is the one the agent already runs in after check 36: the session M8 of check 36 started, in `/Users/Shared/wheelhouse-check35/check36/project`, a folder with no settings and no plugin, so its tools keep working whatever is installed in Y. (Check 35's own project, `/Users/Shared/wheelhouse-check35/project`, does hold a plugin: the scratch copy `wheelhouse@wheelhouse-check35`, at project scope.) X writes the notes and reads the transcript. **Session Y** is a new session in the scratch project, where the line is pasted; it only receives the director's pasting, so nothing it does depends on its tools. Anything in Y that the plugin might block is therefore never needed.

I1. **Scratch project and baseline (X).** `mkdir -p ~/Projects/wheelhouse-check37 && cd ~/Projects/wheelhouse-check37 && git init -q && echo ok > hello.txt`. Then write into the notes file, under "Check 37": `date -u`; the Desktop-carried `claude --version`; `~/.claude/plugins/known_marketplaces.json` and `installed_plugins.json` (ids and scopes only: at this point they list check 35's `wheelhouse-check35`); the tag's commit from the main session's note.

I2. **Session Y and the trust question (director).** In the Code tab start a new local session in the folder `~/Projects/wheelhouse-check37` (the folder picker). Read to the agent, word for word, anything Desktop shows before the prompt box works: whether it asks to trust the folder, its wording, its buttons, and which the director clicks (yes). If it asks nothing, say so. The agent writes it down.

I3. **The line (director).** The agent says "starting" in X and runs `date -u +%FT%TZ`, then gives the director line 1 as text to copy. The director pastes it into session Y's prompt box and presses Enter, then reads out, in order, every box or prompt that appears: the words, the buttons, and which one they click. If a scope is asked, the director reads out all the choices as Desktop words them (the documentation names three: for you, for all collaborators on this repository, for you in this repository only) and picks the **project** one, "for all collaborators on this repository", as Task 13 will tell the director to; if Desktop words it differently, the one that names this repository for everyone. If no scope is asked, say so. At the end, read the last sentence of the summary (`Plugin is now active.`, `Run /reload-plugins to apply.`, an error). Then say "done" in X. If line 1 does nothing or gives an error, write the exact words and go on to line 2, then 3, then 4, undoing between them (U1).

I4. **The time (X).** Find Y's transcript: the newest file in `~/.claude/projects/-Users-wh35probe-Projects-wheelhouse-check37/` (the folder name is the project's path with `/` turned into `-`; if it is not there, look for the newest `.jsonl` under `~/.claude/projects/`). Print the time, kind and first 200 characters of each entry:

```bash
node -e "for (const l of require('fs').readFileSync(process.argv[1],'utf8').split('\n').filter(Boolean)) { try { const j = JSON.parse(l); const c = j.message && j.message.content; const t = typeof c === 'string' ? c : JSON.stringify(c || ''); console.log(j.timestamp, j.type, t.slice(0, 200).replace(/\s+/g, ' ')); } catch {} }" <the transcript file>
```

T0 is the time of the entry holding the pasted line, T1 the time of the last entry the line produced (its summary). The seconds from T0 to T1 are the director's pasting-and-clicking time for that line; the clicks themselves are not entries, so their count and wording come from I3. Write both, and the time between the agent's "starting" and the director's "done" as the wall-clock figure. Leave usernames out of the note.

I5. **What installed (X).** Print only these fields, from `~/.claude/plugins/installed_plugins.json` (for `wheelhouse@wheelhouse`: `scope`, `version`, `gitCommitSha`, `projectPath`) and `known_marketplaces.json` (the `wheelhouse` entry's `source`, with its `ref`, and `autoUpdate` if present). Then the keys `extraKnownMarketplaces` and `enabledPlugins` of two files: `~/Projects/wheelhouse-check37/.claude/settings.json` and `~/.claude/settings.json` (the line may declare the marketplace in either; the command line put it in the user's). Compare `gitCommitSha` with the tag's commit and with `git ls-remote https://github.com/where-is-brett/wheelhouse.git 'refs/tags/v0.0.0-probe37*'`. Write down whether the commit is the tag's.

I6. **The reload (director, then X).** If I3's summary said `Run /reload-plugins to apply.`, did the panel run it? If the plugin was active at once, say so. Either way the director types `/reload-plugins` in Y and reads out its answer (counts of plugins, skills, hooks, any error). Then types `/` in the prompt box and says whether any entry starts `wheelhouse:`, and whether `/plugin` does anything in Desktop (what it shows). If anything is only seen after a new session, write that: the director starts a new session in the same folder and repeats the `/` look. The agent writes the exact words.

I7. **The project's settings (X).** Write the plugin keys into the project's settings, over whatever the line wrote (this stands in for Task 13's merge; `mergeSettings` keeps the existing keys and adds these):

```bash
node -e "const fs=require('fs');const f=process.argv[1];const ours=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));let cur={};try{cur=JSON.parse(fs.readFileSync(f,'utf8'))}catch{};cur.extraKnownMarketplaces={...cur.extraKnownMarketplaces,...ours.extraKnownMarketplaces};cur.enabledPlugins={...cur.enabledPlugins,...ours.enabledPlugins};fs.mkdirSync(require('path').dirname(f),{recursive:true});fs.writeFileSync(f,JSON.stringify(cur,null,2)+'\n')" ~/Projects/wheelhouse-check37/.claude/settings.json /Users/Shared/wheelhouse-check35/check37/plugin-keys.json
```

Print the file's two keys to the notes. Write the time (`date -u`).

I8. **The reload again (director's click).** In Y the director types `/reload-plugins` and reads out the answer; the agent waits a minute, then asks the director to say whether Desktop showed anything on its own (a banner, `Plugins changed. Run /reload-plugins to activate.`, a question about the new marketplace or its plugins). If the plugins still do not appear, the director starts a new session in the folder and reads out the same. Then the agent runs, in `~/Projects/wheelhouse-check37` with the Desktop-carried `claude`, `claude plugin list --json`, and prints for each plugin its id, scope, enabled and any error text. The question this answers: do `superpowers@wheelhouse` and `mattpocock-skills@wheelhouse` install from the project's settings alone? The agent trial says no (the plugins show as "enabled in project settings but isn't installed").

I9. **The helper's route (X).** Only if I8 shows them not installed (if they installed, say so and skip). In `~/Projects/wheelhouse-check37` run, with the Desktop-carried `claude` (it fetches over HTTPS from GitHub; the throwaway account has no SSH key, so say if it tries SSH):

```bash
claude plugin install superpowers@wheelhouse --scope project
claude plugin install mattpocock-skills@wheelhouse --scope project
claude plugin list --json
```

Write what each printed, the time each took, and the `gitCommitSha` of each in `installed_plugins.json` against the pins in `.claude-plugin/marketplace.json` (Superpowers `bb92a77741419a4ab5f06e711a283343f1ada0c3`, Matt's skills `24fe0ef7737efae15c87225755e9f6f5965e4888`). The director types `/reload-plugins` in Y once more; write what it says and whether `/` now lists `superpowers:` and `mattpocock-skills:` skills.

I10. **Write the findings in the notes file.** For each line tried: the exact line, the words Desktop showed, every box and button, the scope choice, how the reload happened, T0 to T1 and the wall-clock figure, the trust question's words (I2), what installed and at which commit (I5), and the answers of I8 and I9. Then the undo.

## The undo (the agent, then the director's log-out)

U1. **Between lines, and at the end.** In `~/Projects/wheelhouse-check37` with the Desktop-carried `claude`: `claude plugin uninstall wheelhouse@wheelhouse --scope project` (and `superpowers@wheelhouse`, `mattpocock-skills@wheelhouse` if installed), and, in case a line or a click chose another scope, the same three with `--scope user` and with `--scope local` (an uninstall of something not installed at that scope only says so), then `claude plugin marketplace remove wheelhouse`, which also removes the plugins installed from it. Then `claude plugin list` must show only what check 35 left (`wheelhouse@wheelhouse-check35`, if its project still holds it) and `claude plugin marketplace list` must not list `wheelhouse`. Remove the project's settings file with the plugin keys (`rm -r ~/Projects/wheelhouse-check37/.claude`). Write the outputs down.
U2. **At the end of the sitting:** `rm -rf ~/Projects/wheelhouse-check37`. Nothing else outside the throwaway account was changed by this check: the account's deletion (step 13 of check 35) removes its plugins folder and settings, and the shared folder is removed by check 35's cleanup. The main session removes the tag (see "The tag").

## Windows (follows W7 of check 35; optional)

Only if sitting 2 happens. Same tag. Do I1 to I6 in the director's own Windows account, with the project in `%TEMP%` instead of `~/Projects`, and only lines 1 to 3 (line 4 is `claude.exe` under `%APPDATA%\Claude\claude-code\<version>\`, found as at W2). This adds the Wheelhouse marketplace to the director's own user settings and installs the plugin at project scope in a scratch project, so ask first, in a card, and undo with U1 (using `--scope project` for the plugin and `claude plugin marketplace remove wheelhouse`) and delete the scratch project. The plan says Windows uses the same line; this finds out whether the clicks and the trust question are the same.

## What to bring back

The exact line that worked (or, for each that failed, the exact error); the clicks and boxes in order, with their words; whether the scope was asked and where; whether the reload ran by itself; whether Desktop asked to trust the folder, and when; T0 to T1 and the wall-clock figure; the commit installed against the tag's; whether `/plugin` does anything in Desktop; whether the pinned Superpowers and Matt's skills install from the project's settings or need `claude plugin install … --scope project` (the answer Task 13 and Task 16 take from this check).
