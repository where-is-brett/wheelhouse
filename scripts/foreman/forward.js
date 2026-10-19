// scripts/foreman/forward.js
// The foreman's command line (ruling R156). `node <root>/scripts/foreman/act.js …` and
// `node <root>/scripts/foreman/wake.js …` run in the foreman's session, inside the project's
// sandbox, which can't read or write the Wheelhouse home their work needs. So each sends its
// folder, its name and its arguments to the host helper's /foreman/run, which runs the script
// outside the sandbox in the project's main checkout, and prints what it printed and ends with
// its exit code. The helper refuses any folder but the main checkout.
import { helperClient } from '../host/helper-client.js';

// Resolves with the exit code. `out` and `err` take text to show.
export async function forward(script, argv, {
  cwd = process.cwd(), client = helperClient(), out = (t) => process.stdout.write(t), err = (t) => process.stderr.write(t),
} = {}) {
  let answer;
  try {
    answer = await client.foreman.run({ folder: cwd, script, argv });
  } catch {
    answer = null;
  }
  if (answer?.ok !== true || !Number.isInteger(answer.code)) {
    err(`${typeof answer?.refused === 'string' ? answer.refused : 'The host helper gave no answer'}\n`);
    return 1;
  }
  if (typeof answer.stdout === 'string' && answer.stdout !== '') out(answer.stdout);
  if (typeof answer.stderr === 'string' && answer.stderr !== '') err(answer.stderr);
  return answer.code;
}
