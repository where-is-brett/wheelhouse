// probes/haiku-trial/models.js
// The model a trial runs on. The kit was built for Haiku; a Sonnet run on the same kit tells kit faults from model faults.
export const MODELS = ['haiku', 'sonnet'];
export const DEFAULT_MODEL = 'haiku';

// The model for a `--model` value: the default when none was given, an error when it names something else.
export function parseModel(value) {
  if (value === undefined) return DEFAULT_MODEL;
  const model = String(value).trim().toLowerCase();
  if (!MODELS.includes(model)) throw new Error(`--model must be ${MODELS.join(' or ')}, not "${value}"`);
  return model;
}

export const modelPattern = (model = DEFAULT_MODEL) => new RegExp(parseModel(model), 'i');
