<!-- templates/brief/lanes/quick.md -->

This is the quick lane: a clear, small, reversible change. Write no plan. Work this loop, which is Matt Pocock's `/implement` word for word:

<!-- implement:begin -->
Implement the work described by the user in the spec or tickets.

Use /tdd where possible, at pre-agreed seams.

Run typechecking regularly, single test files regularly, and the full test suite once at the end.

Once done, use /code-review to review the work.

Commit your work to the current branch.
<!-- implement:end -->

Where the loop says `/tdd`, start `mattpocock-skills:tdd` by name. Where it says `/code-review`, start `mattpocock-skills:code-review` by name, after the tdd work is done. Matt's code-review runs as it is written, but dispatch its reviewers as `wheelhouse:reviewer`, with the model named for the `reviewer` role (`reviewerCritical` for work in a critical area), never as general-purpose subagents. Your task is the goal and done contract above, not a spec or tickets. The current branch is your worktree's own branch. When the loop is done, finish as "How to finish" says: write `report.md` and run `report`, open the pull request with `open-pr`, then dispatch `wheelhouse:reviewer` on its head with `pr: n`.
