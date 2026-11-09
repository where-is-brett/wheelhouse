// scripts/lib/setup-clicks.js
// The prompt record's side of setup's clicks and answers (scripts/setup/clicks.js says how they
// are kept): keeping a signed click in <wheelhouseHome()>/setup/clicks/ and a signed answer in
// setup/answers/, and finding the card setup showed, in setup/shown/, or asked, in setup/asked/,
// that a click was on. Uninstall's click (ruling R90) is kept the same way: its card's shown record
// in setup/shown/, one per folder, and the director's Remove it in setup/clicks/. It lives apart from scripts/setup/ so the
// prompt record reaches nothing there. It writes only
// the click and answer files, and setup/dropped.log, which says why an answer on a card setup asked
// was not kept; it never writes Claude Code's settings or setup's journal.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { wheelhouseHome, computerId } from './paths.js';
import { isLineName } from '../state/card-lines.js';
import { readEnrolled, verify } from '../state/signing.js';

export const HASH = /^[0-9a-f]{64}$/;
export const RUN_ID = /^run-[0-9a-f]{10}$/;
export const EVENT_ID = /^[A-Za-z0-9-]{1,64}$/;
// A setup question's id within its step (ruling R30).
export const SETUP_QUESTION_ID = /^[a-z0-9-]{1,40}$/;
const caseBlind = process.platform === 'win32' || process.platform === 'darwin';

export const clicksDir = () => path.join(wheelhouseHome(), 'setup', 'clicks');
export const usedDir = () => path.join(wheelhouseHome(), 'setup', 'clicks-used');
export const shownDir = () => path.join(wheelhouseHome(), 'setup', 'shown');
export const askedDir = () => path.join(wheelhouseHome(), 'setup', 'asked');
export const answersDir = () => path.join(wheelhouseHome(), 'setup', 'answers');
export const answeredDir = () => path.join(wheelhouseHome(), 'setup', 'answered');
// The records an answer earned before its project had a state to take them (the one card's, design
// section 15.1), each kept until the helper has sent it there (scripts/setup/clicks.js, copySetupRecords).
export const recordsDir = () => path.join(wheelhouseHome(), 'setup', 'records');

// Keeps the records one answer earned, for a run whose project has no state yet: one file each,
// { runId, route, body } with `body` lacking its project, named by the run so only it sends them.
export function keepSetupRecords(runId, records, now = () => new Date()) {
  if (!RUN_ID.test(String(runId))) throw new Error('Records kept for later need their run');
  const at = now().toISOString().replaceAll(':', '-');
  // Named in the order the answer earned them, which is the order they are sent in.
  return records.map(({ route, body }, i) => {
    const file = path.join(recordsDir(), `${runId}_${at}_${String(i).padStart(3, '0')}_${crypto.randomUUID().slice(0, 12)}.json`);
    writeWhole(file, `${JSON.stringify({ runId, route, body })}\n`, { exclusive: true });
    return file;
  });
}

const keyOf = (p) => {
  const text = p.normalize('NFC');
  return caseBlind ? text.toLowerCase() : text;
};
function realPath(p) {
  try {
    return fs.realpathSync.native(p);
  } catch {
    return null;
  }
}
// Whether `dir` is `folder` or inside it, by real paths.
function holds(folder, dir) {
  const a = realPath(folder);
  const b = realPath(dir);
  if (a === null || b === null) return false;
  const base = keyOf(a);
  const target = keyOf(b);
  return target === base || target.startsWith(base.endsWith(path.sep) ? base : base + path.sep);
}

// Writes a whole file for its owner only: exclusively, or by a temporary file and a rename.
export function writeWhole(file, text, { exclusive = false } = {}) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  if (exclusive) {
    fs.writeFileSync(file, text, { flag: 'wx', mode: 0o600 });
    return;
  }
  const temp = `${file}.${process.pid}.tmp`;
  try {
    fs.writeFileSync(temp, text, { mode: 0o600 });
    fs.renameSync(temp, file);
  } catch (error) {
    fs.rmSync(temp, { force: true });
    throw error;
  }
}

