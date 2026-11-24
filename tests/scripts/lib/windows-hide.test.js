// tests/scripts/lib/windows-hide.test.js
// Every program Wheelhouse starts is started with its console window hidden (windowsHide: true), so no blank window shows on
// Windows. The source is read for each call that starts a program: spawn, spawnSync, execFile, execFileSync, execSync, exec and
// fork, by the names each file imports them under (`spawn as nodeSpawn`) or through the module (`childProcess.spawnSync`), and each
// must pass the option in its own arguments. A name a file binds again for itself (trials.js's `const spawn = deps.spawn ?? ...`)
// is that file's wrapper: its calls are not read, but the call inside it is. The one call that hands on options it is given is
// named below, and those options are read in the second test.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const FOLDERS = ['scripts', 'adapters', 'hooks', 'bin', 'engine', 'lineage'];
const STARTERS = ['spawn', 'spawnSync', 'execFile', 'execFileSync', 'execSync', 'exec', 'fork'];
// launchHere gets the foreman's session options, read in the second test.
const PASSES_ON = new Set(['scripts/foreman/start.js: nodeSpawn(file, args, options)']);

const sources = (folder) => {
  const at = path.join(ROOT, folder);
  if (!fs.existsSync(at)) return [];
  return fs.readdirSync(at, { withFileTypes: true }).flatMap((entry) => {
    const rel = path.join(folder, entry.name);
    if (entry.isDirectory()) return entry.name === 'node_modules' ? [] : sources(rel);
    return /\.(?:js|mjs|cjs)$/.test(entry.name) ? [rel] : [];
  });
};

