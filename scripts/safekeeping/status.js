// scripts/safekeeping/status.js
// If this computer were lost today, what would go with it? (spec 8.2). Pure: the readings go in and the status comes out, in the
// words of the spec's state table, with no agent, no model and no tokens. It isn't an alarm and it isn't a to-do: `watch` asks for
// no answer and holds nothing up, and a project is safe the moment the reading clears.
const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const HOSTS = { github: 'GitHub', gitlab: 'GitLab' };
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

const CHOOSE = { action: 'choose-folder', label: 'Choose a backup folder' };
const CHOOSE_OTHER = { action: 'choose-folder', label: 'Choose another folder' };
const BACK_UP = { action: 'back-up-now', label: 'Back up now' };
const KEEP_ONLINE = { action: 'keep-online', label: 'Keep a copy online' };
const ASK_SAVE = { action: 'ask-save', label: 'Ask the First Mate to save them' };
const BRING_UP = { action: 'bring-up', label: 'Bring my folder up to date' };
const TRY_AGAIN = { action: 'try-again', label: 'Try again' };

const PRIVATE_LINE = 'Your cards and clicks stay on this computer on every project, so only a backup of the computer, such as Time Machine, keeps those.';

const changes = (n) => `${n} ${n === 1 ? 'change' : 'changes'}`;
const age = (at, now) => now.getTime() - Date.parse(at);
const dayStart = (date) => new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
const daysSince = (at, now) => Math.round((dayStart(now) - dayStart(new Date(at))) / DAY_MS);

// "today", "yesterday" or "9 days ago", by the calendar here.
function dayWords(at, now) {
  const days = daysSince(at, now);
  if (days <= 0) return 'today';
  return days === 1 ? 'yesterday' : `${days} days ago`;
}

// "just now", "5 minutes ago" or "3 hours ago".
function syncedWords(at, now) {
  const minutes = Math.floor(age(at, now) / (60 * 1000));
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} ${minutes === 1 ? 'minute' : 'minutes'} ago`;
  const hours = Math.floor(minutes / 60);
  return `${hours} ${hours === 1 ? 'hour' : 'hours'} ago`;
}

// "Tuesday" within the week, then "23 October".
function sinceWords(at, now) {
  const date = new Date(at);
  return daysSince(at, now) < 7 ? WEEKDAYS[date.getDay()] : `${date.getDate()} ${MONTHS[date.getMonth()]}`;
}

function result(readings, { level, line, detail, actions = [] }) {
  const picked = readings.backup?.pickRefused;
  const lead = typeof picked === 'string' ? `The folder you picked wasn't kept: ${picked}. ` : '';
  return { place: readings.place, level, line, detail: `${lead}${detail} ${PRIVATE_LINE}`, actions: actions.slice(0, 2), readAt: readings.readAt ?? null };
}

// A backup taken at `at`, with `behind` changes since, the oldest of them `oldest`.
function fromBackup({ at, behind, oldest }, { days, now, actions, what = 'the backup' }) {
  if (behind === 0) {
    return { level: 'safe', line: `Backed up ${dayWords(at, now)}, up to date`, detail: `Everything merged is in ${what}; work still being built is only here.`, actions };
  }
  const stale = typeof oldest === 'string' && age(oldest, now) >= days * DAY_MS;
  return {
    level: stale ? 'watch' : 'safe',
    line: stale ? `Last backup ${dayWords(at, now)}, ${changes(behind)} since` : `Backed up ${dayWords(at, now)}, ${changes(behind)} since`,
    detail: `The ${changes(behind)} merged since ${what} would be lost, with any work still being built.`,
    actions,
  };
}

const STALE_MS = 2 * 60 * 60 * 1000;
const NO_DATE = { level: 'safe', line: 'Time Machine is on', detail: 'Time Machine keeps this computer, so its drive holds the project, though it isn\'t known how recently.' };

