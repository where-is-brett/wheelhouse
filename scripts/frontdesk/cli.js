// scripts/frontdesk/cli.js
// The front desk's one command, as `node "<pluginRoot>/scripts/frontdesk/cli.js" <command>`, with
// JSON on standard input where a command takes it:
//   cards           this visit's cards, as AskUserQuestion's input, and how many are left; first
//                   it makes an answer card for each open question from the build that no waiting
//                   card asks yet, the card for each click the merge gate waits for, and one for
//                   each lineage hold. Under STOP, the Lift STOP card alone
//   card            composes one card from the composer's input and records it ({ question, id })
//   again <n>       the card the board numbers n, to ask again
//   record <kind>   records something the front desk decided: one of RECORD_KINDS, the data as JSON;
//                   for a work event's document and an amendment, it works out the hash and prints it
//   similar [words] the open work, ideas and rejections that share words with a request: its
//                   words as the arguments, or its text on standard input
//   views <name>    one view as short lines: rulebook, waiting, ideas, glossary, settings, levels or
//                   work (the open work, running and waiting, in the glossary's plain words)
//   explain <term>  the glossary's plain words for a term, with its example
//   review          the delegation review: each proposal as a level waiting for the director, with
//                   its confirm card, as AskUserQuestion's input; then records the review as done
//   preview <n>     the address of pull request n's preview, for "Show me", or a sentence saying
//                   there is none
// The front desk runs in the sandbox, which can't read ~/.wheelhouse/, so every read and write is
// a request to the helper, naming this folder for the helper to place the project. Nothing here
// writes a director's answer: `record` takes only the plain kinds the front desk decides, never a
// card, a card's answer, a shown or asked record, or a signed kind, and an answer card's options
// come only from the question the build recorded. Every card handed out is recorded as asked, and
// its words are put in the glossary's plain words. Errors are one line on standard error.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { helperClient } from '../host/helper-client.js';
import { composeCard, answerInput, PART_LABELS } from '../cards/compose.js';
import { cardsForVisit, existingCard, cardNumbered, asQuestion } from '../cards/visit.js';
import { gateAsksDue, gateInput, holdInput, holdsDue, stillWaits, withPutBack } from '../cards/build-loop.js';
import { heldByNotNow, numberedWaiting } from '../board/model.js';
import { glossaryOf, knownConcepts, plainWords, termPattern } from './glossary.js';
import { checkSetting, definitionOf, KNOWN, SETTINGS, WINDOWS_BUILD_COMMANDS, OWN_GITHUB_APP_KEY } from '../settings/catalogue.js';
import { CARD } from '../lib/front-desk.js';
import { effectiveSettings, levelWords, settingsText, settingWords } from '../settings/effective.js';
import { similar as similarTo } from '../intake/similar.js';
import { answerLine, ID } from '../state/card-lines.js';
import { countsAtOnce } from '../state/views.js';
import { briefHash } from '../feature/files.js';
import { endedBy, since, NO_PLAN, STARTS_UNAPPROVED } from '../foreman/queue.js';
import { startedAsScript } from '../lib/started-as-script.js';

// An error whose message is said to the session as it is.
export class CliError extends Error {}

// The kinds `record` writes: the front desk's own, and the build loop's that its intake writes
// (work, amendment, incident, and the no-blame note when an incident ends).
export const RECORD_KINDS = Object.freeze([
  'ruling', 'idea', 'rejection', 'glossary', 'decision', 'risk', 'blocker', 'reversal', 'setting',
  'work', 'amendment', 'incident', 'note',
]);
export const VIEW_NAMES = Object.freeze(['rulebook', 'waiting', 'ideas', 'glossary', 'settings', 'levels', 'work']);
const COMMANDS = ['cards', 'card', 'again', 'record', 'similar', 'views', 'explain', 'review', 'preview'];
export { MEANWHILE, CHECKS_UNSAID } from '../cards/compose.js';
// The Lift STOP card, which `cards` puts first under STOP. It is composed on each visit and never
// recorded as a card, since under STOP the helper writes nothing; the click on it is signed by the
// prompt record from its set line, and only while STOP is on (ruling F25).
const LIFT_STOP_CARD = Object.freeze({
  kind: 'lift-stop',
  level: 3,
  what: 'STOP is on: every agent has halted, and nothing is written, pushed or merged.',
  why: 'Only you can lift STOP, so it comes to you.',
  options: [
    { label: 'Lift STOP', says: 'The agents carry on from where they halted.' },
    { label: 'Not now', says: 'STOP stays on, and nothing moves until you lift it.' },
  ],
  recommend: 'Not now',
  because: 'STOP is the safe side: lift it once you are sure what was in progress can carry on',
  meanwhile: 'Everything stays halted; reading and reporting carry on.',
});
const INPUT_BYTES = 1024 * 1024;
const BREAK = /[\r\n\v\f\u0085\u2028\u2029]/;
// Every run of line breaks, to put each answered line on one line.
const BREAKS = /\s*[\r\n\v\f\u0085\u2028\u2029]+\s*/g;
const HEAD = /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/;
// A decision topic: a slug, so the delegation review counts it exactly (ruling F40).
const TOPIC = new RegExp(`^${ID}$`);

const isPlain = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
const flat = (x) => (typeof x === 'string' ? x.replace(/\s+/g, ' ').trim() : x);
const said = (answer, otherwise) => answer?.refused ?? answer?.why ?? otherwise;