// Keeps one signed setup click, under a name of its time, computer and id, never over another.
export function keepClick(event) {
  if (event?.kind !== 'action' || event.data?.action !== 'setup' || !event.sig) throw new Error('Only a signed setup click is kept here');
  if (typeof event.at !== 'string' || !EVENT_ID.test(String(event.id)) || !/^[0-9a-f]{8}$/.test(String(event.computer))) {
    throw new Error('A setup click needs its time, its id and its computer');
  }
  const file = path.join(clicksDir(), `${event.at.replaceAll(':', '-')}_${event.computer}_setup_${event.id}.json`);
  writeWhole(file, `${JSON.stringify(event, null, 2)}\n`, { exclusive: true });
  return file;
}

// Keeps one signed answer to a setup question, under a name of its time, computer and id, never
// over another.
export function keepAnswer(event) {
  if (event?.kind !== 'action' || event.data?.action !== 'setup-answer' || !event.sig) throw new Error('Only a signed setup answer is kept here');
  if (typeof event.at !== 'string' || !EVENT_ID.test(String(event.id)) || !/^[0-9a-f]{8}$/.test(String(event.computer))) {
    throw new Error('A setup answer needs its time, its id and its computer');
  }
  const file = path.join(answersDir(), `${event.at.replaceAll(':', '-')}_${event.computer}_answer_${event.id}.json`);
  writeWhole(file, `${JSON.stringify(event, null, 2)}\n`, { exclusive: true });
  return file;
}

// A claim whose answer was never kept is left by a hook cut short between the two (Claude Code ends
// a hook at its time limit). Once older than this, far past any hook's time limit, it holds nothing.
export const CLAIM_STALE_MS = 2 * 60 * 1000;
// How long before its claim's time a click's records may be named (by the hook's clock as it
// started), for a claim an earlier Wheelhouse made without listing them: past any hook's time limit.
const LEGACY_RECORDS_MS = 15 * 1000;

const wordsOf = (question) => crypto.createHash('sha256').update(String(question)).digest('hex').slice(0, 16);
const claimPrefix = (runId, step) => `${runId}-${step}-`;

function claimFile({ runId, step, questionId, question }) {
  if (!RUN_ID.test(String(runId)) || !Number.isInteger(step) || !SETUP_QUESTION_ID.test(String(questionId))) throw new Error('An answer to claim needs its run, step and question');
  return path.join(answeredDir(), `${claimPrefix(runId, step)}${questionId}-${wordsOf(question)}`);
}

// A claim's time and the record files it lists; null when it can't be read.
function readClaim(file) {
  try {
    const lines = fs.readFileSync(file, 'utf8').split('\n').filter((l) => l !== '');
    const at = Date.parse(lines[0] ?? '');
    return { at: Number.isFinite(at) ? at : null, records: lines.slice(1) };
  } catch {
    return null;
  }
}

// Takes a claim back with the records its click kept that are not sent yet: the files it lists (sent
// ones are gone already: the helper removes each record it takes), or, for a claim an earlier
// Wheelhouse made without listing them, the run's records in setup/records/ named in the moments
// before the claim. The answer it kept stays: the newest answer to a question is the one that counts.
function takeBack(file, runId, claim) {
  const home = path.resolve(wheelhouseHome()) + path.sep;
  const listed = claim.records.filter((r) => path.isAbsolute(r) && r.startsWith(home));
  if (listed.length > 0) {
    for (const record of listed) fs.rmSync(record, { force: true });
  } else if (claim.at !== null) {
    let names = [];
    try {
      names = fs.readdirSync(recordsDir());
    } catch { /* no records kept */ }
    for (const name of names) {
      const m = name.startsWith(`${runId}_`) ? /^(\d{4}-\d\d-\d\dT\d\d)-(\d\d)-(\d\d\.\d{3}Z)_/.exec(name.slice(runId.length + 1)) : null;
      const named = m ? Date.parse(`${m[1]}:${m[2]}:${m[3]}`) : NaN;
      if (Number.isFinite(named) && named <= claim.at + 1000 && named >= claim.at - LEGACY_RECORDS_MS) fs.rmSync(path.join(recordsDir(), name), { force: true });
    }
  }
  fs.rmSync(file, { force: true });
}

