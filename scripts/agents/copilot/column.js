// scripts/agents/copilot/column.js
// The routing table's Copilot column under the build engine (Archon design, sections 10 and 13), from the models the
// account offers, read at setup through the CLI's ACP `session/new` (check 74 read it so), which starts no prompt and
// spends no request. Each model has the rate it counts at: an included model 0, Auto 1 on a plan with none (check 74).
// The column takes an included model where the plan has one, and Copilot's own pick, Auto, where it has none; a
// premium model is only ever the director's opt-in. The list is kept in the engine folder, beside the CLI.
import fs from 'node:fs';
import path from 'node:path';
import { isModelName } from '../../gate/guardrails.js';
import { copilotCliPaths } from '../../engine/archon/copilot-cli.js';
import { engineDir } from '../../lib/paths.js';
import { CREDITS_PER_PROMPT } from '../../engine/spend.js';

// Copilot's own pick, and the model a step runs on when nothing else is named.
export const COPILOT_PICK = 'auto';

// A rate as the list writes it ('0x', '1x', '0.33x'), or null when it can't be read.
const rateOf = (text) => {
  const m = /^(\d+(?:\.\d+)?)x$/.exec(String(text ?? '').trim());
  return m ? Number(m[1]) : null;
};

// The models in a `session/new` result, as [{ id, multiplier }], in the list's order. A model without a plain name
// is left out; a rate that can't be read is null, which counts as one (requestRates), never as zero.
export function parseAccountModels(result) {
  const list = result?.models?.availableModels;
  if (!Array.isArray(list)) return [];
  return list.flatMap((m) => {
    const id = m?.modelId ?? m?.id;
    if (typeof id !== 'string' || !isModelName(id)) return [];
    return [{ id, multiplier: rateOf(m?._meta?.copilotUsage ?? m?.copilotUsage) }];
  });
}

export const modelsFile = (engine = engineDir()) => path.join(copilotCliPaths(engine).folder, 'models.json');

export function writeAccountModels(engine, models, { now = () => new Date() } = {}) {
  const file = modelsFile(engine);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify({ readAt: now().toISOString(), models }, null, 2)}\n`);
}

// The list setup kept, or [] when there is none or it can't be read.
export function readAccountModels(engine = engineDir()) {
  try {
    const kept = JSON.parse(fs.readFileSync(modelsFile(engine), 'utf8'));
    return Array.isArray(kept?.models) ? kept.models.filter((m) => typeof m?.id === 'string' && isModelName(m.id)) : [];
  } catch {
    return [];
  }
}

// The column's model: the first included model on the list, or Copilot's own pick.
export function copilotColumn(models) {
  const included = (models ?? []).find((m) => m.multiplier === 0);
  return included ? { model: included.id, included: true } : { model: COPILOT_PICK, included: false };
}

// Calibration of CREDITS_PER_PROMPT (0.25), from check 79's attempt of 5 November 2026. GitHub bills Copilot in AI
// credits, not whole premium requests: a short Auto prompt cost about 0.16 credits (the CLI prints it), and over 17 Auto
// steps `quota_remaining` fell from 180.4 to 177.9, which is 2.5 credits, about 0.15 a step. The record's tokens (11,704
// and 35,090 on two steps) give no credit price, so the estimate is a figure per prompt, set above the highest one seen
// (0.16) so that it runs high and never low: a gate that lets spend through unseen is worse than a cautious one. Each
// day the meter replaces it with GitHub's own `quota_remaining` (scripts/engine/archon/copilot-meter.js). Re-calibrate
// when GitHub changes its prices or the figure there drifts from this one.
// The AI credits each model's prompt is estimated to cost: its multiplier from the list times a prompt's credits at
// Auto (CREDITS_PER_PROMPT, calibrated in scripts/engine/spend.js), and a rate of one for a model the list doesn't
// rate, never zero. An included model (0x) counts nothing until GitHub's own figure says otherwise.
export function requestRates(models) {
  const known = new Map((models ?? []).filter((m) => typeof m.multiplier === 'number').map((m) => [m.id, m.multiplier]));
  return (model) => Math.round((known.get(model) ?? 1) * CREDITS_PER_PROMPT * 100) / 100;
}
