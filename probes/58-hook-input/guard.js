// probes/58-hook-input/guard.js
// The hook for check 58. It logs everything Copilot gives it, then behaves as told, so the probe can see what a
// guard is given and how each kind of answer lands.
// Run as: node guard.js <log file> <tag> <event> [mode [seconds]]
//   mode log (default)  print nothing, exit 0
//   mode deny           answer deny (permissionDecision) for the view tool, nothing for any other, exit 0
//   mode exit1          exit 1
//   mode exit2          exit 2
//   mode sleep          wait <seconds>, then exit 0; a second line with phase "woke" is logged if it got that far
// The tag names the file the hook was registered in; the event is the name it was registered under (camelCase or
// PascalCase), so both registrations can be told apart in the log.
import { appendJsonl } from '../lib/log.js';

const [file, tag, event, mode = 'log', seconds = '0'] = process.argv.slice(2);

const ENV_NAME = /^(COPILOT|CLAUDE|GITHUB|GH_|CODESPACES|SANDBOX|TERM_PROGRAM|CI$)|SANDBOX/i;
const SECRET_NAME = /token|key|secret|auth|pass/i;

function toolNameOf(input) {
  return input?.toolName ?? input?.tool_name ?? '';
}

function answerFor(mode, input) {
  if (mode === 'deny' && /^(view|read)$/i.test(toolNameOf(input))) {
    return JSON.stringify({ permissionDecision: 'deny', permissionDecisionReason: 'Wheelhouse probe 58 refuses this tool' });
  }
  return '';
}

function environment() {
  const found = {};
  for (const [name, value] of Object.entries(process.env)) {
    if (ENV_NAME.test(name)) found[name] = SECRET_NAME.test(name) ? '[set]' : value;
  }
  return found;
}

async function log(extra) {
  if (file) await appendJsonl(file, { at: new Date().toISOString(), tag, event, mode, cwd: process.cwd(), ...extra });
}

{
  let raw = '';
  let input;
  try {
    process.stdin.setEncoding('utf8');
    for await (const chunk of process.stdin) raw += chunk;
    try { input = JSON.parse(raw); } catch { input = { unparsed: raw }; }
    await log({ phase: 'start', raw, input, argv: process.argv.slice(2), env: environment() });
  } catch {
    // Logging must never change what Copilot does.
  }
  if (mode === 'exit1') {
    process.stderr.write('probe 58 guard: exiting 1\n');
    process.exit(1);
  }
  if (mode === 'exit2') {
    process.stderr.write('probe 58 guard: exiting 2\n');
    process.exit(2);
  }
  if (mode === 'sleep') {
    await new Promise((resolve) => setTimeout(resolve, Number(seconds) * 1000));
    try { await log({ phase: 'woke', input }); } catch { /* ignore */ }
  }
  const answer = answerFor(mode, input);
  if (answer) process.stdout.write(answer + '\n');
  process.exit(0);
}