// Whether a claim holds nothing any more, so it is taken back: its card was asked again since it was
// made (Customise asks every choice again, and a choice changed is asked again), or it is older than
// CLAIM_STALE_MS with no answer kept on this computer (a hook cut short). A claim with its answer
// kept and its card not asked since, or one made a moment ago (another hook may be keeping it now), stands.
function void_(claim, { runId, step, questionId, question }, { now, askedAt }) {
  if (claim.at === null) return true;
  if (Number.isFinite(Date.parse(askedAt)) && Date.parse(askedAt) > claim.at) return true;
  if (now().getTime() - claim.at < CLAIM_STALE_MS) return false;
  return !keptAnswers(runId).some((e) => e.data.step === step && e.data.questionId === questionId && e.data.question === question);
}

// The description is asked under its phase's id (product-launched, product-before-launch), and
// step 4 takes an answer under either (scripts/setup/questions.js). Its records name the phase, so an
// answer under one takes back what one under the other has not sent yet: one glossary entry and one
// phase reach the state.
const sameChoice = (a, b) => a !== b && a.startsWith('product-') && b.startsWith('product-');

// Claims the answer to one asked question, once (Task 9's review): a marker for its run, step, id
// and words, made exclusively. Gives the marker's path, which `releaseAnswer` removes when what the
// answer earns could not be kept, or null when the question was answered already, so the same card
// clicked again, in another session, records nothing twice. A claim that holds nothing any more
// (void_) is taken back first. `askedAt` is when the card answered was last asked. Claiming one
// phase's description takes back the other's claim (sameChoice).
export function claimAnswer(answer, now = () => new Date(), { askedAt } = {}) {
  const file = claimFile(answer);
  for (let tries = 0; tries < 2; tries += 1) {
    try {
      writeWhole(file, `${now().toISOString()}\n`, { exclusive: true });
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      const claim = readClaim(file);
      if (tries > 0 || claim === null || !void_(claim, answer, { now, askedAt })) return null;
      takeBack(file, answer.runId, claim);
      continue;
    }
    try {
      takeBackOthers(answer);
    } catch { /* what the other phase's answer kept is sent as well */ }
    return file;
  }
  return null;
}

function takeBackOthers({ runId, step, questionId }) {
  const prefix = claimPrefix(runId, step);
  let names = [];
  try {
    names = fs.readdirSync(answeredDir()).filter((n) => n.startsWith(prefix));
  } catch { /* none */ }
  for (const name of names) {
    const id = name.slice(prefix.length, -17);
    if (!sameChoice(questionId, id)) continue;
    const file = path.join(answeredDir(), name);
    const claim = readClaim(file);
    if (claim !== null) takeBack(file, runId, claim);
  }
}

// When a claim was made, or null when there is none.
export function claimedAt(answer) {
  try {
    const at = fs.readFileSync(claimFile(answer), 'utf8').split('\n')[0];
    return Number.isFinite(Date.parse(at)) ? at : null;
  } catch {
    return null;
  }
}

// Notes on a claim the files its records were kept in, so a stale claim taken back takes them too.
export function noteClaimed(file, records) {
  if (typeof file !== 'string' || records.length === 0) return;
  fs.appendFileSync(file, records.map((r) => `${r}\n`).join(''));
}

export function releaseAnswer(file) {
  if (typeof file === 'string') fs.rmSync(file, { force: true });
}

