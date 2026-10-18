<!-- docs/checks/22-gitlab-keys.md -->

# Check 22: GitLab project keys

**Answer:** Yes, with a change — setup made a one-day project key from the director's `glab` sign-in on GitLab.com Free, where the documentation says it could not; the key pushed, opened and closed a merge request, was refused a direct push to the protected branch and stopped working when revoked. The change is that the key is wider than the design says and Free cannot be relied on to work, and merging with a Developer key is still untried.

## Question

Whether setup can make a project access token from the director's sign-in, on which GitLab plans, and with which scopes; and whether GitLab's own code sign-in can be narrowed to one project.

## Tested on

The documentation table was read on 18 October 2026 at docs.gitlab.com (the pages are linked in it). The live trial ran the same day on macOS 27.0.1 with Node 22.22.1 and `glab` 1.123.0, signed in to gitlab.com as the director, with the token kept in the operating system's keyring. It used a private test project in the director's personal namespace on GitLab.com; read with `glab api namespaces/<name>`, the namespace plan was "free" and no trial was running. The trial made one project key (Developer level, one day), a branch and a merge request, and revoked the key; the branch was deleted and the merge request closed. The default branch's protection was switched on and left on (check 23). No Windows computer, Claude Code or Claude Desktop was involved.

## Method

Each documentation fact was taken from the page linked beside it. `makeProjectKey` was written to what the pages say and tested with a fake `api`. The live trial was `probes/22-gitlab/run.js <group/project> --scratch --yes`, run once the director agreed. It made the key with the director's sign-in and used the key for each step below, printing one line each. The director's part was agreeing to the card.

The first real run stopped before touching GitLab: with keyring storage `glab` prints "Token found in operating system keyring:" and not "Token found:", so the probe judged `glab` signed out. The probes for checks 21 and 22 now read that line too (commit 881d084).

## Evidence

From the documentation:

