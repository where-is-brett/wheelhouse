<!-- tests/fixtures/host/github/README.md -->

# GitHub fixtures

What `gh` printed, as the adapter's tests feed it back. Owner and repository are rewritten to `a-director/product`.

**Recorded** on 18 October 2026 with `gh` 2.97.0, read-only commands against this repository:

| File | Command |
|---|---|
| `repo-view.json` | `gh repo view <repo> --json defaultBranchRef` |
| `pr-view-open.json` | `gh pr view 3 --repo <repo> --json number,url,headRefOid,headRefName,baseRefName,mergeable,state` (recorded before `headRefName` and `baseRefName` were asked for, so the file lacks them; the adapter's tests add them) |
| `pr-view-merged.json` | the same, for a merged pull request (`mergeable` comes back `UNKNOWN`) |
| `ci-success.json` | `gh api graphql` with the commit's `statusCheckRollup` (the query is in `scripts/host/github.js`) |
| `ci-none.json` | the same, for a commit with no checks (`statusCheckRollup` is null) |
| `ci-unknown-commit.json` | the same, for a commit GitHub does not have (`object` is null) |
| `issue-list-empty.json` | `gh issue list --repo <repo> --label <label> --json ...` (no issues carry the label) |

**From documentation**, written to the documented output, because making them needs a change to a repository:

- `pr-view-conflicting.json`, `ci-pending.json`, `ci-failure.json`, `issue-list.json`: recorded shapes with the documented values `CONFLICTING`, `PENDING` and `FAILURE`, and one issue.
- `pr-create.txt`, `pr-edit.txt`, `issue-create.txt`, `issue-edit.txt`: these commands print the web address of the pull request or issue.
- `merge-refused.txt`: the error `gh pr merge --match-head-commit` gives when the head has moved.

**Protection (Task 15), from documentation**, written to the shapes GitHub documents for its REST API and the status-check rollup query, because making them needs a change to a repository (nothing was recorded against a real one):

- `repo-private-free.json`, `repo-public.json`: `gh api repos/<repo>` (only the fields read).
- `user-free.json`, `user-pro.json`: `gh api user` (only `plan.name`).
- `rulesets-empty.json`: `gh api repos/<repo>/rulesets` with no rulesets.
- `ruleset-refused-free.txt`: what `gh api` prints when GitHub refuses rulesets on a private repository on the free plan.
- `ruleset-created.json`: the answer to creating a ruleset (only the fields read).
- `ci-contexts.json`, `ci-contexts-none.json`: the checks seen on the default branch's latest commit, with and without checks.

**Previews (front desk, Task 12), from documentation**, read on 19 October 2026: written to the shapes of GitHub's REST API pages "REST API endpoints for deployments" and "REST API endpoints for deployment statuses", because no repository here deploys a preview (nothing was recorded). Only the fields that matter are kept; owner, addresses and IDs are made up.

- `deployments.json`: `gh api repos/<repo>/deployments?sha=<sha>`, two deployments of the same commit, newest first.
- `deployments-none.json`: the same, for a commit with no deployment.
- `deployment-statuses.json`: `gh api repos/<repo>/deployments/<id>/statuses` for the older deployment, newest first: `success` with its `environment_url`, after `in_progress` and `pending`.
- `deployment-statuses-pending.json`: the same for the newer deployment, still `in_progress`.
- `deployment-statuses-inactive.json` (added 19 October 2026, from the same page's description of `auto_inactive`): the older deployment's statuses once another deployment to the same environment succeeded, with `inactive` newest.
