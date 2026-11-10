// scripts/agents/copilot/usage.js
// Copilot's use and the month (Copilot return design, sections 4 and 5, build part 8). Copilot is counted in requests
// against a monthly allowance that resets on the 1st, and the pace is the design's three steps (section 5.4):
//
//   nudge    at the Usage nudge's share of the allowance (75%: 150 of 200). One card; work carries on
//   hold     at 90% (180 of 200). New work isn't started; work in progress finishes its task and stops at a clean point
//   waiting  at 100%, or when GitHub refuses. The piece waits for the month, never as a failure, and resumes on the 1st
//
// Everything here is a pure function of what the caller has read, except the two small files kept under the usage
// folder: `copilot-requests.jsonl` (one line for each run: the session's count at the time, or GitHub's refusal) and
// `copilot-account.json` (the last reading of the account). The figures follow check 96: a resume counts as a request,
// a continuation after a blocked `agentStop` counts, a subagent's turn doesn't; the CLI's own count is cumulative for a
// session across resumes and overstates GitHub's, so GitHub's figure is used where the account reports it, with the
// CLI's count added for the runs since that reading.
import fs from 'node:fs';
import path from 'node:path';
import { usageDir } from '../../lib/paths.js';
import { composeCard } from '../../cards/compose.js';

// The share of the allowance at which new work is held, and at which Copilot waits for the month.
export const HOLD_AT = 90;
export const WAIT_AT = 100;
// The Usage nudge's default share, when the setting can't be read.
export const NUDGE_AT = 75;
// The allowance on the director's plan (Copilot Student), when neither the account nor the setting gives one.
export const DEFAULT_ALLOWANCE = 200;

export const STEPS = Object.freeze(['none', 'nudge', 'hold', 'waiting']);
// What Wheelhouse may start at each step, by kind of work.
export const WORK_KINDS = Object.freeze(['new', 'continue', 'review-critical', 'wake']);

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

const isRecord = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isCount = (v) => typeof v === 'number' && Number.isFinite(v) && v >= 0;
const msOf = (t) => (typeof t === 'function' ? msOf(t()) : new Date(t ?? Date.now()).getTime());
const round = (v) => Math.round(v * 1000) / 1000;

// The month in GitHub's terms: it resets on the 1st, at midnight UTC.
export function monthOf(now) {
  const d = new Date(msOf(now));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}
export const monthStartMs = (now) => { const d = new Date(msOf(now)); return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1); };
export const nextResetMs = (now) => { const d = new Date(msOf(now)); return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1); };
// "1 December 2026".
export function resetWords(now) {
  const d = new Date(nextResetMs(now));
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

// What the CLI's last output line (`type: result`) says of the session's use: { session, requests, exitCode }, or null.
// `requests` is the session's count so far, across resumes.
export function resultOf(output) {
  const lines = typeof output === 'string' ? output.split('\n') : Array.isArray(output) ? output : [];
  for (const line of [...lines].reverse()) {
    let parsed = line;
    if (typeof line === 'string') {
      if (!line.trim()) continue;
      try { parsed = JSON.parse(line); } catch { continue; }
    }
    if (isRecord(parsed) && parsed.type === 'result') {
      const requests = parsed.usage?.premiumRequests;
      return {
        session: typeof parsed.sessionId === 'string' ? parsed.sessionId : null,
        requests: isCount(requests) ? requests : null,
        exitCode: Number.isInteger(parsed.exitCode) ? parsed.exitCode : null,
      };
    }
  }
  return null;
}

// The model Auto chose, from the run's output (`session.auto_mode_resolved`), or null.
export function modelOf(output) {
  const lines = typeof output === 'string' ? output.split('\n') : Array.isArray(output) ? output : [];
  for (const line of lines) {
    let parsed = line;
    if (typeof line === 'string') {
      try { parsed = JSON.parse(line); } catch { continue; }
    }
    if (isRecord(parsed) && parsed.type === 'session.auto_mode_resolved' && typeof parsed.data?.chosenModel === 'string') return parsed.data.chosenModel;
  }
  return null;
}

// What the account says, from `gh api /copilot_internal/user`: { at, remaining, entitlement, resetDate }, or null when it
// holds no remaining figure. `entitlement` is null when the account gives none.
export function accountOf(reply, at) {
  if (!isRecord(reply)) return null;
  const snapshot = isRecord(reply.quota_snapshots?.premium_interactions) ? reply.quota_snapshots.premium_interactions : {};
  const remaining = [reply.quota_remaining, snapshot.remaining, snapshot.quota_remaining].find(isCount);
  if (remaining === undefined) return null;
  const entitlement = [snapshot.entitlement, reply.entitlement].find((v) => isCount(v) && v > 0);
  const time = new Date(at ?? Date.now()).getTime();
  if (Number.isNaN(time)) return null;
  const reset = typeof reply.quota_reset_date === 'string' ? reply.quota_reset_date : null;
  return { at: new Date(time).toISOString(), remaining, entitlement: entitlement ?? null, resetDate: reset };
}

// ---- the two files ----

const ledgerFile = (dir) => path.join(dir, 'copilot-requests.jsonl');
const accountFile = (dir) => path.join(dir, 'copilot-account.json');

function readLines(dir) {
  let text;
  try { text = fs.readFileSync(ledgerFile(dir), 'utf8'); } catch { return []; }
  const lines = [];
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    try {
      const parsed = JSON.parse(line);
      if (isRecord(parsed) && !Number.isNaN(Date.parse(parsed.at))) lines.push(parsed);
    } catch { /* a torn line is skipped */ }
  }
  return lines;
}

