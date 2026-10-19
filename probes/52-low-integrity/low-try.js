// probes/52-low-integrity/low-try.js
// Run by the probe through the low-integrity copy of node.exe (and, as a control,
// through a normal one): tries one operation and prints one JSON line saying
// whether it worked. It does nothing but what its first argument names.
// Usage: node low-try.js <operation> [arguments...]
//   whoami                      `whoami /groups`
//   child-whoami                `whoami /groups` run by a child of this process
//   append <file> <text>        append text to a file (creating it)
//   read <file>                 read the first 80 characters of a file
//   list <folder>               list a folder
//   exec <program> [args...]    run a program, no shell
//   exec-stdin <text> <program> [args...]   the same, with the text (\n for a newline) on its standard input
//   shell <command line>        run a command line in a shell, timed, in the folder it was started in
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';

const [operation, ...args] = process.argv.slice(2);

function say(value) {
  process.stdout.write(`\n${JSON.stringify(value)}\n`);
}

function failure(error) {
  return { ok: false, code: error.code ?? 'ERROR', message: String(error.message ?? error).slice(0, 300) };
}

function outcome(result, started) {
  if (result.error) return { ...failure(result.error), ms: Date.now() - started };
  return {
    ok: result.status === 0,
    status: result.status,
    code: result.status === 0 ? undefined : 'EXIT',
    stdout: String(result.stdout ?? '').slice(-1500),
    stderr: String(result.stderr ?? '').slice(-600),
    ms: Date.now() - started,
  };
}

try {
  const started = Date.now();
  if (operation === 'whoami' || operation === 'child-whoami') {
    // Both start whoami from this process; the second says so only for the report.
    say(outcome(spawnSync('whoami', ['/groups'], { encoding: 'utf8', windowsHide: true }), started));
  } else if (operation === 'append') {
    fs.appendFileSync(args[0], args.slice(1).join(' '));
    say({ ok: true });
  } else if (operation === 'read') {
    say({ ok: true, text: fs.readFileSync(args[0], 'utf8').slice(0, 80) });
  } else if (operation === 'list') {
    say({ ok: true, names: fs.readdirSync(args[0]).slice(0, 20) });
  } else if (operation === 'exec') {
    say(outcome(spawnSync(args[0], args.slice(1), { encoding: 'utf8', windowsHide: true, timeout: 120000 }), started));
  } else if (operation === 'exec-stdin') {
    const input = args[0].replaceAll('\\n', '\n');
    say(outcome(spawnSync(args[1], args.slice(2), { encoding: 'utf8', windowsHide: true, timeout: 120000, input }), started));
  } else if (operation === 'shell') {
    say(outcome(spawnSync(args.join(' '), { encoding: 'utf8', windowsHide: true, shell: true, timeout: 5 * 60 * 1000 }), started));
  } else {
    say({ ok: false, code: 'USAGE', message: `unknown operation ${operation}` });
  }
} catch (error) {
  say(failure(error));
}
