// probes/36-telemetry/run.js
// Check 36: which per-computer route switches Claude Code's telemetry on for Desktop sessions.
// Makes a capture server that keeps only a summary of what arrives, writes the telemetry
// settings into the user settings' `env` or into the launch environment, and puts both back
// by key. Written to run on Node.js 20 or later, with no installs, on macOS and Windows.
//   node run.js setup [--root <folder>]       make the folder, pick a free port, write state.json
//   node run.js receiver [--minutes N] [--detach]   capture server (default 30 minutes); --detach starts it
//                                             apart from this process, so it outlives a Desktop restart
//   node run.js stop                          stop the receiver started from this folder
//   node run.js read                          what the receiver has seen so far
//   node run.js settings set|unset (--user | --file <settings.json>)
//   node run.js launch-env set|unset          launchctl setenv (macOS) or user variables (Windows)
//   node run.js show-env                      the variables as NAME=value lines (for the local environment editor)
//   (--user and launch-env change the account they run in: on macOS only the throwaway account of
//    check 35 is allowed; on Windows they need --allow-own-account, which run.md's Windows steps pass)
//   node run.js cli-trial [--cases a,b,c]     agent only: the command line stands in for Desktop
//   node run.js cleanup <root>
// `--root` defaults to this script's own folder, so the copy that `setup` makes runs as it is.
// See run.md for the sittings.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import crypto from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execFileSync, spawn } from 'node:child_process';

const SELF = fileURLToPath(import.meta.url);
const HERE = path.dirname(SELF);
const REQUESTS = 'requests.jsonl';
const PROMPT = 'Write the numbers one to forty in words, one per line.';
// Added to the real telemetry settings only so the first export comes within a second.
export const THROWAWAY_ACCOUNT = 'wh35probe'; // check 35's throwaway macOS account
const PROBE_ONLY = { OTEL_METRIC_EXPORT_INTERVAL: '1000' };

// The four telemetry settings from scripts/telemetry/env.js (the copy beside this script
// after `setup`, else the repository's own), plus the probe-only export interval.
export async function probeEnv(port) {
  for (const candidate of [path.join(HERE, 'env.js'), path.join(HERE, '..', '..', 'scripts', 'telemetry', 'env.js')]) {
    if (!fs.existsSync(candidate)) continue;
    const { telemetryEnv } = await import(pathToFileURL(candidate).href);
    return { ...telemetryEnv(port), ...PROBE_ONLY };
  }
  throw new Error('scripts/telemetry/env.js not found beside this script or in the repository');
}

function option(args, name) {
  const at = args.indexOf(name);
  return at === -1 ? undefined : args[at + 1];
}

// ---------- the scratch folder ----------

export function assertScratch(dir) {
  const resolved = path.resolve(dir);
  const real = (p) => { try { return fs.realpathSync(p); } catch { return path.resolve(p); } };
  const roots = [os.tmpdir(), real(os.tmpdir()), '/Users/Shared'].map((root) => path.resolve(root));
  const inside = roots.some((root) => resolved !== root && resolved.startsWith(root + path.sep));
  const name = path.basename(resolved);
  const parent = path.basename(path.dirname(resolved));
  // Either a folder of its own, or the check36 folder inside check 35's shared folder.
  const named = name.startsWith('wheelhouse-check36') || (name === 'check36' && parent.startsWith('wheelhouse-check35'));
  if (!inside || !named) {
    throw new Error(`Refusing to touch ${resolved}: not a wheelhouse-check36 folder (or check36 inside wheelhouse-check35) in a temporary place`);
  }
}

