<!-- docs/specs/2026-11-03-host-access-design.md -->

# Wheelhouse fits around the director's own git setup: host access design (3 November 2026)

Status: proposed, for the director's approval. The build plan is `docs/superpowers/plans/2026-11-03-host-access.md`.

## 1. The problem in plain words

Today Wheelhouse reaches GitHub only through `gh` and GitLab only through `glab`. Setup fetches the tool, signs the director in through it, and the helper runs it for every pull request, merge and status read (`scripts/host/adapter.js`, "the only place `gh` and `glab` are called"; `scripts/host/gitlab.js`; `scripts/setup/tools.js`; `scripts/setup/host.js`). Pushes go through git with the tool as git's only credential helper (`setupGitEnv` in `scripts/setup/git.js`), or with the narrow key in git's environment (`gitHeader` in `scripts/host/connection.js`).

That works on a personal Mac. It fails on a locked-down company laptop like the director's Windows work laptop:

- **`glab` is blocked by company policy.** Setup can't fetch it, and the helper can't run it.
- **The network goes through an NTLM proxy.** git reaches the company GitLab because the director's git settings name the proxy. Setup's and the helper's git shut out the global and system git settings by design (rulings R109 to R112, `isolated` in `scripts/setup/git.js`), so the proxy is lost. Node's own `fetch`, which Wheelhouse uses for GitLab's REST API today (`gitlabApi` in `scripts/host/gitlab-key.js`, protection in `scripts/host/protection.js`, key revoking in `scripts/host/cut-access.js`), can't sign in to an NTLM proxy at all.
- **The director already has working routes**, and Wheelhouse ignores them:
  1. git over HTTPS through the proxy for pushes, opening merge requests with push options;
  2. a GitLab connector in Claude for reading (merge request status, diffs, pipelines, jobs, notes, issues, search);
  3. GitLab's REST API over `curl` for merging (always with a `sha` guard), approving and descriptions, with a personal access token fetched from the company's secret store and piped into `curl`'s standard input, so it never appears in a command line or a transcript.

The aim: Wheelhouse uses what the computer already has, in the order that works best, and asks the director only what it can't find out.

## 2. Goals and non-goals

**Goals**

- One adapter interface with two backends per host: the host's own tool (`gh` or `glab`) when it is installed, allowed and signed in; otherwise GitHub's or GitLab's REST API through the system's `curl`.
- The director's proxy, company certificate, token store and remote are found and reused, not replaced.
- The key never reaches agents by any route Wheelhouse controls: not an argument, not an environment variable, not a file inside the project, not a line in a transcript.
- A computer that worked yesterday keeps working: projects set up with `gh` or `glab` keep them.
- The director's locked-down laptop is served first (the build plan marks those parts).

**Non-goals**

- Wheelhouse doesn't approve merge requests on the host. Its approval is the director's card (section 12.3 of the main design). Where a project's rules need a host approval, the director clicks it on the host's page, as today (the refusal phrase "the host needs an approving review").
- No browser sign-in without a CLI. The REST backend signs in with a token. A GitLab device sign-in through a registered application is left for later (section 10).
- No SSH for the helper. The helper reaches the host over HTTPS whatever the director's own remote is (section 4.1).
- No change to the merge gate, the lock, STOP or the protection rules.

## 3. Every way a computer may reach its host

The table lists what a director's computer may already have, and what Wheelhouse does with each. "Found" means setup reads it without asking.

