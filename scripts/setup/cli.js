// scripts/setup/cli.js
// Setup's one command, as `node "<pluginRoot>/scripts/setup/cli.js" <form>`, run in the folder
// being set up:
//   plan <step>          the step's list of changes and its card, as AskUserQuestion's question,
//                        with the list's hash: { step, title, hash, director, changes, card }
//   apply <step> <hash>  asks the helper to apply the step, with the full hash `plan` gave; the
//                        helper goes ahead only after the director's click on the card naming it
//   status               where setup stands in this folder, as plain lines
//   resume               where setup stands, and the plan of the first step neither done nor
//                        running: { lines, next, plan }, with plan null when there is none
// The playbook (wheelhouse:setup) runs in the sandbox and only talks: every change is the
// helper's, so every form is a request to its /setup/* routes, naming this folder, and nothing here
// reads or writes a file. A request carries only the folder, the step and the hash; the helper
// works out the list itself. `plan`, `status` and `resume` only read (resume asks for the status,
// then one plan), and the STOP guard lets them through; `apply` is refused under STOP.
// Errors are one line on standard error.
import path from 'node:path';
import { helperClient } from '../host/helper-client.js';
import { SETUP_TITLES } from '../state/card-lines.js';
import { startedAsScript } from '../lib/started-as-script.js';

// An error whose message is said to the session as it is.
export class CliError extends Error {}

export const USAGE = 'Commands: plan <step>, apply <step> <hash>, status, resume';
const STEP = new RegExp(`^(?:${Object.keys(SETUP_TITLES).join('|')})$`);
const HASH = /^[0-9a-f]{64}$/;
const BREAKS = /\s*[\r\n\v\f\u0085\u2028\u2029]+\s*/g;

// Asks one route and gives its answer when it is ok; otherwise the helper's own words.
async function ask(route, body) {
  let got;
  try {
    got = await route(body);
  } catch (error) {
    throw new CliError(`The host helper didn't answer: ${error instanceof Error ? error.message : 'unknown error'}`);
  }
  if (got?.ok !== true) throw new CliError(got?.refused ?? got?.why ?? 'The host helper refused the request');
  return got;
}

function stepOf(text) {
  if (!STEP.test(String(text))) throw new CliError(`Give the step as a number from 1 to ${Object.keys(SETUP_TITLES).length}`);
  return Number(text);
}

async function plan(client, folder, step) {
  const got = await ask(client.setup.plan, { folder, step });
  return { step, title: SETUP_TITLES[step], hash: got.hash, director: got.director, changes: got.changes, card: got.card };
}

// Runs a form and resolves with the exit code. `out` and `err` take text to show.
export async function main(argv, {
  cwd = process.cwd(), client, out = (t) => process.stdout.write(t), err = (t) => process.stderr.write(t),
} = {}) {
  try {
    const [form, ...rest] = argv;
    const json = (value) => out(`${JSON.stringify(value, null, 2)}\n`);
    const folder = path.resolve(cwd);
    if (form === 'plan' && rest.length === 1) {
      const step = stepOf(rest[0]);
      json(await plan(client ?? helperClient(), folder, step));
    } else if (form === 'apply' && rest.length === 2) {
      const step = stepOf(rest[0]);
      if (!HASH.test(rest[1])) throw new CliError('Give the full hash of the list on the card, as plan gave it');
      const { ok, ...answer } = await ask((client ?? helperClient()).setup.apply, { folder, step, hash: rest[1] }); // eslint-disable-line no-unused-vars
      json(answer);
    } else if (form === 'status' && rest.length === 0) {
      const got = await ask((client ?? helperClient()).setup.status, { folder });
      out(`${(Array.isArray(got.lines) ? got.lines : []).map((l) => String(l).replace(BREAKS, ' ')).join('\n')}\n`);
    } else if (form === 'resume' && rest.length === 0) {
      const helper = client ?? helperClient();
      const got = await ask(helper.setup.status, { folder });
      const next = Number.isInteger(got.next) ? got.next : null;
      json({ lines: Array.isArray(got.lines) ? got.lines : [], next, plan: Number.isInteger(got.ask) ? await plan(helper, folder, got.ask) : null });
    } else {
      throw new CliError(USAGE);
    }
    return 0;
  } catch (error) {
    const message = error instanceof CliError ? error.message : `That did not work: ${error instanceof Error ? error.message : 'unknown error'}`;
    err(`${message.replace(BREAKS, ' ')}\n`);
    return 1;
  }
}

if (startedAsScript(import.meta.url)) {
  process.exitCode = await main(process.argv.slice(2));
}
