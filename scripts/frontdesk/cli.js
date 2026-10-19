// scripts/frontdesk/cli.js
// The front desk's one command, as `node "<pluginRoot>/scripts/frontdesk/cli.js" <command>`, with
// JSON on standard input where a command takes it:
//   cards           this visit's cards, as AskUserQuestion's input, and how many are left; first
//                   it makes an answer card for each open question from the build that no waiting
//                   card asks yet
//   card            composes one card from the composer's input and records it ({ question, id })
//   again <n>       the card the board numbers n, to ask again
//   record <kind>   records something the front desk decided: one of RECORD_KINDS, the data as JSON
//   similar         the open work, ideas and rejections that share words with a request (its text)
//   views <name>    one view as short lines: rulebook, waiting, ideas, glossary or settings
//   explain <term>  the glossary's plain words for a term, with its example
// The front desk runs in the sandbox, which can't read ~/.wheelhouse/, so every read and write is
// a request to the helper, naming this folder for the helper to place the project. Nothing here
// writes a director's answer: `record` takes only the plain kinds the front desk decides, never a
// card, a card's answer, a shown or asked record, or a signed kind, and an answer card's options
// come only from the question the build recorded. Errors are one line on standard error.
import crypto from 'node:crypto';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { helperClient } from '../host/helper-client.js';
import { composeCard, PART_LABELS } from '../cards/compose.js';
import { cardsForVisit, existingCard, askAgain, asQuestion } from '../cards/visit.js';
import { numberedWaiting } from '../board/model.js';
import { glossaryOf, termPattern } from './glossary.js';
import { checkSetting, definitionOf } from '../settings/catalogue.js';
import { effectiveSettings, settingsText } from '../settings/effective.js';
import { similar as similarTo } from '../intake/similar.js';
import { answerLine } from '../state/card-lines.js';

// An error whose message is said to the session as it is.
export class CliError extends Error {}

// The kinds `record` writes: the front desk's own, and the build loop's three that its intake writes.
export const RECORD_KINDS = Object.freeze([
  'ruling', 'idea', 'rejection', 'glossary', 'decision', 'risk', 'blocker', 'reversal', 'setting',
  'work', 'amendment', 'incident',
]);
export const VIEW_NAMES = Object.freeze(['rulebook', 'waiting', 'ideas', 'glossary', 'settings']);
const COMMANDS = ['cards', 'card', 'again', 'record', 'similar', 'views', 'explain'];
// What an answer card says happens while the director decides.
export const MEANWHILE = 'that feature waits; the others carry on';
const INPUT_BYTES = 1024 * 1024;
const BREAK = /[\r\n\v\f\u0085\u2028\u2029]/;
const HEAD = /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/;

const isPlain = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
const flat = (x) => (typeof x === 'string' ? x.replace(/\s+/g, ' ').trim() : x);
const said = (answer, otherwise) => answer?.refused ?? answer?.why ?? otherwise;

// --- Asking the helper ---

// The views, and with `cards` the card events the board numbers its list from.
async function viewsOf(client, cwd, { cards = false } = {}) {
  const got = await client.state.views({ cwd, ...(cards ? { cards: true } : {}) });
  if (got?.ok !== true || !isPlain(got.views)) throw new CliError(said(got, 'The host helper gave no views'));
  if (cards && !Array.isArray(got.cards)) throw new CliError('The host helper gave no card events');
  return { views: got.views, cards: cards ? got.cards : [] };
}

// Writes a plain event through the helper and resolves with its answer, { ok, id, pushed }.
async function write(client, cwd, kind, data, id) {
  const got = await client.state.write({ cwd, kind, data, ...(id === undefined ? {} : { id }) });
  if (got?.ok !== true || typeof got.id !== 'string') throw new CliError(said(got, `The host helper did not record the ${kind}`));
  return got;
}

function compose(input) {
  try {
    return composeCard(input);
  } catch (error) {
    throw new CliError(error.message);
  }
}

// --- cards ---

// The answer card for a question the build recorded: its words, its own options with what each
// says, and its own recommendation, all from the stored event (ruling F10).
function answerCard(id, data, glossary) {
  if (!isPlain(data) || data.id !== id || !Array.isArray(data.options)) throw new Error('its record can\'t be read');
  return composeCard({
    kind: 'answer',
    level: data.level,
    what: flat(data.what),
    why: flat(data.why),
    options: data.options.map((o) => ({ label: o?.label, says: flat(o?.says) || o?.label })),
    recommend: data.recommendation,
    because: `the session building ${data.work} recommends it`,
    meanwhile: MEANWHILE,
    target: { questionId: id },
    glossary,
  });
}

