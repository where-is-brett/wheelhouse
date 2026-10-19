// scripts/lib/setup-clicks.js
// The prompt record's side of setup's clicks and answers (scripts/setup/clicks.js says how they
// are kept): keeping a signed click in <wheelhouseHome()>/setup/clicks/ and a signed answer in
// setup/answers/, and finding the card setup showed, in setup/shown/, or asked, in setup/asked/,
// that a click was on. It lives apart from scripts/setup/ so the prompt record, which the mod's
// bridge imports, reaches nothing there (scripts/mod/validate.js, bridgeImports). It writes only
// the click and answer files; it never writes Claude Code's settings or setup's journal.
import fs from 'node:fs';
import path from 'node:path';
import { wheelhouseHome } from './paths.js';

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

// What a card shows the director, in one form: its text, header, and each option's label and
// description; null when it isn't a card.
export function shownCard(card) {
  if (!card || typeof card !== 'object' || typeof card.question !== 'string' || card.question === '' || !Array.isArray(card.options)) return null;
  const text = (x) => (typeof x === 'string' ? x : null);
  if (card.options.some((o) => typeof o?.label !== 'string')) return null;
  return { question: card.question, header: text(card.header), options: card.options.map((o) => ({ label: o.label, description: text(o.description) })) };
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
// card the director saw exactly as shown (`card`, the question AskUserQuestion was given):
// { runId, hash }, the run it was shown for and the list's full hash. Null when there is none, or
// two different lists. When several runs showed that very card (every list that changes nothing
// has one hash), the run of the nearest folder holding `cwd` is taken, as the helper places a
// folder, and of those the card shown last.
export function shownHash({ cwd, step, h12, card }) {
  const asked = shownCard(card);
  if (typeof cwd !== 'string' || !/^[0-9a-f]{12}$/.test(String(h12)) || asked === null) return null;
  const same = JSON.stringify(asked);
  let names;
  try {
    names = fs.readdirSync(shownDir()).filter((n) => n.endsWith('.json'));
  } catch {
    return null;
  }
  const found = names.map((n) => readShown(path.join(shownDir(), n)))
    .filter((r) => r !== null && r.step === step && r.hash.startsWith(h12) && JSON.stringify(shownCard(r.card)) === same && holds(r.folder, cwd));
  if (new Set(found.map((r) => r.hash)).size !== 1) return null;
  const depth = (r) => keyOf(realPath(r.folder) ?? '').length;
  const nearest = Math.max(...found.map(depth));
  const chosen = found.filter((r) => depth(r) === nearest).sort((a, b) => Date.parse(a.at) - Date.parse(b.at)).at(-1);
  return { runId: chosen.runId, hash: chosen.hash };
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

// The question a setup step asked, in a folder holding `cwd`, on exactly the card the director
// was shown (`card`, the question AskUserQuestion was given: its text, header and each option's
// label and description): the asked record { runId, folder, step, id, card, typed, at }, or null.
// When several were asked on that very card, the one of the nearest folder holding `cwd` is
// taken, as the helper places a folder, and of those the one asked last.
export function askedFor({ cwd, card }) {
  const asked = shownCard(card);
  if (typeof cwd !== 'string' || asked === null) return null;
  const same = JSON.stringify(asked);
  let names;
  try {
    names = fs.readdirSync(askedDir()).filter((n) => n.endsWith('.json'));
  } catch {
    return null;
  }
  const found = names.map((n) => readAsked(path.join(askedDir(), n)))
    .filter((r) => r !== null && JSON.stringify(shownCard(r.card)) === same && holds(r.folder, cwd));
  if (found.length === 0) return null;
  const depth = (r) => keyOf(realPath(r.folder) ?? '').length;
  const nearest = Math.max(...found.map(depth));
  return found.filter((r) => depth(r) === nearest).sort((a, b) => Date.parse(a.at) - Date.parse(b.at)).at(-1);
}