// ---- Why an answer on a card setup asked was not kept ----

export const droppedFile = () => path.join(wheelhouseHome(), 'setup', 'dropped.log');
const DROPPED_MOST_BYTES = 64 * 1024;

// One line in setup/dropped.log for an answer on a card setup asked that the prompt record did not
// keep: when, the run, step and question it was asked for, the folder the session was in, and why.
// Never the words typed. The log keeps its newer half once it grows past DROPPED_MOST_BYTES. Never
// throws: the log only helps find out why a card is asked again.
export function noteDropped({ asked, cwd, why, now = () => new Date() }) {
  try {
    const of = asked ? `${asked.runId} step ${asked.step} ${asked.id} (asked for ${asked.folder})` : 'a card setup asked';
    const line = `${now().toISOString()} ${of}: not kept from a session in ${typeof cwd === 'string' ? cwd : 'no folder'}: ${why}\n`;
    const file = droppedFile();
    fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    let size = 0;
    try {
      size = fs.statSync(file).size;
    } catch { /* no log yet */ }
    if (size > DROPPED_MOST_BYTES) {
      const text = fs.readFileSync(file, 'utf8');
      writeWhole(file, text.slice(text.indexOf('\n', text.length / 2) + 1));
    }
    fs.appendFileSync(file, line, { mode: 0o600 });
  } catch { /* the log is a help only */ }
}

// The asked records whose card reads as `card` does, in whatever folder, the one asked last first:
// what a dropped answer's line names when the card was not placed in the session's folder. A
// `card` with no options (an answer to a question the hook was not shown) is matched by its question.
export function askedAnywhere(card) {
  const byQuestion = typeof card?.question === 'string' && !Array.isArray(card?.options);
  const same = byQuestion ? null : cardKey(card);
  if (same === null && !byQuestion) return [];
  const matches = (r) => (byQuestion ? sameWords(r.card.question) === sameWords(card.question) : cardKey(r.card) === same);
  let names;
  try {
    names = fs.readdirSync(askedDir()).filter((n) => n.endsWith('.json'));
  } catch {
    return [];
  }
  return names.map((n) => readAsked(path.join(askedDir(), n))).filter((r) => r !== null && matches(r))
    .sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
}

// What a card shows the director, in one form: its text, header, and each option's label and
// description; null when it isn't a card.
export function shownCard(card) {
  if (!card || typeof card !== 'object' || typeof card.question !== 'string' || card.question === '' || !Array.isArray(card.options)) return null;
  const text = (x) => (typeof x === 'string' ? x : null);
  if (card.options.some((o) => typeof o?.label !== 'string')) return null;
  return { question: card.question, header: text(card.header), options: card.options.map((o) => ({ label: o.label, description: text(o.description) })) };
}

// A card's words as the director reads them, whatever way the session wrote them out to the question tool: line
// breaks as \n (Windows sends \r\n), one Unicode form, curly quotes and apostrophes as straight ones, an ellipsis as
// three dots, a no-break space as a space, and no spaces at the ends of lines. Two texts that read the same match.
export function sameWords(text) {
  if (typeof text !== 'string') return text;
  return text.normalize('NFC').replace(/\r\n?/g, '\n').replace(/[‘’‚‛′]/g, '\'').replace(/[“”„‟″]/g, '"')
    .replace(/…/g, '...').replace(/[  ]/g, ' ').replace(/[ \t]+$/gm, '');
}

// What the question tool's description tells the model to put on the recommended option's label.
export const RECOMMENDED_SUFFIX = ' (Recommended)';

// A label without a trailing "(Recommended)"; as it is when that would leave nothing, or when it isn't a string.
export function bareLabel(label) {
  if (typeof label !== 'string' || !label.endsWith(RECOMMENDED_SUFFIX) || label.length === RECOMMENDED_SUFFIX.length) return label;
  return label.slice(0, -RECOMMENDED_SUFFIX.length);
}

