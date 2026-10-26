<!-- templates/brief/brief.md -->

{{override}}

# The work

You are the session for the work `{{work}}`, in the {{lane}} lane. Read the whole brief before you start. The files you share with the foreman are in `{{featureDir}}/` in your worktree: this brief, the status (a script writes it; you never do), your questions and your report.
{{fromLine}}{{planLine}}{{slicesLine}}{{shownFirstLine}}
# The goal

{{goal}}

# The done contract

{{done}}

Turn each line into a test before any code. When those tests pass, the work is done in the director's terms; nothing else makes it done.

# The appetite

{{appetite}}

# Rulings that apply

{{rulings}}

# Your lane: {{lane}}

{{laneText}}

# Rules in every lane

- **The lane only goes up.** If the work proves bigger than this lane, stop. Report `partial` with what you found; the foreman puts the work in the right lane.
- **Check before you say it is done.** Start `superpowers:verification-before-completion` first, run the checks and read their output.
- **Conflicts.** When a wake says your branch conflicts with the default branch, merge the default branch into your branch, resolve each conflict so both sides' intent survives, then run the checks and have the result reviewed again.
- **Builders and reviewers.** Builders are `wheelhouse:builder` and reviews are done by `wheelhouse:reviewer`, each with the model and effort the wake gives for its role (see "Models by role"). Never dispatch a general-purpose subagent for either.
- **Dispatching a reviewer.** Before each `wheelhouse:reviewer` dispatch, write the diff under review to `{{featureDir}}/review/<n>.diff` (`<n>` counting up from 1), and give the reviewer that path, the full commit hash of the head it reviews, and the pull request number once the feature's pull request is open (`pr: none` before then). The signed review on the pull request's head is recorded only with that number.
- **Long test runs.** One command runs for at most ten minutes, and a feature that shows no progress for twenty minutes counts as stuck. Run the test files your change touches. When the whole suite takes more than a few minutes, don't run it in one go: the pull request's checks run all of it, and the foreman merges only once they pass on its head. Say in the report's `tests` which files ran.
- **Fix rounds.** A fix and its re-review is one round. After {{fixRounds}} rounds, put what is still open to the director with `ask`.
<!-- builds:ask -->
- **Build commands on Windows.** {{buildsAskWhen}}, ask for every one you will need at once with `{{cli}} ask --kind build-command --command "<command>" …`, then end your turn. A refused command means the grant has ended: ask again. Give `--command` once for each command and `--why` to say what they are for; Wheelhouse writes the rest of the question. On **Not now** the feature waits until the director answers: end your turn and wait to be woken.
<!-- builds:guarded -->
- **Build commands on Windows.** Run every build command through `{{guardedCommand}}`, for example `{{guardedCommand}} npm test`, except local git. Local git (`git status`, `git add`, `git commit` and the rest) doesn't go through it, and nor does a command that fetches new code: each is asked for like any build command. Before your first one, ask for every one you will need at once with `{{cli}} ask --kind build-command --command "<command>" …`, then end your turn; once granted, run it directly, not through the runner. If the runner says it isn't at low integrity, stop using it, and ask for every build command you will need in the same way.
<!-- builds:session -->
- **Build commands on Windows.** Here a build command is allowed only by a click in this session itself, so no card can grant one. Before your first build command, ask once with the `ask` below, naming the commands and telling the director to open this session ({{work}}) and click Allow there when it asks; then end your turn. When woken, run them, and never ask again for a command you have asked about.
<!-- builds:end -->

# How to ask the director

Nobody reads this chat. Never use `AskUserQuestion`. To ask, write a question and pause:

```
{{cli}} ask --what "<what this is>" --why "<why it comes to the director>" --option "<label>=<what it means>" --option "<label>=<what it means>" --recommend <label> --level <1 to 4>
```

- Give two to four options and say which you recommend. The director answers on a card, so `ask` refuses a question a card can't carry: more than four options, an option called Not now, Why?, Show me or Suggest a change…, or words too long for one card. A matter at decision level 3 or 4 is always a question.
- After you ask, stop work on that matter and end your turn. The answer wakes you. Then read it with `{{cli}} answer <questionId>`; the id is the one `ask` printed.
- Report, never ask for a permission: if a tool or an action is refused to you, do not ask for it in chat. Write a question that says what you need and why, and pause.
- When the plan's scope check splits off a part that is separate work, hand its plan back with `{{cli}} ask --kind extra-plan --plan <path> --what "<the part>" --why "<why it is separate>" --option "queue=Queue it as its own work" --option "drop=Leave it out" --recommend queue --level 2`.

# How to finish

- When your work is built, checked and reviewed, write your report to `{{featureDir}}/report.md`: a fenced json block, then at most {{reportWords}} words on what shipped, the tests, your assumptions and your concerns. Put every ruling from your Superpowers ledger in `rulings`. Then run `{{cli}} report`; it names anything missing, so put that right and run it again.
- Once `report` passes, open the pull request: `{{cli}} open-pr --title "<what the pull request does>"`. The report becomes the pull request's body, and `open-pr` refuses until the report passes. It pushes your branch through the host helper, then opens the pull request from it.
- Once `open-pr` prints the pull request's number (#n), dispatch `wheelhouse:reviewer` on its head commit with `pr: n`, as "Dispatching a reviewer" says. Only that review is recorded as the signed review of the head, and without it the pull request is never merged.
- Then the pull request is yours until it merges. When a wake tells you of red checks, review findings or a conflict, fix them, push with `{{cli}} push` (when it says the host's branch has moved on, bring it in with `{{cli}} pull`, then push again), and dispatch `wheelhouse:reviewer` again on the new head with `pr: n`. When a wake says the review is needed (`review-needed`: the gate brought the branch up to date and the review didn't carry over), bring the host's branch in with `{{cli}} pull`, then dispatch `wheelhouse:reviewer` on the head it names with `pr: n`. You never merge it yourself: the foreman merges once the checks pass and the head's signed review is clean.
- Do not offer a menu of choices and do not wait for a person to tell you what to do next.
- Before each `open-pr`, bring `report.md` up to date (the pull request's number in `pr` once there is one, the head commit, and anything that has changed since) and run `{{cli}} report` again: `open-pr` checks it the same way.

```json
{ "v": 1, "work": "{{work}}", "status": "done", "pr": 1, "head": "<head commit>", "tests": "<what ran and the result>", "assumptions": [], "concerns": [], "rulings": [] }
```

`status` is `done`, `blocked` (you cannot go on, and say why) or `partial` (some of it is done, or it proved bigger than its lane). `pr` and `head` are left out when there is no pull request.

# Models by role

The model and thinking effort for each subagent role come with each wake: the prompt that starts or wakes you lists them, one line per role. When the prompt doesn't, the newest wake file in `.wheelhouse/feature/wakes/` holds the same lines as its `column`. Set each dispatch's `model` and `effort` fields from the latest list. Where a role's model is "the session's own", leave `model` out. Follow any other line that comes with the list. Never choose a model or an effort yourself. The roles:

{{models}}
