// tests/scripts/mod/validate.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  checkMod, membersIn, moduleFiles, readMod, bridgeArgv, paneOrigin, bridgeImports,
  HOOKS, CALLS, FORBIDDEN_HOOKS, FORBIDDEN_CALLS, matchesForbidden,
} from '../../../scripts/mod/validate.js';
import { SIGNED_LABELS } from '../../../scripts/hooks/prompt-record.js';
import { CODE_ALPHABET } from '../../../scripts/state/card-lines.js';
import { PANE_ID, TICK_MS, STALE_TICKS, WATCH_BRIDGE_MS, LEADS, MESSAGE_LEAD } from '../../../scripts/lib/mod-numbers.js';
import { BRIDGE_MS } from '../../../scripts/mod/bridge.js';
import { FOREMAN_PROMPT_LEAD } from '../../../scripts/foreman/start.js';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
// The mod's hooks as the validator lists them.
const LISTED = HOOKS.join(', ');
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

test('the repository\'s report and source pass', () => {
  const result = checkMod({ report: fixture('validate-repo.json'), sources: repoSources() });
  assert.deepEqual(result.problems, []);
  assert.deepEqual(result.hooks, HOOKS);
  assert.deepEqual(result.calls, CALLS);
});

test('a report recorded before the pane, on 2.1.292, reads as the first piece\'s and misses the pane\'s hooks', () => {
  const result = checkMod({ report: fixture('validate-repo-2.1.292.json'), sources: repoSources() });
  assert.deepEqual(result.hooks, ['session.start', 'session.measure', 'prompt.submit', 'command.run{command=go}']);
  for (const hook of ['turn.start', 'turn.complete', 'command.run{command=wheelhouse}', 'ui.render{component=Pane, requestId=wheelhouse}']) {
    assert.ok(result.problems.includes(`The mod doesn't hook ${hook}`), hook);
  }
});

test('a report from a mod in two files lists the imported file\'s hooks and calls under the entry file', () => {
  const result = checkMod({ report: fixture('validate-probe.json'), sources: SOURCES });
  assert.deepEqual(result.hooks, ['prompt.submit', 'session.start', 'command.run{command=digest}', 'ui.render{component=Pane, requestId=probe40}', 'ui.render{component=AbovePrompt}']);
  assert.deepEqual(result.calls, ['$.clock.every', '$.clock.now', '$.command.register', '$.fs.read', '$.fs.write', '$.prompt.submit']);
  assert.match(result.problems.join('\n'), /\$\.fs\.read/);
  assert.match(result.problems.join('\n'), /ui\.render\{component=Pane, requestId=probe40\}/);
});

test('the mod passes with exactly its hooks and the calls it needs', () => {
  const result = checkMod({
    report: reportWith([`./register.ts hooks: ${LISTED}`, `./register.ts calls: ${CALLS.join(', ')}`]),
    sources: SOURCES,
  });
  assert.deepEqual(result.problems, []);
  assert.deepEqual(result.hooks, HOOKS);
  assert.deepEqual(result.calls, CALLS);
});

