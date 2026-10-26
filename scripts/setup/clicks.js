// scripts/setup/clicks.js
// The director's clicks on setup cards, and the lists those cards showed. Before a state branch
// exists there is no state to record a click in, so both are kept under
// <wheelhouseHome()>/setup/, out of agents' reach (Task 13 copies the clicks into the state once
// the state branch exists):
//   clicks/        each click as the prompt record signed it: an `action` event `setup`
//                  { runId, step, hash, question, label }, naming the run the card was shown for
//   clicks-used/   one empty marker per click the helper has used, named by the click's id
//   shown/         the card each run's step last showed: { runId, folder, step, hash, card, at },
//                  written by the helper when it works out a step's plan and composes its card;
//                  `card` is what the director reads: { question, header, options: [{ label,
//                  description }] }
//   asked/         each question a run's step last asked (ruling R30), as
//                  <run id>-<step>-<question id>.json: { runId, folder, step, id, card, typed,
//                  rules?, writes?, found?, choices?, facts?, at }, written by the helper when a step's plan asks
//                  it; `typed` says whether a typed answer counts, `rules` is the list on step 5's
//                  card of the rules found, `writes` what each answer records in the project's
//                  state (scripts/lib/setup-writes.js), `found` what the step found, kept for the
//                  rest of the run
//   answered/      one empty marker per asked question whose answer recorded something in the
//                  project's state, so it records it once
//   answers/       each answer as the prompt record signed it: an `action` event `setup-answer`
//                  { runId, step, questionId, question, label, text }
// Uninstall's card and click (ruling R90) are kept in the same folders, so the last uninstall, which
// removes them whole, takes them too:
//   shown/uninstall-<16 hex>.json   the card uninstall last showed for a folder (the hex from its
//                  real path): { project, folder, hash, card, at }, written by the helper when it
//                  works out uninstall's list and composes its card
//   clicks/        the director's Remove it as the prompt record signed it: an `action` event
//                  `uninstall` { project, hash, question, label }, its question the set line alone;
//                  a used one is marked in clicks-used/ as a setup click is
// The prompt record reads `shown/` to turn the twelve characters on a card into the full hash
// the click names, with the run the card was shown for, and counts a click only on the card
// exactly as the helper composed it (its text, header and each option's label and description),
// so the words the director read are the helper's for that list. It keeps an answer only on a card
// exactly as `asked/` holds it, in the same way. The helper reads `clicks/` before it applies a
// step, and `answers/` whenever it works out a step's plan.
//
// What the prompt record needs of this, keeping a click or an answer and finding the card it was
// on, is in scripts/lib/setup-clicks.js, so the mod's bridge, which imports the prompt record,
// reaches nothing under scripts/setup/.
import fs from 'node:fs';
import path from 'node:path';
import { computerId, stateDir } from '../lib/paths.js';
import { readEnrolled } from '../state/signing.js';
import { eventPath } from '../state/events.js';
import { helperClient } from '../host/helper-client.js';
import { CLICK_FRESH_MS } from '../lib/setup-numbers.js';
import { PUT_OFF } from '../lib/front-desk.js';
import { taken } from '../hooks/pending.js';
import {
  HASH, RUN_ID, EVENT_ID, SETUP_QUESTION_ID, clicksDir, usedDir, shownDir, askedDir, answersDir, recordsDir, writeWhole, shownCard, readShown,
  readAsked, uninstallShownFile, readUninstallShown, keptIn, ownSigned, keptAnswers, typedVerdict,
} from '../lib/setup-clicks.js';
import { isLineName } from '../state/card-lines.js';

export { clicksDir, keepClick, shownHash, keepAnswer, askedFor, keepUninstallClick, shownUninstall } from '../lib/setup-clicks.js';

// A click dated a little after the helper's clock still counts: two clocks on one computer.
const SKEW_MS = 60 * 1000;

