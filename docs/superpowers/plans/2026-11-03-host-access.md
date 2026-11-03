<!-- docs/superpowers/plans/2026-11-03-host-access.md -->
# Host access that fits around the director's git setup: the build plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan part by part. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Where the director's git already works, Wheelhouse uses it as it is. Pushes run with the director's own git setup untouched. Everything else goes through `gh` or `glab` where they work, otherwise through the host's REST API with the system's `curl` and a key borrowed from the computer's own store. A project-only key is an option, with its scope guided per host. Approvals happen on the host, on the director's card.

**Architecture:**
- The adapter's interface stays.
- Each host gets a second backend (`gitlab-rest.js`, `github-rest.js`) over one transport (`curl.js`), chosen per project and kept in the record.
- Pushes run with the director's own git settings, with the fence's other settings still in force.
- Keys live in the computer's store, reached through `git credential` or the store's own command (`store.js`), and are never copied.
- Both backends share one error shape and one set of contract tests.

**Tech Stack:** Node.js (ES modules), `node:test`, the system's `curl` and git. No dependency.

**Spec:** `docs/specs/2026-11-03-host-access-design.md`.

**How to use this plan.**
- Each part is one fresh session, working from this file, the spec and the repository.
- Each part ends with a pull request and one message to the main session.
- Run the test files a change touches; leave `npm test` to CI.
- Builders ask the main session, never the director.
- Every new file starts with its path comment. Use British English and no model names.

**[laptop]** marks the parts the director's Windows work laptop needs: no `glab`, a company GitLab, an NTLM proxy, and a token that goes from the secret store into Credential Manager once. They go first.

## Order and what can run together

| Part | Name | Needs | [laptop] | Can run alongside |
|---|---|---|---|---|
| 1 | `curl` transport and the proxy reading | none | yes | 2 |
| 2 | The computer's store: borrow, store, move keys in | none | yes | 1 |
| 3 | GitLab REST backend, approve, contract tests | 1 | yes | 4 |
| 4 | Pushes with the director's git as it is | none | yes | 1, 2, 3 |
| 5 | Backend choice, record, switch on failure | 2, 3 | yes | 6 |
| 6 | `gitlabApi`, protection and setup's own calls on `curl` | 1, 2 | yes | 5 |
| 7 | Setup steps 2 and 3: find, check the key, the key card | 4, 5, 6 | yes | none |
| 8 | Narrow keys: scopes and prefilled pages per host | 2, 6 | no | 9, 10, 11 |
| 9 | Migration, board lines, the design's rulings | 7 | yes | 8, 10, 11 |
| 10 | GitHub REST backend and approve | 1, 3 | no | 8, 9, 11 |
| 11 | Connector card for agents' reading | none | no | any |

## Part 1: `curl` transport and the proxy reading [laptop]

