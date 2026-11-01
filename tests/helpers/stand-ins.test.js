// tests/helpers/stand-ins.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { standInTools, guardedRun, preloadOption, STOOD_IN } from './host-stand-ins.js';

const TESTS = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const SELF = fileURLToPath(import.meta.url);

for (const form of ['script', 'node']) {
  // A shell script doesn't shadow gh.exe, so Windows uses the node form only (host-stand-ins.js).
  const skip = form === 'script' && process.platform === 'win32' && 'the script form shadows the real programs on macOS and Linux only';
  test(`${form} form: gh, curl and security are found first on the PATH, logged and refused`, { skip }, () => {
    const s = standInTools({ form });
    try {
      for (const [name, args] of [['gh', ['pr', 'close', '12']], ['curl', ['fetch', 'https://github.com/']], ['security', ['find-generic-password']]]) {
        s.reset();
        const out = spawnSync(name, args, { encoding: 'utf8' });
        assert.equal(out.status, 1, name);
        assert.match(out.stderr, new RegExp(`${name} is not run in this test`));
        assert.deepEqual(s.calls(), [[name, ...args].join(' ')]);
      }
    } finally {
      s.restore();
    }
  });

  test(`${form} form: an accepted call exits 0 and is logged`, { skip }, () => {
    const s = standInTools({ form, accept: { gh: [['pr', 'close']] } });
    try {
      assert.equal(spawnSync('gh', ['pr', 'close', '12'], { encoding: 'utf8' }).status, 0);
      assert.equal(spawnSync('gh', ['pr', 'merge', '12'], { encoding: 'utf8' }).status, 1);
      assert.deepEqual(s.calls(), ['gh pr close 12', 'gh pr merge 12']);
    } finally {
      s.restore();
    }
  });

  test(`${form} form: an answered call prints its answer, exits 0 and is logged`, { skip }, () => {
    const listed = `${JSON.stringify([{ number: 7, title: 'It\'s "quoted" $HOME' }])}\n`;
    const s = standInTools({ form, answer: { gh: [{ args: ['pr', 'list'], stdout: listed }] } });
    try {
      const out = spawnSync('gh', ['pr', 'list', '--state', 'open'], { encoding: 'utf8' });
      assert.equal(out.status, 0);
      assert.equal(out.stdout, listed);
      assert.equal(spawnSync('gh', ['pr', 'close', '7'], { encoding: 'utf8' }).status, 1);
      assert.deepEqual(s.calls(), ['gh pr list --state open', 'gh pr close 7']);
    } finally {
      s.restore();
    }
  });
}

test('node form: an ordinary node child is unaffected by the preload', () => {
  const s = standInTools({ form: 'node' });
  try {
    const out = spawnSync(process.execPath, ['-e', 'process.stdout.write("fine")'], { encoding: 'utf8' });
    assert.equal(out.status, 0);
    assert.equal(out.stdout, 'fine');
    assert.deepEqual(s.calls(), []);
  } finally {
    s.restore();
  }
});

test('node form: the stand-ins are all of STOOD_IN, and a call from another folder still logs the word typed', () => {
  const s = standInTools({ form: 'node' });
  try {
    const exe = process.platform === 'win32' ? '.exe' : '';
    for (const name of STOOD_IN) assert.ok(fs.existsSync(path.join(s.dir, `${name}${exe}`)), name);
    spawnSync('gh', ['api', 'repos/o/p'], { encoding: 'utf8', cwd: TESTS });
    assert.deepEqual(s.calls(), ['gh api repos/o/p']);
  } finally {
    s.restore();
  }
});

test('win32 form: the stand-ins are .exe files and the preload is found through forward slashes', () => {
  const s = standInTools({ platform: 'win32' });
  try {
    assert.match(process.env.NODE_OPTIONS, /^--require "[^\\]*stand-in-preload\.cjs"$/);
    assert.equal(preloadOption('C:\\Temp\\wh-shims-x', 'win32'), '--require "C:/Temp/wh-shims-x/stand-in-preload.cjs"');
    assert.ok(fs.existsSync(path.join(s.dir, 'gh.exe')));
    assert.ok(!fs.existsSync(path.join(s.dir, 'gh')));
    const out = spawnSync(path.join(s.dir, 'gh.exe'), ['pr', 'close', '12'], { encoding: 'utf8' });
    assert.equal(out.status, 1);
    assert.deepEqual(s.calls(), ['gh pr close 12']);
  } finally {
    s.restore();
  }
});