| Question | What the documentation says | Source |
|---|---|---|
| Which plans have project access tokens? | GitLab.com: "require a Premium or Ultimate subscription", so not Free. Self-managed and Dedicated: "available with any license". The permissions page adds that on GitLab.com trial licences are excluded; the tokens page says a trial is limited to one token. The two pages differ on trials. | [Project access tokens](https://docs.gitlab.com/user/project/settings/project_access_tokens/), [Roles and permissions](https://docs.gitlab.com/user/permissions/) |
| Who may make one? | Users with the Maintainer or Owner role on the project. A key cannot have a higher role than the person making it. | [Roles and permissions](https://docs.gitlab.com/user/permissions/), [Project access tokens API](https://docs.gitlab.com/api/project_access_tokens/) |
| Through the API? | `POST /projects/:id/access_tokens`. Needs `name` and `scopes`; `access_level` (default 40, Maintainer; 30 is Developer; 50 is Owner) and `expires_at` are optional. The reply carries `id`, `expires_at` and `token`. The page says to authenticate with a personal access token, and that a project access token cannot make another. It does not say whether the OAuth token from `glab`'s sign-in is accepted. | [Project access tokens API](https://docs.gitlab.com/api/project_access_tokens/) |
| Longest life | By default 365 days from today (also the default if none is given). Administrators of self-managed GitLab 17.6 or later can change the maximum; a feature flag, off by default, allows 400. Tokens end at midnight UTC on the date. | [Project access tokens](https://docs.gitlab.com/user/project/settings/project_access_tokens/) |
| Scopes to push, and to open and merge merge requests | `write_repository` is "pull and push over Git-over-HTTP" and "does not support API authentication". `api` is read and write access to the REST API. A project key therefore needs both: `write_repository` to push, `api` to open and merge merge requests. `api` alone does not allow Git pushes for project keys. | [Token scopes](https://docs.gitlab.com/security/tokens/access_token_scopes/) |
| Revoking | `DELETE /projects/:id/access_tokens/:token_id` answers 204. Each key makes a bot user, a member of the project, whose work is attributed to the bot; revoked keys are deleted after 30 days. | [Project access tokens API](https://docs.gitlab.com/api/project_access_tokens/), [Project access tokens](https://docs.gitlab.com/user/project/settings/project_access_tokens/) |
| Does the OAuth device grant exist? | Yes. `POST /oauth/authorize_device`, then poll `POST /oauth/token` with grant type `urn:ietf:params:oauth:grant-type:device_code`; the person types the code at `/oauth/device`. Listed for GitLab.com, self-managed and Dedicated. The page gives two start versions (17.1 in one place, 17.2 in its history, on by default in 17.3, generally available in 17.9). | [OAuth 2.0 API](https://docs.gitlab.com/api/oauth2/) |
| Which scopes can it ask for? | The same list as any GitLab OAuth application: `api`, `read_api`, `read_user`, `read_repository`, `write_repository`, `openid`, `profile`, `email` and others. So it can be narrower than `api` by kind of access. The pages do not say a scope can be limited to one project or group, so a code sign-in cannot be narrowed to one project. | [OAuth provider](https://docs.gitlab.com/integration/oauth_provider/) |
| How is an OAuth token sent? | `Authorization: Bearer <token>`. A project key is sent in the `PRIVATE-TOKEN` header. `gitlabApi` supports both (`bearer: true`). | [REST API authentication](https://docs.gitlab.com/api/rest/authentication/) |

From the live trial, 18 October 2026:

| Trial | Expected | Result |
|---|---|---|
| Make a one-day project key with `glab`'s sign-in | Created on Premium or Ultimate; not on Free | Created, on Free (id 28538482, expiry 18 October 2026) |
| Clone with the key | Works | Works |
| Push a branch with the key | Works | Works |
| Open a merge request | Works | Opened (!1) |
| Close it | Works | Closed |
| Push directly to the default branch with the key | Refused | Refused: "You are not allowed to push code to protected branches on this project." |
| Unprotect the default branch with the key | Refused (a Developer may not) | Refused: HTTP 403 |
| Revoke the key | HTTP 204 | HTTP 204 |
| Use the revoked key | HTTP 401 | HTTP 401 |

The key was made on GitLab.com Free, although the documentation says project access tokens there need Premium or Ultimate. That is what was observed; the trial gives no reason for it, and one namespace on one day does not show it holds for every Free account.

What the documentation left open, item by item:

1. **Is `glab`'s sign-in token accepted by the create call?** Yes. Shown: the call succeeded with `glab`'s token.
2. **What does GitLab.com Free answer with?** Not shown. It made the key, so no refusal was seen. Setup still needs a refusal handler, because other Free accounts may differ.
3. **Can the key push a branch, open and close a merge request, and not push to a protected branch?** Shown for a Developer-level key: it pushed a branch, opened and closed a merge request, and was refused a direct push to the default branch (protected to "no one") and an unprotect (HTTP 403).
4. **Does a revoked key stop working at once?** Shown: HTTP 401 straight after the revoke.

Not tried:

- **Merging a merge request with the Developer key.** The merge request was closed, not merged. The default of Developer level rests on GitLab letting a Developer merge when merge access is "Developers + Maintainers"; that has not been seen.
- **A Maintainer-level key** (`--maintainer`), so the claim that it could unprotect `main` is still from the documentation.
- **Trial licences** and **self-managed or Dedicated** GitLab.
- **How long the director's part took.** It was not timed.

## What it means for the design

- **Section 11, "Narrow on GitLab": the key is not "limited to its code and merge requests".** The scope `api` is read and write on the whole project's API, and a Maintainer-level key can change protected branches and project settings (check 23), which is why the key is made at Developer level. Say instead: "limited to that one project, with its code, merge requests and settings", and name the difference from GitHub's app, whose key cannot reach settings. The table row "What agents could reach if one got the key" needs the same wording for GitLab.
- **Plans.** Replace "where the director's plan has project access tokens" with: GitLab.com Premium and Ultimate, and any self-managed or Dedicated plan. Setup tries the key first on every plan, and falls back to the pasted token if GitLab refuses. The trial made a key on GitLab.com Free where the documentation says it cannot, so the plan is not a reliable guide. The pasted token is a personal access token of the director, which is wider, and the card says so.
- **The key is a Developer's, with merge allowed to Developers, so it can't undo the protection.** `makeProjectKey` makes a Developer key (level 30) by default, and `protectGitlabBranch` protects the default branch with push "no one" (0), merge "Developers + Maintainers" (30) and force-push off. Such a key can push branches, open merge requests and merge them, but cannot push to the default branch, and, since the documentation gives managing protected branches and project settings only to Maintainers and Owners, cannot change the protection. A Maintainer's key (level 40, `accessLevel: 40` and `mergeAccess: 40`) stays available, but with the `api` scope it could unprotect `main` and then push to it, so it is not the default. The trial showed the Developer half (a direct push and an unprotect were both refused); the Maintainer half, and a Developer key merging, are untried.
- **Merge requests show the bot, not the director.** Work from a project key is attributed to its bot user. The design says pull requests show the director's name via the GitHub app; that holds for GitHub only.
- **Expiry.** The 365-day limit is met (`makeProjectKey` refuses more). The board's 14-day renewal card applies as written; renewing means making a new key, since a project key cannot make one.
- **Section 20, check 22:** Yes, with the change above.

## Needs the director

Not now. The trial is done. Only a Developer key merging a merge request remains, and it can be tried in the pilot, on the first real project with a pipeline, without a card now.
