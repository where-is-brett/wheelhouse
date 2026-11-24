// scripts/watcher/start-decision.js
// Prints what the waker's start decision says now, for the health check's STOP trial: `node start-decision.js <project> <work>`
// under the Wheelhouse home in the environment. It starts nothing; it prints the line a start for that piece is refused with
// (`not started: All stop` while STOP is on), or `start allowed`.
import { makeWaker } from './waker.js';
import { startedAsScript } from '../lib/started-as-script.js';

if (startedAsScript(import.meta.url)) {
  const [project, work] = process.argv.slice(2);
  try {
    const waker = makeWaker({ shape: 1, project, config: {} });
    process.stdout.write(`${waker.startDecision(work) ?? 'start allowed'}\n`);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : 'unknown error'}\n`);
    process.exit(1);
  }
}