// One key for a card, read as sameWords reads its words (and its labels without a trailing "(Recommended)");
// null when it isn't a card.
export function cardKey(card) {
  const shown = shownCard(card);
  if (shown === null) return null;
  return JSON.stringify({ question: sameWords(shown.question), header: sameWords(shown.header), options: shown.options.map((o) => ({ label: sameWords(bareLabel(o.label)), description: sameWords(o.description) })) });
}

// The parts in which a card asked differs from the one stored, as clauses for a log line: empty when none. Read as cardKey
// reads them. Never quotes a description or typed text, only the headers and labels, which are the card's own words.
export function cardDifferences(asked, stored) {
  const a = shownCard(asked);
  const b = shownCard(stored);
  if (a === null || b === null) return [];
  const out = [];
  if (sameWords(a.question) !== sameWords(b.question)) out.push('its question is not worded as printed');
  if (sameWords(a.header) !== sameWords(b.header)) out.push(`its header is "${a.header}", and the card's is "${b.header}"`);
  if (a.options.length !== b.options.length) {
    out.push(`it has ${a.options.length} options, and the card has ${b.options.length}`);
    return out;
  }
  a.options.forEach((o, i) => {
    const mine = sameWords(bareLabel(o.label));
    const theirs = sameWords(bareLabel(b.options[i].label));
    if (mine !== theirs) out.push(`option ${i + 1}'s label is "${mine}", and the card's is "${theirs}"`);
    if (sameWords(o.description) !== sameWords(b.options[i].description)) out.push(`option ${i + 1}'s description is not worded as printed`);
  });
  return out;
}

// A shown record kept in setup/shown/, or null when the file isn't one.
export function readShown(file) {
  try {
    const r = JSON.parse(fs.readFileSync(file, 'utf8'));
    return r && RUN_ID.test(String(r.runId)) && Number.isInteger(r.step) && HASH.test(String(r.hash)) && typeof r.folder === 'string'
      && shownCard(r.card) !== null ? r : null;
  } catch {
    return null;
  }
}

// The card shown for `step` in a folder holding `cwd` whose list's hash starts with `h12`, on a
// card the director saw as shown, read as sameWords reads it (`card`, the question AskUserQuestion was given):
// { runId, hash }, the run it was shown for and the list's full hash. Null when there is none, or
// two different lists. When several runs showed that very card (every list that changes nothing
// has one hash), the run of the nearest folder holding `cwd` is taken, as the helper places a
// folder, and of those the card shown last.
export function shownHash({ cwd, step, h12, card }) {
  const asked = shownCard(card);
  if (typeof cwd !== 'string' || !/^[0-9a-f]{12}$/.test(String(h12)) || asked === null) return null;
  const same = cardKey(card);
  let names;
  try {
    names = fs.readdirSync(shownDir()).filter((n) => n.endsWith('.json'));
  } catch {
    return null;
  }
  const found = names.map((n) => readShown(path.join(shownDir(), n)))
    .filter((r) => r !== null && r.step === step && r.hash.startsWith(h12) && cardKey(r.card) === same && holds(r.folder, cwd));
  if (new Set(found.map((r) => r.hash)).size !== 1) return null;
  const depth = (r) => keyOf(realPath(r.folder) ?? '').length;
  const nearest = Math.max(...found.map(depth));
  const chosen = found.filter((r) => depth(r) === nearest).sort((a, b) => Date.parse(a.at) - Date.parse(b.at)).at(-1);
  return { runId: chosen.runId, hash: chosen.hash };
}

// The newest of the records of the nearest folder holding `cwd`, or null when there are none.
function nearestNewest(found, cwd) {
  const here = found.filter((r) => holds(r.folder, cwd));
  if (here.length === 0) return null;
  const depth = (r) => keyOf(realPath(r.folder) ?? '').length;
  const nearest = Math.max(...here.map(depth));
  return here.filter((r) => depth(r) === nearest).sort((a, b) => Date.parse(a.at) - Date.parse(b.at)).at(-1);
}

