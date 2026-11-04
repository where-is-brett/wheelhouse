<!-- docs/specs/2026-11-03-host-access-design.md -->

# Wheelhouse fits around the director's own git setup: host access design (3 November 2026)

Status: approved by the director on 3 November 2026, with the changes folded in below. The build plan is `docs/superpowers/plans/2026-11-03-host-access.md`.

## 1. The problem in plain words

Today Wheelhouse reaches GitHub only through `gh` and GitLab only through `glab`. Setup fetches the tool and signs the director in through it. The helper runs it for every pull request, merge and status read (`scripts/host/adapter.js`, "the only place `gh` and `glab` are called"; `scripts/host/gitlab.js`; `scripts/setup/tools.js`; `scripts/setup/host.js`). Pushes go through git, with the tool as git's only credential helper (`setupGitEnv` in `scripts/setup/git.js`) or with the narrow key in git's environment (`gitHeader` in `scripts/host/connection.js`).

That works on a personal Mac. It fails on a locked-down company laptop like the director's Windows work laptop:

- **`glab` is blocked by company policy.** Setup can't fetch it, and the helper can't run it.
- **The network goes through an NTLM proxy.** The director's git reaches the company GitLab because its settings name the proxy. Wheelhouse's git shuts out the global and system git settings by design (rulings R109 to R112, `isolated` in `scripts/setup/git.js`), so the proxy and the director's credential helper are both lost. Node's own `fetch`, which Wheelhouse already uses for parts of GitLab's REST API (`gitlabApi` in `scripts/host/gitlab-key.js`, `scripts/host/protection.js`, `scripts/host/cut-access.js`), can't sign in to an NTLM proxy at all.
- **The director already has routes that work**, and Wheelhouse ignores them:
  - git over HTTPS through the proxy, for pushes;
  - a GitLab connector in Claude, for reading;
  - GitLab's REST API over `curl`, with the token on `curl`'s standard input, for merges (always with a `sha` guard), approvals and descriptions.

The aim: Wheelhouse uses what the computer already has, and asks the director only what it can't find out.

## 2. Goals and non-goals

**Goals**

- **The default for a project whose git already works is "use my git as it is".**
  - Pushes run with the director's own git setup untouched.
  - Everything else uses `gh` or `glab` where they work, or the host's REST API through `curl`. Its key is borrowed from the computer's own store through git's credential interface, for that one action only.
- **One adapter interface, with two backends per host:** the host's tool when it is installed, allowed and signed in; otherwise REST through the system's `curl`. Both share one error shape and one set of contract tests.
- **The key lives in the computer's own store,** the same place git keeps it. Wheelhouse keeps no copy.
- **A narrow key is an option the director can pick,** with its scope guided per host and its reach said plainly.
- **Approvals on the host,** triggered by the director's card where the host requires them.
- **The locked-down laptop is served first** (the plan marks those parts).

**Non-goals**

- No browser sign-in without a CLI. The REST backend uses a token. A device sign-in through a registered GitLab application is left for later.
- No change to the merge gate, the lock, STOP or the protection rules.
- Git alone is unchanged.

## 3. Every way a computer may reach its host

"Found" means setup reads it without asking.

| What the computer has | How setup finds it | What Wheelhouse does with it |
|---|---|---|
| An HTTPS remote | `git remote get-url origin` (as today) | Names the host and repository (`detectHost`; `parseRemote` in `scripts/host/gitlab-base.js`). Pushes go to it as the director's git would |
| An SSH remote | The same | Pushes go over SSH with the director's own keys and agent, as their git does (section 4.1). The REST key is for the HTTPS address of the same host (section 4.2) |
| A credential manager or helper (Git Credential Manager on Windows, `osxkeychain` on macOS, any helper on Linux) | `git config --get-urlmatch credential.helper <address>` with the director's own settings | Pushes use it untouched. The REST key is borrowed from it (`git credential fill`), and a new key is stored in it (`git credential approve`) |
| A proxy, NTLM included | `git config --get-urlmatch http.proxy <address>` and `http.proxyAuthMethod`, then `HTTPS_PROXY`, `ALL_PROXY` and `NO_PROXY` | Pushes use it untouched. `curl` is given the same proxy (section 9.2) |
| A company certificate | As today, a TLS probe (`probeCertificate` in `scripts/host/company-ca.js`) | Pushes use the director's git as it trusts. `curl` uses the system's own store (section 9.3) |
| A token in a company secret store | Can't be found | The director pastes it once into the computer's hidden box. Setup stores it with `git credential approve`, so pushes and the API share it (section 6) |
| `gh` or `glab`, installed and signed in | `toolPath` (`scripts/lib/host-tools.js`), `<tool> version`, `<tool> auth status --hostname <host>` | The CLI backend for everything but pushes, as today |
| `gh` or `glab` blocked by policy | `<tool> version` won't start, or prints a policy message | The REST backend; setup doesn't try to fetch it |
| No CLI | Neither found, and no fetch possible | The REST backend |
| A connector in Claude | Tool names `mcp__<server>__…` seen in the session | Agents may read through it once the project lists it; Wheelhouse never depends on it (section 10) |
| Single sign-on only | A 401 to every token, and tokens switched off | With `glab` and the company's OAuth application, the CLI's browser sign-in, as today. Without one, said plainly (section 11) |
| No host | `detectHost` gives `local` | Unchanged: local checks and the local adapter (`docs/specs/2026-10-31-local-checks-and-git-alone-design.md`) |

