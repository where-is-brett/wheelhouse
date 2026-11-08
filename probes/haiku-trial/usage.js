// probes/haiku-trial/usage.js
// Adds up the tokens each role used in the trial, from the usage on every assistant turn.
import { entriesOf } from './audit.js';

const zero = () => ({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0 });
const count = (value) => (Number.isFinite(value) ? value : 0);

function add(into, usage) {
  into.input += count(usage.input_tokens);
  into.output += count(usage.output_tokens);
  into.cacheRead += count(usage.cache_read_input_tokens);
  into.cacheWrite += count(usage.cache_creation_input_tokens);
}

export function readUsage(transcripts) {
  const byRole = {};
  const total = zero();
  for (const { file, role } of transcripts) {
    for (const entry of entriesOf(file)) {
      const usage = entry.type === 'assistant' ? entry.message?.usage : undefined;
      if (usage === null || typeof usage !== 'object') continue;
      byRole[role] ??= zero();
      add(byRole[role], usage);
      add(total, usage);
    }
  }
  return { byRole, total };
}

export function usageNote({ byRole }) {
  return Object.entries(byRole)
    .map(([role, u]) => `${role}: input ${u.input}, output ${u.output}, cache read ${u.cacheRead}, cache write ${u.cacheWrite}`)
    .join('\n');
}
