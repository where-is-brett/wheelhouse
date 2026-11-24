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
//   resume [<last step>] where setup stands, and the plan of what comes next: the one card while no
//                        Go ahead on it holds, else the first step neither done nor running:
//                        { lines, next, plan }, with plan null when there is none, and
//                        `setUpAgain: true` once the director asked to set up again on a redo card.
//                        Covered steps are applied for the session in the same call (`applied`), up to the last step if one is given
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
//   sign-in              asks the helper to open git's own sign-in for the host a step 3 attempt on the "Use my git as it is" route
//                        could not reach, after the director chose it on the card step 3's plan asks (scripts/setup/sign-in.js): the
//                        address is the one setup recorded for that failure, the helper runs git from a folder of its own, git's window
//                        may open for the director to sign in, and it says in one line whether git then reached the project. It waits
//                        for the director (up to SIGN_IN_WAIT_MS), so run it with a command timeout above that. A refusal is its line on
//                        standard error, then a `Detail:` line for the agent alone, when the helper gave one
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
// four through, and `uninstall plan` and `uninstall status`; `apply`, `uninstall apply` and `sign-in` are
// refused under STOP.
// Errors are one line on standard error.
import path from 'node:path';
import { helperClient } from '../host/helper-client.js';
import { SETUP_TITLES } from '../state/card-lines.js';
import { startedAsScript } from '../lib/started-as-script.js';
import { parseTrialLine, MOST_TRIAL_LINES } from '../lib/trial-lines.js';
import { CHOICE_KEY, HEALTH_STEP, PUSH_TEST_STEP } from '../lib/setup-run.js';
import { asciiJson } from '../lib/ascii-json.js';
import { entrypointKind } from './builders-ask.js';

// Whether this session is the Desktop app's own: CLAUDE_CODE_ENTRYPOINT is set by the app, and a terminal session has another value.
// A terminal started from inside a Desktop session (a multiplexer such as tmux, or a remote shell) inherits the app's value, so
// those markers rule the app out: the session is in a terminal.
const TERMINAL_MARKERS = ['TMUX', 'STY', 'SSH_TTY', 'SSH_CONNECTION'];
export const inDesktopApp = (entrypoint, env = process.env) => (entrypoint === 'claude-desktop' || entrypoint === 'claude-desktop-3p')
  && !TERMINAL_MARKERS.some((name) => typeof env?.[name] === 'string' && env[name] !== '');

// An error whose message is said to the session as it is.
export class CliError extends Error {}

export const USAGE = 'Commands: plan <step>, apply <step> <hash>, status, resume [<last step>], wait <step>, choices, change <key>, health [<trial line> ...], sign-in, uninstall plan, uninstall apply <hash>, uninstall status';
// The longest `wait <step>` waits in one call, well within the two minutes a command may run by
// default; a longer wait is asked again.
export const WAIT_MOST_MS = 90 * 1000;
// How often `wait` asks again while the step runs.
export const RUNNING_POLL_MS = 3 * 1000;
// The most covered steps one `resume` applies before it gives the next plan.
const MOST_CHAINED = 12;
const STEP = new RegExp(`^(?:${Object.keys(SETUP_TITLES).join('|')})$`);
const HASH = /^[0-9a-f]{64}$/;
const BREAKS = /\s*[\r\n\v\f\u0085\u2028\u2029]+\s*/g;

// Whether the form being run is in the Desktop app's session; every request says so, for the cards that differ there.
let inApp = false;
// Where the session runs, for step 3's question on where builders start: 'desktop', 'terminal' or 'unknown'.
let entry = 'unknown';
// When this session started, as an ISO time, or null when it can't be told.
let sessionStart = null;

// When the Claude Code process this command runs under started: the session's start. Its nearest Claude
// Code ancestor is the session; null when none is found (Windows lists no processes today).
export async function sessionStartedAt() {
  try {
    const { firstMatePid } = await import('../lib/first-mate-seat.js');
    const { pidStart } = await firstMatePid();
    const at = Date.parse(pidStart);
    return Number.isFinite(at) ? new Date(at).toISOString() : null;
  } catch {
    return null;
  }
}