// Records the card a run's step showed: the list's full hash and the card, for the folder.
export function noteShown({ runId, folder, step, hash, card, now = () => new Date() }) {
  const shown = shownCard(card);
  if (!RUN_ID.test(String(runId)) || !Number.isInteger(step) || !HASH.test(String(hash)) || typeof folder !== 'string' || shown === null) {
    throw new Error('A shown card needs its run, folder, step, the full hash of its list and the card');
  }
  const record = { runId, folder, step, hash, card: shown, at: now().toISOString() };
  writeWhole(path.join(shownDir(), `${runId}-${step}.json`), `${JSON.stringify(record)}\n`);
}

// The list a run's step last showed, or null.
export function shownFor(runId, step) {
  if (!RUN_ID.test(String(runId)) || !Number.isInteger(step)) return null;
  const r = readShown(path.join(shownDir(), `${runId}-${step}.json`));
  return r && r.runId === runId && r.step === step ? r : null;
}

// Records the question a run's step asked: its id within the step, the card as the director is
// shown it, whether a typed answer counts, and anything the step keeps with it (`rules`, `writes`,
// `found`, and for the one card, step 0, the `choices` its Go ahead stands for: scripts/setup/choices.js).
// Asking it again replaces the record, so only an answer on the card as last asked counts.
export function noteAsked({ runId, folder, step, id, card, typed = false, rules, writes, found, choices, facts, now = () => new Date() }) {
  const asked = shownCard(card);
  if (!RUN_ID.test(String(runId)) || !Number.isInteger(step) || !SETUP_QUESTION_ID.test(String(id)) || typeof folder !== 'string' || asked === null) {
    throw new Error('An asked question needs its run, folder, step, id and card');
  }
  const record = {
    runId, folder, step, id, card: asked, typed: typed === true, ...(rules === undefined ? {} : { rules }), ...(writes === undefined ? {} : { writes }),
    ...(found === undefined ? {} : { found }), ...(choices === undefined ? {} : { choices }), ...(facts === undefined ? {} : { facts }), at: now().toISOString(),
  };
  writeWhole(path.join(askedDir(), `${runId}-${step}-${id}.json`), `${JSON.stringify(record)}\n`);
}

// The question a run's step last asked under that id, or null.
export function askedRecord(runId, step, id) {
  if (!RUN_ID.test(String(runId)) || !Number.isInteger(step) || !SETUP_QUESTION_ID.test(String(id))) return null;
  const r = readAsked(path.join(askedDir(), `${runId}-${step}-${id}.json`));
  return r && r.runId === runId && r.step === step && r.id === id ? r : null;
}

// Every question a run's step has asked, oldest first.
export function askedIn(runId, step) {
  if (!RUN_ID.test(String(runId)) || !Number.isInteger(step)) return [];
  let names;
  try {
    names = fs.readdirSync(askedDir()).filter((n) => n.startsWith(`${runId}-${step}-`) && n.endsWith('.json'));
  } catch {
    return [];
  }
  return names.map((n) => readAsked(path.join(askedDir(), n))).filter((r) => r !== null && r.runId === runId && r.step === step)
    .sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
}

const keptClicks = () => keptIn(clicksDir());

const used = (event) => fs.existsSync(path.join(usedDir(), String(event.id)));

// The director's clicks that let this step's list go ahead, newest first: a setup action naming
// this run, this step and this full hash, made on this computer, signed by its enrolled key, from
// the last CLICK_FRESH_MS, and not yet used. A click on another folder's card, though its list has
// the same hash, names another run and is not one of them.
export function freshClicks({ runId, step, hash, now = () => new Date() }) {
  const enrolled = readEnrolled();
  const me = computerId();
  const at = now().getTime();
  return keptClicks().filter((e) => {
    const age = at - Date.parse(e.at);
    return e.kind === 'action' && e.data?.action === 'setup' && RUN_ID.test(String(runId)) && e.data.runId === runId
      && e.data.step === step && e.data.hash === hash
      && age <= CLICK_FRESH_MS && age >= -SKEW_MS && !used(e) && ownSigned(e, me, enrolled);
  }).sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
}

// A typed answer that is no answer at first sight, and the rule for when it counts (rulings R125,
// R132, R137), live in scripts/lib/setup-clicks.js, which the prompt record reads too.
export { HANDED_BACK, handedBack, notAnAnswer } from '../lib/setup-clicks.js';

