// scripts/hooks/prompt-record.js
// Turns the director's clicks on a card into records. Every answer is kept as a
// plain card-answer. A click on one of the card's own buttons, on a card that
// holds the exact line, also becomes a signed approval, confirmation or action.
// Only this hook signs. Each signed record is written to
// projects/<project>/pending/ before it is sent and removed once the helper has
// it, so a hook cut short by its time limit loses nothing; the next session
// start sends what is left. A confirmation of a setting in the director's
// profile goes to the profile; the answer itself still goes to the project.
// A card carrying one set line and its reply code also gets a signed shown record,
// so a later reply with that code (scripts/mod/reply.js) can count as the click.
// A Go ahead on a setup card becomes a signed setup action kept in
// <wheelhouseHome()>/setup/clicks/, where the helper reads it, since there may be no state to
// record it in yet (Task 13 copies the clicks into the state). In a folder being set up (no
// project record yet: kit.js's beingSetUp) that is the one click recorded, and nothing else is.
import fs from 'node:fs';
import path from 'node:path';
import { runAndExit, projectOf, beingSetUp } from './kit.js';
import { keep, taken, sendPending, withinBudget, BUDGET_MS } from './pending.js';
import { helperClient } from '../host/helper-client.js';
import { liftStop as defaultLift, stopState as defaultStopState } from '../lib/stop.js';
import { profileDir, stateDir, computerId } from '../lib/paths.js';
import { makeEvent, listEvents, confirmationFor, dataHash, CONFIRMABLE_KINDS } from '../state/events.js';
import {
  approvalLine, confirmLine, LIFT_STOP, runbookLine, RUNBOOK_TITLES, ciPushLine,
  approveWorkLine, answerLine, amendLine, liftIncidentLine, incidentFixLine, unattendedBuildsLine, ID, LANES, QUESTION_ID,
} from '../state/card-lines.js';
import { setLineOf, setLinesOf, replyCode, replyCodeLine, setupLine, SETUP_LABEL, SETUP_TITLES } from '../state/card-lines.js';
import { keepClick, shownHash } from '../lib/setup-clicks.js';
import { localViews } from './session-start.js';
import { REPLY_CODE_DAYS } from '../lib/core-numbers.js';
import { PUT_OFF } from '../lib/front-desk.js';
import { settingKey, UNATTENDED_CARD, USE_GUARDED } from '../protection/windows-builds.js';
import { startedAsScript } from '../lib/started-as-script.js';

const DAY = 24 * 60 * 60 * 1000;
const SHA12 = '([0-9a-f]{12})(?![0-9a-fA-F])';
const APPROVE = new RegExp(`Approve pull request #([1-9][0-9]*) at commit ${SHA12}`, 'g');
const APPROVE_WORK = new RegExp(`Approve (${ID}) \\((${LANES}) lane\\) as written, ${SHA12}(, and show it to me before it merges)?`, 'g');
const ANSWER = new RegExp(`Answer question (${QUESTION_ID})(?![a-z0-9-])`, 'g');
const AMEND = new RegExp(`Change the approved (${ID}) to this, ${SHA12}`, 'g');
const LIFT_INCIDENT = new RegExp(`End incident (${ID}) and let merges carry on`, 'g');
const INCIDENT_FIX = new RegExp(`Merge pull request #([1-9][0-9]*) as the fix for incident (${ID})(?![a-z0-9-])`, 'g');
const SETUP = new RegExp(`Set up step ([0-9]{1,2}) as listed, ${SHA12}`, 'g');
const CI_PUSH = new RegExp(`Push the CI change on (\\S+) at commit ${SHA12} with your own sign-in`, 'g');

function ciEntry(project, branch, sha12, now) {
  try {
    const all = JSON.parse(fs.readFileSync(path.join(stateDir(project), '..', 'ci-pending.json'), 'utf8'));
    const entry = Object.hasOwn(all, branch) ? all[branch] : null;
    if (!entry || entry.branch !== branch || typeof entry.sha !== 'string' || !/^[0-9a-f]{40}$/.test(entry.sha)) return null;
    if (!entry.sha.startsWith(sha12)) return null;
    const age = now().getTime() - Date.parse(entry.at);
    return age >= 0 && age < DAY ? entry : null;
  } catch {
    return null;
  }
}

