// scripts/routing/thoroughness.js
// The Thoroughness setting's routing (design section 14.6): for a level, the model and thinking effort of every
// role but the front desk, and the extra checks that go with the level. The columns are the design's table, and a
// cell names a class of model; the project's `tiers.pins` (scripts/gate/guardrails.js) says which model is each class.
// Nothing here reads a file or a setting: callers pass what they have read.
import { ROLES, isModelName } from '../gate/guardrails.js';

export const LEVELS = Object.freeze(['lightest', 'lean', 'balanced', 'thorough']);
export const EFFORTS = Object.freeze(['low', 'medium', 'high', 'xhigh']);

const M = 'mostCapable';
const S = 'midSized';
const cell = (cls, effort, more = {}) => Object.freeze({ class: cls, effort, ...more });
const column = (cells) => Object.freeze(cells);

export const COLUMNS = Object.freeze({
  lightest: column({
    foreman: cell(S, 'low'), feature: cell(S, 'high'), builderCritical: cell(S, 'high'), reviewerCritical: cell(S, 'high'),
    builder: cell(S, 'medium', { rework: 'high' }), tester: cell(S, 'medium', { rework: 'high' }), mechanical: cell(S, 'low'), reviewer: cell(S, 'medium'),
  }),
  lean: column({
    foreman: cell(S, 'low'), feature: cell(M, 'medium'), builderCritical: cell(M, 'medium'), reviewerCritical: cell(M, 'high'),
    builder: cell(S, 'medium', { rework: 'high' }), tester: cell(S, 'medium', { rework: 'high' }), mechanical: cell(S, 'low'), reviewer: cell(S, 'medium'),
  }),
  balanced: column({
    foreman: cell(S, 'medium'), feature: cell(M, 'high'), builderCritical: cell(M, 'high'), reviewerCritical: cell(M, 'high'),
    builder: cell(M, 'medium'), tester: cell(M, 'medium'), mechanical: cell(S, 'medium'), reviewer: cell(S, 'high'),
  }),
  thorough: column({
    foreman: cell(M, 'medium'), feature: cell(M, 'xhigh'), builderCritical: cell(M, 'xhigh'), reviewerCritical: cell(M, 'xhigh'),
    builder: cell(M, 'high'), tester: cell(M, 'high'), mechanical: cell(S, 'medium'), reviewer: cell(M, 'high'),
  }),
});

const lighter = Object.freeze({ secondReviewer: false, trials: 3, screenshots: 'shown-first', builderCap: 1 });
export const EXTRA = Object.freeze({
  lightest: lighter,
  lean: lighter,
  balanced: Object.freeze({ secondReviewer: false, trials: 3, screenshots: 'visual', builderCap: null }),
  thorough: Object.freeze({ secondReviewer: true, trials: 5, screenshots: 'every-size', builderCap: null }),
});

const capitalised = (word) => word[0].toUpperCase() + word.slice(1);
const PREMIUM_MODES = Object.freeze(['within-plan', 'paid-too']);
const PREMIUM_ROLES = Object.freeze(['feature', 'builderCritical']);
// A role with no other model to fall back on, or none different from its own, has no fallback.
const fallbackFor = (role, model, other) => (role === 'reviewerCritical' || other === undefined || other === null || other === model ? null : other);

// The board's one line while the premium model is in use (design section 14.6).
export const PREMIUM_IN_USE = 'Premium model in use for design and risky work.';

// What each role runs on at a level. `config` is a read configuration (readConfig), `ready` the levels (and `premium`)
// whose models have passed the evaluation, `premium` the premium setting and `billing` what is known of how the
// premium model is paid for. A level that can't be used runs at Balanced, with a line saying so.
export function resolveRouting({ config, level, ready = [], premium = 'off', billing = 'unknown' }) {
  const lines = [];
  const readyList = Array.isArray(ready) ? ready.filter((x) => typeof x === 'string') : [];
  let chosen = LEVELS.includes(level) ? level : 'balanced';
  if (chosen !== 'balanced' && !readyList.includes(chosen)) {
    lines.push(`Thoroughness: ${capitalised(chosen)} isn't ready yet, so work runs at Balanced.`);
    chosen = 'balanced';
  }
  // A pin that isn't a model name counts as missing; no pin at all means no pins.
  const given = config?.tiers?.pins;
  const pin = (name) => (isModelName(given?.[name]) ? given[name] : null);
  const pins = given !== null && typeof given === 'object' && !Array.isArray(given)
    ? { mostCapable: pin('mostCapable'), midSized: pin('midSized'), premium: pin('premium') }
    : undefined;
  if (pins === undefined && chosen !== 'balanced') {
    lines.push('Thoroughness: only Balanced until setup sets the models for each level.');
    chosen = 'balanced';
  }
  const flat = (role) => config?.routing?.[role] ?? null;
  const roles = {};
  let lightFallsBack = false;
  for (const role of ROLES) {
    const spec = COLUMNS[chosen][role];
    if (spec === undefined) continue;
    if (pins === undefined) {
      roles[role] = { model: flat(role), effort: spec.effort, fallback: null };
      continue;
    }
    const top = pins.mostCapable;
    const mid = pins.midSized;
    let model;
    if (spec.class === 'mostCapable') model = top ?? flat(role);
    else if (mid !== null) model = mid;
    else if (top !== null) {
      model = top;
      lightFallsBack = true;
    } else model = flat(role);
    const other = top !== null && mid !== null ? (spec.class === 'mostCapable' ? mid : top) : null;
    roles[role] = { model, effort: spec.effort, fallback: fallbackFor(role, model, other) };
  }
  if (lightFallsBack) lines.push("The lighter model isn't set, so its work runs on the most capable model.");

  const premiumWanted = chosen === 'thorough' && PREMIUM_MODES.includes(premium) && pins?.premium && readyList.includes('premium');
  if (premiumWanted) {
    if (premium === 'paid-too' || billing === 'within-plan') {
      for (const role of PREMIUM_ROLES) roles[role] = { model: pins.premium, effort: 'high', fallback: fallbackFor(role, pins.premium, pins.mostCapable) };
      lines.push(PREMIUM_IN_USE);
    } else lines.push('Premium model not used: it might have been paid from credits.');
  }
  return { level: chosen, roles, extra: EXTRA[chosen], lines };
}

// The level and the premium mode a settings view holds ({ <key>: { value } }), or the safe value when it isn't allowed.
export const levelOf = (settings) => (LEVELS.includes(settings?.efficiency?.value) ? settings.efficiency.value : 'balanced');
export const premiumOf = (settings) => (PREMIUM_MODES.includes(settings?.premium?.value) ? settings.premium.value : 'off');