**Files:**
- Create: `scripts/host/curl.js`, `scripts/host/proxy.js`, `tests/helpers/fake-curl.js`. The fake records the config given on standard input and answers from a queue of `{ status, body, exit, connect }`.
- Modify: `scripts/host/company-ca.js` (curl's exit codes to the existing kinds; `PROXY_REFUSED`).
- Tests: `tests/scripts/host/curl.test.js`, `tests/scripts/host/proxy.test.js`, `tests/scripts/host/company-ca.test.js`.

- [ ] `curlPath({ platform, systemRoot, gitPath })`: `/usr/bin/curl`, `System32\curl.exe`, then the `curl.exe` beside git; null when none; never the search path.
- [ ] `request(...)`:
  - argv is exactly `-q --config - --silent --show-error --write-out <marker>`;
  - everything else goes on standard input, quoted;
  - `*_PROXY`, `CURL_CA_BUNDLE`, `SSL_CERT_FILE` and `CURL_SSL_BACKEND` are removed from its environment;
  - it returns `{ status, body, connect }`.
- [ ] Exit codes map to `HOST_UNREACHABLE`, `CERTIFICATE_NOT_TRUSTED` and `PROXY_REFUSED`.
- [ ] Retries:
  - on Windows, a blocked revocation check is retried with `--ssl-revoke-best-effort`;
  - on the Mac, exit 60 is retried with `--cacert <caFile>`.
- [ ] `readProxy({ address, run, env })`:
  - reads `git config --get-urlmatch` with the director's settings, then the environment;
  - maps the sign-in method;
  - refuses an address that holds a password.
- [ ] Tests:
  - argv never holds the key or the path;
  - `-q` always comes first;
  - a grep finds no `-k` or `--insecure`;
  - each exit code maps to its kind;
  - each proxy sign-in method maps to its `curl` option.
- [ ] Add a probe sheet, `probes/94-host-access/run.md` (the next free check number), for the Windows sitting. It covers a read and a merge through `curl.exe` and the NTLM proxy, and `git credential fill` with Git Credential Manager and `GCM_INTERACTIVE=never`.

## Part 2: The computer's store: borrow, store, move keys in [laptop]

**Files:**
- Create: `scripts/host/store.js`.
- Modify: `scripts/secrets/secret-box.js` (read and delete for the `wheelhouse` service; Linux through git's helper), `scripts/host/keys.js` (reads move to the store, with the file as the fallback during migration), `scripts/host/adapter.js` (`scrub` takes extra secrets).
- Tests: `tests/scripts/host/store.test.js`, `tests/scripts/secrets/secret-box.test.js`, `tests/scripts/host/keys.test.js`.

- [ ] `borrowKey({ host, base, repoPath, run })`:
  - runs `git credential fill` with the director's settings, `GIT_TERMINAL_PROMPT=0` and `GCM_INTERACTIVE=never`;
  - sends `path` only when `credential.useHttpPath` is set;
  - returns `{ username, key }` or null;
  - never runs `reject`.
- [ ] `storeDirectorKey({ host, username, key })` runs `git credential approve`, with everything on standard input.
- [ ] `storeKey(name, value)` and `readKey(name)` reach the store under the service `wheelhouse`, for narrow keys and the app's keys.
- [ ] Tests:
  - no key appears in any argv or child environment the fake run saw;
  - `reject` is never called;
  - a missing helper on Linux gives null.

## Part 3: GitLab REST backend, approve, contract tests [laptop]

**Files:**
- Create: `scripts/host/gitlab-rest.js`, `scripts/host/gitlab-shared.js` (`mergeable`, `STATE`, `stateOf` and `mergedResults`, moved out of `gitlab.js`), `tests/scripts/host/contract/gitlab-cases.js`, `tests/scripts/host/contract-gitlab.test.js`, `tests/fixtures/host/gitlab-rest/`.
- Modify: `scripts/host/adapter.js` (`backend`; `approve` and `approvalsNeeded` in `adapterFrom` with their argument checks; the shared `read` and `call`), `scripts/host/gitlab.js` (`approve` by `glab mr approve --sha`, and `approvalsNeeded`).
- Tests: `tests/scripts/host/adapter.test.js`, `adapter-history.test.js`, `open-requests.test.js`, the contract test.

- [ ] Every method in table 8.3 of the spec, built on `request`.
- [ ] Merge is `PUT …/merge {sha}`, with the status mapping of spec 8.4, then `settle`.
- [ ] Approve is `POST …/approve {sha}`; 403 or "author" gives the self-approval line, and 409 says the head has moved.
- [ ] Every contract case runs over the fake `glab` and the fake `curl`; a method-list test fails if either backend lacks a method.

## Part 4: Pushes with the director's git as it is [laptop]

**Files:**
- Modify: `scripts/lib/safe-git.js` (a `push` reach that drops `GIT_CONFIG_GLOBAL` and `GIT_CONFIG_NOSYSTEM`, keeps the rest of the fence, and allows `https:ssh` with the director's `core.sshCommand` for an SSH remote), `scripts/host/helper.js` (the as-is push route, with `GIT_TERMINAL_PROMPT=0` and `GCM_INTERACTIVE=never`; the gate's refusals unchanged), `scripts/host/connection.js` (`mode: 'as-is'`).
- Tests: `tests/scripts/lib/safe-git.test.js`, `tests/scripts/lib/safe-git-lists.test.js`, `tests/scripts/host/helper-push.test.js` (new, against `tests/helpers/http-host.js`, with a credential helper in a temporary global config).

- [ ] The repository's own config is still checked against the allowed list before a push.
- [ ] Hooks stay off, signing stays off and `http.sslVerify` stays true, even when the global config says otherwise.
- [ ] Pushes to `main`, force-pushes and pushes of the record are still refused.
- [ ] Only push calls get the director's settings: a test lists every route and its reach.

## Part 5: Backend choice, record, switch on failure [laptop]

**Files:**
- Modify: `scripts/host/connection.js` (`backend`), `scripts/host/adapter-for.js`, `scripts/host/helper.js` (choose the backend per project; borrow the key per action for REST; switch on a spawn failure; write the record; the board line), `scripts/lib/host-tools.js` (`toolState(tool)`).
- Tests: `tests/scripts/host/adapter-for.test.js`, `tests/scripts/host/helper-backend.test.js` (new).

- [ ] A record with no `backend` reads as `'cli'`.
- [ ] `ENOENT`, `EACCES` or a policy message switches the project to `'rest'`; a signed-out CLI is not a switch.
- [ ] The borrowed key is dropped after each action (a test checks the helper holds no key between calls).

## Part 6: `gitlabApi`, protection and setup's own calls on `curl` [laptop]

**Files:**
- Modify: `scripts/host/gitlab-key.js` (`gitlabApi` over `request`), `scripts/host/company-ca.js` (`probeCertificate` through `curl`), `scripts/setup/host.js` (`directorGitlabApi`, `signInStatus` and `whoAmI` through the borrowed key when there is no CLI), `scripts/setup/project-files.js` (the commit email by `GET /user`), `scripts/install/survey.js` (the open requests through the adapter), `scripts/host/cut-access.js`.
- Tests: `tests/scripts/setup/host.test.js`, `tests/scripts/host/protection.test.js`, `tests/scripts/host/gitlab-protection-ee.test.js`, `tests/scripts/host/company-ca.test.js`, `tests/scripts/install/survey.test.js`, `tests/scripts/setup/project-files.test.js`.

- [ ] Callers of `gitlabApi` are unchanged; their tests swap the fake `fetch` for the fake `curl`.
- [ ] A grep test finds no GitLab call left on `fetch` in `scripts/host` or `scripts/setup`.

## Part 7: Setup steps 2 and 3: find, check the key, the key card [laptop]

**Files:**
- Modify: `scripts/setup/tools.js` (`curl`, and the tools in three stages; no fetch where blocked), `scripts/setup/host.js`, `scripts/host/token-url.js` (the basic prefilled page for the director's own key: GitLab `api,write_repository`), `skills/setup/SKILL.md`, card lines.
- `scripts/setup/host.js` gains:
  - the remote's transport, `credential.helper` and `git ls-remote` as it is;
  - `git credential fill` and `GET /user`;
  - the key card (page, box, check, `git credential approve`);
  - the connection card with "Use my git as it is" as the default.
- Tests: `tests/scripts/setup/tools.test.js`, `tests/scripts/setup/host.test.js`, `tests/skills/setup-lean.test.js`, `tests/scripts/setup/health.test.js`, a new end-to-end setup in `tests/e2e/` with no `glab`, a fake `curl` and a credential helper.

- [ ] Nothing is asked when git works as it is and the key passes `GET /user`.
- [ ] A key that can only push brings the key card; the new key is stored with `approve`, and the card says it replaces that one entry.
- [ ] The same card is raised on a 401 at any time after setup.
- [ ] The card's words never say "REST" or "curl" (a test checks).
- [ ] A Locked project is offered only the narrow key.

## Part 8: Narrow keys: scopes and prefilled pages per host

**Files:**
- Modify: `scripts/host/token-url.js`. It gains:
  - GitHub's fine-grained token with `contents`, `pull_requests` and `issues` at write; `statuses` and `checks` at read (`statuses` at write for local checks); and `metadata` at read;
  - a separate short-lived Administration key for step 7, used only when the director has no other sign-in;
  - GitLab's personal page with `api,write_repository`, a 30-day expiry and `description` where accepted;
  - the GitLab project page.
- Modify: `scripts/host/gitlab-key.js` (the project key stored in the computer's store), `scripts/setup/host.js` (the narrow choice and its reach lines per host; `glab auth login --stdin` and `gh auth login --with-token` offered with the narrow pages), `skills/setup/SKILL.md`.
- Tests: `tests/scripts/host/token-url.test.js`, `tests/scripts/host/gitlab-key.test.js`, `tests/scripts/setup/host.test.js`.

- [ ] Before merging, check each page's query parameters against GitHub's and GitLab's current documentation, and record the result in the part's pull request.
- [ ] Each reach line matches spec section 7, word for word.
- [ ] The personal-token fallback is used only after `KEYS_SWITCHED_OFF`.

## Part 9: Migration, board lines, the design's rulings [laptop]

**Files:**
- Modify: `scripts/host/helper.js` (`backend: 'cli'` at the first start; keys moved from `~/.wheelhouse/keys/` into the store, read back, then the file deleted), `scripts/host/connection.js` (`renewalDue` from the store and from `GET /personal_access_tokens/self`), the board's health lines, `docs/specs/2026-10-17-wheelhouse-design.md` (sections 11, 12.2 and 22 with spec section 15's text), `docs/checks/11-host-helper.md` (a note that the keychain rule is overturned).
- Tests: `tests/scripts/host/connection.test.js`, `tests/scripts/host/keys.test.js`, the board's health tests.

- [ ] A failed move leaves the file in place and tries again at the next start.
- [ ] A project set up before this work keeps `gh` or `glab`, with no card.

## Part 10: GitHub REST backend and approve

**Files:**
- Create: `scripts/host/github-rest.js`, `tests/scripts/host/contract/github-cases.js`, `tests/scripts/host/contract-github.test.js`, `tests/fixtures/host/github-rest/`.
- Modify: `scripts/host/github.js` (`approve` by `gh pr review --approve`, guarded by the head), `scripts/host/connection.js` (GitHub's own calls over `curl`).
- Tests: as listed, plus `tests/scripts/host/adapter.test.js`.

- [ ] The GraphQL queries go to `POST /graphql` with today's text.
- [ ] `--match-head-commit` becomes `{sha}`; 409 says the head has moved.
- [ ] Approve is `POST …/reviews {event: "APPROVE", commit_id}`; the author's own approval gives the self-approval line.

## Part 11: Connector card for agents' reading

**Files:**
- Modify: `skills/front-desk/SKILL.md` and its card lines. `scripts/hooks/tool-guard.js` is unchanged.
- Tests: the front desk's card tests under `tests/skills/`.

- [ ] Offered once, when a GitLab or GitHub connector is seen.
- [ ] **Not now** is recommended for a launched project.
- [ ] A yes adds the server to `mcpServers` through the usual approval.
