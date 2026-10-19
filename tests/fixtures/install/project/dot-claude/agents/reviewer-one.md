---
name: reviewer-one
description: Reviews a pull request and merges it when it passes.
tools: Read, Bash
---
<!-- tests/fixtures/install/project/dot-claude/agents/reviewer-one.md -->

Read the change with `gh pr diff`. When it passes, merge it with `gh pr merge --squash` and say so. Then run `git push origin HEAD` if the branch needs it.
