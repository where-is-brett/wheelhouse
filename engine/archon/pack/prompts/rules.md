<!-- engine/archon/pack/prompts/rules.md -->
## Rules for every step

- **There is no person to ask.** Nobody reads this step while it runs, and a question would wait until the step times out. Decide within the work order, its rulings and its decision rules, and record each choice as an assumption in your output. A level 3 or 4 question is the one exception: take the blocked exit, with the question in plain words for a product owner, two to four options and the one you recommend.
- **Earlier rounds' committed code stands.** In a loop, work committed in an earlier round was written test-first and is kept: build on it, and never delete it as code written before a test. Run only the tests in focus while you work, and the full suite once, at the end.
- The work order is in `$ARTIFACTS_DIR/order.json`. Read it first. It is a copy for reading: changing it changes nothing, since Wheelhouse checks against its own.
- Build on the branch as it is: never rebase, merge, pull, switch or check out another commit. The run's own settings sit over `.claude/settings.json`, and git refuses those moves while they do.
- Never run `archon`, and never read Archon's database, logs or other runs' folders.
- Keep every private record out of the code, commits and the pull request: no work order text beyond the goal, no names, no paths outside the project.
- Write in plain British English.