test('restore puts PATH and NODE_OPTIONS back', () => {
  for (const options of [undefined, '--no-warnings']) {
    if (options === undefined) delete process.env.NODE_OPTIONS;
    else process.env.NODE_OPTIONS = options;
    const path0 = process.env.PATH;
    const s = standInTools({ form: 'node' });
    assert.ok(process.env.PATH.startsWith(s.dir));
    assert.match(process.env.NODE_OPTIONS, /--require ".*stand-in-preload\.cjs"/);
    s.restore();
    assert.equal(process.env.PATH, path0);
    assert.equal(process.env.NODE_OPTIONS, options);
  }
  delete process.env.NODE_OPTIONS;
});

test('guardedRun refuses a stood-in program by base name, with any extension or folder, and passes git', async () => {
  const log = [];
  const passed = [];
  const run = guardedRun(async (file, args) => { passed.push([file, ...args]); return { code: 0, stdout: 'ok', stderr: '' }; }, { log });
  for (const file of ['/opt/homebrew/bin/gh', 'C:\\Program Files\\GitHub CLI\\gh.exe', 'curl', 'security.cmd', 'C:\\x\\GH.EXE', 'Curl.COM']) {
    const out = await run(file, ['x', 'y']);
    assert.deepEqual(out, { code: 1, stdout: '', stderr: `${file.split(/[\\/]/).pop().replace(/\.(exe|cmd|bat|com)$/i, '').toLowerCase()} is not run in this test` });
  }
  assert.deepEqual(log, ['gh x y', 'gh x y', 'curl x y', 'security x y', 'gh x y', 'curl x y']);
  assert.equal((await run('git', ['status'])).stdout, 'ok');
  assert.equal((await run('/usr/bin/git', ['log'])).code, 0);
  assert.deepEqual(passed, [['git', 'status'], ['/usr/bin/git', 'log']]);
});

// Every .js file under tests/, as paths.
function testFiles(dir = TESTS) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return e.name === 'node_modules' ? [] : testFiles(p);
    return e.name.endsWith('.js') ? [p] : [];
  });
}

// The text of each call to `name(` in source: from the opening parenthesis to its match, skipping
// definitions (`function name(`) and strings and comments' parentheses are not told apart, which
// only makes the scan stricter.
function callsTo(source, name) {
  const found = [];
  const re = new RegExp(`(?<![\\w.$])${name}\\(`, 'g');
  for (let m = re.exec(source); m; m = re.exec(source)) {
    if (/function\s+$/.test(source.slice(0, m.index))) continue;
    let depth = 1;
    let i = m.index + m[0].length;
    for (; i < source.length && depth > 0; i++) {
      if (source[i] === '(') depth++;
      else if (source[i] === ')') depth--;
    }
    found.push({ at: m.index, text: source.slice(m.index + m[0].length, i - 1) });
  }
  return found;
}

// What is wrong with a test file's way of starting the helper: a call with more than one `run` key
// (the later wins), a call that names no guarded runner (`run: hostGuard` or `run: guardedRun(...)`;
// a bare `run` shorthand counts only where the file has no unguarded call to a real run; setup-e2e's
// `run: c.run` is its own refuser), a default or assignment of the real run (`= realRun`), and any
// call to `realRun(x, ...)` / `run(x, ...)` that isn't guarded by `=== 'git'` or for the Node.js
// binary. A fall-through is safe only through hostGuard or guardedRun.
function unguardedHelper(source, { file = '' } = {}) {
  const problems = [];
  const calls = callsTo(source, 'startHelper');
  if (calls.length === 0) return problems;
  const lineOf = (at) => source.slice(0, at).split('\n').length;
  const lines = source.split('\n');
  // `run` is the real run only where the file imports it under that name.
  const names = /import \{ run \} from '[^']*lib\/run\.js'/.test(source) ? 'realRun|run' : 'realRun';
  const fallThroughs = lines.flatMap((text, i) => (new RegExp(`(?<![\\w.])(${names})\\(\\w+,`).test(text) && !/===\s*'git'|process\.execPath|const git =/.test(text) ? [i + 1] : []));
  for (const n of fallThroughs) problems.push(`${n}: a run falls through to a real run`);
  const defaults = lines.flatMap((text, i) => (new RegExp(`(?<![=!<>])=\\s*(${names})\\b(?!\\s*[(.\\w])`).test(text) && !/^\s*(import|\/\/)/.test(text) ? [i + 1] : []));
  for (const n of defaults) problems.push(`${n}: the real run is a default or assignment`);
  for (const { at, text } of calls) {
    const keys = (text.match(/(?<![\w.])run\s*[:,}]|(?<![\w.])run\s*$/gm) ?? []).length;
    if (keys > 1) problems.push(`${lineOf(at)}: startHelper with more than one run`);
    const own = path.basename(file) === 'setup-e2e.js' && /\brun\s*:\s*c\.run\b/.test(text);
    const named = /\brun\s*:\s*(\w+)\s*[,}\s]/.exec(text)?.[1];
    const guarded = own || (named !== undefined && new RegExp(`\\b${named}\\s*=\\s*hostGuard\\b`).test(source)) || /\brun\s*:\s*(hostGuard\b|guardedRun\()/.test(text) || (/[{,]\s*run\s*[,}]/.test(text) && fallThroughs.length === 0);
    if (!guarded) problems.push(`${lineOf(at)}: startHelper without a guarded run`);
  }
  return problems;
}

