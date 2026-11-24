// tests/scripts/agents/copilot/hook-speed.test.js
// What keeps the Copilot hook entry quick: every Node.js start reads each module a step imports (on Windows that is most of
// an event's time), so an event loads only the steps that can change its answer. Each test starts the entry as Copilot does
// and reads which modules it loaded.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { Readable } from 'node:stream';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { runEntry } from '../../../../scripts/agents/copilot/hook-entry.js';
import { GUARD_DEADLINE_MS, PROMPT_DEADLINE_MS } from '../../../../scripts/agents/copilot/numbers.js';
import { decide as promptRecord } from '../../../../scripts/hooks/prompt-record.js';
import { decide as helmEnd } from '../../../../scripts/hooks/helm-end.js';
import { decide as stopGuard } from '../../../../scripts/hooks/stop-guard.js';
import claudeTools from '../../../../adapters/claude-code/tools.js';
import copilotTools from '../../../../adapters/copilot/tools.js';
import { writeProject } from '../../../../scripts/lib/projects.js';
import { tempFolder } from '../../../helpers/homes.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
const ENTRY = path.join(ROOT, 'scripts', 'agents', 'copilot', 'hook-entry.js');
const rel = (file) => path.relative(ROOT, file).split(path.sep).join('/');

// A Wheelhouse home with one registered project, and a loader that writes each module it loads to a log.
function world() {
  const base = fs.realpathSync(tempFolder('wh-speed-'));
  const home = path.join(base, 'home');
  const folder = path.join(base, 'shop');
  fs.mkdirSync(path.join(folder, '.git'), { recursive: true });
  fs.writeFileSync(path.join(folder, '.git', 'HEAD'), 'ref: refs/heads/main\n');
  const before = process.env.WHEELHOUSE_HOME;
  process.env.WHEELHOUSE_HOME = home;
  try {
    writeProject('shop', { folder, remoteUrl: null, host: 'local', repo: 'local/shop', connection: { host: 'local', mode: 'none', project: 'local/shop' } });
  } finally {
    if (before === undefined) delete process.env.WHEELHOUSE_HOME; else process.env.WHEELHOUSE_HOME = before;
  }
  const log = path.join(base, 'modules.log');
  const loader = path.join(base, 'log-modules.mjs');
  const hooks = `import fs from 'node:fs';\nexport async function load(url, context, next) { if (!url.startsWith('node:')) fs.appendFileSync(${JSON.stringify(log)}, url + '\\n'); return next(url, context); }\n`;
  const hooksFile = path.join(base, 'log-hooks.mjs');
  fs.writeFileSync(hooksFile, hooks);
  fs.writeFileSync(loader, `import { register } from 'node:module';\nregister(${JSON.stringify(pathToFileURL(hooksFile).href)});\n`);
  return { home, folder, log, loader };
}

// Starts the entry for `event` with `input` on stdin, as Copilot does; the modules it loaded, relative to the plugin.
function start(w, event, input, env = {}) {
  fs.rmSync(w.log, { force: true });
  const ran = spawnSync(process.execPath, ['--import', pathToFileURL(w.loader).href, ENTRY, event], {
    input: JSON.stringify({ sessionId: 's1', cwd: w.folder, ...input }), encoding: 'utf8', cwd: w.folder,
    env: { ...process.env, WHEELHOUSE_HOME: w.home, COPILOT_CLI_BINARY_VERSION: '1.0.101', ...env },
  });
  const loaded = fs.existsSync(w.log) ? fs.readFileSync(w.log, 'utf8').split('\n').filter(Boolean).map((url) => rel(fileURLToPath(url))) : [];
  return { ...ran, loaded };
}
const loadedAny = (loaded, ...names) => names.some((name) => loaded.includes(name));

test('a tool that only reads is checked by the tool guard alone: the STOP guard and the lineage hold are never loaded', () => {
  const w = world();
  const { status, stdout, loaded } = start(w, 'preToolUse', { toolName: 'view', toolArgs: { path: path.join(w.folder, 'README.md') } });
  assert.equal(status, 0, stdout);
  assert.ok(loaded.includes('scripts/hooks/tool-guard.js'), 'the tool guard still checks what a read touches');
  assert.equal(loadedAny(loaded, 'scripts/hooks/stop-guard.js', 'scripts/hooks/lineage-hold.js', 'scripts/hooks/session-start.js', 'scripts/desk/client.js'), false);
  assert.ok(loaded.length < 100, `${loaded.length} modules`);
});

