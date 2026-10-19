<!-- tests/fixtures/host/gitlab/README.md -->

# GitLab fixtures

What `glab` printed, as the adapter's tests feed it back. Owner and project are rewritten to `a-director/product`, and every user, numeric ID, address and commit is replaced.

**Recorded** on 18 October 2026 with `glab` 1.123.0, read-only commands against the test project from check 3:

| File | Command |
|---|---|
| `mr-view-closed.json` | `glab mr view 1 -R <project> --output json`, a closed merge request |
| `project.json` | `glab api projects/<project>`. Cut down to a few fields: the full answer also holds the project's runner token |
| `pipelines-none.json` | `glab api projects/<project>/pipelines?sha=<sha>&per_page=1` for a commit with no pipeline |
| `issue-list-empty.json` | `glab issue list -R <project> --output json` (the project has no issues) |

The recorded merge request carries `detailed_merge_status` and no `merge_status`, so the adapter reads `detailed_merge_status`.

**From documentation**, because making them needs a change to a project:

- `mr-view-open.json`, `mr-view-checking.json`, `mr-view-conflict.json`, `mr-view-merged.json`: the recorded merge request with `state` and `detailed_merge_status` set to documented values.
- `pipelines.json`, `issue-list.json`: GitLab's documented pipeline and issue shapes.
- `mr-create.txt`, `mr-update.txt`, `issue-create.txt`, `issue-update.txt`: these commands print the merge request or issue with its web address.
- `merge-refused.txt`: the error when `--sha` does not match the head of the source branch.

**Previews (front desk, Task 12), from documentation**, read on 19 October 2026: written to the shape of GitLab's "Deployments API" list, because the test project deploys nothing (nothing was recorded). Only the fields that matter are kept; users, IDs and addresses are made up.

- `deployments.json`: `glab api projects/<project>/deployments?status=success&order_by=id&sort=desc&per_page=100`, newest first: two review-app deployments of one commit, with a production deployment of another between them. Each carries its `environment` with the `external_url`.
- `deployments-none.json`: the same, with no successful deployment.
- `deployments-superseded.json` (added 19 October 2026, same page): the commit's review-app deployment, then a newer one of another commit to the same environment (`environment.id` 77), which the environment now shows.
