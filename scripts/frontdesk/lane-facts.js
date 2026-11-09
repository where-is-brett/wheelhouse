// scripts/frontdesk/lane-facts.js
// The facts a brief states about its work, read from a fenced block, so the lane follows from
// what the brief says rather than from a model's guess at the size of the work.

export const FACTS_FENCE = 'wheelhouse-facts';
export const FACTS = Object.freeze({
  addsPage: 'it adds a page',
  storesData: 'it stores data',
  parsesInput: 'it parses input',
  touchesMoreThanOneArea: 'it touches more than one area',
});
const EXAMPLE = '{"addsPage": false, "storesData": false, "parsesInput": false, "touchesMoreThanOneArea": false}';
export const MISSING = `This brief has no facts block. End it with this, each answer true or false, then record it again:\n\`\`\`${FACTS_FENCE}\n${EXAMPLE}\n\`\`\``;

const FENCE = new RegExp(`^\`\`\`${FACTS_FENCE}[ \\t]*\\r?\\n([\\s\\S]*?)\\r?\\n\`\`\`[ \\t]*$`, 'm');
const NEEDS = `The brief's \`${FACTS_FENCE}\` block needs addsPage, storesData, parsesInput and touchesMoreThanOneArea, each true or false`;
const SMALL_LANES = new Set(['small', 'quick']);

export function readFacts(text) {
  const found = FENCE.exec(String(text ?? ''));
  if (!found) return null;
  let value;
  try { value = JSON.parse(found[1]); } catch { return { problem: `${NEEDS}: it isn't JSON` }; }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return { problem: NEEDS };
  const facts = {};
  for (const key of Object.keys(FACTS)) {
    if (typeof value[key] !== 'boolean') return { problem: NEEDS };
    facts[key] = value[key];
  }
  return { facts };
}

const joined = (words) => (words.length < 2 ? words.join('') : `${words.slice(0, -1).join(', ')} and ${words[words.length - 1]}`);

export function laneFactsProblem(text, lane) {
  if (!SMALL_LANES.has(lane)) return null;
  const read = readFacts(text);
  if (read === null) return MISSING;
  if (read.problem) return read.problem;
  const yes = Object.keys(FACTS).filter((key) => read.facts[key]).map((key) => FACTS[key]);
  if (yes.length === 0) return null;
  return `this is a feature: ${joined(yes)}. Write a design that ends with its slices and record it in the feature lane`;
}
