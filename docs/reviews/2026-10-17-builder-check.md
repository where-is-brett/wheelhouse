<!-- docs/reviews/2026-10-17-builder-check.md -->

# Builder check of the design, 17 October 2026

An independent reviewer read the design as if they had to build from it, and raised eight open questions. All eight are now answered in the design.

| # | Question | Resolved in | How |
|---|---|---|---|
| 1 | Where do state files live, and how do they reach both computers? | Section 9 | A `cc-state` branch in the project, checked out at `.claude/state/`, pushed straight after each write. One computer at a time, with a lock. *Designer's call* |
| 2 | What if a background foreman doesn't work in Desktop, and does work carry on while the director is away? | Section 8 | A second Desktop session first, then a headless session, never a front-desk subagent. Work carries on while the computer is awake |
| 3 | Where is the line between level 2 and level 3 for figure changes? | Sections 6 and 19 | The director's ruling: a figure fix goes live once a review is CLEAN and the figure matches its source |
| 4 | What counts as a recorded "director yes"? | Sections 9 and 12 | `approvals.json` names the commit and the director's own message. `reviews.json` is written by a hook. Agents can't write either. *Designer's call* |
| 5 | What usage budget is measured, and from where? | Section 9.1 | The director's ruling: no ceiling. Usage comes from telemetry and the weekly allowance from the status line or the mod. Budget allocation gets its own design round |
| 6 | Is GitLab needed now? | Section 11 | The adapter supports it. The first project stays on GitHub. *Designer's call* |
| 7 | Can personal Claude Code settings be changed? | Sections 3 and 15 | No. Project settings and a checklist instead. *Designer's call* |
| 8 | How are existing rules carried over, and which document wins? | Sections 3 and 9 | Matched to the director's original words. The rulebook wins. *Designer's call* |
