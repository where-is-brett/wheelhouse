// scripts/delegation/composer.js
// A rule composed from an answered card (delegated decisions design, section 11.1). A script sets the scope, narrowly,
// from what it can see: this project, the paths the piece changed, its lane and every common exclusion. The step's topic
// plays no part, and nor does anything else it wrote about the question. Typed words are the director's, so the rule
// carries them. A clicked label is the step's, so the rule holds it only as a literal match, which can't widen. A
// composed rule is a proposal: only the director's signed click puts it in force, and it starts at stage 0.
import { COMMON_EXCLUSIONS, exclusionsClear } from './candidates.js';
import { wholeRule } from './rules.js';
import { LANES } from '../lib/build-loop.js';
import { PUT_OFF } from '../lib/front-desk.js';

const BREAK = /[\r\n\v\f\u0085\u2028\u2029]/;
const isText = (x) => typeof x === 'string' && x.trim() !== '';
const labelOf = (option) => (typeof option === 'string' ? option : option?.label);

// What an answer means, or null where it answers nothing a rule could hold.
function meaningOf(answer, card) {
  if (isText(answer?.words)) {
    if (BREAK.test(answer.words)) return null;
    const words = answer.words.trim();
    return { words, literal: null, answer: { set: null, principle: words } };
  }
  if (!isText(answer?.label) || !Array.isArray(card.options)) return null;
  const options = card.options.map(labelOf).filter((label) => !PUT_OFF.includes(label));
  if (!options.includes(answer.label)) return null;
  return { words: null, literal: { options: [...options].sort(), take: answer.label }, answer: { set: answer.label, principle: null } };
}

// composeRule({ answer, card, facts, lane, project, workLevel, now }): `answer` a { label } clicked or { words } typed,
// `card` as a seal has it with its options, `facts` the change's (facts.js), `workLevel` the level of the card's work,
// which a question's own level can't speak for. Null for level 4, for anything but a level-3 question, and for a change
// with no scope to read, or one whose exclusions are hit or can't be read.
export function composeRule({ answer, card, facts, lane, project, workLevel, now = () => new Date() }) {
  if (card?.kind !== 'question' || card.level !== 3 || workLevel === 4) return null;
  if (facts?.readable !== true || !Array.isArray(facts.paths) || facts.paths.length === 0 || !exclusionsClear(facts)) return null;
  if (!LANES.includes(lane) || !isText(project)) return null;
  const meaning = meaningOf(answer, card);
  if (meaning === null) return null;
  return wholeRule({
    ...meaning,
    conditions: ['inside-paths', 'same-lane', ...(meaning.literal ? ['same-options'] : [])],
    exclusions: COMMON_EXCLUSIONS.map((e) => e.id),
    project,
    paths: [...new Set(facts.paths)].sort(),
    lanes: [lane],
  }, now());
}
