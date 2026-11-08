// scripts/frontdesk/cli.js
// The front desk's one command, as `node "<pluginRoot>/scripts/frontdesk/cli.js" <command>`, with
// JSON on standard input where a command takes it:
//   pull-cards [--here]
//                   lifts the cards the day's budget holds back, then gives what `cards` gives
//   cards [--here]  this visit's cards, as AskUserQuestion's input, and how many are left; first
//                   it makes an answer card for each open question from the build that no waiting
//                   card asks yet, the card for each click the merge gate waits for, and one for
//                   each lineage hold. Under STOP, the Lift STOP card alone. With --here (the director
//                   asked to answer in the chat) the cards given are marked, for two minutes, to be
//                   asked in the chat once
//   decision list   the decisions waiting for the director, by number and question, after making a card of each open question from the
//                   build that has none; decision show <n> prints decision n as the chat message it is, to copy word for word. A decision
//                   is shown in the chat and answered by the director's typed reply, never through the question picker
//   card            composes one card from the composer's input and records it ({ question, id });
//                   with `revises`, the id of a card of its kind waiting now or closed by a later
//                   head, and `changed`, one line saying what changed, it is a revised card that
//                   replaces the one it names; with `said`, the director's own words on the matter, it
//                   carries them and asks for one click; a card already decided is refused, saying
//                   what counted and where ("Already approved in the panel at 10:34")
//   again <n> [--here]
//                   the card the board numbers n, with its id, to ask again
//   why decision <n> [words]
//                   the session copy's answer for decision n of `decision list`, noting nothing
//   why <n> [words] notes that the director asked why about the card the board numbers n, and
//                   prints the one sentence to say before the card; it never gives the card again:
//                   say it, then run `again <n>`. When the card is a waiting decision, the answer of a
//                   read-only copy of the session that raised it follows (scripts/decisions/why.js), to
//                   say as it is; `words` is what the director asked, and each question goes to the copy
//   suggest <card id> <work id> <the change>
//                   hands a change the director suggested on a waiting approval or CI push card to
//                   the build: the work re-stated with the change, in the front desk's own words, as
//                   its title; prints the one line to say
//   pull-back <call id> [--change]
//                   the director's "I'd have wanted to decide that" about a call an agent logged on its own side of the decision line:
//                   it becomes a ruling (with its confirm card), and with --change an intake request to change what was built as well
//   ask-bosun <work>
//                   the director's "fix it" or "ship it" about work with an open pull request: the helper puts the
//                   Bosun's question to them in its own fixed words (fix the findings or restart the builder, or stop the
//                   work; shipping as it is is never offered while a signed review holds the merge) and prints the line to say
//   record <kind>   records something the front desk decided: one of RECORD_KINDS, the data as JSON;
//                   for a work event's document and an amendment, it works out the hash and prints it; a work also
//                   prints `recordHash`, the hash of its record as written;
//                   an amendment needs its read-back, and prints the route line and the read-back to say
//   note            asks the host helper to write this session's note, up to 1,200 characters on standard input (four lines: the task, what
//                   is done, what is next, the decisions open), to <wheelhouse home>/projects/<project>/sessions/<session id>.md,
//                   beside the context gauge's reading; the session is named by CLAUDE_CODE_SESSION_ID
//   similar [words] the open work, ideas and rejections that share words with a request: its
//                   words as the arguments, or its text on standard input
//   views <name>    one view as short lines: rulebook, waiting, ideas, glossary, settings, levels, brief or
//                   work (the open work, running and waiting, in the glossary's plain words);
//                   `views waiting --since <time>` also names the cards answered since then anywhere but the chat
//   Where a live VS Code panel answers a project's cards, cards, again and pull-cards give
//   { "panel": <a line saying so> } instead of `questions`; --here asks them in the chat once.
//   explain <term>  the glossary's plain words for a term, with its example
//   preview <n>     the address of pull request n's preview, for "Show me", or a sentence saying
//                   there is none
//   carry-on <n>    makes open request n ready to carry on (design section 15, A2): the helper
//                   fetches it into the work's own ref; prints the work id it chose, the `from` to
//                   record the work with, and what to write its brief from. `carry-on --line <name>`
//                   does the same for a piece of unfinished work with no request, by the name
//                   `views survey` gives it
//   archive         makes ready the change that moves another agent setup's instructions into
//                   .wheelhouse-archive/ (A4), and `restore` the one that puts them back; each prints
//                   the work id, the `from` and the files it moves
//   confirm <card>  shows the card (its id in the state, or lift-stop) in the helper's own window,
//                   where the director's click is the binding one, and waits for it; prints the
//                   helper's answer, `"recorded":true` when the click was recorded (ruling P8-7). For
//                   an agent whose chat clicks can't bind: Claude Code's front desk never needs it
// The front desk runs in the sandbox, which can't read ~/.wheelhouse/, so every read and write is
// a request to the helper, naming this folder for the helper to place the project: it reads through
// the desk (scripts/desk/), and writes through the helper's own routes. Nothing here
// writes a director's answer but `why`, which notes only that they asked why (a Why? answer, which
// decides nothing): `record` takes only the plain kinds the front desk decides, never a card, a
// card's answer, a shown or asked record, or a signed kind, and an answer card's options come only
// from the question the build recorded. Every card handed out is recorded as asked, and
// its words are put in the glossary's plain words. Errors are one line on standard error.
import { HAND_DONE, HAND_GOAL } from '../lib/by-hand-done.js';
import { BRIEF_LINES, addFact, briefProblem, briefText, wholeBrief } from '../state/brief.js';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { helperClient } from '../host/helper-client.js';
import { WINDOW_MS } from '../confirm/window.js';
import { dataHash } from '../state/events.js';
import { composeCard, answerInput } from '../cards/compose.js';
import { decisionText } from '../decisions/message.js';
import { isDecisionCard } from '../decisions/pending.js';
import { askWhy } from '../decisions/why.js';
import { typedRepliesIn } from '../decisions/switch.js';
import { confirmWords } from '../state/card-lines.js';
import { joinersOf } from '../state/joiners.js';
import { cardsForVisit, existingCard, cardNumbered, asQuestion } from '../cards/visit.js';
import { controlFileInput, controlFilesDue, controlFilesNamed, gateAsksDue, gateInput, holdInput, holdsDue, premiumFailuresDue, stillWaits, withPutBack } from '../cards/build-loop.js';
import { COMPACT_NAME, COMPACT_WORK } from '../settings/compact-window-pr.js';
import { SWITCH_NAME, SWITCH_WORK } from '../engine/switch.js';
import { failedInput } from '../routing/premium.js';
import { heldByNotNow, numberedWaiting } from '../board/model.js';
import { glossaryOf, plainWords, termPattern } from './glossary.js';
import { windowRefusal } from '../settings/compact-window.js';
import { checkSetting, definitionOf, SETTINGS, WINDOWS_BUILD_COMMANDS, OWN_GITHUB_APP_KEY } from '../settings/catalogue.js';
import { CARD, WORK_REPORTS } from '../lib/front-desk.js';
import { effectiveSettings, settingsText, settingWords } from '../settings/effective.js';
import { similar as similarTo } from '../intake/similar.js';
import { answerLine, chatCopy, ID, keepControlLine } from '../state/card-lines.js';
import { gateTargetOf } from '../state/views.js';
import { briefHash } from '../feature/files.js';
import { endedBy, since, NO_PLAN, STARTS_UNAPPROVED } from '../foreman/queue.js';
import { startedAsScript } from '../lib/started-as-script.js';
import { FINISHED_WORDS, prsOfWork, workFinished } from '../desk/work-prs.js';
import { isOpen, surveyLines, whyNext, workLines, RECENT_MS, RECENT_LEAD, recentLines } from '../desk/views.js';
import { answeredWords } from '../cards/answered.js';
import { markHere } from '../lib/session-files.js';
import { sinceLine } from '../cards/panel-words.js';

// How far back `views waiting` looks for answers, and its lead (scripts/desk/views.js).
export { RECENT_MS, RECENT_LEAD };
import { deskClient } from '../desk/client.js';

// Moved to the desk's views (scripts/desk/views.js); exported here for one release so nothing else breaks.
export { surveyLines, workLines };
import { SUGGEST, WHY, suggestedAt } from '../lib/calm-words.js';
import { keep, taken } from '../hooks/pending.js';
import { projectOf } from '../hooks/kit.js';
import { noteProblem } from '../lib/session-note.js';
import { ALWAYS_READY, columnsReadyOf } from '../routing/in-force.js';

// An error whose message is said to the session as it is.
export class CliError extends Error {}