// --- Asking the helper ---

// The views, whether STOP is on, with `cards` the card events the board numbers its list from, and
// with `answers` the card-answer events.
async function viewsOf(client, cwd, { cards = false, answers = false } = {}) {
  const got = await client.state.views({ cwd, ...(cards ? { cards: true } : {}), ...(answers ? { answers: true } : {}) });
  if (got?.ok !== true || !isPlain(got.views)) throw new CliError(said(got, 'The host helper gave no views'));
  if (cards && !Array.isArray(got.cards)) throw new CliError('The host helper gave no card events');
  if (answers && !Array.isArray(got.answers)) throw new CliError('The host helper gave no card answers');
  return { views: got.views, stop: got.stop === true, cards: cards ? got.cards : [], answers: answers ? got.answers : [] };
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

// Records the cards handed out as asked, so a card dismissed with no answer isn't offered again.
// Resolves with the problems to report: none when it is written, and none under STOP, when the
// helper writes nothing and the cards are still given.
async function markAsked(client, cwd, ids, stop) {
  if (ids.length === 0) return [];
  try {
    await write(client, cwd, 'asked', { cards: ids });
    return [];
  } catch (error) {
    return stop ? [] : [`The cards weren't marked as asked, so they may be offered again: ${error.message}`];
  }
}

const withProblems = (problems) => (problems.length > 0 ? { problems } : {});

// --- Plain words ---

const LABELS = [...Object.values(SETTINGS), KNOWN].map((setting) => setting.label);
// Joins a card's texts so a term can't run from one into the next ("pull" then "request").
const JOIN = '\n\u0000\n';
const TERMS = '\n\nTerms: ';

// The words a card's texts go through, as the board-context hook takes them: the glossary from the
// views, the explanations setting and the concepts the director knows from the settings in force,
// and what stays as written: the settings' names and the titles of the work. A profile that can't
// be read gives the defaults.
async function wordsOf(client, views, now) {
  let own = {};
  try {
    const got = await client.profile?.views?.({});
    if (got?.ok === true && isPlain(got.views?.settings)) own = got.views.settings;
  } catch {
    // The project's settings and the defaults still hold.
  }
  const settings = effectiveSettings({ project: isPlain(views.settings) ? views.settings : {}, profile: own, now });
  const titles = Object.values(isPlain(views.work) ? views.work : {}).map((w) => flat(w?.work?.data?.title)).filter((t) => typeof t === 'string' && t !== '');
  return { glossary: glossaryOf(views.glossary), explanations: settings.explanations?.value, known: knownConcepts(settings), protect: [...LABELS, ...titles] };
}

// The composer's input with what the director reads in plain words (design section 5.3): what,
// why, what each option says, because, meanwhile and the checks line. They go through as one
// text, so each term is put in plain words where the card first uses it, and the meaning of a term
// kept as written follows the last part. Labels, the recommendation and the target stay as given,
// and so do quotations, commands, names and what the card's set line names. Null when the texts
// can't be taken apart again.
function plainInput(input, words) {
  const says = input.options.map((o) => (typeof o.says === 'string' ? o.says : null));
  const texts = [input.what, input.why, ...says.filter((t) => t !== null), input.because, input.meanwhile, ...(input.checks === undefined ? [] : [input.checks])]
    .map((t) => t.trim());
  if (texts.some((t) => t.includes('\u0000'))) return null;
  const target = isPlain(input.target) ? input.target : {};
  const named = [target.work, target.incident, target.branch, target.event?.data?.words].filter((t) => typeof t === 'string' && t !== '');
  const { text } = plainWords(texts.join(JOIN), words.glossary, { ...words, protect: [...words.protect, ...named] });
  const cut = text.indexOf(TERMS);
  const parts = (cut < 0 ? text : text.slice(0, cut)).split(JOIN);
  if (parts.length !== texts.length) return null;
  if (cut >= 0) {
    const last = parts.at(-1);
    parts[parts.length - 1] = `${last}${/[.!?]$/.test(last) ? '' : '.'} ${text.slice(cut + 2)}`;
  }
  const next = () => parts.shift();
  const what = next();
  const why = next();
  const options = input.options.map((o) => (typeof o.says === 'string' ? { ...o, says: next() } : o));
  const because = next();
  const meanwhile = next();
  return { ...input, what, why, options, because, meanwhile, ...(input.checks === undefined ? {} : { checks: next() }) };
}

// Composes a card in the glossary's plain words. Its concepts are the terms its words use as
// written. When the plain words would make a card the composer refuses (too long, most often), the
// card is composed as written instead. Throws the composer's refusal of the card as written.
function composePlain(input, words) {
  const written = compose({ ...input, glossary: words.glossary });
  let plain = null;
  try {
    plain = plainInput(input, words);
  } catch {
    plain = null;
  }
  if (plain === null) return written;
  try {
    return composeCard({ ...plain, concepts: written.card.concepts });
  } catch {
    return written;
  }
}

// --- cards ---

// The answer card for a question the build recorded, from the stored event (compose.js,
// answerInput). The work is named by its title, or by its id when it has none or the card won't
// carry the title; the build's ask commands check a question against the card naming the id.
function answerCard(id, data, views, words) {
  if (!isPlain(data) || data.id !== id) throw new Error('its record can\'t be read');
  const title = flat(views.work?.[data.work]?.work?.data?.title);
  let refusal = null;
  for (const name of [...new Set([title || data.work, data.work])]) {
    try {
      return composePlain(answerInput(data, name), words);
    } catch (error) {
      refusal ??= error;
    }
  }
  throw refusal;
}

// The card for a click the merge gate waits for, naming the work by its title, or by its id when
// it has none or the card won't carry the title (the first part may name no other pull request or
// commit than the set line's).
function gateCard(entry, views, words) {
  const work = entry.data.work;
  const title = flat(views.work?.[work]?.work?.data?.title);
  let refusal = null;
  for (const name of [...new Set([title || work, work, 'this work'])]) {
    try {
      return composePlain(gateInput(entry, name), words);
    } catch (error) {
      refusal ??= error;
    }
  }
  throw refusal;
}

// A lineage hold's card, naming the first paths that differ, or only how many when they make the
// card too long. When neither composes, the first refusal is the one given.
function holdCard(hold, words) {
  try {
    return composePlain(holdInput(hold), words);
  } catch (error) {
    try {
      return composePlain(holdInput(hold, { short: true }), words);
    } catch {
      throw error;
    }
  }
}

// Whether the pull request a gate-asks names still waits for its click, as the host says (see
// stillWaits; `again` for a card asked again). A read that fails says it does: asking is the safe side.
async function gateStillWaits(client, cwd, entry, again) {
  try {
    const got = await client.prState({ cwd, number: entry.data.pr });
    return got?.ok === true ? stillWaits(entry, got.result, { again }) : true;
  } catch {
    return true;
  }
}

// The cards the build loop's records call for (rulings F71, F72): for each click the merge gate
// waits for, its approval or CI push card, made once, unless the host says the pull request has
// moved on, and a CI push card asked again when its click lapsed before the push (gateAsksDue,
// R121); and a question card for each lineage
// hold, made once. Resolves with { made, again }: how many cards were recorded, and the ids of the
// cards to put back on this visit. What couldn't be made goes into `problems`.
async function buildLoopCards({ client, cwd, views, words, now, problems }) {
  let made = 0;
  const again = new Set();
  for (const due of gateAsksDue(views, now)) {
    const { pr } = due.entry.data;
    if (!(await gateStillWaits(client, cwd, due.entry, due.again !== undefined))) continue;
    if (due.again !== undefined) {
      again.add(due.again);
      continue;
    }
    let card;
    try {
      ({ card } = gateCard(due.entry, views, words));
    } catch (error) {
      problems.push(`The click pull request #${pr} waits for couldn't be made a card: ${error.message}`);
      continue;
    }
    try {
      await write(client, cwd, 'card', card);
      made += 1;
    } catch (error) {
      problems.push(`The card for pull request #${pr} wasn't recorded: ${error.message}`);
    }
  }
  for (const hold of holdsDue(views)) {
    try {
      await write(client, cwd, 'card', holdCard(hold, words).card);
      made += 1;
    } catch (error) {
      problems.push(`The card for the lineage hold ${hold.id} wasn't made: ${error.message}`);
    }
  }
  return { made, again };
}

// This visit's cards: { questions, left }, and `problems` when something couldn't be done. An open
// question from the build that no waiting card asks gets its answer card first, and the build
// loop's records theirs (buildLoopCards). The cards handed out are recorded as asked, so a card
// dismissed with no answer isn't offered on every turn. A write the helper refuses is a problem,
// not a failure: the cards waiting are still given. Under STOP the visit's one card is Lift STOP:
// the helper writes nothing, so no card is made, and the cards waiting stay on the board, counted
// in `left`, for the visit after STOP is lifted.
export async function cards({ client, cwd, now }) {
  const problems = [];
  let { views, stop } = await viewsOf(client, cwd);
  const words = await wordsOf(client, views, now);
  const lift = stop ? composePlain(LIFT_STOP_CARD, words).question : null;
  const at = typeof now === 'function' ? now() : new Date(now ?? Date.now());
  let made = 0;
  for (const [id, entry] of Object.entries(isPlain(views.questions) && !stop ? views.questions : {})) {
    if (!isPlain(entry) || entry.answer || existingCard(views, answerLine(id)) !== null) continue;
    let card;
    try {
      ({ card } = answerCard(id, entry.question?.data, views, words));
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
  let again = new Set();
  if (!stop) {
    const built = await buildLoopCards({ client, cwd, views, words, now: at, problems });
    made += built.made;
    again = built.again;
  }
  // A card put back that no longer waits (it was decided) is put back from its card event.
  const decided = [...again].some((id) => !(Array.isArray(views.waiting) ? views.waiting : []).some((c) => c?.id === id));
  let events = [];
  if (made > 0 || decided) ({ views, cards: events } = await viewsOf(client, cwd, { cards: decided }));
  const chosen = cardsForVisit(withPutBack(views, again, events), { room: lift === null ? CARD.questions : 0 });
  problems.push(...await markAsked(client, cwd, chosen.ids, stop));
  return { questions: [...(lift === null ? [] : [lift]), ...chosen.questions], left: chosen.left, ...withProblems(problems) };
}

// --- card ---

// A card's or a reversal's topic in lower case, refused when it isn't a slug (ruling F40).
function topicOf(given) {
  const topic = typeof given === 'string' ? given.trim().toLowerCase() : '';
  if (!TOPIC.test(topic)) throw new CliError('A topic is a short slug: lower-case letters, digits and hyphens, at most 40, such as copy-changes');
  return topic;
}

// Composes one card and records it, unless a waiting card already carries its set line: then that
// card comes back as it was recorded, so the director is asked the card the state holds, with
// `alreadyAsked` when a visit has handed it out already. The card handed out is recorded as asked.
// An approval whose target names only the pull request gets its head commit from the host. A
// topic is kept in lower case, so the delegation review counts it as one.
export async function card({ client, cwd, input, now }) {
  if (!isPlain(input)) throw new CliError('Give the card as a JSON object on standard input');
  if (input.kind === 'answer') throw new CliError('An answer card comes from `cards`, made from the question as the build recorded it');
  if (input.event !== undefined) throw new CliError('A card for a record of the build\'s comes from `cards`, made once from the record');
  const topic = input.topic === undefined ? undefined : topicOf(input.topic);
  const { views } = await viewsOf(client, cwd);
  let target = input.target;
  if (input.kind === 'approval' && isPlain(target) && target.sha === undefined && Number.isSafeInteger(target.pr) && target.pr >= 1) {
    const state = await client.prState({ cwd, number: target.pr });
    if (state?.ok !== true) throw new CliError(said(state, `The host helper couldn't read pull request #${target.pr}`));
    const sha = state.result?.headSha;
    if (typeof sha !== 'string' || !HEAD.test(sha)) throw new CliError(`The host gave no head commit for pull request #${target.pr}`);
    target = { ...target, sha };
  }
  const { question, card: data } = composePlain({ ...input, target, ...(topic === undefined ? {} : { topic }) }, await wordsOf(client, views, now));
  const found = existingCard(views, data.line);
  if (found !== null) {
    const waiting = views.waiting.find((c) => c.id === found);
    if (waiting.asked !== null && waiting.asked !== undefined) return { question: asQuestion(waiting), id: found, alreadyAsked: true };
    return { question: asQuestion(waiting), id: found, ...withProblems(await markAsked(client, cwd, [found], false)) };
  }
  const { id } = await write(client, cwd, 'card', data);
  return { question, id, ...withProblems(await markAsked(client, cwd, [id], false)) };
}

// --- again ---

// The card the board numbers n, as it was composed (in plain words then), recorded as asked again.
export async function again({ client, cwd, n }) {
  const { views, stop, cards: events } = await viewsOf(client, cwd, { cards: true });
  const found = cardNumbered(views, n, { events });
  if (found === null) throw new CliError(`The board has no card ${n} to ask again; a question from the build is asked once \`cards\` has made its card`);
  return { questions: [asQuestion(found)], ...withProblems(await markAsked(client, cwd, [found.id], stop)) };
}

// --- record ---

// The confirm card for a ruling, which names the ruling by its id and its words.
function confirmCard(event, words) {
  return composePlain({
    kind: 'confirm',
    level: 3,
    what: `A rule you gave, in your words: "${event.data.words}"`,
    why: 'A rule is followed only once you confirm it, so it comes to you.',
    options: [{ label: 'Confirm', says: 'The rule goes into the rulebook and is followed from now on.' }],
    recommend: 'Confirm',
    because: 'these are your own words, as you gave them',
    meanwhile: 'The rule is written down, but nothing follows it until you confirm.',
    target: { event },
  }, words);
}

// The confirm card for a setting, which names the setting by its id and its words (ruling F30). A
// learnt setting carries `because`, learning's one-line reason, which the card gives.
export function settingCard(event, words) {
  const learnt = typeof event.data.because === 'string' && event.data.because.trim() !== '';
  const whose = definitionOf(event.data.key)?.home === 'project' ? 'this project\'s settings' : 'your settings';
  return composePlain({
    kind: 'confirm',
    level: 3,
    what: `A change to ${whose}, ${learnt ? 'suggested from how you work' : 'as you asked'}: ${event.data.words}`,
    why: 'A setting changes only once you confirm it, so it comes to you.',
    options: [{ label: 'Confirm', says: 'The setting takes effect from now on.' }],
    recommend: 'Confirm',
    because: learnt ? event.data.because : 'it is the change you asked for',
    meanwhile: 'Nothing changes until you confirm.',
    target: { event },
  }, words);
}

// Writes a setting the catalogue allows, with its words, and its confirm card into the project
// `cwd` names: { id, pushed, card?: { question, id } }. The card isn't marked asked. A setting no
// card can carry is never written: the card is composed before the setting is. The profile gives
// its own id, so a profile setting's card is tried first under a stand-in id and composed again
// under the real one; a project's setting is written under the id its card was composed with.
export async function writeSetting({ client, cwd, data, words, makeId = () => crypto.randomUUID() }) {
  try {
    checkSetting(data.key, data.value, data.until);
  } catch (error) {
    throw new CliError(error.message);
  }
  // Build commands on Windows are turned on only by the director's click on their own card, never
  // by an agent (design section 12.2); the front desk may write only the off switch, Ask.
  if (definitionOf(data.key) === WINDOWS_BUILD_COMMANDS && data.value !== 'ask') {
    throw new CliError('Build commands on Windows are turned on only by a click on their own card; the front desk can set them back to ask');
  }
  // The person's own GitHub App decides which app holds the narrow keys (ruling R56): only setup
  // records it, from the app GitHub shows for it.
  if (data.key === OWN_GITHUB_APP_KEY) throw new CliError('Your own GitHub App is recorded only by setup, from the app GitHub shows');
  const setting = { ...data, words: settingWords(data.key, data.value, data.until) };
  const answered = (got) => ({ id: got.id, pushed: got.pushed === true });
  const withCard = async (got) => {
    const { question, card } = settingCard({ kind: 'setting', id: got.id, data: setting }, words);
    try {
      const made = await write(client, cwd, 'card', card);
      return { ...answered(got), card: { question, id: made.id } };
    } catch (error) {
      throw new CliError(`The setting was recorded as ${got.id}, but its confirm card wasn't: ${error.message}`);
    }
  };
  if (definitionOf(data.key).home === 'profile') {
    const needsCard = !countsAtOnce({ kind: 'setting', data: setting });
    if (needsCard) settingCard({ kind: 'setting', id: makeId(), data: setting }, words);
    const got = await client.profile.write({ kind: 'setting', data: setting });
    if (got?.ok !== true || typeof got.id !== 'string') throw new CliError(said(got, 'The host helper did not record the setting'));
    return needsCard ? withCard(got) : answered(got);
  }
  const id = makeId();
  settingCard({ kind: 'setting', id, data: setting }, words);
  const got = await write(client, cwd, 'setting', setting, id);
  if (got.id !== id) throw new CliError(`The setting was recorded as ${got.id}, not under the id its confirm card names`);
  return withCard(got);
}

// The hash of a document in the project, its text with line endings evened, as a work event or an
// amendment names it: the front desk in the sandbox has no other way to work it out. A hash given
// must be the document's as it stands; a document that can't be read, or is over INPUT_BYTES, is
// refused, a hash given or not.
function documentHash(cwd, file, given) {
  let stat = null;
  const full = path.resolve(cwd, file);
  try {
    stat = fs.statSync(full);
  } catch {
    stat = null;
  }
  if (stat === null || !stat.isFile()) throw new CliError(`The document ${file} can't be read: write it first, then record it`);
  if (stat.size > INPUT_BYTES) throw new CliError(`The document ${file} is over 1 MB, too long to record by its hash`);
  let text;
  try {
    text = fs.readFileSync(full, 'utf8');
  } catch {
    throw new CliError(`The document ${file} can't be read: write it first, then record it`);
  }
  const hash = briefHash(text);
  if (given !== undefined && given !== hash) throw new CliError(`The hash given for ${file} is not the document's as it stands (${hash.slice(0, 12)}): leave the hash out, and record works it out`);
  return hash;
}

// Whether `id` names open work, as the queue reads it: no report has ended it, and its feature
// hasn't closed since it was queued (scripts/foreman/queue.js).
function isOpen(views, id) {
  const entry = isPlain(views.work) ? views.work[id] : undefined;
  if (!isPlain(entry)) return false;
  const feature = isPlain(views.features) ? views.features[id] : undefined;
  const closed = feature?.data?.step === 'closed' && since(feature, entry.work);
  return !closed && !endedBy(views.reports, id, entry.work);
}

// A work event's document, or an amendment of the one file open work names, with its hash worked out.
async function withHash(client, cwd, kind, input) {
  if (kind === 'work' && isPlain(input.doc) && typeof input.doc.path === 'string') {
    return { ...input, doc: { ...input.doc, hash: documentHash(cwd, input.doc.path, input.doc.hash) } };
  }
  if (kind !== 'amendment') return input;
  const { views } = await viewsOf(client, cwd);
  if (!isOpen(views, input.work)) throw new CliError(`The work ${input.work} isn't open, so there is nothing to amend`);
  const file = views.work[input.work].work?.data?.doc?.path;
  if (typeof file !== 'string') {
    if (input.hash !== undefined) return input;
    throw new CliError(`The work ${input.work} names no document, so give the changed document's hash`);
  }
  return { ...input, hash: documentHash(cwd, file, input.hash) };
}

// Records one event and resolves with { id, pushed }, with `hash` for a work event's document or an
// amendment, and for a ruling or a setting its confirm card, recorded too, as { question, id }. A setting the catalogue refuses is refused here, before
// the helper is asked; the director's own settings go to their profile, and a concept set to false
// needs no card (writeSetting). A ruling keeps its words exactly as given: its card is composed
// first, under the id the ruling is then written with, so a ruling whose words no card can carry
// is never written. The confirm card is recorded as asked.
export async function record({ client, cwd, kind, input, now, makeId = () => crypto.randomUUID() }) {
  if (!RECORD_KINDS.includes(kind)) throw new CliError(`record takes one of: ${RECORD_KINDS.join(', ')}`);
  if (!isPlain(input)) throw new CliError(`Give the ${kind} as a JSON object on standard input`);
  // The delegation review's note is written by `review` alone, so a review is never recorded as done that wasn't.
  if (kind === 'note' && Object.hasOwn(input, 'review')) throw new CliError('A note with a review field is written by `review` alone; leave the field out');
  const answered = (got) => ({ id: got.id, pushed: got.pushed === true });
  if (kind === 'setting') {
    try {
      checkSetting(input.key, input.value, input.until);
    } catch (error) {
      throw new CliError(error.message);
    }
    // Only what the setting is: its words are made from it, and a reason marks a learnt one.
    const data = { key: input.key, value: input.value, ...(input.until === undefined ? {} : { until: input.until }) };
    const words = countsAtOnce({ kind: 'setting', data }) ? null : await wordsOf(client, (await viewsOf(client, cwd)).views, now);
    const got = await writeSetting({ client, cwd, data, words, makeId });
    if (got.card === undefined) return got;
    return { ...got, ...withProblems(await markAsked(client, cwd, [got.card.id], false)) };
  }
  // A reversal's topic is a slug in lower case, as a card's is, so the delegation review counts them together.
  if (kind === 'reversal') return answered(await write(client, cwd, kind, { ...input, topic: topicOf(input.topic) }));
  if (kind === 'work' || kind === 'amendment') {
    const data = await withHash(client, cwd, kind, input);
    const hash = kind === 'work' ? data.doc?.hash : data.hash;
    return { ...answered(await write(client, cwd, kind, data)), ...(typeof hash === 'string' ? { hash } : {}) };
  }
  if (kind !== 'ruling') return answered(await write(client, cwd, kind, input));

  const { words } = input;
  if (typeof words !== 'string' || words.trim() === '' || BREAK.test(words)) throw new CliError('A ruling needs its words, on one line, as the director gave them');
  const { views } = await viewsOf(client, cwd);
  const id = makeId();
  const { question, card: data } = confirmCard({ kind: 'ruling', id, data: input }, await wordsOf(client, views, now));
  const got = await write(client, cwd, 'ruling', input, id);
  if (got.id !== id) throw new CliError(`The ruling was recorded as ${got.id}, not under the id its confirm card names`);
  let made;
  try {
    made = await write(client, cwd, 'card', data);
  } catch (error) {
    throw new CliError(`The ruling was recorded as ${id}, but its confirm card wasn't: ${error.message}`);
  }
  return { ...answered(got), card: { question, id: made.id }, ...withProblems(await markAsked(client, cwd, [made.id], false)) };
}

// --- review ---

// The confirm card for a level the delegation review proposes, which names the level by its id and
// its words, and gives the review's reason (ruling F42). Confirm puts the topic into the rulebook
// at that level (ruling F46); a proposal's card offers Keep as is too (compose.js).
export function levelCard(event, words) {
  const lower = event.data.value < 3;
  return composePlain({
    kind: 'confirm',
    level: 3,
    what: `A change to what I can decide alone, from the regular look at it: ${event.data.words}`,
    why: 'Only you change what I can decide without you, so it comes to you.',
    options: [{
      label: 'Confirm',
      says: lower
        ? `It goes into the rulebook at level ${event.data.value}: its questions are decided without a card, and told in the briefing.`
        : `It goes into the rulebook at level ${event.data.value}: its questions come to you as cards, and wait for your answer.`,
    }],
    recommend: 'Confirm',
    because: event.data.because,
    meanwhile: 'Nothing changes until you confirm.',
    target: { event },
  }, words);
}

// The delegation review (design section 6): { questions, left }, and `problems` when something
// couldn't be done. The helper works out the proposals from the project's events; each is written
// as a `level` event with its words and reason, under the id its confirm card was composed with,
// then the card. One call's worth of cards is handed out and marked asked; the rest wait on the
// board, counted in `left`. The review is recorded as done last, even with nothing to propose, so
// it isn't due again until the next period, but only when every proposal and its card were
// recorded: otherwise it stays due, and a level whose card wasn't written gets it from the
// board-context hook on the next visit. Under STOP nothing is written, so it is refused.
export async function review({ client, cwd, now, makeId = () => crypto.randomUUID() }) {
  const got = await client.state.views({ cwd, review: true });
  if (got?.ok !== true || !isPlain(got.views)) throw new CliError(said(got, 'The host helper gave no views'));
  if (got.stop === true) throw new CliError('STOP is on, so the review waits until it is lifted');
  if (!isPlain(got.review) || !Array.isArray(got.review.proposals)) throw new CliError('The host helper gave no review');
  const words = await wordsOf(client, got.views, now);
  const problems = [];
  const made = [];
  for (const proposal of got.review.proposals) {
    const { topic, to, because } = isPlain(proposal) ? proposal : {};
    if (typeof topic !== 'string' || !TOPIC.test(topic) || ![1, 2, 3, 4].includes(to) || typeof because !== 'string') {
      problems.push('A proposal from the helper couldn\'t be read');
      continue;
    }
    const id = makeId();
    const data = { key: topic, value: to, words: levelWords(topic, to), because };
    let composed;
    try {
      composed = levelCard({ kind: 'level', id, data }, words);
    } catch (error) {
      problems.push(`The proposal for ${topic} couldn't be made a card: ${error.message}`);
      continue;
    }
    try {
      const wrote = await write(client, cwd, 'level', data, id);
      if (wrote.id !== id) throw new CliError(`it was recorded as ${wrote.id}, not under the id its confirm card names`);
    } catch (error) {
      problems.push(`The proposal for ${topic} wasn't recorded: ${error.message}`);
      continue;
    }
    try {
      made.push({ question: composed.question, id: (await write(client, cwd, 'card', composed.card)).id });
    } catch (error) {
      problems.push(`The proposal for ${topic} was recorded as ${id}, but its confirm card wasn't: ${error.message}`);
    }
  }
  const complete = problems.length === 0;
  const asked = made.slice(0, CARD.questions);
  problems.push(...await markAsked(client, cwd, asked.map((c) => c.id), false));
  if (!complete) {
    problems.push('The review wasn\'t recorded as done, since not every proposal was, so it stays due');
  } else {
    try {
      await write(client, cwd, 'note', { review: 'delegation', at: new Date(typeof now === 'function' ? now() : now).toISOString() });
    } catch (error) {
      problems.push(`The review wasn't recorded as done, so it stays due: ${error.message}`);
    }
  }
  return { questions: asked.map((c) => c.question), left: made.length - asked.length, ...withProblems(problems) };
}

// --- similar ---

export async function similar({ client, cwd, text }) {
  const asked = typeof text === 'string' ? text.trim() : '';
  if (asked === '') throw new CliError('Give the request\'s words after similar, or its text on standard input; nothing was given');
  const { views } = await viewsOf(client, cwd);
  return { similar: similarTo(asked, views).map(({ score, ...item }) => ({ ...item, score: Math.round(score * 100) / 100 })) };
}

// --- views ---

const titleOf = (entry, key) => flat(entry?.data?.title) || flat(entry?.data?.text) || flat(entry?.data?.what) || key;
const listed = (lines, none) => (lines.length > 0 ? lines : [none]);

// One view as short lines.
export async function view({ client, cwd, name, now }) {
  if (!VIEW_NAMES.includes(name)) throw new CliError(`views takes one of: ${VIEW_NAMES.join(', ')}`);
  const { views, cards: events, answers } = await viewsOf(client, cwd, { cards: name === 'waiting' || name === 'levels', answers: name === 'work' });
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
  if (name === 'levels') return listed(levelLines(views, events), 'No decision topics yet.');
  if (name === 'work') return workLines(views, answers, await wordsOf(client, views, now));
  // settings: the project's over the director's own, over the defaults
  const profile = await client.profile.views({});
  const own = profile?.ok === true && isPlain(profile.views?.settings) ? profile.views.settings : {};
  return settingsText(effectiveSettings({ project: isPlain(views.settings) ? views.settings : {}, profile: own, now })).split('\n');
}

// Open work's step or state in words, and whether a feature runs for it: one that is writing its
// plan or building. A quick or bug feature has no plan, so it builds from its start. A planned one
// waits for the go-ahead, and one the director's Not now to its build commands holds (`held`, as the
// board reads it) waits on them. Work whose feature closed before a `work` event queued it again
// hasn't started this time.
function workState(entry, feature, held) {
  const { lane, visible } = entry.work?.data ?? {};
  const step = isPlain(feature?.data) && !(feature.data.step === 'closed' && !since(feature, entry.work)) ? feature.data.step : null;
  if (step !== null && step !== 'closed' && held) return { running: false, state: 'waiting for the director to allow its build commands' };
  if (step === 'building' || (step === 'started' && NO_PLAN.includes(lane))) return { running: true, state: 'building' };
  if (step === 'started') return { running: true, state: 'writing its plan' };
  if (step === 'planned') return { running: false, state: 'planned, waiting for the go-ahead to build' };
  if (step === 'paused') {
    const why = { director: 'for the director\'s change to it', 'five-hour': 'until the five-hour usage window has room' }[feature.data.pausedFor];
    return { running: false, state: why ? `paused ${why}` : 'paused' };
  }
  const approval = (!STARTS_UNAPPROVED.includes(lane) || visible === true) && entry.approved !== true;
  return { running: false, state: approval ? 'waiting for the director\'s approval' : 'queued, not started yet' };
}

// What each lane is, in words a sentence takes.
const LANE_WORDS = { quick: 'quick work', small: 'small work', feature: 'a feature', bug: 'a bug fix' };

// The open work, running work first, each oldest first (then by id): its id, title and lane, whether a feature
// runs for it, its step or state, the slice in hand and the pull request the gate waits on or its
// latest report names, either since the work was queued. `answers` are the card-answer events, for
// the director's Not now. In the glossary's plain words, but for the titles, kept as written: the
// front desk reads this to tell the director how things stand.
function workLines(views, answers, words) {
  const features = isPlain(views.features) ? views.features : {};
  const questions = isPlain(views.questions) ? views.questions : {};
  const reports = Object.values(isPlain(views.reports) ? views.reports : {}).filter((r) => isPlain(r?.data));
  const held = (id) => {
    try {
      return heldByNotNow(id, questions, answers.filter(isPlain), reports);
    } catch {
      return false;
    }
  };
  const asks = Object.values(isPlain(views.gateAsks) ? views.gateAsks : {}).filter((a) => isPlain(a?.data));
  const open = Object.entries(isPlain(views.work) ? views.work : {}).filter(([id, entry]) => isPlain(entry?.work?.data) && isOpen(views, id))
    .map(([id, entry]) => ({ id, entry, ...workState(entry, features[id], held(id)) }))
    .sort((a, b) => Number(b.running) - Number(a.running) || String(a.entry.since ?? a.entry.work.at).localeCompare(String(b.entry.since ?? b.entry.work.at))
      || a.id.localeCompare(b.id));
  if (open.length === 0) return ['No work is open: nothing is running or waiting.'];
  const lines = open.map(({ id, entry, running, state }) => {
    const { title, lane } = entry.work.data;
    const slice = running ? features[id]?.data?.slice : undefined;
    const report = views.reports?.[id];
    const pr = asks.filter((a) => a.data.work === id && since(a, entry.work)).sort((a, b) => String(a.at).localeCompare(String(b.at))).at(-1)?.data.pr
      ?? (since(report, entry.work) ? report?.data?.pr : undefined);
    return [
      `${id}: ${flat(title) || id}${Object.hasOwn(LANE_WORDS, lane) ? ` (${LANE_WORDS[lane]})` : ''}: ${running ? 'running' : 'not running'}`,
      state,
      ...(isPlain(slice) && Number.isInteger(slice.n) && Number.isInteger(slice.m) ? [`slice ${slice.n} of ${slice.m}`] : []),
      ...(Number.isSafeInteger(pr) && pr > 0 ? [`pull request #${pr}`] : []),
    ].join(', ');
  });
  // Labels, ids and work titles stay as written, as the board keeps titles (design section 21).
  const protect = [...LABELS, ...open.map(({ id }) => `${id}:`), ...open.map(({ entry }) => flat(entry.work.data.title)).filter((t) => t !== '')];
  return plainWords(lines.join('\n'), words.glossary, { ...words, protect }).text.split('\n');
}

// The decision topics, for a card to reuse one: each level in force, each level waiting for the
// director's confirmation, then the topics on earlier cards with neither, each sorted by topic.
function levelLines(views, events) {
  const inForce = Object.values(isPlain(views.levels) ? views.levels : {}).filter((l) => isPlain(l) && TOPIC.test(l.key ?? '') && [1, 2, 3, 4].includes(l.value))
    .sort((a, b) => a.key.localeCompare(b.key));
  const waiting = (Array.isArray(views.unconfirmed) ? views.unconfirmed : [])
    .filter((u) => u?.kind === 'level' && TOPIC.test(u.data?.key ?? '') && [1, 2, 3, 4].includes(u.data?.value))
    .sort((a, b) => a.data.key.localeCompare(b.data.key));
  const named = new Set([...inForce.map((l) => l.key), ...waiting.map((u) => u.data.key)]);
  const onCards = [...new Set(events.map((e) => e.data?.topic).filter((t) => typeof t === 'string' && TOPIC.test(t) && !named.has(t)))].sort();
  return [
    ...inForce.map((l) => `${levelWords(l.key, l.value)} (in force)`),
    ...waiting.map((u) => `${levelWords(u.data.key, u.data.value)} (waiting for the director to confirm it)`),
    ...onCards.map((t) => `"${t}": on earlier cards`),
  ];
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

// --- preview ---

// The address of the preview of pull request n's head, which the helper reads from the host, or a
// plain sentence when there is none.
export async function preview({ client, cwd, n }) {
  const got = await client.preview({ cwd, number: n });
  if (got?.ok !== true) throw new CliError(said(got, `The host helper couldn't read pull request #${n}`));
  if (typeof got.url === 'string' && got.url !== '') return [got.url];
  return [`Pull request #${n} has no preview to show: it isn't open, or the host has no finished preview of its latest commit.`];
}

// --- The command line ---

// Standard input as text. A terminal is refused at once, never waited on: the command is run with
// its input piped in.
export async function readInput(stream = process.stdin) {
  if (stream.isTTY) throw new CliError('Give the input on standard input, piped in; nothing was given');
  const chunks = [];
  let size = 0;
  for await (const chunk of stream) {
    size += chunk.length;
    if (size > INPUT_BYTES) throw new CliError('The input on standard input is too long');
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString('utf8');
}

function parsed(text) {
  if (typeof text !== 'string' || text.trim() === '') throw new CliError('Give the input as JSON on standard input; nothing was given');
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
    const stdin = async () => (input === undefined ? readInput() : input);
    const json = (value) => out(`${JSON.stringify(value, null, 2)}\n`);
    const lines = (list) => out(`${list.map((l) => l.replace(BREAKS, ' ')).join('\n')}\n`);

    if (command === 'cards') {
      only(rest, 0, 'cards takes no arguments');
      json(await cards({ client: helper, cwd: here, now }));
    } else if (command === 'card') {
      only(rest, 0, 'card takes no arguments: give the card as JSON on standard input');
      json(await card({ client: helper, cwd: here, input: parsed(await stdin()), now }));
    } else if (command === 'again') {
      if (rest.length !== 1 || !/^[1-9][0-9]{0,8}$/.test(rest[0])) throw new CliError('Give the card\'s number on the board: again <n>');
      json(await again({ client: helper, cwd: here, n: Number(rest[0]) }));
    } else if (command === 'record') {
      only(rest, 1, `Give the kind to record: record <kind>, one of ${RECORD_KINDS.join(', ')}`);
      if (!RECORD_KINDS.includes(rest[0])) throw new CliError(`record takes one of: ${RECORD_KINDS.join(', ')}`);
      json(await record({ client: helper, cwd: here, kind: rest[0], input: parsed(await stdin()), now, ...(makeId ? { makeId } : {}) }));
    } else if (command === 'similar') {
      // The request's words as the arguments, which STOP lets through, or its text on standard input.
      json(await similar({ client: helper, cwd: here, text: rest.length > 0 ? rest.join(' ') : await stdin() }));
    } else if (command === 'review') {
      only(rest, 0, 'review takes no arguments');
      json(await review({ client: helper, cwd: here, now, ...(makeId ? { makeId } : {}) }));
    } else if (command === 'preview') {
      if (rest.length !== 1 || !/^[1-9][0-9]{0,8}$/.test(rest[0])) throw new CliError('Give the pull request\'s number: preview <n>');
      lines(await preview({ client: helper, cwd: here, n: Number(rest[0]) }));
    } else if (command === 'views') {
      only(rest, 1, `Give the view's name: views <name>, one of ${VIEW_NAMES.join(', ')}`);
      lines(await view({ client: helper, cwd: here, name: rest[0], now }));
    } else {
      lines(await explain({ client: helper, cwd: here, term: rest.join(' ') }));
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
