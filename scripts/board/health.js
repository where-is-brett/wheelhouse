// scripts/board/health.js
// How a project stands, in lines the board and the briefing show: STOP, the
// protection level, the connection, the build-commands level on Windows, CI, the
// approvals that ask again without Chrome, the lock, the helper, the key's renewal,
// setup's push test when it didn't reach the phone, and the front desk's model. What only the
// host knows (protection, CI) comes from a cache kept for a day, so reading never
// waits on the host.
import fs from 'node:fs';
import path from 'node:path';
import { computerId, stateDir } from '../lib/paths.js';
import { readConfig } from '../gate/guardrails.js';
import { findBrowser as realFindBrowser, isChrome } from '../screens/browser.js';
import { readSmallText } from '../hooks/kit.js';
import { WINDOWS_LINE, UNATTENDED_LINE, GUARDED_LINE, LOCKED_UNATTENDED_LINE, LOCKED_WOULD_LINE } from '../lib/platform-lines.js';
import { HELPER_WAIT_MS, HOST_FACTS_MAX_AGE_MS } from '../lib/core-numbers.js';
import { FREE_PLAN_LINE, fakedTestsGap } from '../host/protection.js';
import { NO_HELPER } from '../hooks/session-start.js';
import { helperClient } from '../host/helper-client.js';
import { QUICK_LINE, switchedLine, keyRefusedLine, keyMissingLine, wakeFailureLine } from '../lib/host-lines.js';
import { frontDeskModelLine } from '../lib/front-desk-model.js';

// The All stop line starts with these words, alone or followed by ", since <date>". A line from
// before the halt switch was called All stop starts with OLD_STOP_LINE, and counts as its own too.
export const STOP_LINE = 'All stop is on';
export const OLD_STOP_LINE = 'STOP is on';
// Whether a health line's words are the All stop line, in either wording.
export const isStopText = (text) => [STOP_LINE, OLD_STOP_LINE].some((lead) => text === lead || String(text).startsWith(`${lead}, `));

// Whose own line a health line is, read before its words are made plain: STOP's, an open
// incident's (by the incident the board names on it), or neither (null).
export function ownLineOf(line) {
  if (typeof line?.incident === 'string') return 'incident';
  const text = String(line?.text);
  return isStopText(text) ? 'stop' : null;
}
export const SAFEKEEPING_LEAD = 'Safekeeping: ';
// How many of the health lines are broken: at stop level and not STOP's own, which is the
// director's doing, not a fault. The pane's verdict and the briefing's count them the same way.
export const brokenCount = (lines) => (Array.isArray(lines) ? lines : []).filter((l) => l?.level === 'stop' && ownLineOf(l) !== 'stop').length;
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
const CI = ['present', 'none', 'here', 'unknown'];
const PLANS = ['free', 'premium', 'unknown'];
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
  // On GitLab the helper also says the plan and the gaps it could read, in plain words.
  const more = {};
  if (PLANS.includes(found.plan)) more.plan = found.plan;
  if (Array.isArray(found.gaps)) more.gaps = found.gaps.filter((g) => typeof g === 'string' && g !== '' && g.length <= 400).slice(0, 20);
  return { protection: found.protection, ci: found.ci, ...more };
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

// The board's lines about Wheelhouse's own version and its updates (design 2026-11-04-update-command-design.md, section 14),
// from scripts/update/board.js's updateFacts. The version line, with the date for a week after an update; the part-way lines
// and a refresh left, at watch since they wait on the director; a project naming a release this computer lacks; a newer
// release and an old helper still answering, which are calm.
export function updateLines(update) {
  if (update === null || typeof update !== 'object') return [];
  const lines = [];
  const day = dayMonthYear(update.updatedAt);
  if (typeof update.version === 'string') lines.push({ level: 'ok', text: `Wheelhouse ${update.version}${day ? ` (updated ${day})` : ''}` });
  if (typeof update.newer === 'string') lines.push({ level: 'ok', text: `${update.newer} is out; type /wheelhouse:update when you want it` });
  const part = update.partway;
  if (part && typeof part.tag === 'string') {
    const tail = { merge: 'is waiting for its change to merge', idle: 'is waiting for work in progress to finish', stopped: 'stopped: type /wheelhouse:update to carry on' }[part.kind];
    if (tail) lines.push({ level: 'watch', text: `Wheelhouse's update to ${part.tag} ${tail}` });
  }
  if (update.refresh && typeof update.refresh.tag === 'string') {
    const left = typeof update.refresh.left === 'string' && update.refresh.left !== '' ? update.refresh.left : 'one refresh';
    lines.push({ level: 'watch', text: `Wheelhouse ${update.refresh.tag} is installed, but ${left} is left: type /wheelhouse:update to finish it` });
  }
  if (update.mismatch) {
    lines.push({ level: 'watch', text: `This project names ${update.mismatch.names} but this computer has ${update.mismatch.has}: type /wheelhouse:update to try again` });
  }
  if (typeof update.oldHelper === 'string') lines.push({ level: 'ok', text: `An older Wheelhouse helper (${update.oldHelper}) is still answering; the new one takes over when it is idle` });
  return lines;
}