// A helper that was started a moment ago, by the session start on the first run, may not be listening yet (its first start
// loads every module cold, slowest on Windows). A request it never received is asked again, every HELPER_RETRY_MS for up to
// HELPER_RETRIES times, before the director is told. Only a refusal that came before anything was sent (`unsent`, a socket or
// pipe not there yet) is asked again: a sandbox's refusal, a connection dropped after the request went and a helper that took
// too long (either of which may have done the work) are not.
export const HELPER_RETRY_MS = 2 * 1000;
export const HELPER_RETRIES = 10;
export const HELPER_NOT_UP = 'The host helper isn\'t answering yet. It may still be starting: run the same command again in a few seconds. If it still fails, start a new session in this folder, which starts the helper again.';
const notListening = (got) => got?.ok !== true && got?.unsent === true;
let pause = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

// Asks one route and gives its answer when it is ok; otherwise the helper's own words.
async function ask(route, body, { cards = false } = {}) {
  let got;
  // Where the session runs goes only with the requests that build step cards (plan, apply, choices and change): step 3 asks
  // where builders start from it.
  const sent = { ...body, ...(inApp ? { desktop: true } : {}), ...(cards ? { entrypoint: entry } : {}), ...(sessionStart === null ? {} : { sessionStartedAt: sessionStart }) };
  try {
    got = await route(sent);
    for (let tries = 0; tries < HELPER_RETRIES && notListening(got); tries += 1) {
      await pause(HELPER_RETRY_MS);
      got = await route(sent);
    }
  } catch (error) {
    throw new CliError(`The host helper didn't answer: ${error instanceof Error ? error.message : 'unknown error'}`);
  }
  if (notListening(got)) throw new CliError(HELPER_NOT_UP);
  if (got?.ok !== true) {
    const error = new CliError(got?.refused ?? got?.why ?? 'The host helper refused the request');
    // For the agent alone (a refusal's exact names), said on a line of its own after the refusal.
    if (typeof got?.detail === 'string' && got.detail.trim() !== '') error.detail = got.detail;
    throw error;
  }
  return got;
}

function stepOf(text, { oneCard = false } = {}) {
  if (oneCard && String(text) === '0') return 0;
  if (!STEP.test(String(text))) throw new CliError(`Give the step as a number from 1 to ${Object.keys(SETUP_TITLES).length}`);
  return Number(text);
}

// Said on resume while step 7 isn't applied: a session that ran setup outside the sandbox keeps doing so.
const OUTSIDE_UNTIL_FILES = 'Step 7 is not applied yet: try the sandbox first, and if a setup command (scripts/setup/cli.js) has been refused there, run it outside.';