// Records a session's count after a run: `requests` is the session's cumulative count (resultOf).
export function recordRun({ at, session, requests, model = null, dir = usageDir() }) {
  if (typeof session !== 'string' || !/^[A-Za-z0-9._-]{1,128}$/.test(session)) throw new Error("A Copilot run's use needs the session's id");
  if (!isCount(requests)) throw new Error("A Copilot run's use needs a count of requests");
  const time = new Date(at ?? Date.now()).toISOString();
  fs.mkdirSync(dir, { recursive: true });
  fs.appendFileSync(ledgerFile(dir), `${JSON.stringify({ at: time, session, requests, ...(typeof model === 'string' ? { model } : {}) })}\n`);
}

// Records that GitHub refused a Copilot session because the month's allowance is gone.
export function recordRefusal({ at, session = null, dir = usageDir() }) {
  const time = new Date(at ?? Date.now()).toISOString();
  fs.mkdirSync(dir, { recursive: true });
  fs.appendFileSync(ledgerFile(dir), `${JSON.stringify({ at: time, refused: true, ...(typeof session === 'string' ? { session } : {}) })}\n`);
}

export function recordAccount(account, { dir = usageDir() } = {}) {
  if (!isRecord(account) || !isCount(account.remaining)) throw new Error('An account reading needs the requests remaining');
  fs.mkdirSync(dir, { recursive: true });
  const file = accountFile(dir);
  const temp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temp, `${JSON.stringify(account, null, 2)}\n`);
  fs.renameSync(temp, file);
}

export function readAccount({ dir = usageDir() } = {}) {
  try {
    const value = JSON.parse(fs.readFileSync(accountFile(dir), 'utf8'));
    return isRecord(value) && isCount(value.remaining) && !Number.isNaN(Date.parse(value.at)) ? value : null;
  } catch { return null; }
}

// Drops lines older than the start of last month; the month needs none of them.
export function pruneLedger({ now, dir = usageDir() } = {}) {
  const d = new Date(monthStartMs(now));
  const floor = Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - 1, 1);
  const lines = readLines(dir);
  const kept = lines.filter((line) => Date.parse(line.at) >= floor);
  if (kept.length === lines.length) return 0;
  fs.writeFileSync(ledgerFile(dir), kept.map((line) => `${JSON.stringify(line)}\n`).join(''));
  return lines.length - kept.length;
}

export const readLedger = ({ dir = usageDir() } = {}) => readLines(dir);

// ---- the month ----

// Requests the ledger's lines add in the month of `now`, counting only lines after `after` (a time) when given. A
// session's count is cumulative, so a line adds what it has over the session's last count; a count that falls is a new
// session count from zero. The last count before the month starts is the session's base.
export function requestsIn(lines, now, after = null) {
  const start = monthStartMs(now);
  const end = nextResetMs(now);
  const floor = after === null ? start : Math.max(start, msOf(after));
  const bySession = new Map();
  for (const line of lines) {
    if (!isRecord(line) || typeof line.session !== 'string' || !isCount(line.requests) || line.refused === true) continue;
    const at = Date.parse(line.at);
    if (Number.isNaN(at) || at >= end) continue;
    if (!bySession.has(line.session)) bySession.set(line.session, []);
    bySession.get(line.session).push({ at, requests: line.requests });
  }
  let total = 0;
  for (const runs of bySession.values()) {
    runs.sort((a, b) => a.at - b.at);
    let previous = 0;
    for (const run of runs) {
      const delta = run.requests >= previous ? run.requests - previous : run.requests;
      previous = run.requests;
      if (run.at >= floor) total += delta;
    }
  }
  return round(total);
}

