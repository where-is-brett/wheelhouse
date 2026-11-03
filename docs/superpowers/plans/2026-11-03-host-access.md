<!-- docs/superpowers/plans/2026-11-03-host-access.md -->
# Host access that fits around the director's git setup: the build plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan part by part. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wheelhouse reaches GitHub and GitLab through `gh` or `glab` where they work, and otherwise through the host's REST API with the system's `curl`, reusing the director's proxy, certificate and token store, so a locked-down company laptop works.

**Architecture:** The adapter's interface stays. Beneath it each host gets a second backend (`gitlab-rest.js`, `github-rest.js`) over one transport (`curl.js`), chosen per project and kept in the record. Tokens come from a token source (a command, the keys folder, or a project key); git gets them through a one-use credential helper over the helper's socket. Both backends share one error shape and one set of contract tests.

**Tech Stack:** Node.js (ES modules), `node:test`; the system's `curl` and git. No dependency.

**Spec:** `docs/specs/2026-11-03-host-access-design.md`.

**How to use this plan.** Each part is one fresh session with this file, the spec and the repository. Each ends with a pull request and one message to the main session. Run the test files a change touches; leave `npm test` to CI. Builders ask the main session, never the director. Every new file starts with its path comment; British English; no model names.

**Marked [laptop]:** the parts the director's Windows work laptop needs (no `glab`, a company GitLab, an NTLM proxy, a token from a secret store). They go first. Parts not marked can follow in any order once their dependencies merge.

## Order and what can run together

| Part | Name | Needs | [laptop] | Can run alongside |
|---|---|---|---|---|
| 1 | `curl` transport and the proxy reading | none | yes | 2 |
| 2 | Token sources | none | yes | 1 |
| 3 | GitLab REST backend and contract tests | 1 | yes | 4 |
| 4 | One-use git credential, proxy for git | 1, 2 | yes | 3 |
| 5 | Backend choice, record, switch on failure | 2, 3 | yes | 6 |
| 6 | `gitlabApi`, protection and setup's own calls on `curl` | 1, 2 | yes | 5 |
| 7 | Setup steps 2 and 3: find, then ask | 5, 6 | yes | none |
| 8 | Migration, board lines, the design's rulings | 7 | yes | 9 |
| 9 | GitHub REST backend | 1, 3 | no | 8 |
| 10 | Connector card for agents' reading | none | no | any |

## Part 1: `curl` transport and the proxy reading [laptop]

