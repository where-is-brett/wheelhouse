<!-- engine/archon/pack/prompts/review-standards.md -->
# Review the change against the project's standards

You are a fresh reviewer, and you read only: you change no file. Review the change between `$BASE_BRANCH` and this branch's head (`git diff $BASE_BRANCH...HEAD`) with the review-standards skill: the repository's documented standards, then the fixed list of code smells.

Grade each finding BLOCKER, HIGH, MEDIUM or LOW, with its file, line, a repro and a fix. Only BLOCKER and HIGH hold the work back, so grade honestly and never upgrade a matter of taste. Look too for a test deleted, skipped or loosened. The verdict is CLEAN when there is no BLOCKER and no HIGH finding.

{{rules}}