**The four kinds of project**

- **GitHub:** `gh` first, then REST to `api.github.com`.
- **gitlab.com:** `glab` first, then REST.
- **A company GitLab:** named by `gitlabHosts`. `gitlabBase` and `productOf` stay in `gitlab-base.js`, the only file that spells the public address. `glab` first where allowed, else REST through the director's proxy. This is the director's laptop.
- **Git alone:** unchanged.

## 4. The default: "use my git as it is"

### 4.1 Pushes

- **The director's git setup is used untouched for every push.** That means their credential helper, their proxy, their certificate settings and their remote's transport, HTTPS or SSH. Wheelhouse never sees the key for a push.
- **How, given the fence.** A push call drops the fence's two settings that shut out the director's own files (`GIT_CONFIG_GLOBAL=/dev/null` and `GIT_CONFIG_NOSYSTEM=1`). It keeps everything else the fence passes in the environment, which outranks those files:
  - hooks pointed at the null file;
  - `core.sshCommand`, `core.askPass` and `core.editor` set to do nothing, except that an SSH remote keeps the director's own `core.sshCommand` and `GIT_SSH_COMMAND`;
  - `http.sslVerify` on;
  - no signing;
  - `GIT_ALLOW_PROTOCOL` set to `https`, or `https:ssh` for an SSH remote.

  The repository's own config, which an agent could write, is still checked against the allowed list before the call (`refuseUnlistedSettings`), as today. Only the computer's own settings, which are the director's, come in.
- **Unattended pushes never open a window.** Each push runs with `GIT_TERMINAL_PROMPT=0` and `GCM_INTERACTIVE=never`. A push that needs a sign-in fails, and raises the key card (section 6).
- **The gate's checks still hold.** The helper still refuses any push to `main`, any force-push and any push of Wheelhouse's own records (section 11 of the main design). It is the helper that pushes, never an agent.

### 4.2 Everything that isn't a push

Opening, describing, approving and merging requests, and reading pipelines:

- **With `gh` or `glab` installed, allowed and signed in:** the CLI, with its own sign-in, as today.
- **Otherwise, REST through `curl`.** The key is borrowed from the computer's store:
  - The helper runs `git credential fill` for the host's HTTPS address, with the director's own settings, `GIT_TERMINAL_PROMPT=0` and `GCM_INTERACTIVE=never`. Its input is `protocol=https`, `host=<host>` and, where the director's git sets `credential.useHttpPath`, `path=<owner>/<name>.git`.
  - It takes the password from the answer and holds it in memory for that one action: one adapter call, or one merge with its read-back. Then it drops it.
  - The key is never written anywhere else: not a file, an argument, an environment variable, a log or a transcript. `curl` gets it on standard input (section 9.1).
- **The helper never runs `git credential reject`,** since that would delete the director's own key and break their pushes. A refused key raises the key card instead (section 6).

### 4.3 Checking the key can use the API

- **The check.** Setup makes one harmless call with the borrowed key: `GET /user` on GitLab, `GET /user` on GitHub. A 200 means the key can use the API.
- **A key that can only push.** Some keys can push but not use the API, for example Git Credential Manager's GitLab sign-in, whose scopes are for the repository only. A 401 or 403 means setup asks for a key that can (section 6). It stores the new key with `git credential approve`, so pushes and the API share it.
- **It stores the key the director pasted, for the host and their user name.** It replaces only that entry, so the director's other sign-ins are left alone. The card says so: "This replaces the key your git uses for gitlab.example.org with the new one, so your pushes keep working."

### 4.4 What the default can reach

The director's own key reaches everything their account can on that host. The card says so in one line: "Wheelhouse uses the same key your git already uses. It can reach everything your account can on GitLab."

- **On a Mac** the sandbox denies agents the keychain files, the host's network and the helper's memory (check 73; section 12.2 of the main design).
- **On Windows** an agent's command could run `git credential fill` itself, as any program of the director's could; Wheelhouse adds no new copy.
- **A Locked project** still requires a narrow key (section 7), as today.

## 5. Where keys live: the computer's own store

