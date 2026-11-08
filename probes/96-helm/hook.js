// probes/96-helm/hook.js
// A hook for check 96: appends the fields of the hook input the probe reads, with the variables the helm's terminal
// gives the session, to the file named on the command line. It says nothing on stdout and always exits 0.
// Run as: node "<path>/hook.js" <log file>
import { appendJsonl } from '../lib/log.js';

let raw = '';
process.stdin.setEncoding('utf8');
for await (const chunk of process.stdin) raw += chunk;
try {
  const input = JSON.parse(raw);
  await appendJsonl(process.argv[2], {
    at: new Date().toISOString(),
    event: input.hook_event_name,
    session: input.session_id,
    mode: input.permission_mode ?? null,
    tool: input.tool_name ?? null,
    reason: input.reason ?? null,
    entrypoint: process.env.CLAUDE_CODE_ENTRYPOINT ?? null,
    role: process.env.WHEELHOUSE_ROLE ?? null,
  });
} catch { /* a probe's hook never fails a session */ }
