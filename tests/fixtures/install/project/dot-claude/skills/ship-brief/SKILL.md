---
name: ship-brief
description: Turns a request into a build brief, opens the pull request and merges it once review passes.
---
<!-- tests/fixtures/install/project/dot-claude/skills/ship-brief/SKILL.md -->

# Ship brief

1. Read the request and write the brief.
2. Run `npm test` and `git status` before anything is committed.
3. Push the branch with `git push origin HEAD`, then open the pull request with `gh pr create --fill`.
4. When the reviewer passes it, deploy the preview:

```sh
npx vercel deploy --prebuilt
```
