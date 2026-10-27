// scripts/setup/cli.js
// Setup's one command, as `node "<pluginRoot>/scripts/setup/cli.js" <form>`, run in the folder
// being set up:
//   plan <step>          the step's list of changes and its card, as AskUserQuestion's question,
//                        with the list's hash: { step, title, hash, director, changes, card };
//                        or a question the step asks first, its card to be asked exactly as given:
//                        { step, title, ask: { step, id, card } }, with `unanswered`, a line for the
//                        director saying why, when it is asked again because what was typed on it
//                        was not taken (rulings R125, R132); or { step, title, wait, why },
//                        nothing to ask for `wait` milliseconds, with `waitsFor`, the step it waits
//                        for, when it is waiting for another step to finish; or
//                        { step, title, done: true }, the step settled on the director's answers,
//                        with `said`, a line for the director, when it said one as it settled
//   apply <step> <hash>  asks the helper to apply the step, with the full hash `plan` gave; the
//                        helper goes ahead only after the director's click on the card naming it
//                        With step 0: the one card (design section 15.1), { step: 0, ask }, a question
//                        of the plan for this project, Go ahead or Customise; after Customise, its
//                        cards, { step: 0, asks: [{ step, id, card }] }, up to four questions to ask
//                        together; { done: true } once its Go ahead holds. A step's Go-ahead plan
//                        that Go ahead covers says `covered: true`: apply it with no card
//   status               where setup stands in this folder, as plain lines
//   resume               where setup stands, and the plan of what comes next: the one card while no
//                        Go ahead on it holds, else the first step neither done nor running:
//                        { lines, next, plan }, with plan null when there is none, and
//                        `setUpAgain: true` once the director asked to set up again on a redo card
//   wait <step>          waits, up to WAIT_MOST_MS a call, while the step runs or its plan is a
//                        wait: { step, waited: true } once it is over (step 10: once its own checks
//                        are done); else { step, running: true }, or { step, waiting } with the
//                        milliseconds left, and the session runs it again
//   choices              every choice of the run: { choices: [{ key, about, chosen, acted }] }
//   change <key>         the card that changes one choice: { asks: [{ step, id, card }] }, its own
//                        card while its step hasn't used it, else a card offering what changing it
//                        takes (scripts/setup/redo.js)
//   health [<line> ...]  step 10's board (ruling R41): the lines the safety trials printed in this
//                        session's sandbox (scripts/health/trials.js), each one argument, as it is,
//                        joined by the helper with step 10's own checks and the board's health:
//                        { green, lines, board, trials }, and once green { started, briefing } too,
//                        and `card` ({ question, id }) when setup ends asking whether to carry on
//                        work already under way (design section 15, ruling A9).
//                        With no lines it names the pull request and project the trials take
//                        (`trials: { pr, project }`): run `node "<root>/scripts/health/trials.js"
//                        --pr <pr> --project <project>`, then `health` with every line it printed
//                        (not its notes); once green, `resume`: the phone's card opens with the
//                        verdict and the first briefing (with no phone card left, step 10's
//                        plan gives them as `said`), then ask `card.question` as it is
//   uninstall plan       uninstall's list worked out by the helper, its card and its level 4
//                        cards: { hash, card, asks: [{ id, about, card }], last }. Each ask card is
//                        asked exactly as given, before uninstall's own card. Once an uninstall has
//                        stopped past the trusted-keys list's removal, { lines } instead, the first
//                        saying to start a new session, and no card
//   uninstall apply <hash>  asks the helper to put back what setup changed, with the full hash
//                        `uninstall plan` gave; it goes ahead only after the director's Remove it on
//                        the card naming it, in its own process: { started: true }
//   uninstall status     as plain lines: how a started uninstall stands (running; done, or stopped
//                        with why, then what it said and each page as `Open <what>: <url>`, a link
//                        for the director: the pull request to merge, an installation page);
//                        otherwise the whole list
// The playbook (wheelhouse:setup) runs in the sandbox and only talks: every change is the
// helper's, so every form is a request to its /setup/* routes, naming this folder, and nothing here
// reads or writes a file. A request carries only the folder, the step and the hash; the helper
// works out the list itself. `status` only reads. `plan` and `resume` (which asks for the status,
// then one plan) change nothing a step lists: they write only setup's own records (the run, a
// card's shown time, the card asked, and a step settled on answers already given). `health` only
// reads under STOP; outside it, until the run's board has been green, it removes a .env.local the
// trial left, closes the trial pull request and deletes its branch, and, once the board is green
// with every other step done, records the green mark, copies the run's records into the project's
// state and finishes setup (the foreman and the first briefing), once. The STOP guard lets these
// four through, and `uninstall plan` and `uninstall status`; `apply` and `uninstall apply` are
// refused under STOP.
// Errors are one line on standard error.
import path from 'node:path';
import { helperClient } from '../host/helper-client.js';
import { SETUP_TITLES } from '../state/card-lines.js';
import { startedAsScript } from '../lib/started-as-script.js';
import { parseTrialLine, MOST_TRIAL_LINES } from '../lib/trial-lines.js';
import { CHOICE_KEY, HEALTH_STEP } from '../lib/setup-run.js';

// An error whose message is said to the session as it is.
export class CliError extends Error {}

export const USAGE = 'Commands: plan <step>, apply <step> <hash>, status, resume, wait <step>, choices, change <key>, health [<trial line> ...], uninstall plan, uninstall apply <hash>, uninstall status';
// The longest `wait <step>` waits in one call, well within the two minutes a command may run by
// default; a longer wait is asked again.
export const WAIT_MOST_MS = 90 * 1000;
// How often `wait` asks again while the step runs.
export const RUNNING_POLL_MS = 3 * 1000;
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

