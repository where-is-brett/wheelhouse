<!-- docs/plans/adoption-plan.md -->

# Adoption plan: making Wheelhouse easy to pick up, and safe to approve

A ranked plan answering the director's question of 24 October 2026: how could Wheelhouse become as widely used as Superpowers, usable by anyone, while still offering what an enterprise needs? The evidence for every item is in `docs/research/adoption-2026-10.md`, cited by section (for example "research 2.2"). This plan is written down only: nothing in it is built until the director chooses.

## The idea in one paragraph

Superpowers won with one install command, no setup, value on the user's first ordinary request, a method told as a story, steady releases, and a place in the default marketplace (research 3). Wheelhouse can't match "no setup": it protects a product, so it needs a host and a few clicks. It can make those clicks short, show plainly what the reader gets, and look trustworthy at a glance. It also has something Superpowers lacks, a safety and audit story an enterprise can sign off. The plan keeps the quiet defaults for one person and adds a separate, written path for organisations, so neither audience has to wade through the other's choices.

## Order of work

- **Now, before the director's own first real setup:** items 1 to 4. They are small, and they fix things that would trip up anyone, the director included.
- **After the first real use on the Mac** (the order the director set on 23 October 2026): items 5 to 9. They need what real use teaches.
- **Item 10 and later** wait for the first public release.

## The ranked items

### 1. Publish a real release for v0.1.0, and put the tag in the install line

- **What.** Publish `v0.1.0` as a GitHub release with short, plain release notes that say what a director gets and what isn't tried yet. Change the README's install line from `#<tag>` to the actual tag, and update it with each release.
- **Why.** The README tells the reader to take the tag "from Wheelhouse's releases page", and that page is empty: GitHub reports no releases (research 4.1). The projects people trust release steadily with plain notes (research 2.7), and an enterprise reviewer looks for releases first (research 4.2).
- **Effort.** Small: about an hour.
- **The director decides:** whether to publish now, as an early release, or hold until after their own real use. Publishing is a level-4 approval. Recommended: publish now, marked "early", because the install line is broken without it.

### 2. Rewrite the README's first screen around the reader

- **What.** Open with what the reader will have after setup, told as a short story, as Superpowers does (research 2.3). "You describe what you want. A front desk asks you a few plain questions, agents build it, and nothing reaches your product until it passes checks." Then:
  - one example card and one example briefing, as images or quoted text;
  - three plain lines: "What it costs", "What it protects", "How to take it out again".

  Move "Status", the pilot's history and the pointers to the design and handover files lower down, under "For developers".
- **Why.** Today the first screen tells the project's history, not the reader's outcome (research 4.1). The projects compared pitch a method and an outcome (research 2.3). Token cost is the top complaint about Superpowers (research 2.8), so saying the cost up front builds trust.
- **Effort.** Small: half a day, plus the director's review of the words.
- **The director decides:** the one-sentence promise at the top. Three to choose from:
  1. "Build your product with AI agents without managing engineers."
  2. "A front desk for your AI builders."
  3. "Agents build; you decide; nothing ships unchecked."

  Recommended: the first, because it names the reader and the result.

### 3. Remove the setup stop on a project under way

- **What.** Take option 1 of the rehearsal's open card: setup switches the folder to the main line on the director's click, only when git can do it without touching their changes.
- **Why.** On a project already under way, setup stops at step 7 and needs a terminal command. In the rehearsal it stalled there for five minutes, and the sessions improvised harmful advice before the playbook was put right (research 4.1; rehearsal finding 1). A person who rarely uses a terminal gives up here.
- **Effort.** Small: one contained change to step 7, with tests.
- **The director decides:** the card already written in `docs/evals/rehearsal-project-under-way.md`. Recommended: option 1, as that card says.

### 4. Make the Node.js prerequisite impossible to miss, and friendly when missed

- **What.**
  - Put Node.js first in the README's "you need" line, with a one-click link to the installer for the reader's system.
  - Find out whether Claude Desktop ships a Node.js runtime that hooks could use. If it does, Wheelhouse could drop the prerequisite altogether.
  - Until then, make the refusal a session sees without Node.js say, in plain words, "Wheelhouse needs one free program, Node.js. Install it from nodejs.org, then start a new conversation", in place of "node: command not found". Whether a plugin can do that before Node.js exists is part of the finding.
- **Why.** A missing prerequisite produces the scariest first impression in the audit: every tool refused, with a technical message (research 4.1). Prerequisites are the top source of issues for Spec Kit, the heaviest installer compared (research 2.1).
- **Effort.**
  - The README change: small.
  - The research into Desktop's own runtime: about an hour.
  - The friendlier refusal: small to medium, depending on what the research finds.