test('a tool the guards don\'t name that only reads loads no step at all', () => {
  const w = world();
  const { status, loaded } = start(w, 'preToolUse', { toolName: 'list_agents', toolArgs: {} });
  assert.equal(status, 0);
  assert.equal(loadedAny(loaded, 'scripts/hooks/stop-guard.js', 'scripts/hooks/lineage-hold.js', 'scripts/hooks/tool-guard.js'), false);
});

test('a tool that changes something still goes through the STOP guard, whose refusal with no helper ends the call before the others load', () => {
  const w = world();
  const { status, loaded } = start(w, 'preToolUse', { toolName: 'bash', toolArgs: { command: 'ls' } });
  assert.equal(status, 2);
  assert.ok(loaded.includes('scripts/hooks/stop-guard.js'));
});

test('a why session still has its reads checked by the STOP guard, which refuses what its three tools don\'t name', () => {
  const w = world();
  const { status, loaded } = start(w, 'preToolUse', { toolName: 'list_agents', toolArgs: {} }, { WHEELHOUSE_ROLE: 'why' });
  assert.equal(status, 2);
  assert.ok(loaded.includes('scripts/hooks/stop-guard.js'));
});

test('the click record and the helm hand-back, which do nothing for Copilot, are not run', () => {
  const w = world();
  const click = start(w, 'postToolUse', { toolName: 'ask_user', toolArgs: { message: 'Ship it?' }, toolResult: { answers: { a: 'Yes' } } });
  assert.equal(loadedAny(click.loaded, 'scripts/hooks/prompt-record.js'), false, 'postToolUse');
  assert.equal(loadedAny(start(w, 'sessionEnd', {}).loaded, 'scripts/hooks/helm-end.js'), false, 'sessionEnd');
});

test('the steps left out are the ones that return nothing when a hook can only read (writeVia helper)', async () => {
  const prompt = { cwd: '/work/shop', session_id: 's1', hook_event_name: 'UserPromptSubmit', prompt: 'hello' };
  assert.equal(await promptRecord(prompt, { writeVia: 'helper' }), undefined);
  assert.equal(await promptRecord({ ...prompt, hook_event_name: 'PostToolUse', tool_name: claudeTools.ask, tool_input: { questions: [] }, tool_response: { answers: { a: 'Yes' } } }, { writeVia: 'helper' }), undefined);
  assert.equal(await helmEnd({ cwd: '/work/shop', session_id: 's1', hook_event_name: 'SessionEnd' }, { writeVia: 'helper', find: () => assert.fail('asked for the project') }), undefined);
});

test('the STOP guard lets every tool the entry leaves it out of through, under STOP and with no helper', async () => {
  const tools = [...claudeTools.read, ...claudeTools.halt, ...claudeTools.notify, ...copilotTools.read, ...copilotTools.halt, ...copilotTools.notify];
  assert.ok(tools.length > 10);
  for (const tool of tools) {
    const input = { cwd: '/work/shop', session_id: 's1', hook_event_name: 'PreToolUse', tool_name: tool, tool_input: {} };
    const deps = { writeVia: 'helper', bypass: false, helperUp: false, projectOf: () => ({ project: 'shop' }), dir: '/nowhere', env: {}, readTools: claudeTools.read.concat(copilotTools.read), haltTools: claudeTools.halt.concat(copilotTools.halt), notifyTools: claudeTools.notify.concat(copilotTools.notify) };
    assert.equal(await stopGuard(input, deps), undefined, tool);
  }
});

test('the prompt event, which the model waits on before every prompt, has a deadline well short of the guards\'; past it nothing is added and the prompt goes on', async () => {
  assert.ok(PROMPT_DEADLINE_MS <= GUARD_DEADLINE_MS / 2);
  const hung = async () => new Promise(() => {});
  const got = await runEntry('userPromptSubmitted', {
    stdin: Readable.from([JSON.stringify({ sessionId: 's1', cwd: '/work/shop', prompt: 'hello' })]),
    env: { COPILOT_CLI_BINARY_VERSION: '1.0.101' },
    deps: { client: { health: async () => ({ ok: true }), session: { mark: async () => ({ ok: true }) } }, projectOf: () => ({ project: 'shop' }), dir: '/nowhere', deadlineMs: 60, steps: { stopWord: hung } },
  });
  assert.deepEqual(got, { text: '', code: 0 });
});