// A name as a pattern that matches it exactly: every character with a meaning in a pattern, the backslash among them, escaped.
const escape = (name) => name.replace(/[\\^$.*+?()[\]{}|/]/g, '\\$&');
// The names under which `text` can call a starter: the starters' own names (a parameter named `spawn` is taken as one), the
// names it imports them under, `<module>.<starter>` for the module imported or required whole, and a parameter or variable
// defaulted to any of those (`{ spawn: run = nodeSpawn }`). A name the file binds again to its own wrapper, made with
// windowsHide: true, is left to the call inside the wrapper (trials.js's `const spawn = deps.spawn ?? ((f, a) => spawnSync(...))`).
function startersIn(text) {
  const names = new Set(STARTERS);
  for (const [, list] of text.matchAll(/import\s*\{([^}]*)\}\s*from\s*['"](?:node:)?child_process['"]/g)) {
    for (const part of list.split(',')) {
      const [given, local] = part.trim().split(/\s+as\s+/);
      if (STARTERS.includes(given) && local) names.add(local);
    }
  }
  for (const [, list] of text.matchAll(/(?:const|let|var)\s*\{([^}]*)\}\s*=\s*require\(\s*['"](?:node:)?child_process['"]\s*\)/g)) {
    for (const part of list.split(',')) {
      const [given, local] = part.trim().split(/\s*:\s*/);
      if (STARTERS.includes(given) && local) names.add(local);
    }
  }
  const whole = [
    ...text.matchAll(/import\s+(?:\*\s+as\s+)?([A-Za-z_$][\w$]*)\s+from\s*['"](?:node:)?child_process['"]/g),
    ...text.matchAll(/(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:await\s+import|require)\(\s*['"](?:node:)?child_process['"]\s*\)/g),
  ].map(([, name]) => name);
  for (const module of whole) for (const starter of STARTERS) names.add(`${module}.${starter}`);
  for (const name of [...names]) {
    for (const [, local] of text.matchAll(new RegExp(`([A-Za-z_$][\\w$]*)\\s*=\\s*${escape(name)}\\s*[,)};]`, 'g'))) names.add(local);
  }
  return [...names].filter((name) => {
    const bound = new RegExp(`(?:const|let|var)\\s+${escape(name)}\\s*=([^;]*)`).exec(text);
    return bound === null || !/windowsHide\s*:\s*true/.test(bound[1]);
  });
}

// Each call in `text` to one of `names`: its line and its text, from the name to the closing bracket.
function callsIn(text, names) {
  const call = new RegExp(`(?<![.\\w$])(?:${names.map((n) => n.split('.').map(escape).join('\\s*\\.\\s*')).join('|')})\\(`, 'g');
  const found = [];
  for (const match of text.matchAll(call)) {
    let depth = 1;
    let i = match.index + match[0].length;
    while (depth > 0 && i < text.length) {
      if (text[i] === '(') depth += 1;
      else if (text[i] === ')') depth -= 1;
      i += 1;
    }
    found.push({ line: text.slice(0, match.index).split('\n').length, text: text.slice(match.index, i) });
  }
  return found;
}

test('the scan finds starters under other names, through the module, and leaves a file\'s own wrapper to the call inside it', () => {
  const text = [
    "import { spawn as nodeSpawn, execFileSync } from 'node:child_process';",
    "const childProcess = require('child_process');",
    'nodeSpawn(a, b, { windowsHide: true });',
    'execFileSync(a, b);',
    'childProcess.spawnSync(a, b);',
    'x.execFileSync(a);',
  ].join('\n');
  assert.deepEqual(callsIn(text, startersIn(text)).map((c) => c.line), [3, 4, 5]);
  const wrapped = "import { spawnSync } from 'node:child_process';\nconst spawn = deps.spawn ?? ((f) => spawnSync(f, [], { windowsHide: true }));\nspawn('curl');";
  assert.deepEqual(callsIn(wrapped, startersIn(wrapped)).map((c) => c.text), ["spawnSync(f, [], { windowsHide: true })"]);
  const injected = "export function go({ spawn: run = nodeSpawn } = {}) { run(a, b); }\nimport { spawn as nodeSpawn } from 'node:child_process';";
  assert.deepEqual(callsIn(injected, startersIn(injected)).map((c) => c.text), ['run(a, b)'], 'a starter given as a default is read where it is called');
  const unsafe = "import { spawnSync } from 'node:child_process';\nconst spawn = deps.spawn ?? spawnSync;\nspawn('curl');";
  assert.deepEqual(callsIn(unsafe, startersIn(unsafe)).map((c) => c.line), [3], 'a name bound again without the option is still read');
});

test('every program started by scripts, adapters and hooks is started with windowsHide: true', () => {
  const unhidden = [];
  let seen = 0;
  for (const file of FOLDERS.flatMap(sources)) {
    const rel = file.split(path.sep).join('/');
    const text = fs.readFileSync(path.join(ROOT, file), 'utf8');
    for (const call of callsIn(text, startersIn(text))) {
      seen += 1;
      if (/\bwindowsHide\s*:\s*true\b/.test(call.text)) continue;
      // `windowsHide` given as a variable or a default (`windowsHide = true` in lib/run.js) is read where it is set.
      if (/\bwindowsHide\b/.test(call.text) && !/windowsHide\s*:\s*false/.test(call.text)) continue;
      if (PASSES_ON.has(`${rel}: ${call.text.replace(/\s+/g, ' ')}`)) continue;
      unhidden.push(`${rel}:${call.line}`);
    }
  }
  assert.ok(seen > 20, 'the scan found the calls');
  assert.deepEqual(unhidden, []);
});

test('the foreman\'s own session is started hidden, and the waker starts its children detached and, on Windows, through hidden-start', () => {
  const start = fs.readFileSync(path.join(ROOT, 'scripts/foreman/start.js'), 'utf8');
  assert.match(start, /stdio: 'inherit', windowsHide: true, windowsVerbatimArguments/);
  const waker = fs.readFileSync(path.join(ROOT, 'scripts/watcher/waker.js'), 'utf8');
  // Detached everywhere, so a session outlives the watcher: on Windows a child not detached is in the job Node ends with it.
  assert.match(waker, /spawn\(relay \? process\.execPath : file, relay \? \[HIDDEN_START\] : args, \{\s*cwd, env, detached: true, windowsHide: true, shell: false,/);
  assert.match(waker, /const relay = platform === 'win32';/);
  // The go-between gives the program a console with no window, which what it starts shares: not detached, hidden, on pipes.
  const relay = fs.readFileSync(path.join(ROOT, 'scripts/watcher/hidden-start.js'), 'utf8');
  const [call] = callsIn(relay, startersIn(relay));
  assert.match(call.text, /windowsHide: true/);
  assert.doesNotMatch(call.text, /detached/);
  assert.match(call.text, /stdio: \[call\.input \? 'pipe' : 'ignore', 'pipe', 'pipe'\]/);
});
