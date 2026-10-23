// probes/mac-sitting/lock-watch.mjs
// The locked-screen step without the director saying anything (second sitting). Started by the
// agent once the step before the lock has checked out; from then on it:
//   1. waits for the Mac's screen to lock (ioreg: IOConsoleLocked or CGSSessionScreenIsLocked);
//   2. waits until at least GAP (three minutes) after the director's last action the project can
//      see (last-action.mjs: their records, their typed or phoned prompts and seen.promptAt),
//      and the lock, so Claude's notification comes after a real absence;
//   3. adds the test card (add-card.mjs, which moves lastWakeAt back past the ten-minute gap if a
//      wake set it inside it);
//   4. while locked, logs courier.json's changes every half second (each mark with its stamp and
//      session, each mark taken out again with the seconds from the mark, lastWakeAt), the whole
//      of `sent`, `lastWakeAt` and the sessions' ticks every 15 seconds (the timer while locked),
//      and each PushNotification or ToolSearch call in the session's transcript with its result;
//   5. exits once the screen is unlocked, printing what it saw: the card's wake, the reminder's
//      (remind:<card id>, fix E) if one came, the notifications' answers, and any undo.
// If the screen is unlocked before the card is due, it adds no card and exits 3.
//
//   node lock-watch.mjs [--gap-minutes 3]
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { BASE, COURIER_WATCH_LOG, PROJECT, fromPlugin, readMade, transcriptFolder } from './layout.mjs';
import { changes, readCourier } from './courier-log.mjs';
import { lastAction } from './last-action.mjs';
import { calls, readRows } from './transcript.mjs';

const args = process.argv.slice(2);
const i = args.indexOf('--gap-minutes');
const GAP = (i >= 0 ? Number(args[i + 1]) : 3) * 60 * 1000;
const LOG = path.join(BASE, 'lock-watch.log');
const made = readMade();
if (made === null) throw new Error('Run prepare.mjs first: made.json is missing');
process.env.WHEELHOUSE_HOME = made.home;
const { courierFile } = await fromPlugin('scripts/mod/courier.js');
const COURIER = courierFile(PROJECT);
const TRANSCRIPT = typeof made.devMods?.session === 'string' ? path.join(transcriptFolder(made.folder), `${made.devMods.session}.jsonl`) : null;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const iso = (ms = Date.now()) => new Date(ms).toISOString();
const log = (line) => fs.appendFileSync(LOG, `${iso()} ${line}\n`);
const run = (argv) => execFileSync(process.execPath, argv, { cwd: BASE, encoding: 'utf8' });
const observer = () => {
  try {
    return JSON.parse(`[${run(['check.mjs', 'observer']).trim().split('\n').filter((l) => l.startsWith('{')).join(',')}]`);
  } catch {
    return [];
  }
};

function locked() {
  const xml = execFileSync('ioreg', ['-n', 'Root', '-d1', '-a'], { encoding: 'utf8' });
  return /<key>IOConsoleLocked<\/key>\s*<true\/>/.test(xml) || /<key>CGSSessionScreenIsLocked<\/key>\s*<true\/>/.test(xml);
}

// courier.json's changes since the last look, logged here and in courier-watch.log.
let courier = readCourier(COURIER);
const seen = [];
function lookAtCourier() {
  const next = readCourier(COURIER);
  if (next === null) return;
  const at = iso();
  for (const change of changes(courier, next, at)) {
    const record = { seen: at, ...change };
    seen.push(record);
    fs.appendFileSync(COURIER_WATCH_LOG, `${JSON.stringify(record)}\n`);
    log(`courier ${change.event}: ${JSON.stringify(change)}`);
  }
  courier = next;
}
// The session's notification and tool-search calls since the lock, each logged once.
const logged = new Set();
const pushes = [];
function lookAtTranscript(since) {
  if (TRANSCRIPT === null) return;
  for (const call of calls(readRows(TRANSCRIPT), { pattern: /^(PushNotification|ToolSearch)$/, since })) {
    const key = `${call.at} ${call.name} ${call.result === null ? 'waiting' : 'answered'}`;
    if (logged.has(key)) continue;
    logged.add(key);
    if (call.result !== null) pushes.push(call);
    log(`${call.name} ${call.input} -> ${call.result === null ? '(no result yet)' : `${call.result.error ? 'REFUSED ' : ''}${call.result.text}`}`);
  }
}

