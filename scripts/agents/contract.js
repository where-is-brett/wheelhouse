// scripts/agents/contract.js
// What a coding agent's adapter must hold, so the core can run the agent without knowing which it is.
// The ten parts are the design's section 8.1 list, with `tools` split out of translation because the
// guards read the tool lists directly.

// Each part's name and the type it must have. 'object' is a plain object; 'array' an array of strings.
const SHAPES = Object.freeze({
  identity: { type: 'object', members: { name: 'string', label: 'string', floor: 'string', find: 'function' } },
  hooks: { type: 'object', members: { registration: 'function', file: 'function' } },
  translate: { type: 'object', members: { toGuardInput: 'function', fromGuardAnswer: 'function' } },
  tools: { type: 'object', members: { read: 'array', halt: 'array', notify: 'array', ask: 'string', shell: 'array' } },
  settings: { type: 'object', members: { project: 'function', local: 'function' } },
  sessions: { type: 'object', members: { checkFeature: 'function', foremanCall: 'function', featureStartCall: 'function', featureResumeCall: 'function', finalAnswer: 'function' } },
  cards: { type: 'object', members: { binding: 'array' } },
  packaging: { type: 'object', members: { files: 'function' } },
  toolSheet: { type: 'string' },
  safetyLine: { type: 'function' },
  evalRunner: { type: 'object', members: { run: 'function' } },
});

export const ADAPTER_PARTS = Object.freeze(Object.keys(SHAPES));

function kindOf(value) {
  if (Array.isArray(value)) return 'array';
  if (value === null) return 'nothing';
  return typeof value;
}

function fits(value, type) {
  if (type === 'array') return Array.isArray(value) && value.every((item) => typeof item === 'string');
  if (type === 'object') return kindOf(value) === 'object';
  return typeof value === type;
}

const article = (type) => (type === 'object' || type === 'array' ? 'an' : 'a');

// The problems with `adapter`, each a plain sentence naming the missing or wrongly typed part. An
// adapter with none returns an empty list.
export function checkAdapter(adapter) {
  if (kindOf(adapter) !== 'object') return ['The adapter is not an object, so it has none of its parts'];
  const problems = [];
  for (const part of ADAPTER_PARTS) {
    const shape = SHAPES[part];
    const value = adapter[part];
    if (value === undefined) {
      problems.push(`The adapter has no ${part} part`);
      continue;
    }
    if (!fits(value, shape.type)) {
      problems.push(`The ${part} part must be ${article(shape.type)} ${shape.type}, and it is ${kindOf(value)}`);
      continue;
    }
    if (shape.members === undefined) continue;
    for (const [member, type] of Object.entries(shape.members)) {
      if (value[member] === undefined) problems.push(`The ${part} part has no ${member}`);
      else if (!fits(value[member], type)) problems.push(`The ${part} part's ${member} must be ${article(type)} ${type}, and it is ${kindOf(value[member])}`);
    }
  }
  return problems;
}