// This run's setup-answers to the questions its steps last asked, in the same words, oldest first,
// each with whether it counts and, for a typed text that does not, why: 'handedBack' (the choice
// handed back, every time) or 'question' (it ends with "?", the first time only on that question:
// any typed answer to it after one such refusal counts, ruling R132). Read from the signed records
// alone, so it holds across sessions.
function verdicts(runId) {
  const typedSoFar = new Map();
  const list = [];
  for (const e of keptAnswers(runId)) {
    const { step, questionId, question, label, text } = e.data;
    const asked = askedRecord(runId, step, questionId);
    if (asked === null || asked.card.question !== question) continue;
    const key = `${step}.${questionId}`;
    if (typeof label === 'string') {
      list.push({ e, key, counts: text === null && !PUT_OFF.includes(label) && asked.card.options.some((o) => o.label === label) });
    } else if (label === null && typeof text === 'string' && text !== '' && asked.typed === true) {
      const why = typedVerdict(text, typedSoFar.get(key) ?? []);
      typedSoFar.set(key, [...(typedSoFar.get(key) ?? []), text]);
      list.push({ e, key, counts: why === null, ...(why === null ? {} : { why }) });
    }
  }
  return list;
}

// Every answer the director has given to this run's questions, as each step's plan reads it in
// ctx.answers: { '<step>.<question id>': { label, text, at } }. An answer counts when it is a
// setup-answer naming this run, made on this computer and signed by its enrolled key, and the
// question it answers is the one its step last asked under that id, in the same words, with the
// label one of that card's own options (never a put-off) or, on a card that takes one, a typed
// text that is an answer (verdicts: never the choice handed back, and a question only once it was
// refused on that question before, rulings R125, R132; a refused record stays as it was kept, and
// is passed over here). Answers are never used up and never go stale: the newest for each question
// counts.
export function answersFor(runId) {
  const answers = {};
  for (const { e, key, counts } of verdicts(runId)) {
    if (counts) answers[key] = { label: e.data.label, text: e.data.text, at: e.at };
  }
  return answers;
}

// Why the newest typed answer to this question since its card was last asked, in the same words,
// was not taken ('question' or 'handedBack', as verdicts gives it), or null: the step asks the card
// again, saying why (rulings R125, R132).
export function typedRefused(runId, step, id) {
  const asked = askedRecord(runId, step, id);
  if (asked === null || asked.typed !== true) return null;
  const since = verdicts(runId).filter((v) => v.key === `${step}.${id}` && Date.parse(v.e.at) >= Date.parse(asked.at)).at(-1);
  return since?.why ?? null;
}

// Records uninstall's card as shown for a folder (ruling R90): the project its line names, the full
// hash of the list and the card. Showing it again replaces the record, so only a click on the card
// as last shown counts.
export function noteUninstallShown({ project, folder, hash, card, now = () => new Date() }) {
  const shown = shownCard(card);
  if (!isLineName(project) || !HASH.test(String(hash)) || typeof folder !== 'string' || !path.isAbsolute(folder) || shown === null) {
    throw new Error('Uninstall\'s shown card needs its project, its folder as a full path, the full hash of its list and the card');
  }
  const record = { project, folder, hash, card: shown, at: now().toISOString() };
  writeWhole(uninstallShownFile(folder), `${JSON.stringify(record)}\n`);
}

// The card uninstall last showed for a folder, or null.
export function uninstallShownFor(folder) {
  if (typeof folder !== 'string' || !path.isAbsolute(folder)) return null;
  return readUninstallShown(uninstallShownFile(folder));
}

// The director's clicks that let uninstall's list go ahead, newest first: an uninstall action naming
// this project and this full hash, made on this computer, signed by its enrolled key, from the last
// CLICK_FRESH_MS, and not yet used (useClick, releaseClick). The route (Task 15b) also matches the
// hash against uninstallShownFor(folder) and the list it works out again.
export function freshUninstallClicks({ project, hash, now = () => new Date() }) {
  if (!isLineName(project) || !HASH.test(String(hash))) return [];
  const enrolled = readEnrolled();
  const me = computerId();
  const at = now().getTime();
  return keptClicks().filter((e) => {
    const age = at - Date.parse(e.at);
    return e.kind === 'action' && e.data?.action === 'uninstall' && e.data.project === project && e.data.hash === hash
      && age <= CLICK_FRESH_MS && age >= -SKEW_MS && !used(e) && ownSigned(e, me, enrolled);
  }).sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
}

