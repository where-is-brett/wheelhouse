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
// `copilot --version`'s answer, asked once per process (a watcher start): the version, or null when it can't be had.
const cliAsked = new Map();
async function cliFromRun({ run, env, platform }) {
  const key = `${platform}`;
  if (cliAsked.has(key)) return cliAsked.get(key);
  let found = null;
  try {
    const resolved = resolveCommand({ name: 'copilot', platform, env });
    const call = resolved.kind === 'cmd'
      ? { file: 'cmd.exe', args: ['/d', '/s', '/c', `"${[resolved.file, '--version'].map(quoteForCmd).join(' ')}"`], verbatim: true }
      : { file: resolved.file, args: ['--version'], verbatim: false };
    const result = await run(call.file, call.args, { env, input: '', timeoutMs: VERSION_WAIT_MS, windowsVerbatimArguments: call.verbatim });
    found = result?.code === 0 ? versionIn(result.stdout) : null;
  } catch {
    found = null;
  }
  cliAsked.set(key, found);
  return found;
}

// readVersions({ home, env, run, platform }) -> Promise<{ vscode, runtime, cli }>
//   The versions of VS Code, its Copilot runtime and Copilot CLI in use here, each a version or null, never guessed:
//   from the add-on's record (`<home>/agents/copilot-versions.json`) when it is there; else the CLI's alone, from
//   COPILOT_CLI_BINARY_VERSION (a Copilot hook's environment, check 58: the hook's input carries no version); else
//   from `copilot --version` through `run`, asked once per process. Without `run`, nothing is started.
export async function readVersions({ home = wheelhouseHome(), env = process.env, run = null, platform = process.platform } = {}) {
  const kept = readJson(versionsFile(home));
  const vscode = versionOrNull(kept?.vscode);
  const runtime = versionOrNull(kept?.runtime);
  let cli = versionOrNull(kept?.cli) ?? versionOrNull(env?.COPILOT_CLI_BINARY_VERSION);
  if (cli === null && typeof run === 'function') cli = await cliFromRun({ run, env, platform });
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
    const resolved = resolveCommand({ name: 'copilot', platform, env });
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

// The words of a version hold: which versions, and that they haven't passed. At most HOLD_WHY_CHARS.
export function versionWhy(versions, pin = null) {
  const pinned = pin === null ? '' : `, and Wheelhouse is pinned to ${named(pin)}`;
  const words = `Copilot CLI ${named(versions?.cli)} (VS Code ${named(versions?.vscode)}, Copilot runtime ${named(versions?.runtime)}) isn't the version Wheelhouse has tested${pinned}, and it hasn't passed Wheelhouse's safety checks, so Copilot work is held`;
  return words.slice(0, HOLD_WHY_CHARS);
}

// What lifts a version hold, as the card and the hook say it (ruling P8-32).
export const VERSION_LIFTS = "No click here lifts the hold: it lifts once Copilot is back at the version Wheelhouse is pinned to, or a newer version passes Wheelhouse's safety checks, which the watcher tries again each time it starts, or once this project runs on Claude Code on this computer again.";

// copilotVersionCheck({ versions, last, runSubset, pin }) -> Promise<{ changed, ok, why }>
//   A CLI at the pinned version passes without running anything: the pin is the version the trial's checks ran on. Any
//   other version, or none known, is checked against the versions last checked (`last`, null when none have been): the
//   same versions pass; a change, or nothing checked yet, runs the safety subset once (`runSubset({ versions })`, the
//   evaluation runner over the safety scenarios), which must answer `{ ok: true }` to pass; anything else, a throw
//   among it, fails.
export async function copilotVersionCheck({ versions, last, runSubset, pin = null }) {
  if (pin !== null && (versions?.cli ?? null) === pin) return { changed: false, ok: true, why: null };
  if (last !== null && last !== undefined && sameVersions(versions, last)) return { changed: false, ok: true, why: null };
  let answer;
  try {
    answer = await runSubset({ versions });
  } catch {
    answer = null;
  }
  const ok = answer?.ok === true;
  return { changed: true, ok, why: ok ? null : versionWhy(versions, pin) };
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

// checkVersions({ project, versions, runSubset, pin, home, now }) -> Promise<{ lifted }>
//   Before a Copilot session starts: the version check, for `project`. `pin` is the manifest's (pinnedCli). A CLI at the
//   pin, or versions already checked, pass. Any other CLI runs
//   the subset (once per process for the same versions): a pass records them as checked and lifts the project's
//   version hold; a failure writes the hold (so the project's hooks hold edits and commands, and no tick lifts its
//   card while it stands) and refuses the start. A refusal throws an error carrying the lineage hold's record, with
//   `why` naming the versions, until that record is in the state (the error's `raised`, which the waker calls once
//   it is), so the hold raises one card. `lifted` says a pass removed the project's version hold, so its card can close.
export async function checkVersions({ project, versions, runSubset = noSubsetRunner, pin = pinnedCli(), home = wheelhouseHome(), now = () => new Date() }) {
  const last = readJson(seenFile(home));
  const held = readAgentHold(project, VERSION_HOLD);
  const key = JSON.stringify([versions?.vscode ?? null, versions?.runtime ?? null, versions?.cli ?? null]);
  const tried = subsetRun.has(key) && held !== null && sameVersions(held.versions, versions);
  const result = tried ? { changed: true, ok: false, why: versionWhy(versions, pin) } : await copilotVersionCheck({ versions, last, runSubset, pin });
  if (result.changed && !tried) subsetRun.add(key);
  if (result.ok) {
    if (result.changed) {
      fs.mkdirSync(path.dirname(seenFile(home)), { recursive: true });
      fs.writeFileSync(seenFile(home), `${JSON.stringify({ vscode: versions.vscode, runtime: versions.runtime, cli: versions.cli, at: now().toISOString() }, null, 2)}\n`);
    }
    return { lifted: liftAgentWork(project, VERSION_HOLD) };
  }
  const mismatches = [{ upstream: 'copilot', path: `cli ${named(versions?.cli)}` }];
  const { set, recorded } = holdAgentWork({ project, name: VERSION_HOLD, agent: 'copilot', mismatches, why: result.why, lifts: VERSION_LIFTS, keep: { versions: { vscode: versions?.vscode ?? null, runtime: versions?.runtime ?? null, cli: versions?.cli ?? null } }, now });
  throw Object.assign(new Error(`${result.why}: no Copilot session is started until it passes`), {
    records: recorded ? [] : [{ kind: 'lineage-hold', data: { at: now().toISOString(), mismatches, why: result.why, lifts: VERSION_LIFTS } }],
    raised: () => markAgentRecorded(project, VERSION_HOLD, set),
  });
}
