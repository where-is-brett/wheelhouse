// probes/40-mod-headless/run.js
// Check 40: what a mod can do with no screen. In throwaway folders under the temporary folder
// it runs, on the probe mod beside this file:
//   validate  `claude plugin validate --json` on a scratch copy of the probe, and on the
//             repository's own plugin;
//   test      `claude plugin test` on the copy with HOME set to an empty folder, so no
//             sign-in is there (`claude auth status` is run the same way to show it);
//   digest    `claude -p "/digest"`: what the classic hook saw, and whether a model turn ran;
//   ci        the same validate and test runs, and the help text, on Claude Code 2.1.278,
//             fetched with npx (says plainly if npx can't fetch it), and a table of releases
//             run on the repository as it stands. What depends on the repository is written
//             under `split` names (validate-repo-split-<version>.json, ci-versions-split.txt):
//             the files without `split` were recorded in Task 1, before the mod was split
//             into files, and a re-run leaves them as they were;
//   stream    two long-lived `claude -p --input-format stream-json` sessions: A sends an
//             ordinary message, then a `probe-drop:` message while idle, and the timer's
//             third fire finds the session idle; B starts a long turn (a story to write),
//             sends a `probe-drop:` message while it runs, and the timer's third fire finds
//             the turn running. Each is left open for 30 seconds after the timer's prompt.
// Every result goes to the probe's log folder (~/.wheelhouse-probes/40-mod-headless/). The
// reports worth keeping are also written, with the home folder as <home>, the repository as
// <repo> and scratch folders as <scratch>, to probes/40-mod-headless/reports/. At the end
// it removes the scratch folders and, after listing them, the folders under
// ~/.claude/projects/ whose names match the scratch projects' paths. Nothing else changes.
// Run as: node probes/40-mod-headless/run.js [validate] [test] [digest] [ci] [stream]
// (no argument runs every part). Each live session costs a few cents of usage.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { probeLogDir, appendJsonl } from '../lib/log.js';
import { makeScratchProject, assertUnderTmp } from '../lib/scratch.js';

const CHECK = '40-mod-headless';
const probeDir = fileURLToPath(new URL('.', import.meta.url)).replace(/\/$/, '');
const repoDir = path.resolve(probeDir, '..', '..');
const reportsDir = path.join(probeDir, 'reports');
const logDir = probeLogDir(CHECK);
const resultsFile = path.join(logDir, 'results.jsonl');
const claudeBin = execFileSync('which', ['claude'], { encoding: 'utf8' }).trim();
const CI_VERSION = '2.1.278';
const CI_SCAN = ['2.1.278', '2.1.280', '2.1.284', '2.1.288', '2.1.292', '2.1.295', '2.1.296', '2.1.299', '2.1.302'];

const asked = process.argv.slice(2);
const wants = (part) => asked.length === 0 || asked.includes(part);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// The test file written into the scratch copy only: the repository's own `claude plugin test .`
// would otherwise find it under probes/.
const TEST_FILE = `import { test, expect, mock } from 'claude-code/testing'

function world(on: any) {
  mock.clock(on)
  const files: Record<string, string> = {}
  on('fs.read', ($: any, e: any) => ({ value: files[e.path] ?? '' }))
  on('fs.write', ($: any, e: any) => { files[e.path] = e.content; return { value: undefined } })
  on('command.register', ($: any, e: any) => ({ value: { command: e.name } }))
  on('prompt.submit', ($: any, e: any) => ({ text: e.text, origin: e.origin }))
}

test('the digest command answers its text', async ($, on) => {
  world(on)
  const result = await $.command.run({ command: 'digest' })
  expect(result.text).toBe('probe digest')
})

test('a prompt beginning probe-drop: is dropped; another passes', async ($, on) => {
  world(on)
  const dropped = await $.prompt.submit({ text: 'probe-drop: one', wait: false, origin: { kind: 'sdk' } })
  expect(dropped).toEqual({ drop: 'probe' })
  const kept = await $.prompt.submit({ text: 'hello', wait: false, origin: { kind: 'sdk' } })
  expect(kept).toMatchObject({ text: 'hello' })
})
`;

// What the run made, so undoing it removes exactly that.
const scratchDirs = [];
const mangledNames = [];
const startedAt = Date.now();

