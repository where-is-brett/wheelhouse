<!-- docs/checks/71-gitlab-self-managed.md -->

# Check 71: GitLab on the company's own servers

**Answer:** Partly — at Free, on a self-managed GitLab Enterprise Edition test instance behind its own certificate authority, every step ran and Wheelhouse's host code works against it. Four things differ from the design: a commit status posted with the project key stands in for a pipeline that never ran (the bot can arrange that by editing the pipeline file on its own branch), a company address with a port cannot be named in `gitlabHosts`, three error texts read wrongly (a refused project key, a stale-head merge, and an unreachable server on merge), and `--use-system-ca` with the authority in the system store was not run. Premium's half is Deferred, held for the director (H3).

## Question

C18, from section 16 of the other-agents design: on a self-managed GitLab Enterprise Edition test instance, at Free and at Premium: setup with the company's address and its own certificate authority, for Node.js, `glab` and git, on macOS and Windows; `glab`'s sign-in with and without the company's OAuth application, and the typed token; making the project key as a Maintainer, and the message when the group has switched project keys off; the protection and "pipelines must succeed" read back; whether a commit status posted with the project key can stand in for the pipeline; that protected variables don't reach a merge request's pipeline; at Premium, the approval of section 8.11, that the bot can't approve or change the rules, and that a commit added after approval removes the person's; at Free, merge by Maintainers only, the bot refused, and how the gate holds the branch once ready; audit events read as a Maintainer; and the board when the server is reachable only on the company's network.

This note covers the Free half on the Mac. Premium's approval routes, Windows and the board's wording when the server is unreachable are not covered here (see "Not run").

## Tested on

21 October 2026, macOS 27.0.1, Node.js 22.22.1, `glab` 1.123.0, git 2.54.0 (Apple Git-157), Docker 24.0.5 (Docker Desktop, 7.6 GiB for all containers). The instance is the image `gitlab/gitlab-ee:19.4.2-ee.0` with no licence loaded (`GET /license` answers `null`), so it runs as Free, with the GitLab runner `alpine-v19.4.1` (shell executor) beside it, both from `probes/lib/gitlab-ee.js`. GitLab answered at `https://localhost:8929`, with a certificate for `localhost` from a throwaway authority that no store on this computer knows. No Windows computer, Claude Code or Claude Desktop was involved.

## Method