// This visit's cards: { questions, left }, and `problems` when something couldn't be done. An open
// question from the build that no waiting card asks gets its answer card first. The cards handed
// out are recorded as asked, so a card dismissed with no answer isn't offered on every turn. A
// write the helper refuses (under STOP, all of them) is a problem, not a failure: the cards
// waiting are still given.
export async function cards({ client, cwd, now }) {
  const problems = [];
  let { views } = await viewsOf(client, cwd);
  const glossary = glossaryOf(views.glossary);
  let made = 0;
  for (const [id, entry] of Object.entries(isPlain(views.questions) ? views.questions : {})) {
    if (!isPlain(entry) || entry.answer || existingCard(views, answerLine(id)) !== null) continue;
    let card;
    try {
      ({ card } = answerCard(id, entry.question?.data, glossary));
    } catch (error) {
      problems.push(`Question ${id} couldn't be made a card: ${error.message}`);
      continue;
    }
    try {
      await write(client, cwd, 'card', card);
      made += 1;
    } catch (error) {
      problems.push(`The card for question ${id} wasn't recorded: ${error.message}`);
    }
  }
  if (made > 0) ({ views } = await viewsOf(client, cwd));
  const chosen = cardsForVisit(views, { now });
  if (chosen.ids.length > 0) {
    try {
      await write(client, cwd, 'asked', { cards: chosen.ids });
    } catch (error) {
      problems.push(`The cards weren't marked as asked, so they may be offered again: ${error.message}`);
    }
  }
  return { questions: chosen.questions, left: chosen.left, ...(problems.length > 0 ? { problems } : {}) };
}

// --- card ---

// Composes one card and records it, unless a waiting card already carries its set line: then that
// card comes back as it was recorded, so the director is asked the card the state holds. An
// approval whose target names only the pull request gets its head commit from the host.
export async function card({ client, cwd, input }) {
  if (!isPlain(input)) throw new CliError('Give the card as a JSON object on standard input');
  if (input.kind === 'answer') throw new CliError('An answer card comes from `cards`, made from the question as the build recorded it');
  const { views } = await viewsOf(client, cwd);
  let target = input.target;
  if (input.kind === 'approval' && isPlain(target) && target.sha === undefined && Number.isSafeInteger(target.pr) && target.pr >= 1) {
    const state = await client.prState({ cwd, number: target.pr });
    if (state?.ok !== true) throw new CliError(said(state, `The host helper couldn't read pull request #${target.pr}`));
    const sha = state.result?.headSha;
    if (typeof sha !== 'string' || !HEAD.test(sha)) throw new CliError(`The host gave no head commit for pull request #${target.pr}`);
    target = { ...target, sha };
  }
  const { question, card: data } = compose({ ...input, target, glossary: glossaryOf(views.glossary) });
  const found = existingCard(views, data.line);
  if (found !== null) return { question: asQuestion(views.waiting.find((c) => c.id === found)), id: found };
  const { id } = await write(client, cwd, 'card', data);
  return { question, id };
}

// --- again ---

export async function again({ client, cwd, n }) {
  const { views, cards: events } = await viewsOf(client, cwd, { cards: true });
  const question = askAgain(views, n, { events });
  if (question === null) throw new CliError(`The board has no card ${n} to ask again; a question from the build is asked once \`cards\` has made its card`);
  return { questions: [question] };
}

// --- record ---

// The confirm card for a ruling, which names the ruling by its id and its words.
function confirmCard(event, glossary) {
  return compose({
    kind: 'confirm',
    level: 3,
    what: `A rule you gave, in your words: "${event.data.words}"`,
    why: 'A rule is followed only once you confirm it, so it comes to you.',
    options: [{ label: 'Confirm', says: 'The rule goes into the rulebook and is followed from now on.' }],
    recommend: 'Confirm',
    because: 'these are your own words, as you gave them',
    meanwhile: 'The rule is written down, but nothing follows it until you confirm.',
    target: { event },
    glossary,
  });
}