**Every key Wheelhouse uses lives in the computer's own store,** and Wheelhouse keeps no copy:

| System | The store | How Wheelhouse writes and reads it |
|---|---|---|
| Windows | Credential Manager | The director's own key: through git's helper (`git credential fill` and `approve`). A narrow key or app key: the Password Vault, with the secret on standard input (`scripts/secrets/secret-box.js`) |
| macOS | Keychain | The director's own key: through git's helper (`osxkeychain`). A narrow key: `security -i` with the command on standard input, so the secret never appears in a process list (`storeSecretCommand`) |
| Linux | Whatever git's credential helper is | Through git's helper. With none configured, setup asks for the key each time it is needed and holds it in memory only |

- **Writes and reads never put the secret in an argument.** `git credential` reads and writes on standard input. `security -i` takes its commands on standard input. The Windows vault is reached through PowerShell reading standard input.
- **Narrow keys and the GitHub app's keys move out of `~/.wheelhouse/keys/`.** They go to the store under the service `wheelhouse`, with the account `gitlab-project-<id>` or `github-app`. The renewing app keys are rewritten there every 8 hours, on standard input.
- **On a Mac, a project that signs Apple apps opens the keychain to its agents** (`signsApps`, section 12.2 of the main design). Its keys in the keychain are then within agents' reach. The signing question's card says so, and the connection card recommends a narrow key for such a project.
- **This overturns the main design's rule** that nothing of Wheelhouse's is kept in the keychain (check 11), and the earlier decision to keep a typed token in the keys folder. The rule was made before check 73 showed the sandbox can deny agents the keychain files. The new ruling is in section 15.

## 6. A key that is missing, expired or refused

This happens on a new laptop with no key yet, after a key expires, or when a key is refused. The same card covers all three:

1. **Setup opens the host's token page in the browser,** with the name, description, expiry and permissions filled in where the host allows it (section 7.4).
2. **The director makes the token and pastes it into the computer's own hidden box** (`askSecret`, `scripts/secrets/secret-box.js`), never the chat.
3. **Setup checks it** with `GET /user` (and, for a narrow key, a read of the project).
4. **Setup stores it.** The director's own key goes in with `git credential approve`; a narrow key goes in with the store's own command (section 5).

- **The card**, in plain words: "Your GitLab key is missing or has stopped working. A page will open on gitlab.example.org with the key's name and permissions filled in; make it, then paste it into the box your computer shows, never into the chat." The card then gives the key's reach (section 7).
- **The director's secret-store token** is pasted into the box once in the same way. From then on it sits in Credential Manager, where both git and Wheelhouse find it.
- **Expiry.** A narrow key's expiry is known when it is made. The board raises its renewal 14 days ahead (`renewalDue` in `scripts/host/connection.js`). For the director's own key, GitLab's `GET /personal_access_tokens/self` gives the expiry, read once a day. A refusal (401) at any time brings the card at once.

## 7. Narrow keys: an option, with the scope guided per host

The connection card offers **Use my git as it is** (the default where git works) and **A key for this project only**. A Locked project gets the narrow key only. Each choice says in plain words what the key can reach.

### 7.1 GitHub

- **The Wheelhouse app and the director's own app,** as today (section 11 of the main design).
- **A fine-grained personal access token limited to this one repository.** Its permissions:

| Permission | Level | Why | Needed after setup? |
|---|---|---|---|
| Metadata | read | GitHub requires it | yes |
| Contents | read and write | push branches, read files | yes |
| Pull requests | read and write | open, describe, approve, merge | yes |
| Issues | read and write | the alert issue and checklists | yes |
| Commit statuses | read; write only for local checks | read CI; post Wheelhouse's own check where checks run on the computer (`setStatus`) | yes |
| Checks | read | read check runs | yes |
| Administration | read and write | protect the main branch | **only once, at setup** |

- **Administration is left out of the kept key.** Protection is switched on at step 7 with the director's own sign-in (`switchOnAsDirector`), as today. A director who only has the narrow key is asked for a short-lived key with Administration for that one step.
- **The card:** "This key reaches only <owner>/<name>: its code, pull requests and issues. Not your other repositories, and not the repository's settings."

### 7.2 GitLab

- **Preferred: a project access token, which setup makes for the director** with their own key (`makeProjectKey` in `gitlab-key.js`). It has the scopes `api` and `write_repository`, at Developer level: the lowest role that can merge when merge access is "Developers + Maintainers", which step 7's protection sets. With no page and no pasting, it is stored in the computer's store.
  - The card says: "This key reaches only <group>/<name>: its code, merge requests and settings API. It can't change the project's protection."
