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

// The code a stub throws for a part that is not built yet.
export const NOT_BUILT_YET = 'NOT_BUILT_YET';
// What marks a stub made by pendingPart, so checkAdapter can tell one from a part that was built.
const PENDING = Symbol('pending part');

// A part that is not built yet: an object whose `members` are functions, each throwing an Error with
// the code NOT_BUILT_YET that names the part. An adapter holding one lists the part in its `pending`.
export function pendingPart(part, members) {
  if (!ADAPTER_PARTS.includes(part)) throw new Error(`${JSON.stringify(part)} is not a part of an adapter`);
  if (!Array.isArray(members) || members.length === 0 || !members.every((m) => typeof m === 'string' && m !== '')) {
    throw new Error(`The ${part} part's members must be a list of names`);
  }
  const stub = { [PENDING]: part };
  for (const member of members) {
    stub[member] = () => {
      throw Object.assign(new Error(`The ${part} part (${member}) is not built yet`), { code: NOT_BUILT_YET, part });
    };
  }
  return Object.freeze(stub);
}

// Whether `value` is a stub made by pendingPart.
export const isPendingPart = (value) => value !== null && typeof value === 'object' && Object.hasOwn(value, PENDING);

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
// adapter with none returns an empty list. A part built by pendingPart is accepted only when the
// adapter's `pending` list names it, and `pending` may name nothing but parts.
export function checkAdapter(adapter) {
  if (kindOf(adapter) !== 'object') return ['The adapter is not an object, so it has none of its parts'];
  const problems = [];
  let pending = [];
  if (adapter.pending !== undefined) {
    if (fits(adapter.pending, 'array')) pending = adapter.pending;
    else problems.push(`The adapter's pending list must be an array of part names, and it is ${kindOf(adapter.pending)}`);
  }
  for (const name of pending) if (!ADAPTER_PARTS.includes(name)) problems.push(`The adapter lists ${JSON.stringify(name)} as pending, and that is not a part`);
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
    if (isPendingPart(value) && !pending.includes(part)) problems.push(`The ${part} part is not built yet, and the adapter does not list it as pending`);
    if (shape.members === undefined) continue;
    for (const [member, type] of Object.entries(shape.members)) {
      if (value[member] === undefined) problems.push(`The ${part} part has no ${member}`);
      else if (!fits(value[member], type)) problems.push(`The ${part} part's ${member} must be ${article(type)} ${type}, and it is ${kindOf(value[member])}`);
    }
  }
  return problems;
}
