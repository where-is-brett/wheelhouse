<!-- docs/research/agent-host-access-2026-10.md -->

# How agents get access to GitHub and GitLab

Research brief, compiled 17 to 18 October 2026, for a rethink of how Wheelhouse's agents reach the repository host (design sections 11, 12 and 15; checks 10, 11, 13, 14, 16 and 18).

**The question.** The director's objection: most people who would use Wheelhouse already have git, a signed-in `gh`, and claude.ai's GitHub or GitLab connectors. A plugin that asks them to make a token on GitHub's token page and paste it in will raise eyebrows, and doing that for every project is tedious. What do other agent tools do, and what does security guidance say?

**How to read this.** Every claim carries a source link. Most sources are primary: vendor documentation, source code and vendor engineering posts. Markers:

- **[secondary]**: the claim comes from commentary or a third party, not the original author.
- **[unverified]**: I could not confirm it from a primary source.
- **[inference]**: my own reasoning from the cited sources. It is not a claim made by the source.

Documentation pages were read on 17 or 18 October 2026. Claude Code version numbers are the ones its pages gave on those days.

---

## Summary

- **The login people already have is the broadest one.** `gh auth login` always asks for the `repo` scope, which is full control of every private repository the person can reach, and `--scopes` can only add to it ([cli/cli source](https://raw.githubusercontent.com/cli/cli/trunk/internal/authflow/flow.go); [scopes](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/scopes-for-oauth-apps)). Any program running as the person can print it with `gh auth token` ([manual](https://cli.github.com/manual/gh_auth_token)). `glab`'s default sign-in asks for `api`, full read and write ([GitLab CLI source](https://gitlab.com/gitlab-org/cli/-/blob/main/internal/oauth2/config.go)).
- **Local agent tools mostly just use that login.** Claude Code, Codex CLI, Gemini CLI, Aider, Cursor and Amp all run the person's own git and `gh` locally. What differs is how far their sandboxes keep the agent from it. Claude Code can now hide a token from sandboxed commands and add it back on the way out, but it doesn't limit what the token is then used for.
- **Cloud tools almost all avoid it.** They use a GitHub App with short-lived tokens limited to the chosen repositories. Claude Code's cloud sessions and Amp go further: the real credential never enters the agent's machine, and a proxy or credential helper adds it on the way out.
- **No token type can say "branches yes, `main` no".** On GitHub, pushing any branch and merging a pull request both need the same permission, Contents: write ([permissions table](https://docs.github.com/en/rest/authentication/permissions-required-for-fine-grained-personal-access-tokens)). Every tool surveyed relies on the host's branch protection for that, except GitHub's own Copilot agent, which is never given raw git at all. GitHub Free gives a private repository no branch protection (check 13). So on a private repository on GitHub Free, the only thing that can hold the line is a program on the computer that does the pushing for the agent and refuses what it shouldn't do: Wheelhouse's host helper.
- **Guidance agrees on the shape.** It says: give the agent its own narrow, short-lived identity, not the person's broad token; keep the credential outside the agent's reach and add it on the way out; and keep merging behind a human or a check the agent can't bypass (OWASP, GitHub, Anthropic, Google, Meta; section 4).
- **What it means for Wheelhouse** [inference]. The design's shape (a helper that holds the credential and does the pushing) is industry practice, and should stay. What can change is *which* credential and *how the director gets it*. A Wheelhouse GitHub App with a "sign in with a code" step, like `gh auth login`, would remove the token page and the paste. Its access tokens last eight hours, and it covers only the repositories it is installed on. Section 6 gives five options and a recommendation.

---

## 1. What the tools do

### 1.1 Comparison

"Can the agent read it" means whether the agent's own commands can get the raw credential under the tool's documented defaults.

| Tool | Where it runs | How it signs in to GitHub | What the agent can do | Can the agent read it | What stops a push to `main` or a merge | GitLab |
|---|---|---|---|---|---|---|
| **Claude Code (local)** | Local | The person's own git, `ssh` and `gh` | Whatever the person can do | Yes by default; can be denied or masked (1.2) | The host's branch protection. Auto mode allows "Pushing to any branch… including the default branch" ([permission modes](https://code.claude.com/docs/en/permission-modes)) | Same, through `glab` |
| **Claude Code (cloud sessions)** | Cloud | Claude GitHub App, or the local `gh` token sent to the account by `/web-setup` ([web](https://code.claude.com/docs/en/claude-code-on-the-web)) | API limited to the session's repositories; GraphQL blocked ([cloud environments](https://code.claude.com/docs/en/cloud-environments)) | No: "never enter a session's VM" ([security](https://code.claude.com/docs/en/security)) | The proxy refuses branch deletions and tag pushes only; branches are left to GitHub's rulesets (1.3) | Uploaded copy only; can't push back |
| **Claude Code GitHub Actions** | CI runner | Claude GitHub App, short-lived token "scoped specifically to the repository" ([security.md](https://github.com/anthropics/claude-code-action/blob/main/docs/security.md)) | The app asks for broad permissions; the docs suggest a custom app with Contents, Issues, Pull requests ([docs](https://code.claude.com/docs/en/github-actions)) | [unverified] | Configured not to merge or push elsewhere ([FAQ](https://github.com/anthropics/claude-code-action/blob/main/docs/faq.md)); branch protection is the hard stop [inference] | Separate GitLab CI integration, `CI_JOB_TOKEN` or a project token ([docs](https://code.claude.com/docs/en/gitlab-ci-cd)) |
| **GitHub Copilot cloud agent** | Cloud | GitHub-internal token, revoked when the session ends ([GitHub blog](https://github.blog/ai-and-ml/github-copilot/how-githubs-agentic-security-principles-make-our-ai-agents-as-secure-as-possible/)) | Its own `copilot/` branch only | [unverified]; "cannot directly run `git push`" | Built in: can't approve or merge; the person who asked can't approve; workflows wait for a human ([risks and mitigations](https://docs.github.com/en/copilot/concepts/agents/cloud-agent/risks-and-mitigations)) | GitHub only |
| **OpenAI Codex CLI** | Local | The person's own git | Whatever the person can do | `.git` read-only and network off in the default mode ([approvals and security](https://developers.openai.com/codex/agent-approvals-security)) | Approval prompts; the host's protection | Same |
| **OpenAI Codex cloud** | Cloud | ChatGPT's GitHub connection | [unverified] | No internet in the agent phase by default; secrets as placeholders the proxy swaps ([cloud environments](https://learn.chatgpt.com/docs/environments/cloud-environments)) | The person commits or opens the PR from the interface; "don't replace… branch protections" ([GitHub](https://learn.chatgpt.com/docs/third-party/github)) | Beta; service account with an `api` token ([GitLab](https://learn.chatgpt.com/docs/third-party/gitlab)) |
| **Cursor cloud agents** | Cloud | Cursor GitHub or GitLab App, plus each person's linked account ([security](https://cursor.com/docs/cloud-agent/security)) | Repositories "the triggering user could already reach" | [unverified] | Hands off as a draft pull request; push to `main` not addressed | Yes |
| **Devin** | Cloud | GitHub App: Contents and Pull requests read and write ([docs](https://docs.devin.ai/integrations/gh)) | A "regular contributor" | [unverified] | Advises branch protection "before Devin can merge" | OAuth or a service account's `api` token; advises a dedicated account ([docs](https://docs.devin.ai/integrations/gitlab)) |
| **Aider** | Local | The person's own git | Commits locally ([git](https://aider.chat/docs/git.html)) | Yes | Doesn't push [inference] | Same |
| **OpenHands** | Local or cloud | Token put in the shell as `GITHUB_TOKEN` ([integrations](https://docs.openhands.dev/openhands/usage/settings/integrations-settings)) | Suggests Contents and Pull requests write | Yes, by design | The host's protection | `GITLAB_TOKEN`, same way |
| **Gemini CLI** | Local | The person's own git [unverified]; sandbox is opt-in ([sandbox](https://github.com/google-gemini/gemini-cli/blob/main/docs/cli/sandbox.md)) | Whatever the person can do | Yes unless sandboxed | The host's protection | Same |
| **run-gemini-cli Action** | CI runner | `GITHUB_TOKEN` or a recommended custom GitHub App ([auth](https://github.com/google-github-actions/run-gemini-cli/blob/main/docs/authentication.md)) | Contents, Issues, Pull requests | [unverified] | Advises "Require a pull request before merging" ([best practices](https://github.com/google-github-actions/run-gemini-cli/blob/main/docs/best-practices.md)) | No |
| **Google Jules** | Cloud | GitHub connection, all or chosen repositories ([docs](https://jules.google/docs/)) | [unverified] | [unverified] | The person clicks "Publish branch" or "Publish PR" | No |
| **Amp** | Local and cloud | Local: the machine's git. Cloud: GitHub App plus the person's account; a credential helper fetches short-lived tokens ([docs](https://ampcode.com/docs/github)) | Any repository "your connection can reach" | No long-lived token in the cloud machine | "Branch protection rules… apply exactly as if you had pushed" | Not mentioned |
| **Factory** | CI runner | Installation token "automatically revoked after the workflow completes" ([docs](https://docs.factory.com/enterprise/github-integration-security)) | Contents, Pull requests, Issues | [unverified] | Advises branch protection | [unverified] |
| **GitLab Duo Agent Platform** | GitLab's runners | One-time "composite identity": the person plus a service account, whichever is "more restrictive" ([docs](https://docs.gitlab.com/user/duo_agent_platform/composite_identity/)) | Developer role at most | Likely yes, inside the sandbox [inference] ([sandbox](https://docs.gitlab.com/user/duo_agent_platform/environment_sandbox/)) | Developer can't push to a protected branch [inference] | Native |
| **GitHub MCP server** | Either | OAuth (remote) or a token (local) ([repo](https://github.com/github/github-mcp-server)) | Whatever the credential allows; `--read-only` and toolsets narrow the tools | Local: yes | `merge_pull_request` exists unless read-only; lockdown "does not change what the underlying GitHub credential can read or write" | No |

Sweep was not researched.

**What the table shows** [inference]:

- Local tools all run on the person's own login. Only Claude Code (masking) and Codex CLI (read-only `.git`, network off) actively keep the agent away from it by default or by setting.
- Cloud tools almost all use a GitHub App with short-lived tokens, limited to repositories someone chose. Three keep the credential out of the agent's machine altogether: Claude Code cloud, Amp cloud and Codex cloud.
- Only Copilot builds "no `main`, no merge" into the platform. Every other vendor points at branch protection.

### 1.2 Claude Code locally: masking a credential

Claude Code's sandbox can now keep a credential from sandboxed commands while still letting their requests authenticate ([sandboxing](https://code.claude.com/docs/en/sandboxing)):

- `sandbox.credentials` lists files and environment variables. `deny` blocks them. `mask` shows commands a per-session placeholder, and "the sandbox proxy substitutes the real value on outbound requests to hosts you allow". The docs' example masks `GH_TOKEN` "only on requests to `api.github.com`".
- **It needs** `network.tlsTerminate`, which is marked experimental. The proxy otherwise "does not terminate or inspect TLS traffic".
- **Only some settings can turn it on.** `mask` entries are honoured "only from user settings, managed settings, and the `--settings` flag", never from a project's `.claude/settings.json`. A plugin's project settings therefore can't switch it on [inference].
- **On macOS, files can't be masked.** A masked file is blocked instead, "the same effect as `deny`", so `gh` reading its file won't work inside the sandbox. Masking environment variables works on macOS.
- **"There is no built-in credential deny list".** By default sandboxed commands can read `~/.ssh` and similar.
- **Git over SSH fails** inside the sandbox on macOS. The fix the docs give is to switch to HTTPS, or to take `git push` out of the sandbox with `excludedCommands`, where it "can reach any host".
- **Not on native Windows.** The sandbox isn't there (check 10).
- **Masking doesn't limit use** [inference]. A masked `GH_TOKEN` still authenticates every request the agent sends to `api.github.com`, including a merge or a push to `main`. Masking stops the token being stolen; it doesn't stop it being misused.

For applications built on the Agent SDK, Anthropic recommends the pattern Wheelhouse's helper follows: run "a proxy outside the agent's security boundary that injects credentials", so the agent never sees them. Its example: "a git MCP server could… forward them to a git proxy" ([secure deployment](https://code.claude.com/docs/en/agent-sdk/secure-deployment)).

### 1.3 Claude Code cloud sessions: a git proxy

- "the git client inside the VM uses a scoped credential, which the proxy verifies and swaps for your actual GitHub token". Inside the VM, `GH_TOKEN` reads as the placeholder `proxy-injected` ([cloud environments](https://code.claude.com/docs/en/cloud-environments)).
- The proxy refuses branch deletions and pushes of tags. "It doesn't limit which branches a push can update. To do that, use branch protection rules or rulesets on GitHub" (same page). And "A rule that access can bypass doesn't block a session's push" ([security](https://code.claude.com/docs/en/security)).
- **Anthropic's engineering post says otherwise.** It gave the proxy's check as "ensuring it is only pushing to the configured branch" ([Beyond permission prompts, 20 October 2025](https://www.anthropic.com/engineering/claude-code-sandboxing)). The current documentation is the later source and should win.

### 1.4 GitHub Copilot cloud agent: the strictest

From [risks and mitigations](https://docs.github.com/en/copilot/concepts/agents/cloud-agent/risks-and-mitigations):

- "the agent can only push to that branch", a new `copilot/` branch.
- "It cannot directly run `git push` or other Git commands." The platform does the pushing.
- It "cannot approve or merge a pull request". The person who asked for the pull request can't approve it either, which "maintains the expected controls" of required reviews.
- Workflows on its pull request wait until a person with write access approves them.
- It is still "subject to any branch protections and required checks".
- Claude and Codex, when run as agents on GitHub, "are subject to the same security protections" ([third-party agents](https://docs.github.com/en/copilot/concepts/agents/about-third-party-coding-agents)).

GitHub's principles behind it: agents are "not able to commit directly to a default branch" and "not able to initiate any irreversible state changes without a human in the loop" ([GitHub blog, 25 November 2025](https://github.blog/ai-and-ml/github-copilot/how-githubs-agentic-security-principles-make-our-ai-agents-as-secure-as-possible/)). GitHub's agentic workflows go further: "we wanted workflow agents to have zero access to secrets". The agent reads through a read-only server and "can only stage its updates" through a separate one that checks them before anything is published ([GitHub blog, 9 March 2026](https://github.blog/ai-and-ml/generative-ai/under-the-hood-security-architecture-of-github-agentic-workflows/)).

### 1.5 GitLab Duo: composite identity

- A flow runs as "a one-time composite identity" that "combines two identities into a single token". Its role is the person's or a Developer-role service account's, "whichever is more restrictive". This prevents "privilege escalation by either the human user or the service account" ([composite identity](https://docs.gitlab.com/user/duo_agent_platform/composite_identity/)).
- External agents such as Claude Code run as a per-project group service account with Developer role, and work on `duo/` branches ([external agents](https://docs.gitlab.com/user/duo_agent_platform/agents/external/)).
- Its sandbox is Anthropic's sandbox runtime, allowing only GitLab's own domains by default ([sandbox](https://docs.gitlab.com/user/duo_agent_platform/environment_sandbox/)).

---

## 2. The patterns, and what each costs

### 2.1 At a glance

| Pattern | Setup for a non-technical person | What scope can be enforced | Works on GitHub Free private? | GitLab equivalent |
|---|---|---|---|---|
| **The person's existing `gh` or git login** | None | None: `repo` covers every private repository they can reach | Yes | `glab` login: `api` scope by default |
| **Fine-grained personal token** | A prefilled page, ticking repositories by hand, copy and paste | Chosen permissions, on chosen repositories or all of one owner's | Yes | Fine-grained token, Free from GitLab 19.2 |
| **GitHub App, installation tokens** (a bot) | Create the app (manifest: a name and one button), then install it and pick repositories | App permissions, installed repositories, narrowed per token; 1 hour | Yes [secondary] | No direct equivalent; project access tokens need Premium on GitLab.com |
| **GitHub App, user tokens by device flow** | Type a short code on a GitHub page and click Authorise, like `gh auth login`; install the app once | What both the person and the app may do; 8-hour tokens, 6-month refresh | Yes [secondary] | OAuth application, but its scopes are coarse [inference] |
| **Credential-injecting proxy** | None extra; it is a way of holding whichever credential above | Can refuse requests by content, if it inspects them | Yes | Same |
| **Dev container forwarding** | Docker plus an editor | None: forwards the person's own helper and SSH agent | Yes | Same |
| **SSH agent forwarding** | Technical | None: anything the keys can do | Yes | Same |

### 2.2 The person's existing login (`gh`, `glab`, git's credential helper)

- **What it is.** `gh` asks for `repo`, `read:org` and `gist` at every sign-in ([source](https://raw.githubusercontent.com/cli/cli/trunk/internal/authflow/flow.go)). `--scopes` gives "Additional authentication scopes", never fewer ([manual](https://cli.github.com/manual/gh_auth_login)). `repo` "Grants full access to public and private repositories" ([scopes](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/scopes-for-oauth-apps)).
- **Where it lives.** In the system's credential store, falling back to a plain file ([manual](https://cli.github.com/manual/gh_auth_login)). `gh auth token` prints it, and `git credential fill` returns what git's helper holds ([git-credential](https://git-scm.com/docs/git-credential)). A sandboxed agent on the Mac could read a keychain item (check 11). It is likely the same for `gh`'s item [inference; untested].
- **Friction.** None.
- **Scope.** None can be enforced. The token reaches every private repository the person can, including ones that have nothing to do with the project.
- **Guidance** is against it: "Instead of sharing a personal access token, consider creating a GitHub App" ([GitHub](https://docs.github.com/en/rest/authentication/keeping-your-api-credentials-secure)). Anthropic's dev container docs: "Avoid mounting host secrets… prefer repository-scoped or short-lived tokens" ([devcontainer](https://code.claude.com/docs/en/devcontainer)). The Invariant Labs attack (section 4.4) worked because a token reached both public and private repositories.

### 2.3 Fine-grained personal tokens (the current design)

From [managing your personal access tokens](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens):

- **No API creates one.** The docs describe only the web page. The organisation endpoints list, approve and revoke tokens but don't create them ([REST](https://docs.github.com/en/rest/orgs/personal-access-tokens)).
- **A prefilled page.** "Each supported field can be set using a specific query parameter": `name`, `description`, `target_name`, `expires_in` (1 to 366, or `none`) and one per permission. **Repositories can't be prefilled** (check 14).
- **Repository choice.** "Only select repositories" is one choice. Another covers all of one owner's repositories [secondary: third-party docs]. "Each token is limited to access resources owned by a single user or organization". "Tokens always include read-only access to all public repositories".
- **Changing repositories later.** Whether repository access can be edited on an existing token without changing its value isn't covered by the official docs [unverified]. One integration's docs say updating the list "will not update the value of the token" [secondary: Easypanel].
- **Limit.** "There is a limit of 50 fine-grained personal access tokens".
- **GitLab.** Fine-grained personal tokens limited to chosen projects are on every tier, generally available from 19.2 ([GitLab](https://docs.gitlab.com/auth/tokens/fine_grained_access_tokens/)). The new-token page takes `name`, `description` and `scopes` from the link ([GitLab](https://docs.gitlab.com/user/profile/personal_access_tokens/)). A person can't create a general-purpose token through the API: `POST /user/personal_access_tokens` "Only accepts `k8s_proxy` and `self_rotate`" ([API](https://docs.gitlab.com/api/user_tokens/)).

### 2.4 GitHub Apps

From [deciding when to build a GitHub App](https://docs.github.com/en/apps/creating-github-apps/about-creating-github-apps/deciding-when-to-build-a-github-app) and the pages linked below:

- **Why GitHub prefers them.** Fine-grained permissions, repositories chosen by whoever installs it, and "GitHub Apps use short lived tokens". For long-lived integrations, "we recommend building a GitHub App".
- **Two kinds of token.**
  - **Installation tokens** act as the app's bot (for example `@name[bot]`). "The installation access token will expire after 1 hour", and each can be narrowed to some repositories and some permissions ([installation tokens](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-an-installation-access-token-for-a-github-app)). Making them needs the app's private key.
  - **User access tokens** act for the person, "via" the app. Such a token "only has permissions that both the user and the app have" ([user tokens](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-a-user-access-token-for-a-github-app)). It expires after 8 hours; its refresh token lasts 6 months ([refreshing](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/refreshing-user-access-tokens)). It reaches only repositories the app is installed on [inference from "both the user and the app"].
- **Device flow.** GitHub recommends it for "CLI tools… and desktop applications" (same page). It needs only the app's public client ID, and a refresh needs no client secret either: `client_secret` is "Required unless the user access token was generated using the device flow" ([refreshing](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/refreshing-user-access-tokens)). So a desktop tool can use a shared, published app without shipping any secret [inference].
- **The manifest flow** lets a tool register an app for the person: a form posts the app's settings to GitHub, the person can edit the name and clicks **Create GitHub App**, and GitHub returns a code the tool exchanges, "within one hour", for the app's ID, private key and secrets ([manifest](https://docs.github.com/en/apps/sharing-github-apps/registering-a-github-app-from-a-manifest)). Probot runs this from `localhost` [secondary]. Installing the app and picking repositories follows, about 3 to 5 clicks in all [secondary].
- **Changing repositories doesn't reissue anything.** An installation is on "All repositories" or "Only select repositories", changed later on its Configure page ([installed apps](https://docs.github.com/en/apps/using-github-apps/reviewing-and-modifying-installed-github-apps)). A program can also add one: `PUT /user/installations/{installation_id}/repositories/{repository_id}`, where "The authenticated user must have admin access to the repository" ([REST](https://docs.github.com/en/rest/apps/installations)).
- **Plan.** No plan gating for Apps is documented. Claude's app works on private repositories with no plan caveat [secondary].
- **Approvals.** "Pull request authors cannot approve their own pull requests" ([GitHub](https://docs.github.com/en/pull-requests/collaborating-with-pull-requests/reviewing-changes-in-pull-requests/approving-a-pull-request-with-required-reviews)). With installation tokens the bot is the author, so the director can approve; with user tokens the director is the author, so they can't [inference].
- **What it can't do** [inference]. Merging needs Contents: write, the same as pushing a branch ([permissions table](https://docs.github.com/en/rest/authentication/permissions-required-for-fine-grained-personal-access-tokens)). An app that can open pull requests from pushed branches can therefore also push to `main` and merge, unless the host's protection or the program holding the token refuses.

### 2.5 Credential-injecting proxies ("secretless")

The agent gets a placeholder or nothing; a process outside its reach adds the real credential to outgoing requests.

- **Claude Code**: masking locally (1.2), and the git proxy in cloud sessions (1.3).
- **Anthropic's sandbox runtime**, the open-source base of Claude Code's sandbox, does the same: `mask` puts "a sentinel in its place inside the sandbox" and the proxy will "substitute the real value back on egress" ([sandbox-runtime](https://github.com/anthropic-experimental/sandbox-runtime)). It also has a hook that sees each decrypted request, where a check on pushes could sit [secondary].
- **Docker Sandboxes**: "The agent sees a sentinel value instead of the real API credential"; a `github` secret can be taken from `gh auth token` ([Docker](https://docs.docker.com/ai/sandboxes/security/credentials/)).
- **Vercel Sandbox, E2B, Cloudflare Sandbox** add headers at the egress layer, so credentials "only exist in a layer outside the VM" ([Vercel, 23 February 2026](https://vercel.com/changelog/safely-inject-credentials-in-http-headers-with-vercel-sandbox); [E2B](https://docs.e2b.dev/secrets/inject); [Cloudflare, 13 April 2026](https://developers.cloudflare.com/changelog/post/2026-04-13-sandbox-outbound-workers-tls-auth/)).
- **Trade-off.** It needs a boundary the agent can't cross: a VM, a container or an OS sandbox. On a computer with no sandbox (native Windows, check 10), the agent can read the proxy's own store of the credential [inference].

### 2.6 Dev containers and SSH agent forwarding

- VS Code forwards the person's credential helper and SSH agent into a container: "no further setup is required" ([VS Code](https://code.visualstudio.com/remote/advancedcontainers/sharing-git-credentials)). The container gets the person's full access.
- SSH agent forwarding: an attacker "cannot obtain key material" but can "authenticate using the identities loaded into the agent" ([ssh_config](https://man.openbsd.org/ssh_config)).
- Neither narrows scope. Neither suits a non-technical person on Windows [inference].

---

## 3. Holding the line without the host's protection

Asked: can anything on the computer enforce "agents can't push to `main` or merge without checks" when the host doesn't?

| Mechanism | Sees the branch? | Can the agent get round it? |
|---|---|---|
| **git `pre-push` hook** | Yes: each push gives local and remote refs on stdin ([githooks](https://git-scm.com/docs/githooks)) | Yes: "With `--no-verify`, the hook is bypassed completely" ([git-push](https://git-scm.com/docs/git-push)); the hook file sits in the repository. It doesn't see API merges |
| **Credential helper that refuses** | No: git sends `protocol`, `host`, `path`, `username` and similar, no ref ([git-credential](https://git-scm.com/docs/git-credential)) | Can't tell `main` from a feature branch |
| **`remote.<name>.push`, `pushurl`** | Defaults only | An explicit refspec on the command line wins |
| **Claude Code permission rules** such as `Bash(git push *)` | Only the command's text | "`git -C . push origin main`" isn't matched; argument patterns "are fragile" ([permissions](https://code.claude.com/docs/en/permissions)) |
| **`PreToolUse` hooks** | The command's text or the tool's input | Blocks "even in `bypassPermissions` mode", but for a hard rule "use the permission system rather than a hook" ([hooks guide](https://code.claude.com/docs/en/hooks-guide)). Same text-matching gaps |
| **A program that holds the credential and does the pushing** (Wheelhouse's host helper) | Yes: it chooses the refs and calls itself | Only if the agent can reach the credential or the host directly. On the Mac the sandbox stops both (check 11); on Windows nothing does (check 10) |
| **A filtering git proxy** | Yes: a push's ref commands come before the pack data ([HTTP protocol](https://git-scm.com/docs/gitprotocol-http)) | Same as the row above. No ready-made one for agents was found [unverified] |

**Conclusion** [inference]:

- Hooks and rules are guard rails against mistakes.
- Hard enforcement needs two things together: the agent can't reach the credential, and something outside the agent decides what to send. That is the host helper with the sandbox (the Mac), or the host's own protection.
- **Ways to get the host's protection:**
  - GitLab Free protects the default branch by default, and "Allowed to push and merge" can be set to No one ([GitLab](https://docs.gitlab.com/user/project/repository/branches/protected/)).
  - On GitHub, a public repository on Free, or a private one on Pro or a paid team plan (check 13).

---

## 4. What the guidance says

### 4.1 OWASP

- **LLM06 Excessive Agency** ([OWASP, 2025](https://genai.owasp.org/llmrisk/llm062025-excessive-agency/)):
  - "Limit the extensions that LLM agents are allowed to call to only the minimum necessary."
  - "require a human to approve high-impact actions before they are taken."
  - "Implement authorization in downstream systems rather than relying on an LLM". This is complete mediation: the host, or the helper, decides, not the agent.
  - It also asks for actions to run in the user's own context with the least privilege.
- **Top 10 for Agentic Applications** ([OWASP, 9 December 2025](https://genai.owasp.org/resource/owasp-top-10-for-agentic-applications-for-2026/)):
  - Least agency: "avoid unnecessary autonomy".
  - Identity and privilege abuse: "Issue short-lived, narrowly scoped tokens per task", and "Require human approval for high-privilege or irreversible actions".
  - Tool misuse: "Define per-tool least-privilege profiles (scopes, maximum rate, and egress allowlists)".
  - It cites the Nx compromise (4.4).

### 4.2 Platform vendors

- **GitHub:**
  - "Instead of sharing a personal access token, consider creating a GitHub App."
  - "only select the minimum permissions or scopes needed", with the shortest expiry that works ([keeping credentials secure](https://docs.github.com/en/rest/authentication/keeping-your-api-credentials-secure)).
  - The agent principles in 1.4.
- **Anthropic:**
  - "Effective sandboxing requires both filesystem and network isolation". Also: "Allowing broad domains such as `github.com` can create paths for data exfiltration" ([sandboxing](https://code.claude.com/docs/en/sandboxing)).
  - Credentials such as "git credentials or signing keys are never inside the sandbox" ([engineering post](https://www.anthropic.com/engineering/claude-code-sandboxing)).
  - For Actions: "Grant the workflow only the permissions it needs, and review Claude's changes before merging" ([docs](https://code.claude.com/docs/en/github-actions)).
- **OpenAI:**
  - "By default, the agent runs with network access turned off."
  - In cloud tasks, secrets "are removed before the agent phase starts" ([Codex security](https://developers.openai.com/codex/agent-approvals-security)).
- **Google:** agents "must have well-defined human controllers", "their powers must be carefully limited", and they "must be prevented from escalating their own privileges beyond explicitly pre-authorized scopes", with "secure management of credentials like scoped OAuth tokens" ([Google's approach for secure AI agents, 2025](https://research.google/pubs/an-introduction-to-googles-approach-for-secure-ai-agents/)).
- **GitLab:** composite identity (1.5). An agent's power is the smaller of the person's and the agent account's, and the identity is one-time and auditable.

### 4.3 Frameworks

- **Meta's Rule of Two.** An agent "must satisfy no more than two" of three properties: it handles untrusted input; it has access to sensitive systems or private data; it changes state or communicates externally. If it needs all three, it "should not be permitted to operate autonomously" ([Meta, 31 October 2025](https://ai.meta.com/blog/practical-ai-agent-security/)).
  - A Wheelhouse builder has all three [inference]. It reads issue text and web pages, sees a private repository, and pushes. The merge gate is the supervision.
- **Lethal trifecta.** The same idea: private data, untrusted content and a way to send data out. "The only way to stay safe there is to avoid that lethal trifecta combination entirely" ([Simon Willison, 16 June 2025](https://simonwillison.net/2025/Jun/16/the-lethal-trifecta/)) [secondary].
- **NIST.**
  - The NCCoE draft concept paper on agent identity and authorisation asks the open questions and gives no answers yet: "How do we establish "least privilege" for an agent" and how to handle "on behalf of" delegation ([NCCoE, February 2026](https://www.nccoe.nist.gov/sites/default/files/2026-02/accelerating-the-adoption-of-software-and-ai-agent-identity-and-authorization-concept-paper.pdf)).
  - NIST's evaluation of agent hijacking found that repeated attempts raised attack success "from 57% to 80%" ([NIST CAISI](https://www.nist.gov/news-events/news/2025/01/technical-blog-strengthening-ai-agent-hijacking-evaluations)). Prompt injection can't be counted on to fail.

### 4.4 Incidents that bear on this

- **GitHub MCP, May 2025.** A malicious public issue could "hijack a user's agent", which then copied private repository data into a public pull request. The token reached both kinds of repository. The advice: limit an agent to one repository per session ([Invariant Labs, 26 May 2025](https://invariantlabs.ai/blog/mcp-github-vulnerability)).
- **Nx "s1ngularity", August 2025.** Compromised packages "attempted to use local AI tools (like Claude and Gemini)" to hunt for secrets on developers' computers, and published what they found to GitHub ([Nx postmortem](https://nx.dev/blog/s1ngularity-postmortem)). A token that sits where local agents can reach it is what such malware looks for [inference].
- **PromptPwnd, late 2025.** Issue text placed in an agent's prompt in GitHub Actions led Gemini CLI to post `GITHUB_TOKEN` and other keys into a public issue ([Aikido](https://www.aikido.dev/blog/promptpwnd-github-actions-ai-agents)) [secondary].

---

## 5. What this means for the director's objection

Taken in turn [inference]:

- **"People already have `gh` signed in."** They do, and it is the credential every source says not to hand to an agent. It reaches every private repository they can reach, any program can print it, and it can't be narrowed. Cloud vendors that accept it, such as Claude Code's `/web-setup`, keep it on their own servers, not where the agent runs.
- **"They have connectors."** The connectors' credentials live at claude.ai, not on the computer, which is good. But Wheelhouse can control them only by tool name and input, through permission rules and hooks (check 18). Builders still need git credentials on the computer to push their commits. The GitLab connector does offer commit, merge request and merge tools: they appeared in a local Desktop session's tool list on 18 October 2026, alongside the read tools check 18 found. What the GitHub connector offers wasn't checked [unverified].
- **"A token page raises eyebrows."** The industry answer is an app, not a token. "Sign in with GitHub" by a code on a GitHub page, then "Install on these repositories", is what Claude, Cursor, Amp, Devin and Jules ask for. It is also how `gh` itself signs in.
- **"Per project is annoying."** With an app, a new project means one more repository on the installation. That is one tick on the app's settings page, or done by the helper with the director's admin access, or nothing if the director chooses "All repositories". No new token, no paste.
- **What doesn't change.** No credential type can stop `main` or a merge on a GitHub Free private repository. That still rests on the helper and the sandbox on the Mac. On Windows it rests on the hooks and on the credential being narrow and short-lived.

---

## 6. Options for Wheelhouse

Every option keeps the merge gate, the hooks, and the helper as the program that pushes and merges. They differ in which credential the helper holds and what the director sees.

### Option A: use the login the director already has

**The director sees:** nothing new. Setup checks that `gh` or `glab` is signed in, or runs its sign-in.

**How:** the helper calls `gh` and `glab` with the director's own login. The sandbox denies agents `gh`'s and `glab`'s files and the host's network, as now.

**Protects against:** mistakes, through the gate and the hooks. On the Mac, agents' commands can't reach the host directly.

**Doesn't protect against:**
- An agent reading the token from the keychain (likely, by check 11), then sending it out through an allowed domain or a pull request's text.
- Damage beyond the project: the token reaches every private repository the director can, with full control.

**Windows:** the weakest option. Any agent command can run `gh auth token`, `gh pr merge` or `git push origin main` with the director's full access.

**Guidance:** goes against GitHub's advice, OWASP LLM06 and ASI03, and Anthropic's devcontainer advice.

### Option B: a Wheelhouse GitHub App, signed in with a code (recommended for GitHub)

**The director sees:**
1. A card: "Connect Wheelhouse to GitHub". Setup shows a short code and opens GitHub's device page, where the director types it and clicks **Authorise**. It is the same screen as `gh auth login`.
2. GitHub's **Install** page for the Wheelhouse app, where the director picks the project's repository and the profile repository, or "All repositories".
3. For a later project: the helper adds the repository to the installation itself, using the director's admin rights, or the director ticks it on the app's settings page. Nothing is pasted, ever.

**How:**
- The Wheelhouse project registers one public GitHub App, with device flow on. It asks for Contents, Pull requests, Issues and Metadata, and **not** Workflows or Administration.
- The helper keeps the refresh token in `~/.wheelhouse/` and makes 8-hour access tokens from it, with no client secret needed.
- Pull requests show the director's name "via" the app.
- Signing in again is needed every 6 months, or whenever the refresh token goes unused that long.

**Protects against:**
- Damage beyond the installed repositories.
- Changes to settings, secrets, workflows or administration.
- Long exposure of a leaked access token, which dies within 8 hours.
- The director can see and revoke the app in GitHub's settings, as Google's paper asks.

**Doesn't protect against:**
- An agent that steals the refresh token, which lasts 6 months. On the Mac the sandbox denies its folder (check 11); on Windows nothing does.
- A push to `main` or a merge made with a stolen token on a GitHub Free private repository.

**A side effect:** without the Workflows permission, changes to CI workflows need the director's own login. That is a guard rail in itself, since agents then can't change CI [inference].

**Windows:** better than A or D, though not sealed. A token found there reaches only the installed repositories, can't touch settings or workflows, and expires. The refresh token stays the weak point.

**GitLab:** no equivalent app. Use a fine-grained token (Option D) or `glab`'s sign-in (Option A). GitLab Free can protect `main` on the server, which carries more of the load there.

**Costs:**
- The Wheelhouse project must register and keep a public app. It holds no user tokens, since device flow needs no server.
- The app needs a privacy note.
- The flow needs a live trial, a new check.

### Option C: the director's own GitHub App, made by setup (a bot)

**The director sees:**
1. GitHub's "Create GitHub App" page with the name filled in, and one button.
2. The Install page, as in B.
3. For later projects, the same as B.

**How:**
- Setup sends a manifest. GitHub returns the app's private key, which the helper keeps in `~/.wheelhouse/`.
- The helper makes 1-hour installation tokens, each narrowed to one repository and the needed permissions.
- Pull requests show as the app's bot.

**Protects against:** the same as B, with 1-hour tokens. Because the bot is the author, the director can approve its pull requests. That matters on a plan where GitHub enforces required reviews, and it gives an audit trail of what agents did as against the director.

**Doesn't protect against:** theft of the private key, which never expires and makes tokens for every installed repository. On Windows it is as exposed as B's refresh token, and lasts longer.

**Windows:** like B, but the secret on disk is permanent.

**Costs:**
- One more page and button than B.
- A secret per director.
- If the manifest flow needs a local web page to post the form, the helper serves it on `localhost` [secondary: Probot does this].

### Option D: keep the fine-grained token, with less friction

**The director sees:** as now. A prefilled token page and a paste into the system's own box (checks 14 and 16). They can choose "All repositories" so later projects need nothing; or keep "Only select repositories" and tick each new one, if editing a token in place works [unverified].

**Protects against:** the same scope limits as B. GitHub's longest expiry is 366 days.

**Doesn't protect against:**
- A stolen token, which lasts up to a year.
- With "All repositories", it reaches every repository the director owns.

**Windows:** like C.

**GitLab:** this is the GitLab path in any case, with fine-grained tokens on Free from 19.2.

**Fit with the objection:** poor. This is the step the director dislikes.

### Option E: route the host's API through the claude.ai connectors

**The director sees:** nothing new for the API part, where connectors are already signed in. Setup would still need a git credential for builders' pushes: A, B or D.

**How:** the foreman and builders open and merge pull requests through connector tools. Hooks check each tool call by name and input (PreToolUse), and deny rules keep merge tools behind the gate.

**Protects against:**
- The API credential being on the computer at all. It stays at claude.ai, even on Windows.
- An agent reading or stealing the API credential.

**Doesn't protect against:**
- Misuse through the connector itself. Its scope is the director's own, likely broad [unverified].
- The hooks being the only check on merges, with the text-matching limits of section 3.
- Pushes, which still need a local credential.

**Costs:** it also splits the adapter in two (connector for the API, git for pushes), and depends on connector tools Wheelhouse doesn't control.

### Across the options: layers to add whichever is chosen

- **Masking on the Mac** (1.2). For builders that should run `git push` themselves, Claude Code's `sandbox.credentials` `mask` with `network.tlsTerminate` could hand them a placeholder in place of the token. But it must sit in user or managed settings, not the project's. It is experimental. And it doesn't stop a push to `main`, so the helper should keep doing the pushing [inference].
- **The host's own protection** where it is free: GitLab Free, and public repositories on GitHub Free. On a private GitHub repository, a card can offer GitHub Pro as a level-4 money decision (section 12.3).

---

## 7. Recommendation [inference]

- **On GitHub, Option B.** A Wheelhouse GitHub App, connected with a code like `gh auth login`, with the helper adding new repositories to the installation. It does what the cloud tools do, and what GitHub, OWASP and Google advise: the agent's credential is its own, narrow and short-lived. It removes the token page and the paste, and new projects need no new credential.
- **On GitLab, Option D's fine-grained token for now,** plus GitLab Free's server-side protection of `main`. Revisit if GitLab offers a narrow device-flow sign-in for third-party tools.
- **Keep the helper as the only program that pushes and merges,** as Copilot's platform does. It is the only thing that can refuse `main` on a GitHub Free private repository.
- **Don't adopt Option A.** It is the easiest setup, but it hands agents the broadest credential on the computer, and on Windows it leaves nothing between them and it.
- **Before deciding, run three checks:**
  1. The device flow and Install pages, timed, on a fresh account.
  2. Whether the helper can add a repository to the installation with the director's rights.
  3. Whether a sandboxed agent on the Mac can read `gh`'s keychain item. The answer bears on Option A and on what setup should do with the existing `gh` login.
