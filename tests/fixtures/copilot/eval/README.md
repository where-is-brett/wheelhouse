<!-- tests/fixtures/copilot/eval/README.md -->

# The Copilot evaluation's fixtures

Every fixture here is written by hand.

- `fake-copilot.js`: a stand-in for Copilot CLI that prints a fixture's events, for the runner's tests (tests/scripts/agents/copilot-eval-runner.test.js).

The four Copilot scenarios (38 to 41) play on the build engine now (tests/eval/copilot/, Archon design section 13), so they need no fixture of Copilot's events.