// Whether GitHub refused a session in the month of `now`.
export function refusedIn(lines, now) {
  const start = monthStartMs(now);
  const end = nextResetMs(now);
  return lines.some((line) => isRecord(line) && line.refused === true && Date.parse(line.at) >= start && Date.parse(line.at) < end);
}

// The account's reading, when it belongs to the month of `now`.
function currentAccount(account, now) {
  if (!isRecord(account) || !isCount(account.remaining)) return null;
  const at = Date.parse(account.at);
  return !Number.isNaN(at) && at >= monthStartMs(now) && at < nextResetMs(now) && at <= msOf(now) + 60 * 60 * 1000 ? account : null;
}

// monthState({ lines, account, allowance, mark, now }) -> the month as the briefing, the cards and the gate read it:
//   { month, used, allowance, share, step, source, resetsAt, resets, line }
// `lines` is the ledger, `account` the last account reading (accountOf), `allowance` the copilotAllowance setting and
// `mark` the Usage nudge ('off' or a percentage). The account's figure is used where it is this month's, with the CLI's
// count added for runs after the reading; otherwise the CLI's count stands alone. The allowance is the account's own
// entitlement where it reports one, else the setting.
export function monthState({ lines = [], account = null, allowance = DEFAULT_ALLOWANCE, mark = NUDGE_AT, now } = {}) {
  const current = currentAccount(account, now);
  const total = current !== null && isCount(current.entitlement) ? current.entitlement : isCount(allowance) && allowance > 0 ? allowance : DEFAULT_ALLOWANCE;
  let used;
  let source;
  if (current !== null) {
    used = round(Math.max(0, total - current.remaining) + requestsIn(lines, now, current.at));
    source = 'github';
  } else {
    used = requestsIn(lines, now);
    source = 'count';
  }
  const share = (used / total) * 100;
  const refused = refusedIn(lines, now);
  let step = 'none';
  if (refused || share >= WAIT_AT) step = 'waiting';
  else if (share >= HOLD_AT) step = 'hold';
  else if (mark !== 'off' && Number.isFinite(mark) && share >= mark) step = 'nudge';
  const shown = Math.floor(used);
  return {
    month: monthOf(now), used, allowance: total, share: round(share), step, source, refused,
    resetsAt: new Date(nextResetMs(now)).toISOString(), resets: resetWords(now),
    line: `Copilot: ${shown} of ${total} this month`,
  };
}

// ---- the cards ----

export const NUDGE_FINISH = 'Finish what\'s started, then hold';
export const NUDGE_CARRY = 'Carry on as now';
export const NUDGE_HOLD = 'Hold new work until the 1st';
export const HOLD_KEEP = 'Keep holding until the 1st';
export const HOLD_ALLOW = 'Let new work start anyway';
export const WAIT_FOR = 'Wait for the 1st';
export const WAIT_MOVE = 'Use Claude Code meanwhile';
// What a pick of an option sets, for the gate: `carry` (nothing held), `finish` (no new work; what's started carries on)
// and `hold` (no new work).
export const CHOICES = Object.freeze({ [NUDGE_FINISH]: 'finish', [NUDGE_CARRY]: 'carry', [NUDGE_HOLD]: 'hold', [HOLD_KEEP]: 'hold', [HOLD_ALLOW]: 'carry' });
export const choiceOf = (label) => (Object.hasOwn(CHOICES, label) ? CHOICES[label] : null);

const figures = (state) => `${Math.floor(state.used)} of this month's ${state.allowance} requests`;

const WHY = 'It is the month\'s allowance on your plan, and only you choose how it is spent.';

