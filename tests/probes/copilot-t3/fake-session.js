// tests/probes/copilot-t3/fake-session.js
// A stand-in for one `copilot -p` run, for the T3 runner's tests: `node fake-session.js <mode> <usage file> <requests> [subagents]`.
// `hang` prints a finished tool call and then waits to be killed; `finish` prints a run that ends with a result. The figures are the
// arguments', not evidence of anything about the real Copilot.
import fs from 'node:fs';

const [mode, usageFile, requests, subagents = '0'] = process.argv.slice(2);
const line = (event) => process.stdout.write(`${JSON.stringify(event)}\n`);
line({ type: 'session.start', data: {} });
for (let i = 0; i < Number(subagents); i += 1) line({ type: 'tool.execution_start', data: { toolCallId: `t${i}`, toolName: 'task' } });
line({ type: 'tool.execution_start', data: { toolCallId: 'a', toolName: 'view' } });
line({ type: 'tool.execution_complete', data: { toolCallId: 'a', success: true } });
if (mode === 'hang') setTimeout(() => {}, 60000);
else {
  fs.writeFileSync(usageFile, JSON.stringify({ totalPremiumRequestCost: Number(requests) }));
  line({ type: 'result', usage: { premiumRequests: Number(requests) } });
}