// `--user` and `launch-env` change the account they run in. On macOS that must be the
// throwaway account of check 35, never the director's own; on Windows the sitting has no
// throwaway account (it uses the director's own), so the steps must pass --allow-own-account.
export function assertIntendedAccount({ platform = process.platform, username = os.userInfo().username, args = [] } = {}) {
  if (platform === 'darwin') {
    if (username !== THROWAWAY_ACCOUNT) {
      throw new Error(`Refusing: this changes the signed-in account's own Claude settings or launch environment, and on macOS that is allowed only in check 35's throwaway account (${THROWAWAY_ACCOUNT}), not in "${username}". Use --file <settings.json> on a scratch file instead.`);
    }
  } else if (platform === 'win32') {
    if (!args.includes('--allow-own-account')) {
      throw new Error('Refusing: this changes this Windows account\'s own Claude settings or user environment variables. The Windows sitting uses the director\'s own account on purpose and undoes it afterwards; pass --allow-own-account to say that is intended.');
    }
  } else {
    throw new Error('Refusing: --user and launch-env are for the sittings on macOS and Windows.');
  }
}

function rootOf(args) {
  return path.resolve(option(args, '--root') ?? HERE);
}

function statePath(root) {
  return path.join(root, 'state.json');
}

function readState(root) {
  try {
    return JSON.parse(fs.readFileSync(statePath(root), 'utf8'));
  } catch {
    throw new Error(`No state.json in ${root}: run setup first`);
  }
}

function writeState(root, state) {
  fs.writeFileSync(statePath(root), JSON.stringify(state, null, 2) + '\n');
}

