// tests/helpers/stand-in-preload.cjs
// Loaded by `--require` (NODE_OPTIONS) in every Node.js process a test starts while the node form of
// the host-tool stand-ins is in place (tests/helpers/host-stand-ins.js). When this process is a
// stand-in, that is a hard link to Node.js named `gh`, `curl` and so on, it logs the call to
// `calls.log` in its own folder and exits: 0 for a call the test accepted (`accept.json`), else 1
// with a line on stderr. In any other Node.js process it does nothing.
'use strict';
const fs = require('node:fs');
const path = require('node:path');

const folder = path.dirname(process.execPath);
const name = path.basename(process.execPath).replace(/\.exe$/i, '');

function names() {
  try {
    return JSON.parse(fs.readFileSync(path.join(folder, 'stood-in.json'), 'utf8'));
  } catch {
    return [];
  }
}

if (name !== 'node' && names().includes(name)) {
  // Node resolves the main module to an absolute path before this runs; the call's first argument
  // is that path made relative again, which is the word the caller typed.
  // With no script (`-e`, `-p`), the flags stand in for the word.
  const first = process.argv[1] === undefined ? process.execArgv : [path.relative(process.cwd(), process.argv[1])];
  const args = [...first, ...process.argv.slice(2)];
  fs.appendFileSync(path.join(folder, 'calls.log'), `${[name, ...args].join(' ')}\n`);
  let accept = {};
  try {
    accept = JSON.parse(fs.readFileSync(path.join(folder, 'accept.json'), 'utf8'));
  } catch { /* nothing accepted */ }
  const taken = (accept[name] ?? []).some((first) => first.every((word, i) => args[i] === word));
  if (taken) process.exit(0);
  fs.writeSync(2, `${name} is not run in this test\n`);
  process.exit(1);
}
