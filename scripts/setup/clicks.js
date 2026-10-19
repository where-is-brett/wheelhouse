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
//                  rules?, writes?, found?, at }, written by the helper when a step's plan asks
//                  it; `typed` says whether a typed answer counts, `rules` is the list on step 5's
//                  card of the rules found, `writes` what each answer records in the project's
//                  state (scripts/lib/setup-writes.js), `found` what the step found, kept for the
//                  rest of the run
//   answered/      one empty marker per asked question whose answer recorded something in the
//                  project's state, so it records it once
//   answers/       each answer as the prompt record signed it: an `action` event `setup-answer`
//                  { runId, step, questionId, question, label, text }
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
import { readEnrolled, verify } from '../state/signing.js';
import { eventPath } from '../state/events.js';
import { helperClient } from '../host/helper-client.js';
import { CLICK_FRESH_MS } from '../lib/setup-numbers.js';
import { PUT_OFF } from '../lib/front-desk.js';
import {
  HASH, RUN_ID, EVENT_ID, SETUP_QUESTION_ID, clicksDir, usedDir, shownDir, askedDir, answersDir, writeWhole, shownCard, readShown,
  readAsked,
} from '../lib/setup-clicks.js';

export { clicksDir, keepClick, shownHash, keepAnswer, askedFor } from '../lib/setup-clicks.js';

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
// `found`).
// Asking it again replaces the record, so only an answer on the card as last asked counts.
export function noteAsked({ runId, folder, step, id, card, typed = false, rules, writes, found, now = () => new Date() }) {
  const asked = shownCard(card);
  if (!RUN_ID.test(String(runId)) || !Number.isInteger(step) || !SETUP_QUESTION_ID.test(String(id)) || typeof folder !== 'string' || asked === null) {
    throw new Error('An asked question needs its run, folder, step, id and card');
  }
  const record = {
    runId, folder, step, id, card: asked, typed: typed === true, ...(rules === undefined ? {} : { rules }), ...(writes === undefined ? {} : { writes }),
    ...(found === undefined ? {} : { found }), at: now().toISOString(),
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

// Every event kept in one of setup's folders on this computer; a file that isn't one is passed over.
function keptIn(dir) {
  let names;
  try {
    names = fs.readdirSync(dir).filter((n) => n.endsWith('.json'));
  } catch {
    return [];
  }
  return names.flatMap((name) => {
    try {
      const event = JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8'));
      return event && typeof event === 'object' ? [event] : [];
    } catch {
      return [];
    }
  });
}
const keptClicks = () => keptIn(clicksDir());

// Made on this computer and signed by its enrolled key.
const ownSigned = (e, me, enrolled) => e.computer === me && e.sig?.computer === me && EVENT_ID.test(String(e.id)) && verify(e, enrolled);

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

// Every answer the director has given to this run's questions, as each step's plan reads it in
// ctx.answers: { '<step>.<question id>': { label, text, at } }. An answer counts when it is a
// setup-answer naming this run, made on this computer and signed by its enrolled key, and the
// question it answers is the one its step last asked under that id, in the same words, with the
// label one of that card's own options (never a put-off) or, on a card that takes one, a typed
// text. Answers are never used up and never go stale: the newest for each question counts.
export function answersFor(runId) {
  if (!RUN_ID.test(String(runId))) return {};
  const enrolled = readEnrolled();
  const me = computerId();
  const answers = {};
  const kept = keptIn(answersDir()).filter((e) => e.kind === 'action' && e.data?.action === 'setup-answer' && e.data.runId === runId
    && Number.isFinite(Date.parse(e.at)) && ownSigned(e, me, enrolled));
  for (const e of kept.sort((a, b) => Date.parse(a.at) - Date.parse(b.at))) {
    const { step, questionId, question, label, text } = e.data;
    const asked = askedRecord(runId, step, questionId);
    if (asked === null || asked.card.question !== question) continue;
    const fits = typeof label === 'string'
      ? text === null && !PUT_OFF.includes(label) && asked.card.options.some((o) => o.label === label)
      : label === null && typeof text === 'string' && text !== '' && asked.typed === true;
    if (fits) answers[`${step}.${questionId}`] = { label, text, at: e.at };
  }
  return answers;
}

// How long the helper may take to record one click in the project's state.
const RECORD_WAIT_MS = 60 * 1000;

// Copies the director's setup clicks and answers of a run into the project's state (ruling R45):
// each kept here, naming this run, made on this computer and signed by its enrolled key, sent as
// it is, oldest first, to the helper's /state/record, which writes it into the state clone and
// pushes the state branch (writeEvent). One whose event file is in the state clone already is
// skipped, so it reaches the state branch once however often this runs; it runs at the end of
// every successful apply once the project has its state, since clicks keep coming after step 7.
// `record({ project, event })` is the helper's route, for tests. Never throws: a click the helper
// could not take is counted, and sent by a later run of this.
export async function copySetupRecords(runId, project, { record } = {}) {
  const counts = { copied: 0, skipped: 0, failed: 0 };
  if (!RUN_ID.test(String(runId))) return counts;
  const send = record ?? ((body) => helperClient({ timeout: RECORD_WAIT_MS }).state.record(body));
  const enrolled = readEnrolled();
  const me = computerId();
  const dir = stateDir(project);
  const ours = [...keptClicks(), ...keptIn(answersDir())].filter((e) => e.kind === 'action' && ['setup', 'setup-answer'].includes(e.data?.action)
    && e.data.runId === runId && typeof e.at === 'string' && Number.isFinite(Date.parse(e.at)) && ownSigned(e, me, enrolled))
    .sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
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