async function plan(client, folder, step) {
  const got = await ask(client.setup.plan, { folder, step }, { cards: true });
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
  entrypoint = process.env.CLAUDE_CODE_ENTRYPOINT, env = process.env, started = null,
} = {}) {
  inApp = inDesktopApp(entrypoint, env);
  entry = entrypointKind(entrypoint, env);
  sessionStart = started;
  pause = sleep;
  try {
    const [form, ...rest] = argv;
    const json = (value) => out(`${asciiJson(value, 2)}\n`);
    const folder = path.resolve(cwd);
    if (form === 'plan' && rest.length === 1) {
      const step = stepOf(rest[0], { oneCard: true });
      json(await plan(client ?? helperClient(), folder, step));
    } else if (form === 'apply' && rest.length === 2) {
      const step = stepOf(rest[0]);
      if (!HASH.test(rest[1])) throw new CliError('Give the full hash of the list on the card, as plan gave it');
      const { ok, ...answer } = await ask((client ?? helperClient()).setup.apply, { folder, step, hash: rest[1] }, { cards: true }); // eslint-disable-line no-unused-vars
      json(answer);
    } else if (form === 'status' && rest.length === 0) {
      const got = await ask((client ?? helperClient()).setup.status, { folder });
      out(`${(Array.isArray(got.lines) ? got.lines : []).map((l) => String(l).replace(BREAKS, ' ')).join('\n')}\n`);
    } else if (form === 'resume' && rest.length <= 1) {
      // With a step given, covered steps are applied only up to it; the plan after that is left as it comes.
      const last = rest.length === 1 ? stepOf(rest[0]) : Infinity;
      const helper = client ?? helperClient();
      const look = async () => {
        let got = await ask(helper.setup.status, { folder });
        // The one card first, while no Go ahead on it holds (design section 15.1); then the steps.
        let planned = null;
        if (got.oneCard === true) planned = await plan(helper, folder, 0);
        if ((planned === null || planned.done === true) && Number.isInteger(got.ask)) planned = await plan(helper, folder, got.ask);
        // The last step settling with no card and nothing to say (the phone's, where no phone card can
        // be shown) finishes setup, and leaves step 10's card, which opens with the verdict and first
        // briefing, to the status taken now: a session told setup is finished doesn't ask again.
        if (planned?.done === true && planned.said === undefined) {
          const after = await ask(helper.setup.status, { folder });
          if (after.next === null && Number.isInteger(after.ask) && after.ask !== planned.step) {
            got = after;
            planned = await plan(helper, folder, got.ask);
          }
        }
        return { got, planned };
      };
      let { got, planned } = await look();
      // A step the one card's Go ahead covers is applied here, as the session would at once with the plan's own hash, and
      // the next plan taken, so a run of covered steps costs the session one call, not three each. What each step said, and its
      // heading, come back in `applied`. A refusal ends the run of them, leaving the plan for the session to apply and see it, and
      // so does a step planned again after its own apply: no step is applied twice in one call.
      const applied = [];
      while (planned?.covered === true && typeof planned.hash === 'string' && planned.step <= last && applied.length < MOST_CHAINED && !applied.some((a) => a.step === planned.step)) {
        let done;
        try {
          const { ok, ...answer } = await ask(helper.setup.apply, { folder, step: planned.step, hash: planned.hash }); // eslint-disable-line no-unused-vars
          done = answer;
        } catch {
          break;
        }
        applied.push({ step: planned.step, title: planned.title, ...(Array.isArray(planned.progress) ? { progress: planned.progress } : {}), ...(done.started === true ? { started: true } : {}), ...(done.done === true ? { done: true } : {}), ...(typeof done.said === 'string' && done.said.trim() !== '' ? { said: done.said.replace(BREAKS, ' ').trim() } : {}) });
        ({ got, planned } = await look());
      }
      const next = Number.isInteger(got.next) ? got.next : null;
      json({
        lines: Array.isArray(got.lines) ? got.lines : [], next, plan: planned, ...(applied.length > 0 ? { applied } : {}), ...(got.setUpAgain === true ? { setUpAgain: true } : {}),
        ...(got.filesDue === true ? { sandbox: OUTSIDE_UNTIL_FILES } : {}),
      });
    } else if (form === 'choices' && rest.length === 0) {
      const { ok, ...answer } = await ask((client ?? helperClient()).setup.choices, { folder }, { cards: true }); // eslint-disable-line no-unused-vars
      json(answer);
    } else if (form === 'change' && rest.length === 1) {
      if (!CHOICE_KEY.test(rest[0])) throw new CliError('Give the choice\'s key, as choices lists it');
      const got = await ask((client ?? helperClient()).setup.change, { folder, key: rest[0] }, { cards: true });
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
        // What the plan says is left, for the answer; `wait` is how long this loop sleeps before it asks again.
        let stated = RUNNING_POLL_MS;
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
          // A wait for another step to finish is asked again as often as a running step is, so it ends when that step does, not at the
          // end of a set pause. Only a timed wait (step 9's two minutes with the screen locked) is slept through whole.
          stated = planned.wait;
          wait = planned.waitsFor !== undefined || step !== PUSH_TEST_STEP ? Math.min(planned.wait, RUNNING_POLL_MS) : planned.wait;
        }
        ran ||= running;
        if (left <= 0) {
          json(running ? { step, running: true } : { step, waiting: stated });
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
    } else if (form === 'sign-in' && rest.length === 0) {
      // Git's sign-in for the host step 3 could not reach: the helper takes the address from setup's own record and runs git itself.
      const got = await ask((client ?? helperClient()).setup.signIn, { folder });
      out(`${String(got.line ?? '').replace(BREAKS, ' ')}\n`);
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
    if (error instanceof CliError && typeof error.detail === 'string') err(`Detail: ${error.detail.replace(BREAKS, ' ')}\n`);
    return 1;
  }
}

if (startedAsScript(import.meta.url)) {
  process.exitCode = await main(process.argv.slice(2), { started: await sessionStartedAt() });
}
