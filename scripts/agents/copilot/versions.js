// scripts/agents/copilot/versions.js
// Reads docs/copilot/tested-versions.md, the list of VS Code and Copilot runtime versions Wheelhouse's safety scenarios have been
// run on (design section 6.4, "Versions"). VS Code and its Copilot runtime update every week and can't be pinned, so the front desk
// compares the person's versions with this list and says when theirs haven't been tested yet.
//
// The table's header is `VS Code | Copilot runtime | Tested on | Result`. A row counts only when its Result says it passed.
//
// Beside it: the versions in use here (readVersions), the models Copilot offers (copilotModels), and the check that holds
// a Copilot session when the installed CLI isn't the version Wheelhouse is pinned to (lineage/manifest.json, `agents`;
// scripts/agents/pins.js) until that version has passed Wheelhouse's safety subset (copilotVersionCheck, checkVersions).
import fs from 'node:fs';
import path from 'node:path';
import { isModelName } from '../../gate/guardrails.js';
import { quoteForCmd, resolveCommand } from '../../lib/claude.js';
import { wheelhouseHome } from '../../lib/paths.js';
import { holdAgentWork, liftAgentWork, markAgentRecorded, readAgentHold } from '../../lineage/check.js';
import { readManifest } from '../../lineage/manifest.js';
import { HOLD_WHY_CHARS } from '../../state/events.js';

const cell = (text) => text.trim().replace(/^`+|`+$/g, '').trim();

// The rows of the table in `text`, as { vscode, runtime, testedOn, result }. A line that is not a table row, the header and the
// separator are left out.
function rows(text) {
  const out = [];
  for (const line of String(text ?? '').replaceAll('\r\n', '\n').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('|') || !trimmed.endsWith('|')) continue;
    const cells = trimmed.slice(1, -1).split('|').map(cell);
    if (cells.length < 4) continue;
    if (/^:?-+:?$/.test(cells[0])) continue;
    if (cells[0] === 'VS Code' && cells[1] === 'Copilot runtime') continue;
    out.push({ vscode: cells[0], runtime: cells[1], testedOn: cells[2], result: cells[3] });
  }
  return out;
}

// isTested({ vscode, runtime }, text) -> boolean
//   Whether a row of the table names both versions, exactly, and says in its Result that it passed.
export function isTested({ vscode, runtime } = {}, text) {
  if (typeof vscode !== 'string' || typeof runtime !== 'string') return false;
  const wantVscode = cell(vscode);
  const wantRuntime = cell(runtime);
  if (wantVscode === '' || wantRuntime === '') return false;
  return rows(text).some((row) => row.vscode === wantVscode && row.runtime === wantRuntime && /^passed\b/i.test(row.result));
}

// --- The versions in use, and a new one checked first (rulings P8-17, P8-20, P8-23) ---

const VERSION = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]{1,64})?$/;
const versionOrNull = (value) => (typeof value === 'string' && VERSION.test(value.trim()) ? value.trim() : null);
// The first version number in a program's `--version` answer, or null.
const versionIn = (text) => /\b(\d+\.\d+\.\d+)\b/.exec(String(text ?? ''))?.[1] ?? null;

// The CLI version the manifest pins Copilot to, or null when the manifest can't be read or pins none. A pin is the version
// the trial's checks ran on, so a CLI of exactly that version needs no safety subset of its own.
export function pinnedCli(manifest) {
  try {
    return versionOrNull((manifest ?? readManifest())?.agents?.copilot?.cli);
  } catch {
    return null;
  }
}

// The add-on's record of the versions (Part 10 writes it), and Wheelhouse's own record of the versions last checked.
export const versionsFile = (home = wheelhouseHome()) => path.join(home, 'agents', 'copilot-versions.json');
export const seenFile = (home = wheelhouseHome()) => path.join(home, 'agents', 'copilot-versions-seen.json');

function readJson(file) {
  try {
    const value = JSON.parse(fs.readFileSync(file, 'utf8'));
    return value !== null && typeof value === 'object' && !Array.isArray(value) ? value : null;
  } catch {
    return null;
  }
}

const VERSION_WAIT_MS = 30000;

