<!-- templates/brief/lanes/quick.md -->

This is the quick lane: a clear, small, reversible change. Write no plan. Work this loop:

1. Start `superpowers:test-driven-development` for the change, at pre-agreed seams where there are any. Run typechecking regularly, single test files regularly, and the full test suite once at the end.
2. Once the change is done, start `superpowers:requesting-code-review` to review the work. Dispatch its reviewers as Lookouts (`wheelhouse:reviewer`), with the model and effort the wake gives for the `reviewer` role (`reviewerCritical` for work in a critical area), never as general-purpose subagents.
3. Commit your work to the current branch.

Your task is the goal and done contract above, not a spec or tickets. The current branch is your worktree's own branch. When the loop is done, finish as "How to finish" says: write `report.md` and run `report`, open the pull request with `open-pr`, then dispatch `wheelhouse:reviewer` on its head with `pr: n`.