| What the computer has | How setup finds it | What Wheelhouse does with it |
|---|---|---|
| An HTTPS remote | `git remote get-url origin` in the folder (as today) | The address names the host and the repository (`detectHost`, `parseRemote` in `scripts/host/gitlab-base.js`) |
| An SSH remote (`git@host:owner/name.git`) | The same | The host and repository are read from it; the helper pushes to the HTTPS address of the same repository (`httpsRemote` in `scripts/setup/host.js`). The director's remote and SSH keys are left alone |
| A credential manager or helper (Git Credential Manager, macOS keychain helper) | `git config --get-urlmatch credential.helper <address>` with the director's own settings, read only | Noted, not used (section 6.2). It tells setup the director has signed in with git before, which shapes the token card's wording |
| A proxy, including NTLM | `git config --get-urlmatch http.proxy <address>` and `http.proxyAuthMethod`, then `HTTPS_PROXY`, `https_proxy`, `ALL_PROXY` and `NO_PROXY` | Given to the helper's git and `curl` for that host, read fresh each time the helper starts (section 7) |
| A company certificate | As today: a TLS probe of the host (`probeCertificate` in `scripts/host/company-ca.js`) | git as today. `curl` uses the system's own store on both systems; the copied file is a fallback on the Mac only (section 8) |
| A token in a company secret store | Can't be found: setup asks for the command that prints it | The helper runs that command when it needs the token, and holds the token in memory only (section 5) |
| `gh` or `glab`, installed and signed in | `toolPath` (`scripts/lib/host-tools.js`), then `<tool> version`, then `<tool> auth status --hostname <host>` | The CLI backend, as today |
| `gh` or `glab` blocked by policy | `<tool> version` fails to start (spawn error, or a policy message and a non-zero exit) | The REST backend; setup doesn't try to fetch it |
| No CLI at all | Neither found, and the fetch refused or declined | The REST backend |
| A connector in Claude (GitLab, GitHub) | Claude Code's tool names (`mcp__<server>__…`) seen in the session; the director can also name it | Agents may read through it when the project lists it; Wheelhouse never depends on it (section 9) |
| Single sign-on only | GitLab answers 401 to a token and the token page says tokens are switched off, or the company says so | With `glab` and the company's OAuth application: the CLI's browser sign-in, as today. Without: Wheelhouse can't reach the host, and says so plainly (section 10) |
| No host (git alone) | No GitHub or GitLab remote (`detectHost` gives `local`) | Unchanged: local checks and the local adapter (`docs/specs/2026-10-31-local-checks-and-git-alone-design.md`). No token, no `curl`, nothing asked |

### 3.1 The four kinds of project

- **GitHub.** `gh` first, then REST through `curl` to `api.github.com`. Quick uses `gh`'s sign-in or a token; narrow uses the Wheelhouse app or the director's own app, as today. The app's keys are already tokens the helper holds (`githubAccessKey` in `scripts/host/connection.js`), so the REST backend needs nothing new for narrow.
- **gitlab.com.** `glab` first, then REST through `curl`. Quick uses `glab`'s sign-in or the director's token; narrow uses a project key, as today.
- **A company GitLab** (named by `gitlabHosts`; `gitlabBase` and `productOf` stay in `scripts/host/gitlab-base.js`, the only file that spells the public address). `glab` first where allowed, else REST through `curl`, through the director's proxy, with the company certificate handled as in section 8. This is the director's laptop.
- **Git alone.** Unchanged.

## 4. One adapter, two backends

### 4.1 The shape

`makeAdapter` (`scripts/host/adapter.js`) keeps its interface: `adapterFrom` checks every argument and returns the same methods for every host. What changes is beneath it:

```
adapterFrom(commands)                      unchanged: checks arguments, same methods
  commands = backendFor(host, kind)(tools)
    github + cli   -> githubCommands       scripts/host/github.js (today's)
    github + rest  -> githubRest           scripts/host/github-rest.js (new)
    gitlab + cli   -> gitlabCommands       scripts/host/gitlab.js (today's)
    gitlab + rest  -> gitlabRest           scripts/host/gitlab-rest.js (new)
  tools.call / tools.read / tools.hostFault: one shared error shape (4.4)
```

- **The REST transport** is one new module, `scripts/host/curl.js`: `request({ base, method, path, body, token, proxy, certificate })` gives `{ status, body, headers }` or throws a host failure. It is the only place `curl` is run.
- **`gitlabApi`** (`scripts/host/gitlab-key.js`) keeps its `get`, `post`, `put`, `delete`, but its transport becomes `curl.js` instead of `fetch`. Setup's repository making, project keys, protection and key revoking then pass the proxy too, with no change to their callers. The audit's history reads (`scripts/host/gitlab-history.js`) already take `ask` and `read`, so they run on either backend.
- **The CLI backend stays the default where it works,** because it is what every live trial so far used (checks 5, 22, 23, 71), and because a director who already uses `gh` or `glab` expects Wheelhouse to act as they do.

### 4.2 Choosing the backend

- **At setup, step 2** checks each tool in three stages: present (`toolPath`), allowed (`<tool> version` exits 0 within 10 seconds), signed in to this host (`<tool> auth status --hostname <host>`, with `GITLAB_HOST` for a company GitLab, as today). Step 2 offers to fetch a missing tool as today, but only where it isn't blocked: a refused download, a checksum the company's proxy rewrote, or a tool that won't start after fetching, settles on REST with no second question.
- **The choice is kept** in the project's record on this computer as `connection.backend`: `'cli'` or `'rest'`. It holds no secret.
- **Re-checked when a call fails for want of the tool.** A CLI call that can't start (`ENOENT`, `EACCES`, a policy message such as "This program is blocked by group policy" or "operation not permitted" at spawn) switches that project to REST for the rest of the helper's life, when a token source is set (section 5). The switch is written to the record, and the board says one calm line: "GitLab's tool stopped working on this computer, so Wheelhouse is using GitLab's web API instead." With no token source, the call fails and the board raises a card to set one up. A CLI that runs but is signed out is not "want of the tool": it is a sign-in failure, said as today.
- **No switching back by itself.** The next setup run, or the director's "check my GitLab connection" in the chat, runs step 2's check again.

