// scripts/board/health.js
// How a project stands, in lines the board and the briefing show: STOP, the
// protection level, the connection, CI, the lock, the helper, the key's renewal
// and the profile. What only the host knows (protection, CI) comes from a cache
// kept for a day, so reading never waits on the host.
import fs from 'node:fs';
import path from 'node:path';
import { computerId, stateDir } from '../lib/paths.js';
import { WINDOWS_LINE } from '../lib/platform-lines.js';
import { HOST_FACTS_MAX_AGE_MS } from '../lib/core-numbers.js';
import { FREE_PLAN_LINE } from '../host/protection.js';
import { NO_HELPER } from '../hooks/session-start.js';

export const QUICK_LINE = 'Agents act with your full GitHub or GitLab access, across all your projects.';

const HELPER_WAIT_MS = 2000;
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

// Asks the helper, giving up after `waitMs`. Null when it can't say.
async function ask(client, project, waitMs) {
  let timer;
  const late = new Promise((resolve) => { timer = setTimeout(() => resolve(null), waitMs); });
  try {
    const answer = await Promise.race([Promise.resolve().then(() => client.host.facts({ project })), late]);
    return answer?.ok === true ? factsFrom(answer) : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// What the host says about the project: { protection, ci }. From the cache while it
// is under a day old; otherwise asked of the helper (within 2 seconds) and kept. A helper
// that can't answer leaves an older cache in use; with none, the answer is null.
export async function readHostFacts(project, { client, now = () => new Date(), waitMs = HELPER_WAIT_MS } = {}) {
  let file;
  try {
    file = cacheFile(project);
  } catch {
    return null;
  }
  const at = now().getTime();
  const cached = readCache(file);
  if (cached && cached.at <= at && at - cached.at < HOST_FACTS_MAX_AGE_MS) return cached.facts;
  const asked = await ask(client, project, waitMs);
  if (asked) {
    writeCache(file, at, asked);
    return asked;
  }
  return cached?.facts ?? null;
}

// The lines for the board, in order. Each is { level: 'ok' | 'watch' | 'stop', text }.
export function healthLines({ record, locked, stop, lock, helperUp, facts, renewal, profile, platform = process.platform, realUsers } = {}) {
  const lines = [];
  const add = (level, text) => lines.push({ level, text });

  if (stop?.on) {
    const since = dayMonthYear(stop.at);
    add('stop', since ? `STOP is on, since ${since}` : 'STOP is on');
  }
  add('ok', locked ? 'Protection: Locked' : 'Protection: Standard');
  if (!locked && realUsers && platform === 'darwin') add('watch', 'This project has real users: Locked would protect it more');
  if (record?.connection?.mode === 'quick') add('watch', QUICK_LINE);
  if (platform === 'win32') add('watch', WINDOWS_LINE);
  if (facts?.protection === 'none') add('watch', FREE_PLAN_LINE);
  if (facts?.ci === 'none') add('watch', 'This project has no CI, so nothing can merge');
  if (lock && lock.computer !== computerId()) add('watch', 'Another computer holds this project, so this one is read-only');
  if (helperUp === false) add('watch', NO_HELPER);
  if (renewal?.due) {
    const on = dayMonthYear(renewal.on);
    add('watch', on ? `Renew the host key by ${on}` : 'Renew the host key soon');
  }
  if (!profile) add('watch', 'Your profile isn\'t backed up off this computer yet');
  return lines;
}
