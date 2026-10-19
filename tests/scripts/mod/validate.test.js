// tests/scripts/mod/validate.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  checkMod, membersIn, moduleFiles, bridgeArgv, paneOrigin, bridgeImports,
  HOOKS, CALLS, FORBIDDEN_HOOKS, FORBIDDEN_CALLS, matchesForbidden,
} from '../../../scripts/mod/validate.js';
import { SIGNED_LABELS } from '../../../scripts/hooks/prompt-record.js';
import { CODE_ALPHABET } from '../../../scripts/state/card-lines.js';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const FOUR = 'session.start, session.measure, prompt.submit, command.run{command=go}';
const ARGV = "['node', `${$.plugin.root}/scripts/mod/bridge.js`]";
// The module's source as it stands: the bridge's one call in hooks/mod/ask.ts.
const SOURCES = {
  'hooks/register.ts': 'export const register = (on) => { on("session.start", async ($, e, next) => { await ask($, {}); return next(e) }) }',
  'hooks/mod/ask.ts': `export const ask = async ($, request) => $.process.run(${ARGV}, { stdin: JSON.stringify(request) })`,
};

// A report recorded from `claude plugin validate --json` in check 40, paths replaced by placeholders.
const fixture = (name) => JSON.parse(fs.readFileSync(path.join(ROOT, 'tests', 'fixtures', 'mod', name), 'utf8'));

// The module's files as the repository holds them.
function repoSources() {
  return Object.fromEntries(moduleFiles(ROOT).map((file) => [file, fs.readFileSync(path.join(ROOT, file), 'utf8')]));
}

