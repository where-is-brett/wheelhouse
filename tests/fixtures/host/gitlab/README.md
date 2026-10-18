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
