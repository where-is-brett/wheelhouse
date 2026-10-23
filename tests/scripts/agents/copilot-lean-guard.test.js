// tests/scripts/agents/copilot-lean-guard.test.js
// Lean's guard in shell, for a Mac where Node.js doesn't run (check 69; Part 5 Task 8, rulings P5-15, P5-33, P5-34 and
// P5-44). The guard is run as Copilot runs it: the real /bin/sh and /usr/bin/plutil, a PATH holding no `node`, and a home
// of the test's own. Those tests are skipped off macOS; the hook file's shape is checked everywhere.
import '../../helpers/homes.js';
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { standInTools } from '../../helpers/host-stand-ins.js';
import { tempFolder } from '../../helpers/homes.js';
import { GUARD_DEADLINE_MS, GUARD_TIMEOUT_SEC, HOOK_FILE } from '../../../scripts/lib/copilot-numbers.js';
import { AGENT_CONTROL, CONTROL_FILE } from '../../../scripts/lib/agent-control.js';
import { credentialPaths } from '../../../scripts/lib/credentials.js';
import { KNOWN_TOOLS, UNKNOWN_TOOL } from '../../../adapters/copilot/translate.js';
import { registration, file, writeRegistration } from '../../../adapters/copilot/hooks.js';
import { leanHookFile, leanGuardScript, GUARD_SCRIPT, LEAN_HOOK_COMMAND, PLUTIL_MISSING } from '../../../adapters/copilot/lean-hooks.js';
import { buildHome } from '../../../scripts/agents/copilot/home.js';
import { COULD_NOT_RUN, DEADLINE } from '../../../scripts/agents/copilot/hook-entry.js';

// Stand-ins for gh, glab, copilot and curl come first on the PATH; the last test asserts none ran.
const stand = standInTools();
after(() => stand.restore());

const mac = process.platform === 'darwin';
const onMac = { skip: !mac && 'the guard is for macOS: it runs /bin/sh and /usr/bin/plutil' };

// A PATH that starts with the stand-ins and holds no `node` (the plan's condition for these tests).
const bare = tempFolder('wh-bare-path-');
const NO_NODE_PATH = `${stand.dir}${path.delimiter}${bare}`;

// The guard as the kit ships it, in a folder of the test's own.
const scripts = tempFolder('wh-lean-guard-');
function guardFile(options = {}, name = GUARD_SCRIPT) {
  const target = path.join(scripts, name);
  fs.writeFileSync(target, leanGuardScript(options));
  return target;
}
const GUARD = guardFile();

// A Mac person's home and a project in it, made of plain folders and files (no git runs: a `.git` folder is enough).
const base = fs.realpathSync(tempFolder('wh-lean-home-'));
const HOME = path.join(base, 'home');
const PROJECT = path.join(HOME, 'Projects', 'shop');
const put = (file, text = 'x\n') => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
};
fs.mkdirSync(path.join(PROJECT, '.git'), { recursive: true });
put(path.join(PROJECT, 'README.md'));
put(path.join(PROJECT, 'src', 'app.js'));
put(path.join(PROJECT, 'AGENTS.md'));
put(path.join(PROJECT, '.github', 'hooks', 'theirs.json'), '{}\n');
put(path.join(PROJECT, '.wheelhouse', 'record', '2026-10-23.jsonl'), '{}\n');
put(path.join(PROJECT, '.wheelhouse', 'record', '.gitkeep'), '');
put(path.join(HOME, '.ssh', 'id_ed25519'));
fs.symlinkSync(path.join(PROJECT, '.github', 'hooks'), path.join(PROJECT, 'hooks-link'));
fs.symlinkSync(path.join(PROJECT, '.github', 'hooks', 'planted.json'), path.join(PROJECT, 'dangling.json'));

const ENV = { PATH: NO_NODE_PATH, HOME, TMPDIR: tempFolder('wh-lean-tmp-') };

function runGuard(input, { guard = GUARD, env = ENV, cwd = PROJECT } = {}) {
  const text = typeof input === 'string' ? input : JSON.stringify(input);
  const started = Date.now();
  const r = spawnSync('/bin/sh', [guard], { input: text, env, cwd, encoding: 'utf8', timeout: 60000 });
  return { ...r, ms: Date.now() - started };
}
const call = (toolName, toolArgs, cwd = PROJECT) => ({ sessionId: 's1', timestamp: 0, cwd, toolName, toolArgs });
const patch = (...lines) => ['*** Begin Patch', ...lines, '*** End Patch', ''].join('\n');

