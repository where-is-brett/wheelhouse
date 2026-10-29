// scripts/lean/cli.js
// The Lean command (ruling P5-24): how the chat reaches Wheelhouse's helper at Lean, as
// `"<node>" "<root>/scripts/lean/cli.js" <command>`, run in the project's folder. The helper places the project
// from the folder, writes the record and moves the main version; this command only asks.
//   status                          how the project's store stands: whether its git is in the store, the main
//                                   version, whether it moved outside the helper (and the card that asks about it),
//                                   STOP, the copy folder, the test command and whether it has real users
//   click <card> <label> [<commit>] the director's click in the chat on the card named <card> (`merge-<slug>`,
//                                   `undo-<slug>`, `main-moved`, `ruling-<card id>` for Confirm on a ruling's confirm
//                                   card, and the like) choosing <label>, with the commit it
//                                   names in full where it names one. Standard input is JSON: { "question": the
//                                   card's text as the director saw it, "text": the director's own words, with
//                                   Suggest a change… only }. Recorded as a chat click, never more
//   merge <slug> <commit>           adds the approved <commit> of feature/<slug> to the main version, after its tests
//   undo <merge>                    undoes the merge <merge> (in full) with a new commit, on the click on Undo in the
//                                   helper's window; without one it answers `needs: window` with the card to confirm
//   undo moved                      undoes what the main version gained outside the helper, on the click on Undo it
//                                   in the helper's window
//   copy                            brings the copy folder up to the main version and the record
//   confirm <card>                  shows the card (its id in the state, or lift-stop) in the helper's own window,
//                                   where the director's click is the stronger proof; waits for it, and for the undo
//                                   an Undo or Undo it there makes
// Each prints the helper's answer as one JSON line and exits 0; a refusal also goes to standard error, in its
// own words, with exit 1.
//
// A click and a confirm go through the desk (scripts/desk/client.js, never its local core: this runs in the
// sandbox), as an `answer` or a `suggest` with the evidence the helper's own routes take; the answer printed is the
// helper's, as it was. status, merge, undo and copy are the Lean store's own steps and stay on its routes.
import crypto from 'node:crypto';
import { helperClient } from '../host/helper-client.js';
import { deskClient } from '../desk/client.js';
import { SIGNED_LABELS } from '../hooks/prompt-record.js';
import { SUGGEST } from '../lib/calm-words.js';
import { dataHash } from '../state/events.js';
import { WINDOW_MS } from '../confirm/window.js';
import { LEAN_TEST_MS, LOCK_WAIT_MS } from './store.js';
import { startedAsScript } from '../lib/started-as-script.js';

const MINUTE = 60 * 1000;
// How long each command waits for the helper: a merge runs the tests and may wait for another window's merge.
const WAITS = {
  status: MINUTE,
  click: MINUTE,
  merge: LEAN_TEST_MS + LOCK_WAIT_MS + 5 * MINUTE,
  undo: LOCK_WAIT_MS + 5 * MINUTE,
  copy: LOCK_WAIT_MS + 5 * MINUTE,
  // One window at a time on the computer, so a confirm may wait for another's.
  confirm: 3 * WINDOW_MS,
};
const FULL_COMMIT = /^[0-9a-f]{40}$/;
const SLUG = /^[a-z0-9][a-z0-9-]{0,39}$/;
// The cards a click in the chat may decide with a signed option, as the desk's evidence takes them.
const CHAT_DECIDES = /^(?:merge|guardrail)-/;
const USAGE = 'Usage: cli.js status | click <card> <label> [<commit>] | merge <slug> <commit> | undo <merge> | undo moved | copy | confirm <card>';

export class LeanCliError extends Error {}
const fail = (message) => { throw new LeanCliError(message); };

async function readAll(stream) {
  const chunks = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString('utf8');
}

// What the director clicked, from standard input: the card's text as shown, and their own words where there are any.
async function clickInput(stdin) {
  let given;
  try {
    given = JSON.parse(await readAll(stdin));
  } catch {
    fail('click takes JSON on standard input: { "question": the card\'s text as shown }');
  }
  if (!given || typeof given !== 'object' || typeof given.question !== 'string' || given.question.trim() === '') fail('click needs the card\'s text as shown, as "question"');
  if (given.text !== undefined && (typeof given.text !== 'string' || given.text.trim() === '')) fail('"text" must be the director\'s own words');
  return given;
}

// The desk's acts over `api`, each answering as the helper did: without the desk's own fields, and, when the
// helper wasn't reached, in the helper client's words rather than the desk's (nothing is kept to send later here).
function deskActs(api, cwd) {
  let raw;
  const client = { ...api, desk: { ...api.desk, act: async (body) => { raw = await api.desk.act(body); return raw; } } };
  const desk = deskClient({ cwd, client, local: 'never' });
  return async (command, args, evidence) => {
    const got = await desk.act(command, args, evidence);
    if (got?.away === true) return raw;
    const { v, changed, ...answer } = got ?? {};
    return answer;
  };
}