// The kinds `record` writes: the front desk's own, and the build loop's that its intake writes
// (work, amendment, incident, and the no-blame note when an incident ends).
export const RECORD_KINDS = Object.freeze([
  'ruling', 'idea', 'rejection', 'glossary', 'decision', 'risk', 'blocker', 'reversal', 'setting',
  'work', 'amendment', 'incident', 'note', 'brief', 'watch', 'helm-note',
]);
export const VIEW_NAMES = Object.freeze(['rulebook', 'waiting', 'ideas', 'glossary', 'settings', 'levels', 'work', 'survey', 'brief']);
const COMMANDS = ['cards', 'pull-cards', 'card', 'again', 'why', 'suggest', 'drop', 'ask-bosun', 'record', 'similar', 'views', 'explain', 'preview', 'undo', 'move', 'carry-on', 'archive', 'restore', 'confirm', 'premium-card', 'premium-check', 'note', 'decision', 'pull-back', 'alerts'];
// How long `confirm` waits for the helper: one window at a time on the computer, so it may wait for another's.
const CONFIRM_WAIT_MS = 3 * WINDOW_MS;
export { MEANWHILE, CHECKS_UNSAID } from '../cards/compose.js';
// The Lift STOP card, which `cards` puts first under STOP. It is composed on each visit and never
// recorded as a card, since under STOP the helper writes nothing; the click on it is signed by the
// prompt record from its set line, and only while STOP is on (ruling F25). The helper's own window composes
// the same card for a Lift STOP confirmed there (scripts/host/helper.js, /confirm).
export const LIFT_STOP_CARD = Object.freeze({
  kind: 'lift-stop',
  level: 3,
  what: 'All stop is on: every agent has halted, and nothing is written, pushed or merged.',
  why: 'Only you can lift All stop, so it comes to you.',
  options: [
    { label: 'Lift All stop', says: 'The agents carry on from where they halted.' },
    { label: 'Not now', says: 'All stop stays on, and nothing moves until you lift it.' },
  ],
  recommend: 'Not now',
  because: 'All stop is the safe side: lift it once you are sure what was in progress can carry on',
  meanwhile: 'Everything stays halted; reading and reporting carry on.',
});
const INPUT_BYTES = 1024 * 1024;
const BREAK = /[\r\n\v\f\u0085\u2028\u2029]/;
// Every run of line breaks, to put each answered line on one line.
const BREAKS = /\s*[\r\n\v\f\u0085\u2028\u2029]+\s*/g;
const HEAD = /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/;
// A decision topic: a slug, counted exactly (ruling F40).
const TOPIC = new RegExp(`^${ID}$`);

const isPlain = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
const flat = (x) => (typeof x === 'string' ? x.replace(/\s+/g, ' ').trim() : x);
const said = (answer, otherwise) => answer?.refused ?? answer?.why ?? otherwise;

// The columns ready beyond Balanced and Thorough for the project `cwd` is in; none when it can't be read.
function readyIn(cwd) {
  try {
    const found = projectOf(cwd);
    return found === null ? [] : columnsReadyOf({ project: found.project });
  } catch {
    return [];
  }
}

// --- Asking the helper ---

// The desk for the project `cwd` is in, asked through the command's own helper client. The front
// desk is in the sandbox, where ~/.wheelhouse can't be read, so the desk's local core never runs here.
const deskOf = (client, cwd) => deskClient({ cwd, client, local: 'never' });

// The record as the desk's waiting view gives it (the helper's views, its card events and whether
// STOP is on), with `answers` the card-answer events; or the
// helper's refusal, thrown as it said it.
async function recordOf(client, cwd, { answers = false, since } = {}) {
  const got = await deskOf(client, cwd).read('waiting', { ...(answers ? { answers: true } : {}), ...(since === undefined ? {} : { outcomes: { since: since.toISOString() } }) });
  if (got?.ok !== true || !isPlain(got.data?.views)) throw new CliError(said(got, 'The host helper gave no views'));
  return got.data;
}

// The views, whether STOP is on, with `cards` the card events the board numbers its list from, and
// with `answers` the card-answer events.
async function viewsOf(client, cwd, { cards = false, answers = false, since } = {}) {
  const got = await recordOf(client, cwd, { answers, since });
  if (cards && !Array.isArray(got.cards)) throw new CliError('The host helper gave no card events');
  if (answers && !Array.isArray(got.answers)) throw new CliError('The host helper gave no card answers');
  // A helper that gives no outcomes (an older one) leaves the decided-card checks out, as they only inform.
  return { views: got.views, stop: got.stop === true, cards: cards ? got.cards : [], answers: answers ? got.answers : [], outcomes: Array.isArray(got.outcomes) ? got.outcomes : [], names: namesIn(got) };
}

// The director's own settings view, as the desk's settings view gives it; none when it can't be read.
async function ownSettings(client, cwd) {
  try {
    const got = await deskOf(client, cwd).read('settings');
    return got?.ok === true && isPlain(got.data?.profile) ? got.data.profile : {};
  } catch {
    return {};
  }
}

// The names the project goes by, as the helper's views give them (its repository's own name and its folder's), for
// the plain words to leave alone; none when it gives none.
const namesIn = (got) => (Array.isArray(got?.names) ? got.names.filter((n) => typeof n === 'string' && n !== '') : []);

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

const LABELS = Object.values(SETTINGS).map((setting) => setting.label);
// Joins a card's texts so a term can't run from one into the next ("pull" then "request").
const JOIN = '\n\u0000\n';
const TERMS = '\n\nTerms: ';

// The words a card's texts go through, as the board-context hook takes them: the glossary from the
// views, the explanations setting from the settings in force,
// and what stays as written: the settings' names, the titles of the work and the `names` the project goes by
// (namesIn). A profile that can't be read gives the defaults.
async function wordsOf(client, cwd, views, now, names = []) {
  const own = await ownSettings(client, cwd);
  const settings = effectiveSettings({ project: isPlain(views.settings) ? views.settings : {}, profile: own, now });
  const titles = Object.values(isPlain(views.work) ? views.work : {}).map((w) => flat(w?.work?.data?.title)).filter((t) => typeof t === 'string' && t !== '');
  return { glossary: glossaryOf(views.glossary), explanations: settings.explanations?.value, protect: [...LABELS, ...titles], names };
}

