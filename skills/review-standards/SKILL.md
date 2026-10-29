---
name: review-standards
description: "For Wheelhouse's build steps: review a change against the repository's documented coding standards and a fixed list of code smells."
---
<!-- skills/review-standards/SKILL.md -->

# Review: standards

Does the change follow how this repository says code should be written? This is one of two review lenses that run side by side; the other, **spec**, checks the change against the work order. Don't judge the spec here, and don't merge or rerank findings across the two.

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

## The standards

Anything in the repository that documents how code should be written: `CONTRIBUTING.md`, `CODING_STANDARDS.md`, `CLAUDE.md` or `AGENTS.md`, a style guide, the linters' settings. Cite the file and the rule for every finding against them. Skip anything the tooling already enforces.

On top of whatever the repo documents, the Standards axis always carries the **smell baseline** below: a fixed set of Fowler code smells (_Refactoring_, ch.3) that applies even when a repo documents nothing. Two rules bind it:

- **The repo overrides.** A documented repo standard always wins; where it endorses something the baseline would flag, suppress the smell.
- **Always a judgement call.** Each smell is a labelled heuristic ("possible Feature Envy"), never a hard violation. Like any standard here, skip anything tooling already enforces.

Each smell reads *what it is* → *how to fix*; match it against the diff:

- **Mysterious Name**: a function, variable, or type whose name doesn't reveal what it does or holds. → rename it; if no honest name comes, the design's murky.
- **Duplicated Code**: the same logic shape appears in more than one hunk or file in the change. → extract the shared shape, call it from both.
- **Feature Envy**: a method that reaches into another object's data more than its own. → move the method onto the data it envies.
- **Data Clumps**: the same few fields or params keep travelling together (a type wanting to be born). → bundle them into one type, pass that.
- **Primitive Obsession**: a primitive or string standing in for a domain concept that deserves its own type. → give the concept its own small type.
- **Repeated Switches**: the same `switch`/`if`-cascade on the same type recurs across the change. → replace with polymorphism, or one map both sites share.
- **Shotgun Surgery**: one logical change forces scattered edits across many files in the diff. → gather what changes together into one module.
- **Divergent Change**: one file or module is edited for several unrelated reasons. → split so each module changes for one reason.
- **Speculative Generality**: abstraction, parameters, or hooks added for needs the spec doesn't have. → delete it; inline back until a real need shows.
- **Message Chains**: long `a.b().c().d()` navigation the caller shouldn't depend on. → hide the walk behind one method on the first object.
- **Middle Man**: a class or function that mostly just delegates onward. → cut it, call the real target direct.
- **Refused Bequest**: a subclass or implementer that ignores or overrides most of what it inherits. → drop the inheritance, use composition.

Documented-standard breaches can be BLOCKER or HIGH; a baseline smell is at most MEDIUM, since it is a judgement call.