function stepOf(text, { oneCard = false } = {}) {
  if (oneCard && String(text) === '0') return 0;
  if (!STEP.test(String(text))) throw new CliError(`Give the step as a number from 1 to ${Object.keys(SETUP_TITLES).length}`);
  return Number(text);
}

async function plan(client, folder, step) {
  const got = await ask(client.setup.plan, { folder, step });
  const named = { step, title: SETUP_TITLES[step] ?? 'The plan', ...(Array.isArray(got.progress) ? { progress: got.progress } : {}) };
  // Customise's cards (step 0): up to four questions, asked together.
  if (Array.isArray(got.asks)) return { ...named, asks: got.asks };
  if (got.ask !== undefined) return { ...named, ask: got.ask, ...(typeof got.unanswered === 'string' ? { unanswered: got.unanswered } : {}) };
  if (got.wait !== undefined) return { ...named, wait: got.wait, why: got.why, ...(Number.isInteger(got.waitsFor) ? { waitsFor: got.waitsFor } : {}) };
  // A settled step's line for the director, said at once (rulings R101, R120), on one line as status's are.
  if (got.done === true) return { ...named, done: true, ...(typeof got.said === 'string' && got.said.trim() !== '' ? { said: got.said.replace(BREAKS, ' ').trim() } : {}) };
  return { ...named, hash: got.hash, director: got.director, changes: got.changes, card: got.card, ...(got.covered === true ? { covered: true } : {}) };
}

// Runs a form and resolves with the exit code. `out` and `err` take text to show.
export async function main(argv, {
  cwd = process.cwd(), client, out = (t) => process.stdout.write(t), err = (t) => process.stderr.write(t),
  now = () => Date.now(), sleep = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); }),
} = {}) {
  try {
    const [form, ...rest] = argv;
    const json = (value) => out(`${JSON.stringify(value, null, 2)}\n`);
    const folder = path.resolve(cwd);
    if (form === 'plan' && rest.length === 1) {
      const step = stepOf(rest[0], { oneCard: true });
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
      // The one card first, while no Go ahead on it holds (design section 15.1); then the steps.
      let planned = null;
      if (got.oneCard === true) planned = await plan(helper, folder, 0);
      if ((planned === null || planned.done === true) && Number.isInteger(got.ask)) planned = await plan(helper, folder, got.ask);
      json({
        lines: Array.isArray(got.lines) ? got.lines : [], next, plan: planned, ...(got.setUpAgain === true ? { setUpAgain: true } : {}),
      });
    } else if (form === 'choices' && rest.length === 0) {
      const { ok, ...answer } = await ask((client ?? helperClient()).setup.choices, { folder }); // eslint-disable-line no-unused-vars
      json(answer);
    } else if (form === 'change' && rest.length === 1) {
      if (!CHOICE_KEY.test(rest[0])) throw new CliError('Give the choice\'s key, as choices lists it');
      const got = await ask((client ?? helperClient()).setup.change, { folder, key: rest[0] });
      json({ asks: got.asks });
    } else if (form === 'wait' && rest.length === 1) {
      // Waits here, for the session, which can't sleep in the foreground or keep a loop of its own,
      // up to WAIT_MOST_MS in all: while the step runs (status lists it as running), and while its
      // plan is a wait. { waited: true } once it is over, else { running: true } or { waiting }. A step that ran in this
      // call is over once it has stopped running; step 10's is over once its own checks are done,
      // since the trials that come next are the session's part, not a wait.
      const step = stepOf(rest[0]);
      const helper = client ?? helperClient();
      const end = now() + WAIT_MOST_MS;
      let ran = false;
      for (;;) {
        const left = end - now();
        const got = await ask(helper.setup.status, { folder });
        const running = Array.isArray(got.running) && got.running.includes(step);
        let wait = RUNNING_POLL_MS;
        if (!running) {
          if (ran) {
            json({ step, waited: true });
            break;
          }
          const planned = await plan(helper, folder, step);
          if (planned.wait === undefined || (step === HEALTH_STEP && planned.waitsFor === undefined)) {
            json({ step, waited: true });
            break;
          }
          wait = planned.wait;
        }
        ran ||= running;
        if (left <= 0) {
          json(running ? { step, running: true } : { step, waiting: wait });
          break;
        }
        await sleep(Math.max(1, Math.min(wait, left)));
      }
    } else if (form === 'uninstall' && rest[0] === 'plan' && rest.length === 1) {
      const { ok, ...answer } = await ask((client ?? helperClient()).setup.uninstall.plan, { folder }); // eslint-disable-line no-unused-vars
      json(answer);
    } else if (form === 'uninstall' && rest[0] === 'apply' && rest.length === 2) {
      if (!HASH.test(rest[1])) throw new CliError('Give the full hash of the list on uninstall\'s card, as uninstall plan gave it');
      const { ok, ...answer } = await ask((client ?? helperClient()).setup.uninstall.apply, { folder, hash: rest[1] }); // eslint-disable-line no-unused-vars
      json(answer);
    } else if (form === 'uninstall' && rest[0] === 'status' && rest.length === 1) {
      const got = await ask((client ?? helperClient()).setup.uninstall.status, { folder });
      out(`${(Array.isArray(got.lines) ? got.lines : []).map((l) => String(l).replace(BREAKS, ' ')).join('\n')}\n`);
    } else if (form === 'health') {
      if (rest.length > MOST_TRIAL_LINES || !rest.every((l) => parseTrialLine(l) !== null)) {
        throw new CliError('Give the lines trials.js printed, each as one argument, as they are');
      }
      const { ok, ...answer } = await ask((client ?? helperClient()).setup.health, { folder, lines: rest }); // eslint-disable-line no-unused-vars
      json(answer);
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