**Files:** create `scripts/host/curl.js`, `scripts/host/proxy.js`; tests `tests/scripts/host/curl.test.js`, `tests/scripts/host/proxy.test.js`; a fake `tests/helpers/fake-curl.js` (records the config it was given on standard input, answers from a queue of `{ status, body, exit, connect }`). Modify `scripts/host/company-ca.js` (curl's exit codes to the existing kinds; `PROXY_REFUSED`).

- [ ] `curlPath({ platform, systemRoot, gitPath })`: `/usr/bin/curl`, `%SystemRoot%\System32\curl.exe`, then the `curl.exe` beside git; null when none. Never the search path.
- [ ] `request({ base, method, path, body, headers, proxy, certificate, timeouts })`: argv exactly `-q --config - --silent --show-error --write-out <marker>`; everything else on standard input with `curl`'s quoting; `*_PROXY`, `CURL_CA_BUNDLE`, `SSL_CERT_FILE`, `CURL_SSL_BACKEND` removed from its environment; `{ status, body, connect }` back.
- [ ] Exit codes to `HOST_UNREACHABLE` (5, 6, 7, 28, 52, 56; 28 marked timed out), `CERTIFICATE_NOT_TRUSTED` (60, 77, 35 with a certificate message), `PROXY_REFUSED` (`connect` 407).
- [ ] Windows revocation retry with `--ssl-revoke-best-effort`; Mac retry with `--cacert <caFile>` on 60 when the file exists.
- [ ] `readProxy({ address, run, env })` in `proxy.js`: `git config --get-urlmatch` for `http.proxy`, `http.proxyAuthMethod`, `http.sslBackend` with the director's settings allowed for that read; then the environment; refuses an address holding a password with the plain line.
- [ ] Tests: argv never holds the token or the path; `-q` always first; no `-k` or `--insecure` anywhere in `curl.js` (grep test); each exit code's kind; the proxy method mapping; a password in the proxy address refused.
- [ ] A probe sheet `probes/94-curl-proxy/run.md` for the Windows sitting: one read and one merge through `curl.exe` and the NTLM proxy, no certificate file. (Use the next free check number.)

## Part 2: Token sources [laptop]

**Files:** create `scripts/host/token-source.js`; test `tests/scripts/host/token-source.test.js`. Modify `scripts/host/keys.js` (a `gitlab-director-<host>` and `github-director` name for source (b)), `scripts/setup/own-app.js` pattern reused for the confirmed `gitlab-token-command` setting (read helper only), `scripts/host/adapter.js` (`scrub` takes extra secrets).

- [ ] `tokenFor(connection, { run, now })`: `'command'` runs the confirmed command without a shell (`.cmd` and `.bat` through `cmd.exe /d /s /c`), 60 seconds, empty standard input, first line checked; `'box'` reads the keys folder; `'project-key'` as `gitlabKey` does today.
- [ ] Held in memory until a 401 (`forget()`) or 8 hours.
- [ ] An unconfirmed or missing command setting is ignored, failing closed.
- [ ] Tests: the command's output never in an error; a command in the project's `.claude/wheelhouse.json` is never read; the 8-hour and 401 renewal; a waiting command fails with the plain line.

## Part 3: GitLab REST backend and contract tests [laptop]

**Files:** create `scripts/host/gitlab-rest.js`; `tests/scripts/host/contract/gitlab-cases.js`, `tests/scripts/host/contract-gitlab.test.js`; fixtures `tests/fixtures/host/gitlab-rest/` (most reuse `tests/fixtures/host/gitlab/` JSON). Modify `scripts/host/adapter.js` (`makeAdapter` takes `backend` and a `request`; `read` and `call` shared shape).

- [ ] Every method of the spec's table 4.3, built on `request`, with the same mappings `gitlab.js` uses (`mergeable`, `STATE`, `stateOf`, `mergedResults`) moved to a shared `scripts/host/gitlab-shared.js` both backends import.
- [ ] Merge: `PUT …/merge {sha}`, the status table of spec 4.4, then `settle` as today.
- [ ] Contract cases run over the fake `glab` and the fake `curl`; a test that fails when `adapterFrom`'s methods and either backend's differ.
- [ ] Run: `tests/scripts/host/adapter.test.js`, `adapter-history.test.js`, `open-requests.test.js`, the new contract test.

## Part 4: One-use git credential, proxy for git [laptop]

**Files:** create `scripts/host/git-credential.js`; modify `scripts/host/helper.js` (a `credential` route over the socket, one-use codes), `scripts/host/connection.js` (the narrow GitLab key leaves `gitHeader`), `scripts/host/company-ca.js` (`withGitConfig` allows `http.<address>.proxy` and `.proxyAuthMethod`), `scripts/lib/safe-git.js` (`WHEELHOUSE_CREDENTIAL_CODE` on the allowed variables). Tests: `tests/scripts/host/git-credential.test.js`, `tests/scripts/lib/safe-git.test.js`, `tests/scripts/host/company-ca.test.js`, a push against `tests/helpers/http-host.js`.

- [ ] A code answers once, for its host only, within 5 minutes.
- [ ] The token never appears in any child's environment (test reads every env the fake run saw).
- [ ] The proxy pair is added for one address only; any other `http.` key still refused.

## Part 5: Backend choice, record, switch on failure [laptop]

**Files:** modify `scripts/host/connection.js` (`backend`, `tokenSource`), `scripts/host/adapter-for.js`, `scripts/host/helper.js` (choose the backend per project; switch on a spawn failure; write the record; board line), `scripts/lib/host-tools.js` (`toolState(tool)`: present, allowed, signed in). Tests: `tests/scripts/host/adapter-for.test.js`, `tests/scripts/host/helper-backend.test.js`.

- [ ] A record with no `backend` reads as `'cli'`.
- [ ] `ENOENT`, `EACCES` or a policy message at spawn switches to `'rest'` only with a token source; otherwise a card.
- [ ] A signed-out CLI is a sign-in failure, not a switch.

## Part 6: `gitlabApi`, protection and setup's own calls on `curl` [laptop]

**Files:** modify `scripts/host/gitlab-key.js` (`gitlabApi` over `request`), `scripts/host/company-ca.js` (`probeCertificate` through `curl`), `scripts/setup/host.js` (`directorGitlabApi`, `signInStatus`, `whoAmI` through the token source when there is no CLI), `scripts/setup/project-files.js` (commit email by `GET /user`), `scripts/install/survey.js` (open requests through the adapter). Tests: `tests/scripts/setup/host.test.js`, `tests/scripts/host/protection.test.js`, `tests/scripts/host/gitlab-protection-ee.test.js`, `tests/scripts/host/company-ca.test.js`, `tests/scripts/install/survey.test.js`, `tests/scripts/setup/project-files.test.js`.

- [ ] Callers of `gitlabApi` unchanged; their tests swap the fake `fetch` for the fake `curl`.
- [ ] No GitLab call left on `fetch` (a grep test over `scripts/host` and `scripts/setup`).

## Part 7: Setup steps 2 and 3: find, then ask [laptop]

**Files:** modify `scripts/setup/tools.js` (`curl` and the three-stage tool check; no fetch where blocked), `scripts/setup/host.js` (find the proxy, the credential helper, the CLI's sign-in; the token source card; the typed command with its `GET /user` check), `skills/setup/SKILL.md` (the card's words), `scripts/state/card-lines.js` if lines live there. Tests: `tests/scripts/setup/tools.test.js`, `tests/scripts/setup/host.test.js`, `tests/skills/setup-lean.test.js`, `tests/scripts/setup/health.test.js`.

- [ ] The one recommended card carries one line for the token source; **Customise** the three.
- [ ] Nothing asked when the CLI is signed in on Quick.
- [ ] The card's words never say "REST" or "curl" (test).
- [ ] An end-to-end setup on the stand-in host with no `glab` and a fake `curl` (`tests/e2e/`).

## Part 8: Migration, board lines, the design's rulings [laptop]

**Files:** modify `scripts/host/helper.js` (write `backend: 'cli'` at first start), `scripts/host/connection.js` (`renewalDue` for source (b) by `GET /personal_access_tokens/self`), the board's health lines, `docs/specs/2026-10-17-wheelhouse-design.md` (sections 11, 15 and 22 with spec section 14's text, the date filled in). Tests: `tests/scripts/host/connection.test.js`, the board's health tests.

- [ ] A record set up before this work keeps `gh` or `glab`, with no card.
- [ ] `kind: 'pasted-token'` reads as source (b).

## Part 9: GitHub REST backend

**Files:** create `scripts/host/github-rest.js`, `tests/scripts/host/contract/github-cases.js`, `contract-github.test.js`, fixtures `tests/fixtures/host/github-rest/`; modify `scripts/host/connection.js` (GitHub's calls over `curl`, the narrow key onto the one-use credential). Tests as listed plus `tests/scripts/host/adapter.test.js`.

- [ ] GraphQL queries sent to `POST /graphql` with today's text.
- [ ] `--match-head-commit` becomes `{sha}`; 409 maps to "the head has moved".

## Part 10: Connector card for agents' reading

**Files:** modify the front desk's skill (`skills/front-desk/SKILL.md`) and its card lines; `scripts/hooks/tool-guard.js` unchanged. Tests: `tests/skills/front-desk*.test.js` that cover cards.

- [ ] Offered once when a GitLab or GitHub connector is seen; **Not now** recommended for a launched project; Yes adds the server to `mcpServers` through the usual approval, since the configuration is a guardrail.