- **The director decides:** nothing now. If the research shows the prerequisite can go, that becomes a build item for their approval.

### 5. A short demo: one real setup and first briefing

- **What.** Make two demos from the director's own first real setup:
  - a two-minute screen recording, or a step-by-step page of screenshots, showing the cards, the green board and the first briefing;
  - a written transcript of the first briefing and one build, as Superpowers' launch post did (research 2.4).

  Link both from the README's first screen.
- **Why.** Wheelhouse's value appears minutes after install, not on the first prompt, and its audience can't judge it from skill files. A demo matters more here than for the projects compared (research 2.4, reading). Spec Kit added videos once it had users, and its workflow diagram drew 70 reactions.
- **Effort.** Medium: it needs a clean real run, then editing. A demo product is used, never a real one.
- **The director decides:** whether the recording uses their voice or captions only, and which demo product to show. Recommended: captions only, on a made-up product.

### 6. Shorten setup to a first briefing, then finish the rest

- **What.** Reorder setup so the first briefing comes as soon as the product is safe: tools, host, protection and the health check. Phone notifications (step 9) and Locked (step 8) become offers in the first briefings, not steps before it. This is not a cut-down setup: everything stays. Fold this into the setup redesign already planned after the director's first setup, which merges setup's cards into one consent card (design section 15, A7).
- **Why.**
  - Today the first value comes after about nine minutes and twelve cards in the best case (research 4.1).
  - The projects compared deliver value on the first ordinary request (research 2.2).
  - Users of the most popular plugin complain about process before results (research 2.8).
- **Effort.** Medium to large; it belongs to the setup redesign.
- **The director decides:** whether phone notifications and Locked may move after the first briefing. Recommended: yes for phone notifications. Locked stays before the first briefing for a product with real users, since that is when it protects most.

### 7. A written path for organisations: the admin guide and its pieces

- **What.** A new page, `docs/organisations.md`, for an IT or security reviewer, kept out of the director's way. It gives:
  - a managed-settings snippet that installs Wheelhouse for everyone, pinned by tag and commit, with `strictKnownMarketplaces` allowing Wheelhouse and the official marketplace only (research 2.9);
  - how to require the narrow connection and Locked;
  - what the audit trail holds (signed approvals and reviews on the state branch) and how to read it;
  - what is and isn't protected, linked to `SECURITY.md`;
  - the pinned dependencies and how they are updated;
  - Copilot's enterprise-managed plugin route, once item 9 lands.

  It also adds three pieces:
  - the code-owners file the design already calls for, so changes to safety paths need the maintainer's review (design section 16);
  - keyless signing of release tags, now that the repository is public (design section 16, check 17);
  - a one-page list of what Wheelhouse installs and pins, with versions and checksums.
- **Why.**
  - An enterprise reviewer would say no today for lack of releases, signing, code owners and an admin guide, though the underlying protections are stronger than most plugins' (research 4.2).
  - Claude Code already gives administrators the controls; Wheelhouse only has to document them for itself (research 2.9).
  - The trust complaints that grow with popularity are impersonation and drift (research 2.7). Signing and pinning answer both.
- **Effort.** Medium: the page, about a day; code owners, small; signing, a day of CI work.
- **The director decides:**
  - whether "for organisations" is a goal for the first public release, or for later;
  - whether quiet defaults for one person stay as they are, with the stricter choices on this page only. Recommended: yes. One person gets the quiet defaults; an organisation sets the stricter ones once, for everyone, by managed settings.

### 8. How people contribute: narrow, plain, and gated by risk

- **What.**
  - **A CONTRIBUTING file** that says plainly what is welcome: setup reports, bug reports, tested fixes, translations of the plain-words pages. It also says what isn't welcome: new skills and agents, which belong in plugins of their own, as Superpowers says (research 2.6), and agent-written pull requests without a human summary.
  - **Issue templates.** One is "Setup got stuck", which asks for the step, the card's words and the computer; the others cover a bug and an idea.
  - **Risk tiers by path.** Changes to the safety checks are high risk and get the extra review design section 16 already requires. Documentation is low risk.
  - **A code of conduct**, and GitHub Discussions switched on for questions, rather than a chat server, until there is demand.
- **Why.**
  - The community health score is 57%, with none of these files (research 4.2).
  - Open intake without reviewers became 1,020 open pull requests against 59 merged at anthropics/skills.
  - awesome-copilot handles 1,519 merged pull requests with a gate and risk tiers (research 2.6).
  - Superpowers rejects 94%, so saying up front what is welcome saves everyone's time.
- **Effort.** Small: about half a day.
- **The director decides:** whether outside contributions open with the first public release or later. Recommended: open issues and Discussions with the first release, and pull requests from people other than the maintainer once the safety review checklist exists.

