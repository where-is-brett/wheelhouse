// scripts/engine/archon/record.js
// Reads `archon workflow get <run> --json --verbose` into the engine interface's inspect shape. Spend is taken as the
// provider reported it, step by step; where Archon has no figure the step's source is 'unknown' and the figure is
// null, never zero (spec 6.1, 10).

const STATUS = { pending: 'running', running: 'running', paused: 'paused', completed: 'ended', failed: 'ended', cancelled: 'ended' };

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const figure = (value) => (typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null);
const reported = (measure) => isObject(measure) && measure.source === 'provider';
const noCall = (measure) => isObject(measure) && measure.source === 'unavailable' && measure.reason === 'not_applicable';

// How the run ended, in the interface's words: completed, failed or cancelled; null while it runs.
function outcomeOf(json) {
  if (json.status === 'cancelled') return 'cancelled';
  if (json.status === 'failed') return 'failed';
  if (json.status === 'completed') return json.outcome === 'failed' ? 'failed' : 'completed';
  return null;
}

// One node's spend. A node that called no provider (a shell step) spent nothing, which is a known zero. Tokens are
// known only when both the input and the output figure are: a missing one is unknown, not zero.
function spendOf(spend) {
  if (noCall(spend?.tokens) && noCall(spend?.costUsd)) return { tokens: 0, dollars: 0, source: 'reported' };
  const counted = reported(spend?.tokens) && isObject(spend.tokens.value) ? spend.tokens.value : {};
  const input = figure(counted.input);
  const output = figure(counted.output);
  const tokens = input === null || output === null ? null : input + output;
  if (reported(spend?.costUsd) && figure(spend.costUsd.value) !== null) return { tokens, dollars: spend.costUsd.value, source: 'reported' };
  return { tokens, dollars: null, source: 'unknown' };
}

// A step for each node that ran with its own spend. A node whose row restates spend that other rows carry (a loop
// group, a fan-out) is left out, so adding the steps up never counts anything twice.
function stepsOf(nodes) {
  if (!Array.isArray(nodes)) return [];
  return nodes.filter((n) => isObject(n?.execution) && (n.execution.accounting ?? 'node') === 'node').map((n) => {
    const { binding = {}, timing = {}, spend } = n.execution;
    const model = reported(binding.model?.resolved) ? binding.model.resolved.value : binding.model?.requested ?? null;
    const duration = figure(n.durationMs ?? timing.durationMs);
    return {
      id: n.nodeId,
      role: n.nodeId,
      provider: binding.provider ?? null,
      model,
      ...spendOf(spend),
      minutes: duration === null ? null : Math.round(duration / 600) / 100,
    };
  });
}

// The run's own totals: what Archon summed, with null where it says the count is incomplete.
function totalsOf(metadata) {
  const unknownTokens = metadata.total_tokens_unknown === true || metadata.total_tokens_unknown === null;
  const tokensIn = figure(metadata.total_tokens_in);
  const tokensOut = figure(metadata.total_tokens_out);
  return {
    dollars: figure(metadata.total_cost_usd),
    tokens: unknownTokens || tokensIn === null || tokensOut === null ? null : tokensIn + tokensOut,
  };
}

// The inspect shape: { status, outcome, steps, branch, pr, head, digest, ownerPid, totals }. The branch, pull request
// and head come from the run's returned value (the pack's last step returns them); `digest` is the digest of the
// workflow source the run froze; `ownerPid` is the process that owns the run (All stop ends its tree).
export function readRecord(json) {
  const metadata = isObject(json?.metadata) ? json.metadata : {};
  const returns = json?.terminal_record?.returns;
  const value = returns?.availability === 'available' && isObject(returns.value) ? returns.value : {};
  const pid = metadata.execution_owner?.pid;
  return {
    status: STATUS[json?.status] ?? 'unknown',
    outcome: outcomeOf(json ?? {}),
    steps: stepsOf(json?.nodes),
    branch: typeof value.branch === 'string' ? value.branch : null,
    pr: typeof value.pr === 'string' || typeof value.pr === 'number' ? value.pr : null,
    head: typeof value.head === 'string' ? value.head : null,
    digest: typeof metadata.workflow_source?.digest === 'string' ? metadata.workflow_source.digest : null,
    ownerPid: Number.isInteger(pid) && pid > 0 ? pid : null,
    totals: totalsOf(metadata),
  };
}