function freePort() {
  return new Promise((resolve, reject) => {
    const server = http.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

async function setup(args) {
  const root = path.resolve(option(args, '--root') ?? fs.mkdtempSync(path.join(os.tmpdir(), 'wheelhouse-check36-')));
  assertScratch(root);
  fs.mkdirSync(path.join(root, 'log'), { recursive: true });
  fs.mkdirSync(path.join(root, 'project'), { recursive: true });
  fs.writeFileSync(path.join(root, 'project', 'hello.txt'), 'hello from check 36\n');
  const script = path.join(root, 'run.js');
  if (path.resolve(SELF) !== script) fs.copyFileSync(SELF, script);
  for (const [from, to] of [
    [path.join(HERE, 'run.md'), 'run.md'],
    [path.join(HERE, '..', '..', 'scripts', 'telemetry', 'env.js'), 'env.js'],
  ]) {
    if (fs.existsSync(from) && path.resolve(from) !== path.join(root, to)) fs.copyFileSync(from, path.join(root, to));
  }
  let state = {};
  try { state = readState(root); } catch { /* first time */ }
  state.port = state.port ?? await freePort();
  state.root = root;
  writeState(root, state);
  // Readable and writable by any account on this computer (the Mac sitting uses two).
  if (process.platform !== 'win32') execFileSync('chmod', ['-R', 'a+rwX', root]);
  console.log(JSON.stringify({ root, project: path.join(root, 'project'), port: state.port, log: path.join(root, 'log') }, null, 2));
}

// ---------- the capture server ----------

function attr(attributes, key) {
  const found = (attributes ?? []).find((item) => item.key === key);
  const v = found?.value;
  return v?.stringValue ?? v?.intValue ?? v?.doubleValue ?? v?.boolValue;
}

// What is kept of one export: the service, the metric names and point counts, and token
// totals by kind. The account's email and IDs, the session and everything else are not kept.
export function summarise(body) {
  const out = { serviceName: null, serviceVersion: null, metrics: {}, tokens: {} };
  for (const rm of body?.resourceMetrics ?? []) {
    out.serviceName = attr(rm.resource?.attributes, 'service.name') ?? out.serviceName;
    out.serviceVersion = attr(rm.resource?.attributes, 'service.version') ?? out.serviceVersion;
    for (const sm of rm.scopeMetrics ?? []) {
      for (const metric of sm.metrics ?? []) {
        const points = (metric.sum ?? metric.gauge)?.dataPoints ?? [];
        out.metrics[metric.name] = (out.metrics[metric.name] ?? 0) + points.length;
        if (metric.name === 'claude_code.token.usage') {
          for (const point of points) {
            const kind = String(attr(point.attributes, 'type') ?? 'unknown');
            const value = Number(point.asInt ?? point.asDouble ?? 0);
            out.tokens[kind] = (out.tokens[kind] ?? 0) + value;
          }
        }
      }
    }
  }
  return out;
}

// Listens on 127.0.0.1 and appends one summary line per request to `file`.
export function startCapture({ port = 0, file }) {
  const seen = [];
  const server = http.createServer((req, res) => {
    let raw = '';
    req.setEncoding('utf8');
    req.on('data', (chunk) => { raw += chunk; });
    req.on('end', () => {
      let body = null;
      try { body = JSON.parse(raw); } catch { /* not JSON: counted, not read */ }
      const entry = { at: new Date().toISOString(), method: req.method, url: req.url, ...summarise(body) };
      seen.push(entry);
      if (file) fs.appendFileSync(file, JSON.stringify(entry) + '\n');
      res.writeHead(200, { 'content-type': 'application/json' }).end('{}');
    });
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => resolve({
      port: server.address().port,
      seen,
      close: () => new Promise((done) => server.close(done)),
    }));
  });
}

async function receiver(args) {
  const root = rootOf(args);
  const state = readState(root);
  const minutes = Number(option(args, '--minutes') ?? 30);
  const file = path.join(root, 'log', REQUESTS);
  if (args.includes('--detach')) {
    // Its own process group, so quitting the app whose session started it does not end it.
    const child = spawn(process.execPath, [SELF, 'receiver', '--root', root, '--minutes', String(minutes)], { detached: true, stdio: 'ignore', windowsHide: true });
    child.unref();
    await new Promise((resolve) => setTimeout(resolve, 1000));
    const pidFile = path.join(root, 'receiver.pid');
    console.log(fs.existsSync(pidFile) ? `receiver started in the background on 127.0.0.1:${state.port} (pid ${fs.readFileSync(pidFile, 'utf8').trim()}) for ${minutes} minutes` : `receiver did not start: is port ${state.port} in use?`);
    return;
  }
  let capture;
  try {
    capture = await startCapture({ port: state.port, file });
  } catch (error) {
    console.error(`Could not listen on 127.0.0.1:${state.port}: ${error.code ?? error.message}`);
    process.exit(1);
  }
  const pidFile = path.join(root, 'receiver.pid');
  fs.writeFileSync(pidFile, `${process.pid}\n`);
  try { if (process.platform !== 'win32') fs.chmodSync(file, 0o666); } catch { /* not there yet */ }
  console.log(`listening on 127.0.0.1:${capture.port} for ${minutes} minutes; summaries go to ${file}`);
  const stop = async () => {
    try { fs.rmSync(pidFile, { force: true }); } catch { /* gone */ }
    await capture.close();
    console.log(`stopped; requests seen: ${capture.seen.length}`);
    process.exit(0);
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
  setTimeout(stop, minutes * 60 * 1000);
}

function stop(args) {
  const pidFile = path.join(rootOf(args), 'receiver.pid');
  if (!fs.existsSync(pidFile)) return console.log('no receiver.pid: not running from this folder');
  const pid = Number(fs.readFileSync(pidFile, 'utf8').trim());
  try {
    process.kill(pid);
    console.log(`stopped receiver ${pid}`);
  } catch (error) {
    console.log(`receiver ${pid} was not running (${error.code})`);
  }
  fs.rmSync(pidFile, { force: true });
}

export function readRequests(file) {
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line));
}

export function describe(entries) {
  if (!entries.length) return 'Points arrived: NO (the receiver has seen no requests).';
  const lines = [`Points arrived: YES (${entries.length} request${entries.length === 1 ? '' : 's'}).`];
  const services = new Map();
  for (const e of entries) {
    const key = `${e.serviceName ?? 'unknown service'} ${e.serviceVersion ?? ''}`.trim();
    const bucket = services.get(key) ?? { requests: 0, metrics: {}, tokens: {} };
    bucket.requests += 1;
    for (const [name, n] of Object.entries(e.metrics)) bucket.metrics[name] = (bucket.metrics[name] ?? 0) + n;
    for (const [kind, n] of Object.entries(e.tokens)) bucket.tokens[kind] = (bucket.tokens[kind] ?? 0) + n;
    services.set(key, bucket);
  }
  for (const [key, b] of services) {
    lines.push(`- service.name ${key}: ${b.requests} requests`);
    lines.push(`  metrics (data points): ${Object.entries(b.metrics).map(([k, v]) => `${k} ${v}`).join(', ') || 'none'}`);
    if (Object.keys(b.tokens).length) lines.push(`  token usage sent (summed over exports): ${Object.entries(b.tokens).map(([k, v]) => `${k} ${v}`).join(', ')}`);
  }
  lines.push(`first ${entries[0].at}, last ${entries.at(-1).at}`);
  return lines.join('\n');
}

function read(args) {
  console.log(describe(readRequests(path.join(rootOf(args), 'log', REQUESTS))));
}

// ---------- user settings `env` ----------

export function settingsFile(args) {
  const file = option(args, '--file');
  if (file) return path.resolve(file);
  if (!args.includes('--user')) throw new Error('Say which file: --user (this account\'s user settings) or --file <settings.json>');
  return path.join(process.env.CLAUDE_CONFIG_DIR ?? path.join(os.homedir(), '.claude'), 'settings.json');
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map((k) => [k, canonical(value[k])]));
  return value;
}