function track(dir) {
  assertUnderTmp(dir);
  scratchDirs.push(dir);
  mangledNames.push(path.basename(dir).replace(/[^A-Za-z0-9]/g, '-'));
  return dir;
}

// A session as one the director starts in a terminal would: none of this session's own
// variables, so it never attaches to this session.
function cleanEnv(extra = {}) {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^CLAUDE/.test(key)));
  return { ...env, ...extra };
}

// Text with the places of this computer taken out, for what goes into the repository.
function scrub(text) {
  let out = String(text);
  const pairs = [];
  for (const dir of scratchDirs) pairs.push([fs.realpathSync(dir), '<scratch>'], [dir, '<scratch>']);
  pairs.push([fs.realpathSync(repoDir), '<repo>'], [repoDir, '<repo>']);
  pairs.push([fs.realpathSync(os.homedir()), '<home>'], [os.homedir(), '<home>']);
  pairs.sort((a, b) => b[0].length - a[0].length);
  for (const [from, to] of pairs) out = out.split(from).join(to);
  // A plugin loaded from a folder takes the folder's name, which an error quotes in front of
  // the path (`<folder>: <repo>/hooks/…`); that name goes too.
  out = out.replace(new RegExp(`(?<![\\w-])${path.basename(repoDir).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?=: <repo>)`, 'g'), '<repo>');
  return out.replace(/\/Users\/[^/\s"]+/g, '<home>');
}

function saveReport(name, text, { keep = false } = {}) {
  fs.mkdirSync(reportsDir, { recursive: true });
  if (keep && fs.existsSync(path.join(reportsDir, name))) return;
  fs.writeFileSync(path.join(reportsDir, name), scrub(text).replace(/\s+$/, '') + '\n', 'utf8');
}

async function record(part, value) {
  await appendJsonl(resultsFile, { at: new Date().toISOString(), part, ...value });
  console.log(`--- ${part}\n${JSON.stringify(value, null, 2).slice(0, 4000)}`);
}

function readJsonl(file) {
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, 'utf8').trim().split('\n').filter(Boolean).map((line) => {
    try { return JSON.parse(line); } catch { return { unparsed: line }; }
  });
}

function runClaude(args, { cwd, env, input }) {
  const r = spawnSync(claudeBin, args, { cwd, env, input, encoding: 'utf8', timeout: 180000, maxBuffer: 32 * 1024 * 1024 });
  return { status: r.status, signal: r.signal, error: r.error ? String(r.error) : undefined, stdout: String(r.stdout ?? ''), stderr: String(r.stderr ?? '') };
}

function parseEvents(stdout) {
  return stdout.split('\n').filter(Boolean).map((line) => {
    try { return JSON.parse(line); } catch { return { unparsed: line.slice(0, 200) }; }
  });
}

// An event cut down to what the note needs.
function slim(event, t) {
  const out = { t, type: event.type, ...(event.subtype ? { subtype: event.subtype } : {}) };
  if (event.type === 'assistant') {
    out.blocks = (event.message?.content ?? []).map((b) => (b.type === 'text' ? `text: ${String(b.text).slice(0, 80)}` : b.type === 'tool_use' ? `tool_use: ${b.name}` : b.type));
  }
  if (event.type === 'user') {
    out.blocks = Array.isArray(event.message?.content) ? event.message.content.map((b) => b.type) : [typeof event.message?.content === 'string' ? `text: ${event.message.content.slice(0, 80)}` : 'other'];
  }
  if (event.type === 'result') {
    Object.assign(out, { isError: event.is_error === true, numTurns: event.num_turns, result: String(event.result ?? '').slice(0, 120), stopReason: event.stop_reason, durationMs: event.duration_ms });
  }
  return out;
}

// The plugin the sessions load: a scratch copy of the probe, with the test file beside it.
function makePlugin() {
  const dir = track(fs.mkdtempSync(path.join(os.tmpdir(), 'wheelhouse-probe-40-plugin-')));
  for (const part of ['.claude-plugin', 'hooks']) fs.cpSync(path.join(probeDir, part), path.join(dir, part), { recursive: true });
  fs.writeFileSync(path.join(dir, 'probe.test.ts'), TEST_FILE);
  return dir;
}

const sessionFlags = (plugin) => ['--plugin-dir', plugin, '--setting-sources', 'project'];

// A long-lived stream-json session. `script(ctl)` drives it; the session is closed when the
// script returns. Resolves what the events, the mod's logs and the hook's log held.
async function streamSession({ label, plugin, script, extraArgs = [] }) {
  const project = await makeScratchProject({ name: `40-${label}` });
  track(project.dir);
  const args = ['-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose',
    '--max-turns', '6', '--debug-file', path.join(logDir, `debug-stream-${label}.txt`), ...sessionFlags(plugin), ...extraArgs];
  const child = spawn(claudeBin, args, { cwd: project.dir, env: cleanEnv(), stdio: ['pipe', 'pipe', 'pipe'] });
  const t0 = Date.now();
  const events = [];
  const raw = [];
  let stderr = '';
  let buffered = '';
  let exited = false;
  child.stdout.on('data', (chunk) => {
    buffered += chunk.toString('utf8');
    let newline;
    while ((newline = buffered.indexOf('\n')) >= 0) {
      const line = buffered.slice(0, newline);
      buffered = buffered.slice(newline + 1);
      let event;
      try { event = JSON.parse(line); } catch { continue; }
      raw.push(event);
      events.push(slim(event, Date.now() - t0));
    }
  });
  child.stderr.on('data', (chunk) => { stderr = (stderr + chunk.toString('utf8')).slice(-1500); });
  const closed = new Promise((resolve) => { child.on('close', (code) => { exited = true; resolve(code); }); child.on('error', () => { exited = true; resolve(1); }); });
  child.stdin.on('error', () => {});
  const sends = [];
  const modLogFile = path.join(project.dir, 'probe-40-mod.jsonl');
  const ctl = {
    t: () => Date.now() - t0,
    sleep,
    send(text) {
      sends.push({ t: Date.now() - t0, text });
      child.stdin.write(`${JSON.stringify({ type: 'user', message: { role: 'user', content: text }, parent_tool_use_id: null })}\n`);
    },
    modLog: () => readJsonl(modLogFile),
    results: () => events.filter((e) => e.type === 'result').length,
    async waitFor(test, timeoutMs) {
      const end = Date.now() + timeoutMs;
      while (!test() && !exited && Date.now() < end) await sleep(250);
      return test();
    },
  };
  let scriptError;
  try { await script(ctl); } catch (err) { scriptError = String(err); }
  child.stdin.end();
  const killer = setTimeout(() => child.kill('SIGKILL'), 20000);
  const exitCode = await closed;
  clearTimeout(killer);

  const sessionId = raw.find((e) => e.type === 'system' && e.subtype === 'init')?.session_id ?? null;
  const rel = (iso) => new Date(iso).getTime() - t0;
  const modLog = readJsonl(modLogFile).map((r) => ({ t: rel(r.at), ...Object.fromEntries(Object.entries(r).filter(([k]) => k !== 'at')) }));
  const partLog = readJsonl(path.join(project.dir, 'probe-40-part.jsonl')).map((r) => ({ t: rel(r.at), ...Object.fromEntries(Object.entries(r).filter(([k]) => k !== 'at')) }));
  const hookLog = readJsonl(path.join(project.dir, 'probe-40-hook.jsonl')).map((r) => ({ t: rel(r.at), prompt: r.prompt }));

  // The transcript Claude Code kept, for whether a dropped text reached it.
  const transcripts = [];
  const projectsRoot = path.join(os.homedir(), '.claude', 'projects');
  const mangled = path.basename(project.dir).replace(/[^A-Za-z0-9]/g, '-');
  for (const name of fs.existsSync(projectsRoot) ? fs.readdirSync(projectsRoot) : []) {
    if (!name.endsWith(mangled)) continue;
    for (const file of fs.readdirSync(path.join(projectsRoot, name))) {
      if (!file.endsWith('.jsonl')) continue;
      const text = fs.readFileSync(path.join(projectsRoot, name, file), 'utf8');
      transcripts.push({
        file: file === `${sessionId}.jsonl` ? '<session id>.jsonl' : file,
        lines: text.trim().split('\n').length,
        holdsDroppedText: /probe-drop:/.test(text),
        holdsTimerPrompt: /probe: timer prompt/.test(text),
        userPrompts: text.trim().split('\n').map((l) => { try { return JSON.parse(l); } catch { return null; } })
          .filter((r) => r?.type === 'user' && typeof r.message?.content === 'string')
          .map((r) => r.message.content.slice(0, 80)),
      });
    }
  }
  const debug = path.join(logDir, `debug-stream-${label}.txt`);
  const debugText = fs.existsSync(debug) ? fs.readFileSync(debug, 'utf8') : '';
  const debugLines = debugText.split('\n').filter((l) => /probe:|probe-drop|prompt\.submit|hooks module|dropped|timer prompt|wheelhouse-probe-40/i.test(l)).slice(0, 40).map((l) => l.slice(0, 300));
  const eventsHoldDroppedText = /probe-drop:/.test(raw.map((e) => JSON.stringify(e)).join('\n').replace(/"result":"[^"]*"/g, ''));
  return { label, sessionId, exitCode, scriptError, stderr, sends, eventsHoldDroppedText, events, modLog, partLog, hookLog, transcripts, debugLines };
}

function summariseTimer(session) {
  const fires = session.modLog.filter((r) => r.event === 'clock.every').map((r) => ({ fire: r.fire, t: r.t }));
  const called = session.modLog.find((r) => r.event === 'prompt.submit called');
  const resolved = session.modLog.find((r) => r.event === 'prompt.submit resolved');
  const timerPrompt = session.partLog.find((r) => r.text === 'probe: timer prompt');
  return {
    sessionStartAt: session.modLog.find((r) => r.event === 'session.start')?.t ?? null,
    fires,
    submitCalledAt: called?.t ?? null,
    submitResolvedAt: resolved?.t ?? null,
    timerPromptSeenByHookAt: timerPrompt?.t ?? null,
    timerPromptOrigin: timerPrompt?.origin ?? null,
    resultsAt: session.events.filter((e) => e.type === 'result').map((e) => ({ t: e.t, result: e.result, numTurns: e.numTurns })),
    lastFireAt: fires.at(-1)?.t ?? null,
    endedAt: session.events.at(-1)?.t ?? null,
  };
}

const outputs = {};

// ---- validate -----------------------------------------------------------------------------
let plugin = null;
if (wants('validate') || wants('test') || wants('digest') || wants('ci') || wants('stream')) plugin = makePlugin();
// A debug log is appended to, so each run starts them afresh.
for (const name of fs.readdirSync(logDir)) if (name.startsWith('debug-')) fs.rmSync(path.join(logDir, name), { force: true });

try {
  if (wants('validate')) {
    const probeReport = runClaude(['plugin', 'validate', '--json', plugin], { cwd: os.tmpdir(), env: cleanEnv() });
    saveReport('validate-probe.json', probeReport.stdout);
    const repoReport = runClaude(['plugin', 'validate', '--json', repoDir], { cwd: os.tmpdir(), env: cleanEnv() });
    saveReport('validate-repo.json', repoReport.stdout);
    let probeNotes = null;
    try { probeNotes = JSON.parse(probeReport.stdout).contents.find((c) => c.type === 'hooks')?.notes; } catch { probeNotes = null; }
    await record('validate', { probeStatus: probeReport.status, probeNotes, repoStatus: repoReport.status, stderr: scrub(probeReport.stderr + repoReport.stderr).slice(0, 1000) });
  }

  // ---- test, with no sign-in -------------------------------------------------------------
  if (wants('test')) {
    const home = track(fs.mkdtempSync(path.join(os.tmpdir(), 'wheelhouse-probe-40-home-')));
    const env = cleanEnv({ HOME: home });
    const auth = runClaude(['auth', 'status'], { cwd: home, env });
    const test = runClaude(['plugin', 'test', plugin], { cwd: home, env });
    saveReport('plugin-test.txt', [
      '$ claude auth status   (HOME set to an empty folder)',
      auth.stdout.trim(),
      '',
      '$ claude plugin test <scratch copy of the probe>   (HOME set to the same empty folder)',
      test.stdout.trim(),
      test.stderr.trim(),
      `exit ${test.status}`,
    ].join('\n'));
    let loggedIn = null;
    try { loggedIn = JSON.parse(auth.stdout).loggedIn; } catch { loggedIn = null; }
    await record('test', { loggedInWithEmptyHome: loggedIn, status: test.status, stdout: scrub(test.stdout).slice(0, 1500), stderr: scrub(test.stderr).slice(0, 1000) });
  }

  // ---- the release CI pinned before this plan ----------------------------
  if (wants('ci')) {
    const npx = (args, { cwd, env }) => spawnSync('npx', ['--yes', `@anthropic-ai/claude-code@${CI_VERSION}`, ...args], { cwd, env, encoding: 'utf8', timeout: 240000, maxBuffer: 32 * 1024 * 1024 });
    const scratch = track(fs.mkdtempSync(path.join(os.tmpdir(), 'wheelhouse-probe-40-ci-')));
    const home = track(fs.mkdtempSync(path.join(os.tmpdir(), 'wheelhouse-probe-40-cihome-')));
    const env = cleanEnv({ HOME: home });
    const version = npx(['--version'], { cwd: scratch, env });
    if (version.status !== 0) {
      saveReport('ci-2.1.278-help.txt', `npx could not fetch @anthropic-ai/claude-code@${CI_VERSION}: exit ${version.status}\n${version.stderr}`, { keep: true });
      await record('ci', { fetched: false, status: version.status, stderr: scrub(version.stderr).slice(0, 800) });
    } else {
      const help = ['plugin --help', 'plugin validate --help', 'plugin test --help'].map((line) => {
        const r = npx(line.split(' '), { cwd: scratch, env });
        return `$ claude ${line}   (${CI_VERSION}, exit ${r.status})\n${(r.stdout + r.stderr).trim()}`;
      });
      saveReport('ci-2.1.278-help.txt', `claude --version: ${version.stdout.trim()}\n\n${help.join('\n\n')}`, { keep: true });
      const validate = (target) => npx(['plugin', 'validate', '--json', target], { cwd: scratch, env });
      const manifest = path.join(repoDir, '.claude-plugin', 'plugin.json');
      const onProbe = validate(plugin);
      const onRepo = validate(repoDir);
      const onRepoManifest = validate(manifest);
      saveReport('validate-probe-2.1.278.json', onProbe.stdout, { keep: true });
      saveReport('validate-repo-split-2.1.278.json', onRepo.stdout);
      saveReport('validate-repo-split-plugin-json-2.1.278.json', onRepoManifest.stdout);
      const current = runClaude(['plugin', 'validate', '--json', manifest], { cwd: os.tmpdir(), env: cleanEnv() });
      saveReport('validate-repo-split-plugin-json.json', current.stdout);
      // CI has no sign-in and no variables of ours: the test command as that release gives it
      // there, then with the variable the release names for hooks modules.
      const test = npx(['plugin', 'test', plugin], { cwd: scratch, env });
      const testWithVariable = npx(['plugin', 'test', plugin], { cwd: scratch, env: { ...env, CLAUDE_CODE_ENABLE_FUNCTION_HOOKS: '1' } });
      const shown = (label, r) => [`$ ${label}`, r.stdout.trim(), r.stderr.trim(), `exit ${r.status}`].filter((l) => l !== '').join('\n');
      saveReport('plugin-test-2.1.278.txt', [
        shown(`claude plugin test <scratch copy of the probe>   (${CI_VERSION}, HOME set to an empty folder)`, test),
        '',
        shown(`CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1 claude plugin test <scratch copy of the probe>   (${CI_VERSION}, HOME set to an empty folder)`, testWithVariable),
      ].join('\n'), { keep: true });
      // The releases between, as a table: does `plugin test` run with an empty HOME and no
      // variable, on the probe and on the repository, and what does `plugin validate --json`
      // on the repository root list? Each release's report is saved as
      // validate-repo-split-<version>.json and the table as ci-versions-split.txt;
      // ci-versions.txt and validate-repo-<version>.json are Task 1's, left as they are.
      const table = [];
      for (const v of CI_SCAN) {
        const run = (args, extra = {}) => spawnSync('npx', ['--yes', `@anthropic-ai/claude-code@${v}`, ...args], { cwd: scratch, env: { ...env, ...extra }, encoding: 'utf8', timeout: 240000, maxBuffer: 32 * 1024 * 1024 });
        const t = run(['plugin', 'test', plugin]);
        const root = run(['plugin', 'validate', '--json', repoDir]);
        const onRepoTest = run(['plugin', 'test', repoDir]);
        let listed = 'no report';
        try {
          const d = JSON.parse(root.stdout);
          const errors = [d.manifest, ...d.contents].reduce((n, part) => n + (Array.isArray(part?.errors) ? part.errors.length : 0), 0);
          listed = `${d.contents.length} contents, target type ${d.manifest.type}, ${errors} error${errors === 1 ? '' : 's'}`;
        } catch { /* keep the default */ }
        saveReport(`validate-repo-split-${v}.json`, root.stdout);
        const passed = /(\d+) pass\b/.exec(t.stdout)?.[1];
        const failed = /(\d+) fail\b/.exec(t.stdout)?.[1];
        const first = (t.stdout + t.stderr).split('\n').map((l) => l.trim()).find((l) => l && !/^npm /.test(l) && !/^probe\.test\.ts:?$/.test(l)) ?? '';
        const outcome = passed !== undefined ? `${passed} pass, ${failed ?? '?'} fail` : first;
        const repoPassed = /(\d+) pass\b/.exec(onRepoTest.stdout)?.[1];
        const repoFailed = /(\d+) fail\b/.exec(onRepoTest.stdout)?.[1];
        const repoFirst = (onRepoTest.stdout + onRepoTest.stderr).split('\n').map((l) => l.trim()).find((l) => l && !/^npm /.test(l)) ?? '';
        const repoOutcome = repoPassed !== undefined ? `${repoPassed} pass, ${repoFailed ?? '?'} fail` : repoFirst;
        table.push(`${v} | plugin test on the probe, empty HOME, no variable: exit ${t.status}, ${outcome} | validate --json on the repository root: exit ${root.status}, ${listed} | plugin test on the repository: exit ${onRepoTest.status}, ${repoOutcome}`);
      }
      saveReport('ci-versions-split.txt', table.join('\n'));
      const contents = (r) => { try { return JSON.parse(r.stdout).contents.map((c) => ({ type: c.type, notes: c.notes })); } catch { return null; } };
      await record('ci', {
        fetched: true, version: version.stdout.trim(),
        probe: { status: onProbe.status, contents: contents(onProbe) },
        repoRoot: { status: onRepo.status, contents: contents(onRepo) },
        repoPluginJson: { status: onRepoManifest.status, contents: contents(onRepoManifest) },
        test: { status: test.status, stdout: scrub(test.stdout).slice(0, 800), stderr: scrub(test.stderr).slice(0, 400) },
        testWithVariable: { status: testWithVariable.status, stdout: scrub(testWithVariable.stdout).slice(0, 400) },
        table,
      });
    }
  }

  // ---- the command, headless -------------------------------------------------------------
  if (wants('digest')) {
    const project = await makeScratchProject({ name: '40-digest' });
    track(project.dir);
    const run = runClaude(['-p', '/digest', '--output-format', 'stream-json', '--verbose', '--max-turns', '2',
      '--debug-file', path.join(logDir, 'debug-digest.txt'), ...sessionFlags(plugin)], { cwd: project.dir, env: cleanEnv() });
    const events = parseEvents(run.stdout);
    const final = events.findLast((e) => e.type === 'result');
    const summary = {
      exitCode: run.status,
      stderr: scrub(run.stderr).slice(0, 600),
      eventTypes: events.map((e) => `${e.type}${e.subtype ? `:${e.subtype}` : ''}`),
      assistantEvents: events.filter((e) => e.type === 'assistant').length,
      result: final ? { text: String(final.result ?? '').slice(0, 200), isError: final.is_error, numTurns: final.num_turns, costUsd: final.total_cost_usd, usage: final.usage ? { input: final.usage.input_tokens, output: final.usage.output_tokens } : null } : null,
      hookSaw: readJsonl(path.join(project.dir, 'probe-40-hook.jsonl')).map((r) => ({ prompt: r.prompt, keys: r.keys })),
      modLog: readJsonl(path.join(project.dir, 'probe-40-mod.jsonl')).map((r) => ({ event: r.event, command: r.command })),
      partLog: readJsonl(path.join(project.dir, 'probe-40-part.jsonl')).map((r) => ({ event: r.event, text: r.text, origin: r.origin, command: r.command, answer: r.answer })),
    };
    outputs.digest = summary;
    await record('digest', summary);
  }

  // ---- long-lived sessions ---------------------------------------------------------------
  if (wants('stream')) {
    const resolvedLogged = (ctl) => ctl.modLog().some((r) => r.event === 'prompt.submit resolved');
    const idle = await streamSession({
      label: 'idle', plugin,
      async script(ctl) {
        await ctl.waitFor(() => ctl.modLog().some((r) => r.event === 'session.start'), 30000);
        ctl.send('Reply with the single word: ok.');
        await ctl.waitFor(() => ctl.results() >= 1, 90000);
        await ctl.sleep(1500);
        ctl.send('probe-drop: sent while idle');
        await ctl.sleep(6000);
        await ctl.waitFor(() => resolvedLogged(ctl), 90000);
        await ctl.sleep(30000);
      },
    });
    outputs.idle = { timer: summariseTimer(idle), ...idle };
    await record('stream-idle', { ...outputs.idle, events: undefined });
    const running = await streamSession({
      label: 'running', plugin,
      async script(ctl) {
        await ctl.waitFor(() => ctl.modLog().some((r) => r.event === 'session.start'), 30000);
        ctl.send('Reply with the single word: ok.');
        await ctl.waitFor(() => ctl.results() >= 1, 90000);
        // A turn that is certain to run when the timer's third fire comes (15 s in): start it
        // just after the second fire, and send the dropped text while it runs.
        await ctl.waitFor(() => ctl.modLog().some((r) => r.event === 'clock.every' && r.fire === 2), 30000);
        await ctl.sleep(1500);
        ctl.send('Write a story of about 800 words about a lighthouse keeper. Use no tools.');
        await ctl.sleep(3000);
        ctl.send('probe-drop: sent while a turn runs');
        await ctl.waitFor(() => resolvedLogged(ctl), 120000);
        await ctl.sleep(30000);
      },
    });
    outputs.running = { timer: summariseTimer(running), ...running };
    await record('stream-running', { ...outputs.running, events: undefined });
    // A run of one part keeps what an earlier run of the others saved.
    const savedFile = path.join(reportsDir, 'sessions.json');
    const saved = fs.existsSync(savedFile) ? JSON.parse(fs.readFileSync(savedFile, 'utf8')) : {};
    saveReport('sessions.json', JSON.stringify({
      ...saved,
      ...(outputs.digest ? { digest: outputs.digest } : {}),
      idle: { ...outputs.idle, debugLines: undefined },
      running: { ...outputs.running, debugLines: undefined },
    }, null, 2));
  }
} finally {
  // ---- undo --------------------------------------------------------------------------------
  const projectsRoot = path.join(os.homedir(), '.claude', 'projects');
  const found = (fs.existsSync(projectsRoot) ? fs.readdirSync(projectsRoot) : [])
    .filter((name) => mangledNames.some((m) => name.endsWith(m)));
  const listing = found.map((name) => ({ folder: name.replace(/^.*(wheelhouse-probe-40-[A-Za-z0-9-]+)$/, '<projects>/…$1'), entries: fs.readdirSync(path.join(projectsRoot, name)).length }));
  console.log(`Removing from ~/.claude/projects: ${JSON.stringify(listing)}`);
  for (const name of found) {
    const folder = path.join(projectsRoot, name);
    if (path.dirname(folder) !== projectsRoot) throw new Error(`Refusing to remove ${folder}`);
    fs.rmSync(folder, { recursive: true, force: true });
  }
  for (const dir of scratchDirs) {
    assertUnderTmp(dir);
    fs.rmSync(dir, { recursive: true, force: true });
  }
  await appendJsonl(resultsFile, { at: new Date().toISOString(), part: 'undo', removedProjectFolders: listing, removedScratch: scratchDirs.length, seconds: Math.round((Date.now() - startedAt) / 1000) });
}

console.log(`Results: ${resultsFile}`);
