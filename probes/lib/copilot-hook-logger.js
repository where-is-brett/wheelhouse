// probes/lib/copilot-hook-logger.js
// A hook for probes that run Copilot CLI: appends one line to a log file saying which hook ran, on which
// event, from which folder and with what input, then prints nothing and exits 0 (a preToolUse hook that
// exits non-zero would deny the tool call, and the probe is counting, not guarding).
// Run as: node "<path>/copilot-hook-logger.js" <log file> <tag> <event>
// The tag names the file the hook was registered in, so one run's lines say which files Copilot loaded.
import { appendJsonl } from './log.js';

const [file, tag, event] = process.argv.slice(2);

try {
  let raw = '';
  process.stdin.setEncoding('utf8');
  for await (const chunk of process.stdin) raw += chunk;
  let input;
  try {
    input = JSON.parse(raw);
  } catch {
    input = { unparsed: raw };
  }
  if (file) await appendJsonl(file, { at: new Date().toISOString(), tag, event, cwd: process.cwd(), input });
} catch {
  // Never let the logging change what Copilot does.
}
