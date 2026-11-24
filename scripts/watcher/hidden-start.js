// scripts/watcher/hidden-start.js
// The waker's go-between on Windows. The waker starts this detached, so neither it nor the program outlives or dies with the
// watcher; but a detached process on Windows has no console, and a console program it starts (the cmd.exe a .cmd shim runs
// through, a hook, a shell) would open a console window of its own, in view. So this starts the program itself, not detached
// and with windowsHide, which gives it a console with no window that what it starts shares. Node puts that child in a job
// that ends it when this process ends, so ending this process (All stop, the director's "now") ends the program too.
//
// What to start comes first on stdin, as one line of JSON `{ file, args, verbatim }`; the rest of stdin is the program's
// input. The program's output and errors come back on this process's own, and its exit code is this process's.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import { startedAsScript } from '../lib/started-as-script.js';

// Splits what came on stdin into the call and the input after it, or null when the first line is not a call.
export function readCall(text) {
  const end = text.indexOf('\n');
  if (end === -1) return null;
  let call;
  try {
    call = JSON.parse(text.slice(0, end));
  } catch {
    return null;
  }
  if (typeof call?.file !== 'string' || call.file === '' || !Array.isArray(call.args) || !call.args.every((a) => typeof a === 'string')) return null;
  return { file: call.file, args: call.args, verbatim: call.verbatim === true, input: text.slice(end + 1) };
}

// The line the waker writes ahead of the input.
export const callLine = (file, args, verbatim) => `${JSON.stringify({ file, args, verbatim: verbatim === true })}\n`;

// Written to this process's own output; a stream that is gone is let go.
const pass = (fd) => (chunk) => {
  try {
    fs.writeSync(fd, chunk);
  } catch { /* nowhere to put it */ }
};

export function main({ stdin = process.stdin, exit = process.exit } = {}) {
  const parts = [];
  stdin.on('data', (chunk) => parts.push(chunk));
  stdin.on('end', () => {
    const call = readCall(Buffer.concat(parts).toString('utf8'));
    if (call === null) {
      exit(2);
      return;
    }
    // Pipes, not this process's own handles, so Node can start the program with no console window at all.
    const child = spawn(call.file, call.args, {
      windowsHide: true, shell: false, windowsVerbatimArguments: call.verbatim, stdio: [call.input ? 'pipe' : 'ignore', 'pipe', 'pipe'],
    });
    child.once('error', () => exit(1));
    child.stdout.on('data', pass(1));
    child.stderr.on('data', pass(2));
    if (call.input) {
      child.stdin.on('error', () => {});
      child.stdin.end(call.input);
    }
    child.once('close', (code) => exit(Number.isInteger(code) ? code : 1));
  });
}

if (startedAsScript(import.meta.url)) main();