// Adds `values` under `env`. Returns the new settings object and what each key held before
// (absent keys are left out of `previous`).
export function addEnv(settings, values) {
  const env = settings.env;
  if (env !== undefined && (env === null || typeof env !== 'object' || Array.isArray(env))) throw new Error('`env` in the settings file is not an object');
  const previous = {};
  for (const key of Object.keys(values)) if (env && key in env) previous[key] = env[key];
  return { settings: { ...settings, env: { ...(env ?? {}), ...values } }, previous };
}

// Takes `values` back out by key: a key still holding the value that was written goes back
// to what it held before (or is removed); a key someone changed since is left alone and named.
// An `env` that was absent before and is now empty is removed.
export function removeEnv(settings, values, previous, envExisted) {
  const env = { ...(settings.env ?? {}) };
  const left = [];
  for (const [key, value] of Object.entries(values)) {
    if (!(key in env)) continue;
    if (env[key] !== value) { left.push(key); continue; }
    if (key in previous) env[key] = previous[key]; else delete env[key];
  }
  const next = { ...settings };
  if (Object.keys(env).length === 0 && !envExisted) delete next.env; else next.env = env;
  return { settings: next, left };
}

async function settingsCommand(args) {
  const [action] = args;
  const root = rootOf(args);
  const state = readState(root);
  const values = await probeEnv(state.port);
  if (action === 'set') {
    if (!args.includes('--file') && args.includes('--user')) assertIntendedAccount({ args });
    const file = settingsFile(args);
    if (state.settings?.active) throw new Error(`Already set in ${state.settings.file}; run "settings unset" first`);
    const existed = fs.existsSync(file);
    const raw = existed ? fs.readFileSync(file, 'utf8') : null;
    const parsed = existed ? JSON.parse(raw) : {};
    const { settings, previous } = addEnv(parsed, values);
    const backup = path.join(root, 'settings.before.json');
    if (existed) fs.writeFileSync(backup, raw);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(settings, null, 2) + '\n');
    state.settings = {
      active: true, file, existed, backup: existed ? backup : null,
      sha256: existed ? crypto.createHash('sha256').update(raw).digest('hex') : null,
      envExisted: existed && parsed.env !== undefined, previous, written: values,
    };
    writeState(root, state);
    console.log(`Wrote ${Object.keys(values).length} keys under "env" in ${file} (${existed ? 'file existed' : 'file did not exist'}; keys that held a value before: ${Object.keys(previous).join(', ') || 'none'}).`);
    console.log('A running session keeps its startup values: start a NEW session, and restart Desktop where the sitting says so.');
  } else if (action === 'unset') {
    const s = state.settings;
    if (!s?.active) return console.log('Nothing to undo: settings were not set from this folder.');
    if (!fs.existsSync(s.file)) { s.active = false; writeState(root, state); return console.log(`${s.file} is gone; nothing to remove.`); }
    const { settings, left } = removeEnv(JSON.parse(fs.readFileSync(s.file, 'utf8')), s.written, s.previous, s.envExisted);
    if (!s.existed && Object.keys(settings).length === 0) {
      fs.rmSync(s.file);
      console.log(`Removed ${s.file}: it did not exist before and holds nothing else.`);
    } else {
      fs.writeFileSync(s.file, JSON.stringify(settings, null, 2) + '\n');
      console.log(`Removed the keys from "env" in ${s.file}.`);
    }
    if (left.length) console.log(`Left alone (changed since): ${left.join(', ')}`);
    if (s.existed) {
      const same = JSON.stringify(canonical(JSON.parse(fs.readFileSync(s.file, 'utf8')))) === JSON.stringify(canonical(JSON.parse(fs.readFileSync(s.backup, 'utf8'))));
      console.log(`Settings file now matches the copy taken before (same keys and values): ${same ? 'YES' : 'NO (compare by hand with ' + s.backup + ')'}`);
    }
    s.active = false;
    writeState(root, state);
  } else {
    throw new Error('Usage: settings set|unset (--user | --file <settings.json>)');
  }
}