// Records one event and resolves with { id, pushed }, and for a ruling its confirm card, recorded
// too, as { question, id }. A setting the catalogue refuses is refused here, before the helper is
// asked; the director's own settings go to their profile. A ruling keeps its words exactly as
// given: its card is composed first, under the id the ruling is then written with, so a ruling
// whose words no card can carry is never written.
export async function record({ client, cwd, kind, input, makeId = () => crypto.randomUUID() }) {
  if (!RECORD_KINDS.includes(kind)) throw new CliError(`record takes one of: ${RECORD_KINDS.join(', ')}`);
  if (!isPlain(input)) throw new CliError(`Give the ${kind} as a JSON object on standard input`);
  const answered = (got) => ({ id: got.id, pushed: got.pushed === true });
  if (kind === 'setting') {
    try {
      checkSetting(input.key, input.value, input.until);
    } catch (error) {
      throw new CliError(error.message);
    }
    if (definitionOf(input.key).home === 'profile') {
      const got = await client.profile.write({ kind: 'setting', data: input });
      if (got?.ok !== true || typeof got.id !== 'string') throw new CliError(said(got, 'The host helper did not record the setting'));
      return answered(got);
    }
  }
  if (kind !== 'ruling') return answered(await write(client, cwd, kind, input));

  const { words } = input;
  if (typeof words !== 'string' || words.trim() === '' || BREAK.test(words)) throw new CliError('A ruling needs its words, on one line, as the director gave them');
  const { views } = await viewsOf(client, cwd);
  const id = makeId();
  const { question, card: data } = confirmCard({ kind: 'ruling', id, data: input }, glossaryOf(views.glossary));
  const got = await write(client, cwd, 'ruling', input, id);
  if (got.id !== id) throw new CliError(`The ruling was recorded as ${got.id}, not under the id its confirm card names`);
  let made;
  try {
    made = await write(client, cwd, 'card', data);
  } catch (error) {
    throw new CliError(`The ruling was recorded as ${id}, but its confirm card wasn't: ${error.message}`);
  }
  return { ...answered(got), card: { question, id: made.id } };
}

// --- similar ---

export async function similar({ client, cwd, text }) {
  const asked = typeof text === 'string' ? text.trim() : '';
  if (asked === '') throw new CliError('Give the request\'s text on standard input');
  const { views } = await viewsOf(client, cwd);
  return { similar: similarTo(asked, views).map(({ score, ...item }) => ({ ...item, score: Math.round(score * 100) / 100 })) };
}

// --- views ---

const titleOf = (entry, key) => flat(entry?.data?.title) || flat(entry?.data?.text) || flat(entry?.data?.what) || key;
const listed = (lines, none) => (lines.length > 0 ? lines : [none]);

// One view as short lines.
export async function view({ client, cwd, name, now }) {
  if (!VIEW_NAMES.includes(name)) throw new CliError(`views takes one of: ${VIEW_NAMES.join(', ')}`);
  const { views, cards: events } = await viewsOf(client, cwd, { cards: name === 'waiting' });
  if (name === 'rulebook') {
    const rules = (Array.isArray(views.rulebook) ? views.rulebook : []).filter((r) => r?.status !== 'superseded');
    return listed(rules.map((r) => `${flat(r.words)} (${r.status === 'accepted' ? 'in force' : 'waiting for the director to confirm it'})`), 'The rulebook is empty.');
  }
  if (name === 'waiting') {
    // Numbered as the board numbers them; a composed card is named by its first part.
    const firstPart = (id) => {
      const text = views.waiting.find((c) => c.id === id)?.data?.question;
      return typeof text === 'string' && text.startsWith(`${PART_LABELS[0]} `) ? text.slice(PART_LABELS[0].length + 1).split('\n')[0] : null;
    };
    const items = numberedWaiting(views, events).map((item) => `${item.n}. ${(item.card && firstPart(item.card)) || item.what}`);
    return listed(items, 'Nothing is waiting for the director.');
  }
  if (name === 'ideas') return listed(Object.entries(isPlain(views.ideas) ? views.ideas : {}).map(([key, entry]) => `- ${titleOf(entry, key)}`), 'No ideas are kept yet.');
  if (name === 'glossary') return Object.entries(glossaryOf(views.glossary)).map(([term, entry]) => `${term}: ${entry.plain}`);
  // settings: the project's over the director's own, over the defaults
  const profile = await client.profile.views({});
  const own = profile?.ok === true && isPlain(profile.views?.settings) ? profile.views.settings : {};
  return settingsText(effectiveSettings({ project: isPlain(views.settings) ? views.settings : {}, profile: own, now })).split('\n');
}

