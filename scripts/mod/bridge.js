// scripts/mod/bridge.js
// What the mod runs: `node <plugin root>/scripts/mod/bridge.js` through `$.process.run`, with
// one JSON request on standard input. It prints one JSON line, { ok, says? }, and exits 0
// within BRIDGE_MS, whatever the request was. The mod signs nothing and runs no shell; this
// script signs only because the mod's commands run outside the session's sandbox, where the
// signing key can be read (check 32). Run inside the sandbox, by an agent, it can't read the
// key, so it signs nothing and says so.
//
// Nothing in a request is trusted beyond its `origin`, which the mod takes from Claude Code.
// Only `composer` (typed) and `bridge` (phoned) are the director's; `sdk`, `peer` and every
// other origin never count.
//
//   { cmd: 'usage', session, cwd, usd?, windows? }  the session's running cost and the allowance
//   { cmd: 'reply', origin, text, cwd }             a reply code and an option, as the click
//   { cmd: 'go', origin, cwd }                      /go: lifts STOP with a signed record
//   { cmd: 'stop', origin, cwd }                    a phoned "stop": sets STOP
//
// The signed records go through the helper as the prompt record sends its own: kept in
// pending/ first, sent, and removed once the helper has them.
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { replyRecord as defaultReply } from './reply.js';
import { keepEarned, sendKept } from '../hooks/prompt-record.js';
import { withinBudget } from '../hooks/pending.js';
import { projectOf as defaultProjectOf } from '../hooks/kit.js';
import { featureSlug as defaultFeatureSlug } from '../hooks/session-start.js';
import { helperClient } from '../host/helper-client.js';
import { loadBoardInputs } from '../board/inputs.js';
import { recordModReading, recordSession } from '../usage/store.js';
import { stopState as defaultStopState, setStop as defaultSetStop, liftStop as defaultLiftStop } from '../lib/stop.js';
import { LIFT_STOP } from '../state/card-lines.js';

// The whole run, from reading the request to the answer.
export const BRIDGE_MS = 5000;
// How long the helper is waited for, inside BRIDGE_MS.
export const HELPER_MS = 3000;
export const MAX_REQUEST_BYTES = 64 * 1024;
const DIRECTOR = ['composer', 'bridge'];

export const SAYS = {
  unreadable: 'Wheelhouse couldn\'t read that request',
  unknown: 'Wheelhouse doesn\'t know that request',
  failed: 'Wheelhouse couldn\'t do that this time',
  late: 'Wheelhouse couldn\'t do that in time',
  notKept: 'That usage reading couldn\'t be kept',
  notDirector: 'Only the director\'s own messages count',
  notProject: 'This isn\'t a Wheelhouse project',
  goNotDirector: 'Only the director can lift STOP',
  goNotProject: 'This isn\'t a Wheelhouse project, so STOP stays on',
  stopOff: 'STOP isn\'t on.',
  cantSign: 'Wheelhouse couldn\'t sign that here, so STOP stays on',
  cantLift: 'STOP couldn\'t be lifted, so it stays on',
  nothingBuilding: 'No build work is in progress.',
  stopNotPhone: 'Only a message from your phone sets STOP here',
  stopOn: 'STOP is on.',
};

const isRecord = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const no = (says) => ({ ok: false, says });
const fromDirector = (origin) => typeof origin === 'string' && DIRECTOR.includes(origin);

const DEFAULTS = {
  now: () => new Date(),
  projectOf: defaultProjectOf,
  featureSlug: defaultFeatureSlug,
  replyRecord: defaultReply,
  loadInputs: loadBoardInputs,
  stopState: defaultStopState,
  setStop: defaultSetStop,
  liftStop: defaultLiftStop,
};

// The project a full path belongs to, or null.
function placeOf(cwd, d) {
  try {
    return typeof cwd === 'string' && path.isAbsolute(cwd) ? d.projectOf(cwd)?.project ?? null : null;
  } catch {
    return null;
  }
}

function clientOf(d) {
  d.client ??= helperClient({ timeout: HELPER_MS });
  return d.client;
}

// The mod's reading. The store checks the session ID and drops windows it can't read; a cost
// that isn't a number of dollars is left out. What the session is for is written the first time
// only, and only inside a project, marked as the mod's: the session start, which can tell a
// foreman, replaces it once.
async function usage(req, d) {
  const usd = typeof req.usd === 'number' && Number.isFinite(req.usd) && req.usd >= 0 ? req.usd : undefined;
  const windows = Array.isArray(req.windows) ? req.windows.filter(isRecord) : undefined;
  const at = d.now();
  try {
    recordModReading({ session: req.session, usd, windows, at });
  } catch {
    return no(SAYS.notKept);
  }
  const project = placeOf(req.cwd, d);
  if (project) {
    try {
      const work = d.featureSlug(req.cwd);
      recordSession({ session: req.session, project, role: work ? 'feature' : 'front-desk', ...(work ? { work } : {}), at, by: 'mod' });
    } catch {
      // The reading is kept even when what the session is for can't be.
    }
  }
  return { ok: true };
}

