// probes/32-mod-sandbox/child.js
// Check 32: run by the probe mod (through $.process.run) and by an agent
// (through the Bash tool). Tries to read the key file in the folder the scratch
// project's sandbox denies, and to write a file there, and prints one JSON line
// saying what happened. It never prints what it read.
// Run as: node child.js <who> [<denied folder>]
import fs from 'node:fs';
import path from 'node:path';

const [who = 'unknown', given] = process.argv.slice(2);
const denied = given && given !== 'undefined' ? given : process.env.PROBE32_DENIED;
const result = { who, node: process.execPath, version: process.version, denied };

try {
  fs.readFileSync(path.join(denied, 'key.txt'), 'utf8');
  result.read = 'ok';
} catch (err) {
  result.read = err.code ?? String(err);
}
try {
  fs.writeFileSync(path.join(denied, `written-by-${who}.txt`), 'probe\n');
  result.write = 'ok';
} catch (err) {
  result.write = err.code ?? String(err);
}
console.log(JSON.stringify(result));
