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
//   wait                    status, looked at again every couple of seconds until the update is done, has stopped or has a card to
//                           ask, or a minute and a half has passed: the same JSON as status. For right after apply, so an update
//                           that goes through in one run shows its result at once.
//   answer <card> <label>   relays an answer. It signs nothing. For the Update card (named by the plan's hash) a Not now
//                           is kept, so nothing asks about that release again. For the cards the update raised (the
//                           approval of a release, the old helper's), the director's click was signed by the prompt record
//                           or the helper's window; this tells the update to look again at once, and the helper refuses it
//                           when no signed answer is there.
//   --here                  after plan, status or wait: the director wants the cards asked in the chat, so the question hook lets the
//                           next one through even where a pane beside the chat could answer it (once, for two minutes).
//   bootstrap <folder>      the one update a computer on v0.2.6 or earlier makes, by the director's own hand in Terminal
//                           (bootstrap.js): it takes the director's typed 1 or 2 from a real terminal, and refuses without one.
//                           It is the only form that changes anything itself, through the update job.
// Errors are one line on standard error.
import path from 'node:path';
import { helperClient } from '../host/helper-client.js';
import { startedAsScript } from '../lib/started-as-script.js';
import { ANY_CARD, markHere } from '../lib/session-files.js';
import { NO_TERMINAL, bootstrap, terminalAsk } from './bootstrap.js';

export class CliError extends Error {}

export const USAGE = 'Commands: plan [<tag>], apply <hash>, status, wait, answer <card> <label>, bootstrap <project folder>';
export const WAIT_MS = 90 * 1000;
export const WAIT_EVERY_MS = 2 * 1000;
// The update's journal may still be the last update's for a moment after apply, so a first look comes after this.
export const WAIT_FIRST_MS = 3 * 1000;
const WAIT_BEGIN_MS = 15 * 1000;
const napping = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });
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
  cwd = process.cwd(), env = process.env, client, stdin = process.stdin, typedAnswer, bootstrapDeps = {}, sleep = napping, now = Date.now, mark = markHere, out = (t) => process.stdout.write(t), err = (t) => process.stderr.write(t),
} = {}) {
  try {
    const [form, ...given] = argv;
    const here = given.includes('--here');
    const rest = given.filter((a) => a !== '--here');
    if (here && !['plan', 'status', 'wait'].includes(form)) throw new CliError(USAGE);
    // Marked before the card is asked, so the question hook lets it through in the chat.
    const session = env.CLAUDE_CODE_SESSION_ID;
    if (here && typeof session === 'string' && session !== '') mark(session, [ANY_CARD], now());
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
    } else if ((form === 'status' || form === 'wait') && rest.length === 0) {
      // One look at how the update stands, as the JSON status prints; its unreachable line when the helper is not answering.
      const look = async () => {
        let got;
        try {
          got = await helper.update.status({ folder });
        } catch {
          got = { ok: false, refused: 'could not be reached' };
        }
        if (unreached(got)) return { lines: [UNREACHABLE], state: 'unreachable' };
        if (got?.ok !== true) throw new CliError(got?.refused ?? 'The host helper refused the request');
        const { ok, lines, ...rest_ } = got; // eslint-disable-line no-unused-vars
        return { lines: (Array.isArray(lines) ? lines : []).map((l) => String(l).replace(BREAKS, ' ')), ...rest_ };
      };
      if (form === 'status') {
        json(await look());
      } else {
        const began = now();
        await sleep(WAIT_FIRST_MS);
        let seen = await look();
        // 'none' just after apply is the runner not having begun yet, so it is looked at again for a few seconds.
        const going = () => (seen.state === 'running' || (seen.state === 'none' && now() - began < WAIT_BEGIN_MS)) && !(seen.asks?.length > 0);
        while (going() && now() - began < WAIT_MS) {
          await sleep(WAIT_EVERY_MS);
          seen = await look();
        }
        json(seen);
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
