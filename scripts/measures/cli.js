// scripts/measures/cli.js
// The measures' command, as `node "<pluginRoot>/scripts/measures/cli.js" <form>`:
//   baseline --usd <n> --merges <n> --from <date> --to <date> --counted <text>
//       the private note's figures, as the director gives them at the front desk: the helper reads
//       them back on a card, given as AskUserQuestion's question with the hash of the figures:
//       { hash, card }. The front desk asks that card exactly as given.
//   baseline --confirm <hash>
//       after the director's answer: the helper records the baseline only when they clicked
//       Record these on that card ({ recorded: true }); Not now has already cleared the figures.
// The front desk runs in the sandbox, which can't read ~/.wheelhouse, so every form is a request
// to the helper's /measures/baseline route, and nothing here reads or writes a file. The figures
// are checked here first, and refused before anything is asked. Errors are one line on standard
// error, and never repeat a figure.
import { helperClient } from '../host/helper-client.js';
import { noteBaseline } from './baseline.js';
import { startedAsScript } from '../lib/started-as-script.js';

// An error whose message is said to the session as it is.
export class CliError extends Error {}

export const USAGE = 'Commands: baseline --usd <n> --merges <n> --from <date> --to <date> --counted <text>, baseline --confirm <hash>';
const FLAGS = ['--usd', '--merges', '--from', '--to', '--counted'];
const HASH = /^[0-9a-f]{64}$/;
const AMOUNT = /^\d+(?:\.\d+)?$/;
const COUNT = /^\d+$/;
const BREAKS = /\s*[\r\n\v\f\u0085\u2028\u2029]+\s*/g;

// Asks the route and gives its answer when it is ok; otherwise the helper's own words.
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

// The figures the flags give, each flag once and every one of them.
function figuresOf(rest) {
  const given = {};
  for (let i = 0; i < rest.length; i += 2) {
    const flag = rest[i];
    if (!FLAGS.includes(flag) || Object.hasOwn(given, flag) || i + 1 >= rest.length) throw new CliError(USAGE);
    given[flag] = rest[i + 1];
  }
  if (FLAGS.some((flag) => !Object.hasOwn(given, flag))) throw new CliError(USAGE);
  const figures = {
    usd: AMOUNT.test(given['--usd']) ? Number(given['--usd']) : Number.NaN,
    merges: COUNT.test(given['--merges']) ? Number(given['--merges']) : Number.NaN,
    from: given['--from'],
    to: given['--to'],
    counted: given['--counted'],
  };
  try {
    noteBaseline(figures);
  } catch (error) {
    throw new CliError(`Those figures were not taken: ${error instanceof Error ? error.message : 'they could not be read'}`);
  }
  return figures;
}

// Runs a form and resolves with the exit code. `out` and `err` take text to show.
export async function main(argv, {
  client, out = (t) => process.stdout.write(t), err = (t) => process.stderr.write(t),
} = {}) {
  try {
    const [form, ...rest] = argv;
    const json = (value) => out(`${JSON.stringify(value, null, 2)}\n`);
    if (form !== 'baseline') throw new CliError(USAGE);
    if (rest[0] === '--confirm') {
      if (rest.length !== 2) throw new CliError(USAGE);
      if (!HASH.test(rest[1])) throw new CliError('Give the full hash the card was shown with');
      const got = await ask((client ?? helperClient()).measures.baseline, { confirm: rest[1] });
      json({ recorded: got.recorded === true });
    } else {
      const figures = figuresOf(rest);
      const got = await ask((client ?? helperClient()).measures.baseline, figures);
      json({ hash: got.hash, card: got.card });
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