- **Where the company forbids project keys** (`KEYS_SWITCHED_OFF`), the fallback is a personal access token with `api` and `write_repository` only, and an expiry of 30 days, made on the prefilled page.
  - The card says it plainly: "GitLab won't make a key for one project here, so this is a personal key. It reaches every project your account can, until it expires in 30 days."

### 7.3 Sign-ins through `gh` and `glab`

Where the CLI is there but not signed in, setup offers the same narrow scopes when it asks for a token:

- **`glab`:** a token made on the prefilled page with `api` and `write_repository`, given to `glab auth login --stdin`.
- **`gh`:** a fine-grained token made on the prefilled page, given to `gh auth login --with-token`.

The browser sign-in remains for a director who prefers it, with its wider reach said on the card.

### 7.4 The token pages, prefilled

| Page | Address | What can be filled in |
|---|---|---|
| GitHub fine-grained token | `https://github.com/settings/personal-access-tokens/new` | `name`, `description`, `target_name` (the owner), `expires_in`, and each permission by name (`contents=write`, `pull_requests=write`, `issues=write`, `statuses=read`, `checks=read`, `metadata=read`). GitHub can't preselect the repository, so the description names it and the card says "choose Only select repositories, then <name>". This is how `scripts/host/token-url.js` works today |
| GitLab personal token | `<base>/-/user_settings/personal_access_tokens` | `name` and `scopes` (comma-separated, for example `api,write_repository`), and on recent versions `description`. `tokenUrl` fills `name` and `scopes` today |
| GitLab project token | `<base>/<group>/<name>/-/settings/access_tokens` | Used only when setup can't make the key itself. Prefilled with `name` and `scopes` where the instance accepts them; otherwise the card names what to tick |

*To check before part 8 merges:* each host's current documentation for these query parameters, and the expiry parameter on GitLab's pages, against gitlab.com and a self-managed instance.

## 8. One adapter, two backends

### 8.1 The shape

`adapterFrom` (`scripts/host/adapter.js`) keeps its interface and its argument checks. Beneath it:

```
adapterFrom(commands)                     unchanged
  github + cli  -> githubCommands         scripts/host/github.js (today's)
  github + rest -> githubRest             scripts/host/github-rest.js (new)
  gitlab + cli  -> gitlabCommands         scripts/host/gitlab.js (today's)
  gitlab + rest -> gitlabRest             scripts/host/gitlab-rest.js (new)
  shared: call / read / hostFault -> one error shape (8.4)
```

- **`scripts/host/curl.js`** is the only place `curl` is run.
- **`gitlabApi`** keeps its `get`, `post`, `put` and `delete`, but runs on `curl.js` instead of `fetch`, so setup's repository making, project keys, protection and key revoking pass the proxy too.
- **The audit's history reads** (`gitlab-history.js`) take `ask` and `read`, so they run on either backend.
- **Pushes don't go through either backend.** They are the director's git (section 4.1).

### 8.2 Choosing the backend

- **At setup, step 2 checks each tool in three stages:**
  - present (`toolPath`);
  - allowed (`<tool> version` exits 0 within 10 seconds);
  - signed in to this host (`<tool> auth status --hostname <host>`, with `GITLAB_HOST` for a company GitLab).

  Step 2 offers to fetch a missing tool only where that can work. A refused download, a checksum the proxy rewrote, or a tool that won't start settles on REST with no second question.
- **A missing tool can be left out (4 November 2026).** Step 2 asks, as a choice the director can change under Customise until step 2 has run (`2.host-tool-glab`, `2.host-tool-gh`): "Fetch GitLab's tool" or "Don't use GitLab's tool". With "Don't use", nothing is fetched, the tool is never run even where one is installed, and step 3 records `backend: 'rest'`. The project's committed configuration says the same with `glabFrom: "none"` or `ghFrom: "none"`; that is safe to read from the folder because it can only remove a download. The card recommends "Don't use" when the tool is missing, `curl` is present and git holds a key that passes `GET /user`, and otherwise "Fetch"; a recommendation is taken only by Go ahead on the one card or by the director's answer, never silently. A tool that is already here and starts is not asked about.
- **The choice is kept as `connection.backend`** (`'cli'` or `'rest'`) in the project's record on this computer. It holds no secret.
- **A tool that stops starting switches the project to REST.** A CLI call that fails at the start (`ENOENT`, `EACCES`, or a policy message such as "blocked by group policy") moves the project to REST and records the switch. The board says one calm line: "GitLab's tool stopped working on this computer, so Wheelhouse is using GitLab's web API instead." A signed-out CLI is a sign-in failure, said as today, not a switch.
- **No switching back by itself.** The next setup run, or "check my GitLab connection" in the chat, checks again.

### 8.3 What each GitLab operation calls

`:id` is the URL-encoded project path; `:iid` the merge request's number.