// The one runbook line a question holds, or null when it holds none, more than
// one, or one whose commit does not read as twelve lowercase hex characters.
function runbookOf(question) {
  if ((question.match(/Runbook step \d/g) ?? []).length !== 1) return null;
  for (const step of Object.keys(RUNBOOK_TITLES).map(Number)) {
    const base = runbookLine(step);
    const at = question.indexOf(base);
    if (at < 0) continue;
    if (question.indexOf(base, at + 1) >= 0) return null;
    const rest = question.slice(at + base.length);
    let sha;
    if (rest.startsWith(', to commit')) {
      const tail = new RegExp(`^, to commit ${SHA12}`).exec(rest);
      if (!tail) return null;
      sha = tail[1];
    }
    if (step === 3 && sha === undefined) return null;
    return { step, sha };
  }
  return null;
}

// The only match of a global pattern, or null when there are none or several.
function only(pattern, text) {
  const all = [...text.matchAll(pattern)];
  return all.length === 1 ? all[0] : null;
}

// The deciding labels a reply code can answer with. A reply to an answer card may also use any
// of the question's own options (scripts/mod/reply.js), which earned checks against the question.
// Turn on (dangerous) and Use Guarded earn a record from a click alone, by design.
export const SIGNED_LABELS = ['Approve', 'Confirm', 'Lift STOP', 'Do it', 'Push it', 'Change it', 'End it', 'Merge the fix'];

// The events of one kind that the state holds, oldest first.
function held(project, kind) {
  return listEvents(stateDir(project), { report: () => {} }).filter((e) => e.kind === kind);
}

// The record a click on an answer card earns: the question must be one the state
// holds and the label one of its options.
function answerOf(project, question, label) {
  if (PUT_OFF.includes(label)) return null;
  const m = only(ANSWER, question);
  if (!m || !question.includes(answerLine(m[1]))) return null;
  const asked = held(project, 'question').filter((e) => e.data?.id === m[1]).at(-1);
  const options = Array.isArray(asked?.data?.options) ? asked.data.options : [];
  return options.some((o) => o?.label === label) ? { action: 'answer', questionId: m[1], questionHash: dataHash(asked.data) } : null;
}

// The record a click on a work card earns: the card's lane and hash must be the latest work event's.
function approveWorkOf(project, question, match) {
  const [, work, lane, h12, shown] = match;
  const shownFirst = shown !== undefined;
  if (!question.includes(approveWorkLine(work, lane, h12, { shownFirst }))) return null;
  const latest = held(project, 'work').filter((e) => e.data?.id === work).at(-1);
  const hash = latest?.data?.doc?.hash;
  if (latest?.data?.lane !== lane || typeof hash !== 'string' || !hash.startsWith(h12)) return null;
  return { action: 'approve-work', work, lane, hash, shownFirst };
}

// The one full hash of a proposed change that the card's twelve characters name, or null.
function amendmentHash(project, work, h12) {
  const all = new Set(held(project, 'amendment')
    .filter((e) => e.data?.work === work && typeof e.data?.hash === 'string' && e.data.hash.startsWith(h12))
    .map((e) => e.data.hash));
  return all.size === 1 ? [...all][0] : null;
}

const declared = (project, id) => held(project, 'incident').some((e) => e.data?.id === id);