// The record shownHash selects, without the comparison of the card: the shown record for `step` whose list's hash starts
// with `h12`, of the nearest folder holding `cwd`, newest; null when there is none.
export function shownNear({ cwd, step, h12 }) {
  if (typeof cwd !== 'string' || !/^[0-9a-f]{12}$/.test(String(h12))) return null;
  let names;
  try {
    names = fs.readdirSync(shownDir()).filter((n) => n.endsWith('.json'));
  } catch {
    return null;
  }
  return nearestNewest(names.map((n) => readShown(path.join(shownDir(), n))).filter((r) => r !== null && r.step === step && r.hash.startsWith(h12)), cwd);
}

// The first line of a text that isn't blank, trimmed, as sameWords reads it.
const firstLineOf = (text) => sameWords(String(text)).split('\n').map((l) => l.trim()).find((l) => l !== '') ?? '';

// The asked record of the nearest folder holding `cwd` whose question's first non-blank line is the asked card's, newest;
// null when there is none. For naming how a card setup asked differs from the one a click was on.
export function askedLike({ cwd, card }) {
  const asked = shownCard(card);
  if (typeof cwd !== 'string' || asked === null) return null;
  const line = firstLineOf(asked.question);
  let names;
  try {
    names = fs.readdirSync(askedDir()).filter((n) => n.endsWith('.json'));
  } catch {
    return null;
  }
  return nearestNewest(names.map((n) => readAsked(path.join(askedDir(), n))).filter((r) => r !== null && firstLineOf(r.card.question) === line), cwd);
}

// An asked record kept in setup/asked/, or null when the file isn't one.
export function readAsked(file) {
  try {
    const r = JSON.parse(fs.readFileSync(file, 'utf8'));
    return r && RUN_ID.test(String(r.runId)) && Number.isInteger(r.step) && SETUP_QUESTION_ID.test(String(r.id))
      && typeof r.folder === 'string' && typeof r.typed === 'boolean' && shownCard(r.card) !== null ? r : null;
  } catch {
    return null;
  }
}

// The question a setup step asked, in a folder holding `cwd`, on the card the director was shown,
// read as sameWords reads it (`card`, the question AskUserQuestion was given: its text, header and each option's
// label and description): the asked record { runId, folder, step, id, card, typed, at }, or null.
// When several were asked on that very card, the one of the nearest folder holding `cwd` is
// taken, as the helper places a folder, and of those the one asked last.
export function askedFor({ cwd, card }) {
  const asked = shownCard(card);
  if (typeof cwd !== 'string' || asked === null) return null;
  const same = cardKey(card);
  let names;
  try {
    names = fs.readdirSync(askedDir()).filter((n) => n.endsWith('.json'));
  } catch {
    return null;
  }
  const found = names.map((n) => readAsked(path.join(askedDir(), n)))
    .filter((r) => r !== null && cardKey(r.card) === same && holds(r.folder, cwd));
  if (found.length === 0) return null;
  const depth = (r) => keyOf(realPath(r.folder) ?? '').length;
  const nearest = Math.max(...found.map(depth));
  return found.filter((r) => depth(r) === nearest).sort((a, b) => Date.parse(a.at) - Date.parse(b.at)).at(-1);
}

