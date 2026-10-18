// scripts/eval/run.js
// Runs evaluation scenarios from tests/eval/ in real headless Claude Code
// sessions. Each run is a real session that costs tokens, so it is run on
// purpose, never from `npm test`.
// Usage: npm run eval -- <id…> [--variant with|without] [--trials n]
// Writes <home>/.wheelhouse-evals/<date>/<id>-<variant>-<n>.json and prints
// `<id> <variant>: pass|fail (<why>) <tokens>` for each run.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs, runScenario } from './harness.js';

const scenarioDir = fileURLToPath(new URL('../../tests/eval/build-loop/', import.meta.url));

export async function loadScenario(id) {
  const file = fs.readdirSync(scenarioDir).find((name) => name.startsWith(`${id}-`) && name.endsWith('.js'));
  if (!file) throw new Error(`No scenario ${id} in ${path.relative(process.cwd(), scenarioDir)}`);
  return (await import(pathToFileURL(path.join(scenarioDir, file)).href)).default;
}

export async function main(argv) {
  const { ids, variants, trials } = parseArgs(argv);
  const scenarios = [];
  for (const id of ids) scenarios.push(await loadScenario(id));
  let failed = 0;
  for (const scenario of scenarios) {
    for (const variant of variants) {
      for (let trial = 1; trial <= trials; trial += 1) {
        const outcome = await runScenario({ scenario, variant, trial });
        console.log(outcome.line);
        console.log(`  saved: ${outcome.file}`);
        if (!outcome.pass) failed += 1;
      }
    }
  }
  return failed ? 1 : 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).then(
    (code) => { process.exitCode = code; },
    (error) => { console.error(error.message); process.exitCode = 2; },
  );
}
