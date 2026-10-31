<!-- CONTRIBUTING.md -->

# Contributing

Wheelhouse is early, and one maintainer looks after it. Reports of what went wrong are the most useful thing you can send, and you don't need to be a developer to send one.

## Reporting a problem

Open an [issue](https://github.com/where-is-brett/wheelhouse/issues/new/choose) and say what happened in your own words. Issues are public, so leave out passwords, keys and anything private about your product.

If you've found a way round Wheelhouse's protections, report it privately instead: [`SECURITY.md`](SECURITY.md) says how.

## Changing something

Open an issue before starting anything large, so we can agree the shape of it first. By contributing, you agree that your work is licensed under the [Apache License 2.0](LICENSE).

You need Node.js 22 or later. Wheelhouse has no npm dependencies, so there is nothing to install. Change the mod, and you also need Claude Code for `npm run mod-check`.

Run the test files your change touches:

```bash
node --test --import ./tests/helpers/test-home.js tests/github/plan.test.js
```

`npm test` runs everything, which takes about 40 minutes on a Mac, so leave that to CI unless your change touches many parts. A pull request runs the tests on Linux, and a merge to `main` runs them on Linux and macOS.

## Conventions

[`CLAUDE.md`](CLAUDE.md) has the full list. The ones that catch people out:

- **Language.** British or Australian English, with dates as 17 October 2026.
- **Path comment.** Every file starts with a comment giving its repository-relative path. Formats without comments, such as JSON, are exempt.
- **Naming.** Describe what a thing is, not how it differs from before, so avoid words such as "enhanced", "improved" or "fixed".
- **Scripts and hooks** are written in Node.js, so they run on macOS and Windows.
- **User-facing text** is plain and short: the reader isn't a developer.
- **Nothing private.** This repository is public. Nothing from a project Wheelhouse is used on goes in it.

## Finding your way around

- [`docs/specs/2026-10-17-wheelhouse-design.md`](docs/specs/2026-10-17-wheelhouse-design.md): the design. Section 22 has its rulings.
- [`docs/specs/2026-10-29-wheelhouse-on-archon-design.md`](docs/specs/2026-10-29-wheelhouse-on-archon-design.md) and [`docs/engine/`](docs/engine/): how the build engine fits.
- [`docs/checks/`](docs/checks/): what was tried on real tools, and what it showed.
- [`docs/evals/`](docs/evals/): the evaluation of the agents' behaviour.
- [`docs/lineage/upgrading.md`](docs/lineage/upgrading.md): moving the pinned upstream skills, and releases.
- [`docs/data.md`](docs/data.md): where a user's records go, and what uninstall removes.
- [`SECURITY.md`](SECURITY.md): the protections, their limits and the threat model's starting points.

## Cutting a release

Releases are tags on `main`, published on GitHub as pre-releases for now.

1. Follow "Then cut a Wheelhouse release" in [`docs/lineage/upgrading.md`](docs/lineage/upgrading.md): raise the version in `.claude-plugin/plugin.json`, then write and verify the manifest. Its pull request also needs the items below.
2. Change the release's name in `README.md`, where the install lines and the status lines give it. A test records the fingerprint of `plugin.json`: its failure names the file and gives the new value.
3. Run CI by hand on the branch with macOS ticked (Actions, CI, Run workflow).
4. Once it merges, tag the merged commit and publish the notes:

   ```bash
   git tag -a v0.0.0 -m "Wheelhouse v0.0.0" <merged commit>
   ```

   ```bash
   git push origin v0.0.0
   ```

   ```bash
   gh release create v0.0.0 --title v0.0.0 --prerelease --notes-file <notes file>
   ```

A tag can't be moved or deleted once it is pushed, because every install line pins one. A bad release gets a new release after it, not a changed tag.
