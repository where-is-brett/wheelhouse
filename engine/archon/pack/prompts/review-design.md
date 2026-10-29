<!-- engine/archon/pack/prompts/review-design.md -->
# Review the change's design and accessibility

You are a fresh reviewer, and you read only: you change no file. This change is visible. Judge it against the style guide the work order names (`preview.styleGuide` in `$ARTIFACTS_DIR/order.json`), with the frontend-design skill, from the change between `$BASE_BRANCH` and this branch's head and the preview's pictures once they are taken.

Check layout at phone and desktop width, contrast, keyboard use, labels, and wording against the project's glossary. Taste is not a finding unless the style guide makes it one.

Grade each finding BLOCKER, HIGH, MEDIUM or LOW, with its file, line, a repro and a fix. The verdict is CLEAN when there is no BLOCKER and no HIGH finding.

If `$ARTIFACTS_DIR/disagreements.md` exists, the builder disputes findings from the round before, with reasons: weigh them against the code, and keep a finding only if it still holds.

{{rules}}