// The composer's input with what the director reads in plain words (design section 5.3): the
// question, what, why, what each option says, because, what changed, meanwhile and the checks line. They go through as one
// text, so each term is put in plain words where the card first uses it, and the meaning of a term
// kept as written follows the last part. Labels, the recommendation and the target stay as given,
// and so do quotations, commands, names and what the card's set line names. Null when the texts
// can't be taken apart again.
function plainInput(input, words) {
  const says = input.options.map((o) => (typeof o.says === 'string' ? o.says : null));
  const texts = [
    ...(input.ask === undefined ? [] : [input.ask]), input.what, input.why, ...says.filter((t) => t !== null), ...(input.because === undefined ? [] : [input.because]),
    ...(input.changed === undefined ? [] : [input.changed]), input.meanwhile, ...(input.checks === undefined ? [] : [input.checks]),
  ].map((t) => t.trim());
  if (texts.some((t) => t.includes('\u0000'))) return null;
  const target = isPlain(input.target) ? input.target : {};
  const named = [target.work, target.incident, target.branch, confirmWords(target.event)].filter((t) => typeof t === 'string' && t !== '');
  const { text } = plainWords(texts.join(JOIN), words.glossary, { ...words, protect: [...words.protect, ...named] });
  const cut = text.indexOf(TERMS);
  const parts = (cut < 0 ? text : text.slice(0, cut)).split(JOIN);
  if (parts.length !== texts.length) return null;
  if (cut >= 0) {
    const last = parts.at(-1);
    parts[parts.length - 1] = `${last}${/[.!?]$/.test(last) ? '' : '.'} ${text.slice(cut + 2)}`;
  }
  const next = () => parts.shift();
  const ask = input.ask === undefined ? undefined : next();
  const what = next();
  const why = next();
  const options = input.options.map((o) => (typeof o.says === 'string' ? { ...o, says: next() } : o));
  const because = input.because === undefined ? undefined : next();
  const changed = input.changed === undefined ? undefined : next();
  const meanwhile = next();
  return {
    ...input, what, why, options, meanwhile,
    ...(because === undefined ? {} : { because }),
    ...(ask === undefined ? {} : { ask }),
    ...(changed === undefined ? {} : { changed }),
    ...(input.checks === undefined ? {} : { checks: next() }),
  };
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

// What a card re-issued for the pieces behind it says changed, or for an answer it now says was given before.
const REISSUED = 'The pieces this answer goes to.';
const SAID_ADDED = 'That you answered this before.';
const sameList = (a, b) => a.length === b.length && a.every((x) => b.includes(x));

// The answer card for a question the build recorded, from the stored event (compose.js,
// answerInput). The work is named by its title, or by its id when it has none or the card won't
// carry the title; the build's ask commands check a question against the card naming the id.
// A card lists each piece its answer goes to, by title or, where those won't fit, by id. A card already out is re-issued
// through `revises` once the pieces behind it change; the question it answers, and so its signature, stays as it was.
function answerCard(id, data, views, words, { joiners = [], revises, saidBefore, changed = REISSUED } = {}) {
  if (!isPlain(data) || data.id !== id) throw new Error('its record can\'t be read');
  const title = (work) => flat(views.work?.[work]?.work?.data?.title);
  const reissue = revises === undefined ? {} : { revises, changed };
  let refusal = null;
  for (const name of [...new Set([title(data.work) || data.work, data.work])]) {
    for (const titled of [true, false]) {
      const named = joiners.map((j) => ({ id: j.id, name: (titled && title(j.work)) || j.work, words: views.questions?.[j.id]?.question?.data?.what }));
      try {
        return composePlain({ ...answerInput(data, name, { joiners: named, saidBefore, recorded: true }), ...reissue }, words);
      } catch (error) {
        refusal ??= error;
      }
    }
  }
  // Too long to list its pieces: the question is still asked, and they are asked after it, with what was said.
  if (revises === undefined && (joiners.length > 0 || saidBefore !== undefined)) return answerCard(id, data, views, words);
  throw refusal;
}

// The card for a click the merge gate waits for, naming the work by its title, or by its id when
// it has none or the card won't carry the title (the first part may name no other pull request or
// commit than the set line's).
function gateCard(entry, views, words) {
  const work = entry.data.work;
  // The switch to the new engine's pull request is no piece of work (scripts/engine/switch.js), so it is named for what it does.
  const title = work === SWITCH_WORK ? SWITCH_NAME : work === COMPACT_WORK ? COMPACT_NAME : flat(views.work?.[work]?.work?.data?.title);
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

// A control-file record's card, naming the work by its title or its id, and the first paths, or
// only how many when they make the card too long or can't stand in it. When none composes, the
// first refusal is the one given. The finding's sentence and its Keep line stay as written, out of
// the glossary's reach like the work id: the watcher keeps the files only on a Confirm whose card
// said them word for word (ruling P7-34).
export function controlFileCard(record, views, words) {
  const { work, why, hash } = record.data;
  const title = flat(views.work?.[work]?.work?.data?.title);
  const keeps = why !== 'too-many';
  let refusal = null;
  for (const name of [...new Set([title || work, work])]) {
    for (const short of [false, true]) {
      try {
        const kept = keeps ? [controlFilesNamed(record.data, { short }), keepControlLine(work, hash)] : [];
        return composePlain(controlFileInput(record, name, { short }), { ...words, protect: [...words.protect, ...kept] });
      } catch (error) {
        refusal ??= error;
      }
    }
  }
  throw refusal;
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
// hold, made once, for each control-file record, made once, and for the premium model's failed evaluation, made once. Resolves with { made, again }: how many cards were recorded, and the ids of the
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
  for (const record of controlFilesDue(views)) {
    try {
      await write(client, cwd, 'card', controlFileCard(record, views, words).card);
      made += 1;
    } catch (error) {
      problems.push(`The card for the ${record.data.work} feature's agent files wasn't made: ${error.message}`);
    }
  }
  for (const record of premiumFailuresDue(views)) {
    try {
      await write(client, cwd, 'card', composePlain(failedInput(record), words).card);
      made += 1;
    } catch (error) {
      problems.push(`The card for the premium model's failed trial wasn't made: ${error.message}`);
    }
  }
  return { made, again };
}

// An answer card for each open question from the build that no waiting card asks yet, or whose joiners changed: how many were
// recorded. What could not be made or recorded goes into `problems`. Under STOP none is made. Both `cards` and `decision list` make them.
async function questionCards({ client, cwd, views, words, stop, problems }) {
  let made = 0;
  for (const [id, entry] of Object.entries(isPlain(views.questions) && !stop ? views.questions : {})) {
    // A joiner is answered by its lead's card, which is re-issued when the pieces behind it change.
    if (!isPlain(entry) || entry.answer || entry.joins !== undefined) continue;
    const joiners = joinersOf(views.questions, id);
    const out = existingCard(views, answerLine(id));
    const held = views.waiting?.find((c) => c.id === out)?.data;
    const sameJoiners = sameList(held?.joiners ?? [], joiners.map((j) => j.id));
    // A card out before the answer was matched to it gains the line, where it can carry it.
    const line = entry.saidBefore?.label;
    const sayNow = out !== null && typeof line === 'string' && held?.saidBefore !== line;
    if (out !== null && sameJoiners && !sayNow) continue;
    const data = entry.question?.data;
    let card;
    try {
      ({ card } = answerCard(id, data, views, words, { joiners, saidBefore: line, ...(out === null ? {} : { revises: out, ...(sameJoiners ? { changed: SAID_ADDED } : {}) }) }));
    } catch (error) {
      if (!(out !== null && sameJoiners)) problems.push(`Question ${id} couldn't be made a card: ${error.message}`);
      continue;
    }
    try {
      await write(client, cwd, 'card', card);
      made += 1;
    } catch (error) {
      problems.push(`The card for question ${id} wasn't recorded: ${error.message}`);
    }
  }
  return made;
}

// This visit's cards: { questions, left }, and `problems` when something couldn't be done. An open
// question from the build that no waiting card asks gets its answer card first, and the build
// loop's records theirs (buildLoopCards). The cards handed out are recorded as asked, so a card
// dismissed with no answer isn't offered on every turn. A write the helper refuses is a problem,
// not a failure: the cards waiting are still given. Under STOP the visit's one card is Lift STOP:
// the helper writes nothing, so no card is made, and the cards waiting stay on the board, counted
// in `left`, for the visit after STOP is lifted.
export async function cards({ client, cwd, now, onAsked }) {
  const problems = [];
  let { views, stop, names } = await viewsOf(client, cwd);
  const words = await wordsOf(client, cwd, views, now, names);
  const lift = stop ? composePlain(LIFT_STOP_CARD, words).question : null;
  const at = typeof now === 'function' ? now() : new Date(now ?? Date.now());
  let made = await questionCards({ client, cwd, views, words, stop, problems });
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
  // With typed replies on, a decision is shown as a chat message (`decision list`), never through the question picker, so no
  // visit hands one out. Off, it is a card like any other.
  const typed = typedRepliesIn(views.settings);
  const forVisit = withPutBack(views, again, events);
  const chosen = cardsForVisit({ ...forVisit, waiting: (Array.isArray(forVisit.waiting) ? forVisit.waiting : []).filter((c) => !typed || !isDecisionCard(c?.data)) }, { room: lift === null ? CARD.questions : 0 });
  problems.push(...await markAsked(client, cwd, chosen.ids, stop));
  if (typeof onAsked === 'function') await onAsked(chosen.ids);
  return { questions: [...(lift === null ? [] : [lift]), ...chosen.questions], left: chosen.left, ...(chosen.heldBack > 0 ? { heldBack: chosen.heldBack } : {}), ...withProblems(problems) };
}

// --- decisions ---

// A decision is a plain chat message (scripts/decisions/), not a card for the question picker. The waiting decisions, as the desk's
// waiting view gives them: { pending, answered, next }.
async function decisionsOf(client, cwd) {
  const got = await recordOf(client, cwd);
  if (!isPlain(got.decisions) || !Array.isArray(got.decisions.pending)) throw new CliError('The host helper gave no decisions');
  return got.decisions;
}

// The decisions waiting, one line each. First each open question from the build that no card asks yet is made a card, which is what a
// decision is made from; under STOP none is made, and the decisions already waiting are listed.
export async function decisionList({ client, cwd, now }) {
  const problems = [];
  const { views, stop, names } = await viewsOf(client, cwd);
  const words = await wordsOf(client, cwd, views, now, names);
  await questionCards({ client, cwd, views, words, stop, problems });
  const { pending } = await decisionsOf(client, cwd);
  const lines = pending.length === 0 ? ['No decision is waiting.'] : pending.map((d) => `${d.n}. ${d.question}${d.work === null || d.work === undefined ? '' : ` (holds up: ${d.work})`}`);
  return [...lines, ...problems];
}

// One decision's message, to print word for word. Refused when none waits by that number.
export async function decisionShow({ client, cwd, n }) {
  const { pending } = await decisionsOf(client, cwd);
  const found = pending.find((d) => d.n === n);
  if (found === undefined) throw new CliError(`Decision ${n} isn't waiting${pending.length === 0 ? '' : `: ${pending.map((d) => d.n).join(', ')} are`}. Run decision list.`);
  return decisionText(found);
}

// The director's Show them: the cards held back are named as pulled, which spends none of the day's budget, then this
// visit's cards come as `cards` gives them. It raises cards and decides nothing.
export async function pullCards({ client, cwd, now, onAsked }) {
  const { views } = await viewsOf(client, cwd);
  const ids = Array.isArray(views.cardsWaiting?.ids) ? views.cardsWaiting.ids : [];
  if (ids.length > 0) await write(client, cwd, 'note', { about: 'cards-pulled', ids });
  return cards({ client, cwd, now, onAsked });
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
// topic is kept in lower case. A revised card names the
// card it replaces by `revises`, which must wait now, or have been closed by a later head of its pull
// request or branch, and be of the card's kind. A card already waiting with its set line comes back
// only when it is itself a revised card: the gate's plain card for that head is replaced instead.
// An approval or CI push card revised at the same head commit is refused: the change must be committed first.
// An outdated card may be revised only after a suggested change on it that came before the gate's record for the head.
export async function card({ client, cwd, input, now }) {
  if (!isPlain(input)) throw new CliError('Give the card as a JSON object on standard input');
  if (input.kind === 'answer') throw new CliError('An answer card comes from `cards`, made from the question as the build recorded it');
  if (input.kind === 'usage') throw new CliError('A usage card comes from the session start, made from the allowance as it reads it');
  if (input.kind === 'premium') throw new CliError('The premium model\'s card comes from `premium-card`, made by the helper');
  if (input.event !== undefined) throw new CliError('A card for a record of the build\'s comes from `cards`, made once from the record');
  const topic = input.topic === undefined ? undefined : topicOf(input.topic);
  const at = typeof now === 'function' ? now() : new Date(now ?? Date.now());
  const { views, names, outcomes } = await viewsOf(client, cwd, { since: new Date(at.getTime() - RECENT_MS) });
  let target = input.target;
  if (input.kind === 'approval' && isPlain(target) && target.sha === undefined && Number.isSafeInteger(target.pr) && target.pr >= 1) {
    const state = await client.prState({ cwd, number: target.pr });
    if (state?.ok !== true) throw new CliError(said(state, `The host helper couldn't read pull request #${target.pr}`));
    const sha = state.result?.headSha;
    if (typeof sha !== 'string' || !HEAD.test(sha)) throw new CliError(`The host gave no head commit for pull request #${target.pr}`);
    target = { ...target, sha };
  }
  // Work users would see is shown to the director before it merges, whatever the card was given (scenario 7).
  if (input.kind === 'approve-work' && isPlain(target) && views.work?.[target.work]?.work?.data?.visible === true) {
    target = { ...target, shownFirst: true };
  }
  const { question, card: data } = composePlain({ ...input, target, ...(topic === undefined ? {} : { topic }) }, await wordsOf(client, cwd, views, now, names));
  // The card revised must wait now, or have been closed only by a later head of its pull request or
  // branch (ruling C21), be of this kind and, for an approval or CI push card, be about the same
  // pull request or branch, or the waiting view would close nothing.
  const revised = data.revises === undefined ? undefined : [...views.waiting, ...(Array.isArray(views.outdated) ? views.outdated : [])]
    .find((c) => c.id === data.revises && c.data?.kind === data.kind && gateTargetOf(c) === gateTargetOf({ data }));
  if (data.revises !== undefined && revised === undefined) throw new CliError('revises names no waiting card of this kind');
  // An approval or CI push card signs a head commit, so a revision at the same head describes a change the code doesn't hold.
  if (revised !== undefined && ['approval', 'ci-push'].includes(data.kind) && revised.data?.line === data.line) {
    throw new CliError('a revised approval needs the change committed first');
  }
  // An outdated card may be revised only after a suggested change on it, and only once the gate has
  // recorded the head the revision is composed at: else the change is not one that card was given.
  if (revised !== undefined && !views.waiting.some((c) => c.id === revised.id)) {
    const record = Object.values(views.gateAsks ?? {}).find((g) => g.line === data.line);
    if (typeof revised.steered !== 'string' || record === undefined || revised.steered >= record.at) {
      throw new CliError('a revised approval must follow a suggested change on that card');
    }
  }
  // A revised card takes the place of the gate's plain card at its own head, so for a revision only
  // a revised card already carrying the line comes back.
  const carrying = existingCard(views, data.line, { except: data.revises });
  const found = carrying !== null && (revised === undefined || views.waiting.find((c) => c.id === carrying).data?.revises !== undefined) ? carrying : null;
  if (found !== null) {
    const waiting = views.waiting.find((c) => c.id === found);
    if (waiting.asked !== null && waiting.asked !== undefined) return { question: asQuestion(waiting), id: found, alreadyAsked: true };
    return { question: asQuestion(waiting), id: found, ...withProblems(await markAsked(client, cwd, [found], false)) };
  }
  const decided = decidedBefore(outcomes, data, at);
  if (decided !== null) throw new CliError(decided);
  const { id } = await write(client, cwd, 'card', data);
  return { question, id, ...withProblems(await markAsked(client, cwd, [id], false)) };
}

// "Already approved in the panel at 10:34; nothing to ask." when a card carrying the same set line was decided: an
// approval or CI push card by the answer that signs it (its commit is the same, so the answer stands for good), any
// other kind within RECENT_MS. Null otherwise. A card sent back or put off is not decided, so it may be asked again.
function decidedBefore(outcomes, data, at) {
  if (typeof data.line !== 'string') return null;
  const signed = ['approval', 'ci-push'].includes(data.kind);
  const hits = outcomes
    .filter((o) => o?.card?.data?.line === data.line && typeof o.decided?.at === 'string' && (signed
      ? [null, 'Approve', 'Push it'].includes(o.decided.label)
      : at.getTime() - new Date(o.decided.at).getTime() <= RECENT_MS))
    .sort((a, b) => a.decided.at.localeCompare(b.decided.at));
  return hits.length === 0 ? null : `Already ${answeredWords(hits.at(-1), at)}; nothing to ask.`;
}

// --- again ---

// The card the board numbers n, as it was composed (in plain words then), with its id, recorded as
// asked again. The id lets a press that names a card by number and id be checked against it.
export async function again({ client, cwd, n, onAsked }) {
  const { views, stop, cards: events } = await viewsOf(client, cwd, { cards: true });
  const found = cardNumbered(views, n, { events });
  if (found === null) throw new CliError(`The Logbook has no card ${n} to ask again; a question from the build is asked once \`cards\` has made its card`);
  const problems = withProblems(await markAsked(client, cwd, [found.id], stop));
  if (typeof onAsked === 'function') await onAsked([found.id]);
  return { questions: [asQuestion(found)], id: found.id, ...problems };
}

// --- why ---

// Keeps the answer in pending/ for the next session start to send, as a click's plain answer is
// kept when the helper doesn't take it. False when this folder is no registered project or the
// file can't be written (in the sandbox, ~/.wheelhouse is out of reach).
function keepAnswer(cwd, body) {
  try {
    const found = projectOf(cwd);
    if (found === null) return false;
    keep(found.project, 'write', { project: found.project, ...body }, () => new Date());
    return true;
  } catch {
    return false;
  }
}

// Notes that the director asked why about the card the board numbers n: a Why? answer on the card's
// question as it was shown, written as a click's plain answer is, kept in pending/ when the helper
// doesn't take it. It decides nothing, so the card still waits. Under STOP nothing is written, and
// the line says so. The front desk explains, then runs `again`; the card isn't given here.
export async function why({ client, cwd, n, words = '', ask = askCopyIn }) {
  const { views, stop, cards: events } = await viewsOf(client, cwd, { cards: true });
  const found = cardNumbered(views, n, { events });
  if (found === null) throw new CliError(`The Logbook has no card ${n} to note a why about`);
  if (stop) return [`All stop is on, so nothing was noted about card ${n}.`];
  const question = found.data?.question;
  if (typeof question !== 'string' || question === '') throw new CliError(`Card ${n} has no question to note a why against`);
  const body = { kind: 'card-answer', data: { question, label: WHY, where: 'chat' } };
  let got;
  try {
    got = await client.state.write({ cwd, ...body });
  } catch {
    got = null;
  }
  if (!taken(got) && !keepAnswer(cwd, body)) throw new CliError(`The ${WHY} about card ${n} wasn't noted: ${said(got, 'the host helper did not answer')}`);
  return [`Noted that you asked why about card ${n}.`, ...whyNext(views, question, n), ...await copyAnswer({ client, cwd, id: found.id, words, ask })];
}

// Asks the copy of the session behind decision `id` of the project `cwd` is in (scripts/decisions/why.js).
async function askCopyIn({ cwd, id, words }) {
  const found = projectOf(cwd);
  if (found === null) return { fallback: "This folder isn't a Wheelhouse project, so there is no session to ask." };
  return askWhy({ project: found.project, id, words });
}

// The copy's answer for waiting decision `n` of `decision list`, without noting a Why? on any card: the way a typed "why 2" is
// answered (typed replies on), and the same copy that the card's Why? asks (typed replies off). It records nothing.
export async function whyDecision({ client, cwd, n, words = '', ask = askCopyIn }) {
  const { pending } = await decisionsOf(client, cwd);
  const found = pending.find((d) => d.n === n);
  if (found === undefined) throw new CliError(`Decision ${n} isn't waiting${pending.length === 0 ? '' : `: ${pending.map((d) => d.n).join(', ')} are`}. Run decision list.`);
  return copyAnswer({ client, cwd, id: found.id, words, ask });
}

// The lines of a read-only session copy's answer when card `id` is a waiting decision, else none. It only explains: nothing here
// records an answer. A copy that can't be asked says so in one line and the card's own reasons follow; the Why? still works.
async function copyAnswer({ client, cwd, id, words, ask }) {
  let decision;
  try {
    decision = (await decisionsOf(client, cwd)).pending.find((d) => d.id === id);
  } catch {
    return [];
  }
  if (decision === undefined) return [];
  try {
    const got = await ask({ cwd, id: decision.id, words });
    return typeof got?.answer === 'string'
      ? ["The session that raised this decision answers (it only explains, and changes nothing):", got.answer]
      : [typeof got?.fallback === 'string' ? got.fallback : "The session that raised this decision couldn't be asked."];
  } catch (error) {
    return [`The session that raised this decision couldn't be asked: ${error?.message ?? error}`];
  }
}

// --- suggest ---

// The one line the front desk says after handing a suggested change to the build.
export const SUGGESTED = 'Noted. A new proposal will follow.';

// Hands a change the director suggested on a waiting approval or CI push card to the build: the open
// work re-stated as it stands, its title the change in the front desk's own words, so the code
// changes before the card is revised, then the card's answer Suggest a change…, which is what the pane
// reads as a change under way. One command, so nothing is said between steps (scenario 36).
// Resolves with { id, pushed, say }.
export async function suggest({ client, cwd, card: cardId, work: workId, change }) {
  const words = typeof change === 'string' ? change.trim() : '';
  if (words === '' || BREAK.test(words)) throw new CliError('Give the change in your own words, on one line: suggest <card id> <work id> <the change in your own words>');
  const { views } = await viewsOf(client, cwd);
  const pressed = views.waiting.find((c) => c.id === cardId);
  if (pressed === undefined) throw new CliError(`Card ${cardId} no longer waits: say so in one line and ask nothing`);
  const kind = pressed.data?.kind;
  if (!['approval', 'ci-push'].includes(kind)) throw new CliError(`Card ${cardId} is ${/^[aeiou]/.test(String(kind)) ? 'an' : 'a'} ${kind} card: revise the proposal and compose its new card with \`card\``);
  if (!isPlain(views.work?.[workId])) {
    const open = Object.keys(isPlain(views.work) ? views.work : {}).filter((id) => isOpen(views, id));
    throw new CliError(`${workId} isn't open work: the open work is ${open.length ? open.join(', ') : 'none'}`);
  }
  if (workFinished(views, workId, cwd, isOpen)) throw new CliError(`${workId} has finished, so a suggested change can't go into it: ${FINISHED_WORDS}`);
  const data = { ...views.work[workId].work.data, title: words };
  const got = await write(client, cwd, 'work', data);
  await write(client, cwd, 'card-answer', { question: pressed.data.question, label: SUGGEST, where: 'chat' });
  return { id: got.id, pushed: got.pushed === true, say: SUGGESTED };
}

// --- drop ---

// The director's "fix it" or "ship it" about work with an open pull request, put to the Bosun by the helper. Resolves with { work, say }.
export async function askBosun({ client, cwd, work }) {
  const got = await client.state.workCard({ cwd, work });
  if (got?.ok !== true) throw new CliError(said(got, 'The helper could not ask the Bosun'));
  if (typeof got.skipped === 'string') return { work, say: `Nothing was asked: ${got.skipped}.` };
  return { work, id: got.id, say: 'Asked: the Bosun decides what happens to its pull request. Run cards and ask the card it gives.' };
}

// --- pull-back ---

const PULL_WORDS = 160;
const MOST_CALLS = 200;
const callMark = (id) => `[call ${id.slice(0, 8)}]`;

// The director's "I'd have wanted to decide that" about a call an agent made on its own side of the decision line (the
// decision log, design section 5). The call is named by its id, or the start of it (six characters or more). It becomes a ruling
// for the future, which waits for the director's confirm card like any ruling, and with `change` an intake request to change
// what was built as well. Resolves with { call, ruling, card, request?, say }.
export async function pullBack({ client, cwd, call, change = false, now, makeId }) {
  if (typeof call !== 'string' || !/^[0-9a-f-]{6,36}$/.test(call)) throw new CliError('Give the call by its id, or at least its first six characters: pull-back <call id> [--change]');
  const got = await deskOf(client, cwd).read('waiting', { calls: true });
  if (got?.ok !== true || !Array.isArray(got.data?.calls)) throw new CliError(said(got, 'The host helper gave no calls'));
  const found = got.data.calls.filter((c) => c.id === call || c.id.startsWith(call));
  if (found.length === 0) throw new CliError(`No call starting with ${call} is among the recent calls (the latest ${MOST_CALLS} are kept in view)`);
  if (found.length > 1) throw new CliError(`More than one recent call starts with ${call}: give more of its id`);
  const [chosen] = found;
  const mark = callMark(chosen.id);
  // A ruling for the call stands once; a request to change what was built is filed once. With a ruling already, `change` files
  // only the request.
  if (chosen.ruled === true && !change) throw new CliError(`That call was pulled back already ${mark}`);
  if (change && chosen.requested === true) throw new CliError(`A request to change what that call built was filed already ${mark}`);
  const decided = flat(chosen.decided).slice(0, PULL_WORDS);
  const out = { call: chosen.id };
  if (chosen.ruled !== true) {
    const words = `Pulled back ${mark}: "${decided}" (${chosen.work}, ${chosen.kind}). A call like this is the director's to decide first.`;
    const made = await record({ client, cwd, kind: 'ruling', input: { words, reason: 'The director pulled back a call from the decision log', scope: 'project' }, now, ...(makeId ? { makeId } : {}) });
    out.ruling = made.id;
    out.card = made.card;
  }
  if (change) {
    const request = await write(client, cwd, 'request', { words: `Change what ${chosen.work} built ${mark}: it decided "${decided}" on its own, and the director pulled that call back.`, via: 'chat' });
    out.request = request.id;
  }
  out.say = change
    ? 'Pulled back, and a request to change what was built is with the intake. The ruling waits for your confirmation.'
    : 'Pulled back. The ruling waits for your confirmation, and calls like this come to you first from now on.';
  return out;
}

export const DROPPED = 'Dropped: it will not be built.';

// Ends a piece of work the director asked to drop (a copy of one already queued, or a request they have changed their
// mind about) with a closed report, so neither engine starts it. Work that has begun building is left alone.
// Resolves with { work, say }.
export async function drop({ client, cwd, work: workId }) {
  const { views } = await viewsOf(client, cwd);
  if (!isOpen(views, workId)) {
    const open = Object.keys(isPlain(views.work) ? views.work : {}).filter((id) => isOpen(views, id));
    throw new CliError(`${workId} isn't open work: the open work is ${open.length ? open.join(', ') : 'none'}`);
  }
  const started = (isPlain(views.runs) && Array.isArray(views.runs[workId]) && views.runs[workId].length > 0) || isPlain(views.features?.[workId]?.data);
  if (started) throw new CliError(`${workId} has already begun building, so it can't be dropped here: say so in one line`);
  const got = await write(client, cwd, 'report', { work: workId, outcome: 'closed', summary: 'Dropped at the director\'s request before it began.', rulings: [] });
  removeBrief(cwd, views, workId);
  return { work: workId, id: got.id, say: DROPPED };
}

// The request's own file in .wheelhouse/work/, taken away once the work is dropped. Only a Markdown file directly in that folder
// goes, and not one that other work still names.
function removeBrief(cwd, views, workId) {
  const data = views.work[workId]?.work?.data;
  const file = typeof data?.doc === 'string' ? data.doc : data?.doc?.path;
  if (typeof file !== 'string') return;
  const dir = path.resolve(cwd, WORK_REPORTS);
  const full = path.resolve(cwd, file);
  if (path.dirname(full) !== dir || !full.endsWith('.md')) return;
  const shared = Object.entries(views.work).some(([id, entry]) => {
    if (id === workId) return false;
    const other = entry?.work?.data?.doc;
    const named = typeof other === 'string' ? other : other?.path;
    return typeof named === 'string' && path.resolve(cwd, named) === full;
  });
  if (shared) return;
  try {
    fs.rmSync(full, { force: true });
  } catch { /* the file stays; the drop has been recorded */ }
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

// The confirm card for a standing brief, which shows all of it as it would stand.
function briefCard(event, words) {
  return composePlain({
    kind: 'confirm',
    level: 3,
    what: `This project's standing brief, ${event.data.words}, as it would stand: ${briefText(event.data)}`,
    why: 'Agents read the brief as your intent, so it counts only once you confirm it.',
    options: [{ label: 'Confirm', says: 'This becomes the project\'s brief, in place of any before it.' }],
    recommend: 'Confirm',
    because: 'it is the brief as you and the First Mate settled it',
    meanwhile: 'Nothing changes until you confirm.',
    target: { event },
  }, words);
}

// The brief to sign, from `record brief`: its lines, or one `fact` to add to the brief in force, with its date.
function briefToSign(input, inForce) {
  const { fact, ...lines } = input;
  const unknown = Object.keys(lines).filter((k) => !BRIEF_LINES.includes(k));
  if (unknown.length > 0) throw new CliError(`A brief has no ${unknown[0]}: it takes ${BRIEF_LINES.join(', ')}, or one fact on its own`);
  if (fact !== undefined && Object.keys(lines).length > 0) throw new CliError('Give a brief\'s lines, or one fact to add to it, not both');
  const brief = fact === undefined ? wholeBrief(lines) : addFact(inForce?.brief ?? wholeBrief(), fact);
  const problem = briefProblem(brief);
  if (problem !== null) throw new CliError(`The brief ${problem}`);
  return brief;
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
export async function writeSetting({ client, cwd, data, words, ready, makeId = () => crypto.randomUUID() }) {
  try {
    checkSetting(data.key, data.value, data.until);
  } catch (error) {
    throw new CliError(error.message);
  }
  // A setting Wheelhouse has retired is read from old records and never written again.
  if (definitionOf(data.key)?.retired) throw new CliError(`Wheelhouse no longer has a setting called ${data.key}`);
  // Build commands on Windows are turned on only by the director's click on their own card, never
  // by an agent (design section 12.2); the front desk may write only the off switch, Ask.
  if (definitionOf(data.key) === WINDOWS_BUILD_COMMANDS && data.value !== 'ask') {
    throw new CliError('Build commands on Windows are turned on only by a click on their own card; the First Mate can set them back to ask');
  }
  // A Thoroughness level is set only once its column is ready, as the settings pane's press holds it (`ready` is the
  // columns ready beyond Balanced and Thorough; none given means none).
  if (data.key === 'efficiency' && !ALWAYS_READY.includes(data.value) && !(Array.isArray(ready) && ready.includes(data.value))) {
    throw new CliError(`${data.value[0].toUpperCase()}${data.value.slice(1)} isn't ready yet, so Thoroughness stays as it is`);
  }
  // The premium model's paid-credits and within-plan modes are turned on only by the separate opt-in cards (design
  // section 14.6), never by one generic Confirm; the front desk can set it back to off.
  if (data.key === 'premium' && data.value !== 'off') {
    throw new CliError('The premium model is turned on only through its own opt-in cards; the First Mate can set it back to off');
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
    settingCard({ kind: 'setting', id: makeId(), data: setting }, words);
    const got = await client.profile.write({ kind: 'setting', data: setting });
    if (got?.ok !== true || typeof got.id !== 'string') throw new CliError(said(got, 'The host helper did not record the setting'));
    return withCard(got);
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

// The line a front desk says for an amendment, from its read-back: the route (intake, step 4) and
// the read-back (route 3), in one, so neither is left out (scenario 26). Each part is one line; an
// amendment without them is refused before anything is written.
function readBackLine(readBack) {
  // Each part as a sentence: its own closing mark kept, else one full stop.
  const part = (value) => {
    const text = typeof value === 'string' && !BREAK.test(value) ? value.trim().replace(/\.+$/, '').trim() : '';
    if (text === '') return null;
    return /[?!]$/.test(text) ? text : `${text}.`;
  };
  const parts = isPlain(readBack) ? [part(readBack.doing), part(readBack.notDoing), part(readBack.doneWhen)] : [null];
  if (parts.includes(null)) throw new CliError('Read the change back first: give readBack as { doing, notDoing, doneWhen }, each one line in the director\'s terms');
  const [doing, notDoing, doneWhen] = parts;
  return `I've treated this as a change to work already running; say if it's something else. Doing: ${doing} Not doing: ${notDoing} Done when: ${doneWhen}`;
}

// A work event's document, or an amendment of the one file open work names, with its hash worked out.
async function withHash(client, cwd, kind, input) {
  // A document named by its path alone, as plain text, is the same as { path }.
  if (kind === 'work' && typeof input.doc === 'string') return { ...input, doc: { path: input.doc, hash: documentHash(cwd, input.doc) } };
  if (kind === 'work' && isPlain(input.doc) && typeof input.doc.path === 'string') {
    return { ...input, doc: { ...input.doc, hash: documentHash(cwd, input.doc.path, input.doc.hash) } };
  }
  if (kind !== 'amendment') return input;
  const { views } = await viewsOf(client, cwd);
  if (!isPlain(views.work?.[input.work])) throw new CliError(`The work ${input.work} isn't a known work, so there is nothing to amend`);
  if (workFinished(views, input.work, cwd, isOpen)) throw new CliError(`The work ${input.work} has finished, so it can't be amended: ${FINISHED_WORDS}. Record a new work for it with \`record work\`, with no amendment`);
  const file = views.work[input.work].work?.data?.doc?.path;
  if (typeof file !== 'string') {
    if (input.hash !== undefined) return input;
    throw new CliError(`The work ${input.work} names no document, so give the changed document's hash`);
  }
  return { ...input, hash: documentHash(cwd, file, input.hash) };
}

// Records one event and resolves with { id, pushed }, with `hash` for a work event's document or an
// amendment, `say` for an amendment (its route line and read-back), and for a ruling or a setting its confirm card, recorded too, as { question, id }. A setting the catalogue refuses is refused here, before
// the helper is asked; the director's own settings go to their profile (writeSetting). A ruling keeps its words exactly as given: its card is composed
// first, under the id the ruling is then written with, so a ruling whose words no card can carry
// is never written. The confirm card is recorded as asked.
export async function record({ client, cwd, kind, input, now, ready, makeId = () => crypto.randomUUID() }) {
  if (!RECORD_KINDS.includes(kind)) throw new CliError(`record takes one of: ${RECORD_KINDS.join(', ')}`);
  if (!isPlain(input)) throw new CliError(`Give the ${kind} as a JSON object on standard input`);
  const answered = (got) => ({ id: got.id, pushed: got.pushed === true });
  if (kind === 'setting') {
    try {
      checkSetting(input.key, input.value, input.until);
    } catch (error) {
      throw new CliError(error.message);
    }
    // The compaction window and the point to prepare at must fit: the window stays the larger.
    if (input.key === 'compactWindow' || input.key === 'compactPrepare') {
      const seen = (await viewsOf(client, cwd)).views.settings;
      const project = isPlain(seen) ? seen : {};
      const window = input.key === 'compactWindow' ? input.value : project.compactWindow?.value ?? SETTINGS.compactWindow.default;
      const prepare = input.key === 'compactPrepare' ? input.value : project.compactPrepare?.value ?? SETTINGS.compactPrepare.default;
      const refusal = windowRefusal({ window, prepare });
      if (refusal !== null) throw new CliError(refusal);
    }
    // Only what the setting is: its words are made from it, and a reason marks a learnt one.
    const data = { key: input.key, value: input.value, ...(input.until === undefined ? {} : { until: input.until }),
      // The time of the usage card whose pick this is, which the card's line gives; it ties a return card to this switch.
      ...(typeof input.usageCard === 'string' && !Number.isNaN(Date.parse(input.usageCard)) ? { usageCard: input.usageCard } : {}) };
    const words = await viewsOf(client, cwd).then((v) => wordsOf(client, cwd, v.views, now, v.names));
    const got = await writeSetting({ client, cwd, data, words, makeId, ready: ready ?? readyIn(cwd) });
    if (got.card === undefined) return got;
    return { ...got, ...withProblems(await markAsked(client, cwd, [got.card.id], false)) };
  }
  // A reversal's topic is a slug in lower case, as a card's is.
  if (kind === 'reversal') return answered(await write(client, cwd, kind, { ...input, topic: topicOf(input.topic) }));
  if (kind === 'work') {
    // A change users would see goes in the small lane at least, shown first (intake, route 9;
    // scenario 7). Ready-made work carried on (`from`) is shown whatever its lane.
    if (input.lane === 'quick' && input.visible === true && input.from === undefined) {
      throw new CliError('Work users would see goes in the small lane at least, shown to the director first: record it in the small lane, with an approve-work card (shownFirst). The quick lane is for work users won\'t see (visible false)');
    }
    const data = await withHash(client, cwd, kind, input);
    const hash = data.doc?.hash;
    return { ...answered(await write(client, cwd, kind, data)), ...(typeof hash === 'string' ? { hash } : {}), recordHash: dataHash(data) };
  }
  if (kind === 'amendment') {
    // The read-back is said, not stored: the event is the amendment as the foreman applies it.
    const { readBack, ...rest } = input;
    const say = readBackLine(readBack);
    const data = await withHash(client, cwd, kind, rest);
    return { ...answered(await write(client, cwd, kind, data)), hash: data.hash, say };
  }
  if (kind !== 'ruling' && kind !== 'brief') return answered(await write(client, cwd, kind, input));

  const { words } = input;
  if (kind === 'ruling' && (typeof words !== 'string' || words.trim() === '' || BREAK.test(words))) throw new CliError('A ruling needs its words, on one line, as the director gave them');
  const { views, names } = await viewsOf(client, cwd);
  const id = makeId();
  const held = kind === 'brief' ? briefToSign(input, views.brief) : input;
  const { question, card: data } = (kind === 'brief' ? briefCard : confirmCard)({ kind, id, data: held }, await wordsOf(client, cwd, views, now, names));
  const got = await write(client, cwd, kind, held, id);
  if (got.id !== id) throw new CliError(`The ${kind} was recorded as ${got.id}, not under the id its confirm card names`);
  let made;
  try {
    made = await write(client, cwd, 'card', data);
  } catch (error) {
    throw new CliError(`The ${kind} was recorded as ${id}, but its confirm card wasn't: ${error.message}`);
  }
  return { ...answered(got), card: { question, id: made.id }, ...withProblems(await markAsked(client, cwd, [made.id], false)) };
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
const two = (n) => String(n).padStart(2, '0');
const listed = (lines, none) => (lines.length > 0 ? lines : [none]);

// One view as short lines.
export async function view({ client, cwd, name, now, since: from }) {
  if (!VIEW_NAMES.includes(name)) throw new CliError(`views takes one of: ${VIEW_NAMES.join(', ')}`);
  const at = typeof now === 'function' ? now() : new Date(now ?? Date.now());
  const { views, cards: events, answers, outcomes, names } = await viewsOf(client, cwd, {
    cards: name === 'waiting' || name === 'levels', answers: name === 'work', ...(name === 'waiting' ? { since: new Date(Math.min(at.getTime() - RECENT_MS, from?.getTime() ?? Infinity)) } : {}),
  });
  if (name === 'brief') return views.brief ? [briefText(views.brief.brief)] : ['This project has no signed brief.'];
  if (name === 'rulebook') {
    const rules = (Array.isArray(views.rulebook) ? views.rulebook : []).filter((r) => r?.status !== 'superseded');
    const status = (r) => (r.status !== 'accepted' ? 'waiting for the director to confirm it' : 'in force');
    return listed(rules.map((r) => `${flat(r.words)} (${status(r)})`), 'The rulebook is empty.');
  }
  if (name === 'waiting') {
    // Numbered as the board numbers them; a composed card is named by its `what`, and each card by
    // its id, which a press's prompt names beside its number. A card recorded before cards kept
    // their parts is named by the line its text labels "What this is:".
    const firstPart = (id) => {
      const data = views.waiting.find((c) => c.id === id)?.data;
      if (typeof data?.parts?.what === 'string' && data.parts.what !== '') return data.parts.what.split('\n')[0];
      const old = 'What this is: ';
      return typeof data?.question === 'string' && data.question.startsWith(old) ? data.question.slice(old.length).split('\n')[0] : null;
    };
    // A card the director answered Suggest a change… waits for its revision: its time follows.
    const steered = (id) => {
      const at = views.waiting.find((c) => c.id === id)?.steered;
      const when = typeof at === 'string' ? new Date(at) : null;
      return when === null || Number.isNaN(when.getTime()) ? '' : ` ${suggestedAt(`${two(when.getHours())}:${two(when.getMinutes())}`)}`;
    };
    const items = numberedWaiting(views, events)
      .map((item) => `${item.n}. ${(item.card && firstPart(item.card)) || item.what}${item.card ? ` (card ${item.card})${steered(item.card)}` : ''}`);
    // Then the last hour's answers, from the record, so "Status?" is answered from it and not from memory.
    const told = from === undefined ? null : sinceLine(outcomes, from.getTime(), at);
    return [...listed(items, 'Nothing is waiting for the director.'), ...recentLines(outcomes, at), ...(told === null ? [] : [told])];
  }
  if (name === 'ideas') return listed(Object.entries(isPlain(views.ideas) ? views.ideas : {}).map(([key, entry]) => `- ${titleOf(entry, key)}`), 'No ideas are kept yet.');
  if (name === 'glossary') return Object.entries(glossaryOf(views.glossary)).map(([term, entry]) => `${term}: ${entry.plain}`);
  if (name === 'levels') return listed(levelLines(views, events), 'No decision topics yet.');
  if (name === 'survey') return surveyLines(views.survey);
  if (name === 'work') return workLines(views, answers, await wordsOf(client, cwd, views, now, names), prsOfWork(views, cwd));
  // settings: the project's over the director's own, over the defaults
  const own = await ownSettings(client, cwd);
  return settingsText(effectiveSettings({ project: isPlain(views.settings) ? views.settings : {}, profile: own, now })).split('\n');
}

// The decision topics on earlier cards, for a card to reuse one, sorted by topic. Levels an earlier version confirmed for a
// topic are left out: nothing acts on them now.
function levelLines(views, events) {
  const onCards = [...new Set(events.map((e) => e.data?.topic).filter((t) => typeof t === 'string' && TOPIC.test(t)))].sort();
  return onCards.map((t) => `"${t}": on earlier cards`);
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

// --- The helper's own window ---

// What the helper's window answers for `card`: `lift-stop` for the Lift STOP card the helper composes itself, or a
// card's id in the state, named with the hash of its data as the state holds it, so the window shows that card and
// no other (the caller's own text is never shown). Posts /confirm; a refusal is said as is.
export async function confirm({ client, cwd, card }) {
  if (typeof card !== 'string' || card === '') throw new CliError('Give the card\'s id, or lift-stop: confirm <card>');
  let got;
  if (card === 'lift-stop') {
    got = await client.confirm({ cwd, card });
  } else {
    const { cards } = await viewsOf(client, cwd, { cards: true });
    const found = cards.filter((e) => isPlain(e) && e.id === card);
    if (found.length !== 1) throw new CliError('That card is not in this project\'s state');
    got = await client.confirm({ cwd, card, hash: dataHash(found[0].data) });
  }
  if (got?.ok !== true) throw new CliError(said(got, 'The host helper gave no answer from its window'));
  return got;
}

// --- The premium model's opt-in (design section 14.6) ---

// The premium model's card, when the director asks for it or presses Change… on its row: the line that gives the card
// to ask and what a pick of it does, as the helper composed and recorded it, or, when it isn't offered, why not, in the
// director's words.
export async function premiumCard({ client, cwd }) {
  const got = await client.premium.card({ cwd });
  if (got?.ok !== true) throw new CliError(said(got, 'The host helper didn\'t make the premium model\'s card'));
  return got.offered === true && typeof got.line === 'string' ? got.line : got.why;
}

// After the director's Yes on the premium model's card: the helper checks the account has the model. What it says, in
// one line for the director.
export async function premiumCheck({ client, cwd }) {
  const got = await client.premium.check({ cwd });
  if (got?.ok !== true) throw new CliError(said(got, 'The host helper didn\'t check the premium model'));
  if (got.checked !== true) return `Premium model not checked: ${got.why}.`;
  return got.found === true
    ? "Your account has the premium model. It's tried on your project's own checks next; nothing changes until it passes."
    : "Your account doesn't have the premium model, so nothing changes. I'll offer it again after setup runs and finds it.";
}

// --- Ready-made changes ---

// What the helper made ready, as it answered (scripts/survey/ready.js): the work id it chose, the
// `from` to record the work with, and the rest. It writes no work: the intake records that.
async function ready(ask, body, what) {
  const got = await ask(body);
  if (got?.ok !== true || typeof got.work !== 'string' || !isPlain(got.from)) throw new CliError(said(got, `The host helper didn't make the ${what} ready`));
  const { ok: _ok, ...made } = got;
  // A change made by hand has fixed done lines, given here so the brief never words them itself.
  return typeof made.branch === 'string' && /^feature\/by-hand-[0-9a-f]+$/.test(made.branch) ? { ...made, goal: HAND_GOAL, done: [...HAND_DONE] } : made;
}

// --- Phone alerts ---

const ALERTS_USAGE = 'Give alerts ntfy <topic>, alerts telegram <chat>, alerts status, or alerts off <ntfy|telegram>';

// `alerts ntfy <topic>` keeps an ntfy topic with the helper; `alerts telegram <chat>` has the helper ask the director for the bot token in
// the system's own hidden-entry dialog, which is never a command argument; `alerts status` says which channels are set up and which are on;
// `alerts off <channel>` forgets one. What comes back never holds a topic or a token. An alert says only that decisions wait and in which
// project, and goes only through a channel the director has also switched on in Notifications.
export async function alerts({ client, cwd, args }) {
  const [what, value, ...extra] = args;
  const refuse = (got, fallback) => { throw new CliError(said(got, fallback)); };
  if (what === 'ntfy' && typeof value === 'string' && extra.length === 0) {
    const got = await client.alerts.ntfy({ cwd, topic: value });
    if (got?.ok !== true) refuse(got, 'The host helper did not keep the topic');
    return ['The ntfy topic is kept by the helper. Switch ntfy on under Notifications for alerts to go through it.'];
  }
  if (what === 'telegram' && typeof value === 'string' && extra.length === 0) {
    const got = await client.alerts.telegram({ cwd, chat: value });
    if (got?.ok !== true) refuse(got, 'The host helper did not keep the Telegram details');
    return ['The Telegram bot token and chat are kept by the helper. Switch Telegram on under Notifications for alerts to go through it.'];
  }
  if (what === 'status' && value === undefined) {
    const got = await client.alerts.status({ cwd });
    if (got?.ok !== true) refuse(got, 'The host helper did not say which channels are set up');
    const names = (list) => (Array.isArray(list) && list.length > 0 ? list.join(', ') : 'none');
    return [`Phone alerts set up: ${names(got.setUp)}. Switched on in Notifications: ${names(got.on)}.`];
  }
  if (what === 'off' && ['ntfy', 'telegram'].includes(value) && extra.length === 0) {
    const got = await client.alerts.off({ cwd, channel: value });
    if (got?.ok !== true) refuse(got, 'The host helper did not forget the channel');
    return [`The ${value} channel is forgotten.`];
  }
  throw new CliError(ALERTS_USAGE);
}

// --- The session note ---

// Asks the host helper to keep the session's note for the project `cwd` is in (the sandbox cannot write under the
// Wheelhouse home); returns where it is kept. The limit is checked here too, so a note too long is refused at once.
export async function writeNote({ client, cwd, sessionId, text }) {
  const problem = noteProblem(text);
  if (problem !== null) throw new CliError(problem);
  if (typeof sessionId !== 'string' || sessionId === '') throw new CliError('This session has no id to name its note by');
  const got = await client.session.note({ cwd, session: sessionId, text });
  if (got?.ok !== true) throw new CliError(`The note wasn't kept: ${said(got, 'the host helper did not answer')}`);
  return got.file;
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
// `value` with every AskUserQuestion entry in it in the chat's words (chatCopy): the cards the front desk is given to
// ask carry no set line or reply code for the director to read. The prompt record signs from the state's text. Where a
// copy leaves lines out, an object at the top also gets `inReply`, each card's whole text in the order asked, for a
// front desk with no clickable-question tool to put in its reply, so the director can answer by the reply code.
export function inChatWords(value, whole = null) {
  const top = whole === null;
  const texts = whole ?? [];
  let out;
  if (Array.isArray(value)) out = value.map((v) => inChatWords(v, texts));
  else if (!isPlain(value)) return value;
  else {
    const asked = typeof value.question === 'string' && Array.isArray(value.options) && Object.hasOwn(value, 'multiSelect');
    if (asked) texts.push(value.question);
    out = Object.fromEntries(Object.entries(value).map(([key, part]) => [key, asked && key === 'question' ? chatCopy(part) : inChatWords(part, texts)]));
  }
  return top && isPlain(out) && texts.some((t) => chatCopy(t) !== t) ? { ...out, inReply: texts } : out;
}

export async function main(argv, {
  cwd = process.cwd(), env = process.env, client, input, now = () => new Date(), makeId, columnsReady, ask,
  out = (t) => process.stdout.write(t), err = (t) => process.stderr.write(t),
} = {}) {
  try {
    const [command, ...rest] = argv;
    if (!COMMANDS.includes(command)) throw new CliError(`Commands: ${COMMANDS.join(', ')}`);
    const helper = client ?? helperClient(command === 'confirm' ? { timeout: CONFIRM_WAIT_MS } : {});
    const here = path.resolve(cwd);
    const stdin = async () => (input === undefined ? readInput() : input);
    const json = (value) => out(`${JSON.stringify(inChatWords(value), null, 2)}\n`);
    const lines = (list) => out(`${list.map((l) => l.replace(BREAKS, ' ')).join('\n')}\n`);

    if (command === 'note') {
      only(rest, 0, 'note takes no arguments: give the note on standard input');
      lines([`Note kept at ${await writeNote({ client: helper, cwd: here, sessionId: env.CLAUDE_CODE_SESSION_ID, text: await stdin() })}`]);
      return 0;
    }
    // `--here` on cards, again and pull-cards: the cards handed out are marked to be asked in the chat, once (here.json).
    const hereMark = async (args) => {
      const wanted = args.includes('--here');
      const left = args.filter((a) => a !== '--here');
      const stamp = (typeof now === 'function' ? now() : new Date(now ?? Date.now())).getTime();
      const session = env.CLAUDE_CODE_SESSION_ID;
      if (typeof session === 'string' && session !== '') {
        return wanted ? { left, onAsked: (ids) => { if (ids.length > 0) markHere(session, ids, stamp); } } : { left };
      }
      if (!wanted) return { left };
      throw new CliError('The session isn\'t known, so the cards can\'t be asked here.');
    };
    if (command === 'pull-cards') {
      const { left, onAsked } = await hereMark(rest);
      only(left, 0, 'pull-cards takes no arguments');
      json(await pullCards({ client: helper, cwd: here, now, onAsked }));
      return 0;
    }
    if (command === 'cards') {
      const { left, onAsked } = await hereMark(rest);
      only(left, 0, 'cards takes no arguments');
      json(await cards({ client: helper, cwd: here, now, onAsked }));
    } else if (command === 'decision') {
      const usage = 'Give decision list, or decision show <n> with the decision\'s number';
      if (rest[0] === 'list' && rest.length === 1) lines(await decisionList({ client: helper, cwd: here, now }));
      else if (rest[0] === 'show' && rest.length === 2 && /^[1-9][0-9]{0,2}$/.test(rest[1])) out(`${await decisionShow({ client: helper, cwd: here, n: Number(rest[1]) })}\n`);
      else throw new CliError(usage);
    } else if (command === 'alerts') {
      lines(await alerts({ client: helper, cwd: here, args: rest }));
    } else if (command === 'card') {
      only(rest, 0, 'card takes no arguments: give the card as JSON on standard input');
      json(await card({ client: helper, cwd: here, input: parsed(await stdin()), now }));
    } else if (command === 'again') {
      const { left, onAsked } = await hereMark(rest);
      if (left.length !== 1 || !/^[1-9][0-9]{0,8}$/.test(left[0])) throw new CliError('Give the card\'s number in the Logbook: again <n> [--here]');
      json(await again({ client: helper, cwd: here, n: Number(left[0]), onAsked }));
    } else if (command === 'why' && rest[0] === 'decision') {
      if (rest.length < 2 || !/^[1-9][0-9]{0,2}$/.test(rest[1])) throw new CliError('Give the decision\'s number from decision list, then what to ask if you like: why decision <n> [words]');
      lines(await whyDecision({ client: helper, cwd: here, n: Number(rest[1]), words: rest.slice(2).join(' '), ...(ask ? { ask } : {}) }));
    } else if (command === 'why') {
      if (rest.length < 1 || !/^[1-9][0-9]{0,8}$/.test(rest[0])) throw new CliError('Give the card\'s number in the Logbook, then what to ask if you like: why <n> [words]');
      lines(await why({ client: helper, cwd: here, n: Number(rest[0]), words: rest.slice(1).join(' '), ...(ask ? { ask } : {}) }));
    } else if (command === 'suggest') {
      if (rest.length < 3) throw new CliError('Give the card, the work and the change: suggest <card id> <work id> <the change in your own words>');
      json(await suggest({ client: helper, cwd: here, card: rest[0], work: rest[1], change: rest.slice(2).join(' ') }));
    } else if (command === 'drop') {
      if (rest.length !== 1 || rest[0] === '') throw new CliError('Give the work to drop: drop <work id>');
      json(await drop({ client: helper, cwd: here, work: rest[0] }));
    } else if (command === 'pull-back') {
      const change = rest.length === 2 && rest[1] === '--change';
      if ((rest.length !== 1 && !change) || rest[0] === '') throw new CliError('Give the call: pull-back <call id>, and --change after it to change what was built as well');
      json(await pullBack({ client: helper, cwd: here, call: rest[0], change, now, ...(makeId ? { makeId } : {}) }));
    } else if (command === 'ask-bosun') {
      if (rest.length !== 1 || rest[0] === '') throw new CliError('Give the work: ask-bosun <work id>');
      json(await askBosun({ client: helper, cwd: here, work: rest[0] }));
    } else if (command === 'record') {
      only(rest, 1, `Give the kind to record: record <kind>, one of ${RECORD_KINDS.join(', ')}`);
      if (!RECORD_KINDS.includes(rest[0])) throw new CliError(`record takes one of: ${RECORD_KINDS.join(', ')}`);
      json(await record({ client: helper, cwd: here, kind: rest[0], input: parsed(await stdin()), now, ...(makeId ? { makeId } : {}), ...(columnsReady ? { ready: columnsReady } : {}) }));
    } else if (command === 'similar') {
      // The request's words as the arguments, which STOP lets through, or its text on standard input.
      json(await similar({ client: helper, cwd: here, text: rest.length > 0 ? rest.join(' ') : await stdin() }));
    } else if (command === 'preview') {
      if (rest.length !== 1 || !/^[1-9][0-9]{0,8}$/.test(rest[0])) throw new CliError('Give the pull request\'s number: preview <n>');
      lines(await preview({ client: helper, cwd: here, n: Number(rest[0]) }));
    } else if (command === 'undo') {
      if (rest.length !== 1 || !/^[0-9a-f]{40,64}$/.test(rest[0])) throw new CliError('Give the merge in full: undo <merge>');
      json(await helper.undo({ cwd: here, merge: rest[0] }));
    } else if (command === 'move') {
      if (rest.length !== 1 || !['github', 'gitlab'].includes(rest[0])) throw new CliError('Say where: move github, or move gitlab');
      json(await helper.local.move({ cwd: here, host: rest[0] }));
    } else if (command === 'carry-on') {
      const usage = 'Give the request\'s number or the piece of work\'s name: carry-on <n>, or carry-on --line <name>';
      if (rest.length === 2 && rest[0] === '--line' && rest[1] !== '') {
        json(await ready(helper.survey.carryOn, { cwd: here, line: rest[1] }, `piece of work ${rest[1]}`));
      } else {
        if (rest.length !== 1 || !/^[1-9][0-9]{0,8}$/.test(rest[0])) throw new CliError(usage);
        json(await ready(helper.survey.carryOn, { cwd: here, number: Number(rest[0]) }, `request #${rest[0]}`));
      }
    } else if (command === 'archive' || command === 'restore') {
      only(rest, 0, `${command} takes no arguments`);
      json(await ready(helper.survey[command], { cwd: here }, command === 'archive' ? 'archive' : 'putting back'));
    } else if (command === 'confirm') {
      only(rest, 1, 'Give the card\'s id, or lift-stop: confirm <card>');
      json(await confirm({ client: helper, cwd: here, card: rest[0] }));
    } else if (command === 'premium-card' || command === 'premium-check') {
      only(rest, 0, `${command} takes no arguments`);
      lines([await (command === 'premium-card' ? premiumCard : premiumCheck)({ client: helper, cwd: here })]);
    } else if (command === 'views') {
      const usage = `Give the view's name: views <name>, one of ${VIEW_NAMES.join(', ')}; waiting also takes --since <time>`;
      let since;
      if (rest.length === 3 && rest[0] === 'waiting' && rest[1] === '--since') {
        since = new Date(rest[2]);
        if (Number.isNaN(since.getTime())) throw new CliError('Give --since a time such as 2026-11-04T10:00:00Z');
      } else {
        only(rest, 1, usage);
      }
      lines(await view({ client: helper, cwd: here, name: rest[0], now, ...(since === undefined ? {} : { since }) }));
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
  const code = await main(process.argv.slice(2));
  process.exitCode = code;
  // `why` may leave a child of the session copy behind; the command ends once its lines are written, whatever still runs.
  if (process.argv[2] === 'why') process.stdout.write('', () => process.exit(code));
}