// Works out the signed record a click earns, if any. May ask the helper for a
// pull request's head. Returns { made, profile?, lift? }, or null. A Lift STOP earns nothing
// while STOP is off, so an old card's click or reply code can't stand for a later STOP. A reply
// passes `shownAt`, when its card was shown: its Lift STOP earns a record only when the card was
// shown after this STOP began, so a code from a card about an earlier STOP can't lift a later one.
export async function earned({ project, question, label, client, now, left, stopState = defaultStopState, shownAt }) {
  const action = (data) => ({ made: { kind: 'action', data: { ...data, question, label } } });
  // A card with an answer line is a question card: its buttons are answers, whatever else it says.
  if (question.includes('Answer question q-')) {
    const answer = answerOf(project, question, label);
    return answer ? action(answer) : null;
  }
  if (label === 'Approve') {
    const prs = [...question.matchAll(APPROVE)];
    const works = [...question.matchAll(APPROVE_WORK)];
    if (prs.length + works.length !== 1) return null;
    if (works.length === 1) {
      const record = approveWorkOf(project, question, works[0]);
      return record ? action(record) : null;
    }
    const m = prs[0];
    if (!question.includes(approvalLine(m[1], m[2]))) return null;
    const pr = Number(m[1]);
    const state = await left(client.prState({ project, number: pr }));
    const head = state?.result?.headSha;
    if (state?.ok === true && state.result?.state === 'open' && /^[0-9a-f]{40}$/.test(head ?? '') && head.startsWith(m[2])) {
      return { made: { kind: 'approval', data: { pr, commit: head, words: 'Approve', question } } };
    }
    return null;
  }
  if (label === 'Confirm') {
    // A line may name an event in the project's state or in the director's profile; one
    // that names events in both, or several, records nothing.
    const named = (dir) => listEvents(dir, { report: () => {} })
      .filter((e) => CONFIRMABLE_KINDS.includes(e.kind) && question.includes(confirmLine(e)));
    const found = named(stateDir(project));
    const inProfile = named(profileDir());
    if (found.length + inProfile.length !== 1) return null;
    return found.length === 1 ? { made: confirmationFor(found[0]) } : { made: confirmationFor(inProfile[0]), profile: true };
  }
  if (label === 'Turn on (dangerous)') {
    // The Unattended card for build commands on Windows: it says the design's words on the risk,
    // its line names one setting event, written on this computer for this computer, and the
    // confirmation carries the line, so the level counts Unattended from this card alone.
    if (!question.includes(UNATTENDED_CARD().risk)) return null;
    const computer = computerId();
    const found = held(project, 'setting').filter((e) => e.computer === computer && e.data?.key === settingKey(computer)
      && e.data?.value === 'unattended' && question.includes(unattendedBuildsLine(e.id, computer)));
    if (found.length !== 1) return null;
    const { kind, data } = confirmationFor(found[0]);
    return { made: { kind, data: { ...data, line: unattendedBuildsLine(found[0].id, computer) } } };
  }
  if (label === USE_GUARDED) {
    // Use Guarded on the Unattended card (ruling 22): the card carries exactly one confirm line,
    // for a setting event proposing Guarded, written on this computer for this computer, and the
    // click confirms that event as Confirm would, with no line, so the level counts Guarded (once
    // this computer's self-test passes).
    const confirms = setLinesOf(question).filter((line) => line.startsWith('Confirm '));
    if (confirms.length !== 1) return null;
    const computer = computerId();
    const found = held(project, 'setting').filter((e) => e.computer === computer && e.data?.key === settingKey(computer)
      && e.data?.value === 'guarded' && confirmLine(e) === confirms[0]);
    return found.length === 1 ? { made: confirmationFor(found[0]) } : null;
  }
  if (label === 'Lift STOP') {
    const stop = stopState();
    if (!question.includes(LIFT_STOP) || !stop.on) return null;
    if (shownAt !== undefined && !(Date.parse(shownAt) > Date.parse(stop.at))) return null;
    return { ...action({ action: 'lift-stop' }), lift: true };
  }
  if (label === 'Do it') {
    const found = runbookOf(question);
    return found ? action({ action: 'runbook', step: found.step, ...(found.sha ? { sha: found.sha } : {}) }) : null;
  }
  if (label === 'Push it') {
    const m = only(CI_PUSH, question);
    if (!m || !question.includes(ciPushLine(m[1], m[2]))) return null;
    const entry = ciEntry(project, m[1], m[2], now);
    return entry ? action({ action: 'ci-push', branch: entry.branch, sha: entry.sha }) : null;
  }
  if (label === 'Change it') {
    const m = only(AMEND, question);
    if (!m || !question.includes(amendLine(m[1], m[2]))) return null;
    const hash = amendmentHash(project, m[1], m[2]);
    return hash ? action({ action: 'amend', work: m[1], hash }) : null;
  }
  if (label === 'End it') {
    const m = only(LIFT_INCIDENT, question);
    if (!m || !question.includes(liftIncidentLine(m[1])) || !declared(project, m[1])) return null;
    return action({ action: 'lift-incident', incident: m[1] });
  }
  if (label === 'Merge the fix') {
    const m = only(INCIDENT_FIX, question);
    if (!m || !question.includes(incidentFixLine(m[2], m[1])) || !declared(project, m[2])) return null;
    return action({ action: 'incident-fix', incident: m[2], pr: Number(m[1]) });
  }
  return null;
}