// A folder of the given files (path: text), removed when the test ends.
function tree(t, files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wheelhouse-mod-check-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  for (const [file, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
    fs.writeFileSync(path.join(dir, file), text);
  }
  return dir;
}

// The report `claude plugin validate --json` gives, with the hooks file's notes.
function reportWith(notes, { success = true, errors = [] } = {}) {
  return {
    success,
    manifest: { type: 'marketplace', errors: [], notes: [] },
    contents: [
      { type: 'plugin', errors: [], notes: [] },
      { type: 'hooks', errors, notes },
    ],
  };
}

test('the first piece\'s report and source pass as before', () => {
  for (const name of ['validate-repo.json', 'validate-repo-2.1.292.json']) {
    const result = checkMod({ report: fixture(name), sources: repoSources() });
    assert.deepEqual(result.problems, [], name);
    assert.deepEqual(result.hooks, HOOKS);
    assert.deepEqual(result.calls, CALLS);
  }
});

test('a report from a mod in two files lists the imported file\'s hooks and calls under the entry file', () => {
  const result = checkMod({ report: fixture('validate-probe.json'), sources: SOURCES });
  assert.deepEqual(result.hooks, ['prompt.submit', 'session.start', 'command.run{command=digest}', 'ui.render{component=Pane, requestId=probe40}', 'ui.render{component=AbovePrompt}']);
  assert.deepEqual(result.calls, ['$.clock.every', '$.clock.now', '$.command.register', '$.fs.read', '$.fs.write', '$.prompt.submit']);
  assert.match(result.problems.join('\n'), /\$\.fs\.read/);
  assert.match(result.problems.join('\n'), /ui\.render\{component=Pane, requestId=probe40\}/);
});

test('the mod passes with exactly the four hooks and the calls the bridge needs', () => {
  const result = checkMod({
    report: reportWith([`./register.ts hooks: ${FOUR}`, `./register.ts calls: ${CALLS.join(', ')}`]),
    sources: SOURCES,
  });
  assert.deepEqual(result.problems, []);
  assert.deepEqual(result.hooks, HOOKS);
  assert.deepEqual(result.calls, CALLS);
});

test('a call made inside one of the module\'s own functions is read without its "via"', () => {
  const result = checkMod({
    report: reportWith([`./register.ts hooks: ${FOUR}`, './register.ts calls: $.process.run (via ask), $.session.id (via a, b), $.ui.toast']),
    sources: SOURCES,
  });
  assert.deepEqual(result.calls, ['$.process.run', '$.session.id', '$.ui.toast']);
  assert.ok(!result.problems.some((p) => /brief doesn't name/.test(p)), result.problems.join('\n'));
});

test('a hook beyond the four, or one missing, fails', () => {
  const extra = checkMod({ report: reportWith([`./register.ts hooks: ${FOUR}, tool.call`]), sources: SOURCES });
  assert.match(extra.problems.join('\n'), /tool\.call/);
  const missing = checkMod({ report: reportWith(['./register.ts hooks: session.start, prompt.submit']), sources: SOURCES });
  assert.match(missing.problems.join('\n'), /session\.measure/);
  assert.match(missing.problems.join('\n'), /command\.run\{command=go\}/);
  const none = checkMod({ report: reportWith([]), sources: SOURCES });
  assert.notDeepEqual(none.problems, []);
});

test('a call the brief does not name fails, in the report or in the source', () => {
  const reported = checkMod({ report: reportWith([`./register.ts hooks: ${FOUR}`, './register.ts calls: $.process.run, $.clock.now']), sources: SOURCES });
  assert.match(reported.problems.join('\n'), /\$\.clock\.now/);
  const scanned = checkMod({
    report: reportWith([`./register.ts hooks: ${FOUR}`]),
    sources: { ...SOURCES, 'hooks/mod/x.ts': 'const p = $.process; $.clock.now()' },
  });
  assert.match(scanned.problems.join('\n'), /\$\.clock\.now/);
  assert.match(scanned.problems.join('\n'), /\$\.process\b/);
});

test('a report that failed, or holds errors, fails', () => {
  const notes = [`./register.ts hooks: ${FOUR}`];
  assert.notDeepEqual(checkMod({ report: reportWith(notes, { success: false }), sources: SOURCES }).problems, []);
  assert.notDeepEqual(checkMod({ report: reportWith(notes, { errors: [{ path: 'modules', message: 'bad' }] }), sources: SOURCES }).problems, []);
  assert.notDeepEqual(checkMod({ report: null, sources: SOURCES }).problems, []);
});

test('a report listing a tool.check hook fails, even when HOOKS names it', () => {
  const report = reportWith([`./register.ts hooks: ${FOUR}, tool.check`]);
  const named = checkMod({ report, sources: SOURCES, allow: { hooks: [...HOOKS, 'tool.check'], calls: CALLS } });
  assert.match(named.problems.join('\n'), /tool\.check, which the mod must never hook/);
  const matched = checkMod({ report: reportWith([`./register.ts hooks: ${FOUR}, tool.check{tool=Bash}`]), sources: SOURCES });
  assert.match(matched.problems.join('\n'), /tool\.check\{tool=Bash\}, which the mod must never hook/);
  for (const hook of ['tool.call', 'tool.describe', 'config.set', 'agent.offer', 'plugin.register']) {
    const result = checkMod({ report: reportWith([`./register.ts hooks: ${FOUR}, ${hook}`]), sources: SOURCES });
    assert.match(result.problems.join('\n'), new RegExp(`${hook.replace('.', '\\.')}, which the mod must never hook`));
  }
});

test('a classic.PermissionRequest or classic.PreToolUse hook fails', () => {
  for (const hook of ['classic.PermissionRequest', 'classic.PreToolUse', 'classic.Stop']) {
    const result = checkMod({ report: reportWith([`./register.ts hooks: ${FOUR}, ${hook}`]), sources: SOURCES, allow: { hooks: [...HOOKS, hook], calls: CALLS } });
    assert.match(result.problems.join('\n'), new RegExp(`${hook.replace('.', '\\.')}, which the mod must never hook`));
  }
});

test('a call to $.tool.call, $.fs.write, $.env.set or $.settings.read fails', () => {
  for (const call of ['$.tool.call', '$.fs.write', '$.env.set', '$.settings.read', '$.command.run', '$.process.spawn']) {
    const reported = checkMod({
      report: reportWith([`./register.ts hooks: ${FOUR}`, `./register.ts calls: $.process.run, ${call}`]),
      sources: SOURCES,
      allow: { hooks: HOOKS, calls: [...CALLS, call] },
    });
    assert.match(reported.problems.join('\n'), new RegExp(`${call.replaceAll('$', '\\$').replaceAll('.', '\\.')}, which the mod must never call`), call);
    const scanned = checkMod({
      report: reportWith([`./register.ts hooks: ${FOUR}`]),
      sources: { ...SOURCES, 'hooks/mod/x.ts': `await ${call}(1)` },
      allow: { hooks: HOOKS, calls: [...CALLS, call] },
    });
    assert.match(scanned.problems.join('\n'), new RegExp(`source uses ${call.replaceAll('$', '\\$').replaceAll('.', '\\.')}, which the mod must never call`), call);
  }
  // A forbidden name's neighbours stay allowed: $.command.register is not $.command.run.
  assert.equal(matchesForbidden('$.command.register', FORBIDDEN_CALLS), false);
  assert.equal(matchesForbidden('$.tool', FORBIDDEN_CALLS), true);
});

test('the forbidden and allowed lists never overlap', () => {
  for (const hook of HOOKS) assert.equal(matchesForbidden(hook, FORBIDDEN_HOOKS), false, hook);
  for (const call of CALLS) assert.equal(matchesForbidden(call, FORBIDDEN_CALLS), false, call);
  assert.deepEqual(FORBIDDEN_HOOKS, ['tool.check', 'tool.call', 'tool.describe', 'config.set', 'agent.offer', 'plugin.register', 'classic.*']);
  assert.deepEqual(FORBIDDEN_CALLS, ['$.tool.*', '$.agent.*', '$.fs.*', '$.settings.*', '$.http.*', '$.model.*', '$.command.run', '$.prompt.fill', '$.session.append', '$.process.spawn', '$.env.set']);
});

test('a member used in an imported file but not in the report fails', () => {
  // The validator didn't follow the import: the report lists no $.clock.now, though hooks/mod/clock.ts uses it.
  const result = checkMod({
    report: fixture('validate-repo.json'),
    sources: { ...repoSources(), 'hooks/mod/clock.ts': 'export const now = ($) => $.clock.now()' },
    allow: { hooks: HOOKS, calls: [...CALLS, '$.clock.now'] },
  });
  assert.match(result.problems.join('\n'), /\$\.clock\.now, which claude plugin validate doesn't list/);
  assert.equal(result.problems.length, 1, result.problems.join('\n'));
});

test('a second $.process.run, or one running anything but the bridge, fails', () => {
  assert.deepEqual(bridgeArgv(SOURCES), { ok: true });
  assert.deepEqual(bridgeArgv(repoSources()), { ok: true });
  const second = bridgeArgv({ ...SOURCES, 'hooks/mod/more.ts': `const r = $.process.run(${ARGV})` });
  assert.equal(second.ok, false);
  assert.match(second.why, /exactly one/);
  const inRegister = bridgeArgv({ 'hooks/register.ts': `await $.process.run(${ARGV})`, 'hooks/mod/ask.ts': '// nothing here' });
  assert.equal(inRegister.ok, false);
  const other = bridgeArgv({ ...SOURCES, 'hooks/mod/ask.ts': "const r = $.process.run(['node', `${$.plugin.root}/scripts/other.js`])" });
  assert.equal(other.ok, false);
  assert.match(other.why, /bridge\.js/);
  const shell = bridgeArgv({ ...SOURCES, 'hooks/mod/ask.ts': "const r = $.process.run(['sh', '-c', 'node x'])" });
  assert.equal(shell.ok, false);
  const aliased = bridgeArgv({ ...SOURCES, 'hooks/mod/ask.ts': `const run = $.process.run; run(${ARGV})` });
  assert.equal(aliased.ok, false);
  const none = bridgeArgv({ 'hooks/register.ts': '// no calls' });
  assert.equal(none.ok, false);
  // A mention in a comment is not a call.
  assert.deepEqual(bridgeArgv({ ...SOURCES, 'hooks/mod/note.ts': '// $.process.run( is the only call' }), { ok: true });
  // checkMod carries the same problem.
  const result = checkMod({ report: reportWith([`./register.ts hooks: ${FOUR}`, `./register.ts calls: ${CALLS.join(', ')}`]), sources: { ...SOURCES, 'hooks/mod/more.ts': `$.process.run(${ARGV})` } });
  assert.match(result.problems.join('\n'), /exactly one/);
});

test('the pane origin outside a press handler fails', () => {
  const good = `
    // origin: 'pane' is only ever a press
    async function pressApprove($, card) { await ask($, { cmd: 'reply', origin: 'pane', card }) }
    const pressLift = async ($) => { await ask($, { origin: "pane" }) }
    export const Card = ({ $, card }) => <Button onPress={() => pressApprove($, card)} />
    export const Lift = ({ $ }) => <Button onPress={pressLift} />`;
  assert.deepEqual(paneOrigin({ 'hooks/mod/cards.tsx': good, 'hooks/mod/settings.tsx': good }), { ok: true });
  assert.deepEqual(paneOrigin(SOURCES), { ok: true });
  assert.deepEqual(paneOrigin(repoSources()), { ok: true });
  // Outside any function, in a function not named press…, or in another file.
  const loose = paneOrigin({ 'hooks/mod/cards.tsx': "const o = { origin: 'pane' }" });
  assert.equal(loose.ok, false);
  const wrongName = paneOrigin({ 'hooks/mod/cards.tsx': "async function approve($) { await ask($, { origin: 'pane' }) }" });
  assert.equal(wrongName.ok, false);
  assert.match(wrongName.why, /press/);
  const elsewhere = paneOrigin({ 'hooks/mod/board.tsx': "async function pressIt($) { await ask($, { origin: 'pane' }) }" });
  assert.equal(elsewhere.ok, false);
  assert.match(elsewhere.why, /board\.tsx/);
  const inRegister = paneOrigin({ 'hooks/register.ts': "const send = () => ({ origin: 'pane' })" });
  assert.equal(inRegister.ok, false);
  // A press handler something else calls fails; one that is only declared is fine.
  const called = paneOrigin({ 'hooks/mod/cards.tsx': `${good}\nconst again = () => pressApprove($, 1)` });
  assert.equal(called.ok, false);
  assert.match(called.why, /pressApprove/);
  const unused = paneOrigin({ 'hooks/mod/settings.tsx': "const pressOnly = async ($) => { await ask($, { origin: 'pane' }) }\nexport const x = 1" });
  assert.equal(unused.ok, true);
  const calledInHandler = paneOrigin({ 'hooks/mod/cards.tsx': `${good}\nasync function pressTwo($) { await pressApprove($, 1) }` });
  assert.equal(calledInHandler.ok, false);
});

test('moduleFiles lists hooks/register.ts and every file under hooks/mod/', (t) => {
  const dir = tree(t, {
    'hooks/register.ts': '//',
    'hooks/mod/ask.ts': '//',
    'hooks/mod/panes/cards.tsx': '//',
    'hooks/hooks.json': '{}',
    'scripts/mod/bridge.js': '//',
  });
  assert.deepEqual(moduleFiles(dir), ['hooks/register.ts', 'hooks/mod/ask.ts', 'hooks/mod/panes/cards.tsx']);
  assert.deepEqual(moduleFiles(ROOT).slice(0, 2), ['hooks/register.ts', 'hooks/mod/ask.ts']);
});

const SETTINGS = 'export function writeSettings() {}\nexport function mergeSettings() {}\nexport function featureAllowRules() {}\n';

test('a bridge that imports the settings writer fails, through any chain of imports', (t) => {
  const base = {
    'scripts/mod/bridge.js': "import fs from 'node:fs';\nimport x from 'bare-package';\nimport { one } from '../one.js';\n",
    'scripts/one.js': "export * from './two.js';\n",
    'scripts/two.js': "const later = await import('./three.js');\n",
    'scripts/three.js': "import { featureAllowRules } from './protection/settings.js';\n",
    'scripts/protection/settings.js': SETTINGS,
  };
  const waker = bridgeImports(tree(t, base));
  assert.deepEqual(waker.reaches, []);
  assert.deepEqual(waker.files, ['scripts/mod/bridge.js', 'scripts/one.js', 'scripts/protection/settings.js', 'scripts/three.js', 'scripts/two.js']);

  const named = (clause) => bridgeImports(tree(t, { ...base, 'scripts/three.js': `import ${clause} from './protection/settings.js';\n` }));
  for (const clause of ['{ writeSettings }', '{ featureAllowRules,\n  mergeSettings }', '{ mergeSettings as merge }', '* as settings', 'settings', 'settings, { featureAllowRules }']) {
    const result = named(clause);
    assert.equal(result.reaches.length, 1, clause);
    assert.match(result.reaches[0], /scripts\/three\.js imports .* from scripts\/protection\/settings\.js/, clause);
  }
  const reexport = bridgeImports(tree(t, { ...base, 'scripts/three.js': "export { writeSettings } from './protection/settings.js';\n" }));
  assert.equal(reexport.reaches.length, 1);
  const direct = bridgeImports(tree(t, { ...base, 'scripts/mod/bridge.js': "import { mergeSettings } from '../protection/settings.js';\n" }));
  assert.equal(direct.reaches.length, 1);
  // An import in a comment is not one.
  const commented = bridgeImports(tree(t, { ...base, 'scripts/three.js': "// import { writeSettings } from './protection/settings.js';\nimport { featureAllowRules } from './protection/settings.js';\n" }));
  assert.deepEqual(commented.reaches, []);
});

test('a bridge that reaches the locked or setup files, or takes more than the readers from managed, fails', (t) => {
  for (const target of ['protection/locked.js', 'setup/install.js', 'setup/deep/more.js']) {
    const result = bridgeImports(tree(t, {
      'scripts/mod/bridge.js': "import { a } from '../a.js';\n",
      'scripts/a.js': `import { b } from './${target}';\n`,
      [`scripts/${target}`]: 'export const b = 1;\n',
    }));
    assert.deepEqual(result.reaches, [`scripts/${target}`], target);
  }
  // managed.js may be imported for its two readers, as hooks/kit.js does, and for nothing else.
  const managed = (clause) => bridgeImports(tree(t, {
    'scripts/mod/bridge.js': `import ${clause} from '../protection/managed.js';\n`,
    'scripts/protection/managed.js': 'export const managedDir = 1;\nexport const lockedProjects = 2;\nexport const other = 3;\n',
  }));
  assert.deepEqual(managed('{ managedDir, lockedProjects }').reaches, []);
  for (const clause of ['{ managedDir, other }', '* as managed', 'managed']) {
    assert.match(managed(clause).reaches.join('\n'), /scripts\/mod\/bridge\.js imports .* from scripts\/protection\/managed\.js/, clause);
  }
  // A file the bridge doesn't import may import them.
  const apart = bridgeImports(tree(t, {
    'scripts/mod/bridge.js': "import { a } from '../a.js';\n",
    'scripts/a.js': 'export const a = 1;\n',
    'scripts/setup/install.js': "import { x } from '../protection/managed.js';\n",
  }));
  assert.deepEqual(apart.reaches, []);
});

test('an import the check can\'t follow is reported', (t) => {
  const result = bridgeImports(tree(t, { 'scripts/mod/bridge.js': "import { a } from '../gone.js';\n" }));
  assert.deepEqual(result.missing, ['scripts/gone.js']);
});

test('the real bridge\'s imports never reach what writes Claude Code\'s settings', () => {
  const result = bridgeImports(ROOT);
  assert.deepEqual(result.reaches, []);
  assert.deepEqual(result.missing, []);
  assert.ok(result.files.includes('scripts/mod/bridge.js'));
  assert.ok(result.files.includes('scripts/mod/reply.js'));
});

test('the source scan reads member calls on $ and leaves comments out', () => {
  const text = '// $.fs.write is never used\n/* nor $.http.fetch */\nconst a = await $.session.id(); $.ui.toast(`${$.plugin.root}`)';
  assert.deepEqual(membersIn(text), ['$.plugin.root', '$.session.id', '$.ui.toast']);
});

test('the mod in hooks/register.ts calls only what the brief names', () => {
  const source = fs.readFileSync(path.join(ROOT, 'hooks', 'register.ts'), 'utf8');
  const allowed = new Set([...CALLS, '$.plugin.root']);
  for (const member of membersIn(source)) assert.ok(allowed.has(member), member);
});

test('the options the mod sends as a reply are the signed labels', () => {
  const source = fs.readFileSync(path.join(ROOT, 'hooks', 'register.ts'), 'utf8');
  const list = /^const LABELS = (\[[^\]]*\])$/m.exec(source);
  assert.ok(list, 'hooks/register.ts names its LABELS on one line');
  assert.deepEqual(JSON.parse(list[1].replaceAll("'", '"')), SIGNED_LABELS);
});

test('the mod reads a reply code from the code alphabet', () => {
  const source = fs.readFileSync(path.join(ROOT, 'hooks', 'register.ts'), 'utf8');
  const alphabet = /^const CODE_ALPHABET = '([^']*)'$/m.exec(source);
  assert.ok(alphabet, 'hooks/register.ts names its CODE_ALPHABET on one line');
  assert.equal(alphabet[1], CODE_ALPHABET);
  assert.match(source, /^const REPLY = new RegExp\(`\^\[\$\{CODE_ALPHABET\}\]\{4\}/m, 'REPLY is built from CODE_ALPHABET');
});

test('the mod\'s phoned "stop" is the stop-word hook\'s plain word', () => {
  const read = (file, name) => {
    const found = new RegExp(`^const ${name} = /(.*)/([a-z]*);?$`, 'm').exec(fs.readFileSync(path.join(ROOT, file), 'utf8'));
    assert.ok(found, `${file} names ${name} on one line`);
    return new RegExp(found[1], found[2]);
  };
  const mod = read('hooks/register.ts', 'STOP');
  const word = read('scripts/hooks/stop-word.js', 'STOP_WORD');
  for (const text of ['stop', 'STOP', 'Stop.', 'stop!', 'stop!!', 'Stop.!', 'stop...', 'stop it', 'stopp', 'a stop', 'stop?']) {
    assert.equal(mod.test(text), word.test(text), text);
  }
  assert.equal(mod.test('/stop'), false, 'a command is the stop-word hook\'s alone');
});

test('hooks.json names the mod beside the command hooks', () => {
  const file = JSON.parse(fs.readFileSync(path.join(ROOT, 'hooks', 'hooks.json'), 'utf8'));
  assert.deepEqual(file.modules, ['./register.ts']);
});

test('npm test leaves the mod\'s tests to npm run mod-check', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  assert.equal(pkg.scripts['mod-check'], 'node scripts/mod/validate.js && claude plugin test .');
  assert.match(pkg.scripts.test, /"tests\/\*\*\/\*\.test\.js"$/);
});
