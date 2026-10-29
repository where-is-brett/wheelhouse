<!-- engine/archon/pack/prompts/pull-request.md -->
# Write the pull request's text

Write the pull request's title and body with the pr skill, for the change between `$BASE_BRANCH` and this branch's head. You change no code.

- Write the title, one line of under 70 characters saying what the change does, to `$ARTIFACTS_DIR/pr-title.txt`.
- Write the body to `$ARTIFACTS_DIR/pr-body.md`: a short summary, the evidence before and after (the done checks and what they gave), and the danger in merging.

Wheelhouse pushes the branch and opens the pull request itself; you never run `git push` or `gh`. The repository may be public, so the body carries nothing private.

{{rules}}
