<!-- docs/superpowers/plans/2026-10-18-wheelhouse-state-and-host.md -->

# Wheelhouse state and the host: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the parts of Wheelhouse that keep its records and reach GitHub or GitLab: the state branch with its events and built views, signed records, the secret scan, the lock with its fencing counter, the weekly backup, the host adapter, the host helper with both ways to connect, and server-side protection. Before building, answer checks 20 to 23.

**Architecture:** Plain Node.js modules under `scripts/`, in three groups. `scripts/state/` writes one file per event to a separate clone of the project's `wheelhouse-state` branch and builds the views from them. `scripts/host/` holds the adapter (`gh` and `glab` command lines and their parsing), the connections, and the helper: a local server on a socket or named pipe, the only program that pushes and merges, which applies the merge gate's conditions (`scripts/gate/`) itself. Everything is tested without the network: git against local bare repositories, the adapter against recorded command output, the host's web APIs against a fake `fetch`.

**Tech Stack:** Node.js 22 or later, ESM, `node:test`, no npm dependencies. `node:crypto` (Ed25519) for signing. `git`, `gh` and `glab` as child processes.

**Spec:** `docs/specs/2026-10-17-wheelhouse-design.md`, sections 9 (state), 11 (adapter, helper, the two ways to connect), 12.2, 12.3 and 12.6 (what the helper and gate enforce), 20 (checks 20 to 23). Read with `docs/research/agent-host-access-2026-10.md` and the check notes in `docs/checks/`.

## Scope

This is the second plan, step 1 of the first plan's "After this plan". It builds no hook, skill, agent or setup screen: those are the safety plan, the agents-and-skills plan and the setup plan, which call what this plan builds. Where the design names a later piece (the merge gate's PreToolUse hook, STOP's hook, the prompt-record hook), this plan builds only the function that piece will call.

Tasks 1 to 4 are checks, and Task 4 folds their answers into the design. Task 13, the narrow connections, depends on those answers: if a check says the approach doesn't work, Task 4 brings the director a card and that task changes before anyone starts it.

## Global Constraints

Everything in the first plan's Global Constraints holds (`docs/superpowers/plans/2026-10-17-wheelhouse-foundation-checks.md`): Node.js 22 or later, no npm dependencies, ESM `.js` with no build step, `node:test` in `tests/**/*.test.js`, macOS and Windows, the path comment on every file, British or Australian English, no model identifiers anywhere including commit messages (no `Co-Authored-By` line naming a model), probes log to `~/.wheelhouse-probes/<nn>-<slug>/`, and a change to the director's computer only after a card. In addition:

- **Secrets never in a process's arguments.** A key reaches `git`, `gh` or `glab` only through the child's environment (`GH_TOKEN`, `GITLAB_TOKEN`, or `GIT_CONFIG_COUNT`/`GIT_CONFIG_KEY_0`/`GIT_CONFIG_VALUE_0` for git's `http.extraHeader`). Tests assert it.
- **Secrets never in output.** No function returns, logs or throws a message containing a key or a matched secret; errors name the kind of thing, not its value.
- **Where things live** (design sections 9 and 11), all under `wheelhouseHome()` = `~/.wheelhouse/` unless `WHEELHOUSE_HOME` is set, which tests always set to a temporary folder:
  - `computer.json`: `{ "id": "<8 hex>" }`, made once. Events carry this ID, never the computer's name, because the state branch may one day be public (section 12.8).
  - `keys/`: the signing key and the connection's keys, one file each, written with mode `0o600` where the system supports it (not presented as protection, section 12.6).
  - `projects/<project>/state/`: the state clone. `<project>` is the repository's `owner__name`.
  - `profile/`: the director's profile folder; this plan writes only `profile/keys/enrolled.json` and `profile/backups/`.
  - `helper.sock` on macOS and Linux; on Windows the pipe `\\.\pipe\wheelhouse-<user>-helper`.
- **Branch names:** `wheelhouse-state` for state, `wheelhouse-lock` for the lock (design section 9). The default branch is read from the host, never assumed to be `main`; "`main`" below means the default branch.
- **Times** are ISO 8601 in UTC with milliseconds. A function that needs the time takes a `now` argument defaulting to `() => new Date()`, so tests fix it.
- **Child processes** are run through one injected function, `run(file, args, { cwd, env, input }) -> Promise<{ code, stdout, stderr }>`, from `scripts/lib/run.js`, never with a shell. Tests pass a recording fake.

## Review Focus

1. **A ref spelled to reach `main` another way.** `HEAD:main`, `refs/heads/main`, `+feature:main`, `:main` (a deletion), `feature:refs/heads/main`, or a push to `wheelhouse-state` whose commits change or delete an existing event. Expected: the helper refuses each, saying which rule. Owning task: Task 14 (a test per spelling).
2. **Two computers writing at the same moment.** Expected: both events land, neither is lost, and the second push retries after pulling. Owning task: Task 8 (two clones of one bare repository, same millisecond).
3. **A forged or altered protected record.** An unsigned approval, one signed by a key not in the enrolled list, or a signed one with one field changed. Expected: the views and the gate treat it as absent. Owning tasks: Task 6 (verify), Task 9 (views ignore it), Task 11 (gate refuses).
4. **A secret in an event or a quoted rule.** Expected: the push is refused, the message names the pattern and the file, never the value. Owning task: Task 7, and Task 8 (the push path calls it).
5. **A home folder with a space or non-English letters, and Windows.** `C:\Users\Jo Smith\`, `/Users/zoë/`. Expected: the helper starts and answers, git runs, keys are written. Owning tasks: Task 5 (paths), Task 14 (helper on a pipe on Windows in CI).

## File structure

```
scripts/lib/paths.js               wheelhouseHome(), computer ID, every path above
scripts/lib/run.js                 the one way to run a child process
scripts/lib/canonical.js           canonical JSON, for signing
scripts/state/signing.js           Ed25519 keys, sign and verify, enrolled keys
scripts/state/secret-scan.js       patterns and scan
scripts/state/events.js            event shape, file names, write, list
scripts/state/clone.js             the state clone: make, commit, sync
scripts/state/views.js             built views and status.json
scripts/state/lock.js              the lock branch and fencing counter
scripts/state/backup.js            the weekly bundle into the profile
scripts/gate/conditions.js         the merge gate's conditions, as one pure function
scripts/host/adapter.js            chooses github.js or gitlab.js
scripts/host/github.js             gh command lines and parsing
scripts/host/gitlab.js             glab command lines and parsing
scripts/host/connection.js         quick or narrow; the environment a child gets
scripts/host/github-app.js         device sign-in, access and renewal keys, installation
scripts/host/gitlab-key.js         project access tokens
scripts/host/keys.js               reading and writing files under keys/
scripts/host/protection.js         server-side protection, read and switch on
scripts/host/helper.js             the helper's server and its rules
scripts/host/helper-client.js      how everything else asks the helper
probes/20-github-app/…  probes/21-gh-keychain/…  probes/22-gitlab/…
docs/checks/20-github-app.md  21-gh-keychain.md  22-gitlab-keys.md  23-gitlab-protection.md
tests/…                            one test file per module; fixtures under tests/fixtures/host/
```

---

## Part 1: checks 20 to 23

Each check follows the first plan's findings-note format (its Task 1), with its row added to `docs/checks/README.md` and `tests/docs/checks-format.test.js` passing.

### Task 1: Check 20, the Wheelhouse GitHub App

**Files:**
- Create: `scripts/host/github-app.js`, `probes/20-github-app/register.js`, `probes/20-github-app/run.js`, `docs/checks/20-github-app.md`
- Test: `tests/scripts/host/github-app.test.js`

**Interfaces:**
- Produces (kept, used by Task 12):
  - `startDeviceSignIn({ clientId, fetch }) -> Promise<{ userCode: string, verificationUri: string, deviceCode: string, interval: number, expiresIn: number }>`: `POST https://github.com/login/device/code` with `client_id`, `Accept: application/json`.
  - `waitForSignIn({ clientId, deviceCode, interval, fetch, sleep }) -> Promise<Keys>`: polls `POST https://github.com/login/oauth/access_token` with `grant_type=urn:ietf:params:oauth:grant-type:device_code`; on `authorization_pending` waits `interval` seconds, on `slow_down` adds 5, on `expired_token` or `access_denied` throws `"Sign-in was not completed"`.
  - `renewKeys({ clientId, clientSecret?, refreshToken, fetch }) -> Promise<Keys>`: `grant_type=refresh_token`. `clientSecret` is sent only if check 20 finds it needed.
  - `Keys = { accessToken: string, accessExpiresAt: string, refreshToken: string, refreshExpiresAt: string }`, the times worked out from `expires_in` and `refresh_token_expires_in`.
  - `installUrl(appSlug: string) -> string`: `https://github.com/apps/<slug>/installations/new`.

- [ ] **Step 1: Write the failing tests,** with a fake `fetch` that records each request and returns canned bodies.

```js
test('startDeviceSignIn asks GitHub for a code and returns it', ...)
  // request: POST https://github.com/login/device/code, body has client_id, no secret
test('waitForSignIn waits while pending, slows down when told, and returns the keys', ...)
  // pending, slow_down, then tokens → sleeps [5, 10]; accessExpiresAt = now + 28800 s
test('waitForSignIn stops when the code expires or is refused', ...)
  // expired_token → /not completed/; access_denied → /not completed/
test('renewKeys exchanges the renewal key and sends no secret unless given one', ...)
test('no function puts a key in a thrown message', ...)
  // a 500 response with a body containing the token → error message lacks it
```

- [ ] **Step 2: Run `npm test`.** Expected: FAIL, module not found.
- [ ] **Step 3: Implement `scripts/host/github-app.js`.** `fetch` is a parameter defaulting to the global one; `sleep` defaults to a `setTimeout` promise.
- [ ] **Step 4: Run `npm test`.** Expected: PASS.
- [ ] **Step 5: Write `probes/20-github-app/register.js`.** It prints the link to GitHub's "Register new GitHub App" page with these filled in by URL parameters: name `Wheelhouse check <4 hex>`, homepage the Wheelhouse repository, `public=false`, `webhook_active=false`, `contents=write`, `pull_requests=write`, `issues=write`, `metadata=read`. Check the parameter names against GitHub's "Registering a GitHub App using URL parameters" page first.
- [ ] **Step 6: Write `probes/20-github-app/run.js <clientId> <appSlug> <owner/repo>`.** It runs the device sign-in, prints only the code and the page, opens the install page, then, with the keys held in memory only: lists the installations the key can see, pushes a branch to a scratch repository and opens and closes a pull request through the REST API, tries `PUT /user/installations/{id}/repositories/{repo_id}` for a second scratch repository with the app's key and, separately, with `gh`'s own key (from `gh auth token`, never printed), tries `renewKeys` without and then with the client secret (read from the system's own hidden-entry box, `askSecret`, never an argument), and confirms that the app's key is refused a settings change (`PATCH /repos/{owner}/{repo}` with a new description). It prints one line per trial: what, expected, result, time taken.
- [ ] **Step 7: Director (Mac, about 15 minutes).** On a card first: "I'll make a private test app on your GitHub account and two empty private test repositories, and delete all three afterwards." The director opens the register link, ticks **Enable Device Flow**, clicks **Create**, makes two empty private repositories named `wheelhouse-check-20-a` and `-b`, and installs the app on `-a` only. Then the session runs `run.js`, and the director types the code and clicks **Authorise** when the page opens. Time the director's part from the first link to the end of the install.
- [ ] **Step 8: Undo.** The director deletes the test app and both repositories (GitHub asks them to type each name). Check with `gh api` that they are gone.
- [ ] **Step 9: Write the findings note** (design sections 11 and 15, step 3), and commit.

```bash
git add scripts/host/github-app.js probes/20-github-app tests docs/checks
git commit -m "Record check 20: signing in to a Wheelhouse GitHub App"
```

### Task 2: Check 21, the quick connection's sign-in on the Mac

**Files:**
- Create: `probes/21-gh-keychain/trials.js`, `docs/checks/21-gh-keychain.md`

- [ ] **Step 1: Write `probes/21-gh-keychain/trials.js`.** Meant to be run by a sandboxed Bash command. It tries, in turn: `gh auth token`, `security find-generic-password -s gh:github.com -w`, reading `~/.config/gh/hosts.yml`, and `glab auth status --show-token` if `glab` is installed. For each it prints only `<trial>: refused` or `<trial>: read <n> characters`, never the value.
- [ ] **Step 2: Run it in this Desktop session's sandbox** with the sandbox settings check 11 used (`probes/11-helper/setup.js`), and once outside the sandbox for comparison.
- [ ] **Step 3: Write the findings note** (design section 11, the quick connection's warning; section 12.2), and commit.

```bash
git add probes/21-gh-keychain docs/checks
git commit -m "Record check 21: whether agents can read the existing sign-in"
```

### Task 3: Checks 22 and 23, GitLab project keys and protection

**Files:**
- Create: `scripts/host/gitlab-key.js`, `scripts/host/protection.js` (GitLab half), `probes/22-gitlab/run.js`, `docs/checks/22-gitlab-keys.md`, `docs/checks/23-gitlab-protection.md`
- Test: `tests/scripts/host/gitlab-key.test.js`, `tests/scripts/host/protection.test.js`

**Interfaces:**
- Produces (kept, used by Tasks 13 and 15):
  - `makeProjectKey({ api, projectId, name, days }) -> Promise<{ token: string, expiresAt: string, id: number }>`: `POST /projects/:id/access_tokens` with `scopes: ['api', 'write_repository']`, `access_level: 40` (Maintainer, so it can merge but, with `main` protected to no one, not push to it), `expires_at` today plus `days` (at most 365).
  - `api` is `{ get(path), post(path, body), put(path, body), delete(path) } -> Promise<{ status, body }>`, made by `gitlabApi({ baseUrl, token, fetch })` in the same file, sending the key in the `PRIVATE-TOKEN` header.
  - `readGitlabProtection({ api, projectId, branch }) -> Promise<{ pushAccess: string[], mergeAccess: string[], pipelinesMustSucceed: boolean }>` and `protectGitlabBranch({ api, projectId, branch }) -> Promise<void>`: push access "no one" (0), merge access Maintainers (40), force-push off, and the project's `only_allow_merge_if_pipeline_succeeds: true`.

- [ ] **Step 1: Read GitLab's documentation** for project access tokens (which plans and offerings have them, on GitLab.com and self-managed; who may create them through the API; the longest expiry), for protected branches and for the merge setting, and for whether its OAuth device sign-in accepts scopes narrower than `api`. Record each with its link in the notes.
- [ ] **Step 2: Write the failing tests** with a fake `api`.

```js
test('makeProjectKey asks for a Maintainer key with api and write_repository, expiring within 365 days', ...)
test('makeProjectKey refuses more than 365 days', ...)
test('readGitlabProtection reports push and merge access and the pipeline rule', ...)
test('protectGitlabBranch sets push to no one, merge to Maintainers, no force-push, pipelines must pass', ...)
test('errors from GitLab never include the key', ...)
```

- [ ] **Step 3: Run `npm test`.** Expected: FAIL.
- [ ] **Step 4: Implement both files.** Encode project paths with `encodeURIComponent`.
- [ ] **Step 5: Run `npm test`.** Expected: PASS.
- [ ] **Step 6: Live trial, only if the director has a GitLab project they choose for testing** (**Director**, 10 minutes, after a card saying what will be made and removed): `probes/22-gitlab/run.js <project path>` signs in with `glab`'s existing sign-in, makes a project key, uses it to push a branch and open and close a merge request, confirms a direct push to the protected default branch is refused, reads and (in a scratch project only) switches on the protection, then revokes the key and checks it is gone. Otherwise the notes rest on the documentation, and say so.
- [ ] **Step 7: Write both findings notes** (design sections 11, 12.3 and 15), and commit.

```bash
git add scripts/host/gitlab-key.js scripts/host/protection.js probes/22-gitlab tests docs/checks
git commit -m "Record checks 22 and 23: GitLab project keys and protection"
```

### Task 4: Fold checks 20 to 23 into the design

**Files:**
- Modify: `docs/specs/2026-10-17-wheelhouse-design.md` (sections 11, 15, 20, and 21 or 22 as needed), `docs/checks/README.md`, `HANDOVER.md`

- [ ] **Step 1: Apply each note's "What it means for the design"**, citing the note, as in the first plan's Task 16.
- [ ] **Step 2: If a check changes what the director sees** (for example, the app can't add repositories by itself, so each new project needs a tick; or project keys aren't on the director's plan), write one card per change and bring them as one batch. If Task 13 must change, change it in this plan before going on.
- [ ] **Step 3: Commit.**

```bash
git add docs HANDOVER.md
git commit -m "Bring checks 20 to 23 into the design"
```

---

## Part 2: state

### Task 5: Paths, the computer's ID, and running child processes

**Files:**
- Create: `scripts/lib/paths.js`, `scripts/lib/run.js`
- Test: `tests/scripts/lib/paths.test.js`, `tests/scripts/lib/run.test.js`

**Interfaces:**
- Produces:
  - `wheelhouseHome() -> string`; `computerId() -> string` (reads or makes `computer.json`); `stateDir(project: string) -> string`; `keysDir() -> string`; `profileDir() -> string`; `helperAddress() -> string` (socket path, or the Windows pipe name); `projectSlug(owner: string, name: string) -> string` = `owner__name`, refusing anything outside `[A-Za-z0-9._-]`.
  - `run(file: string, args: string[], { cwd?, env?, input? }) -> Promise<{ code: number, stdout: string, stderr: string }>`: `spawn` with `shell: false`, `windowsHide: true`, the given `env` merged over `process.env`.

- [ ] **Step 1: Write the failing tests.**

```js
test('wheelhouseHome follows WHEELHOUSE_HOME', ...)
test('computerId is made once, eight hex characters, and then kept', ...)
test('paths work under a home folder named "with space é"', ...)
test('helperAddress is a named pipe on Windows and a socket file elsewhere', ...)
  // pass platform explicitly: helperAddress({ platform: 'win32', user: 'Jo Smith' }) → '\\\\.\\pipe\\wheelhouse-Jo_Smith-helper'
test('projectSlug refuses a name with a slash or ..', ...)
test('run returns code, stdout and stderr, and never uses a shell', ...)
  // run(process.execPath, ['-e', 'console.log("a b")']) → stdout 'a b\n'
```

- [ ] **Step 2: Run `npm test`.** Expected: FAIL.
- [ ] **Step 3: Implement both files.**
- [ ] **Step 4: Run `npm test`.** Expected: PASS.
- [ ] **Step 5: Commit.**

```bash
git add scripts/lib tests/scripts/lib
git commit -m "Add Wheelhouse's paths and the child-process runner"
```

### Task 6: Signed records

**Files:**
- Create: `scripts/lib/canonical.js`, `scripts/state/signing.js`
- Test: `tests/scripts/lib/canonical.test.js`, `tests/scripts/state/signing.test.js`

**Interfaces:**
- Produces:
  - `canonicalJson(value) -> string`: JSON with object keys sorted at every level, no spaces; refuses `undefined`, functions and non-finite numbers.
  - `makeSigningKey() -> { computer: string, publicKey: string }`: makes an Ed25519 key with `crypto.generateKeyPairSync('ed25519')`, writes the private key as PEM to `keys/signing.pem`, returns the public key as base64 SPKI DER. Refuses if one exists.
  - `sign(record: object) -> object`: returns `{ ...record, sig: { computer, value } }`, signing `canonicalJson(record without sig)`.
  - `verify(record: object, enrolled: Enrolled) -> boolean`: true only if `record.sig.computer` is enrolled and the signature checks with that key.
  - `Enrolled = Array<{ computer: string, publicKey: string, enrolledAt: string }>`; `readEnrolled() -> Enrolled` and `enrol(entry) -> void` on `profile/keys/enrolled.json`.

- [ ] **Step 1: Write the failing tests.**

```js
test('canonicalJson sorts keys at every level', ...)  // {b:1,a:{d:1,c:2}} → '{"a":{"c":2,"d":1},"b":1}'
test('a signed record verifies against the enrolled key', ...)
test('a record with any field changed no longer verifies', ...)
test('a record signed by a key that is not enrolled does not verify', ...)
test('an unsigned record does not verify', ...)
test('makeSigningKey refuses to replace an existing key', ...)
```

- [ ] **Step 2: Run `npm test`.** Expected: FAIL.
- [ ] **Step 3: Implement both files** with `node:crypto` `sign(null, data, key)` and `verify(null, data, key, sig)`.
- [ ] **Step 4: Run `npm test`.** Expected: PASS.
- [ ] **Step 5: Commit.**

```bash
git add scripts/lib/canonical.js scripts/state/signing.js tests
git commit -m "Sign and verify protected records"
```

### Task 7: The secret scan

**Files:**
- Create: `scripts/state/secret-scan.js`
- Test: `tests/scripts/state/secret-scan.test.js`

**Interfaces:**
- Produces: `scanText(text: string) -> Array<{ pattern: string, line: number }>` and `scanFiles(paths: string[]) -> Array<{ file: string, pattern: string, line: number }>`. Never returns the matched text.

Patterns, each with a name: GitHub keys (`ghp_`, `gho_`, `ghu_`, `ghs_`, `ghr_` followed by 36 or more base-62 characters; `github_pat_` followed by 22 or more), GitLab keys (`glpat-`, `gloas-`, `gldt-`, `glrt-` followed by 20 or more of `[A-Za-z0-9_-]`), Anthropic (`sk-ant-`), OpenAI-style (`sk-` followed by 32 or more), AWS access keys (`AKIA` or `ASIA` followed by 16 upper-case letters or digits), Slack (`xox[abprs]-`), Stripe live (`sk_live_`, `rk_live_`), private key blocks (`-----BEGIN ... PRIVATE KEY-----`), database URLs with a password (`[a-z+]+://[^:\s/]+:[^@\s]+@`), and JSON web tokens (three base64url parts, the first starting `eyJ`).

- [ ] **Step 1: Write the failing tests:** one positive and one near-miss per pattern, built from fragments in the test so the test file itself holds no real-looking secret; and:

```js
test('scanText names the pattern and line, never the text', ...)
test('a postgres URL with a password is found; one without is not', ...)
```

- [ ] **Step 2: Run `npm test`.** Expected: FAIL.
- [ ] **Step 3: Implement `scripts/state/secret-scan.js`.**
- [ ] **Step 4: Run `npm test`.** Expected: PASS.
- [ ] **Step 5: Commit.**

```bash
git add scripts/state/secret-scan.js tests/scripts/state/secret-scan.test.js
git commit -m "Add the secret scan"
```

### Task 8: Events and the state clone

**Files:**
- Create: `scripts/state/events.js`, `scripts/state/clone.js`
- Test: `tests/scripts/state/events.test.js`, `tests/scripts/state/clone.test.js`, `tests/helpers/git-fixture.js`

**Interfaces:**
- Consumes: `paths.js`, `run.js` (Task 5); `sign`, `verify` (Task 6); `scanFiles` (Task 7); for pushing, `helperClient.push` (Task 14), injected as `push(dir, branch) -> Promise<{ ok: boolean, rejected?: 'non-fast-forward' | string }>` so this task's tests push straight to a bare repository.
- Produces:
  - `Event = { v: 1, id: string, at: string, computer: string, kind: Kind, data: object, sig?: object }`.
  - `Kind`: `request`, `ruling`, `level`, `glossary`, `idea`, `rejection`, `card`, `card-answer`, `setting`, `dispatch`, `merge`, `note`, and the protected kinds `confirmation`, `approval`, `review`, which `makeEvent` signs and nothing else may write unsigned.
  - `makeEvent({ kind, data, now }) -> Event`; `eventPath(event) -> string` = `events/<YYYY>/<MM>/<at with : replaced by ->_<computer>_<kind>_<4 random hex>.json`.
  - `cloneState({ project, remoteUrl }) -> Promise<string>`: clones only `wheelhouse-state` into `stateDir(project)`, or makes the branch as an orphan with a README if the remote has none.
  - `writeEvent({ project, event, push }) -> Promise<{ path: string, pushed: boolean }>`: writes the file (refusing if the path exists), runs `scanFiles` on it and refuses with the pattern names if anything is found, commits it alone (`git add -- <path>`; message `<kind> <id>`), then pushes. On a non-fast-forward rejection it runs `git pull --rebase` and pushes again, up to three times. When pushing fails for any other reason the commit stays and `pushed` is false; the next `writeEvent` or `syncState` pushes it.
  - `syncState({ project, push }) -> Promise<void>`: pull, then push anything unpushed.
  - `listEvents(dir) -> Event[]`: every event file, sorted by `at` then `id`; a file that isn't valid JSON is skipped and reported once.

- [ ] **Step 1: Write `tests/helpers/git-fixture.js`:** `makeBareRemote() -> Promise<{ url: string, cleanup() }>` under `os.tmpdir()`, using `run('git', ['init', '--bare', ...])`.
- [ ] **Step 2: Write the failing tests.**

```js
test('makeEvent signs protected kinds and leaves the others unsigned', ...)
test('eventPath holds the time, computer and kind, and two events in one millisecond differ', ...)
test('writeEvent commits one new file and pushes it', ...)
test('writeEvent refuses to overwrite an existing event file', ...)
test('writeEvent refuses an event holding a secret, naming the pattern only', ...)
test('two clones writing at the same moment both land, and neither is lost', ...)
  // clone A and B of one bare remote; write in A, write in B (B is rejected, pulls, pushes) → listEvents shows both in each after syncState
test('an event committed while the push failed is pushed by the next sync', ...)
test('listEvents skips a damaged file and reports it once', ...)
```

- [ ] **Step 3: Run `npm test`.** Expected: FAIL.
- [ ] **Step 4: Implement both files.** Run git with `-c user.name=Wheelhouse -c user.email=wheelhouse@invalid` so the director's own name and address never go on the state branch.
- [ ] **Step 5: Run `npm test`.** Expected: PASS on the Mac and in CI on all three systems.
- [ ] **Step 6: Commit.**

```bash
git add scripts/state/events.js scripts/state/clone.js tests
git commit -m "Write state events to their own branch"
```

### Task 9: The built views

**Files:**
- Create: `scripts/state/views.js`
- Test: `tests/scripts/state/views.test.js`, `tests/fixtures/state/events/` (a small set of hand-written events)

**Interfaces:**
- Consumes: `listEvents` (Task 8), `verify`, `readEnrolled` (Task 6).
- Produces: `buildViews(events: Event[], enrolled: Enrolled) -> Views`, and `writeViews(project) -> Promise<Views>`, which reads the clone and writes `views/*.json` beside it (outside the clone, so nothing built is committed).

`Views`:
- `rulebook`: one entry per `ruling` event, `{ id, at, words, reason, scope, status }`. `status` is `accepted` when a verified `confirmation` has `data.confirms === id` and `data.confirmsHash` equal to the sha256 of the ruling's canonical JSON without `sig` (made by `confirmationFor(event)` in `events.js`; only a `ruling`, `level` or `setting` can be confirmed, and an id carried by more than one event confirms nothing, every copy being left out and listed under `damaged`), `superseded` when a later accepted ruling has `data.supersedes === id`, otherwise `proposed`.
- `levels`, `settings`: the latest accepted value per key, where a `level` or `setting` event is accepted by a verified confirmation in the same way.
- `glossary`, `ideas`, `rejections`: as recorded, latest per key.
- `waiting`: `card` events with no `card-answer` whose `data.card === id`.
- `approvals`, `reviews`: verified records only, by pull request and commit.
- `unconfirmed`: rulings, levels and settings still `proposed`, which the reload shows the director first (design section 9).
- `damaged`: the files `listEvents` skipped.
- `status`: what `status.json` holds for the board: `{ builtAt, waitingCount, unconfirmedCount, lastMerge, lastEventAt }`.

- [ ] **Step 1: Write the failing tests.**

```js
test('a ruling with no confirmation is proposed and listed as unconfirmed', ...)
test('a confirmed ruling is accepted; a later confirmed ruling that supersedes it wins', ...)
test('a confirmation that does not verify confirms nothing', ...)
test('an approval signed by a key not enrolled is left out', ...)
test('an answered card leaves the waiting list', ...)
test('buildViews gives the same result whatever order the events arrive in', ...)
test('writeViews writes outside the clone', ...)
```

- [ ] **Step 2: Run `npm test`.** Expected: FAIL.
- [ ] **Step 3: Implement `scripts/state/views.js`.** Sort by `at` then `id` before folding, so the order of arrival doesn't matter.
- [ ] **Step 4: Run `npm test`.** Expected: PASS.
- [ ] **Step 5: Commit.**

```bash
git add scripts/state/views.js tests
git commit -m "Build the views from the state events"
```

### Task 10: The lock, its fencing counter, and the weekly backup

**Files:**
- Create: `scripts/state/lock.js`, `scripts/state/backup.js`
- Test: `tests/scripts/state/lock.test.js`, `tests/scripts/state/backup.test.js`

**Interfaces:**
- Consumes: `run`, paths (Task 5); the injected `push` as in Task 8.
- Produces:
  - `Lock = { computer: string, counter: number, takenAt: string, lastWriteAt: string }`, held as `lock.json` on `wheelhouse-lock`, in a second small clone at `stateDir(project)/../lock/`.
  - `readLock({ project }) -> Promise<Lock | null>`: fetches first.
  - `takeLock({ project, push, now }) -> Promise<{ taken: true, counter: number } | { taken: false, holder: string, since: string }>`: refuses when another computer holds it and its `lastWriteAt` is less than two hours old; otherwise commits `counter + 1` on top of the version just read and pushes without force. A non-fast-forward rejection means another computer moved first: it returns `taken: false`.
  - `touchLock({ project, push, now })`: updates `lastWriteAt`, only if this computer holds it.
  - `holdsLock({ project, counter }) -> Promise<boolean>`: fetches, and is true only if the remote `lock.json` names this computer and this counter. The gate and the helper call it before every merge or code push.
  - `writeBackup({ project, now }) -> Promise<string>`: `git bundle create` of `wheelhouse-state` into `profile/backups/<project>/<YYYY-MM-DD>.bundle`; keeps the last eight; skips if one exists from the last seven days.

- [ ] **Step 1: Write the failing tests** against a bare remote.

```js
test('the first computer takes the lock with counter 1', ...)
test('a second computer is refused while the lock is fresh, and told who holds it', ...)
test('a lock with no write for two hours can be taken over, and the counter rises', ...)
test('when two computers take a free lock at once, exactly one wins', ...)
test('holdsLock is false for a computer that lost the lock while asleep', ...)
test('writeBackup makes a bundle that git can verify, at most weekly, keeping eight', ...)
```

- [ ] **Step 2: Run `npm test`.** Expected: FAIL.
- [ ] **Step 3: Implement both files.**
- [ ] **Step 4: Run `npm test`.** Expected: PASS.
- [ ] **Step 5: Commit.**

```bash
git add scripts/state/lock.js scripts/state/backup.js tests
git commit -m "Add the lock with its fencing counter, and the weekly backup"
```

---

## Part 3: the host

### Task 11: The merge gate's conditions

**Files:**
- Create: `scripts/gate/conditions.js`
- Test: `tests/scripts/gate/conditions.test.js`

**Interfaces:**
- Consumes: `verify` (Task 6).
- Produces: `gateDecision(input) -> { allow: boolean, reasons: string[] }`, pure, where `input` is:

```js
{
  stop: boolean,                 // STOP is on
  bypass: boolean,               // the asking session is in bypass mode
  holdsLock: boolean,            // from holdsLock(), checked by the caller
  headSha: string,               // the pull request's head commit now
  ci: { sha: string, state: 'success' | 'pending' | 'failure' | 'none' },
  reviewRequired: boolean,       // touches a critical area or a guardrail
  review: Event | null,          // the latest review record for this PR
  approvalRequired: boolean,     // shown first, or level 4
  approval: Event | null,        // the latest approval record for this PR
  touchesGuardrails: boolean,
  enrolled: Enrolled,
}
```

Each failed condition adds one plain reason, in this order: `STOP is on`, `the session is in bypass mode`, `this computer no longer holds the lock`, `CI has not passed on <short sha>`, `no CLEAN review of <short sha>`, `no approval of <short sha>`. A review counts only if it verifies, says `CLEAN`, and names `headSha`; an approval only if it verifies and names `headSha`. `touchesGuardrails` makes both required. (An approval of an earlier commit whose screenshots are identical is the safety plan's addition; here only the exact commit counts.)

- [ ] **Step 1: Write the failing tests:** one passing case, then one test per condition that fails alone, plus:

```js
test('a CLEAN review of an older commit does not count', ...)
test('a review with any field altered does not count', ...)
test('touching the guardrails needs both a review and an approval', ...)
test('every reason is listed, not just the first', ...)
```

- [ ] **Step 2: Run `npm test`.** Expected: FAIL.
- [ ] **Step 3: Implement `scripts/gate/conditions.js`.**
- [ ] **Step 4: Run `npm test`.** Expected: PASS.
- [ ] **Step 5: Commit.**

```bash
git add scripts/gate tests/scripts/gate
git commit -m "Add the merge gate's conditions"
```

### Task 12: The adapter

**Files:**
- Create: `scripts/host/adapter.js`, `scripts/host/github.js`, `scripts/host/gitlab.js`
- Create: `tests/fixtures/host/github/*.json`, `tests/fixtures/host/gitlab/*.json` (recorded output)
- Test: `tests/scripts/host/adapter.test.js`

**Interfaces:**
- Consumes: `run` (Task 5), injected.
- Produces: `makeAdapter({ host: 'github' | 'gitlab', repo: string, run, env }) -> Adapter`, and `detectHost(remoteUrl: string) -> 'github' | 'gitlab'` (GitHub for `github.com`; GitLab for `gitlab.com` or a project setting naming another GitLab address). `Adapter`:
  - `defaultBranch() -> Promise<string>`
  - `openPr({ head, base, title, body }) -> Promise<{ number, url }>`; `updatePr({ number, title?, body? })`
  - `prState(number) -> Promise<{ headSha, mergeable: 'yes' | 'no' | 'unknown', state: 'open' | 'merged' | 'closed' }>`
  - `ciState(sha) -> Promise<{ sha, state: 'success' | 'pending' | 'failure' | 'none' }>`
  - `merge({ number, sha }) -> Promise<{ merged: boolean, reason?: string }>`: GitHub `gh pr merge <n> --merge --match-head-commit <sha>`; GitLab `glab mr merge <n> --sha <sha> --auto-merge=false` (check 5).
  - `issue.create({ title, body, labels })`, `issue.update({ number, body })`, `issue.list({ label })`

Every method builds one `gh` or `glab` command line with `--json` or `--output json` where offered, runs it with the adapter's `env`, and parses the result. Skills, agents and hooks never call `gh` or `glab` themselves (design section 11).

- [ ] **Step 1: Record the fixtures.** On the Mac, against a scratch repository on the director's GitHub (made and deleted after a card, as in Task 1), run each `gh` command once and save its JSON output, replacing the owner and repository with `a-director/product`. For GitLab, use Task 3's project if there was one; otherwise write fixtures from GitLab's documented JSON shapes and say so in a comment at the top of each.
- [ ] **Step 2: Write the failing tests:** for each method and each host, the exact command line it builds, and the parsed result from the fixture; and:

```js
test('merge asks GitHub to match the head commit', ...)
test('merge on GitLab passes --sha and --auto-merge=false', ...)
test('mergeability unknown is reported as unknown, not yes', ...)
test('a key in the environment never appears in an argument', ...)
```

- [ ] **Step 3: Run `npm test`.** Expected: FAIL.
- [ ] **Step 4: Implement the three files.** Map GitHub's `mergeable` `MERGEABLE`/`CONFLICTING`/`UNKNOWN` and GitLab's `detailed_merge_status` to the three values; settle the GitLab field against the recorded output (check 5 left it open).
- [ ] **Step 5: Run `npm test`.** Expected: PASS.
- [ ] **Step 6: Commit.**

```bash
git add scripts/host/adapter.js scripts/host/github.js scripts/host/gitlab.js tests
git commit -m "Add the host adapter for GitHub and GitLab"
```

### Task 13: The connections

**Files:**
- Create: `scripts/host/keys.js`, `scripts/host/connection.js`
- Modify: `scripts/host/github-app.js` (Task 1), `scripts/host/gitlab-key.js` (Task 3)
- Test: `tests/scripts/host/keys.test.js`, `tests/scripts/host/connection.test.js`

**Interfaces:**
- Consumes: Tasks 1 and 3 as amended by Task 4; `keysDir` (Task 5). As the checks found (design section 11): `renewKeys` is called with the client ID alone, and no client secret is shipped or stored (check 20); the helper cannot add a repository to the app's installation (check 20); a GitLab project key is made at Developer level (30), never Maintainer, by default (checks 22 and 23).
- Produces:
  - `readKey(name) -> object | null`, `writeKey(name, value: object) -> void` on `keys/<name>.json`; names allowed: `github-app`, `gitlab-project-<id>`. `github-app` holds the client ID, the renewal key, the access key and their expiries, never a client secret. `gitlab-project-<id>` holds either a project key made by setup or, where GitLab refused one, the token the director pasted, with `kind: 'project-key' | 'pasted-token'` and its expiry (check 22).
  - `Connection = { host, mode: 'quick' | 'narrow', project: string }`, kept in the project's settings (not a secret).
  - `childEnv(connection, { fetch, now }) -> Promise<Record<string, string>>`: the environment the helper gives `gh`, `glab` and `git`.
    - quick: `{}`, so the tools use the director's own sign-in.
    - narrow on GitHub: renews the access key with `renewKeys` when it has less than ten minutes left, saves the new keys, and returns `GH_TOKEN` plus git's `http.https://github.com/.extraheader` as `AUTHORIZATION: basic <base64 of x-access-token:KEY>` through `GIT_CONFIG_COUNT`, `GIT_CONFIG_KEY_0`, `GIT_CONFIG_VALUE_0`.
    - narrow on GitLab: `GITLAB_TOKEN` and the same git header with `oauth2:KEY`, for either kind of key.
  - `installationCovers(connection, { fetch }) -> Promise<{ covered: boolean, settingsUrl?: string }>`, GitHub narrow only: lists the repositories the app's installation can see (`GET /user/installations/{id}/repositories`) and, if the project isn't among them, returns the installation's settings page for the director's one tick. It never tries to add the repository itself (check 20; the director's decision, design section 22).
  - `renewalDue(connection, now) -> { due: boolean, on?: string }`: true within 14 days of a renewal key's or project key's expiry, for the board's card (design section 11).

- [ ] **Step 1: Write the failing tests.**

```js
test('quick gives the tools nothing, so they use the existing sign-in', ...)
test('narrow on GitHub renews an access key with under ten minutes left, and saves it', ...)
test('renewing sends the client ID and no client secret', ...)
test('installationCovers returns the settings page when the project is not in the installation', ...)
test('narrow on GitLab gives a pasted token the same environment as a project key', ...)
test('the key reaches git through the environment, never an argument', ...)
test('renewalDue is true fourteen days before the renewal key expires', ...)
test('a Locked project refuses quick', ...)
  // childEnv({ mode: 'quick', locked: true }) → throws /Locked needs the narrow connection/
```

- [ ] **Step 2: Run `npm test`.** Expected: FAIL.
- [ ] **Step 3: Implement both files.**
- [ ] **Step 4: Run `npm test`.** Expected: PASS.
- [ ] **Step 5: Commit.**

```bash
git add scripts/host tests/scripts/host
git commit -m "Add the quick and narrow connections"
```

### Task 14: The host helper

**Files:**
- Create: `scripts/host/helper.js`, `scripts/host/helper-client.js`
- Test: `tests/scripts/host/helper.test.js`, `tests/scripts/host/push-rules.test.js`

**Interfaces:**
- Consumes: `helperAddress`, `run` (Task 5); `makeAdapter` (Task 12); `childEnv` (Task 13); `gateDecision` (Task 11); `holdsLock` (Task 10); `buildViews` (Task 9) for the review and approval records.
- Produces:
  - `startHelper({ address, adapterFor, envFor, now }) -> Promise<{ address, close() }>`: an `http` server on the socket or pipe. It refuses to start if another helper answers at the address, and removes a stale socket file otherwise.
  - Requests, each a JSON `POST` with a `project` field; answers `{ ok: true, ... }` or `{ ok: false, refused: string }`:
    - `/push { dir, refspec }`: pushes one branch from a worktree or a state or lock clone.
    - `/pr/open`, `/pr/update`, `/pr/state`, `/ci`, `/issue/*`: passed to the adapter.
    - `/merge { number, stop, bypass }`: reads the PR's head commit and CI, the review and approval records from the views, checks `holdsLock`, calls `gateDecision`, and merges only if it allows, with the head commit pinned.
  - `checkPush({ refspec, dir, defaultBranch, stateBranch, lockBranch, run }) -> Promise<{ allowed: boolean, refused?: string }>`, exported for its own tests. It allows only `<branch>` or `<branch>:<same branch>` with no `+`, where the branch is not the default branch, and is a plain name (`[A-Za-z0-9._/-]`, not starting `refs/`). For `wheelhouse-state` it also requires that every commit being pushed only adds files under `events/`. For `wheelhouse-lock`, only `lock.json` may change. The push runs as `git push <remote> <branch>:<branch>` with no force flag.
  - `helperClient({ address }) -> { push, openPr, updatePr, prState, ci, merge, issue }`, each returning the helper's answer.

- [ ] **Step 1: Write the failing push-rule tests,** one per spelling in Review Focus item 1:

```js
for (const refspec of ['main', 'HEAD:main', 'refs/heads/main', '+feature', '+feature:feature',
                       ':main', ':feature', 'feature:main', 'feature:refs/heads/main', 'feature:other'])
  test(`checkPush refuses ${refspec}`, ...)
test('checkPush allows feature and feature:feature', ...)
test('a state push that changes an existing event is refused', ...)
test('a state push that only adds event files is allowed', ...)
test('a lock push that changes anything but lock.json is refused', ...)
test('the default branch is read from the host, not assumed to be main', ...)
```

- [ ] **Step 2: Write the failing helper tests,** with a fake adapter and a bare remote:

```js
test('the helper answers on a socket, and on a named pipe on Windows', ...)
test('a second helper refuses to start while the first answers', ...)
test('merge is refused with every gate reason when conditions fail', ...)
test('merge pins the head commit when the gate allows it', ...)
test('merge is refused when this computer has lost the lock', ...)
test('a push or merge refusal never includes a key', ...)
```

- [ ] **Step 3: Run `npm test`.** Expected: FAIL.
- [ ] **Step 4: Implement both files.**
- [ ] **Step 5: Run `npm test`.** Expected: PASS on the Mac, and in CI on all three systems (Windows exercises the pipe).
- [ ] **Step 6: Commit.**

```bash
git add scripts/host/helper.js scripts/host/helper-client.js tests
git commit -m "Add the host helper and its push rules"
```

### Task 15: Server-side protection

**Files:**
- Modify: `scripts/host/protection.js` (Task 3 wrote the GitLab half)
- Test: `tests/scripts/host/protection.test.js`

**Interfaces:**
- Consumes: the adapter's `run` and environment (Task 12); the GitLab functions (Task 3).
- Produces: `protectionStatus({ host, repo, run, api }) -> Promise<{ available: boolean, on: boolean, line: string }>` and `switchOnProtection(...) -> Promise<{ on: boolean, line: string }>`, where `line` is the board's one plain line:
  - GitHub, private repository on a plan without protection: `available: false`, line `"GitHub's free plan doesn't protect private projects; Wheelhouse's helper and checks hold the line."` (design section 12.3).
  - GitHub, where available (public repository, or a paid plan): a ruleset on the default branch and `wheelhouse-state` blocking direct pushes, force-pushes and deletion, and requiring status checks, through `gh api`.
  - GitLab: Task 3's `protectGitlabBranch` on the default branch and on `wheelhouse-state`.

- [ ] **Step 1: Write the failing tests** with recorded `gh api` responses: a private repository on GitHub Free (rulesets refused, as check 13 found), a public one (ruleset created), and GitLab's protected and unprotected cases.
- [ ] **Step 2: Run `npm test`.** Expected: FAIL.
- [ ] **Step 3: Implement the GitHub half.**
- [ ] **Step 4: Run `npm test`.** Expected: PASS.
- [ ] **Step 5: Commit.**

```bash
git add scripts/host/protection.js tests
git commit -m "Read and switch on the host's own protection"
```

### Task 16: End to end, and the handover

**Files:**
- Create: `tests/e2e/state-and-host.test.js`
- Modify: `HANDOVER.md`, `docs/superpowers/plans/2026-10-17-wheelhouse-foundation-checks.md` ("After this plan": mark step 1 done)

- [ ] **Step 1: Write the end-to-end test,** with a bare repository standing in for the host, a fake adapter and a real helper on a socket or pipe under a temporary `WHEELHOUSE_HOME`:

```js
test('two computers: events from both land, the lock passes on, and the old holder can no longer merge', ...)
  // computer A takes the lock, writes a ruling and its signed confirmation; B is refused the lock;
  // A's lock goes stale (fixed now + 2 h); B takes it; A's merge through the helper is refused
  // ('no longer holds the lock'); B's views show A's ruling as accepted
test('an approval written by hand without a signature changes nothing', ...)
test('a builder asking the helper to push main is refused', ...)
```

- [ ] **Step 2: Run `npm test`.** Expected: PASS on the Mac and in CI on all three systems.
- [ ] **Step 3: Update `HANDOVER.md`:** where the work stands, what this plan built, and the next plan (safety: the hooks, the sandbox and deny settings, Standard and Locked, STOP, the runbook).
- [ ] **Step 4: Commit.**

```bash
git add tests/e2e HANDOVER.md docs/superpowers/plans
git commit -m "Test state and the host end to end, and bring the handover up to date"
```

## The director's sittings

| Sitting | Computer | Tasks | About |
|---|---|---|---|
| 1 | Mac | 1 (test app, sign-in, install, undo), 2, 12 (scratch repository for fixtures) | 25 min |
| 2 | Any, if a GitLab test project exists | 3 | 10 min |

Before each sitting, the session preparing it shows the director one card listing every change it will make (a test app, scratch repositories, a project key) and how each is undone.
