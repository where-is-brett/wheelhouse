// probes/64-usage/run.js
// Check 64: what does Copilot tell Wheelhouse about usage? Records field names and types, never amounts.
//   plain   a headless run with no tool, --output-format json and --usage-output-file
//   tool    the same, with one use of the view tool
//   help    `copilot help billing` (no network): where the help says the figures come from
//   rest    GitHub's documented read-only call for the signed-in person's Copilot credit use, made once with `gh api`
//           (the person's own gh sign-in). The login comes from `gh api user --jq .login`, is used in the path and is
//           never recorded. If the endpoint answers 404, the older premium-request endpoint is tried once.
// What is recorded for a session: the result event's usage fields, every session.usage_checkpoint, every event type's
// fields that look like usage (token, cost, credit, request, premium, aiu, cache, duration, quota), and the usage file's
// fields. Each is a map from a field path to the types seen there. Model names are replaced by <MODEL>. For the REST
// call: the status line, the names of the headers that matter for scopes (their values: scope lists only), the body's
// field paths and types. No amounts, no login, no token.
// Sources for the endpoint: docs/research/copilot-vscode-2026-10.md section 12 (GET /users/{username}/settings/billing/ai_credit/usage,
// fine-grained token with "Plan" read) from https://docs.github.com/en/rest/billing/usage.
//
// Usage: node probes/64-usage/run.js              the full run, from outside any sandbox
//        node probes/64-usage/run.js --dry-run    the same plumbing against stand-ins for copilot and gh
// Options: --bin <path>, --gh <path>, --timeout-ms <n> (one run, default 240000), --results-dir <dir>
//
// Model runs: 2 (a session that fails before any event is tried once more, so up to 4). Everything it makes is under the temporary folder and is removed when it ends, also on Ctrl-C.
// It never reads or writes the real ~/.copilot or ~/.wheelhouse. The gh call is read only.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { run } from '../../scripts/lib/run.js';
import { LOGIN_HOME, copilotBin, defaultPrefix, runCopilot, scratchCopilotHome } from '../lib/copilot.js';
import { assertUnderTmp, makeScratchProject } from '../lib/scratch.js';

export const CHECK = '64-usage';
const FAKE_COPILOT = fileURLToPath(new URL('./fake-copilot.js', import.meta.url));
const FAKE_GH = fileURLToPath(new URL('./fake-gh.js', import.meta.url));
export const REST_PATHS = [
  'settings/billing/ai_credit/usage',
  'settings/billing/premium_request/usage',
];
// A run that fails before any event (for example the model list could not be fetched) is tried once more.
export const RETRIES = 1;
export const needsRetry = (r) => r.code !== 0 && r.events.length === 0;
// The last lines of the debug logs Copilot wrote in `dir`, each passed through `mark` (the scrubber).
export function logTail(dir, mark = (x) => x, max = 80) {
  let lines = [];
  try {
    for (const name of fs.readdirSync(dir).sort()) lines = lines.concat(fs.readFileSync(path.join(dir, name), 'utf8').split('\n'));
  } catch { return []; }
  return lines.filter(Boolean).slice(-max).map((line) => mark(line.slice(0, 400)));
}
const USAGE_LIKE = /usage|token|cost|credit|request|premium|aiu|cache|duration|quota|metric|billing/i;

// ------------------------------------------------------------------ options

export function parseOptions(argv) {
  const options = { dryRun: false, bin: '', gh: '', timeoutMs: 240_000, resultsDir: path.join(os.tmpdir(), 'wheelhouse-probe-results') };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--dry-run') options.dryRun = true;
    else if (arg === '--bin') options.bin = argv[++i] ?? '';
    else if (arg === '--gh') options.gh = argv[++i] ?? '';
    else if (arg === '--timeout-ms') options.timeoutMs = Number(argv[++i]);
    else if (arg === '--results-dir') options.resultsDir = argv[++i] ?? '';
    else throw new Error(`Unknown option: ${arg}`);
  }
  if (!Number.isFinite(options.timeoutMs) || options.timeoutMs <= 0) throw new Error('--timeout-ms is a number of milliseconds');
  if (!options.resultsDir) throw new Error('--results-dir needs a folder');
  return options;
}

// ------------------------------------------------------------------- shapes

const typeOf = (value) => (value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value);