// ---------- launch environment ----------

function ps(script) {
  return execFileSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', script], { encoding: 'utf8' }).trim();
}

const launch = {
  get(key) {
    if (process.platform === 'darwin') return execFileSync('launchctl', ['getenv', key], { encoding: 'utf8' }).trim() || null;
    if (process.platform === 'win32') return ps(`[Environment]::GetEnvironmentVariable('${key}','User')`) || null;
    throw new Error('launch-env is for macOS and Windows');
  },
  set(key, value) {
    if (process.platform === 'darwin') return execFileSync('launchctl', ['setenv', key, value]);
    return ps(`[Environment]::SetEnvironmentVariable('${key}','${value}','User')`);
  },
  unset(key) {
    if (process.platform === 'darwin') return execFileSync('launchctl', ['unsetenv', key]);
    return ps(`[Environment]::SetEnvironmentVariable('${key}',$null,'User')`);
  },
};

async function launchEnvCommand(args) {
  const [action] = args;
  const root = rootOf(args);
  const state = readState(root);
  const values = await probeEnv(state.port);
  if (action === 'set') {
    assertIntendedAccount({ args });
    if (state.launchEnv?.active) throw new Error('Already set; run "launch-env unset" first');
    const previous = {};
    for (const key of Object.keys(values)) previous[key] = launch.get(key);
    state.launchEnv = { active: true, previous, written: values };
    writeState(root, state);
    for (const [key, value] of Object.entries(values)) launch.set(key, value);
    const now = Object.fromEntries(Object.keys(values).map((key) => [key, launch.get(key)]));
    console.log(`Set ${Object.keys(values).length} variables (${process.platform === 'darwin' ? 'launchctl setenv' : 'user environment variables'}).`);
    console.log(`Read back: ${JSON.stringify(now)}`);
    console.log(process.platform === 'darwin'
      ? 'Quit Desktop completely, then reopen it from the Dock, Finder or `open -a Claude` (not by running its program from Terminal, which would give it the Terminal\'s environment).'
      : 'Quit Desktop completely (tray icon, Quit), then reopen it from the Start menu. If it still does not see them, sign out of Windows and in again, and say so in the notes.');
  } else if (action === 'unset') {
    const s = state.launchEnv;
    if (!s?.active) return console.log('Nothing to undo: launch-env was not set from this folder.');
    for (const [key, value] of Object.entries(s.written)) {
      if (launch.get(key) !== value) { console.log(`Left alone (changed since): ${key}`); continue; }
      if (s.previous[key] != null) launch.set(key, s.previous[key]); else launch.unset(key);
    }
    const left = Object.keys(s.written).filter((key) => launch.get(key) !== (s.previous[key] ?? null));
    console.log(left.length ? `Not back to how they were: ${left.join(', ')}` : 'Launch environment is back to how it was (read back, each variable).');
    s.active = false;
    writeState(root, state);
    console.log('Quit and reopen Desktop for it to lose them.');
  } else {
    throw new Error('Usage: launch-env set|unset');
  }
}

