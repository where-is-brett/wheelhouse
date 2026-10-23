<!-- docs/reviews/2026-10-24-outside-review-plan.md -->

# Outside review plan, 24 October 2026

What an outside security reviewer should look at first, before Wheelhouse's first public release, and the threat model in a page. The user-facing summary is `SECURITY.md`; the design is `docs/specs/2026-10-17-wheelhouse-design.md` (sections 11 and 12).

## The threat model

**What is protected:** the director's host account (GitHub or GitLab) and every repository it reaches; the product's default branch; the director's sign-ins on the computer (`gh`, `glab`, Claude Code, ssh, cloud and deployment tools); Wheelhouse's own keys and signed records; and the director's decisions, which only they may make.

**Who the adversary is:** an agent that goes wrong, or is steered by something it reads: a web page, an issue, a dependency's README, a file in the repository, another agent's output (design section 12.5). It runs as the director's user, can write any code in its worktree, and that code runs through the build commands. It does not have an administrator password, physical access, or a foothold outside the director's account. A malicious upstream kit (Superpowers, Matt Pocock's skills) or a compromised Claude Code, Node.js, `gh` or `glab` is out of scope, except for how pinning limits the first.

**Trust boundaries:**

| Boundary | Inside | Outside | Held by |
|---|---|---|---|
| The sandbox (macOS) | agents' commands and everything they start | `~/.wheelhouse`, credential files, `~/Library/Keychains`, the host's network | Claude Code's sandbox, from each project's `.claude/settings.json` |
| The tool layer | Claude's own file tools, which run outside the sandbox | the same paths, `gh`/`glab`, unlisted MCP servers | permission deny rules and the tool guard hook |
| The helper's socket | requests from any process on the computer | the host key, the signing key, the host | `scripts/host/helper.js`: the push rules, the gate, STOP |
| The director's click | the prompt record hook, the mod's buttons | anything an agent can write into the transcript | signatures with Wheelhouse's key, checked against the card actually shown |
| The host | Wheelhouse's pushes and merges | a direct push to protected branches | server-side protection switched on at setup |

**What an attack would look like,** worst first:

1. **Taking the host key.** Read `~/.wheelhouse/keys` or the director's quick sign-in (a credential file, the keychain, an environment variable), then push or change settings directly.
2. **Forging the director.** Write a signed approval or a click record without the click, so the gate merges a guardrail change.
3. **Getting round the helper's rules.** A request it misreads: a refspec that lands on the default branch, a merge of a commit other than the one reviewed, a push while STOP is on.
4. **Turning the guards off.** Write `.claude/settings.json`, `.claude/hooks/`, a `CLAUDE.md` or another agent-steering file; plant a git setting that runs a program in the helper's git; make a guard crash where a crash lets the call through.
5. **Leaving quietly with data.** Send files out through an allowed domain or through the helper's own requests.

**Accepted risks** (said in `SECURITY.md`): Windows has no sandbox; on the Mac the default connection, quick, is the director's full sign-in, held by the helper and shut to agents' commands only by the sandbox; a project with `signsApps: true` leaves the keychain open; Bash deny rules match command lines only. The protections are quiet defaults with no setup card (the director's ruling of 24 October 2026), so a reviewer should check that each is written for every project, not only when asked.

## Look at first

In this order; each is small enough for an afternoon.

1. **The helper's request handling** (`scripts/host/helper.js`, `scripts/host/`): every route a socket client can call, what it trusts from the caller (the open items in `HANDOVER.md` item 4 name `/push` by folder and `/pull`'s branch), the push-rule and refspec checks, and the gate's conditions (`scripts/gate/`). Try to land a commit on the default branch or merge an unreviewed head.
2. **Signed records** (`scripts/state/signing.js`, `scripts/hooks/prompt-record.js`, the mod's bridge under `scripts/mod/`): who can sign, what a signature covers, whether a record can be replayed onto another card or commit, and the Windows gap where any process can read the key.
3. **The project settings** (`scripts/protection/settings.js`, and how setup writes them in `scripts/setup/project-files.js`, including `signsApps` from step 4's answer) against Claude Code's current sandbox documentation: what each entry really enforces, what a repository-level `allowRead` or another settings scope could re-open, and how Locked's `managed-settings.json` (`scripts/protection/locked.js`) interacts with it.
4. **The tool guard's parser** (`scripts/hooks/tool-guard.js`, `scripts/hooks/shell-words.js`): shell forms that get a `gh`, `git push` or `.env` past it, and the PowerShell tool on Windows.
5. **The git fence** (`scripts/lib/safe-git.js`, `scripts/setup/git.js`): settings on the allowed lists that can still run a program or redirect traffic, and the calls listed in `RAW_GIT_EXCEPTIONS`.
6. **Setup's privileged steps** (`scripts/setup/`): the signed **Go ahead** against the hash of the list, the director's own sign-in used once for the setup commit and protection, and the GitHub App's permissions (`scripts/host/app-manifest.json`).

## What we'd like back

For each finding: the boundary it crosses, the platform and protection level, a reproduction, and whether it needs the agent to run code or only to write text. Report privately as `SECURITY.md` says.
