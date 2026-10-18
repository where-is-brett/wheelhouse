// scripts/hooks/prompt-record.js
// Turns the director's clicks on a card into records. Every answer is kept as a
// plain card-answer. A click on one of the card's own buttons, on a card that
// holds the exact line, also becomes a signed approval, confirmation or action.
// Only this hook signs. Each signed record is written to
// projects/<project>/pending/ before it is sent and removed once the helper has
// it, so a hook cut short by its time limit loses nothing; the next session
// start sends what is left.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { runAndExit, projectOf } from './kit.js';
import { keep, taken, sendPending, withinBudget, BUDGET_MS } from './pending.js';
import { helperClient } from '../host/helper-client.js';
import { liftStop as defaultLift } from '../lib/stop.js';
import { stateDir } from '../lib/paths.js';
import { makeEvent, listEvents, confirmationFor, CONFIRMABLE_KINDS } from '../state/events.js';
import { approvalLine, confirmLine, LIFT_STOP, runbookLine, RUNBOOK_TITLES, ciPushLine } from '../state/card-lines.js';

const DAY = 24 * 60 * 60 * 1000;
const SHA12 = '([0-9a-f]{12})(?![0-9a-fA-F])';
const APPROVE = new RegExp(`Approve pull request #([1-9][0-9]*) at commit ${SHA12}`, 'g');
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

// Works out the signed record a click earns, if any. May ask the helper for a
// pull request's head. Returns { made, undo? }, or null.
async function earned({ project, question, label, client, now, left }) {
  if (label === 'Approve') {
    const m = only(APPROVE, question);
    if (!m || !question.includes(approvalLine(m[1], m[2]))) return null;
    const pr = Number(m[1]);
    const state = await left(client.prState({ project, number: pr }));
    const head = state?.result?.headSha;
    if (state?.ok === true && state.result?.state === 'open' && /^[0-9a-f]{40}$/.test(head ?? '') && head.startsWith(m[2])) {
      return { made: { kind: 'approval', data: { pr, commit: head, words: 'Approve', question } } };
    }
    return null;
  }
  if (label === 'Confirm') {
    const found = listEvents(stateDir(project), { report: () => {} })
      .filter((e) => CONFIRMABLE_KINDS.includes(e.kind) && question.includes(confirmLine(e)));
    return found.length === 1 ? { made: confirmationFor(found[0]) } : null;
  }
  const action = (data) => ({ made: { kind: 'action', data: { ...data, question, label } } });
  if (label === 'Lift STOP') {
    return question.includes(LIFT_STOP) ? { ...action({ action: 'lift-stop' }), lift: true } : null;
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
  return null;
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
    });
  }
  return out;
}

export { sendPending, BUDGET_MS };

export async function decide(input, { client, now = () => new Date(), projectOf: find = projectOf, dir, budget = BUDGET_MS, liftStop = defaultLift } = {}) {
  if (input.tool_name !== 'AskUserQuestion') return undefined;
  const found = find(input.cwd, { dir });
  if (!found) return undefined;
  const project = found.project;
  const api = client ?? helperClient({ timeout: budget });
  const end = Date.now() + budget;
  const left = withinBudget(end);
  const out = clicks(input);

  // First the signed records, each written down before it is sent.
  const queued = [];
  for (const click of out) {
    if (!click.signable) continue;
    let file = null;
    try {
      const got = await earned({ project, ...click, client: api, now, left });
      if (!got) continue;
      const body = { project, event: makeEvent({ ...got.made, now }) };
      file = keep(project, 'record', body, now);
      if (got.lift) liftStop();
      queued.push({ file, body });
    } catch {
      // One question failing does not stop the rest; a lift that did not happen leaves no record.
      if (file) fs.rmSync(file, { force: true });
    }
  }
  for (const { file, body } of queued) {
    const result = await left(api.state.record(body));
    if (taken(result)) fs.rmSync(file, { force: true });
  }
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

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await runAndExit(decide, { failClosed: false, event: 'PostToolUse' });
}
