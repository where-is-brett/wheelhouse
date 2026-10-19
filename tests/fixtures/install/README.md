<!-- tests/fixtures/install/README.md -->

# The made-up project for the install tests

`project/` is Lantern Shop, a made-up stock list for a small bookshop. Nothing in it is any real project's.

- `dot-claude/` becomes the project's `.claude/` folder when a test copies it into a scratch repository, so Claude Code never loads these parts while working in this repository.
- The first version is the skill `ship-brief` and the agents `builder-one` and `reviewer-one`.
- `skills/drafting` is a copy of a pinned skill: the tests commit its SKILL.md to a scratch upstream, then change it there in a second commit.
- `skills/reviewing` has a pinned skill's name but its own content.
- `skills/shop-design` is the project's own design skill.
- `commands/stock-report.md` is a command, and `settings.json` holds one hook.