async function reply(req, d) {
  if (!fromDirector(req.origin)) return no(SAYS.notDirector);
  const project = placeOf(req.cwd, d);
  if (!project) return no(SAYS.notProject);
  const { made, says } = await d.replyRecord({ project, text: req.text, client: clientOf(d), now: d.now, liftStop: d.liftStop, stopState: d.stopState, budget: HELPER_MS });
  return typeof says === 'string' ? { ok: made === true, says } : { ok: made === true };
}

// What the build loop has in progress, read from files only.
async function inProgress(cwd, d) {
  try {
    const features = (await d.loadInputs({ cwd, now: d.now, offline: true }))?.model?.build?.features;
    const n = Array.isArray(features) ? features.filter((f) => f?.step === 'building').length : 0;
    return n === 0 ? SAYS.nothingBuilding : `In progress: ${n} ${n === 1 ? 'feature' : 'features'} building.`;
  } catch {
    return SAYS.nothingBuilding;
  }
}

// /go: the signed lift-stop action is kept first, by the prompt record's own path, and STOP is
// lifted only once it is. A record that can't be signed or kept leaves STOP on.
async function go(req, d) {
  if (!fromDirector(req.origin)) return no(SAYS.goNotDirector);
  if (!(await d.stopState()).on) return { ok: true, says: SAYS.stopOff };
  const project = placeOf(req.cwd, d);
  if (!project) return no(SAYS.goNotProject);
  const got = { made: { kind: 'action', data: { action: 'lift-stop', question: LIFT_STOP, label: '/go' } }, lift: true };
  let lifting = false;
  let kept;
  try {
    kept = keepEarned(project, got, { now: d.now, liftStop: () => { lifting = true; d.liftStop(); } });
  } catch {
    return no(lifting ? SAYS.cantLift : SAYS.cantSign);
  }
  try {
    await sendKept(clientOf(d), withinBudget(Date.now() + HELPER_MS), kept);
  } catch {
    // Kept in pending/ for the next session start to send.
  }
  return { ok: true, says: `STOP is off. ${await inProgress(req.cwd, d)}` };
}

// A typed "stop" is the stop-word hook's; only a phoned one sets STOP here.
async function stop(req, d) {
  if (req.origin !== 'bridge') return no(SAYS.stopNotPhone);
  d.setStop({ by: 'mod', now: d.now });
  return { ok: true, says: SAYS.stopOn };
}

const COMMANDS = { usage, reply, go, stop };

// handle(request, deps) -> { ok, says? }. Never throws.
export async function handle(request, deps = {}) {
  if (!isRecord(request)) return no(SAYS.unreadable);
  const cmd = typeof request.cmd === 'string' && Object.hasOwn(COMMANDS, request.cmd) ? COMMANDS[request.cmd] : null;
  if (!cmd) return no(SAYS.unknown);
  try {
    return await cmd(request, { ...DEFAULTS, ...deps });
  } catch {
    return no(SAYS.failed);
  }
}

// The text on the stream, or null once it passes `max` bytes.
async function readCapped(stream, max) {
  const chunks = [];
  let size = 0;
  for await (const chunk of stream) {
    const bytes = Buffer.from(chunk);
    size += bytes.length;
    if (size > max) return null;
    chunks.push(bytes);
  }
  return Buffer.concat(chunks).toString('utf8');
}

async function answerFor(stdin, deps) {
  let request;
  try {
    const text = await readCapped(stdin, MAX_REQUEST_BYTES);
    if (text === null) return no(SAYS.unreadable);
    request = JSON.parse(text);
  } catch {
    return no(SAYS.unreadable);
  }
  return handle(request, deps);
}

// The answer's one line: { ok } and `says` when there is one, nothing else.
function lineOf(answer) {
  const out = { ok: answer?.ok === true };
  if (typeof answer?.says === 'string') out.says = answer.says;
  return JSON.stringify(out);
}

// runBridge({ stdin, limitMs, deps }) -> the answer's line. Never throws; answers when the
// limit comes if the request isn't done by then.
export async function runBridge({ stdin = process.stdin, limitMs = BRIDGE_MS, deps } = {}) {
  let timer;
  const late = new Promise((resolve) => { timer = setTimeout(() => resolve(no(SAYS.late)), limitMs); });
  try {
    return lineOf(await Promise.race([answerFor(stdin, deps).catch(() => no(SAYS.failed)), late]));
  } finally {
    clearTimeout(timer);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const line = await runBridge();
  // Waits for the write to be taken (a Windows pipe takes it asynchronously), then exits, so a
  // request or a timer still open can't hold the process.
  await new Promise((resolve) => process.stdout.write(`${line}\n`, () => resolve()));
  process.exit(0);
}
