// scripts/foreman/runner.js
// What the host helper runs for /foreman/run (ruling R156), and nothing else does:
//   node runner.js <helper address> <act|wake> <argument>…
// in the project's main checkout, outside the sandbox, with scripts/host/foreman-run.js's
// environment. It runs the script's own `main` with a client of the helper that started it.
// The foreman's command line is `node <root>/scripts/foreman/act.js …` (or wake.js), which
// forwards to the helper; this file is never given to a session, and run by a sandboxed one it
// can't reach the Wheelhouse home anyway.
import { helperClient } from '../host/helper-client.js';
import { startedAsScript } from '../lib/started-as-script.js';

const SCRIPTS = { act: './act.js', wake: './wake.js' };

export async function runForeman([address, script, ...argv]) {
  if (typeof address !== 'string' || address === '' || !Object.hasOwn(SCRIPTS, script)) {
    process.stderr.write('The foreman runner is run by the host helper alone\n');
    return 2;
  }
  const { main } = await import(SCRIPTS[script]);
  return main(argv, { client: helperClient({ address }) });
}

if (startedAsScript(import.meta.url)) {
  process.exitCode = await runForeman(process.argv.slice(2));
}