async function showEnv(args) {
  const state = readState(rootOf(args));
  for (const [key, value] of Object.entries(await probeEnv(state.port))) console.log(`${key}=${value}`);
}

// ---------- the agent-only trial: the command line stands in for Desktop ----------

function cleanEnv(extra = {}) {
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (key.startsWith('OTEL_') || key === 'CLAUDE_CODE_ENABLE_TELEMETRY' || key === 'CLAUDE_CONFIG_DIR') delete env[key];
  }
  return { ...env, ...extra };
}

function runClaude({ cwd, env }) {
  return new Promise((resolve) => {
    const bin = process.env.CLAUDE_BIN ?? 'claude';
    let out = '';
    const child = spawn(bin, ['-p', process.platform === 'win32' ? `"${PROMPT}"` : PROMPT, '--max-turns', '1'], {
      cwd, env, shell: process.platform === 'win32', stdio: ['ignore', 'pipe', 'pipe'],
    });
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { out += d; });
    const timer = setTimeout(() => child.kill(), 90000);
    child.on('close', (code) => { clearTimeout(timer); resolve({ code, out: out.trim().slice(0, 160) }); });
  });
}

const CASES = {
  'user-settings': 'the telemetry keys in the user settings\' env, nothing else',
  'project-settings': 'the same keys in the project\'s .claude/settings.json only',
  'launch-env': 'the same keys in the environment the command starts with',
  none: 'nothing set (the control)',
};

async function cliTrial(args) {
  const wanted = (option(args, '--cases') ?? Object.keys(CASES).join(',')).split(',');
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'wheelhouse-check36-cli-'));
  assertScratch(scratch);
  const results = [];
  try {
    for (const name of wanted) {
      if (!CASES[name]) throw new Error(`Unknown case ${name}`);
      const file = path.join(scratch, `${name}.jsonl`);
      const capture = await startCapture({ port: 0, file });
      const values = await probeEnv(capture.port);
      const config = path.join(scratch, `${name}-config`);
      const project = path.join(scratch, `${name}-project`);
      fs.mkdirSync(config, { recursive: true });
      fs.mkdirSync(path.join(project, '.claude'), { recursive: true });
      if (name === 'user-settings') fs.writeFileSync(path.join(config, 'settings.json'), JSON.stringify({ env: values }, null, 2));
      if (name === 'project-settings') fs.writeFileSync(path.join(project, '.claude', 'settings.json'), JSON.stringify({ env: values }, null, 2));
      const env = cleanEnv({ CLAUDE_CONFIG_DIR: config, ...(name === 'launch-env' ? values : {}) });
      const ran = await runClaude({ cwd: project, env });
      await new Promise((resolve) => setTimeout(resolve, 3000));
      await capture.close();
      results.push({ case: name, means: CASES[name], exit: ran.code, said: ran.out, ...(() => {
        const entries = capture.seen;
        const metrics = {};
        for (const e of entries) for (const [k, v] of Object.entries(e.metrics)) metrics[k] = (metrics[k] ?? 0) + v;
        return { requests: entries.length, services: [...new Set(entries.map((e) => e.serviceName))], metrics };
      })() });
    }
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
  console.log(JSON.stringify(results, null, 2));
}

function cleanup(args) {
  assertScratch(args[0]);
  fs.rmSync(path.resolve(args[0]), { recursive: true, force: true });
  console.log(`removed ${path.resolve(args[0])}`);
}

const COMMANDS = {
  setup, receiver, stop, read, cleanup,
  settings: settingsCommand,
  'launch-env': launchEnvCommand,
  'show-env': showEnv,
  'cli-trial': cliTrial,
};

if (process.argv[1] && fs.realpathSync(process.argv[1]) === fs.realpathSync(SELF)) {
  const [command, ...rest] = process.argv.slice(2);
  if (!COMMANDS[command]) {
    console.error('Usage: node run.js setup | receiver | stop | read | settings set|unset | launch-env set|unset | show-env | cli-trial | cleanup <root>');
    process.exit(2);
  }
  try {
    await COMMANDS[command](rest);
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}