| Adapter method | `glab` today | REST (GitLab API v4) |
|---|---|---|
| `defaultBranch` | `glab api projects/:id` | `GET /projects/:id` |
| `openPr` | `glab mr create … --description-file -` | `POST /projects/:id/merge_requests` `{source_branch, target_branch, title, description}`. The answer carries `iid` and `web_url`; 409 means one is already open for the branch |
| `updatePr` | `glab mr update` | `PUT /projects/:id/merge_requests/:iid` `{title?, description?}` |
| `closePr` | `glab mr close` | `PUT …/merge_requests/:iid` `{state_event: "close"}` |
| `prState` | `glab mr view --output json` | `GET …/merge_requests/:iid` (the same fields) |
| **`approve` (new)** | `glab mr approve <iid> --sha <sha>` | `POST …/merge_requests/:iid/approve` `{sha}` |
| **`approvalsNeeded` (new)** | `glab api …/merge_requests/:iid/approvals` | `GET …/merge_requests/:iid/approvals` (`approvals_left`) |
| `ciState`, `hasCi`, `branchHead`, `previewUrl`, `mergedResults` | `glab api <path>` | The same paths |
| `merge` | `glab mr merge --sha --auto-merge=false --yes`, read back, take back | `PUT …/merge_requests/:iid/merge` `{sha}`, sending no `auto_merge` or `merge_when_pipeline_succeeds` (both default to false). Then `settle` reads the state back, and takes a queued merge back with `POST …/cancel_merge_when_pipeline_succeeds`, as today |
| `openRequests` | `glab mr list --output json` | `GET /projects/:id/merge_requests?state=opened&per_page=100` |
| `requestDetails` | `glab api …/changes`, `…/commits` | `GET …/merge_requests/:iid/diffs?per_page=100` (paged until a short page; `/changes` is deprecated), `…/commits?per_page=50` |
| `issue.create`, `.update`, `.list` | `glab issue …` | `POST /projects/:id/issues`, `PUT …/issues/:iid`, `GET …/issues?labels=…&state=opened&per_page=100` |
| History, setup's `GET /user` | `glab api …` | The same paths |

**GitHub's REST backend** maps `githubCommands` the same way:

- `gh pr create` becomes `POST /repos/:o/:r/pulls`.
- `gh pr merge --match-head-commit` becomes `PUT …/pulls/:n/merge` `{sha}`.
- **`approve`** becomes `POST …/pulls/:n/reviews` `{event: "APPROVE", commit_id}` (with `gh pr review --approve` on the CLI backend).
- `gh api graphql`'s queries are sent to `POST /graphql` with the same text.

**The approve operation.**

- **When it runs.** Only when the host requires approvals: GitLab's `approvals_left` above 0, or GitHub's branch rule requiring reviews (`requiredChecks` already reads the rules). It runs only on the director's approval card for that request, at the head the card names (the `sha` guard), and with the director's own key.
- **Approving with your own key.** Both hosts can refuse an author's approval of their own request: always on GitHub; on GitLab when "Prevent approval by author" is set. With "use my git as it is", the director's key also opened the request, so a refusal is likely there. The card then says: "GitLab doesn't let the author approve their own merge request here. Ask a colleague to approve it, or choose a project-only key, so that Wheelhouse opens requests and you approve them." With a narrow key or the app opening requests, the director's own key approves cleanly.

### 8.4 One error shape for both backends

- **Reads** give `{ status, body }`: the HTTP status straight from `curl`, or from `glab`'s "(HTTP nnn)" as today.
- **A host that can't be reached** gives `HOST_UNREACHABLE`, and **a certificate not trusted** gives `CERTIFICATE_NOT_TRUSTED` (`hostFailure` in `company-ca.js`). For `curl` these come from its exit code:
  - unreachable: 5, 6, 7, 28, 52 and 56. Exit 28 is a timeout, so a merge that hits it is "could not be confirmed".
  - certificate: 35 with a certificate message, 60 and 77.
- **A proxy that refuses the sign-in** gives the new `PROXY_REFUSED`, when `%{http_connect}` is 407. It is said as "Your company's proxy didn't accept this computer's sign-in, so GitLab couldn't be reached. Work carries on here and is sent when it can be."
- **A refused merge** is read by status first, then by GitLab's `message` through `refusalOf`:
  - 409: the head of the pull request has moved since it was checked.
  - 406 or 422: the pull request has a merge conflict.
  - 405 with a pipeline or approval message: the host's required checks have not passed, or the host needs an approving review.
  - 405 otherwise: not merged.
  - 401: the key card (section 6).
  - 403: this sign-in is not allowed to merge it.
- **A refused approval:**
  - 401: the key card.
  - 403 or "author": the self-approval line above.
  - 409: the head has moved.
- **`scrub`** (`adapter.js`) runs on everything passed into an error, with the borrowed key added to the values it hides.