// The helper's answer to one command. `client` is made with the command's wait unless given.
export async function leanCommand(argv, { cwd = process.cwd(), stdin = process.stdin, client = null, address } = {}) {
  const [command, ...rest] = argv;
  if (!Object.hasOwn(WAITS, command)) fail(USAGE);
  const api = client ?? helperClient({ ...(address ? { address } : {}), timeout: WAITS[command] });
  if (command === 'status') {
    if (rest.length !== 0) fail(USAGE);
    return api.lean.status({ cwd });
  }
  if (command === 'click') {
    const [card, label, commit] = rest;
    if (rest.length < 2 || rest.length > 3 || !card || !label) fail(USAGE);
    if (commit !== undefined && !FULL_COMMIT.test(commit)) fail('The commit must be written in full (40 characters)');
    const { question, text } = await clickInput(stdin);
    // The card's hash is of its text as the director saw it, so the click names what was shown.
    const hash = crypto.createHash('sha256').update(question).digest('hex');
    // Words with another option, and a signed option on a card the desk's evidence doesn't let the chat decide (a
    // ruling's Confirm at Lean, a step confirmed outside the chat), go to the helper's own route as they are, which
    // answers them in its own words.
    if ((text !== undefined && label !== SUGGEST) || (SIGNED_LABELS.includes(label) && !CHAT_DECIDES.test(card))) {
      return api.cards.chatClick({ cwd, card, label, hash, proof: 'chat-click', ...(commit === undefined ? {} : { commit }), ...(text === undefined ? {} : { text }) });
    }
    const act = deskActs(api, cwd);
    const evidence = { form: 'chat-click', proof: 'chat-click' };
    if (text !== undefined) return act('suggest', { card, words: text, hash }, evidence);
    return act('answer', { card, option: label, hash, ...(commit === undefined ? {} : { commit }) }, evidence);
  }
  if (command === 'merge') {
    const [slug, commit] = rest;
    if (rest.length !== 2 || !SLUG.test(slug ?? '')) fail(USAGE);
    if (!FULL_COMMIT.test(commit ?? '')) fail('The commit must be written in full (40 characters)');
    return api.lean.merge({ cwd, branch: `feature/${slug}`, commit });
  }
  if (command === 'undo') {
    const [what] = rest;
    if (rest.length !== 1) fail(USAGE);
    if (what === 'moved') return api.lean.undo({ cwd, moved: true });
    if (!FULL_COMMIT.test(what ?? '')) fail('The merge must be written in full (40 characters)');
    return api.lean.undo({ cwd, merge: what });
  }
  if (command === 'copy') {
    if (rest.length !== 0) fail(USAGE);
    return api.lean.copy({ cwd });
  }
  // confirm: the card as the state holds it, by its id, hashed as the helper hashes it.
  const [card] = rest;
  if (rest.length !== 1 || !card) fail(USAGE);
  // Lift STOP is no card of the state, and is asked under STOP, which the desk answers only for a signed record.
  if (card === 'lift-stop') return api.confirm({ cwd, card });
  const reader = deskClient({ cwd, client: client ?? helperClient({ ...(address ? { address } : {}), timeout: WAITS.status }), local: 'never' });
  const waiting = await reader.read('waiting');
  if (waiting?.ok !== true) {
    const { v, ...refused } = waiting ?? {};
    return refused;
  }
  const found = (waiting.data.cards ?? []).filter((e) => e?.id === card);
  if (found.length !== 1) fail('That card is not in this project\'s state');
  const hash = dataHash(found[0].data);
  // Under STOP the window still offers a Lean project's undo, which the desk refuses before the window opens: that
  // confirm goes to the helper's own route.
  if (waiting.data.stop === true) return api.confirm({ cwd, card, hash });
  return deskActs(api, cwd)('answer', { card, hash }, { form: 'window' });
}

export async function main(argv = process.argv.slice(2), { stdout = process.stdout, stderr = process.stderr, ...deps } = {}) {
  try {
    const answer = await leanCommand(argv, deps);
    stdout.write(`${JSON.stringify(answer)}\n`);
    if (answer?.ok === true) return 0;
    stderr.write(`${typeof answer?.refused === 'string' ? answer.refused : 'The helper refused'}\n`);
    return 1;
  } catch (error) {
    stderr.write(`${error instanceof LeanCliError ? error.message : 'The Lean command failed'}\n`);
    return 1;
  }
}

if (startedAsScript(import.meta.url)) {
  main().then((code) => { process.exitCode = code; });
}