### 4.3 What each GitLab operation calls

Every `glab` call in `scripts/host/gitlab.js` has a REST call that does the same. `:id` is the URL-encoded project path; `:iid` the merge request's number.

| Adapter method | `glab` today | REST (GitLab API v4) |
|---|---|---|
| `defaultBranch` | `glab api projects/:id` | `GET /projects/:id` |
| `openPr` | `glab mr create --source-branch --target-branch --title --description-file - --yes` | `POST /projects/:id/merge_requests` `{source_branch, target_branch, title, description}`; `iid` and `web_url` come in the answer, so `fromAddress` isn't needed |
| `updatePr` | `glab mr update --title --description-file -` | `PUT /projects/:id/merge_requests/:iid` `{title?, description?}` |
| `closePr` | `glab mr close` | `PUT /projects/:id/merge_requests/:iid` `{state_event: "close"}` |
| `prState` | `glab mr view --output json` | `GET /projects/:id/merge_requests/:iid` (same fields: `sha`, `title`, `source_branch`, `target_branch`, `detailed_merge_status`, `state`, `description`) |
| `ciState`, `hasCi` | `glab api …/pipelines?sha=…`, `…/repository/files/.gitlab-ci.yml?ref=…` | The same paths, unchanged |
| `mergedResults` (inside `ciState`) | `glab api` on commits, merge requests and their pipelines | The same paths |
| `branchHead` | `glab api …/repository/branches/:branch` | The same path |
| `previewUrl` | `glab api …/deployments?status=success…` | The same path |
| `merge` | `glab mr merge --sha --auto-merge=false --yes`, read back, take back | `PUT /projects/:id/merge_requests/:iid/merge` `{sha}`, with no `merge_when_pipeline_succeeds` or `auto_merge` (both default to false, so the merge is made now or refused); then `settle` reads the state back and takes a queued merge back with `POST …/cancel_merge_when_pipeline_succeeds`, as today |
| `openRequests` | `glab mr list --per-page 100 --output json` | `GET /projects/:id/merge_requests?state=opened&per_page=100` |
| `requestDetails` | `glab api …/changes`, `…/commits` | `GET …/merge_requests/:iid/diffs?per_page=100` (paged until a short page; `/changes` is deprecated) and `…/commits?per_page=50` |
| `issue.create` | `glab issue create --title --label --description-file -` | `POST /projects/:id/issues` `{title, description, labels: "a,b"}` |
| `issue.update` | `glab issue update --description-file -` | `PUT /projects/:id/issues/:iid` `{description}` |
| `issue.list` | `glab issue list --label --per-page 100 --output json` | `GET /projects/:id/issues?labels=…&state=opened&per_page=100` |
| History (`gitlab-history.js`) | `glab api …` | The same paths |
| `setStatus`, `checkContexts`, `requiredChecks`, `verdictComment`, `login` | No call (GitLab runs its checks on the host) | Unchanged |
| Setup: who is signed in | `glab api user` (`whoAmI`, and `project-files.js` for the commit email) | `GET /user` |

GitHub's REST backend (`github-rest.js`) maps `githubCommands` the same way: `gh pr create` to `POST /repos/:o/:r/pulls`, `gh pr merge --match-head-commit` to `PUT /repos/:o/:r/pulls/:n/merge` `{sha}`, and the GraphQL queries `gh api graphql` runs today (`CI_QUERY`, `CONTEXTS_QUERY`) to `POST /graphql` with the same text. It isn't needed for the director's laptop and comes later in the build plan.

### 4.4 One error shape for both backends

Both backends answer through the same three helpers the adapter already passes down (`call`, `read`, `hostFault`), so callers see one shape whatever ran.

