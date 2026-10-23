<!-- SECURITY.md -->

# Security

Wheelhouse lets AI agents build your product on your own computer. This page says what it protects you from, what it doesn't, and how to tell us about a problem. The first half is for everyone; the second gives the precise terms for developers.

## In plain words

### What Wheelhouse protects you from

Think of the agents as skilled builders you let into your workshop. Wheelhouse gives them a workbench, not the keys to the house.

- **Agents hold no keys.** Wheelhouse never hands agents your GitHub or GitLab sign-in, or any password it keeps. A small helper program on your computer holds the keys. Agents ask it to send their work up; on the Mac they can't go round it (Windows is different: see below).
- **The helper keeps the rules.** It sends work only to a feature's own branch, never straight to your main product, and merges only when the checks pass, a reviewer has looked, and, for anything that changes the safety rules, you have said yes.
- **Your yes is really yours.** When you press a button on a card, Wheelhouse records it with a signature an agent can't forge. An agent typing "yes" for you doesn't count.
- **Guards check every step.** Before an agent runs a command or opens a file, Wheelhouse's guards look at it. They refuse commands that would reach GitHub or GitLab directly, read secret files, or change Wheelhouse's own safety settings. Saying "stop" stops everything, and only your click starts it again.
- **A fenced workbench on the Mac.** Agents' commands run in a sandbox: they can't read your sign-in files or, unless your project signs Apple apps, your Mac's keychain (where your passwords are kept); they can't change files outside their project, and can reach only the websites your project lists.

### What's on without asking you

These protections are switched on quietly, for every project. Setup doesn't ask about them:

- the sandbox on the Mac, with your sign-in files and the keychain shut to builds;
- your GitHub and GitLab sign-in kept out of the agents' commands;
- the guards, the helper's rules and the signed clicks;
- the protection of your main product on GitHub or GitLab, so nothing reaches it except through Wheelhouse's checks.

Setup asks one extra question only if your project looks like an iPhone or Mac app: whether its builds sign the app. Signing needs the keychain, so a Yes opens it for that project's builds.

### What it doesn't protect you from

- **Windows has no sandbox.** On Windows, agents' commands aren't fenced in. The guards, the helper and the reviews still hold, but a command an agent runs could read files in your account, your sign-ins included. Wheelhouse says so on the board. For anything precious, use a Mac.
- **The ordinary sign-in opens your whole account.** On the Mac, Wheelhouse connects to GitHub or GitLab with your ordinary sign-in by default ("Quick"). The sandbox keeps agents from reading it, but the helper uses it, and it opens every project you have. **Make it stricter** at setup gives the helper a key to this one project only; it's recommended for teams and products with real users. On Windows, setup recommends the stricter key from the start.
- **Projects that sign Mac or iPhone apps.** Signing needs the keychain, so such a project has it open for its builds: by your Yes at setup, or later by a change someone reviews and you approve. In that project an agent's command could read your sign-ins from the keychain.
- **Projects set up before 24 October 2026** get the keychain protection only when their settings are next written (setup run again, or a reviewed change).
- **Mistakes in what you approve.** Wheelhouse asks you about anything risky. If you approve something harmful, it goes ahead.

### One habit that matters

If a pop-up says **"security wants to use your confidential information stored in … in your keychain"** and you didn't just ask for something like that, press **Deny**. Never press **Always Allow**. That pop-up means a program is asking for one of your saved passwords, and Wheelhouse never needs you to allow it.

### Reporting a problem

If you find a way round any of this, please tell us privately: on Wheelhouse's GitHub page, open the **Security** tab and choose **Report a vulnerability**. Please don't open a public issue for it. We aim to reply within a week, and we'll say when it's fixed.

## For developers

The design is `docs/specs/2026-10-17-wheelhouse-design.md`; section 12 is safety and section 11 the host helper. The threat model and where an outside reviewer should start are in `docs/reviews/2026-10-24-outside-review-plan.md`.

### What holds, and how