// How long the helper may take to record one click in the project's state.
const RECORD_WAIT_MS = 60 * 1000;

// Copies the director's setup clicks and answers of a run into the project's state (ruling R45):
// each kept here, naming this run, made on this computer and signed by its enrolled key, sent as
// it is, oldest first, to the helper's /state/record, which writes it into the state clone and
// pushes the state branch (writeEvent). One whose event file is in the state clone already is
// skipped, so it reaches the state branch once however often this runs; it runs at the end of
// every successful apply once the project has its state, since clicks keep coming after step 7.
// The records the run's answers earned before the state existed go first (sendLaterRecords).
// `record({ project, event })` and `write(body)` are the helper's routes, for tests. Never throws: a click the helper
// could not take is counted, and sent by a later run of this.
export async function copySetupRecords(runId, project, { record, write } = {}) {
  const counts = { copied: 0, skipped: 0, failed: 0 };
  if (!RUN_ID.test(String(runId))) return counts;
  const send = record ?? ((body) => helperClient({ timeout: RECORD_WAIT_MS }).state.record(body));
  const enrolled = readEnrolled();
  const me = computerId();
  const dir = stateDir(project);
  const ours = [...keptClicks(), ...keptIn(answersDir())].filter((e) => e.kind === 'action' && ['setup', 'setup-answer'].includes(e.data?.action)
    && e.data.runId === runId && typeof e.at === 'string' && Number.isFinite(Date.parse(e.at)) && ownSigned(e, me, enrolled))
    .sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  await sendLaterRecords(runId, project, { record, write });
  for (const event of ours) {
    let there = false;
    try {
      there = fs.existsSync(path.join(dir, eventPath(event)));
    } catch { /* not read: sent, and the helper refuses one it holds */ }
    if (there) {
      counts.skipped += 1;
      continue;
    }
    let got = null;
    try {
      got = await send({ project, event });
    } catch { /* counted below */ }
    if (got?.ok === true) counts.copied += 1;
    else counts.failed += 1;
  }
  return counts;
}

// Sends the records a run's answers earned before its project had a state (the one card's, design
// section 15.1), oldest first, removing each the helper takes or already holds. One the helper
// refuses otherwise stays, and a later run of this tries again. `record` and `write` stand in for
// the helper's routes in tests. Never throws.
async function sendLaterRecords(runId, project, { record, write } = {}) {
  let names;
  try {
    names = fs.readdirSync(recordsDir()).filter((n) => n.startsWith(`${runId}_`) && n.endsWith('.json')).sort();
  } catch {
    return;
  }
  const client = () => helperClient({ timeout: RECORD_WAIT_MS });
  for (const name of names) {
    const file = path.join(recordsDir(), name);
    try {
      const kept = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (kept?.runId !== runId || !kept.body || typeof kept.body !== 'object') continue;
      const body = { project, ...kept.body };
      const got = kept.route === 'write' ? await (write ?? ((b) => client().state.write(b)))(body) : await (record ?? ((b) => client().state.record(b)))(body);
      if (taken(got)) fs.rmSync(file, { force: true });
    } catch { /* tried again by a later run of this */ }
  }
}

// Gives a used click back, when the step it was used for could not be started.
export function releaseClick(event) {
  if (!EVENT_ID.test(String(event?.id))) return;
  try {
    fs.rmSync(path.join(usedDir(), event.id), { force: true });
  } catch { /* it stays used, and the director clicks again */ }
}

// Uses a click, once: a marker named by its id, made exclusively. True when this call used it.
export function useClick(event, now = () => new Date()) {
  if (!EVENT_ID.test(String(event?.id))) return false;
  try {
    writeWhole(path.join(usedDir(), event.id), `${now().toISOString()}\n`, { exclusive: true });
    return true;
  } catch (error) {
    if (error.code === 'EEXIST') return false;
    throw error;
  }
}