- **Reads** give `{ status, body }`: the HTTP status from `curl` directly, or from `glab`'s "(HTTP nnn)" as today (`read` in `adapter.js`).
- **A host that can't be reached** and **a certificate not trusted** throw the same errors with the same codes (`HOST_UNREACHABLE`, `CERTIFICATE_NOT_TRUSTED`, from `hostFailure` in `company-ca.js`). For `curl` they come from its exit code, not its words: 5, 6, 7, 28 (timed out, so "could not be confirmed" for a merge), 52 and 56 are unreachable; 35 with a revocation message, 60 and 77 are certificate. `curl --write-out` gives `%{http_code}` and `%{http_connect}`.
- **A proxy that refuses the sign-in** is new: `%{http_connect}` is 407. It is said as "Your company's proxy didn't accept this computer's sign-in, so GitLab couldn't be reached. Work carries on here and is sent when it can be." with the code `PROXY_REFUSED`, treated like unreachable by the board.
- **A refused merge** goes through `refusalOf` as today, which reads phrases. For REST, the status is read first, then GitLab's `message` for the same phrases:

| GitLab's answer to the merge | The adapter's reason |
|---|---|
| 409 ("SHA does not match HEAD of source branch") | the head of the pull request has moved since it was checked |
| 406 or 422 ("Branch cannot be merged") | the pull request has a merge conflict |
| 405 with a pipeline or approval message | the host's required checks have not passed, or the host needs an approving review |
| 405 otherwise (draft, closed) | GitLab did not merge the merge request |
| 401 | the sign-in has expired or was refused (a card: section 10) |
| 403 | this sign-in is not allowed to merge it |

- **Scrubbing** (`scrub` in `adapter.js`) runs on everything either backend passes into an error, with the token added to its list of values to hide.

### 4.5 Keeping two backends from drifting apart

- **Shared contract tests.** One list of cases, `tests/scripts/host/contract/gitlab-cases.js`, each a method call, the host's answer and the adapter value expected. `contract-gitlab.test.js` runs every case twice: once over a fake `glab` that answers from today's recorded output (`tests/fixtures/host/gitlab/`), once over a fake `curl` that answers from recorded REST JSON (`tests/fixtures/host/gitlab-rest/`). Both must give the same value or the same error. The same for GitHub.
- **A method list test.** A test enumerates `adapterFrom`'s methods and fails when a backend lacks one, so a new operation can't land in one backend only.
- **One recording per case.** `glab`'s JSON is GitLab's REST answer passed through, so for most reads one fixture serves both fakes; only the command-line ones (`mr create`'s printed address, `mr merge`'s refusal text) need their own.
- **The cost, said plainly.** About 600 new lines of backend code (two REST modules and `curl.js`), and about 40 contract cases for GitLab and 35 for GitHub, each run twice. Every later host operation is written twice and recorded twice. Every `glab` or `gh` release can still change its output, as today; the REST API is versioned and changes less. In return a computer without the tools works, and a tool that breaks on a release can be routed round by switching the backend.

## 5. Where the token comes from

The CLI backend uses the CLI's own sign-in, as today. The REST backend needs a token. Setup offers three sources on one card, and says what each can reach.

