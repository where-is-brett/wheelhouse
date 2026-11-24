// tests/scripts/lib/windows-hide.test.js
// Every program Wheelhouse starts is started with its console window hidden (windowsHide: true), so no blank window shows on
// Windows. The source is read for each call to spawn, spawnSync, execFile, execFileSync and execSync, and each must pass the option
// in its own arguments. The two wrappers that pass on a caller's options are named below, and their callers are read too.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const FOLDERS = ['scripts', 'adapters', 'hooks', 'bin', 'engine', 'lineage'];
const CALL = /(?<![.\w])(spawn|spawnSync|execFile|execFileSync|execSync|nodeSpawn|spawnChild)\(/g;
// A call that hands on options it is given: launchHere gets the foreman's session options (read below), and the health trial's
// stand-ins are `deps.spawn`, whose own calls are the ones below.
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

// Each call in `text`: its text, from the name to the closing bracket.
function callsIn(text) {
  const found = [];
  for (const match of text.matchAll(CALL)) {
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

test('every program started by scripts, adapters and hooks is started with windowsHide: true', () => {
  const unhidden = [];
  let seen = 0;
  for (const file of FOLDERS.flatMap(sources)) {
    const rel = file.split(path.sep).join('/');
    for (const call of callsIn(fs.readFileSync(path.join(ROOT, file), 'utf8'))) {
      seen += 1;
      if (/\bwindowsHide\s*:\s*true\b/.test(call.text)) continue;
      // `windowsHide` given as a variable or a default (`windowsHide = true` in lib/run.js) is read where it is set.
      if (/\bwindowsHide\b(?!\s*:\s*false)/.test(call.text) && !/windowsHide\s*:\s*false/.test(call.text)) continue;
      if (PASSES_ON.has(`${rel}: ${call.text.replace(/\s+/g, ' ')}`)) continue;
      unhidden.push(`${rel}:${call.line}`);
    }
  }
  assert.ok(seen > 20, 'the scan found the calls');
  // health/trials.js: its stand-in `spawn` has options in the one place it is made, and the two callers pass none.
  assert.deepEqual(unhidden.filter((at) => !at.startsWith('scripts/health/trials.js:')), []);
});

test('the foreman\'s own session and the waker\'s children are started hidden, and the waker\'s child is not a detached process on Windows', () => {
  const start = fs.readFileSync(path.join(ROOT, 'scripts/foreman/start.js'), 'utf8');
  assert.match(start, /stdio: 'inherit', windowsHide: true, windowsVerbatimArguments/);
  const waker = fs.readFileSync(path.join(ROOT, 'scripts/watcher/waker.js'), 'utf8');
  // A detached process on Windows has no console, so the cmd.exe a .cmd shim runs through would open one of its own, in view.
  assert.match(waker, /detached: process\.platform !== 'win32', windowsHide: true, shell: false/);
  assert.doesNotMatch(waker, /detached: true/);
});
