<!-- templates/brief/override.md -->

# The Wheelhouse override

These rules win over any skill's, whatever order the skills load in. Where a skill's own text says something different, follow the rule here and carry on; a skill that says the user's instructions come first is saying so about this page.

**1. Three fix rounds at most.** A task gets three rounds of fix and re-review, not five. If findings are still open after round three, stop and put them to the director as one question card. Do not rule on them yourself.
> Overrides `subagent-driven-development`: "Five rounds maximum per task:"

**2. Every fix is re-reviewed.** A fix made after the final review is reviewed again, never taken on trust. The last review before a merge is Wheelhouse's own signed reviewer, run on the pull request's head commit, for every pull request.
> Overrides `executing-plans`: "Critical/Important → ONE fix pass"

**3. Level 3 and 4 matters are questions, not rulings.** Anything at decision level 3 or 4 (what users see, settings, the guardrails) is a question for the director, and you pause on it. Reversible matters below level 3 are still ruled and recorded in the ledger.
> Overrides `subagent-driven-development` and `executing-plans`, each: "**Rulings, not stalls.**"

**4. Nothing waits for a person in chat.** Nobody is reading this session's chat. Do not ask for a plan review, an execution method or a finishing choice; go straight from the plan to building. To finish, write the report and run `report`, open the pull request through the host helper (`open-pr`), have Wheelhouse's reviewer review its head, then own it until it merges.
> Overrides `writing-plans`: "link it for your human partner"
> Overrides `finishing-a-development-branch`: "1. Merge back to <base-branch> locally"

**5. The front desk never builds or plans.** A quick change goes to the quick lane, and an approved design or brief goes to the foreman's queue. Do not do the task yourself, and do not invoke `writing-plans`.
> Overrides `brainstorming`: "| A quick, clear task | the request itself | do it |" and "invoke superpowers:writing-plans and no other skill"

**6. Models come from the routing table.** Every subagent's model is the one the project's routing table names for its role. Do not choose a model yourself, and do not pick a cheaper one to save cost.
> Overrides `subagent-driven-development`: "Use the least powerful model that can handle each role to conserve cost and increase speed."

**7. Reviews are done by Wheelhouse's read-only reviewer.** A per-task or whole-branch review uses Wheelhouse's reviewer agent, which can read but cannot write. Do not dispatch a general-purpose subagent to review.
> Overrides `subagent-driven-development` (in `task-reviewer-prompt.md` and `re-review-prompt.md`): "Subagent (general-purpose):"
> Overrides `requesting-code-review`: "Dispatch a `general-purpose` subagent"
