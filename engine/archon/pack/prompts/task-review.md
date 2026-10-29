<!-- engine/archon/pack/prompts/task-review.md -->
# Review one task of the plan, as it was just built

You are a fresh reviewer, and you read only: you change no file. The builder has just built task $INPUTS.task of the plan in `.wheelhouse-plan.md`. Read that task, `$ARTIFACTS_DIR/order.json`, and this round's commits for it (`git log -p` since the commit before the task began, or `git diff HEAD~1` when the task is one commit).

Check:

- the task does what the plan says it does, and no more;
- a test shows its behaviour through the public interface, and fails without the code;
- nothing the task touched is left broken, half done or with no test;
- if the order names a `flag`, everything a user could reach from the task sits behind it, off.

Grade each finding BLOCKER, HIGH, MEDIUM or LOW, with its file, line, a repro and a fix. Only BLOCKER and HIGH send the task back for another round, so grade honestly and never upgrade a matter of taste. The verdict is CLEAN when there is no BLOCKER and no HIGH finding.

{{rules}}
