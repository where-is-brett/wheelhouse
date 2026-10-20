// scripts/board/health.js
// How a project stands, in lines the board and the briefing show: STOP, the
// protection level, the connection, the build-commands level on Windows, CI, the
// approvals that ask again without Chrome, the lock, the helper, the key's renewal,
// setup's push test when it didn't reach the phone, and the profile. What only the
// host knows (protection, CI) comes from a cache kept for a day, so reading never
// waits on the host.
import fs from 'node:fs';
import path from 'node:path';
import { computerId, stateDir } from '../lib/paths.js';
import { readConfig } from '../gate/guardrails.js';
import { findBrowser as realFindBrowser, isChrome } from '../screens/browser.js';
import { readSmallText } from '../hooks/kit.js';
import { WINDOWS_LINE, UNATTENDED_LINE, GUARDED_LINE, LOCKED_UNATTENDED_LINE } from '../lib/platform-lines.js';
import { HELPER_WAIT_MS, HOST_FACTS_MAX_AGE_MS } from '../lib/core-numbers.js';
import { FREE_PLAN_LINE } from '../host/protection.js';
import { NO_HELPER } from '../hooks/session-start.js';
import { helperClient } from '../host/helper-client.js';
import { QUICK_LINE } from '../lib/host-lines.js';

// The STOP line starts with these words, alone or followed by ", since <date>".
export const STOP_LINE = 'STOP is on';
// The quick connection's line, shared with setup's step 3 (scripts/lib/host-lines.js).
export { QUICK_LINE };
// An approval carries over an update only when the pages look the same in Chrome's pictures
// (check 34; rulings F61, F66, F74), so without Chrome each update after an approval asks again.
export const NO_CHROME_LINE = 'Google Chrome isn\'t on this computer, so a change you approved asks for your click again once it is brought up to date; installing Chrome stops that';

// Setup's push test didn't reach the phone (step 9, ruling R39), on the day it was recorded, `at`
// (none when it doesn't read as a date). Claude skips a push while the director is at the
// computer (check 4), so the line says so, with what to check, the second push option among it.
export function phonePushLine(at) {
  const on = dayMonthYear(at);
  return `Setup's test notification didn't reach your phone${on ? ` on ${on}` : ''}. `
    + 'Claude skips one while you are at the computer; check Remote Control, Push when actions required, and that your phone allows Claude\'s notifications';
}

// After a helper that did not answer in time, the next reading does not wait on it again for this long.
const TRIED_FOR_MS = 10 * 60 * 1000;
const PROTECTION = ['on', 'none', 'unknown'];
const CI = ['present', 'none', 'unknown'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

// "18 October 2026" for a date or a time in UTC, or null when it isn't one.
function dayMonthYear(value) {
  if (typeof value !== 'string') return null;
  const time = Date.parse(value);
  if (Number.isNaN(time)) return null;
  const date = new Date(time);
  return `${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]} ${date.getUTCFullYear()}`;
}

function factsFrom(found) {
  if (!found || typeof found !== 'object') return null;
  if (!PROTECTION.includes(found.protection) || !CI.includes(found.ci)) return null;
  return { protection: found.protection, ci: found.ci };
}

function cacheFile(project) {
  return path.join(stateDir(project), '..', 'host-facts.json');
}

// { at, facts } as kept, or null when there is no cache or it is damaged.
function readCache(file) {
  try {
    const kept = JSON.parse(fs.readFileSync(file, 'utf8'));
    const facts = factsFrom(kept?.facts);
    const at = Date.parse(kept?.at);
    return facts && !Number.isNaN(at) ? { at, facts } : null;
  } catch {
    return null;
  }
}

function writeCache(file, at, facts) {
  const temp = `${file}.${process.pid}.tmp`;
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(temp, `${JSON.stringify({ at: new Date(at).toISOString(), facts })}\n`);
    fs.renameSync(temp, file);
  } catch {
    fs.rmSync(temp, { force: true }); // the answer is still good for this reading
  }
}

function triedFile(project) {
  return path.join(stateDir(project), '..', 'host-facts-tried.json');
}

// Whether the helper was tried, without an answer in time, within the last ten minutes.
function triedLately(file, at) {
  try {
    const tried = Date.parse(JSON.parse(fs.readFileSync(file, 'utf8'))?.at);
    return !Number.isNaN(tried) && tried <= at && at - tried < TRIED_FOR_MS;
  } catch {
    return false;
  }
}