`probes/71-gitlab-self-managed/run.js --yes` ran all eight steps once against the instance that Part 2, Task 1 had left running, with its two test people (`wh-maintainer`, a Maintainer of the probe's group, and `wh-second`, a Developer). Without `--yes`, or with `--dry-run`, it prints what it would make and run, and starts no tool; a test holds that with stand-ins for every host tool first on the PATH.

It makes a group `wh71-probe` and a project `wh71-probe/trial` of its own as the root, with a pipeline file whose one job, `probe-job`, prints whether `PROBE_SECRET` is set and never its value. Wheelhouse's own code did the work wherever the brief names it: `makeProjectKey`, `protectGitlabBranch`, `readGitlabProtection`, `makeAdapter` (every merge request was opened, read and merged through the adapter and a real `glab`), `gitlabApi` and `detectHost`. The bot is the project key's bot user; its git work was real `git clone` and `git push` over HTTPS.

Rules the probe kept, each held by a test or by the run's own check:

- **No way round the certificate.** No `-k`, no `NODE_TLS_REJECT_UNAUTHORIZED`, no `GIT_SSL_NO_VERIFY`, no `sslVerify` and no `skip_tls_verify` anywhere; the authority was given to each tool by its own setting, and each tool was also run without it.
- **No keychain or keyring.** `glab` ran with a scratch `GLAB_CONFIG_DIR` and signed in with `--insecure-storage`; its default is the operating system's keyring when one exists, which was not touched. Node.js with `--use-system-ca` ran only with the authority in no store. No keychain was made or changed.
- **Secrets stayed out of arguments and output.** A token reached a child through its environment or standard input, and the fixtures and this note were scrubbed (`<TOKEN>`, `<ID>`, `<SHA>`, `<TIMESTAMP>`) and scanned for token shapes by `tests/probes/71-gitlab-self-managed/fixtures.test.js`.
- **No browser.** `glab`'s browser sign-in was run with stand-ins for `open` and `xdg-open` that note the address they are asked for and do nothing.
- **A group setting that has no REST field** was written in GitLab's database, which is what the Settings page's checkbox writes (step 3).

The recorded responses are in `tests/fixtures/gitlab-ee/free/` (`step-1-certificates.json` to `step-8-undo.json`), each with the trials' wording, every API exchange (status and body, scrubbed) and every command's exit code and output.

## Evidence

### Step 1: Certificates

**Answer:** `NODE_EXTRA_CA_CERTS`, `glab`'s `ca_cert` and git's `http.<url>.sslCAInfo` each work, and each fails without the authority. `--use-system-ca` with no authority in any store fails like no setting at all; with the authority in the system store it was not run.

| Tool | Without the authority | With it |
|---|---|---|
| Node.js, plain `fetch` | `fetch failed`, cause `UNABLE_TO_VERIFY_LEAF_SIGNATURE`, "unable to verify the first certificate" | `NODE_EXTRA_CA_CERTS=<file>`: HTTP 200, signed in as `wh-maintainer` |
| Node.js, `gitlabApi` | `Could not reach GitLab` (the cause is not passed on) | the same setting: HTTP 200 |
| Node.js `--use-system-ca` | the same failure as no setting (authority in no store) | not run on this Mac (it needs the authority on the keychain search list; a company computer already has its own authority there) |
| `glab api user` | `tls: failed to verify certificate: x509: "localhost" certificate is not trusted` | `glab config set ca_cert <file> --host localhost:8929` in a scratch config folder: signed in as `wh-maintainer` |
| `git ls-remote` | `SSL certificate problem: unable to get local issuer certificate` (exit 128) | `http.https://localhost:8929/.sslCAInfo` in a scratch global config, no system config: exit 0, both branches listed |

Two details: `glab api user --hostname localhost:8929` is refused with `Error parsing --hostname: invalid hostname.` (a host with a port is accepted in `GITLAB_HOST`, not in `--hostname`, for `glab api`); and Wheelhouse's `gitlabApi` gives the same words, "Could not reach GitLab", for a certificate that is not trusted as for a server that is not there.

**If the answer differs:** `--use-system-ca` is the setting the design names first (section 8.11). Until it has run with the authority in the store on a company computer, Part 6 Task 2 relies on `NODE_EXTRA_CA_CERTS` pointing at the exported file, which is proved, and treats `--use-system-ca` as an extra, not the route. The unreachable-server message (Task 2, `HOST_UNREACHABLE`) must tell the two failures apart, which `gitlabApi` as it stands cannot: it needs the cause code (`UNABLE_TO_VERIFY_LEAF_SIGNATURE`, `SELF_SIGNED_CERT_IN_CHAIN`, `DEPTH_ZERO_SELF_SIGNED_CERT`, against `ECONNREFUSED`, `ENOTFOUND`, `ETIMEDOUT`), without ever repeating GitLab's or the request's text.

### Step 2: Sign-in

**Answer:** The typed token works: `glab auth login --hostname localhost:8929 --stdin --insecure-storage` with the token on standard input signs in and keeps it once, in the config file only, mode 600. The browser and device routes need an OAuth application on the company's GitLab; without one `glab` says so; with one, the browser route runs as far as asking for a person.

| Trial | Result |
|---|---|
| `glab auth login --hostname <host> --stdin --insecure-storage` | exit 0, "Logged in as wh-maintainer", "Stored your credentials in the configuration file." |
| Where the token is | `config.yml` only, once, under `token`, mode 600, `use_keyring: "false"`; the folder holds `aliases.yml`, `config.lock` and `config.yml`; `glab api user` works from that sign-in alone |
| `glab auth status` afterwards | logged in; "Git operations ... configured to use ssh protocol"; "Token found in configuration file (plaintext)"; suggests moving it into the keyring |
| `glab auth login --hostname` with nothing else, not at a terminal | `'--Stdin', '--token', '--job-token', '--web', or '--device' required when not running interactively.` |
| `--web` or `--device`, no OAuth application | `Set 'client_id' first with 'glab config set client_id <client_id> -g --host localhost:8929'.` |
| `--web`, with an application the root made (scopes `api read_user write_repository openid profile`, not confidential, redirect `http://localhost:7171/auth/redirect`) and `client_id` set | it asked to open `https://localhost:8929/oauth/authorize?client_id=...&response_type=code&scope=openid+profile+read_user+write_repository+api&code_challenge_method=S256&redirect_uri=...` and waited for a person; stopped by the 15-second timeout; nothing was signed in |
| `--device`, with the same application | `Failed to start device authorization: oauth2: "access_denied" "The resource owner or authorization server denied the request."` (an earlier hand trial, with an application limited to the `api` scope, gave the same; why GitLab refuses was not found) |

Without `--insecure-storage`, `glab` stores the token in the operating system's keyring when one is available (its own help says so); that route was not run, by the controller's ruling. The browser sign-in was not completed.

**If the answer differs:** Part 6 Task 3 keeps the typed token as the route that works wherever the company has registered no OAuth application, and says so on the card. It must decide where `glab` keeps the token: its default is the keyring, and `--insecure-storage` is the only route observed here that puts the token in a file the probe could check. Setting `git_protocol` to `https` for the host is needed, since `glab` defaults to ssh. The browser route needs the company's admin to register an application with the five scopes above; that is an item for the company, not something setup can make.

### Step 3: The project key

**Answer:** A Maintainer makes the project key at Free on self-managed (a Developer-level bot, one day, scopes `api` and `write_repository`). The group setting that switches project keys off is `resource_access_token_creation_allowed` (Settings, General, Permissions: "Allow group and project access tokens"); it exists at Free. With it off, the maintainer gets HTTP 400 and a message Wheelhouse does not recognise.

| Trial | Result |
|---|---|
| The group setting, as the group stands | `true` |
| `makeProjectKey` as the maintainer | created; the key's user is a bot (`project_<id>_bot_<suffix>`, `bot: true`) |
| `PUT /groups/:id` with `resource_access_token_creation_allowed=false` | HTTP 200; the group's JSON has no such field; the setting still read `true` afterwards. The REST group API of this version carries no field for it |
| The setting switched off in the database (what the Permissions checkbox writes) | `false` |
| `makeProjectKey` as the maintainer, setting off | `GitLab refused the request for a project key (HTTP 400)` |
| `POST /projects/:id/access_tokens`, setting off | HTTP 400, `{"message":"400 Bad request - User does not have permission to create project access token"}` |
| `GET /projects/:id/access_tokens`, setting off | HTTP 200 (the list is still readable) |
| The key made before, used while the setting is off | HTTP 200 (it keeps working) |

In GitLab's source for this version the setting is a namespace setting taken by the group Settings page (`groups/params.rb`), and found nowhere in the API or GraphQL source. The probe did not click the page: it wrote the column the checkbox writes and the refusal followed at once, so the policy reads it per request. The setting is read from the top-level group, so it also applies to every subgroup.

**If the answer differs:** `makeProjectKey`'s refusal text maps 401, 403 and 404 only; a 400 reads as "GitLab refused the request for a project key (HTTP 400)", which tells the director nothing. Part 6 Task 4 (or the card that comes from it) should map a 400 that says "does not have permission to create project access token" to a plain line: the company's group has switched project keys off; ask its GitLab admin (an owner of the top-level group) to tick "Allow group and project access tokens", or use a pasted token. Because the setting cannot be read through the API, setup cannot warn before trying; the refusal is the only signal.

### Step 4: Protection and pipelines

**Answer:** Protection and "pipelines must succeed" read back as written, and no one, including a Maintainer, can push to either branch. A commit status posted with the project key **can** stand in for the pipeline when the commit has no pipeline at all; it cannot override a pipeline that failed or was skipped.

Protection, with Wheelhouse's own code (`protectGitlabBranch` then `readGitlabProtection`), for `main` and for `wheelhouse-state`: push "No one", merge "Maintainers", force-push off, `pipelinesMustSucceed: true`. The project's settings read back `only_allow_merge_if_pipeline_succeeds: true` and `allow_merge_on_skipped_pipeline: null` (not allowed). A direct push to `main` by the bot, and by the maintainer, is refused ("You are not allowed to push code to protected branches on this project."); the bot's push to `wheelhouse-state` is refused the same way.

At Free: `GET` and `POST /projects/:id/approval_rules` answer HTTP 403; `GET /projects/:id/approvals` answers 200 and `POST` 201 (the legacy settings, with no rules); `GET` and `POST /projects/:id/external_status_checks` answer HTTP 401. The audit-event calls are in step 5.

The commit-status trials (the job is `probe-job`; the status uses that name):

| Merge request | GitLab says before | After the bot posts `probe-job` = success with the project key | Maintainer's merge |
|---|---|---|---|
| No pipeline (branch name skipped by the pipeline file's own rules) | `ci_must_pass`, no pipeline; the adapter reads "not mergeable", CI `none`; the adapter's merge: "the host's required checks have not passed"; the API: 405 | `mergeable`; the head pipeline is a new one with `source: external`, status success; the adapter reads CI `success` | **merged** |
| The branch rewrites the pipeline file so that its workflow rules match nothing (no pipeline) | `ci_must_pass`, no pipeline | `mergeable`, an `external` success pipeline | (not tried; the same state as the row above) |
| The branch rewrites `probe-job` so it passes | (no status needed) | n/a | `mergeable` by the real pipeline, source `merge_request_event`, status success |
| The job really fails | `ci_must_pass`, pipeline failed; the adapter refuses | status posted: HTTP 201; the pipeline stays failed, `ci_must_pass`. With `pipeline_id` and the branch: HTTP 404 "Pipeline for pipeline_id, sha and ref Not Found". With `pipeline_id` and no branch: HTTP 400 `{"name":["has already been taken"]}` | refused |
| The commit message says `[ci skip]` | `ci_must_pass`, pipeline status `skipped` | status posted: HTTP 201; the pipeline stays `skipped`, still `ci_must_pass` | not merged |

So at Free a Developer-level bot can get a merge request past "pipelines must succeed" if the commit has no pipeline, and it can make that so itself: the pipeline file is read from the merge request's own branch, and the bot can write it. It can also write a job of the same name that passes. Nothing at Free ties the pipeline file to the person (code owners are Premium's), and the setting that would require the pipeline's own job by name (external status checks) answers 401 at Free.

**If the answer differs:** this is the case the brief names. The setting that requires the pipeline's own job by name does not exist at Free, so Part 6 Task 4 does not add one; instead:

- the board says, for a project on Free with real users: "the project's tests on the host could be faked with Wheelhouse's key", and real-user projects need Premium's approval (Part 9 Task 5);
- `ciState` (and the merge gate's use of it) can narrow one of the two routes: a head pipeline with `source: external` is a posted status, not a run, and can be read as `none`. That closes the posted-status route and leaves the rewritten-job route (the bot's own passing job), so the board line stays;
- `readGitlabProtection` gives `skippedPipelineCounts` from `allow_merge_on_skipped_pipeline` (`null` means not allowed; the trial confirms a skipped pipeline blocks the merge), and reads Free from the approval-rules call answering 403 (`plan: 'free'`).
- The state branch at "No one pushes" refuses Wheelhouse's own direct pushes there (`protection.js` says it takes direct pushes by design), so Part 6 Task 4 must choose: "Maintainers" push for the state branch, or the state moved elsewhere on Free.

### Step 5: Protected variables

**Answer:** A merge request's pipeline from an unprotected branch does not get the protected variable. The default branch's own pipeline, after the merge, does. The value never appeared in a log.

| Trial | Result |
|---|---|
| The maintainer makes `PROBE_SECRET`, protected and masked | HTTP 201, protected, masked |
| The maintainer makes `PROBE_PLAIN`, unprotected | HTTP 201 |
| `GET /projects/:id/variables` as the maintainer | a list with `key`, `protected`, `masked` and `environment_scope` for each, and **the values as well** (the probe keeps names and flags only) |
| The bot (Developer) reads `PROBE_SECRET` | HTTP 403 |
| The merge request's pipeline (source `merge_request_event`, branch not protected) | the job printed `PROBE_SECRET is not set` |
| The default branch's pipeline after the maintainer's merge (source `push`) | the job printed `PROBE_SECRET is set` |
| The job logs hold the value | no |
| `GET /projects/:id/audit_events` and `GET /groups/:id/audit_events` as the maintainer | HTTP 403 both (no audit events at Free) |

The probe's value was a random 32-character string kept only in the state folder and in the variable; it was never printed or put in an argument.

**If the answer differs:** none. Part 6 Task 4's `variablesUnprotected` is read from the list's `protected: false`; because a Maintainer's list also returns each variable's value, the reader must drop values on the way in and name variables only ("<name> is a project secret that a merge request's pipeline could read"). The audit report on Free reads merges, pipelines and protection from the web API only; audit events are Premium's.

### Step 6: Merge by Maintainers only

**Answer:** With "Maintainers" as the merge access, the bot's merge is refused and the maintainer's is accepted. A commit pushed by the bot after the maintainer looked merges when the maintainer's merge names no commit; Wheelhouse's adapter, which always names one, is refused, but with a message that does not say why.

| Trial | Result |
|---|---|
| The bot's merge through the adapter | `merged: false`, "this sign-in is not allowed to merge it" |
| The bot's merge through the API | HTTP 401 `401 Unauthorized` |
| `wh-second`'s (a Developer) merge through the API | HTTP 401 `401 Unauthorized` |
| The maintainer's merge through the adapter | `merged: true` |
| The merge request the maintainer looked at (head is the commit looked at; CI success; mergeable) then a second commit pushed by the bot | the head moved; the new head's pipeline passed; `mergeable` |
| `glab mr merge --sha <the commit looked at>` | exit 1, `409 {message: SHA does not match HEAD of source branch: ...}` |
| The same through the adapter | `merged: false`, "GitLab did not merge the merge request" |
| The maintainer's merge through the API with no commit named | HTTP 200, state merged, **the merged head is the bot's new commit** |

Why the adapter's reason is vague: `glab` wraps its error over two lines, so the text reads "SHA does not\n  match HEAD", and `refusalOf` looks for "sha does not match" in the raw text, so it falls through to the plain fallback. The refusal itself is right; only the reason is lost.

`detectHost('https://localhost:8929/wh71-probe/trial.git', ...)`: with no `gitlabHosts` it throws ("The repository is at localhost, which is not GitHub or GitLab..."); with `['localhost']` it answers `gitlab`; with `['localhost:8929']` it throws the same way (it compares the host name without the port).

**If the answer differs:** none for the route itself: Free's merge-by-Maintainers works as section 8.11 describes, and `hostApprovalReady` for GitLab Free may be true once Part 9 Task 5 acts on this. Two limits it must carry: GitLab holds no exact commit on a Merge click that names none (a commit the bot added just before would merge with it), so the gate still has to stop the bot pushing once a branch is ready, and the audit report has to show a merge of a commit other than the one reviewed; and Part 6 Task 1's `gitlabBase` must match a remote that has a port (the origin as a whole, not `url.hostname`), and `detectHost` must take a `gitlabHosts` entry written with its port.

### Step 7: Unreachable

**Answer:** With the GitLab container stopped (`docker stop`), the adapter's reads throw errors that name the address and say "connection refused"; the adapter's `merge` does not throw: it returns `merged: false` with a plain refusal. `gitlabApi` throws "Could not reach GitLab". Started again, GitLab was ready after 51 seconds.

| Call while stopped | Result |
|---|---|
| `adapter.defaultBranch()` | throws: `glab api projects/wh71-probe%2Ftrial failed: ERROR Get "https://localhost:8929/api/v4/projects/wh71-probe%2Ftrial": dial tcp [::1]:8929: connect: connection refused.` |
| `adapter.prState(1)` | throws: `glab mr view failed: ERROR Failed to get merge request 1: Get "https://localhost:8929/api/v4/projects/wh71- probe%2Ftrial/merge_requests/1?..." : dial tcp [::1]:8929: connect: connection refused.` (the address is wrapped, with a stray space in it) |
| `adapter.branchHead('main')` | throws, the same shape |
| `adapter.merge(...)` | returns `{ merged: false, reason: "GitLab did not merge the merge request" }` |
| `gitlabApi` `GET /user` | throws `Could not reach GitLab` |
| `git ls-remote` | exit 128, `Failed to connect to localhost port 8929 after 0 ms: Couldn't connect to server` |

After `docker start`, `waitForReadiness` returned after 51 seconds. The runner shares GitLab's network, which the restart replaced, so it was restarted too (`docker restart`) and was online again; the instance is left running.

**If the answer differs:** Part 6 Task 2's `HOST_UNREACHABLE` is built on the error text: a glab error holding `dial tcp`, `connection refused`, `no such host`, `i/o timeout` or `context deadline exceeded` is "can't be reached" (and, as with step 1, a certificate failure is a different card). `merge` must stop swallowing it: a merge that could not reach the host is "not merged, host unreachable", never the same line as a refusal.

### Step 8: Undo

**Answer:** Everything the probe made was removed; `wh-maintainer`, `wh-second` and their tokens, the root's token, the runner and both containers stay for Task 3.

| What | Undo | Checked |
|---|---|---|
| The project key (and its bot user) | revoked, HTTP 204 | the key used again: HTTP 401 |
| The OAuth application | deleted, HTTP 204 | none named like it remains |
| The project and its variables, branches, merge requests, pipelines | deleted with the group (a project's first delete only schedules it; the second call with its path answered 400) | `GET` the project: HTTP 404 |
| The group `wh71-probe` | deleted (HTTP 202; GitLab only schedules deletion and renames the path), then the leftover scheduled group destroyed in GitLab's console | no group whose path starts `wh71-probe` |
| The scratch folder (the `glab` sign-ins and their config files, the bot's clone, the project key's file, the variable's value, the stand-ins) | removed | gone |
| The group setting | switched back on in step 3 | read `true` |

The people `wh-maintainer` and `wh-second` answer `GET /user` with their tokens (HTTP 200 each).

### Not run

- **Node.js with `--use-system-ca`, and the authority in the system store.** Needs the authority on the keychain search list; the controller ruled that no keychain is made or changed on this Mac. A company computer already has its authority there, so the first real sitting settles it.
- **Windows** (the same trials with `schannel` for git and the machine's store for Node.js and `glab`).
- **The browser sign-in to its end, and why the device grant is refused.**
- **Premium's half: approvals, check 68's GitLab routes.** Deferred, held for the director (H3): the trial licence is the director's to request.
- **A project on a server reachable only on the company's network**, and what the board says then.
- **The group setting through the Settings page** (it was written in the database, with the same effect on the policy).
- **A merge request approved by a person**, and the Merge click on GitLab's page naming the commit it shows: the trials used the adapter and the API.

## What it means for the design

- **Section 8.11, "What a project Maintainer can do alone":** confirmed at Free: the key (when the group allows it), protection, "pipelines must succeed", protected variables kept from merge requests' pipelines, and audit events being Premium's. Add: the key can be refused with HTTP 400, the setting being `resource_access_token_creation_allowed` on the top-level group, which cannot be read through the API.
- **Section 8.11, "What Middle needs from the tester alone":** "that is Middle's host controls in full" needs one more exception on Free: a commit status posted with the project key can stand in for a pipeline when the commit has no pipeline, and the bot can arrange that by editing the pipeline file on its own branch; so can a job of the same name written to pass. The CI file is not held to the person on Free (code owners are Premium's). The board says "the project's tests on the host could be faked with Wheelhouse's key" for real-user projects on Free; those need Premium's approval or the person's own review of the pipeline file.
- **Section 8.11, "On Free":** merge by Maintainers only is confirmed (bot and a Developer refused with HTTP 401, the maintainer accepted). The stale-head limit in the design is confirmed: a Merge naming no commit merges a commit pushed after the person looked.
- **Section 8.11, "The company's own certificate":** give `NODE_EXTRA_CA_CERTS` first; `--use-system-ca` is unproved with the authority in the store.
- **Part 6 Task 1** (`gitlabBase`, `commitEmail`): a remote with a port: compare and return the origin including the port; `detectHost`'s `gitlabHosts` entries must be allowed to carry a port; `glab` is told the host through `GITLAB_HOST`, since `--hostname` refuses a port on `glab api`; `git_protocol` to `https`.
- **Part 6 Task 2** (`company-ca.js`, `HOST_UNREACHABLE`): see steps 1 and 7: the three settings are proved, `gitlabApi` hides the cause, `merge` swallows an unreachable host.
- **Part 6 Task 3** (`glabSource`, typed token): see step 2.
- **Part 6 Task 4** (`readGitlabProtection`, `protectGitlabBranch`, `protectionStatus`): see steps 3, 4 and 5: `plan: 'free'` when `approval_rules` answers 403; `skippedPipelineCounts`; `variablesUnprotected` from names and flags only; a refused key's 400; the posted-status route and the board line; the state branch's push level; `refusalOf` must read a wrapped "SHA does not match" as "the head has moved".
- **Part 9 Task 5** (`hostApprovalReady`, Free): the merge-by-Maintainers answer is in and is yes; carry the stale-head limit and the audit-events limit (none at Free).
- **Section 16, C18:** answer as in the headline, with Premium's half Deferred.

## Needs the director

No. Premium's half (check 68's GitLab routes and check 71's approval routes) waits on the 30-day trial licence, which only the director can request (held item H3); until then it stays Deferred and Part 9 builds the Premium route from GitLab's documentation and recorded responses, behind a switch that stays off until the check passes. The board line for Free ("the project's tests on the host could be faked with Wheelhouse's key") will come to the director as a card when Part 6 Task 4 is built.