function cardInput(card, state) {
  if (card === 'nudge') {
    return {
      kind: 'question', level: 3, ask: 'Copilot is using up the month: what now?',
      what: `Copilot has used ${figures(state)}. The month resets on ${state.resets}.`,
      why: WHY,
      options: [
        { label: NUDGE_FINISH, says: 'New work is held back; what is already started finishes.' },
        { label: NUDGE_CARRY, says: 'Everything carries on as now, until the next step at 90%.' },
        { label: NUDGE_HOLD, says: 'No new Copilot work starts until the 1st; what is started stops at a clean point.' },
      ],
      recommend: NUDGE_FINISH,
      because: 'it keeps what is half-built from being left unfinished, and keeps some of the month for reviews',
      meanwhile: 'Work in progress carries on.',
    };
  }
  if (card === 'hold') {
    return {
      kind: 'question', level: 3, ask: 'Copilot is nearly out for the month: hold new work?',
      what: `Copilot has used ${figures(state)}, so new work isn't being started. Work in progress finishes its current task and stops at a clean point, with its worktree and commits kept. The month resets on ${state.resets}.`,
      why: WHY,
      options: [
        { label: HOLD_KEEP, says: `No new Copilot work starts until ${state.resets}.` },
        { label: HOLD_ALLOW, says: 'New work starts again, and may use up what is left of the month.' },
      ],
      recommend: HOLD_KEEP,
      because: 'the last requests keep the reviews of risky work possible',
      meanwhile: 'What is started stops at a clean point. STOP, the cards and the helper carry on.',
    };
  }
  return {
    kind: 'question', level: 3, ask: 'Copilot is waiting for the month',
    what: `All of this month's ${state.allowance} Copilot requests are used, so GitHub has stopped Copilot work. Every piece is kept as it is and carries on from what's there on ${state.resets}.`,
    why: WHY,
    options: [
      { label: WAIT_FOR, says: `Copilot work waits and carries on from what's there on ${state.resets}.` },
      { label: WAIT_MOVE, says: 'This computer\'s crew moves to Claude Code until you say otherwise. Pieces already begun stay as they are.' },
    ],
    recommend: WAIT_FOR,
    because: 'nothing is lost by waiting and nothing is charged: extra use is off on your plan',
    meanwhile: 'STOP, the cards and the helper carry on. The First Mate\'s chat in VS Code stops too, so the helper\'s window shows this card as well.',
  };
}

// monthCard({ state, offers, now }) -> null, or { card, input, record }. At most one card, and each of the three once a
// month: `offers` is the records so far ({ card, month }). A month that jumps past a step skips its card (a hold card
// follows a nudge, but a hold with no nudge before it offers the hold card alone). `input` is composeCard's.
export function monthCard({ state, offers = [], now }) {
  if (!isRecord(state) || !['nudge', 'hold', 'waiting'].includes(state.step)) return null;
  const offered = (card) => Array.isArray(offers) && offers.some((o) => isRecord(o) && o.card === card && o.month === state.month);
  if (offered(state.step)) return null;
  const input = cardInput(state.step, state);
  composeCard(input);
  return { card: state.step, input, record: { card: state.step, month: state.month, at: new Date(msOf(now)).toISOString() } };
}

// ---- the gate ----

// mayStart({ state, choice, kind }) -> { ok, why }. `kind` is one of WORK_KINDS: `new` (a piece not begun), `continue`
// (a task of a piece already begun), `review-critical` (a reviewer of critical work, which keeps its reviewer at every
// setting while a request is left) and `wake` (a foreman wake that needs a Copilot session). `choice` is what the
// director picked on the nudge or hold card (choiceOf), or null.
export function mayStart({ state, choice = null, kind }) {
  if (!WORK_KINDS.includes(kind)) throw new Error(`Copilot work is one of ${WORK_KINDS.join(', ')}`);
  if (!isRecord(state) || !['nudge', 'hold', 'waiting'].includes(state.step)) return { ok: true, why: null };
  const yes = { ok: true, why: null };
  if (state.step === 'waiting') return { ok: false, why: `Copilot is waiting for the month, which resets on ${state.resets}` };
  // A reviewer of critical work keeps its place while a request is left (design section 5.3).
  if (kind === 'review-critical') return state.used + 1 <= state.allowance ? yes : { ok: false, why: `Copilot has no request left until ${state.resets}, so the review waits` };
  const held = `Copilot is held for the month, which resets on ${state.resets}`;
  if (state.step === 'hold') {
    if (choice === 'carry') return yes;
    // Work in progress finishes its current task and stops at a clean point.
    if (kind === 'continue' && choice !== 'hold') return { ok: true, why: null, finishThenStop: true };
    return { ok: false, why: held };
  }
  // The nudge: nothing is held until the director picks.
  if (choice === 'hold') return { ok: false, why: held };
  if (choice === 'finish' && kind === 'new') return { ok: false, why: held };
  return yes;
}

// What GitHub says when the month's allowance is gone: the words are not yet seen from a real refusal (check 96 did not
// reach one), so this reads a reply by what it says of a limit, and trial stage T3 or the first real refusal confirms or
// corrects it.
export const MONTH_REFUSAL = /\bno (?:more|remaining) (?:premium )?requests?\b|\b(?:quota|allowance|premium requests?|monthly limit|usage limit)\b[^.\n]{0,80}\b(?:exceed(?:ed)?|reached|used up|exhausted|no (?:more|remaining))\b|\b(?:exceed(?:ed)?|reached|exhausted)\b[^.\n]{0,40}\b(?:quota|allowance|premium requests?|monthly limit)\b/i;
export const isMonthRefusal = (text) => typeof text === 'string' && MONTH_REFUSAL.test(text);