log(`started; gap ${GAP / 60000} min; courier ${COURIER}; transcript ${TRANSCRIPT ?? 'none (link.mjs not run)'}`);
log('waiting for the screen to lock');
while (!locked()) await sleep(1000);
const lockedAt = iso();
log(`locked at ${lockedAt}`);

const records = () => {
  try {
    return JSON.parse(run(['check.mjs', 'records']));
  } catch {
    return [];
  }
};
const seenMarks = () => {
  try {
    return JSON.parse(run(['check.mjs', 'seen']));
  } catch {
    return null;
  }
};
const last = lastAction({ records: records(), observer: observer(), seen: seenMarks() });
const due = Math.max(Date.parse(lockedAt), last === null ? 0 : Date.parse(last.at) + GAP);
log(`the director's last action: ${last === null ? 'none seen' : `${last.what} at ${last.at}`}; the card is due at ${iso(due)}`);
let lastFull = 0;
while (Date.now() < due) {
  if (!locked()) {
    log(`unlocked at ${iso()}, before the card was due: no card added`);
    process.stdout.write(fs.readFileSync(LOG, 'utf8'));
    process.exit(3);
  }
  lookAtCourier();
  await sleep(500);
}
let added;
try {
  added = run(['add-card.mjs']).trim();
} catch (error) {
  added = `add-card failed: ${String(error.stdout ?? '').trim()} ${String(error.stderr ?? error.message).trim()}`;
}
log(`add-card: ${added.replace(/\n/g, ' | ')}`);
const cardId = /recorded card (\S+) at (\S+)\./.exec(added);
const cardAt = cardId?.[2] ?? null;
while (locked()) {
  lookAtCourier();
  if (Date.now() - lastFull >= 15000) {
    lastFull = Date.now();
    const now = readCourier(COURIER);
    log(`courier: ${JSON.stringify({ sent: now?.sent ?? null, lastWakeAt: now?.lastWakeAt ?? null, sessions: now?.sessions ?? null })}`);
    lookAtTranscript(lockedAt);
  }
  await sleep(500);
}
const unlockedAt = iso();
lookAtCourier();
lookAtTranscript(lockedAt);
log(`unlocked at ${unlockedAt}`);

const id = cardId?.[1];
const markOf = (prefix) => seen.find((c) => c.event === 'marked' && c.id === `${prefix}:${id}`);
const wake = id === undefined ? undefined : markOf('card');
const remind = id === undefined ? undefined : markOf('remind');
const secondsFrom = (a, b) => (a && b ? Math.round((Date.parse(b) - Date.parse(a)) / 1000) : null);
const summary = {
  lockedAt, unlockedAt, lastAction: last, cardDueAt: iso(due), card: id ?? null, cardAt,
  wake: wake ? { at: wake.at, by: wake.by, secondsAfterCard: secondsFrom(cardAt, wake.at) } : null,
  reminder: remind ? { at: remind.at, by: remind.by, secondsAfterWake: secondsFrom(wake?.at, remind.at) } : null,
  notifications: pushes.filter((c) => c.name === 'PushNotification').map((c) => ({ at: c.at, input: c.input, result: c.result.text, refused: c.result.error })),
  toolSearches: pushes.filter((c) => c.name === 'ToolSearch').map((c) => ({ at: c.at, input: c.input, refused: c.result.error })),
  undone: seen.filter((c) => c.event === 'undone').map(({ id: undoneId, at, by, seconds }) => ({ id: undoneId, markedAt: at, by, seconds })),
};
log(`summary: ${JSON.stringify(summary)}`);
process.stdout.write(`${JSON.stringify(summary, null, 2)}\nlog ${LOG}\n`);
