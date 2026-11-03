<!-- tests/fixtures/host/gitlab-rest/README.md -->

# GitLab REST fixtures

What GitLab's web API (v4) answers, as the REST backend's tests and the shared contract tests feed it back. They are written to the shape of GitLab's documentation for merge requests, approvals, issues, diffs and commits, with made-up numbers, users and addresses; nothing was recorded from a real project. The contract tests also read the recordings in `tests/fixtures/host/gitlab/` (the merge request views, the project and the pipelines), which are GitLab's JSON as `glab api` passes it through, so they serve both fakes.

`mr-changes.json` is the old `/changes` answer that `glab` reads; `mr-diffs.json` is the `/diffs` list the REST backend reads. Both carry the same two files.