// The cards setup showed (the plan card, with its set line) and asked (its own questions) for the folder holding `cwd`, in the
// shape of a waiting card so the card check's matching takes them: { card: { id, data }, decided: null, setup: true }. Only the
// records of `runId` when given, else of the newest run in the nearest folder holding `cwd`. Ids are `setup:<run>-<step>` and
// `setup:<run>-<step>-<id>`. Never throws: a folder that can't be read gives [].
export function setupCardsFor(cwd, runId) {
  try {
    if (typeof cwd !== 'string') return [];
    const read = (dir, reader) => {
      let names = [];
      try {
        names = fs.readdirSync(dir).filter((n) => n.endsWith('.json'));
      } catch { /* none kept */ }
      return names.map((n) => reader(path.join(dir, n))).filter((r) => r !== null && holds(r.folder, cwd));
    };
    let shown = read(shownDir(), readShown);
    let asked = read(askedDir(), readAsked);
    const all = [...shown, ...asked];
    let run = RUN_ID.test(String(runId)) ? runId : null;
    if (run === null) {
      if (all.length === 0) return [];
      const depth = (r) => keyOf(realPath(r.folder) ?? '').length;
      const nearest = Math.max(...all.map(depth));
      run = all.filter((r) => depth(r) === nearest).sort((a, b) => Date.parse(a.at) - Date.parse(b.at)).at(-1).runId;
    }
    shown = shown.filter((r) => r.runId === run);
    asked = asked.filter((r) => r.runId === run);
    const make = (id, c) => ({
      card: { id, data: { question: c.question, header: c.header, options: c.options.map((o) => o.label), descriptions: c.options.map((o) => o.description) } },
      decided: null,
      setup: true,
    });
    return [
      ...shown.map((r) => make(`setup:${r.runId}-${r.step}`, shownCard(r.card))),
      ...asked.map((r) => make(`setup:${r.runId}-${r.step}-${r.id}`, shownCard(r.card))),
    ];
  } catch {
    return [];
  }
}

// ---- Uninstall's card and click (ruling R90) ----

// Where uninstall's card shown for a folder is kept: one file per folder, named by the SHA-256 of its
// real path (case and accents folded as the system folds them), so a name with spaces or accents,
// or a long one, makes a plain file name. A folder that can't be read is named by the path as given.
export function uninstallShownFile(folder) {
  const key = keyOf(realPath(folder) ?? path.resolve(String(folder)));
  return path.join(shownDir(), `uninstall-${crypto.createHash('sha256').update(key).digest('hex').slice(0, 16)}.json`);
}
const UNINSTALL_SHOWN = /^uninstall-[0-9a-f]{16}\.json$/;

// Uninstall's shown record kept in setup/shown/, { project, folder, hash, card, at }, or null when
// the file isn't one.
export function readUninstallShown(file) {
  try {
    const r = JSON.parse(fs.readFileSync(file, 'utf8'));
    return r && isLineName(r.project) && HASH.test(String(r.hash)) && typeof r.folder === 'string' && typeof r.at === 'string'
      && shownCard(r.card) !== null ? r : null;
  } catch {
    return null;
  }
}

// Keeps the director's signed Remove it on uninstall's card, under a name of its time, computer and
// id, never over another.
export function keepUninstallClick(event) {
  if (event?.kind !== 'action' || event.data?.action !== 'uninstall' || !event.sig) throw new Error('Only a signed uninstall click is kept here');
  if (typeof event.at !== 'string' || !EVENT_ID.test(String(event.id)) || !/^[0-9a-f]{8}$/.test(String(event.computer))) {
    throw new Error('An uninstall click needs its time, its id and its computer');
  }
  const file = path.join(clicksDir(), `${event.at.replaceAll(':', '-')}_${event.computer}_uninstall_${event.id}.json`);
  writeWhole(file, `${JSON.stringify(event, null, 2)}\n`, { exclusive: true });
  return file;
}