function localStatus(readings, { days, now }) {
  const { backup, timeMachine } = readings;
  if (backup.failed) {
    return result(readings, { level: 'watch', line: 'Your last backup couldn\'t be checked', detail: 'The last good backup is still in place, and what merged since it would be lost.', actions: [BACK_UP, CHOOSE_OTHER] });
  }
  const held = typeof backup.at === 'string' && backup.refused === null;
  const machine = timeMachine?.on === true;
  const dated = machine && typeof timeMachine.last === 'string';
  if (held && (backup.behind === 0 || !machine)) return result(readings, fromBackup(backup, { days, now, actions: [BACK_UP, CHOOSE_OTHER].filter(() => backup.behind > 0) }));
  if (dated && (!held || Date.parse(timeMachine.last) >= Date.parse(backup.at))) {
    const actions = held ? [BACK_UP, CHOOSE_OTHER] : [CHOOSE];
    return result(readings, fromBackup({ at: timeMachine.last, behind: timeMachine.behind ?? 0, oldest: timeMachine.oldest ?? null }, { days, now, actions, what: 'Time Machine\'s last backup' }));
  }
  if (held && dated) return result(readings, fromBackup(backup, { days, now, actions: [BACK_UP, CHOOSE_OTHER] }));
  if (machine) return result(readings, { ...NO_DATE, actions: held ? [BACK_UP, CHOOSE_OTHER] : [CHOOSE] });
  const why = typeof backup.refused === 'string' ? `${backup.refused}, so it doesn't count. ` : '';
  return result(readings, { level: 'watch', line: 'Only on this computer, no backup', detail: `${why}The whole project would be lost with this computer.`, actions: [CHOOSE] });
}

function hostedStatus(readings, { hereDays, now }) {
  const host = HOSTS[readings.place] ?? readings.place;
  const { reachedAt, triedSince, behind, onlyHere } = readings;
  const lastSeen = reachedAt ?? triedSince;
  if (reachedAt === null || age(lastSeen, now) >= DAY_MS) {
    return result(readings, {
      level: age(lastSeen, now) >= DAY_MS ? 'watch' : 'safe',
      line: `Couldn't reach ${host} since ${sinceWords(lastSeen, now)}`,
      detail: `What reached ${host} before then is safe, and what has changed since can't be told.`,
      actions: [TRY_AGAIN],
    });
  }
  const here = onlyHere.commits + onlyHere.uncommitted;
  if (here > 0) {
    const stale = typeof onlyHere.since === 'string' && age(onlyHere.since, now) >= hereDays * DAY_MS;
    const lines = onlyHere.branches.length > 0 ? ` Keep a copy online sends ${onlyHere.branches.join(', ')} to ${host}, under keep/.` : '';
    return result(readings, {
      level: stale ? 'watch' : 'safe',
      line: stale ? `${changes(here)} only on this computer, for ${daysSince(onlyHere.since, now)} days` : `On ${host}, ${changes(here)} only on this computer`,
      detail: `The ${changes(here)} only here would be lost.${lines}`,
      actions: [...(onlyHere.commits > 0 ? [KEEP_ONLINE] : []), ...(onlyHere.uncommitted > 0 ? [ASK_SAVE] : [])],
    });
  }
  if (behind > 0) {
    return result(readings, { level: 'safe', line: `On ${host}, your folder is ${changes(behind)} behind`, detail: `Everything is on ${host}, so nothing would be lost.`, actions: [BRING_UP] });
  }
  return result(readings, { level: 'safe', line: `On ${host}, up to date, synced ${syncedWords(reachedAt, now)}`, detail: `Everything is on ${host}, so nothing would be lost.` });
}

// safekeeping(readings, { days, hereDays, now }) -> { place, level, line, detail, actions, readAt }. `level` is 'safe' or 'watch',
// `actions` up to two of { action, label }. `now` is a Date or a function giving one.
export function safekeeping(readings, { days = 7, hereDays = 3, now = () => new Date() } = {}) {
  const at = typeof now === 'function' ? now() : now;
  return readings.place === 'local' ? localStatus(readings, { days, now: at }) : hostedStatus(readings, { hereDays, now: at });
}

// A look that couldn't read the project.
export function notRead({ place, now }) {
  return result({ place, readAt: now.toISOString() }, { level: 'watch', line: 'Couldn\'t check this project', detail: 'What would be lost with this computer isn\'t known until it can be read.', actions: [TRY_AGAIN] });
}

// A status no look has renewed in two hours, with the helper down or All stop on, says so instead of what it last found.
export function staleStatus(status, { now }) {
  const read = Date.parse(status.readAt);
  if (Number.isNaN(read) || now.getTime() - read < STALE_MS) return status;
  return result({ place: status.place, readAt: status.readAt }, { level: 'watch', line: `Not checked since ${sinceWords(status.readAt, now)}`, detail: 'What it last found may no longer hold.', actions: [TRY_AGAIN] });
}