// The signed record a Go ahead on a setup card earns: the card carries one set line, setup's, and
// is the very card the helper composed for the list its twelve characters name, for the folder
// this session is in, word for word (its text, header and options), so a card reworded around the
// right set line earns nothing.
// The record names the run the card was shown for and that list's full hash, which the helper
// matches against its run for the folder and the list it works out again.
function setupClickOf(cwd, { question, label, card }) {
  if (label !== SETUP_LABEL) return null;
  const m = only(SETUP, question);
  if (!m) return null;
  const step = Number(m[1]);
  if (!Object.hasOwn(SETUP_TITLES, step) || setLineOf(question) !== setupLine(step, m[2])) return null;
  const shown = shownHash({ cwd, step, h12: m[2], card });
  return shown === null ? null : { kind: 'action', data: { action: 'setup', runId: shown.runId, step, hash: shown.hash, question, label } };
}

// Signs each setup click and keeps it in setup/clicks/. One failing does not stop the rest.
function keepSetupClicks(cwd, out, now) {
  for (const click of out) {
    if (!click.signable) continue;
    try {
      const made = setupClickOf(cwd, click);
      if (made) keepClick(makeEvent({ ...made, now }));
    } catch { /* not kept: the helper then refuses the step for want of a click, and the card is asked again */ }
  }
}

// What was answered, and which answers came from a click on a button the card offered.
function clicks(input) {
  const ti = input.tool_input ?? {};
  const answers = ti.answers;
  if (!answers || typeof answers !== 'object' || Array.isArray(answers)) return [];
  const asked = new Map((Array.isArray(ti.questions) ? ti.questions : []).map((q) => [q?.question, q]));
  const echoed = input.tool_response?.answers;
  const echo = echoed && typeof echoed === 'object' && !Array.isArray(echoed) ? echoed : null;
  const out = [];
  for (const [question, raw] of Object.entries(answers)) {
    const many = Array.isArray(raw);
    if (!many && typeof raw !== 'string') continue;
    if (many && !raw.every((x) => typeof x === 'string')) continue;
    const q = asked.get(question);
    const offered = Array.isArray(q?.options) && !many && q.options.some((o) => o?.label === raw);
    const agrees = echo === null || (Object.hasOwn(echo, question) && JSON.stringify(echo[question]) === JSON.stringify(raw));
    out.push({
      question,
      label: many ? raw.join(', ') : raw,
      signable: offered && q.multiSelect !== true && agrees,
      card: q,
    });
  }
  return out;
}

export { sendPending, BUDGET_MS };

// Signs what an answer earned and keeps it pending, then lifts STOP when it asks to; a lift
// that fails leaves no record. Returns what sendKept sends. Shared by a click and a reply code.
export function keepEarned(project, got, { now, liftStop = defaultLift }) {
  const event = makeEvent({ ...got.made, now });
  const route = got.profile ? 'profile-record' : 'record';
  const body = got.profile ? { event } : { project, event };
  const file = keep(project, route, body, now);
  try {
    if (got.lift) liftStop();
  } catch (error) {
    fs.rmSync(file, { force: true });
    throw error;
  }
  return { file, body, route };
}