// A map from field path to the sorted types seen there, merged into `into`. Arrays contribute their items under `[]`.
// Keys of the objects at `modelKeyed` paths (a path whose keys are model names) are written as <MODEL>.
export function shapeOf(value, { into = {}, prefix = '', modelKeyed = [] } = {}) {
  const note = (p, type) => { (into[p] ??= new Set()).add(type); };
  const walk = (v, p) => {
    note(p || '(root)', typeOf(v));
    if (Array.isArray(v)) for (const item of v) walk(item, `${p}[]`);
    else if (v && typeof v === 'object') {
      const keyed = modelKeyed.includes(p);
      for (const [k, inner] of Object.entries(v)) walk(inner, `${p}${p ? '.' : ''}${keyed ? '<MODEL>' : k}`);
    }
  };
  walk(value, prefix);
  return into;
}
export function shapeToJson(shape) {
  return Object.fromEntries(Object.entries(shape).sort(([a], [b]) => a.localeCompare(b)).map(([p, types]) => [p, [...types].sort()]));
}

// Replaces each name in `names` (model names, the login) in text.
export function scrubText(text, names = [], mark = '<MODEL>') {
  let out = String(text ?? '');
  for (const name of names) if (name) out = out.split(name).join(mark);
  return out;
}

// Model names a session shows: the keys under modelMetrics in a usage file, and `model` fields in events.
export function modelNames(events, usageFile) {
  const names = new Set(Object.keys(usageFile?.modelMetrics ?? {}));
  const walk = (v) => {
    if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === 'object') {
      for (const [k, inner] of Object.entries(v)) {
        if (/^(model|modelName|selectedModel|requestedModel|resolvedModel)$/.test(k) && typeof inner === 'string' && inner) names.add(inner);
        walk(inner);
      }
    }
  };
  events.forEach(walk);
  return [...names].filter((n) => n.length > 2).sort((a, b) => b.length - a.length);
}

// What a session's events and usage file show about usage. Field paths and types only.
export function usageShapes(events, usageFile) {
  const names = modelNames(events, usageFile);
  const clean = (shape) => Object.fromEntries(Object.entries(shapeToJson(shape)).map(([p, t]) => [scrubText(p, names), t]));
  const byType = {};
  for (const event of events) {
    const type = event?.type ?? '(no type)';
    shapeOf(event, { into: (byType[type] ??= {}) });
  }
  const eventTypes = Object.keys(byType);
  const usageLikeFields = {};
  for (const [type, shape] of Object.entries(byType)) {
    const kept = Object.fromEntries(Object.entries(shape).filter(([p]) => USAGE_LIKE.test(p)));
    if (Object.keys(kept).length) usageLikeFields[type] = clean(kept);
  }
  const resultEvent = events.find((event) => event?.type === 'result');
  const checkpoints = events.filter((event) => event?.type === 'session.usage_checkpoint');
  return {
    modelNamesSeen: names.length,
    eventTypes,
    resultEventFields: resultEvent ? clean(shapeOf(resultEvent)) : null,
    usageCheckpointCount: checkpoints.length,
    usageCheckpointFields: checkpoints.length ? clean(checkpoints.reduce((into, e) => shapeOf(e, { into }), {})) : null,
    usageLikeFieldsByEventType: usageLikeFields,
    usageFileFields: usageFile ? clean(shapeOf(usageFile, { modelKeyed: ['modelMetrics'] })) : null,
  };
}

// ---------------------------------------------------------------------- REST

// Splits `gh api -i` output into the status line, the headers and the body text.
export function splitHttp(text) {
  const match = /\r?\n\r?\n/.exec(text);
  const head = match ? text.slice(0, match.index) : text;
  const body = match ? text.slice(match.index + match[0].length) : '';
  const lines = head.split(/\r?\n/);
  const headers = {};
  for (const line of lines.slice(1)) {
    const i = line.indexOf(':');
    if (i > 0) headers[line.slice(0, i).trim().toLowerCase()] = line.slice(i + 1).trim();
  }
  return { status: lines[0] ?? '', headers, body };
}
const SCOPE_HEADERS = ['x-oauth-scopes', 'x-accepted-oauth-scopes', 'x-accepted-github-permissions', 'x-github-media-type'];

