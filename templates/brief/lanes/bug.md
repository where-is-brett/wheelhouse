<!-- templates/brief/lanes/bug.md -->

This is the bug lane: a short session of its own. The goal above is the bug.

1. Start `superpowers:systematic-debugging`. Reproduce the bug and find its cause before any fix.
2. **You cannot reproduce it.** Write a question with `ask` that says what is missing from the report and who can supply it (the director or the reporter), and pause.
3. **It works as designed.** Make no change. Write your report with status `blocked` and the finding: what the product is meant to do and why.
4. **The cause is clear and the fix is one step.** Carry on in the quick lane's loop, with a regression test that fails before the fix and passes after it. Start `superpowers:test-driven-development` for the fix. Once it is done, start `superpowers:requesting-code-review` to review the work, dispatching its reviewers as Lookouts (`wheelhouse:reviewer`), with the model and effort the wake gives for the `reviewer` role (`reviewerCritical` for work in a critical area), never as general-purpose subagents. Commit your work to the current branch. Then finish as "How to finish" says: write `report.md` and run `report`, open the pull request with `open-pr`, then dispatch `wheelhouse:reviewer` on its head with `pr: n`.

5. **The cause is bigger than one step.** Make no fix. Write the reproduction test and your findings into the report, with status `partial`; the work joins the queue as a small change.
