<!-- engine/archon/pack/prompts/repair.md -->
# Put back what the change must not take away

You are the builder, sent back once. The checks before review found that this change deletes, skips or loosens a test, or changes a file that steers agents:

- Tests: $tests.output.findings
- Files that steer agents: $controls.output.paths

Put back each test that was deleted, skipped or loosened, and undo each change to a file that steers agents, unless the work order in `$ARTIFACTS_DIR/order.json` lists that file. Keep the rest of the change. When the goal can't be reached without the change, take the blocked exit at level 3 and say why. Commit what you put back, and leave nothing uncommitted. Run the full suite once before you finish.

Report a one-paragraph summary of what you put back, and your assumptions.

{{rules}}