// One read-only call. Records the status, scope-related headers, and the body's field paths and types.
export async function restCall({ gh, login, restPath, cwd, timeoutMs }) {
  const endpoint = `/users/${login}/${restPath}`;
  const result = await run(gh, ['api', '-i', '-H', 'Accept: application/vnd.github+json', '-H', 'X-GitHub-Api-Version: 2022-11-28', endpoint], { cwd, timeoutMs });
  const http = splitHttp(result.stdout);
  let body = null;
  try { body = JSON.parse(http.body); } catch { /* an error page or empty */ }
  const scrub = (text) => scrubText(text, [login], '<LOGIN>');
  const record = {
    endpoint: scrub(endpoint), code: result.code, timedOut: result.timedOut === true,
    status: scrub(http.status),
    headers: Object.fromEntries(SCOPE_HEADERS.filter((h) => h in http.headers).map((h) => [h, scrub(http.headers[h])])),
    bodyIsJson: body !== null,
    bodyFields: body !== null ? shapeToJson(shapeOf(body)) : null,
    // The message of a refusal is text GitHub wrote, not an amount; it is kept (login scrubbed).
    errorMessage: body && typeof body === 'object' && typeof body.message === 'string' ? scrub(body.message) : null,
    documentationUrl: body && typeof body === 'object' && typeof body.documentation_url === 'string' ? body.documentation_url : null,
    stderr: scrub(result.stderr.trim().slice(0, 400)),
  };
  if (body && typeof body === 'object' && !Array.isArray(body)) {
    // A refusal's own body names scopes in its message; amounts never appear in the fields recorded here.
    record.topLevelKeys = Object.keys(body).sort();
  }
  return record;
}

export async function loginOf({ gh, cwd, timeoutMs }) {
  const result = await run(gh, ['api', 'user', '--jq', '.login'], { cwd, timeoutMs });
  const login = result.stdout.trim();
  return { ok: result.code === 0 && login !== '', login, stderr: result.stderr.trim().slice(0, 300), code: result.code };
}

// ------------------------------------------------------------------ summary

export function summarise(results) {
  const out = [];
  out.push(`Check ${results.check}${results.dryRun ? ' (dry run, against stand-ins)' : ''}: ${results.runs.length} model run(s), Copilot ${results.copilotVersion || 'version unknown'}`);
  for (const r of results.runs) {
    const s = r.shapes;
    out.push(`${r.id.padEnd(8)} exit ${String(r.code).padEnd(4)}${r.attempts > 1 ? ` (${r.attempts} attempts)` : ''}${r.timedOut ? ' TIMED OUT' : ''} ${(r.durationMs / 1000).toFixed(1)}s  result.usage fields: ${s?.resultEventFields ? Object.keys(s.resultEventFields).filter((p) => p.startsWith('usage')).join(', ') : 'none'}`);
    if (r.code !== 0) out.push(`${' '.repeat(8)} stderr: ${(r.stderr.split('\n').find((l) => l.trim()) ?? '(none)').slice(0, 120)}`);
    out.push(`${' '.repeat(8)} usage checkpoints: ${s?.usageCheckpointCount ?? 0}; usage file: ${s?.usageFileFields ? `${Object.keys(s.usageFileFields).length} field paths` : r.usageFile.present ? 'not JSON' : 'not written'}`);
  }
  out.push(`help billing: exit ${results.help?.code ?? '?'}, ${results.help?.lines ?? 0} lines`);
  for (const attempt of results.rest ?? []) {
    out.push(`rest ${attempt.endpoint}: ${attempt.status || 'no status'}; body fields: ${attempt.bodyFields ? Object.keys(attempt.bodyFields).length : 0}`);
  }
  if (results.restSkipped) out.push(`rest skipped: ${results.restSkipped}`);
  if (results.error) out.push(`STOPPED EARLY: ${String(results.error).split('\n')[0]}`);
  return out.join('\n');
}

// --------------------------------------------------------------------- main

function stub(dir, name, script) {
  const bin = path.join(dir, name);
  fs.writeFileSync(bin, `#!/bin/sh\nexec "${process.execPath}" "${script}" "$@"\n`, { mode: 0o755 });
  return bin;
}