### 8.5 Keeping the two backends from drifting apart

- **Shared contract tests.** One list of cases (`tests/scripts/host/contract/gitlab-cases.js`), each a method call, the host's answer and the expected adapter value or error. Every case runs over a fake `glab` (today's recordings in `tests/fixtures/host/gitlab/`) and over a fake `curl` (REST JSON in `tests/fixtures/host/gitlab-rest/`). The same for GitHub.
- **A method-list test** fails when a backend lacks one of `adapterFrom`'s methods.
- **Most recordings serve both fakes:** `glab api` passes GitLab's JSON through.
- **The cost.** About 650 new lines of backend code, and about 80 contract cases each run twice. Every later host operation is written twice and recorded twice. In return, a computer without the tools works, and a tool broken by a release can be routed round.

## 9. `curl`, the proxy and certificates

### 9.1 How `curl` is run

- **By full path only:**
  - macOS: `/usr/bin/curl`;
  - Windows: `%SystemRoot%\System32\curl.exe` (in Windows 10 since 1803, and in Windows 11), else the `curl.exe` beside the git that step 2 found;
  - Linux: `/usr/bin/curl`.
- **The command line is only** `-q --config - --silent --show-error --write-out <marker>`. The `-q` comes first, so no `.curlrc` or `_curlrc` is read.
- **Everything else goes on standard input as a `curl` config,** quoted with `curl`'s own escapes: the address, method, headers (`PRIVATE-TOKEN` for GitLab tokens, `Authorization: Bearer` for GitHub), body, proxy and limits. The key and the project's path never appear in a process list.
- **`curl`'s own proxy and certificate variables are removed from its environment:** `*_PROXY`, `CURL_CA_BUNDLE`, `SSL_CERT_FILE` and `CURL_SSL_BACKEND`.
- **Limits:**
  - connect 20 seconds;
  - 120 seconds in all, or 300 for a merge;
  - a body of at most 1 MB;
  - an answer of at most 10 MB.

### 9.2 The proxy

- **One source: the director's git.** At each helper start the helper reads, for the host's address, `git config --get-urlmatch` for `http.proxy` and `http.proxyAuthMethod`. With none set, it uses `HTTPS_PROXY`, `ALL_PROXY` and `NO_PROXY`.
- **How it is passed to `curl`:**
  - `proxy`;
  - `ntlm` becomes `--proxy-ntlm`, `negotiate` becomes `--proxy-negotiate`, and anything else becomes `--proxy-anyauth`;
  - `proxy-user = ":"` when the address names no user, so `curl` signs in as the Windows user (SSPI) or with the Mac's Kerberos ticket.
- **A proxy address holding a password is not copied to `curl`.** The card says: "Your git settings keep your proxy password in plain text. Wheelhouse won't copy it. Ask IT whether your proxy accepts your Windows sign-in instead; it usually does." Pushes still use the director's git as it is.

### 9.3 Certificates

- **Windows.** `curl.exe` uses Schannel, which trusts the computer's own store, where company policy puts the company's authority. No certificate file is needed for `curl`.
- **A blocked revocation check.** If `curl` fails with exit 35 and `CRYPT_E_NO_REVOCATION_CHECK`, the helper tries once more with `--ssl-revoke-best-effort`. That still refuses a certificate known to be withdrawn, and is stronger than git's own fallback (`revocationFallback`), which checks no revocation at all.
- **macOS.** `/usr/bin/curl` uses Apple's TLS, which trusts the System keychain. On exit 60, where setup made the file (`caFile`, which holds every system authority), the helper retries once with `--cacert`.
- **`--insecure` and `-k` are never passed.** A test greps for them.
- **Pushes need nothing from Wheelhouse here:** the director's git trusts what it trusts. `company-ca.js` keeps git's per-address setting only for Wheelhouse's own fenced git, and `glabCaArgs` for the CLI backend. Node's `NODE_EXTRA_CA_CERTS` goes once no GitLab call uses `fetch`.
- **To confirm at the first Windows sitting:** one REST read and one merge through `curl.exe` and the NTLM proxy, with no certificate file.

## 10. Agents reading through a connector

- **Agents may use the connector only when `mcpServers`** in `.claude/wheelhouse.json` names its server (`allowedServers` in `scripts/hooks/tool-guard.js`).
- **The front desk offers it once, as a card,** when it sees a GitLab or GitHub connector: "Let agents read GitLab through your connector?" For a product with real users, **Not now** is recommended, since the connector reads with the director's whole account. A yes goes through the usual approval, since the configuration is a guardrail.
- **Wheelhouse never depends on it.** Every read the gate, the board or the survey needs goes through the helper.
- **A connector's write tools come with it** (`mcpServers` lists servers, not tools), and the card says so. Merges still count only through the helper.