// The lines for the board, in order. Each is { level: 'ok' | 'watch' | 'stop', text }. `builds` is
// buildsShown's reading for this computer, { level, lockedUnattended }; missing, it shows nothing.
// `screens` is readScreens'; only pages listed and Chrome not found bring its line. `phonePush`
// is setup's push test as this computer's journal last recorded it, { arrived, at }
// (scripts/lib/setup-run.js, phonePushResult); only `arrived: false` adds a line.
export function healthLines({ record, locked, stop, lock, helperUp, facts, renewal, keyRenewal, ownFiles, hostApproval, platform = process.platform, realUsers, builds, screens, phonePush, frontDeskModel, safekeeping, agentSandbox, watcher, update, now = new Date() } = {}) {
  const lines = [];
  const add = (level, text) => lines.push({ level, text });

  if (stop?.on) {
    const since = dayMonthYear(stop.at);
    add('stop', since ? `${STOP_LINE}, since ${since}` : STOP_LINE);
  }
  add('ok', locked ? 'Protection: Locked' : 'Protection: Standard');
  for (const line of updateLines(update)) add(line.level, line.text);
  if (!locked && realUsers && platform === 'darwin') add('watch', LOCKED_WOULD_LINE);
  // Quick is the Mac's default, since the sandbox denies its sign-in files and the keychain (check 73),
  // so it brings no line there; on Windows, where nothing does, it is a calm note (design section 22).
  if (record?.connection?.mode === 'quick' && platform !== 'darwin') add('ok', QUICK_LINE);
  // The host's tool stopped starting and the helper moved the project to the host's web API by itself (adapter-for.js).
  if (record?.connection?.backend === 'rest' && record.connection.switched === 'cli') add('watch', switchedLine(record.host));
  if (platform === 'win32') {
    add('watch', WINDOWS_LINE);
    if (builds?.level === 'unattended') add('watch', UNATTENDED_LINE);
    else if (builds?.level === 'guarded') add('ok', GUARDED_LINE);
    if (builds?.lockedUnattended === true) add('watch', LOCKED_UNATTENDED_LINE);
  }
  if (facts?.protection === 'none') add('watch', FREE_PLAN_LINE);
  // GitLab: a project with real users whose plan is not Premium, and each gap the helper read.
  const faked = realUsers ? fakedTestsGap(facts?.plan) : null;
  if (faked) add('watch', faked);
  for (const gap of facts?.gaps ?? []) add('watch', gap);
  if (facts?.ci === 'none') add('watch', 'This project has no CI, so nothing can merge');
  if (facts?.ci === 'here') add('ok', 'Checks run on this computer');
  if (screens?.pages === true && screens.chrome === false) add('ok', NO_CHROME_LINE);
  if (lock && lock.computer !== computerId()) add('watch', 'Another computer holds this project, so this one is read-only');
  if (helperUp === false) add('watch', NO_HELPER);
  // Wakes that keep failing leave approved work waiting, so it is a broken thing, not a quiet one.
  const wakes = wakeFailureLine(watcher, now);
  if (wakes !== null) add('stop', wakes);
  // The agent's sandbox on this computer, { level, text }, from the agent's adapter (sandboxLine); none for an agent without one.
  if (typeof agentSandbox?.text === 'string' && ['ok', 'watch'].includes(agentSandbox.level)) add(agentSandbox.level, agentSandbox.text);
  // The host refused the key (401), or there is none: setup's step 3 raises the key card.
  if (renewal?.key === 'refused') add('watch', keyRefusedLine(record?.host));
  else if (renewal?.key === 'missing') add('watch', keyMissingLine(record?.host));
  if (renewal?.due) {
    const on = dayMonthYear(renewal.on);
    add('watch', on ? `Renew the host key by ${on}` : 'Renew the host key soon');
  }
  // A new signing key after a risky period (scripts/state/key-renewal.js): it is made only on the director's click on its card.
  if (keyRenewal?.due) add('watch', `A new signing key is due: ${keyRenewal.why}`);
  // The weekly look at Wheelhouse's own files and the guard files of the agent it runs (scripts/health/own-files.js).
  if (typeof ownFiles?.line === 'string') add('watch', ownFiles.line);
  // A version move the director's approved update explains is a calm line, one to a row, and no watch line (design section 8).
  if (typeof ownFiles?.calm === 'string') for (const row of ownFiles.calm.split('\n').filter((r) => r !== '')) add('ok', row);
  // A project that needs your own approval on GitHub to merge (scripts/host/host-approval.js).
  if (hostApproval === true) add('ok', 'Merging needs your own approval on GitHub');
  if (phonePush?.arrived === false) add('watch', phonePushLine(phonePush.at));
  // The front desk on another model than setup pinned for it (design section 8).
  const model = frontDeskModelLine(frontDeskModel ?? {});
  if (model) add('watch', model);
  // What would be lost with this computer (spec 8.2): always there, with its detail on the Logbook, and at watch it joins what
  // is to watch. It is marked, since the briefing says it only when it turns, and asks for nothing.
  if (typeof safekeeping?.line === 'string') lines.push({ level: safekeeping.level === 'watch' ? 'watch' : 'ok', text: `${SAFEKEEPING_LEAD}${safekeeping.line}`, detail: safekeeping.detail, safekeeping: true });
  return lines;
}
