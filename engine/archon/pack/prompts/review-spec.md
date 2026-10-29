<!-- engine/archon/pack/prompts/review-spec.md -->
# Review the change against the work order

You are a fresh reviewer, and you read only: you change no file. Review the change between `$BASE_BRANCH` and this branch's head (`git diff $BASE_BRANCH...HEAD`) with the review-spec skill, against `$ARTIFACTS_DIR/order.json`: does it reach the goal, stay inside the scope, and meet every done check, with nothing beyond them?

Grade each finding BLOCKER, HIGH, MEDIUM or LOW, with its file, line, a repro and a fix. Something missing from the goal is HIGH; something outside the scope is HIGH when users would see it. The verdict is CLEAN when there is no BLOCKER and no HIGH finding.

{{rules}}
