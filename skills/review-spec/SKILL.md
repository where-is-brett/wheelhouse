---
name: review-spec
description: "For Wheelhouse's build steps: review a change against its work order's goal, scope and done checks."
---
<!-- skills/review-spec/SKILL.md -->

# Review: spec

Does the change do what the work order asked, all of it and nothing more? This is one of two review lenses that run side by side; the other, **standards**, checks how the code is written. Don't judge style here, and don't merge or rerank findings across the two.

## The fixed point and the change

The fixed point is the base branch the work order names. The change is `git diff <base>...HEAD` (three dots, so it is compared with the merge base), and its commits are `git log <base>..HEAD --oneline`. Check that the base resolves and that the diff isn't empty before anything else; a bad base or an empty diff is the blocked exit, not a review.

## Read only

The review changes nothing. Use `git diff`, `git show` and `git log`, and read files; never edit, commit, check out or move HEAD.

## No one else

Do the whole review yourself, in passes if the change is large. Never start a helper or another reviewer, and never wait for an answer from anyone: where something is unclear, say what you assumed in the finding.

## Severity

Grade each finding by its effect on the people who use the software:

- **BLOCKER**: it breaks the product, loses or exposes data, or opens a security hole.
- **HIGH**: a done check or requirement isn't met, or the change is wrong in a way users will meet.
- **MEDIUM**: worth fixing, but nothing breaks if it waits.
- **LOW**: polish.

Only BLOCKER and HIGH hold the work back. Not everything is a BLOCKER: grade by real effect, not by how sure you feel.

## Findings

Give each finding its severity, the file and line, what is wrong, how to see it (a command, a test or the steps), and the fix. Name what was done well first, in a line or two. End with the list of things you considered and set aside as outside the change, one line each with the reason, so nothing is dropped silently.

## The spec

The spec is the run's work order: its goal, what is not in scope, its done checks and the rulings it carries. Quote the line of the order each finding rests on.

The order says what the software must do; it doesn't list every input, setting or condition the software will meet. Where it is silent, judge by what a reasonable person using the software would expect: that expectation is a requirement, and silence is not permission.

Report:

1. **Missing or partial.** Goals and done checks the change doesn't meet, or meets only in part.
2. **Not asked for.** Behaviour in the change that the order didn't ask for, or that it put out of scope.
3. **Wrong.** Requirements that look met but where the change looks wrong.
4. **Tests.** A done check whose test doesn't really test it, or a test deleted, skipped or loosened. The protected-tests check runs too; look all the same.
