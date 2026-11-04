// scripts/update/cli.js
// The update command's one script, run from the session's sandbox (commands/update.md). It only talks: every change is the
// helper's, and nothing here reads or writes a file. Four forms, each a request to the helper's /update/* routes naming
// the folder the session is in, and each giving JSON:
//   plan [<tag>]            the Update card and a hash of the plan it shows: { card, hash, lines }, or only { lines }
//                           when nothing is newer, All stop is on, or the release does not check out. A release named
//                           (v0.2.8) older than the one installed is a put-back, with its own card.
//   apply <hash>            starts the update the card showed, in its own process: { started: true }. Refused under All
//                           stop, from a feature session, for a hash that is not the plan's last shown, and without the director's
//                           signed click on that card (recorded when they click it in Claude Code).
//   status                  { lines, state, asks? }: how the update stands, and any card for the director to answer,
//                           each as { id, card }, to be asked exactly as given.
//   answer <card> <label>   relays an answer. It signs nothing. For the Update card (named by the plan's hash) a Not now
//                           is kept, so nothing asks about that release again. For the cards the update raised (the
//                           approval of a release, the old helper's), the director's click was signed by the prompt record
//                           or the helper's window; this tells the update to look again at once, and the helper refuses it
//                           when no signed answer is there.
//   bootstrap <folder>      the one update a computer on v0.2.6 or earlier makes, by the director's own hand in Terminal
//                           (bootstrap.js): it takes the director's typed 1 or 2 from a real terminal, and refuses without one.
//                           It is the only form that changes anything itself, through the update job.
// Errors are one line on standard error.
import path from 'node:path';
import { helperClient } from '../host/helper-client.js';
import { startedAsScript } from '../lib/started-as-script.js';
import { NO_TERMINAL, bootstrap, terminalAsk } from './bootstrap.js';

export class CliError extends Error {}

export const USAGE = 'Commands: plan [<tag>], apply <hash>, status, answer <card> <label>, bootstrap <project folder>';
const HASH = /^[0-9a-f]{64}$/;
const TAG = /^v\d+\.\d+\.\d+(?:-[A-Za-z0-9][A-Za-z0-9.-]{0,40})?$/;
const CARD = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;
export const ANSWERS = Object.freeze(['Not now', 'Approve', 'Stop it', 'Leave it', 'Wait longer']);
const BREAKS = /\s*[\r\n\v\f\u0085\u2028\u2029]+\s*/g;
export const UNREACHABLE = 'Wheelhouse\'s helper isn\'t answering just now. If this goes on for more than a few minutes, start a new session on this folder.';

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

const unreached = (got) => got?.ok === false && /could not be reached|did not answer in time/.test(String(got.refused));

export async function main(argv, {
  cwd = process.cwd(), client, stdin = process.stdin, typedAnswer, bootstrapDeps = {}, out = (t) => process.stdout.write(t), err = (t) => process.stderr.write(t),
} = {}) {
  try {
    const [form, ...rest] = argv;
    const json = (value) => out(`${JSON.stringify(value, null, 2)}\n`);
    const folder = path.resolve(cwd);
    const helper = client ?? helperClient();
    if (form === 'plan' && rest.length <= 1) {
      if (rest.length === 1 && !TAG.test(rest[0])) throw new CliError('Give the release as a tag, such as v0.2.8');
      const { ok, ...answer } = await ask(helper.update.plan, rest.length === 1 ? { folder, tag: rest[0] } : { folder }); // eslint-disable-line no-unused-vars
      json(answer);
    } else if (form === 'apply' && rest.length === 1) {
      if (!HASH.test(rest[0])) throw new CliError('Give the full hash of the plan on the card, as plan gave it');
      const { ok, ...answer } = await ask(helper.update.apply, { folder, hash: rest[0] }); // eslint-disable-line no-unused-vars
      json(answer);
    } else if (form === 'status' && rest.length === 0) {
      let got;
      try {
        got = await helper.update.status({ folder });
      } catch {
        got = { ok: false, refused: 'could not be reached' };
      }
      if (unreached(got)) {
        json({ lines: [UNREACHABLE], state: 'unreachable' });
      } else {
        if (got?.ok !== true) throw new CliError(got?.refused ?? 'The host helper refused the request');
        const { ok, lines, ...rest_ } = got; // eslint-disable-line no-unused-vars
        json({ lines: (Array.isArray(lines) ? lines : []).map((l) => String(l).replace(BREAKS, ' ')), ...rest_ });
      }
    } else if (form === 'answer' && rest.length === 2) {
      if (!CARD.test(rest[0])) throw new CliError('Give the card as plan or status named it');
      if (!ANSWERS.includes(rest[1])) throw new CliError(`Give the label of one of the card's options: ${ANSWERS.join(', ')}`);
      const { ok, ...answer } = await ask(helper.update.answer, { folder, card: rest[0], label: rest[1] }); // eslint-disable-line no-unused-vars
      json(answer);
    } else if (form === 'bootstrap' && rest.length === 1) {
      // A typed answer at a real terminal stands in for the click (bootstrap.js). Without one, nothing is read or changed.
      const typed = typedAnswer ?? terminalAsk({ stdin });
      if (typeof typed !== 'function' || (typedAnswer === undefined && stdin?.isTTY !== true)) throw new CliError(NO_TERMINAL);
      let got;
      try {
        got = await bootstrap({
          projectDir: path.resolve(cwd, rest[0]), ask: typed, say: (text) => out(`${text}\n`), client, ...bootstrapDeps,
        });
      } finally {
        typed.close?.();
      }
      out(`${got.line}\n`);
      return got.ok || got.declined === true ? 0 : 1;
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