// --- explain ---

// The glossary's entry for a term as the director wrote it, in any case, a plural or a verb form.
export async function explain({ client, cwd, term }) {
  const asked = term.replace(/\s+/g, ' ').trim();
  if (asked === '') throw new CliError('Give the term to explain: explain <term>');
  const { views } = await viewsOf(client, cwd);
  const glossary = glossaryOf(views.glossary);
  const whole = (t) => [...asked.matchAll(termPattern(t))].some((m) => m.index === 0 && m[0].length === asked.length);
  const found = Object.keys(glossary).find((t) => t.toLowerCase() === asked.toLowerCase()) ?? Object.keys(glossary).find(whole);
  if (found === undefined) throw new CliError(`The glossary has no entry for "${asked}"`);
  const entry = glossary[found];
  return [`${found}: ${entry.plain}`, ...(entry.example ? [`For example: ${entry.example}`] : [])];
}

// --- The command line ---

async function readStdin() {
  const chunks = [];
  let size = 0;
  for await (const chunk of process.stdin) {
    size += chunk.length;
    if (size > INPUT_BYTES) throw new CliError('The input on standard input is too long');
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString('utf8');
}

function parsed(text) {
  try {
    return JSON.parse(text);
  } catch {
    throw new CliError('The input on standard input is not JSON');
  }
}

function only(rest, count, usage) {
  if (rest.length !== count) throw new CliError(usage);
}

// Runs a command and resolves with the exit code. `input` stands in for standard input, which is
// read only by the commands that take it; `out` and `err` take text to show.
export async function main(argv, {
  cwd = process.cwd(), client, input, now = () => new Date(), makeId,
  out = (t) => process.stdout.write(t), err = (t) => process.stderr.write(t),
} = {}) {
  try {
    const [command, ...rest] = argv;
    if (!COMMANDS.includes(command)) throw new CliError(`Commands: ${COMMANDS.join(', ')}`);
    const helper = client ?? helperClient();
    const here = path.resolve(cwd);
    const stdin = async () => (input === undefined ? readStdin() : input);
    const json = (value) => out(`${JSON.stringify(value, null, 2)}\n`);
    const lines = (list) => out(`${list.map((l) => l.replace(BREAK, ' ')).join('\n')}\n`);

    if (command === 'cards') {
      only(rest, 0, 'cards takes no arguments');
      json(await cards({ client: helper, cwd: here, now }));
    } else if (command === 'card') {
      only(rest, 0, 'card takes no arguments: give the card as JSON on standard input');
      json(await card({ client: helper, cwd: here, input: parsed(await stdin()) }));
    } else if (command === 'again') {
      if (rest.length !== 1 || !/^[1-9][0-9]{0,8}$/.test(rest[0])) throw new CliError('Give the card\'s number on the board: again <n>');
      json(await again({ client: helper, cwd: here, n: Number(rest[0]) }));
    } else if (command === 'record') {
      only(rest, 1, `Give the kind to record: record <kind>, one of ${RECORD_KINDS.join(', ')}`);
      if (!RECORD_KINDS.includes(rest[0])) throw new CliError(`record takes one of: ${RECORD_KINDS.join(', ')}`);
      json(await record({ client: helper, cwd: here, kind: rest[0], input: parsed(await stdin()), ...(makeId ? { makeId } : {}) }));
    } else if (command === 'similar') {
      only(rest, 0, 'similar takes no arguments: give the request\'s text on standard input');
      json(await similar({ client: helper, cwd: here, text: await stdin() }));
    } else if (command === 'views') {
      only(rest, 1, `Give the view's name: views <name>, one of ${VIEW_NAMES.join(', ')}`);
      lines(await view({ client: helper, cwd: here, name: rest[0], now }));
    } else {
      lines(await explain({ client: helper, cwd: here, term: rest.join(' ') }));
    }
    return 0;
  } catch (error) {
    const message = error instanceof CliError ? error.message : `That did not work: ${error instanceof Error ? error.message : 'unknown error'}`;
    err(`${message.replace(/\s*[\r\n]+\s*/g, ' ')}\n`);
    return 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  process.exitCode = await main(process.argv.slice(2));
}
