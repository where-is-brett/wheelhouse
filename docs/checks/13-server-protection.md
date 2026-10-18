<!-- docs/checks/13-server-protection.md -->

# Check 13: server-side protection on the free plans

**Answer:** Partly — GitHub Free gives a private repository no protection at all; GitLab Free does.

## Question

Whether GitHub rulesets or branch protection work on private repositories on GitHub Free, and what GitLab Free offers.

## Tested on

This repository (private, GitHub Free) through the GitHub API, and GitHub's and GitLab's documentation, 17 October 2026.

## Method

Read this repository's rulesets and `main`'s branch protection with the director's own login. Creating a ruleset waits for the director's yes, since it changes the repository's settings. Read the plans' availability notes.

## Evidence

- This repository has no rulesets (`[]`) and `main` is not protected (HTTP 404, "Branch not protected").
- GitHub, protected branches: "available in public repositories with GitHub Free … and in public and private repositories with GitHub Pro, GitHub Team". Rulesets carry the same note. https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/about-rulesets
- GitLab Free has protected branches ("Tier: Free, Premium, Ultimate"), with push and merge rights set by role, and force-pushing off unless allowed. "Pipelines must succeed" is also on Free. https://docs.gitlab.com/user/project/repository/branches/protected/

## What it means for the design

- Section 12.3 stands as written: on GitHub Free, a private project has no server-side protection, and the helper and the gate carry the load. A public repository on GitHub Free does get protection, which matters for Wheelhouse itself after release (section 16).
- Section 12.3: on GitLab Free, setup can protect `main` and require pipelines to pass.
- The board's health line says which applies.

## Needs the director

Only to confirm that trying a ruleset on this repository isn't worth a card: the documentation already says it would be refused.