// Where VS Code puts the Copilot CLI's shim on Windows: under VS Code installed for the whole computer first, then under
// the per-user install. VS Code adds that folder to the PATH of its own terminals only, so a process started elsewhere
// (the watcher) may not have it.
function shimFolders(env) {
  const at = (name) => Object.entries(env ?? {}).find(([key]) => key.toLowerCase() === name.toLowerCase())?.[1];
  return [[at('ProgramFiles'), ''], [at('LOCALAPPDATA'), 'Programs']].flatMap(([base, sub]) => (
    typeof base === 'string' && base !== ''
      ? ['Microsoft VS Code', 'Microsoft VS Code Insiders'].map((app) => path.win32.join(base, sub, app, 'bin', 'copilot-shim'))
      : []));
}

// resolveCopilot({ platform, env, exists }) -> { kind, file }
//   The `copilot` program as resolveCommand finds it; on Windows, when the PATH has none, VS Code's shim folders are looked in
//   too. Throws when it is nowhere.
export function resolveCopilot({ platform = process.platform, env = process.env, exists = fs.existsSync } = {}) {
  try {
    return resolveCommand({ name: 'copilot', platform, env, exists });
  } catch (error) {
    if (platform !== 'win32') throw error;
    const key = Object.keys(env ?? {}).find((k) => k.toLowerCase() === 'path') ?? 'Path';
    const widened = { ...env, [key]: [String(env?.[key] ?? ''), ...shimFolders(env)].filter(Boolean).join(';') };
    return resolveCommand({ name: 'copilot', platform, env: widened, exists });
  }
}

// Why the last `copilot --version` read gave no version, in a few plain words with no paths or output (null when it gave one),
// for whoever asks why a hold names a version not known.
let lastFault = null;
export const cliFault = () => lastFault;

// `copilot --version`'s answers kept for the process, by platform and PATH. Only a version is kept: a read that failed is
// asked again at the next start, so an early failure (a slow start, a PATH not yet set) never holds the whole process.
const cliAsked = new Map();
async function cliOnce({ run, env, platform, exists }) {
  let resolved;
  try {
    resolved = resolveCopilot({ platform, env, exists });
  } catch {
    lastFault = 'copilot not found on the PATH';
    return null;
  }
  const call = resolved.kind === 'cmd'
    ? { file: 'cmd.exe', args: ['/d', '/s', '/c', `"${[resolved.file, '--version'].map(quoteForCmd).join(' ')}"`], verbatim: true }
    : { file: resolved.file, args: ['--version'], verbatim: false };
  try {
    const result = await run(call.file, call.args, { env, input: '', timeoutMs: VERSION_WAIT_MS, windowsVerbatimArguments: call.verbatim });
    if (result?.timedOut === true) { lastFault = 'copilot --version timed out'; return null; }
    if (result?.code !== 0) { lastFault = `copilot --version exited with ${result?.code ?? 'no code'}`; return null; }
    // The answer is read from either stream: a shim that hands on to another program may write to the one it was not given.
    const found = versionIn(result.stdout) ?? versionIn(result.stderr);
    lastFault = found === null ? 'copilot --version printed no version number' : null;
    return found;
  } catch {
    lastFault = 'copilot --version could not be started';
    return null;
  }
}

// `copilot --version`'s answer: the version, or null when it can't be had after two tries.
async function cliFromRun({ run, env, platform, exists }) {
  const pathKey = Object.keys(env ?? {}).find((k) => k.toLowerCase() === 'path');
  const key = `${platform}\0${pathKey ? env[pathKey] : ''}`;
  if (cliAsked.has(key)) return cliAsked.get(key);
  const found = (await cliOnce({ run, env, platform, exists })) ?? (await cliOnce({ run, env, platform, exists }));
  if (found !== null) cliAsked.set(key, found);
  return found;
}

// readVersions({ home, env, run, platform }) -> Promise<{ vscode, runtime, cli }>
//   The versions of VS Code, its Copilot runtime and Copilot CLI in use here, each a version or null, never guessed.
//   The CLI's is never read from a file: a file on this computer could claim the pinned version. It comes from
//   COPILOT_CLI_BINARY_VERSION (a Copilot hook's environment, check 58: the hook's input carries no version), else from
//   `copilot --version` through `run` (a version is kept for the process; a failed read is tried twice and asked again at the next start); without `run`, nothing is started. VS Code's and the
//   runtime's come from the add-on's record (`<home>/agents/copilot-versions.json`) when it is there; the add-on is parked.
export async function readVersions({ home = wheelhouseHome(), env = process.env, run = null, platform = process.platform, exists = fs.existsSync } = {}) {
  const kept = readJson(versionsFile(home));
  const vscode = versionOrNull(kept?.vscode);
  const runtime = versionOrNull(kept?.runtime);
  let cli = versionOrNull(env?.COPILOT_CLI_BINARY_VERSION);
  if (cli === null && typeof run === 'function') cli = await cliFromRun({ run, env, platform, exists });
  return { vscode, runtime, cli };
}

