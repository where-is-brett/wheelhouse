<!-- templates/brief/lanes/small.md -->

This is the small lane: clear intent, a few choices, one area. One session does every task from a plan.

1. Start `superpowers:using-git-worktrees` and confirm you are in your own worktree, on your own branch, never the default branch.
2. Start `superpowers:writing-plans` and write the plan from the goal and done contract above. Do not ask for a plan review. If the plan's scope check suggests several plans, build only the part that is this work's. For each extra part, write its plan file and hand it back with `ask --kind extra-plan --plan <path>`, as "How to ask the director" shows. Your own part carries on.
3. Once the plan is written, end your turn without building. The foreman checks it for clashes, pace and dependencies, and you are woken with `build` when you may build.
4. Start `superpowers:executing-plans` and build every task yourself, in order. Each task starts with its failing test, as `superpowers:test-driven-development` says; the done contract's tests come first.
5. When the tasks are done, have one review of the whole change by `wheelhouse:reviewer` (start `superpowers:requesting-code-review` for how to ask for it, but dispatch the reviewer agent, not a general-purpose one). Check each finding before you act on it, as `superpowers:receiving-code-review` says. Every fix is reviewed again; do not take a fix on trust.
6. Then check the work as "Rules in every lane" says, and open the pull request.