// Asks the helper: { facts } when it answers, { facts: null, late: true } when it did not answer
// within `waitMs`. The client carries the same limit, so a request that is not answered is
// closed and leaves nothing running; the race is a second guard for a client that does not.
async function ask(client, project, waitMs) {
  let timer;
  const late = new Promise((resolve) => { timer = setTimeout(() => resolve('late'), waitMs); });
  try {
    const answer = await Promise.race([Promise.resolve().then(() => client.host.facts({ project })), late]);
    if (answer === 'late') return { facts: null, late: true };
    return { facts: answer?.ok === true ? factsFrom(answer) : null, late: /did not answer in time/.test(String(answer?.refused ?? '')) };
  } catch {
    return { facts: null, late: false };
  } finally {
    clearTimeout(timer);
  }
}

// What the host says about the project: { protection, ci }. From the cache while it
// is under a day old; otherwise asked of the helper (within 2 seconds) and kept. A helper
// that can't answer leaves an older cache in use; with none, the answer is null. A helper that
// was too slow is not waited on again for ten minutes. `client` is for a caller that has its own;
// it should carry the same time limit. With `ask: false` the helper isn't asked, and the cache
// is used whatever its age (the status line, which can't wait).
export async function readHostFacts(project, { client, address, now = () => new Date(), waitMs = HELPER_WAIT_MS, ask: asking = true } = {}) {
  let file;
  let tried;
  try {
    file = cacheFile(project);
    tried = triedFile(project);
  } catch {
    return null;
  }
  const at = now().getTime();
  const cached = readCache(file);
  if (cached && cached.at <= at && at - cached.at < HOST_FACTS_MAX_AGE_MS) return cached.facts;
  if (!asking || triedLately(tried, at)) return cached?.facts ?? null;
  const { facts, late } = await ask(client ?? helperClient({ address, timeout: waitMs }), project, waitMs);
  if (facts) {
    writeCache(file, at, facts);
    fs.rmSync(tried, { force: true });
    return facts;
  }
  if (late) writeCache(tried, at, undefined);
  return cached?.facts ?? null;
}

// What the Chrome line needs: { pages, chrome }, whether the configuration in the project's main
// `folder` lists any page and whether Chrome is on this computer, each null when it can't be told.
export function readScreens({ folder, findBrowser = realFindBrowser } = {}) {
  let pages = null;
  let chrome = null;
  try {
    const text = typeof folder === 'string' && folder !== '' ? readSmallText(path.join(folder, '.claude', 'wheelhouse.json')) : undefined;
    if (text !== undefined) pages = (readConfig(text).pages ?? []).length > 0;
  } catch {
    // A configuration that can't be read lists no page this line can speak for.
  }
  try {
    chrome = isChrome(findBrowser());
  } catch {
    // Nor does a browser that can't be looked for.
  }
  return { pages, chrome };
}

// The lines for the board, in order. Each is { level: 'ok' | 'watch' | 'stop', text }. `builds` is
// buildsShown's reading for this computer, { level, lockedUnattended }; missing, it shows nothing.
// `screens` is readScreens'; only pages listed and Chrome not found bring its line. `phonePush`
// is setup's push test as this computer's journal last recorded it, { arrived, at }
// (scripts/lib/setup-run.js, phonePushResult); only `arrived: false` adds a line.
export function healthLines({ record, locked, stop, lock, helperUp, facts, renewal, profile, platform = process.platform, realUsers, builds, screens, phonePush } = {}) {
  const lines = [];
  const add = (level, text) => lines.push({ level, text });

  if (stop?.on) {
    const since = dayMonthYear(stop.at);
    add('stop', since ? `${STOP_LINE}, since ${since}` : STOP_LINE);
  }
  add('ok', locked ? 'Protection: Locked' : 'Protection: Standard');
  if (!locked && realUsers && platform === 'darwin') add('watch', 'This project has real users: Locked would protect it more');
  if (record?.connection?.mode === 'quick') add('watch', QUICK_LINE);
  if (platform === 'win32') {
    add('watch', WINDOWS_LINE);
    if (builds?.level === 'unattended') add('watch', UNATTENDED_LINE);
    else if (builds?.level === 'guarded') add('ok', GUARDED_LINE);
    if (builds?.lockedUnattended === true) add('watch', LOCKED_UNATTENDED_LINE);
  }
  if (facts?.protection === 'none') add('watch', FREE_PLAN_LINE);
  if (facts?.ci === 'none') add('watch', 'This project has no CI, so nothing can merge');
  if (screens?.pages === true && screens.chrome === false) add('ok', NO_CHROME_LINE);
  if (lock && lock.computer !== computerId()) add('watch', 'Another computer holds this project, so this one is read-only');
  if (helperUp === false) add('watch', NO_HELPER);
  if (renewal?.due) {
    const on = dayMonthYear(renewal.on);
    add('watch', on ? `Renew the host key by ${on}` : 'Renew the host key soon');
  }
  if (phonePush?.arrived === false) add('watch', phonePushLine(phonePush.at));
  if (!profile) add('watch', 'Your profile isn\'t backed up off this computer yet');
  return lines;
}