// The models offered in Copilot's own help: `--model`'s choices, `(choices: "a", "b")`. No check has recorded the
// list command's answer, so this reading is held for a first real run (ruling P8-17); until it is seen, setup pins
// no Copilot model and the routing table's Copilot column stays empty.
const CHOICES = /--model\b[^\n]*?\(choices:\s*((?:"[^"\n]*"(?:,\s*)?)+)\)/s;

// copilotModels({ run, env, platform }) -> Promise<string[]>
//   The models Copilot offers this person (a company may narrow them), as full names, each one isModelName passes,
//   from `copilot --help` through `run`. Nothing it can't read is guessed: an answer it can't read gives [].
export async function copilotModels({ run, env = process.env, platform = process.platform } = {}) {
  if (typeof run !== 'function') return [];
  try {
    const resolved = resolveCopilot({ platform, env });
    const call = resolved.kind === 'cmd'
      ? { file: 'cmd.exe', args: ['/d', '/s', '/c', `"${[resolved.file, '--help'].map(quoteForCmd).join(' ')}"`], verbatim: true }
      : { file: resolved.file, args: ['--help'], verbatim: false };
    const result = await run(call.file, call.args, { env, input: '', timeoutMs: VERSION_WAIT_MS, windowsVerbatimArguments: call.verbatim });
    if (result?.code !== 0) return [];
    const found = CHOICES.exec(String(result.stdout ?? ''));
    if (!found) return [];
    const names = [...found[1].matchAll(/"([^"\n]*)"/g)].map((m) => m[1]);
    return [...new Set(names.filter(isModelName))];
  } catch {
    return [];
  }
}

// Whether two readings name the same versions. A CLI version that couldn't be read is never the same as anything,
// so it is checked again at every start (review Minor 1): a Copilot update under it would otherwise go unseen.
const sameVersions = (a, b) => (a?.cli ?? null) !== null && ['vscode', 'runtime', 'cli'].every((key) => (a?.[key] ?? null) === (b?.[key] ?? null));
// The most of one version a hold's words name, so they stay within the lineage hold's `why` (HOLD_WHY_CHARS).
const NAMED_CHARS = 32;
const named = (value) => (typeof value === 'string' ? (value.length > NAMED_CHARS ? `${value.slice(0, NAMED_CHARS)}...` : value) : 'a version not known');

// The most of a read's fault a hold's words name.
const FAULT_CHARS = 60;

// The words of a version hold: which versions, and that they haven't passed. A CLI version that couldn't be read is said
// so, with `fault` (cliFault's words) when one is given. At most HOLD_WHY_CHARS.
export function versionWhy(versions, pin = null, fault = null) {
  const pinned = pin === null ? '' : `, and Wheelhouse is pinned to ${named(pin)}`;
  if ((versions?.cli ?? null) === null && typeof fault === 'string' && fault !== '') {
    const words = `Copilot CLI's version couldn't be read (${fault.slice(0, FAULT_CHARS)}), so it isn't known to be the version Wheelhouse has tested${pinned}, and Copilot work is held`;
    return words.slice(0, HOLD_WHY_CHARS);
  }
  const words = `Copilot CLI ${named(versions?.cli)} (VS Code ${named(versions?.vscode)}, Copilot runtime ${named(versions?.runtime)}) isn't the version Wheelhouse has tested${pinned}, and it hasn't passed Wheelhouse's safety checks, so Copilot work is held`;
  return words.slice(0, HOLD_WHY_CHARS);
}

// What lifts a version hold, as the card and the hook say it (ruling P8-32).
export const VERSION_LIFTS = "No click here lifts the hold: it lifts once Copilot is back at the version Wheelhouse is pinned to, or a newer version passes Wheelhouse's safety checks, which the watcher tries again each time it starts, or once this project runs on Claude Code on this computer again.";

// copilotVersionCheck({ versions, last, runSubset, pin, fault }) -> Promise<{ changed, ok, why }>
//   A CLI at the pinned version passes without running anything: the pin is the version the trial's checks ran on. Any
//   other version, or none known, is checked against the versions last checked (`last`, null when none have been): the
//   same versions pass; a change, or nothing checked yet, runs the safety subset once (`runSubset({ versions })`, the
//   evaluation runner over the safety scenarios), which must answer `{ ok: true }` to pass; anything else, a throw
//   among it, fails. `fault` is why the CLI's version couldn't be read, for the hold's words.
export async function copilotVersionCheck({ versions, last, runSubset, pin = null, fault = null }) {
  if (pin !== null && (versions?.cli ?? null) === pin) return { changed: false, ok: true, why: null };
  if (last !== null && last !== undefined && sameVersions(versions, last)) return { changed: false, ok: true, why: null };
  let answer;
  try {
    answer = await runSubset({ versions });
  } catch {
    answer = null;
  }
  const ok = answer?.ok === true;
  return { changed: true, ok, why: ok ? null : versionWhy(versions, pin, fault) };
}

// The subset's runner until the evaluation runner (part 10 of the build) gives one: it fails, so a version other than the
// pin holds Copilot work. It runs only once the background sessions are switched on (ruling P8-1).
export async function noSubsetRunner() {
  return { ok: false, why: "the safety subset's runner isn't built yet" };
}

// The agent hold a version that fails takes (scripts/lineage/check.js agentHoldFile).
export const VERSION_HOLD = 'copilot-version';
// The versions whose subset this process has run, so a failed one isn't run again before the watcher starts again.
const subsetRun = new Set();

// checkVersions({ project, versions, fault, runSubset, pin, home, now }) -> Promise<{ lifted }>
//   Before a Copilot session starts: the version check, for `project`. `pin` is the manifest's (pinnedCli). A CLI at the
//   pin, or versions already checked, pass. Any other CLI runs
//   the subset (once per process for the same versions): a pass records them as checked and lifts the project's
//   version hold; a failure writes the hold (so the project's hooks hold edits and commands, and no tick lifts its
//   card while it stands) and refuses the start. A refusal throws an error carrying the lineage hold's record, with
//   `why` naming the versions, until that record is in the state (the error's `raised`, which the waker calls once
//   it is), so the hold raises one card. `lifted` says a pass removed the project's version hold, so its card can close.
//   `fault` (cliFault's words) is why a CLI version couldn't be read: the hold's words and its record name it.
export async function checkVersions({ project, versions, fault = null, runSubset = noSubsetRunner, pin = pinnedCli(), home = wheelhouseHome(), now = () => new Date() }) {
  const unread = (versions?.cli ?? null) === null && typeof fault === 'string' && fault !== '' ? fault.slice(0, FAULT_CHARS) : null;
  const last = readJson(seenFile(home));
  const held = readAgentHold(project, VERSION_HOLD);
  const key = JSON.stringify([versions?.vscode ?? null, versions?.runtime ?? null, versions?.cli ?? null]);
  const tried = subsetRun.has(key) && held !== null && sameVersions(held.versions, versions);
  const result = tried ? { changed: true, ok: false, why: versionWhy(versions, pin, unread) } : await copilotVersionCheck({ versions, last, runSubset, pin, fault: unread });
  if (result.changed && !tried) subsetRun.add(key);
  if (result.ok) {
    if (result.changed) {
      fs.mkdirSync(path.dirname(seenFile(home)), { recursive: true });
      fs.writeFileSync(seenFile(home), `${JSON.stringify({ vscode: versions.vscode, runtime: versions.runtime, cli: versions.cli, at: now().toISOString() }, null, 2)}\n`);
    }
    return { lifted: liftAgentWork(project, VERSION_HOLD) };
  }
  const mismatches = [{ upstream: 'copilot', path: `cli ${named(versions?.cli)}` }];
  const { set, recorded } = holdAgentWork({ project, name: VERSION_HOLD, agent: 'copilot', mismatches, why: result.why, lifts: VERSION_LIFTS, keep: { versions: { vscode: versions?.vscode ?? null, runtime: versions?.runtime ?? null, cli: versions?.cli ?? null }, ...(unread === null ? {} : { fault: unread }) }, now });
  throw Object.assign(new Error(`${result.why}: no Copilot session is started until it passes`), {
    records: recorded ? [] : [{ kind: 'lineage-hold', data: { at: now().toISOString(), mismatches, why: result.why, lifts: VERSION_LIFTS } }],
    raised: () => markAgentRecorded(project, VERSION_HOLD, set),
  });
}
