// scripts/eval/run.js
// Runs evaluation scenarios from tests/eval/ in real headless Claude Code
// sessions. Each run is a real session that costs tokens, so it is run on
// purpose, never from `npm test`.
// Usage: npm run eval -- <id…> [--variant with|without] [--trials n]
// Writes <home>/.wheelhouse-evals/<date>/<id>-<variant>-<n>.json and prints
// `<id> <variant>: pass|fail (<why>) <tokens>` for each run. A scenario whose
// pass has more than one leg has a file per leg, each named `<id>-…`; its number
// runs every leg, and `<id>-<leg>` (27-route) runs that leg alone, its records
// named `<id>-<leg>-<variant>-<n>.json`. The build loop's scenarios (20 to 35) are in
// tests/eval/build-loop/ and the front desk's (1 to 19) in tests/eval/front-desk/, a file's number
// read without its leading zero (01-…).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs, runScenario } from './harness.js';
import { startedAsScript } from '../lib/started-as-script.js';

const scenarioDirs = ['build-loop', 'front-desk'].map((name) => fileURLToPath(new URL(`../../tests/eval/${name}/`, import.meta.url)));

// Every leg of scenario `id` (a number), or the one leg `id` names (27-route), in file order.
export async function loadScenarios(id) {
  const [number, leg] = String(id).split('-');
  const found = [];
  for (const dir of scenarioDirs) {
    const files = fs.readdirSync(dir).filter((name) => /^\d+-.*\.js$/.test(name) && Number(name.split('-')[0]) === Number(number)).sort();
    for (const file of files) {
      const scenario = (await import(pathToFileURL(path.join(dir, file)).href)).default;
      if (leg === undefined || scenario.leg === leg) found.push(scenario);
    }
  }
  if (found.length === 0) throw new Error(`No scenario ${id} in ${scenarioDirs.map((dir) => path.relative(process.cwd(), dir)).join(' or ')}`);
  return found;
}

// The scenario a number names (its first leg, when it has more than one).
export async function loadScenario(id) {
  return (await loadScenarios(id))[0];
}

export async function main(argv) {
  const { ids, variants, trials } = parseArgs(argv);
  const scenarios = [];
  for (const id of ids) scenarios.push(...await loadScenarios(id));
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

if (startedAsScript(import.meta.url)) {
  main(process.argv.slice(2)).then(
    (code) => { process.exitCode = code; },
    (error) => { console.error(error.message); process.exitCode = 2; },
  );
}