| Source | What the director does | What the token can reach if an agent got it | Where it lives |
|---|---|---|---|
| **(a) Use my existing token:** a command the director names (their company's secret-store tool) | Types the command once on the card ("company-secrets get gitlab-token", say), sees the GitLab name it found, clicks Confirm | Whatever that token reaches: usually everything the director's account can, on that GitLab | Nowhere on disk. The helper runs the command when it needs the token and holds the answer in memory |
| **(b) A token typed into this computer's box** | Opens GitLab's token page (filled in by `tokenUrl`, `scripts/host/token-url.js`), makes a token, pastes it into the system's hidden box | Everything the director's account can, on that GitLab | `~/.wheelhouse/keys/`, as the narrow keys are |
| **(c) Narrow: a project key** | Nothing more where the company allows it; setup makes it with (a), (b) or the CLI's sign-in, once | Only this project: its code, merge requests and settings API, at Developer level (section 11 of the main design) | `~/.wheelhouse/keys/`, as today |

- **On Windows there is no sandbox** (check 10). An agent's command could run the same secret-store command, or read the keys folder, just as the director's own scripts can. Wheelhouse adds no new copy of the token, and (c) limits what a leak reaches. The card says it in one line: "On Windows, an agent's command could reach this token too; a project key limits that to this project."
- **On the Mac** the sandbox denies agents the keys folder, the keychain files and the host's network (section 12.2 of the main design), and the secret-store command runs only in the helper.
- **The command is a setting of this computer, never of the project.** It runs outside the sandbox, so a command an agent could write would be a way out. It is kept in this computer's settings (`~/.wheelhouse/settings/`, as `gitlab-token-command` per host), and counts only once the director's click confirms it, the way `own-github-app` does (`scripts/setup/own-app.js`, ruling R56). It is run without a shell, as a program and its arguments, with 60 seconds to answer. A `.cmd` or `.bat` file on Windows is run through `cmd.exe /d /s /c` with the arguments quoted by Node's own rules. Its first line, trimmed, must look like a token (20 to 255 characters, no spaces), or it is refused, and its output is never shown or logged.
- **How long the helper keeps it.** From the first call that needs it until GitLab answers 401, or for 8 hours, whichever comes first; then it runs the command again. A secret-store tool that asks for a sign-in of its own (its own window) is left to show it; a command that waits on the terminal for input gets an empty standard input and fails, said as "Your token command asked for something only you can type; run it once yourself, then try again."
- **(b) is kept in the keys folder, not the keychain or Credential Manager.** The main design keeps nothing of Wheelhouse's in the keychain (check 11; section 12.2), and a project that signs Apple apps opens the keychain to agents (`signsApps`). On Windows both places are equally open to the director's own processes. *Designer's call.*
- **The recommendation.**
  - Windows, or a launched or Locked project: **(c) Narrow**, made with (a) when a command is set, else (b). Where GitLab refuses project keys (`KEYS_SWITCHED_OFF` in `gitlab-key.js`), **(a)** when the director has a command, else (b).
  - Mac, neither launched nor Locked: the CLI's sign-in where `glab` is there; otherwise **(a)** when the director has a command, else (b); **Make it stricter** leads to (c), as today.
  - On the director's laptop that means: try a project key with the secret-store token; fall back to the secret-store command itself.
- **GitHub** has the same three, with (c) being the Wheelhouse app or the director's own app, unchanged.

## 6. Pushes

### 6.1 How git gets the key

- **CLI backend:** as today, the CLI as git's only credential helper (`setupGitEnv`).
- **REST backend:** the helper's own one-shot credential helper. The helper sets `credential.helper` (through `GIT_CONFIG_COUNT`, after clearing the list, as today) to `node <plugin>/scripts/host/git-credential.js`, and puts a random one-use code in the call's environment (`WHEELHOUSE_CREDENTIAL_CODE`). When git asks, the script hands the code to the helper over its socket (`scripts/host/helper-client.js`), gets the user name and token for that host, prints them to git, and the helper forgets the code. The token never sits in an environment variable or an argument; the code is worth nothing once used, and nothing after the call ends.
- **The narrow GitLab key moves to the same route**, replacing `gitHeader`'s `GIT_CONFIG_VALUE_0: AUTHORIZATION: basic …` in the environment (`connection.js`). GitHub's narrow key keeps its header for now; it moves when GitHub's REST part does.
- **Opening merge requests** is done by REST (4.3), not by push options: REST answers with the request's number and address, finds an existing request ("Another open merge request already exists", 409) and carries a description of any length.

### 6.2 Why not "use my git as it is"

Using the director's credential manager would mean letting their global and system git settings into the helper's git. The fence shuts them out on purpose (rulings R109 to R112), and the helper needs a token for the REST calls anyway. One token for both keeps one thing to renew and one thing to revoke. Only the network settings are carried across (section 7). A personal access token with the `api` scope pushes over HTTPS too. *Designer's call.*

## 7. The proxy

- **One source: the director's git.** Each time the helper starts, and at setup, it reads for the host's address: `git config --get-urlmatch http.proxy <address>`, `http.proxyAuthMethod`, `http.sslBackend`, with the global and system settings allowed for that one read only, and git's own `--get-urlmatch` choosing the most specific entry. With none set, `HTTPS_PROXY`, `https_proxy` and `ALL_PROXY` in the helper's environment, and `NO_PROXY` for exceptions. Windows' own proxy settings (the ones a browser uses) aren't read: git doesn't use them either, and the director's git already works.
- **Given to git** as `http.<address>.proxy` and `http.<address>.proxyAuthMethod`, two more settings `withGitConfig` (`company-ca.js`) may add for one address. The fence's allowed list grows by exactly these two keys.
- **Given to `curl`** on its standard input, with the token (8.1): `proxy`, and the sign-in method from `http.proxyAuthMethod`: `ntlm` to `--proxy-ntlm`, `negotiate` to `--proxy-negotiate`, `basic`, `digest`, else `--proxy-anyauth`. When the proxy address names no user, `proxy-user = ":"`, which makes `curl` sign in as the logged-in Windows user (SSPI) or with the Mac's Kerberos ticket. Nobody types a proxy password.
- **A proxy address holding a password** (`http://name:secret@proxy:8080`) is not used: it would put a password into a child's settings. Setup says: "Your git settings keep your proxy password in plain text. Wheelhouse won't copy it. Ask IT whether your proxy accepts your Windows sign-in instead; it usually does."
- **`curl`'s own sources are switched off.** `curl` is always run with `-q` first, so it never reads `.curlrc` or `_curlrc`, and with proxy and certificate variables (`*_PROXY`, `CURL_CA_BUNDLE`, `SSL_CERT_FILE`, `CURL_SSL_BACKEND`) removed from its environment, so the helper's reading is the only one.

## 8. `curl`, the token on standard input, and certificates

### 8.1 How `curl` is run

- **Which `curl`.** By full path only, never the search path: macOS `/usr/bin/curl`; Windows `%SystemRoot%\System32\curl.exe` (in Windows 10 since version 1803, and in Windows 11), else the `curl.exe` beside the git step 2 found (Git for Windows' `mingw64\bin`). Linux, for CI, `/usr/bin/curl`. None found: section 10.
- **What goes on the command line:** `-q --config - --silent --show-error --write-out <marker>` and nothing else. The address, the method, the headers (`PRIVATE-TOKEN: …` for a GitLab token, `Authorization: Bearer …` for GitHub and OAuth), the body, the proxy and the time limits all go on standard input as a `curl` config, each value quoted with `curl`'s own escapes (`\"`, `\\`, `\n`, `\t`, `\r`). So the token and even the project's path never appear in a process list.
- **Limits.** `connect-timeout = 20`, `max-time = 120` (300 for a merge, so a slow merge is "could not be confirmed", not a refusal), a body of at most 1 MB (GitLab's own limit for a description), and an answer read to at most 10 MB.

### 8.2 Certificates

- **Windows: no file needed.** Windows' `curl.exe` uses Schannel, which trusts the computer's own certificate store, where a company's policy puts its authority. Git for Windows' `curl` does the same when built for Schannel. The certificate copy setup makes for `glab` and Node.js isn't needed for `curl`.
- **A blocked revocation check on Windows.** Some company networks block the check that a certificate wasn't withdrawn. `curl` then fails with exit 35 and a `CRYPT_E_NO_REVOCATION_CHECK` message. The helper tries once more with `--ssl-revoke-best-effort`, which still checks the certificate and still refuses a certificate known to be withdrawn, but carries on when the revocation server can't be reached. This is stronger than git's fallback today, which moves to the file and OpenSSL and checks no revocation at all (`revocationFallback`, the ruling of 24 October 2026). No one is asked.
- **The Mac.** `/usr/bin/curl` uses Apple's own TLS (SecureTransport), which trusts the System keychain, where a company's authority goes. Where that still fails (exit 60) and setup has made the file (`caFile`), the helper tries once more with `--cacert <file>`. That file holds every system authority, not just the company's (`exportSystemRoots`), so nothing else is lost.
- **Nothing switches a certificate check off.** `--insecure` and `-k` are never passed, and a test greps `curl.js` for them.
- **What goes from `company-ca.js`:** `glabCaArgs` stays for the CLI backend; the Node.js part (`NODE_EXTRA_CA_CERTS` for GitLab calls) goes once no GitLab call uses `fetch`. git's part stays as it is.
- **To confirm at the first Windows sitting on a company GitLab:** one REST read and one merge through `curl.exe` and the proxy, with no certificate file. *Check to run.*

## 9. Agents' reading through a connector

- **The project may list the director's connector.** A connector in Claude shows in tool names as `mcp__<server>__<tool>`. Agents may use it only when `mcpServers` in `.claude/wheelhouse.json` names the server (`allowedServers` in `scripts/hooks/tool-guard.js`), as for any connector. Setup doesn't add it. The front desk offers it once, as a card, when it sees a GitLab or GitHub connector in its own session: "Let agents read GitLab through your connector?", with **Not now** recommended for a project with real users, since a connector reads with the director's whole account and on the Mac sits outside the sandbox.
- **Wheelhouse never depends on it.** Every read the gate, the board or the survey needs goes through the helper. A connector is for agents' own looking around (a pipeline's log, an issue's discussion).
- **It never writes for Wheelhouse.** A connector that can merge, approve or push is still listed only for reading: `mcpServers` lists a server, not its tools, so the card says plainly that the connector's write tools come with it, and the merge gate still holds because merges count only through the helper (section 12.3 of the main design).

## 10. What a director on a locked-down laptop will hit

- **`curl` missing or blocked.** Rare, since Windows ships it. Step 2 says: "This computer has no curl Wheelhouse can use, so it can't reach GitLab without GitLab's own tool. Ask IT for either." Git alone still works.
- **The proxy wants a password typed in.** Not supported; said as in section 7.
- **The token expires or is revoked.** A 401 from GitLab, with (a) the command run again once; then a card: "Your GitLab token has stopped working. Make a new one in your company's secret store, or paste a new one." For (b) and (c), the board's 14-day renewal notice (`renewalDue` in `connection.js`) reads the token's expiry from `GET /personal_access_tokens/self` once a day, so (b) gets the notice too.
- **The token command is slow or asks for a sign-in.** Section 5.
- **Single sign-on only.** Where tokens are switched off and `glab`'s browser sign-in needs a company application nobody registered, the card says: "Your company's GitLab allows sign-in only through the company's sign-in page, and Wheelhouse needs a token or GitLab's own tool for that. Ask your GitLab admin for either." Setup then offers git alone.
- **Off the company network.** As today: `HOST_UNREACHABLE`, and work carries on and is sent later.
- **A `glab` that works today and is blocked tomorrow.** Section 4.2.

## 11. What stays and what changes

**Stays as it is**

- The adapter's interface, its argument checks and every caller.
- `gh` and `glab` as the first backend, fetched by step 2 where allowed (`scripts/setup/tools.js`, `glabFrom` included).
- Quick and narrow, the Wheelhouse app, the director's own app, project keys, protection, the merge gate, STOP and the lock.
- `gitlabHosts`, `gitlabBase`, `productOf` and `gitlab-base.js` as the only file that spells the public GitLab address.
- git's fence (R109 to R113), apart from two proxy keys.
- Git alone.
- The deny rules for agents: `Bash(gh:*)`, `Bash(glab:*)`, `Bash(git push:*)`, the host token variables (`HOST_TOKENS` in `scripts/protection/settings.js`), the credential files (`scripts/lib/credentials.js`).

**Changes**

- New: `scripts/host/curl.js`, `gitlab-rest.js`, `github-rest.js`, `git-credential.js`, `scripts/host/token-source.js` (runs the command, reads the keys file, keeps the token in memory), `scripts/host/proxy.js` (reads the director's proxy).
- `gitlabApi` runs on `curl.js`. `probeCertificate` asks through `curl.js` too, so it sees what the helper will see.
- `connection` gains `backend` and, for REST, `tokenSource` (`'command'`, `'box'` or `'project-key'`); neither holds a secret.
- Setup step 2 checks the tools in three stages; step 3 finds the proxy, the remote and the credential helper, and asks only for the token source when the CLI isn't there (section 12).
- Setup's own GitLab calls (`directorGitlabApi`, `signInStatus`, `whoAmI`, the commit email) read the token from the token source when the CLI isn't there.
- `scrub` hides the token source's token.
- `HOST_TOKENS` gains nothing: the helper never sets a token variable on the REST backend.

## 12. Setup: finding first, asking last

Step 2 (tools) and step 3 (host and connection) change as below; everything else in section 15 of the main design, including the one recommended card (section 15.1), holds.

1. **Step 2 finds:** git, Node.js and `curl` by full path; `gh` or `glab` in three stages (4.2); for a company GitLab, whether the address is reached through a proxy (7) and whether the certificate is trusted (8). The card lists the fetch of the CLI only where it may be fetched.
2. **Step 3 finds:** the remote and host (as today); the proxy and its sign-in method; whether the director's git has a credential helper for the address; whether the CLI is signed in.
3. **Step 3 asks only:**
   - nothing, when the CLI is signed in and the connection is Quick (the Mac's default);
   - the token source card, when the CLI isn't there or isn't allowed. On the one recommended card this is one line: "Reach GitLab with your token command (recommended, since you have one)", or "with a token pasted into your computer's box". **Customise** shows the three sources of section 5;
   - the token command, typed (typing counts on this card, like step 3's owner and name). Setup runs it once, calls `GET /user`, and shows "Found GitLab user a.director at gitlab.example.org" before Confirm. A command that fails is said in plain words, never with its output;
   - nothing about the proxy, unless it holds a password (section 7).
4. **The Go-ahead card** names the backend in plain words: "Wheelhouse will use GitLab's web API through your company's proxy, with the token your command gives." It never says "REST" or "curl".

## 13. Migration of projects already set up

- **Projects using `glab` or `gh` today** get `backend: 'cli'` written into their record at the first helper start after the upgrade, with no card. Nothing else changes for them.
- **A project whose CLI stops working** moves to REST as in section 4.2, once it has a token source; setup's step 3 card asks for one the first time.
- **A pasted GitLab token kept today** (`kind: 'pasted-token'` in the keys folder) is read as source (b), unchanged on disk.
- **The narrow GitLab key** moves from the environment header to the one-shot credential helper (6.1) with no card.
- **Nothing is deleted.** A fetched `glab` stays in `~/.wheelhouse/tools/` until uninstall, as today.

## 14. Rulings to add to the main design

**Section 11, replacing its opening paragraphs:**

> **One adapter, two backends per host.** The adapter has the same operations for GitHub and GitLab. Beneath it, each host has two backends: the host's own tool (`gh` or `glab`) where it is installed, allowed and signed in; otherwise the host's REST API through the system's `curl`, with the token on `curl`'s standard input. Setup's step 2 chooses, the project's record keeps the choice, and a tool that stops starting moves the project to the REST backend. Both backends answer in one shape and are held together by shared contract tests. Skills, agents and hooks call the adapter, never `gh`, `glab` or `curl`. The helper fits around the director's own git setup: it reuses the proxy and the certificate their git uses, and the token in their company's secret store, and asks only what it can't find (`docs/specs/2026-11-03-host-access-design.md`).

**Section 11, the Quick row of the connection table**, gains: "With no CLI: the director's token, from a command they name or pasted into the computer's box."

**Section 15, step 2's row**, gains: "and `curl`; the host's tool only where the computer allows it." **Step 3's row** gains: "Where the host's tool isn't there, one card for where the token comes from."

**Section 22, a new row:**

> | How Wheelhouse reaches the host on a locked-down computer | Decided <date> 2026, from the director's Windows work laptop, where `glab` is blocked and the company's GitLab sits behind an NTLM proxy: keep `gh` and `glab` where they work, and fall back to the host's REST API through the system's `curl`, chosen by what the computer can do. The token comes from a command the director names (their company's secret store), a token pasted into the computer's box, or a project key; the command is a setting of the computer, confirmed by the director, never of the project. The proxy and certificate are the director's git's own. On Windows `curl` trusts the system's store, so no certificate file is needed there. Wheelhouse doesn't approve on the host; agents may read through the director's connector only when the project lists it |

## 15. Risks

- **Two backends cost upkeep** (section 4.5). Mitigated by contract tests; still roughly double the fixtures.
- **The one-shot credential code** is in git's environment for the length of one call. An agent on Windows could read it and race git for it; git would then fail, which the helper sees and reports. On the Mac a sandboxed agent can't reach the helper's children. Accepted.
- **The token command runs outside the sandbox.** Mitigated by keeping it in this computer's confirmed settings, never the project.
- **Untried live:** `curl.exe` through an NTLM proxy with SSPI, Schannel with a company authority, and `--ssl-revoke-best-effort` on a blocked network. Each is a check at the first Windows sitting (part 1's probe).

## 16. Decisions for the director

1. **Keep the CLI first, REST second** (recommended), or REST only for GitLab on every computer, one path, fewer tests.
2. **Token default on Windows:** a project key made with the secret-store token, falling back to the secret-store command (recommended); or the secret-store command alone, simpler but reaching the whole account.
3. **A typed token kept in Wheelhouse's keys folder** (recommended, as the narrow keys are), or in the keychain and Credential Manager, as `glab` keeps it.
4. **Pushes with Wheelhouse's own one-use credential** (recommended), or with the director's own git credential manager as it is.
5. **Agents reading through the connector:** offered once as a card, **Not now** recommended for products with real users (recommended); or never offered.
6. **No approving on the host** (recommended), or an `approve` operation the director's card could trigger.
7. **Order of the build:** the laptop's parts first (recommended), GitHub's REST backend after.

## Sources

- Code: `scripts/host/adapter.js`, `gitlab.js`, `github.js`, `connection.js`, `gitlab-key.js`, `gitlab-base.js`, `gitlab-history.js`, `company-ca.js`, `protection.js`, `cut-access.js`, `helper.js`; `scripts/setup/host.js`, `tools.js`, `git.js`; `scripts/lib/safe-git.js`, `host-tools.js`, `credentials.js`; `scripts/hooks/tool-guard.js`; `scripts/protection/settings.js`; `scripts/secrets/secret-box.js`.
- Design: `docs/specs/2026-10-17-wheelhouse-design.md`, sections 11, 12.2, 15 and 22; checks 5, 10, 11, 22, 23, 38, 71 and 73.
- GitLab's REST API v4 documentation: merge requests (the merge call's 405, 406, 409 and 422 answers), personal access tokens, project access tokens.
- `curl`'s manual: `--config`, `-q`, `--proxy-ntlm`, `--proxy-user`, `--ssl-revoke-best-effort`, `--write-out`.