## 11. What a director on a locked-down laptop will hit

- **No usable `curl`, and no CLI:** "This computer has no curl Wheelhouse can use, so it can only reach GitLab through GitLab's own tool. Ask IT for either." Pushes still work, and git alone still works.
- **A proxy that wants a password typed:** not supported for `curl` (section 9.2).
- **A key that expires or is refused:** the key card (section 6).
- **A key that can push but can't use the API:** section 4.3.
- **Single sign-on only, with tokens switched off and no OAuth application for `glab`:** "Your company's GitLab allows sign-in only through the company's sign-in page, and Wheelhouse needs a token or GitLab's own tool for that. Ask your GitLab admin for either." Setup then offers git alone.
- **Off the company network:** `HOST_UNREACHABLE`, as today.
- **A tool blocked tomorrow:** section 8.2.

## 12. Setup: find first, ask last

1. **Step 2 finds:**
   - git, Node.js and `curl`, by full path;
   - `gh` or `glab`, in three stages;
   - the proxy;
   - whether the certificate is trusted.
2. **Step 3 finds:**
   - the remote and its transport;
   - the director's credential helper;
   - whether `git ls-remote <remote>` works with the director's git as it is (no prompt, no window);
   - whether `git credential fill` gives a key, and whether that key passes `GET /user`.
3. **Step 3 asks:**
   - **nothing** when the director's git reaches the host and the key passes, or the CLI is signed in. The one recommended card (section 15.1 of the main design) then says, for example: "Use your git as it is: pushes as you do them, and the same key for merge requests";
   - **the key card** (section 6) when there is no key, or it can only push;
   - **the narrow choice** under **Customise**, or as the only choice for a Locked project.
4. **The Go-ahead card names the route in plain words,** for example: "Wheelhouse will push with your own git, and reach GitLab's web API through your company's proxy with the same key." It never says "REST" or "curl".

## 13. What stays and what changes

**Stays**

- The adapter's interface and its callers.
- `gh` and `glab` as the first backend, fetched where allowed (`glabFrom` included).
- The Wheelhouse app, the director's own app, project keys, protection, the gate, STOP and the lock.
- `gitlabHosts`, and `gitlab-base.js` as the only file that spells the public address.
- The fence for every git call except pushes and `git credential`.
- The deny rules for agents (`Bash(gh:*)`, `Bash(glab:*)`, `Bash(git push:*)`, `HOST_TOKENS`, `scripts/lib/credentials.js`).
- Git alone.

**Changes**

- **The default connection** is "use my git as it is". Its record gains `connection.mode: 'as-is'` beside `quick` and `narrow`, and `connection.backend`.
- **Pushes** use the director's git settings (section 4.1). The narrow key and the app's key still reach git through the helper, as today.
- **New modules:**
  - `scripts/host/curl.js`;
  - `gitlab-rest.js` and `github-rest.js`;
  - `scripts/host/store.js`, which runs `git credential fill` and `approve` and the store's own commands;
  - `scripts/host/proxy.js`.
- **Keys move** from `~/.wheelhouse/keys/` to the computer's store (section 5).
- **New adapter operations:** `approve` and `approvalsNeeded`.
- **`gitlabApi` and `probeCertificate`** run on `curl.js`.
- **`tokenUrl`** fills each page with the narrow scopes (section 7.4).

## 14. Migration of projects already set up

- **Projects on `quick` with `gh` or `glab`** keep them, recorded as `backend: 'cli'` at the first helper start, with no card. Their pushes move to the director's git as it is only when the director runs setup's step 3 again.
- **Narrow projects** keep their key. At the first helper start the key moves from `~/.wheelhouse/keys/` into the computer's store, is read back, and only then is the file deleted. A move that fails leaves the file and tries again next start.
- **A pasted GitLab token** (`kind: 'pasted-token'`) moves the same way.
- **The GitHub app's keys** move the same way, and are renewed in the store from then on.
- **A fetched `glab` or `gh`** stays in `~/.wheelhouse/tools/` until uninstall, as today.

## 15. Rulings to add to the main design

**Section 11, replacing its opening paragraphs:**

> **Wheelhouse fits around the director's own git setup.** Where the director's git already reaches the host, the default is to use it as it is: pushes run with the director's own credential helper, proxy and certificate, and Wheelhouse never sees the key for a push. Everything else goes through the adapter, which has two backends per host: the host's tool (`gh` or `glab`) where it is installed, allowed and signed in; otherwise the host's REST API through the system's `curl`, with the key borrowed from the computer's own store through `git credential fill` for that one action, and passed on `curl`'s standard input. Setup checks the key can use the API, and where it can only push, asks for one that can and stores it with `git credential approve`, so pushes and the API share it. A key for one project only is an option, required by Locked, with its scope guided per host. Both backends answer in one shape, held together by shared contract tests (`docs/specs/2026-11-03-host-access-design.md`).