### 9. Reach Copilot users through a real plugin install

- **What.** Offer the Copilot plugin bundle Wheelhouse already builds (`adapters/copilot/plugin/`) as a Copilot plugin installed with one command from Wheelhouse's own marketplace. Keep the pasted sentence as the fallback. Then:
  - run the held VS Code check (check 70) so the tested-versions table has its first row;
  - say in the README which tier a Copilot user gets, and that Lean isn't for products with real users.
- **Why.**
  - Copilot now has plugins with a default marketplace, installed with one command or one click (research 2.1).
  - Wheelhouse's Copilot route today asks the chat to clone and follow a skill, approving each command (research 4.3).
  - Enterprise-managed plugins give organisations a way to install it for everyone (research 2.9).
  - The director ruled on 23 October 2026 that all eleven Copilot parts ship in the first public release.
- **Effort.** Medium: packaging and a marketplace file are small; check 70 needs a sitting.
- **The director decides:** whether the Copilot plugin install replaces the pasted sentence in the README, or sits beside it. Recommended: beside it until check 70 passes, then first.

### 10. Releases people can follow

- **What.**
  - **Semantic versions,** where a change in the first number means something a director must do.
  - **A release-notes file in plain words,** saying for each release what changes for a director and crediting reporters by name, as Superpowers does (research 2.7).
  - **A steady rhythm,** about monthly, with fixes between.
  - **One line in each release's notes giving the tested versions** of Claude Code and Copilot.
- **Why.**
  - Steady, visible releases with plain notes are the strongest trust signal among the projects compared.
  - Breakage when the platform moves is a top complaint (research 2.7, 2.8).
  - Wheelhouse already pins and tracks its kits (the lineage design), so the notes can say exactly what moved.
- **Effort.** Small to set up, then a little each release.
- **The director decides:** the rhythm. Recommended: monthly.

### 11. A place in the default marketplaces, after real use

- **What.**
  - **Claude Code.** Submit Wheelhouse to Claude Code's official marketplace through its submission form, so it installs with one command and no "add" step.
  - **Copilot.** Propose the Copilot plugin to awesome-copilot.
- **Why.**
  - The channel beats the content. Every project with a very large audience is in, or shipped by, the platform's default marketplace (research 3).
  - The official marketplace scans every submission and pins it by commit (research 2.6, 2.7), which also answers an enterprise reviewer.
- **Effort.** Small to submit; the outcome is outside Wheelhouse's control.
- **The director decides:** when to submit. Recommended: after the first public release and its demo, so the listing leads somewhere ready.

### 12. Answer the complaints that come with popularity, before they come

- **What.** Three small commitments, each a line in the README and a check in Wheelhouse's own tests:
  - **The cost is shown.** Show the weekly usage figure Wheelhouse already tracks, and give a plain "pause Wheelhouse in this project" that switches its start-of-session instructions off without uninstalling.
  - **Small jobs stay small.** The quick lane skips planning ceremony, and the README says so.
  - **Windows hooks are tried in CI** on each release.
- **Why.** These are the most repeated complaints about the most popular plugin: token cost, no off switch, too much process for small jobs, and Windows hooks reported 29 times (research 2.8).
- **Effort.** Small to medium. Pausing is the only new piece.
- **The director decides:** whether "pause in this project" is wanted. Recommended: yes.

## Summary for the director

| # | Item | Effort | When | The director decides |
|---|---|---|---|---|
| 1 | Publish v0.1.0 as a release; real tag in the install line | Small | Now | Publish now as early, or hold |
| 2 | README's first screen around the reader | Small | Now | The one-sentence promise |
| 3 | Setup switches the folder on a project under way | Small | Now | The rehearsal's card (option 1) |
| 4 | Node.js: impossible to miss, friendly when missed | Small | Now | Nothing yet |
| 5 | Demo from the first real setup | Medium | After real use | Captions or voice; demo product |
| 6 | First briefing sooner; the rest after | Medium to large | Setup redesign | Move phone notifications and Locked |
| 7 | A path for organisations: admin guide, code owners, signing | Medium | After real use | Is "organisations" a first-release goal |
| 8 | Narrow contribution policy, templates, risk tiers | Small | Before public release | When pull requests open |
| 9 | Copilot plugin install, and check 70 | Medium | Before public release | Beside or instead of the sentence |
| 10 | Plain release notes and a rhythm | Small | From item 1 on | The rhythm |
| 11 | Default marketplaces | Small | After public release | When to submit |
| 12 | Cost shown, pause, small jobs small, Windows in CI | Small to medium | Before public release | Whether to add "pause" |
