// tests/fixtures/copilot/eval/fake-copilot.js
// A stand-in for Copilot CLI, for the evaluation runner's tests only (modelled on probes/64-usage/fake-copilot.js):
// `node fake-copilot.js <fixture> <log> <copilot's arguments…>`. It writes what it was started with (its arguments,
// its folder and its environment) to <log> as JSON, prints the fixture's `events` one JSON object per line, as
// `copilot -p --output-format json` does, and, given `--usage-output-file`, writes a usage file with the fixture's
// `usage`. The fields it prints are the fixture's, not evidence of anything about the real Copilot.
import fs from 'node:fs';

const [fixture, log, ...args] = process.argv.slice(2);
const given = JSON.parse(fs.readFileSync(fixture, 'utf8'));
fs.writeFileSync(log, JSON.stringify({ args, cwd: process.cwd(), env: process.env }));
for (const event of given.events ?? []) process.stdout.write(`${JSON.stringify(event)}\n`);
const at = args.indexOf('--usage-output-file');
if (at >= 0 && given.usage) fs.writeFileSync(args[at + 1], JSON.stringify(given.usage));
process.exit(given.exitCode ?? 0);