// Uninstall's card shown for a folder holding `cwd`, naming `project`, whose list's hash starts with
// `h12`, on a card the director saw as shown, read as sameWords reads it (`card`, the question AskUserQuestion was given):
// { project, folder, hash }. Null when there is none, or two different lists. Of several, the
// nearest folder's is taken, as the helper places a folder.
export function shownUninstall({ cwd, project, h12, card }) {
  const asked = shownCard(card);
  if (typeof cwd !== 'string' || !isLineName(project) || !/^[0-9a-f]{12}$/.test(String(h12)) || asked === null) return null;
  const same = cardKey(card);
  let names;
  try {
    names = fs.readdirSync(shownDir()).filter((n) => UNINSTALL_SHOWN.test(n));
  } catch {
    return null;
  }
  const found = names.map((n) => readUninstallShown(path.join(shownDir(), n)))
    .filter((r) => r !== null && r.project === project && r.hash.startsWith(h12) && cardKey(r.card) === same && holds(r.folder, cwd));
  if (new Set(found.map((r) => r.hash)).size !== 1) return null;
  const depth = (r) => keyOf(realPath(r.folder) ?? '').length;
  const nearest = Math.max(...found.map(depth));
  const chosen = found.filter((r) => depth(r) === nearest).sort((a, b) => Date.parse(a.at) - Date.parse(b.at)).at(-1);
  return { project: chosen.project, folder: chosen.folder, hash: chosen.hash };
}

// ---- Kept answers, and the rule for a typed one ----

// Every event kept in one of setup's folders on this computer; a file that isn't one is passed over.
export function keptIn(dir) {
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

// Made on this computer and signed by its enrolled key.
export const ownSigned = (e, me, enrolled) => e.computer === me && e.sig?.computer === me && EVENT_ID.test(String(e.id)) && verify(e, enrolled);

// This run's setup-answers kept here, made on this computer and signed by its enrolled key, oldest
// first.
export function keptAnswers(runId) {
  if (!RUN_ID.test(String(runId))) return [];
  const enrolled = readEnrolled();
  const me = computerId();
  return keptIn(answersDir()).filter((e) => e.kind === 'action' && e.data?.action === 'setup-answer' && e.data.runId === runId
    && Number.isFinite(Date.parse(e.at)) && ownSigned(e, me, enrolled)).sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
}

// A typed answer that is no answer at first sight (ruling R125): a question (it ends with "?"), or,
// alone, words that hand the choice back. Case and closing punctuation don't count, so "you
// decide?" hands the choice back: it is never a question to be taken when typed again (R132). A
// text with no letter or digit in it ("?", "...") is no answer at all, and hands it back too (R143).
export const HANDED_BACK = Object.freeze(['you decide', 'you choose', 'not sure', 'i don\'t know', 'skip', 'whatever']);
export function handedBack(text) {
  if (typeof text !== 'string') return false;
  if (!/[\p{L}\p{N}]/u.test(text)) return true;
  const plain = text.trim().replace(/[.!?\s]+$/u, '').replace(/\s+/gu, ' ').replaceAll('\u2019', '\'').toLowerCase();
  return HANDED_BACK.includes(plain);
}
export function notAnAnswer(text) {
  return typeof text === 'string' && (text.trim().endsWith('?') || handedBack(text));
}

// Why a typed answer on a setup card is not taken, or null when it is (rulings R125, R132): the
// choice handed back, every time ('handedBack'); a question, the first time on its question only
// ('question'). `earlier` are the texts typed before it on that question, in the same words, oldest
// first. The one rule, read by the engine for what counts and by the prompt record before it records
// anything an answer writes (ruling R137).
export function typedVerdict(text, earlier = []) {
  if (handedBack(text)) return 'handedBack';
  if (notAnAnswer(text) && !earlier.some((t) => !handedBack(t) && notAnAnswer(t))) return 'question';
  return null;
}

// The texts typed before on a question of a run, in the same words, as this computer kept them,
// oldest first: what typedVerdict reads as `earlier`.
export function typedBefore({ runId, step, questionId, question }) {
  return keptAnswers(runId).filter((e) => e.data.step === step && e.data.questionId === questionId && e.data.question === question
    && e.data.label === null && typeof e.data.text === 'string' && e.data.text !== '').map((e) => e.data.text);
}