function allowed(r, what) {
  assert.equal(r.status, 0, `${what}: ${r.stdout}${r.stderr}`);
  assert.equal(r.stdout, '', `${what} is let through with no answer`);
}
function refused(r, what, reason) {
  assert.equal(r.status, 2, `${what}: exit 2 refuses even where the answer is not read (${r.stdout}${r.stderr})`);
  const out = JSON.parse(r.stdout);
  assert.equal(out.permissionDecision, 'deny', what);
  if (reason instanceof RegExp) assert.match(out.permissionDecisionReason, reason, what);
  else if (reason !== undefined) assert.equal(out.permissionDecisionReason, reason, what);
  return out.permissionDecisionReason;
}

test('the guard runs with no node on the PATH', onMac, () => {
  assert.equal(spawnSync('/bin/sh', ['-c', 'command -v node'], { env: ENV, encoding: 'utf8' }).status, 1, 'no node on the PATH');
  assert.equal(spawnSync('/bin/sh', ['-c', 'command -v node'], { env: { ...ENV, PATH: '/usr/bin:/bin' }, encoding: 'utf8' }).status, 1, 'nor where the guard looks');
  allowed(runGuard(call('view', { path: path.join(PROJECT, 'README.md') })), 'a read');
  refused(runGuard(call('apply_patch', patch(`*** Add File: ${path.join(PROJECT, '.github', 'hooks', 'mine.json')}`, '+{}'))), 'a write to a hook file', CONTROL_FILE);
  // It starts no program but the system's own, each by its full path: no node, no curl, no jq.
  const code = leanGuardScript().split('\n').filter((line) => !/^\s*#/.test(line)).join('\n');
  assert.doesNotMatch(code, /\b(node|curl|jq|wget|python3?|perl|osascript)\b/);
  assert.match(code, /\/usr\/bin\/plutil/);
});

test('a write to a control file is refused and a read is allowed', onMac, () => {
  const at = (...parts) => path.join(PROJECT, ...parts);
  const home = (...parts) => path.join(HOME, ...parts);
  const SECRET = /keys or the credentials/;
  const ENV_FILE = /\.env file/;
  const RECORD = /record/;
  const writes = [
    ['an added hook file', call('apply_patch', patch(`*** Add File: ${at('.github', 'hooks', 'x.json')}`, '+{}')), CONTROL_FILE],
    ['AGENTS.md at the root', call('apply_patch', patch(`*** Update File: ${at('AGENTS.md')}`, '@@', '-x', '+y')), CONTROL_FILE],
    ['AGENTS.md deeper down', call('create', { path: at('src', 'AGENTS.md') }), CONTROL_FILE],
    ['a relative path', call('edit', { path: '.vscode/settings.json' }), CONTROL_FILE],
    ['another case', call('create', { path: at('.VSCode', 'tasks.json') }), CONTROL_FILE],
    ['a patch moved onto a control file', call('apply_patch', patch(`*** Update File: ${at('src', 'app.js')}`, `*** Move to: ${at('.github', 'agents', 'x.agent.md')}`, '@@', '-x', '+y')), CONTROL_FILE],
    ['the second path of a patch', call('apply_patch', patch(`*** Add File: ${at('out.txt')}`, '+a', `*** Delete File: ${at('.gitattributes')}`)), CONTROL_FILE],
    ['git\'s own files', call('edit', { path: at('.git', 'config') }), CONTROL_FILE],
    ['a .git pointer file', call('create', { path: at('src', '.git') }), CONTROL_FILE],
    ['the person\'s Copilot hooks', call('create', { path: home('.copilot', 'hooks', 'wheelhouse.json') }), CONTROL_FILE],
    ['VS Code\'s user settings', call('edit', { path: '~/Library/Application Support/Code/User/settings.json' }), CONTROL_FILE],
    ['through a link to a control folder', call('create', { path: at('hooks-link', 'x.json') }), CONTROL_FILE],
    ['through a dangling link', call('apply_patch', patch(`*** Update File: ${at('dangling.json')}`, '+{}')), CONTROL_FILE],
    ['a .. that leads to a control file', call('create', { path: `${PROJECT}/src/../AGENTS.md` }), CONTROL_FILE],
    ['a .. below a folder that is not there', call('create', { path: `${PROJECT}/nowhere/../AGENTS.md` }), /could not tell where/],
    ['a credential folder', call('create', { path: home('.ssh', 'config') }), SECRET],
    ['a .env file', call('create', { path: at('config', '.env.local') }), ENV_FILE],
    ['an earlier record file', call('apply_patch', patch(`*** Update File: ${at('.wheelhouse', 'record', '2026-10-23.jsonl')}`, '@@', '-{}', '+[]')), RECORD],
    ['the record\'s folder file', call('apply_patch', patch(`*** Delete File: ${at('.wheelhouse', 'record', '.gitkeep')}`)), RECORD],
  ];
  for (const [what, input, reason] of writes) refused(runGuard(input), what, reason);
  // From a folder inside the project, the project's root is still the one that holds `.git`.
  refused(runGuard(call('create', { path: '../.github/hooks/x.json' }, at('src'))), 'from a subfolder, by a relative path', CONTROL_FILE);
  refused(runGuard(call('create', { path: at('.github', 'copilot-instructions.md') }, at('src'))), 'from a subfolder, by a full path', CONTROL_FILE);

  const reads = [
    ['a read of a file', call('view', { path: at('README.md') })],
    ['a read of a control file', call('view', { path: at('.github', 'hooks', 'theirs.json') })],
    ['a read of the record', call('view', { path: at('.wheelhouse', 'record', '2026-10-23.jsonl') })],
    ['a search in the project', call('rg', { pattern: 'x', paths: PROJECT })],
    ['a search with no folder named', call('glob', { pattern: '*.md' })],
    ['an edit of the project\'s code', call('edit', { path: at('src', 'app.js') })],
    ['a new file', call('apply_patch', patch(`*** Add File: ${at('src', 'new.js')}`, '+x'))],
    ['a new record file', call('apply_patch', patch(`*** Add File: ${at('.wheelhouse', 'record', '2026-10-24.jsonl')}`, '+{}'))],
    // The shell can't be parsed here, so it is let through: the board's lines say so (ruling P5-34).
    ['a shell command', call('bash', { command: 'echo x > AGENTS.md' })],
    ['a PowerShell command', call('powershell', { command: 'ls' })],
    ['a sub-agent', call('task', { prompt: 'x', agent_type: 'wheelhouse-builder' })],
    ['a web fetch', call('web_fetch', { url: 'https://example.com' })],
  ];
  for (const [what, input] of reads) allowed(runGuard(input), what);

  for (const [what, input, reason] of [
    ['a read of a key', call('view', { path: home('.ssh', 'id_ed25519') }), SECRET],
    ['a read of a credential file by ~', call('view', { path: '~/.aws/credentials' }), SECRET],
    ['a read of a .env file', call('view', { path: at('.env') }), ENV_FILE],
    ['a search of the home folder', call('rg', { pattern: 'token', paths: HOME }), /search the home folder/],
    ['a search for .env files', call('glob', { pattern: '**/.env*', paths: PROJECT }), ENV_FILE],
    ['a search inside a credential folder', call('rg', { pattern: 'x', paths: home('.ssh') }), SECRET],
  ]) refused(runGuard(input), what, reason);
});

test('a tool Wheelhouse doesn\'t know is refused, and every tool it knows is not refused as unknown', onMac, () => {
  refused(runGuard(call('apply_patch_v2', 'x')), 'a renamed tool', UNKNOWN_TOOL('apply_patch_v2'));
  refused(runGuard(call('multi_tool_use.parallel', { tool_uses: [] })), 'the parallel wrapper', UNKNOWN_TOOL('multi_tool_use.parallel'));
  refused(runGuard(call('github-create_issue', { title: 'x' })), 'a connector\'s tool, which no list holds', UNKNOWN_TOOL('github-create_issue'));
  // A name with quotes and a backslash still gives an answer that is JSON.
  refused(runGuard(call('a"b\\c', {})), 'an odd name', UNKNOWN_TOOL('a"b\\c'));
  for (const name of KNOWN_TOOLS.filter((n) => n !== 'multi_tool_use.parallel')) {
    const r = runGuard(call(name, name === 'apply_patch' ? patch(`*** Add File: ${path.join(PROJECT, 'k.txt')}`, '+k') : { path: path.join(PROJECT, 'README.md'), command: 'ls' }));
    if (r.status === 2) assert.notEqual(JSON.parse(r.stdout).permissionDecisionReason, UNKNOWN_TOOL(name), name);
  }
});

test('every control path, home control folder and credential folder from the lists is refused', onMac, () => {
  // Each pattern of AGENT_CONTROL, with a sample path for it: `**/` as a folder down, `/**` as a file below.
  for (const pattern of AGENT_CONTROL) {
    const sample = pattern.replace(/^\*\*\//, 'deep/down/').replace(/\/\*\*$/, '/inside/file.md');
    refused(runGuard(call('create', { path: path.join(PROJECT, ...sample.split('/')) })), pattern, CONTROL_FILE);
  }
  for (const folder of ['.copilot', '.agents', '.vscode/extensions', 'Library/Application Support/Code/User']) {
    refused(runGuard(call('create', { path: path.join(HOME, ...folder.split('/'), 'x.json') })), folder, CONTROL_FILE);
  }
  for (const credential of [...credentialPaths('darwin'), '.wheelhouse']) {
    refused(runGuard(call('view', { path: path.join(HOME, ...credential.split('/'), 'inside') })), credential, /keys or the credentials/);
  }
});

test('unreadable input, a field that can\'t be read and a missing parser each refuse', onMac, () => {
  for (const [what, input] of [
    ['input that is not JSON', 'not json'],
    ['no input at all', ''],
    ['a list, not an object', '[]'],
    ['no folder', { sessionId: 's1', toolName: 'view', toolArgs: { path: 'README.md' } }],
    ['a folder that is not a full path', call('view', { path: 'README.md' }, 'Projects/shop')],
    ['a folder that is not there', call('view', { path: 'README.md' }, path.join(base, 'gone'))],
    ['a tool name that is not a string', { ...call('view', {}), toolName: 7 }],
    ['no tool name', { sessionId: 's1', cwd: PROJECT }],
    ['a read with no path', call('view', {})],
    ['a path that is a list', call('view', { path: [path.join(PROJECT, 'README.md')] })],
    ['an empty path', call('create', { path: '' })],
    ['a search folder that is a list', call('rg', { pattern: 'x', paths: [PROJECT] })],
    ['a patch that is not a string', call('apply_patch', { patch: 'x' })],
    ['a patch that names no file', call('apply_patch', patch())],
    ['a patch with a header Wheelhouse doesn\'t know', call('apply_patch', patch(`*** Add File: ${path.join(PROJECT, 'a.txt')}`, '+a', `*** Copy File: ${path.join(PROJECT, 'b.txt')}`))],
    ['a patch line that names no path', call('apply_patch', patch('*** Add File:   ', '+a'))],
  ]) refused(runGuard(input), what);
  assert.equal(refused(runGuard('not json'), 'the words'), COULD_NOT_RUN);
  const fine = call('view', { path: path.join(PROJECT, 'README.md') });
  // The parser missing, without the options the guard needs (an older Mac's), failing, or answering nonsense: each is
  // refused with the plain line that says why (ruling P5-56).
  const missing = guardFile({ plutil: path.join(base, 'no-such-plutil') }, 'missing-plutil.sh');
  refused(runGuard(fine, { guard: missing }), 'with no parser', PLUTIL_MISSING);
  const older = path.join(base, 'older-plutil');
  fs.writeFileSync(older, '#!/bin/sh\ncase "$1 $3" in "-extract xml1") exec /usr/bin/plutil "$@" ;; esac\necho "plutil: unrecognized option: $1" >&2\nexit 1\n', { mode: 0o755 });
  refused(runGuard(fine, { guard: guardFile({ plutil: older }, 'older-plutil.sh') }), 'with a parser without -type and raw', PLUTIL_MISSING);
  const failing = path.join(base, 'failing-plutil');
  fs.writeFileSync(failing, '#!/bin/sh\nexit 1\n', { mode: 0o755 });
  refused(runGuard(fine, { guard: guardFile({ plutil: failing }, 'failing-plutil.sh') }), 'with a parser that fails', PLUTIL_MISSING);
  const nonsense = path.join(base, 'nonsense-plutil');
  fs.writeFileSync(nonsense, '#!/bin/sh\necho dictionary\n', { mode: 0o755 });
  refused(runGuard(fine, { guard: guardFile({ plutil: nonsense }, 'nonsense-plutil.sh') }), 'with a parser that answers nonsense', PLUTIL_MISSING);
  assert.match(PLUTIL_MISSING, /plutil/);
  // The same input with the real parser is let through, so it was the parser that refused.
  allowed(runGuard(fine), 'the same read');
  // No HOME: the credential folders can't be placed.
  const { HOME: _, ...noHome } = ENV;
  refused(runGuard(fine, { env: noHome }), 'with no home folder', COULD_NOT_RUN);
  // Its temporary file is removed, whether it allowed or refused.
  assert.deepEqual(fs.readdirSync(ENV.TMPDIR), []);
});

test('outside a Lean project the guard lets everything through, and inside one it guards every subfolder (ruling P5-56)', onMac, () => {
  // A repository with no record folder, and a plain folder: neither is a Lean project.
  const plain = path.join(HOME, 'Projects', 'other');
  fs.mkdirSync(path.join(plain, '.git'), { recursive: true });
  const loose = path.join(HOME, 'Downloads', 'notes');
  fs.mkdirSync(loose, { recursive: true });
  for (const folder of [plain, loose]) {
    allowed(runGuard(call('create', { path: path.join(folder, 'AGENTS.md') }, folder), { cwd: folder }), `${folder}: a control-file name`);
    allowed(runGuard(call('apply_patch_v2', 'x', folder), { cwd: folder }), `${folder}: a tool Wheelhouse doesn't know`);
  }
  // A record folder with no .git beside it isn't one either.
  const half = path.join(HOME, 'Projects', 'half');
  fs.mkdirSync(path.join(half, '.wheelhouse', 'record'), { recursive: true });
  allowed(runGuard(call('create', { path: path.join(half, 'AGENTS.md') }, half), { cwd: half }), 'a record folder without git');
  // Inside a Lean project's subfolder, the same write is refused.
  const deep = path.join(PROJECT, 'src', 'deep');
  fs.mkdirSync(deep, { recursive: true });
  refused(runGuard(call('create', { path: path.join(deep, 'AGENTS.md') }, deep), { cwd: deep }), 'a Lean project\'s subfolder', CONTROL_FILE);
  // A folder that can't be read or placed is refused, not let through.
  const shut = path.join(HOME, 'Projects', 'shut');
  fs.mkdirSync(path.join(shut, 'inner'), { recursive: true });
  fs.chmodSync(shut, 0o000);
  try {
    refused(runGuard(call('view', { path: 'x' }, path.join(shut, 'inner')), { cwd: HOME }), 'a folder that can\'t be read', COULD_NOT_RUN);
  } finally {
    fs.chmodSync(shut, 0o755);
  }
});

test('the guard answers well inside the hook\'s timeoutSec', onMac, async () => {
  const shipped = leanGuardScript();
  const deadline = Number(/^DEADLINE_SEC=(\d+)$/m.exec(shipped)?.[1]);
  assert.equal(deadline, GUARD_DEADLINE_MS / 1000, 'the design\'s deadline');
  assert.ok(deadline * 2 <= GUARD_TIMEOUT_SEC, 'well inside Copilot\'s time-out, which lets a hook through');
  assert.equal(leanHookFile().hooks.preToolUse[0].timeoutSec, GUARD_TIMEOUT_SEC);
  // An ordinary answer is quick.
  const quick = runGuard(call('apply_patch', patch(`*** Add File: ${path.join(PROJECT, '.github', 'hooks', 'x.json')}`, '+{}')));
  refused(quick, 'a quick refusal', CONTROL_FILE);
  assert.ok(quick.ms < 10000, `took ${quick.ms} ms`);
  // A parser that hangs, and input that never ends: each is refused at the deadline (a short one here).
  const slow = path.join(base, 'slow-plutil');
  fs.writeFileSync(slow, '#!/bin/sh\nexec /bin/sleep 30\n', { mode: 0o755 });
  const hanging = guardFile({ plutil: slow, deadlineSec: 2 }, 'slow-plutil.sh');
  const late = runGuard(call('view', { path: path.join(PROJECT, 'README.md') }), { guard: hanging });
  refused(late, 'a parser that hangs', DEADLINE);
  assert.ok(late.ms < 15000, `took ${late.ms} ms`);
  const short = guardFile({ deadlineSec: 2 }, 'short-deadline.sh');
  const open = await new Promise((resolve) => {
    const started = Date.now();
    const child = spawn('/bin/sh', [short], { env: ENV, cwd: PROJECT, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    child.stdout.on('data', (d) => { stdout += d; });
    child.stdin.write('{"cwd":');
    // The input is never ended. The guard's own answer ends it.
    child.on('close', (status) => { child.stdin.destroy(); resolve({ status, stdout, ms: Date.now() - started }); });
  });
  refused(open, 'input that never ends', DEADLINE);
  assert.ok(open.ms < 15000, `took ${open.ms} ms`);
});

test('the hook file is the same file Part 5 Task 2 writes, so only one is ever registered', () => {
  const lean = leanHookFile({ platform: 'darwin' });
  const home = tempFolder('wh-lean-hookfile-');
  // Ruling P5-15: both are HOOK_FILE in the person's hook folder, each with exactly one preToolUse entry.
  assert.equal(path.relative(home, file({ home })).split(path.sep).join('/'), `hooks/${HOOK_FILE}`);
  const kit = buildHome();
  assert.deepEqual(JSON.parse(kit.get(`hooks/${HOOK_FILE}`)), lean);
  assert.deepEqual(Object.keys(lean.hooks), ['preToolUse']);
  assert.equal(lean.hooks.preToolUse.length, 1);
  assert.equal(registration({ node: '/usr/local/bin/node', root: '/w', platform: 'darwin' }).hooks.preToolUse.length, 1);
  const [entry] = lean.hooks.preToolUse;
  assert.equal(entry.type, 'command');
  assert.equal(entry.bash, LEAN_HOOK_COMMAND);
  assert.equal(entry.command, LEAN_HOOK_COMMAND);
  assert.equal(entry.timeoutSec, GUARD_TIMEOUT_SEC);
  assert.equal(LEAN_HOOK_COMMAND, `/bin/sh -c 'exec /bin/sh "\${COPILOT_HOME:-$HOME/.copilot}/hooks/${GUARD_SCRIPT}"'`);
  // The helper's registration, written later on the same computer, replaces the shell guard's file.
  const target = file({ home });
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, kit.get(`hooks/${HOOK_FILE}`));
  writeRegistration({ home, node: '/usr/local/bin/node', root: '/w', platform: 'darwin' });
  assert.equal(JSON.parse(fs.readFileSync(target, 'utf8')).hooks.preToolUse.length, 1);
  assert.doesNotMatch(fs.readFileSync(target, 'utf8'), new RegExp(GUARD_SCRIPT.replace('.', '\\.')));
  // The kit ships the guard beside it, and the manifest lists both.
  assert.equal(kit.get(`hooks/${GUARD_SCRIPT}`), leanGuardScript({ comment: `adapters/copilot/home/hooks/${GUARD_SCRIPT} (built from adapters/copilot/lean-guard.sh by npm run copilot-home)` }));
  for (const name of [HOOK_FILE, GUARD_SCRIPT]) assert.match(kit.get('MANIFEST.txt'), new RegExp(`^[0-9a-f]{40} hooks/${name.replace('.', '\\.')}$`, 'm'));
  // The Windows form is sitting S2's.
  assert.throws(() => leanHookFile({ platform: 'win32' }), /Windows/);
});

test('the entry runs the guard from a home with a space and an apostrophe', onMac, () => {
  const kit = buildHome();
  const entry = leanHookFile().hooks.preToolUse[0].bash;
  for (const where of ['HOME', 'COPILOT_HOME']) {
    const person = path.join(tempFolder('wh-ann-'), 'Ann O\'Neil');
    const copilotHome = where === 'HOME' ? path.join(person, '.copilot') : path.join(person, 'Copilot Home');
    for (const name of [HOOK_FILE, GUARD_SCRIPT]) put(path.join(copilotHome, 'hooks', name), kit.get(`hooks/${name}`));
    put(path.join(person, 'shop', 'README.md'));
    fs.mkdirSync(path.join(person, 'shop', '.git'));
    fs.mkdirSync(path.join(person, 'shop', '.wheelhouse', 'record'), { recursive: true });
    const env = { PATH: NO_NODE_PATH, HOME: person, TMPDIR: ENV.TMPDIR, ...(where === 'COPILOT_HOME' ? { COPILOT_HOME: copilotHome } : {}) };
    const run = (input) => spawnSync('/bin/sh', ['-c', entry], { input: JSON.stringify(input), env, cwd: path.join(person, 'shop'), encoding: 'utf8' });
    allowed(run(call('view', { path: path.join(person, 'shop', 'README.md') }, path.join(person, 'shop'))), `${where}: a read`);
    refused(run(call('create', { path: path.join(person, 'shop', 'AGENTS.md') }, path.join(person, 'shop'))), `${where}: a write to a control file`, CONTROL_FILE);
    refused(run(call('create', { path: path.join(copilotHome, 'hooks', HOOK_FILE) }, path.join(person, 'shop'))), `${where}: a write to the hook file itself`, CONTROL_FILE);
  }
});

test('no real copilot, gh, glab or curl ran', () => {
  assert.deepEqual(stand.calls(), []);
});