export async function main(argv = process.argv.slice(2), { out = console.log, check = CHECK } = {}) {
  const options = parseOptions(argv);
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'wheelhouse-probe-usage-work-'));
  assertUnderTmp(work);
  const undo = [() => fs.rmSync(work, { recursive: true, force: true })];
  const cleanup = () => { for (const step of undo.splice(0).reverse()) { try { step(); } catch { /* keep undoing the rest */ } } };
  const onSignal = (signal) => { cleanup(); process.exit(signal === 'SIGINT' ? 130 : 143); };
  process.once('SIGINT', onSignal);
  process.once('SIGTERM', onSignal);

  const results = {
    check, dryRun: options.dryRun, startedAt: new Date().toISOString(), node: process.version, platform: process.platform,
    options: { timeoutMs: options.timeoutMs }, copilotVersion: '', runs: [], help: null, rest: [], restSkipped: null, error: null,
  };

  try {
    const bin = options.bin || (options.dryRun ? stub(work, 'copilot', FAKE_COPILOT) : copilotBin(defaultPrefix()));
    const gh = options.gh || (options.dryRun ? stub(work, 'gh', FAKE_GH) : 'gh');
    if (!fs.existsSync(bin)) throw new Error(`There is no Copilot at ${bin}. Install the pinned version first (installCopilot in probes/lib/copilot.js).`);

    const home = options.dryRun ? scratchCopilotHome() : scratchCopilotHome({ signedInFrom: LOGIN_HOME });
    undo.push(() => home.remove());
    const project = await makeScratchProject({ name: 'usage', files: { 'README.md': 'Wheelhouse probe 64.\n' } });
    undo.push(() => { assertUnderTmp(project.dir); fs.rmSync(project.dir, { recursive: true, force: true }); });

    const version = await runCopilot({ args: ['--version'], cwd: work, home: home.dir, bin, timeoutMs: 60_000 });
    results.copilotVersion = version.stdout.trim().split('\n')[0] ?? '';

    // The signed-in login is looked up first, only so it can be scrubbed from anything kept.
    const who = await loginOf({ gh, cwd: work, timeoutMs: 60_000 });
    const hidden = who.ok ? [who.login] : [];
    const cases = [
      { id: 'plain', prompt: 'Reply with the single word ok. Do not use any tool.' },
      { id: 'tool', prompt: 'Use the view tool to view `README.md`, then reply with the single word done.' },
    ];
    for (const c of cases) {
      const attempts = [];
      for (let attempt = 1; attempt <= 1 + RETRIES; attempt += 1) {
        const usagePath = path.join(work, `usage-${c.id}-${attempt}.json`);
        const logDir = path.join(work, `copilot-log-${c.id}-${attempt}`);
        const args = ['-p', c.prompt, '--output-format', 'json', '--no-auto-update', '--disable-builtin-mcps', '--usage-output-file', usagePath, '--log-dir', logDir, '--log-level', 'debug'];
        const t0 = Date.now();
        const r = await runCopilot({ args, cwd: project.dir, home: home.dir, bin, timeoutMs: options.timeoutMs });
        let usageFile = null;
        const present = fs.existsSync(usagePath);
        if (present) { try { usageFile = JSON.parse(fs.readFileSync(usagePath, 'utf8')); } catch { /* recorded as not JSON */ } }
        const names = [...modelNames(r.events, usageFile), ...hidden];
        const mark = (text) => scrubText(scrubText(text, modelNames(r.events, usageFile)), hidden, '<LOGIN>');
        attempts.push({
          id: c.id, attempt, args: args.map((a) => (a === usagePath ? '<usage file>' : a === logDir ? '<log dir>' : a)), code: r.code, timedOut: r.timedOut, durationMs: Date.now() - t0,
          eventCount: r.events.length, stdoutWasJsonLines: r.events.length > 0,
          stdoutHead: mark(r.stdout.slice(0, 1500)),
          stderr: mark(r.stderr.trim().slice(0, 4000)),
          debugLog: logTail(logDir, mark),
          usageFile: { present, parsed: usageFile !== null },
          shapes: usageShapes(r.events, usageFile),
        });
        if (!needsRetry(r)) break;
        await new Promise((resolve) => setTimeout(resolve, 5000));
      }
      results.runs.push({ ...attempts.at(-1), attempts: attempts.length, earlierAttempts: attempts.slice(0, -1) });
    }

    const help = await runCopilot({ args: ['help', 'billing'], cwd: work, home: home.dir, bin, timeoutMs: 60_000 });
    results.help = { code: help.code, lines: help.stdout.split('\n').length, text: help.stdout.slice(0, 20_000), stderr: help.stderr.trim().slice(0, 300) };

    if (!who.ok) {
      results.restSkipped = `gh could not give the signed-in login (exit ${who.code}): ${who.stderr}`;
    } else {
      for (const restPath of REST_PATHS) {
        const attempt = await restCall({ gh, login: who.login, restPath, cwd: work, timeoutMs: 60_000 });
        results.rest.push(attempt);
        // Another endpoint is tried only when this one does not exist for the person.
        if (!/\b404\b/.test(attempt.status)) break;
      }
    }
  } catch (error) {
    results.error = error?.stack ?? String(error);
  } finally {
    process.removeListener('SIGINT', onSignal);
    process.removeListener('SIGTERM', onSignal);
    cleanup();
    results.finishedAt = new Date().toISOString();
  }

  fs.mkdirSync(options.resultsDir, { recursive: true });
  const file = path.join(options.resultsDir, `${check}${options.dryRun ? '.dry-run' : ''}.json`);
  fs.writeFileSync(file, JSON.stringify(results, null, 2) + '\n');
  out(summarise(results));
  out(`Raw results: ${file}`);
  return { results, file };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { results } = await main();
  if (results.error) process.exitCode = 1;
}