test('the scan flags a helper started with a real run, or a run that falls through to one', () => {
  assert.equal(unguardedHelper('await startHelper({ run: realRun, address });').length, 1);
  assert.equal(unguardedHelper('// run\nawait startHelper({ address });').length, 1);
  assert.equal(unguardedHelper('const r = (file, args) => realRun(file, args, o);\nawait startHelper({ address, run: r });').length, 2);
  assert.equal(unguardedHelper('const r = (f, a, o) => realRun(f, a, o);\nawait startHelper({ run: hostGuard });').length, 1);
  assert.equal(unguardedHelper("if (file !== 'git') return realRun(file, args);\nawait startHelper({ run: hostGuard });").length, 1);
  assert.equal(unguardedHelper('await startHelper({ run: hostGuard, address, run: other });').length, 1);
  assert.equal(unguardedHelper("import { run } from '../scripts/lib/run.js';\nasync function via({ runWith = run } = {}) {\n await startHelper({ run: runWith });\n}").length >= 2, true);
  assert.deepEqual(unguardedHelper('async function via({ runWith = hostGuard } = {}) {\n await startHelper({ run: runWith });\n}'), []);
  assert.equal(unguardedHelper('const base = realRun;\nawait startHelper({ run: hostGuard });').length, 1);
  assert.deepEqual(unguardedHelper('await startHelper({ run: hostGuard, address });'), []);
  assert.deepEqual(unguardedHelper("await startHelper({ run: guardedRun(realRun, { log }) });"), []);
  assert.deepEqual(unguardedHelper("if (file === 'git') return realRun(file, args);\nawait startHelper({ run: hostGuard });"), []);
  assert.deepEqual(unguardedHelper('await startHelper({ run: c.run });', { file: 'x/setup-e2e.js' }), []);
  assert.equal(unguardedHelper('await startHelper({ run: c.run });', { file: 'x/other.js' }).length, 1);
});

test('no test starts the real helper without a guarded run, or runs the trials without a spawn', () => {
  const missing = [];
  for (const file of testFiles()) {
    if (file === SELF) continue;
    const source = fs.readFileSync(file, 'utf8');
    const line = (at) => source.slice(0, at).split('\n').length;
    for (const problem of unguardedHelper(source, { file })) missing.push(`${path.relative(TESTS, file)}:${problem}`);
    // The trials test's own fakes() hands every run a spawn; its calls name no spawn themselves.
    const fakesSpawn = /function fakes\([\s\S]*?\n {4}spawn:/.test(source);
    for (const { at, text } of callsTo(source, 'runTrials')) {
      if (!/\bspawn\b/.test(text) && !(fakesSpawn && /fakes\(|^\s*\w+\s*$/.test(text))) missing.push(`${path.relative(TESTS, file)}:${line(at)} runTrials without spawn`);
    }
  }
  assert.deepEqual(missing, []);
});

test('a test process finds a launchctl that refuses', { skip: process.platform === 'win32' ? 'no launchctl here' : false }, () => {
  const got = spawnSync('launchctl', ['print', 'gui/1/dev.wheelhouse.helper'], { encoding: 'utf8' });
  assert.equal(got.status, 1);
  assert.match(got.stderr, /launchctl is not run in a test/);
});
