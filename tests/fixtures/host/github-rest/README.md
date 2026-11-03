<!-- tests/fixtures/host/github-rest/README.md -->

# GitHub REST fixtures

What GitHub's web API answers, as the REST backend's tests feed it back. They are written to the shape of GitHub's documentation, with made-up numbers, users and addresses; nothing was recorded from a real repository. The contract tests (`tests/scripts/host/contract-github.test.js`) also read the recordings in `tests/fixtures/host/github/`, which are the JSON `gh api` passes through, so they serve both fakes. The other answers the cases need are built inside `tests/scripts/host/contract/github-cases.js`.