test('a call made inside one of the module\'s own functions is read without its "via"', () => {
  const result = checkMod({
    report: reportWith([`./register.ts hooks: ${LISTED}`, './register.ts calls: $.process.run (via ask), $.session.id (via a, b), $.ui.toast']),
    sources: SOURCES,
  });
  assert.deepEqual(result.calls, ['$.process.run', '$.session.id', '$.ui.toast']);
  assert.ok(!result.problems.some((p) => /brief doesn't name/.test(p)), result.problems.join('\n'));
});

test('a hook beyond the mod\'s, or one missing, fails', () => {
  const extra = checkMod({ report: reportWith([`./register.ts hooks: ${LISTED}, tool.call`]), sources: SOURCES });
  assert.match(extra.problems.join('\n'), /tool\.call/);
  const missing = checkMod({ report: reportWith(['./register.ts hooks: session.start, prompt.submit']), sources: SOURCES });
  assert.match(missing.problems.join('\n'), /session\.measure/);
  assert.match(missing.problems.join('\n'), /command\.run\{command=go\}/);
  const none = checkMod({ report: reportWith([]), sources: SOURCES });
  assert.notDeepEqual(none.problems, []);
});

test('a call the brief does not name fails, in the report or in the source', () => {
  const reported = checkMod({ report: reportWith([`./register.ts hooks: ${LISTED}`, './register.ts calls: $.process.run, $.clock.sleep']), sources: SOURCES });
  assert.match(reported.problems.join('\n'), /\$\.clock\.sleep/);
  const scanned = checkMod({
    report: reportWith([`./register.ts hooks: ${LISTED}`]),
    sources: { ...SOURCES, 'hooks/mod/x.ts': 'const p = $.process; $.clock.sleep()' },
  });
  assert.match(scanned.problems.join('\n'), /\$\.clock\.sleep/);
  assert.match(scanned.problems.join('\n'), /\$\.process\b/);
});

test('a report that failed, or holds errors, fails', () => {
  const notes = [`./register.ts hooks: ${LISTED}`];
  assert.notDeepEqual(checkMod({ report: reportWith(notes, { success: false }), sources: SOURCES }).problems, []);
  assert.notDeepEqual(checkMod({ report: reportWith(notes, { errors: [{ path: 'modules', message: 'bad' }] }), sources: SOURCES }).problems, []);
  assert.notDeepEqual(checkMod({ report: null, sources: SOURCES }).problems, []);
});

test('a report listing a tool.check hook fails, even when HOOKS names it', () => {
  const report = reportWith([`./register.ts hooks: ${LISTED}, tool.check`]);
  const named = checkMod({ report, sources: SOURCES, allow: { hooks: [...HOOKS, 'tool.check'], calls: CALLS } });
  assert.match(named.problems.join('\n'), /tool\.check, which the mod must never hook/);
  const matched = checkMod({ report: reportWith([`./register.ts hooks: ${LISTED}, tool.check{tool=Bash}`]), sources: SOURCES });
  assert.match(matched.problems.join('\n'), /tool\.check\{tool=Bash\}, which the mod must never hook/);
  for (const hook of ['tool.call', 'tool.describe', 'config.set', 'agent.offer', 'plugin.register']) {
    const result = checkMod({ report: reportWith([`./register.ts hooks: ${LISTED}, ${hook}`]), sources: SOURCES });
    assert.match(result.problems.join('\n'), new RegExp(`${hook.replace('.', '\\.')}, which the mod must never hook`));
  }
});

test('a classic.PermissionRequest or classic.PreToolUse hook fails', () => {
  for (const hook of ['classic.PermissionRequest', 'classic.PreToolUse', 'classic.Stop']) {
    const result = checkMod({ report: reportWith([`./register.ts hooks: ${LISTED}, ${hook}`]), sources: SOURCES, allow: { hooks: [...HOOKS, hook], calls: CALLS } });
    assert.match(result.problems.join('\n'), new RegExp(`${hook.replace('.', '\\.')}, which the mod must never hook`));
  }
});

test('a call to $.tool.call, $.fs.write, $.env.set or $.settings.read fails', () => {
  for (const call of ['$.tool.call', '$.fs.write', '$.env.set', '$.settings.read', '$.command.run', '$.process.spawn']) {
    const reported = checkMod({
      report: reportWith([`./register.ts hooks: ${LISTED}`, `./register.ts calls: $.process.run, ${call}`]),
      sources: SOURCES,
      allow: { hooks: HOOKS, calls: [...CALLS, call] },
    });
    assert.match(reported.problems.join('\n'), new RegExp(`${call.replaceAll('$', '\\$').replaceAll('.', '\\.')}, which the mod must never call`), call);
    const scanned = checkMod({
      report: reportWith([`./register.ts hooks: ${LISTED}`]),
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
  // The validator didn't follow the import: the report lists no $.clock.sleep, though hooks/mod/clock.ts uses it.
  const result = checkMod({
    report: fixture('validate-repo.json'),
    sources: { ...repoSources(), 'hooks/mod/clock.ts': 'export const wait = ($) => $.clock.sleep()' },
    allow: { hooks: HOOKS, calls: [...CALLS, '$.clock.sleep'] },
  });
  assert.match(result.problems.join('\n'), /\$\.clock\.sleep, which claude plugin validate doesn't list/);
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
  // A mention in a comment counts too: the check reads the raw text, so a misread comment can't hide a call.
  assert.equal(bridgeArgv({ ...SOURCES, 'hooks/mod/note.ts': '// $.process.run( is the only call' }).ok, false);
  // checkMod carries the same problem.
  const result = checkMod({ report: reportWith([`./register.ts hooks: ${LISTED}`, `./register.ts calls: ${CALLS.join(', ')}`]), sources: { ...SOURCES, 'hooks/mod/more.ts': `$.process.run(${ARGV})` } });
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
  // scripts/setup/git.js, git's fence, is the one file of scripts/setup/ the bridge may import.
  const fence = (name) => bridgeImports(tree(t, {
    'scripts/mod/bridge.js': `import { a } from '../setup/${name}';\n`,
    [`scripts/setup/${name}`]: 'export const a = 1;\n',
  })).reaches;
  assert.deepEqual(fence('git.js'), []);
  assert.deepEqual(fence('host.js'), ['scripts/setup/host.js']);
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

// hooks/mod/numbers.ts holds the mod's copies, since the mod can't import scripts/: each is
// written once, there, and is the value the scripts name.
test('the mod\'s numbers are the scripts\' numbers, named once in hooks/mod/numbers.ts', () => {
  const source = fs.readFileSync(path.join(ROOT, 'hooks', 'mod', 'numbers.ts'), 'utf8');
  const written = Object.fromEntries([...source.matchAll(/^export const ([A-Z_]+) = (.*)$/gm)].map((m) => [m[1], m[2]]));
  assert.deepEqual(Object.keys(written).sort(), ['ASK_MS', 'BRIDGE_MS', 'FOREMAN_LEAD', 'MESSAGE_LEAD', 'PANE_ID', 'PANE_LEAD', 'STALE_TICKS', 'TICK_ASK_MS', 'TICK_MS', 'WATCH_BRIDGE_MS']);
  const value = (name) => JSON.parse(written[name].replaceAll("'", '"'));
  assert.equal(value('PANE_ID'), PANE_ID);
  assert.equal(value('TICK_MS'), TICK_MS);
  assert.equal(value('STALE_TICKS'), STALE_TICKS);
  assert.equal(value('BRIDGE_MS'), BRIDGE_MS);
  assert.equal(value('WATCH_BRIDGE_MS'), WATCH_BRIDGE_MS);
  assert.equal(value('PANE_LEAD'), LEADS.pane);
  assert.equal(value('FOREMAN_LEAD'), FOREMAN_PROMPT_LEAD);
  assert.equal(written.MESSAGE_LEAD, String(MESSAGE_LEAD));
  // The waits are the bridge's limits and the time node takes to start (ruling 26).
  assert.equal(written.ASK_MS, 'BRIDGE_MS + 1500');
  assert.equal(written.TICK_ASK_MS, 'WATCH_BRIDGE_MS + 5000');
  // No other file of the mod names one of them again.
  for (const [file, text] of Object.entries(repoSources())) {
    if (file === 'hooks/mod/numbers.ts') continue;
    for (const name of Object.keys(written)) {
      assert.doesNotMatch(text, new RegExp(`(?:const|let|var)\\s+${name}\\b`), `${file} names ${name} again`);
    }
  }
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

// What the scans must not be fooled by: spellings of a second process run, a // inside a string or
// regular expression, a file imported from outside the mod, and a hooks.json naming another module.
const REAL_ASK = fs.readFileSync(path.join(ROOT, 'hooks', 'mod', 'ask.ts'), 'utf8');

test('a second process run the scans could miss still fails, under any spelling', () => {
  const evasions = [
    "$?.process.run(['sh','-c','x'])",
    "$ .process.run(['sh'])",
    "$\n  .process\n  .run(['sh'])",
    "const s = '//'; $.process.run(['sh'])",
    "const s = '/*';\n$.process.run(['sh'])\nconst t = '*/'",
    "const r = /\\//; $.process.run(['sh'])",
    "const t = `${'//'}`; $.process.run(['sh'])",
    "(api) => api.process.run(['sh'])",
    "const { process } = $; process.run(['sh'])",
    "$.process.run?.(['sh'])",
  ];
  for (const extra of evasions) {
    const result = bridgeArgv({ ...SOURCES, 'hooks/mod/ask.ts': `${REAL_ASK}\n${extra}\n` });
    assert.equal(result.ok, false, extra);
    assert.match(result.why, /exactly one/, extra);
  }
  assert.deepEqual(bridgeArgv({ ...SOURCES, 'hooks/mod/ask.ts': REAL_ASK }), { ok: true });
});

test('the source scan reads past a // or /* inside a string, template or regular expression', () => {
  const cases = [
    ["const s = '//'; $.fs.write()", ['$.fs.write']],
    ["const s = \"/*\";\n$.fs.write()\nconst t = '*/'", ['$.fs.write']],
    ["const s = 'http://a.b'; $.ui.toast(s)", ['$.ui.toast']],
    ['const t = `// ${$.fs.read}`', ['$.fs.read']],
    ["const t = `a ${'`'} // b`; $.fs.write()", ['$.fs.write']],
    ['const r = /\\//; $.fs.write()', ['$.fs.write']],
    ["const r = /['\"]/; $.fs.write()", ['$.fs.write']],
    ["const a = 1 / 2; // $.fs.read\n$.ui.toast(a / 3)", ['$.ui.toast']],
    ["const s = 'it\\'s'; // $.fs.read\n$.ui.toast(s)", ['$.ui.toast']],
    ['/* $.fs.read */ $.ui.toast(1) // $.fs.write', ['$.ui.toast']],
    ['const t = `${/* $.fs.read */ 1}`', []],
    ['return /x/.test(a) && $.ui.toast(1)', ['$.ui.toast']],
  ];
  for (const [text, members] of cases) assert.deepEqual(membersIn(text), members, text);
});

test('the source scan reads a member of $ however it is spaced or chained', () => {
  assert.deepEqual(membersIn('$ .fs.write(); $?.fs.read(); $?.env?.set(); $\n.tool\n.call()'), ['$.env.set', '$.fs.read', '$.fs.write', '$.tool.call']);
  const result = checkMod({ report: fixture('validate-repo.json'), sources: { ...repoSources(), 'hooks/mod/x.ts': 'await $ .fs.write(1); await $?.env.set(1)' } });
  assert.match(result.problems.join('\n'), /\$\.fs\.write, which the mod must never call/);
  assert.match(result.problems.join('\n'), /\$\.env\.set, which the mod must never call/);
});

test('a module file importing a file outside hooks/register.ts and hooks/mod/ fails', () => {
  const report = fixture('validate-repo.json');
  const withRegister = (text) => checkMod({ report, sources: { ...repoSources(), 'hooks/register.ts': `${repoSources()['hooks/register.ts']}\n${text}\n` } });
  assert.deepEqual(withRegister("import { a } from './mod/ask.ts'; export * from './mod/ask'; import type { T } from 'claude-code'").problems, []);
  for (const text of [
    "import { h } from './helper'",
    "import { h } from '../scripts/x.ts'",
    "import './side'",
    "export { h } from './mod/missing'",
    "const m = await import('./lazy')",
    "import {\n  a,\n  b,\n} from '../scripts/mod/bridge.js'",
  ]) {
    assert.match(withRegister(text).problems.join('\n'), /imports \S+, which isn't one of the mod's files/, text);
  }
  // A file under hooks/mod/ resolves from its own folder.
  const nested = checkMod({ report, sources: { ...repoSources(), 'hooks/mod/more.ts': "import { ask } from './ask'; import { r } from '../register'" } });
  assert.deepEqual(nested.problems, []);
  const outside = checkMod({ report, sources: { ...repoSources(), 'hooks/mod/more.ts': "import { x } from '../x'" } });
  assert.match(outside.problems.join('\n'), /hooks\/mod\/more\.ts imports \.\.\/x/);
  // A comment's import is not one.
  assert.deepEqual(withRegister("// import { h } from './helper'").problems, []);
});

test('hooks.json naming any module but ./register.ts fails, and so does a report naming one', () => {
  const report = fixture('validate-repo.json');
  const sources = repoSources();
  const run = (hooksJson) => checkMod({ report, sources, hooksJson }).problems.join('\n');
  assert.equal(run({ modules: ['./register.ts'], hooks: {} }), '');
  for (const modules of [['./register.ts', './other.ts'], ['./other.ts'], [], undefined, './register.ts']) {
    assert.match(run({ modules }), /hooks\.json names/, JSON.stringify(modules));
  }
  assert.match(run(null), /hooks\.json/);
  const other = structuredClone(report);
  other.contents[2].notes = other.contents[2].notes.map((n) => n.replace('./register.ts', './part.ts'));
  assert.match(checkMod({ report: other, sources, hooksJson: { modules: ['./register.ts'] } }).problems.join('\n'), /lists hooks for \.\/part\.ts, not \.\/register\.ts/);
  // The repository's own hooks.json and files pass.
  assert.deepEqual(checkMod({ report, ...readMod(ROOT) }).problems, []);
});

// What a // the scanner misreads as a comment must not hide: a second process run or a forbidden member.
const MISREAD = [
  ['hooks/mod/more.ts', "if (x) /\\/\\//.test(y); "],
  ['hooks/mod/more.ts', "if (ok) /https:\\/\\//.test(u) && "],
  ['hooks/mod/more.tsx', 'const e = <Text>a // b</Text>; '],
];

test('a second process run behind a misread // still fails', () => {
  for (const [file, before] of MISREAD) {
    const result = bridgeArgv({ ...SOURCES, 'hooks/mod/ask.ts': REAL_ASK, [file]: `${before}$.process.run(['sh'])\n` });
    assert.equal(result.ok, false, before);
    assert.match(result.why, /exactly one/, before);
  }
});

test('a forbidden member behind a misread // still fails', () => {
  const report = fixture('validate-repo.json');
  for (const [file, before] of MISREAD) {
    const result = checkMod({ report, sources: { ...repoSources(), [file]: `${before}$.fs.write(1)\n` } });
    assert.match(result.problems.join('\n'), /\$\.fs\.write, which the mod must never call/, before);
  }
  // A comment that names one fails too, once.
  const named = checkMod({ report, sources: { ...repoSources(), 'hooks/mod/more.ts': '// never $.env.set\n' } });
  assert.equal(named.problems.filter((p) => /\$\.env\.set/.test(p)).length, 1, named.problems.join('\n'));
});

test('the scanner reads a regular expression after the ) of if, while, for or with', () => {
  assert.deepEqual(membersIn("if (x) /\\/\\//.test(y); $.fs.write(1)"), ['$.fs.write']);
  assert.deepEqual(membersIn("while (a) /https:\\/\\//.test(u) && $.ui.toast(1)"), ['$.ui.toast']);
  assert.deepEqual(membersIn("for (;;) /a\\/\\//.test(u); $.ui.toast(1)"), ['$.ui.toast']);
  assert.deepEqual(membersIn('const q = f(a) / 2; // $.fs.read\n$.ui.toast(q / 3)'), ['$.ui.toast']);
});

// What the bridge's one call may pass besides its argv: a stdin and a timeout, nothing that
// could change what runs (an env, a cwd), whether spelled out, spread or held in a variable.
test('the bridge call passes no option but stdin and timeoutMs', () => {
  const withOptions = (options) => bridgeArgv({ ...SOURCES, 'hooks/mod/ask.ts': `export const ask = async ($, request) => $.process.run(${ARGV}${options})` });
  for (const options of ['', ', { stdin: JSON.stringify(request) }', ', { timeoutMs: 5000 }', ', { stdin: x, timeoutMs: 1 + 2, }', ', { stdin, timeoutMs }', ', { stdin: f(a, { b: 1 }), timeoutMs: 3000 }']) {
    assert.deepEqual(withOptions(options), { ok: true }, options);
  }
  const refused = [
    ", { stdin: 'x', env: { NODE_OPTIONS: '--import=data:text/javascript,1', PATH: '/tmp/evil' } }",
    ", { stdin: 'x', cwd: '/tmp/evil' }",
    ', { env }',
    ', { ...opts }',
    ', { stdin: 1, ...opts }',
    ', opts',
    ', { ...{ env: {} } }',
    ", { 'env': {} }",
    ', { [key]: 1 }',
    ', { stdin() { return 1 } }',
    ', { stdin: 1 }, extra',
    ', { stdin: 1 }.env',
    ', [{ stdin: 1 }]',
    ', undefined',
    // A regular expression or template holding a quote must not hide a key from the scan: a
    // `/` or a backtick anywhere in the options fails, and so does the word env or cwd.
    ", { stdin: /'/, env: { PATH: '/tmp/evil' }, timeoutMs: /'/ }",
    ', { stdin: /"/, cwd: "/tmp/evil", timeoutMs: /"/ }',
    ', { stdin: /`/, env: e, timeoutMs: /`/ }',
    ', { stdin: `x`, timeoutMs: 1 }',
    ', { stdin: 1, timeoutMs: 10 / 2 }',
    ", { stdin: 'env' }",
    ', { stdin: request.cwd }',
  ];
  for (const options of refused) {
    const result = withOptions(options);
    assert.equal(result.ok, false, options);
    assert.match(result.why, /options/, options);
  }
  // The same through checkMod, and the real hooks/mod/ask.ts still passes.
  const result = checkMod({ report: reportWith([`./register.ts hooks: ${LISTED}`, `./register.ts calls: ${CALLS.join(', ')}`]), sources: { ...SOURCES, 'hooks/mod/ask.ts': `export const ask = async ($, r) => $.process.run(${ARGV}, { env: { PATH: '/tmp/evil' } })` } });
  assert.match(result.problems.join('\n'), /options/);
  assert.deepEqual(bridgeArgv(repoSources()), { ok: true });
});

// A name ending in `.*`, or `*` itself, is forbidden when it covers a forbidden pattern.
test('a hook or call named by a wildcard that covers a forbidden one is forbidden', () => {
  for (const hook of ['tool.*', 'config.*', 'agent.*', 'plugin.*', '*', 'classic.*', 'tool*']) assert.equal(matchesForbidden(hook, FORBIDDEN_HOOKS), true, hook);
  for (const call of ['$.*', '$.tool.*', '$.fs.*', '$.settings.*', '$.command.*', '$.process.*', '$.prompt.*', '$.session.*', '$.env.*', '*']) assert.equal(matchesForbidden(call, FORBIDDEN_CALLS), true, call);
  // A wildcard that covers nothing forbidden is not.
  // A hook's matcher after a wildcard changes nothing.
  assert.equal(matchesForbidden('tool.*{tool=Bash}', FORBIDDEN_HOOKS), true);
  assert.equal(matchesForbidden('*{tool=Bash}', FORBIDDEN_HOOKS), true);
  assert.equal(matchesForbidden('session.*{x=y}', FORBIDDEN_HOOKS), false);
  for (const call of ['$.clock.*', '$.ui.*', '$.plugin.*']) assert.equal(matchesForbidden(call, FORBIDDEN_CALLS), false, call);
  for (const hook of ['session.*', 'prompt.*', 'command.*']) assert.equal(matchesForbidden(hook, FORBIDDEN_HOOKS), false, hook);
  const result = checkMod({
    report: reportWith([`./register.ts hooks: ${LISTED}, tool.*`, `./register.ts calls: ${CALLS.join(', ')}, $.*`]),
    sources: SOURCES,
    allow: { hooks: [...HOOKS, 'tool.*'], calls: [...CALLS, '$.*'] },
  });
  assert.match(result.problems.join('\n'), /hooks tool\.\*, which the mod must never hook/);
  assert.match(result.problems.join('\n'), /calls \$\.\*, which the mod must never call/);
});

// A ui.render or ui.resolve hook with no matcher draws every component the engine draws: the
// mod's hooks there always name what they draw (ruling 30).
test('a ui.render or ui.resolve hook with no matcher fails, even when HOOKS names it', () => {
  for (const hook of ['ui.render', 'ui.resolve']) {
    const result = checkMod({
      report: reportWith([`./register.ts hooks: ${LISTED}, ${hook}`, `./register.ts calls: ${CALLS.join(', ')}`]),
      sources: SOURCES,
      allow: { hooks: [...HOOKS, hook], calls: CALLS },
    });
    assert.match(result.problems.join('\n'), new RegExp(`hooks ${hook.replace('.', '\\.')} with no matcher`), hook);
  }
  const matched = checkMod({
    report: reportWith([`./register.ts hooks: ${LISTED}, ui.render{component=Pane, requestId=wheelhouse}`, `./register.ts calls: ${CALLS.join(', ')}`]),
    sources: SOURCES,
    allow: { hooks: [...HOOKS, 'ui.render{component=Pane, requestId=wheelhouse}'], calls: CALLS },
  });
  assert.deepEqual(matched.problems.filter((p) => /no matcher/.test(p)), []);
});

// The bridge's graph is read by its literal imports: a name it can't read, a require or a
// createRequire anywhere in the graph is reported.
test('a bridge graph that loads a file by a name the checks can\'t read is reported', (t) => {
  const bridge = (text, more = {}) => bridgeImports(tree(t, { 'scripts/mod/bridge.js': text, ...more })).unfollowed;
  assert.deepEqual(bridge("import { a } from './a.js';\n", { 'scripts/mod/a.js': 'export const a = 1;\n' }), []);
  assert.deepEqual(bridge("// require('x') and import(name) are only comments here\nimport('./a.js');\n", { 'scripts/mod/a.js': 'export const a = 1;\n' }), []);
  const cases = {
    'a computed import()': 'const m = await import(name);\n',
    'an import() of a template': 'const m = await import(`./${name}.js`);\n',
    'a require(': "const m = require('./a.js');\n",
    'a module.require(': "const m = module.require('./a.js');\n",
    'createRequire': "import { createRequire } from 'node:module';\nconst r = createRequire(import.meta.url);\n",
  };
  for (const [what, text] of Object.entries(cases)) {
    const direct = bridge(text);
    assert.equal(direct.length, 1, what);
    assert.match(direct[0], /scripts\/mod\/bridge\.js.*can't follow/, what);
    // Deeper in the graph, too.
    const deep = bridge("import './a.js';\n", { 'scripts/mod/a.js': text });
    assert.equal(deep.length, 1, what);
    assert.match(deep[0], /scripts\/mod\/a\.js/, what);
  }
});

test('the real bridge graph has no import the checks can\'t follow', () => {
  assert.deepEqual(bridgeImports(ROOT).unfollowed, []);
});

// A comment's `//` inside JSX text is not a comment, so a member of $ after it still counts.
test('a member of $ after a // in text that is not a comment is found, whatever the brief names', () => {
  const report = fixture('validate-repo.json');
  const line = '<Text>See https://example.com {$.clock.sleep()}</Text>';
  const result = checkMod({ report, sources: { ...repoSources(), 'hooks/mod/more.tsx': `export const x = () => ${line}\n` } });
  assert.match(result.problems.join('\n'), /\$\.clock\.sleep, which its brief doesn't name/);
  // Allowed members named only in comments are not a problem.
  const comment = checkMod({ report, sources: { ...repoSources(), 'hooks/mod/more.ts': '// calls $.ui.toast and $.plugin.root\n' } });
  assert.deepEqual(comment.problems, []);
});