- **No keys for agents.** Wheelhouse's keys (the narrow host key and the signing key) live in a file under `~/.wheelhouse/`, not the keychain. Agents' commands run in Claude Code's sandbox, which denies reading and writing `~/.wheelhouse/`; permission rules deny it to Claude's own file tools, which run outside the sandbox (design section 12.2).
- **The host helper** (`scripts/host/helper.js`) runs outside the sandbox and is the only route to the host. Agents reach it on one Unix socket the sandbox allows by name. It refuses any push to the default branch, any force-push, pushes to the state branch other than new events, and any push or merge under STOP. It merges only when the merge gate's conditions hold, working out for itself from the pull request's changed files whether the director's approval is needed; the caller can only add conditions (design sections 11 and 12.3).
- **The guards** are Claude Code hooks (`hooks/hooks.json`, `scripts/hooks/`), with `onFailure: block` so a guard that crashes stops the tool call. The tool guard reads commands as shell words and refuses `gh`, `glab`, `git push` and its plumbing forms, a plain read of the keychain with `security`, `.env` files, encoded PowerShell, unlisted MCP servers, and any command it can't parse with confidence. The deny rules in each project's `.claude/settings.json` back it up (`scripts/protection/settings.js`).
- **Signed clicks.** The prompt-record hook signs a card answer with Wheelhouse's signing key only when the director's click matches an option the card really offered. Approvals, confirmations and reviews are signed records on the state branch; the gate and the helper verify them.
- **The sandbox** (macOS) runs with `allowUnsandboxedCommands: false`. It denies reads of every platform's credential paths (`~/.ssh`, `~/.config/gh`, `~/.npmrc`, `~/.git-credentials`, `~/.claude/.credentials.json`, deployment tools' stores and more), `~/Library/Keychains` through `sandbox.credentials.files` (unless the project's configuration says `signsApps: true`), and unsets the host tools' token variables (`GH_TOKEN`, `GITHUB_TOKEN`, `GH_ENTERPRISE_TOKEN`, `GITHUB_ENTERPRISE_TOKEN`, `GITLAB_TOKEN`, `GITLAB_ACCESS_TOKEN`, `OAUTH_TOKEN`) in every sandboxed command. Writes outside the worktree and to the project's own `.claude/` files and hooks are denied. The network allowlist is `registry.npmjs.org` plus the project's `webDomains`; the host is not on it.
- **Locked** (macOS, optional) adds a computer-wide `managed-settings.json` that only an administrator can change: the hooks, deny rules safe in every project, bypass mode off, and the sandbox admin-required with managed domains only. It requires the narrow connection. The keychain denial stays in each project's own settings, which still apply under an admin-required sandbox, so a project that signs apps elsewhere on the computer still can.
- **Server-side protection** of the default, state and lock branches is switched on at setup, so the host refuses a direct push even if every local layer failed.

### The quiet defaults

The protections are defaults, not setup questions (the director's ruling of 24 October 2026):

- `projectSettings` writes the sandbox, the credential and keychain denials and the token variables for every project, at Standard and Locked, with no card.
- Setup's step 4 asks whether builds sign Apple apps only when the project looks like it (an `.xcodeproj` or `.xcworkspace`, fastlane, or `codesign` in `package.json`, a Makefile or a Gemfile; `signsAppleApps` in `scripts/setup/questions.js`). Only that Yes writes `signsApps: true`; a `true` in the working copy the director didn't give is set back to `false` at setup. Later, the switch moves by a reviewed pull request with the director's approval (`.claude/` is a guardrail).
- The connection: on the Mac, Quick (the director's `gh` or `glab` sign-in) is the default, since the sandbox denies its files and the keychain; narrow sits behind **Make it stricter**, recommended there for a product with real users. On Windows, and for a Locked or launched project, a narrow way is the recommendation.

### What doesn't, or not yet

- **Windows.** Claude Code has no sandbox there (check 10). Any command can read the helper's keys file, and so sign records, and read the director's sign-ins, including `gh`'s token in Windows Credential Manager. Guarded runs build commands at low integrity; whether a low process can read a generic credential is check 52's open `credential-manager-low` line.
- **Quick connection.** The helper uses the director's own `gh` or `glab` sign-in, with full account scope, so a fault in the helper's rules, or a sign-in read some other way, reaches every repository. On the Mac the sandbox denies `~/.config/gh` and the keychain files; on Windows nothing does. Locked refuses quick. Moving an existing project to narrow after setup has no guided route yet.
- **What remains of the keychain gap.** Check 73 showed that denying reads of a keychain file's folder stops a sandboxed `security find-generic-password -w`, because the file is read in the calling process. Left open:
  - a project with `signsApps: true` has no keychain denial;
  - a project set up before 24 October 2026 has none until its settings are next written (setup run again, or a reviewed pull request);
  - the denial covers the file keychains under `~/Library/Keychains`; items in the data-protection (iCloud) keychain go through `securityd` and were not measured;
  - a sandboxed process can still ask the security service to show a "wants to use your confidential information" prompt, so a director who clicks **Always Allow** gives that item away (hence the habit above);
  - the tool guard refuses only the plain command line (`security` with `find-generic-password`, `find-internet-password`, `dump-keychain` or `export`, or the first part of one, which `security` also takes; a command word made at run time; or reading its commands from the input); a program or script that calls the security service itself is held by the sandbox's denial alone.
- **Bash deny rules** match command lines, not programs (a full path or `sh -c` walks round them). The sandbox is what holds on the Mac; on Windows the tool guard is.
- **Git settings.** Every Wheelhouse git call goes through one fenced route with an allowed list of repository settings (`scripts/lib/safe-git.js`). The environment's proxy and certificate settings still pass, and a setting changed between the look and git's read gets past it (design section 12.9).
- **The supply chain.** Wheelhouse pins Superpowers and Matt Pocock's skills by commit in its marketplace, but trusts Claude Code, Node.js, `gh` and `glab` (fetched and checked by digest at setup) as installed.

### Reporting

Use GitHub's private vulnerability reporting on `where-is-brett/wheelhouse` (Security tab, **Report a vulnerability**). Include the platform, the Claude Code version, the protection level (Standard or Locked), the connection (narrow or quick) and steps to reproduce. Please give us 90 days before publishing.