// Sends one kept record, removing it once the helper has it. True when it was taken.
export async function sendKept(api, left, { file, body, route }) {
  const result = await left(route === 'profile-record' ? api.profile.record(body) : api.state.record(body));
  if (!taken(result)) return false;
  fs.rmSync(file, { force: true });
  return true;
}

// The shown records a card asks for: one for each single-choice question that carries exactly
// one set line and the line with that line's reply code, whatever was clicked, unless the shown
// view already holds the code, live (unspent and in date at `at`), for this question. The
// options are the card's own labels. A Lift STOP card shown again under a STOP that began after
// its held record gets a new one, since a reply lifts STOP only by a card shown after it began.
function shownFor(project, input, at, stopState = defaultStopState) {
  const questions = input.tool_input?.questions;
  if (!Array.isArray(questions)) return [];
  const held = localViews(project, ['shown'])?.shown;
  const out = [];
  for (const q of questions) {
    if (typeof q?.question !== 'string' || q.multiSelect === true || !Array.isArray(q.options)) continue;
    const line = setLineOf(q.question);
    if (line === null) continue;
    const code = replyCode(line);
    const codes = q.question.split(/\r\n|[\n\r\u2028\u2029]/).filter((l) => l.startsWith('Reply code:'));
    if (codes.length !== 1 || codes[0] !== replyCodeLine(code)) continue;
    const was = held && Object.hasOwn(held, code) ? held[code] : null;
    const stop = line === LIFT_STOP ? stopState() : null;
    const beforeStop = stop?.on === true && !(Date.parse(was?.at) > Date.parse(stop.at));
    if (was?.question === q.question && was.spent === false && at.getTime() - Date.parse(was.at) < REPLY_CODE_DAYS * DAY && !beforeStop) continue;
    out.push({ kind: 'shown', data: { code, question: q.question, options: q.options.map((o) => o?.label) } });
  }
  return out;
}

export async function decide(input, { client, now = () => new Date(), projectOf: find = projectOf, dir, budget = BUDGET_MS, liftStop = defaultLift, stopState } = {}) {
  if (input.tool_name !== 'AskUserQuestion') return undefined;
  const found = find(input.cwd, { dir });
  if (!found) {
    if (beingSetUp(input.cwd) !== null) {
      const at = now();
      keepSetupClicks(input.cwd, clicks(input), () => at);
    }
    return undefined;
  }
  const project = found.project;
  const api = client ?? helperClient({ timeout: budget });
  const end = Date.now() + budget;
  const left = withinBudget(end);
  const out = clicks(input);

  // First the signed records, each written down before it is sent. The cards' shown records
  // go first and are dated a millisecond before the clicks, so a record a click earns sorts
  // after its card's shown record and spends the code.
  const queued = [];
  const at = now();
  const clock = () => at;
  const shownAt = new Date(at.getTime() - 1);
  keepSetupClicks(input.cwd, out, clock);
  let cards = [];
  try {
    cards = shownFor(project, input, at, stopState);
  } catch {
    // No reply codes this time; the clicks are still recorded.
  }
  for (const made of cards) {
    try {
      queued.push(keepEarned(project, { made }, { now: () => shownAt, liftStop }));
    } catch {
      // A card whose options a shown record can't hold has no reply code.
    }
  }
  for (const click of out) {
    if (!click.signable) continue;
    try {
      const got = await earned({ project, ...click, client: api, now: clock, left, stopState });
      if (got) queued.push(keepEarned(project, got, { now: clock, liftStop }));
    } catch {
      // One question failing does not stop the rest; a lift that did not happen leaves no record.
    }
  }
  for (const kept of queued) await sendKept(api, left, kept);
  // Then the plain answers. What cannot be sent in time is kept.
  for (const { question, label } of out) {
    const body = { project, kind: 'card-answer', data: { question, label } };
    try {
      const result = await left(api.state.write(body));
      if (!taken(result)) keep(project, 'write', body, now);
    } catch {
      // Not kept twice: a failure here is a failure to write the file too.
    }
  }
  return undefined;
}

if (startedAsScript(import.meta.url)) {
  await runAndExit(decide, { failClosed: false, event: 'PostToolUse' });
}