**Section 12.2, replacing the keychain sentence ("Nothing of Wheelhouse's is kept in the keychain all the same (check 11)"):**

> Wheelhouse keeps its keys in the computer's own store, the same place git keeps the director's: Credential Manager on Windows, the Keychain on macOS, and on Linux whatever git's credential helper is (with none, the key is asked for when needed and held in memory). It keeps no copy elsewhere, and every write and read passes the secret on standard input. On a Mac the sandbox denies agents the keychain files (check 73), except in a project that signs Apple apps, whose card says its keys are then within agents' reach and recommends a key for that project only. On Windows nothing stops an agent's command from reading the store, as with any program of the director's (check 10).

**Section 22, a new row:**

> | How Wheelhouse reaches the host, and where its keys live | Decided 3 November 2026, from the director's Windows work laptop (no `glab`, a company GitLab behind an NTLM proxy, a token in a company secret store): "use my git as it is" is the default where git works, with pushes untouched; everything else uses `gh` or `glab` where they work, else the REST API through `curl` with the key borrowed through `git credential fill` for one action. Keys live in the computer's own store, never in a copy of Wheelhouse's, which overturns the earlier keychain rule. A missing or refused key brings one card: the host's token page, prefilled, and the computer's own hidden box. A key for one project is an option with its scope guided per host, and each card says what the key reaches. Wheelhouse approves on the host when the host requires it, on the director's card. Agents may read through the director's connector once the project lists it, offered once with Not now recommended for products with real users |

## 16. Risks

- **Two backends cost upkeep** (section 8.5).
- **Pushes let the director's global and system git settings in.** That includes anything else there, such as an `include` or a hook path. The fence's settings given in the environment outrank those files, and the repository's own config is still checked. On a Mac agents can't write those files. On Windows they could, as they could write anything else of the director's.
- **The borrowed key is in the helper's memory during one action.** On Windows an agent could ask git's helper for the same key directly. Accepted, and said on the card.
- **Self-approval refused by the host** (section 8.3). Said plainly, with the project-only key as the way round.
- **Untried live:**
  - `curl.exe` through an NTLM proxy with SSPI;
  - Schannel trusting a company authority;
  - `--ssl-revoke-best-effort` on a blocked network;
  - `git credential fill` with Git Credential Manager and `GCM_INTERACTIVE=never`;
  - the prefill parameters of each token page.

  Each is a check at the first Windows sitting.

## 17. Decisions

**Decided by the director on 3 November 2026**

1. Keep both routes, the tool first and REST second.
2. "Use my git as it is" is the default where git works. A project-only key is an option.
3. Keys live in the computer's own store, and Wheelhouse keeps no copy.
4. A missing or refused key brings one card: the prefilled token page and the computer's hidden box.
5. Narrow keys have their scope guided per host, and each card says what the key reaches.
6. Approve on the host, on the director's card, where the host requires approvals.
7. Offer the connector once, with **Not now** recommended for products with real users.
8. Build the laptop's parts first.

**Still open, with a recommendation**

- **A command that prints the key** (the company's secret-store tool), run by the helper each time instead of a copy in Credential Manager. Recommended: **not now**. The director pastes the token into the box once; add the command only if a company forbids keeping the token in Credential Manager.
- **A personal token's expiry in the GitLab fallback.** Recommended: **30 days**, renewed by the key card.

## Sources

- Code: `scripts/host/adapter.js`, `gitlab.js`, `github.js`, `connection.js`, `gitlab-key.js`, `gitlab-base.js`, `gitlab-history.js`, `company-ca.js`, `protection.js`, `cut-access.js`, `token-url.js`, `keys.js`, `helper.js`; `scripts/setup/host.js`, `tools.js`, `git.js`; `scripts/lib/safe-git.js`, `host-tools.js`, `credentials.js`; `scripts/secrets/secret-box.js`; `scripts/hooks/tool-guard.js`; `scripts/protection/settings.js`.
- Design: `docs/specs/2026-10-17-wheelhouse-design.md`, sections 11, 12.2, 15 and 22; checks 5, 10, 11, 20, 22, 23, 38, 71 and 73.
- GitLab REST API v4 documentation: merge requests (merge answers 405, 406, 409, 422; approve), personal and project access tokens, the token pages' prefill parameters.
- GitHub REST documentation: pulls, reviews, fine-grained token permissions and the new-token page's parameters.
- git's documentation: `git credential` (`fill`, `approve`, `reject`), `credential.useHttpPath`, `http.proxy`, `http.proxyAuthMethod`.
- `curl`'s manual: `--config`, `-q`, `--proxy-ntlm`, `--proxy-user`, `--ssl-revoke-best-effort`, `--write-out`.
