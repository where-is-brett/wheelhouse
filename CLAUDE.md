<!-- CLAUDE.md -->

# CLAUDE.md

Guidance for Claude Code sessions in the Wheelhouse repository.

**A session started by hand starts by reading `HANDOVER.md`.** It says where the work stands, who the director is and what comes next. A session Wheelhouse starts on this repository (the front desk, the foreman or a feature session) works from its own brief and records instead, and opens `HANDOVER.md` only when its work needs it.

## What this is

Wheelhouse is a Claude Code plugin: skills, agents, hooks, scripts and a mod. It lets a non-developer product owner (the director) run AI agents that build their product. The design is `docs/specs/2026-10-17-wheelhouse-design.md`.

## Where the work stands

- **Built, and released by tag.** The design is approved; its rulings are in section 22 of the design. New work follows a build plan (`superpowers:writing-plans`) or comes through Wheelhouse's own intake.
- **The repository is public.** Wheelhouse's records (its state, cards, briefs, the board and transcripts) never go into it, and nor does anything about the director's other projects.
- **Testing.** Run the test files a change touches. The whole suite (`npm test`) takes about 40 minutes on the Mac and runs under two git setups, so leave it to CI unless a change touches many parts.
- **Each project stays separate.** The first project Wheelhouse will be used on keeps its own rules in its own repository, not here.

## Conventions

- **Language.** British or Australian English everywhere. Dates as day month year (17 October 2026).
- **Path comment.** Every file starts with a comment giving its repository-relative path, for example `<!-- docs/specs/x.md -->` or `// src/x.ts`. Formats without comments, such as JSON, are exempt. Where a file needs front matter, the comment goes straight after it.
- **Naming.** Don't use words such as "enhanced", "improved" or "fixed" in names, comments or user-facing text. Describe what a thing is, not how it differs from before.
- **Pronouns.** Refer to the director as "the director", with they/them.
- **No model identifiers** in commits, pull requests, code comments or other repository content.
- **Scripts and hooks** are written in Node.js, so they run on macOS and Windows.
- **Talking to the director:** briefly, in plain words, as to a product owner.
  - Every question is a card: what this is, why it comes to them, the options, a recommendation, and what happens meanwhile.
  - Each question offers clickable options.
  - Never talk to other agents in front of them.
