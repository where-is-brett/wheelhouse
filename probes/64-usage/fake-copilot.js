// probes/64-usage/fake-copilot.js
// A stand-in for Copilot CLI, used only by `run.js --dry-run` so the probe's plumbing can be tested where the real
// Copilot can't run. The fields it makes up are not evidence of anything about the real Copilot.
import fs from 'node:fs';

const args = process.argv.slice(2);
const emit = (type, data, extra = {}) => console.log(JSON.stringify({ type, data, ...extra }));

if (args[0] === '--version') { console.log('GitHub Copilot CLI 0.0.0-stand-in.'); process.exit(0); }
if (args[0] === 'help' && args[1] === 'billing') { console.log('Billing (stand-in)\nFigures come from the service.'); process.exit(0); }
if (args.includes('--log-dir')) {
  const dir = args[args.indexOf('--log-dir') + 1];
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(`${dir}/process.log`, 'debug line (stand-in) standin-model-1\n');
}
if (process.env.WHEELHOUSE_FAKE_FAIL === '1') { console.error('Error: Failed to load models (stand-in)'); process.exit(1); }
const prompt = args[args.indexOf('-p') + 1] ?? '';
const usageFile = args.includes('--usage-output-file') ? args[args.indexOf('--usage-output-file') + 1] : null;
emit('session.tools_updated', { tools: [{ name: 'view' }] });
emit('model.call_start', { model: 'standin-model-1' });
if (/view tool/.test(prompt)) emit('tool.execution_start', { toolCallId: 'c1', toolName: 'view', arguments: { path: 'README.md' } });
emit('model.call_final_result', { model: 'standin-model-1', usage: { inputTokens: 1, outputTokens: 2 } });
emit('assistant.message', { content: 'ok' });
emit('session.usage_checkpoint', { totalPremiumRequestCost: 0, modelMetrics: { 'standin-model-1': { requests: { count: 1, cost: 0 } } } });
if (usageFile) {
  fs.writeFileSync(usageFile, JSON.stringify({
    totalPremiumRequestCost: 0, totalUserRequests: 1, totalNanoAiu: 5, aiCreditsStatus: 'ok',
    tokenDetails: { input: { tokenCount: 1 }, output: { tokenCount: 2 } }, totalApiDurationMs: 3, sessionStartTime: 4, codeChanges: { linesAdded: 0 },
    modelMetrics: { 'standin-model-1': { requests: { count: 1, cost: 0 }, usage: { inputTokens: 1, outputTokens: 2 }, totalNanoAiu: 5 } },
  }));
}
console.log(JSON.stringify({ type: 'result', sessionId: 'sid-1', exitCode: 0, usage: { premiumRequests: 0, totalApiDurationMs: 3, sessionDurationMs: 4, codeChanges: { linesAdded: 0 } } }));
