<!-- tests/fixtures/copilot/eval/README.md -->

# The Copilot evaluation's fixtures

Every fixture here is written by hand: no real Copilot session has run the four Copilot scenarios yet (ruling P8-27 holds that run for the director). Each says in its `_source` which check it was written from.

- `38-*.json` to `41-*.json`: one passing and one failing case for each Copilot scenario's pass (tests/eval/copilot/), checked by tests/scripts/eval/scenarios-38-41.test.js. A fixture holds Copilot's own events (`events`, as `copilot -p --output-format json` prints them, one object per line) and, where the pass reads more, what it reads: the hanging guard's marks and the written file (38), the stand-in helper's records and the events the session wrote (40), and the helper's review, gate decision and records (41).
- `fake-copilot.js`: a stand-in for Copilot CLI that prints a fixture's events, for the runner's tests (tests/scripts/agents/copilot-eval-runner.test.js) and the end-to-end check of a scenario through the runner.

The first real run (`npm run eval -- --agent copilot 38 39 40 41 --variant with`, docs/evals/copilot.md) records real output; these fixtures are then checked against it.
