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

// The providers whose plan counts each prompt sent as a request, and the rate each model counts at. The account
// has no included model (checks 74 and 79), so Copilot's Auto, and any model not listed, counts one a prompt.
export const REQUEST_RATES = Object.freeze({ copilot: Object.freeze({ auto: 1 }) });
const rateOf = (provider, model) => REQUEST_RATES[provider]?.[model] ?? 1;

// One node's spend. A node that called no provider (a shell step) spent nothing, which is a known zero. Tokens are
// known only when both the input and the output figure are: a missing one is unknown, not zero. The four kinds of
// token are kept apart (check 79). A step on a provider that counts requests counts its prompt at its model's rate,
// an estimate: the provider reports no cost.
function spendOf(spend, provider, model) {
  const counts = Object.hasOwn(REQUEST_RATES, provider);
  if (noCall(spend?.tokens) && noCall(spend?.costUsd)) return { tokens: 0, dollars: 0, source: 'reported', kinds: null, requests: 0 };
  const counted = reported(spend?.tokens) && isObject(spend.tokens.value) ? spend.tokens.value : {};
  const input = figure(counted.input);
  const output = figure(counted.output);
  const tokens = input === null || output === null ? null : input + output;
  const kinds = reported(spend?.tokens) ? { input, output, cacheRead: figure(counted.cacheRead), cacheWrite: figure(counted.cacheWrite) } : null;
  const requests = counts ? rateOf(provider, model) : 0;
  if (reported(spend?.costUsd) && figure(spend.costUsd.value) !== null) return { tokens, dollars: spend.costUsd.value, source: 'reported', kinds, requests };
  return { tokens, dollars: null, source: counts && tokens !== null ? 'estimated' : 'unknown', kinds, requests };
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
      ...spendOf(spend, binding.provider ?? null, model),
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

const LOOP_BODY = /^[a-z0-9][\w-]*\.([a-z0-9][\w-]*)$/;

// Each finished step's whole output, by its id, from `archon workflow get <run> --json --verbose --events`: the last
// node_completed row for each step, so a step run again reads as its last run. A step's output is its text, or its
// structured output as JSON text. A skipped or failed step has none.
export function readOutputs(json) {
  const outputs = {};
  const rows = (Array.isArray(json?.events) ? json.events : [])
    .filter((row) => row?.event_type === 'node_completed' && typeof row.step_name === 'string' && typeof row.data?.node_output === 'string');
  for (const row of rows) outputs[row.step_name] = row.data.node_output;
  // A loop body's step is named `<group>.<step>`, once a round; it is also given under its own id, from its last
  // round, unless a top-level step has that id.
  for (const row of rows) {
    const body = LOOP_BODY.exec(row.step_name)?.[1];
    if (body && !rows.some((r) => r.step_name === body)) outputs[body] = row.data.node_output;
  }
  return outputs;
}

// The inspect shape: { status, outcome, steps, branch, pr, head, digest, source, ownerPid, totals }. The branch, pull request
// and head come from the run's returned value (the pack's last step returns them); `digest` is the digest of the
// workflow source the run froze and `source` the folder Archon froze it into; `ownerPid` is the process that owns the run (All stop ends its tree).
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
    source: typeof metadata.workflow_source?.root === 'string' ? metadata.workflow_source.root : null,
    ownerPid: Number.isInteger(pid) && pid > 0 ? pid : null,
    totals: totalsOf(metadata),
  };
}
