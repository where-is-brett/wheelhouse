// scripts/delegation/candidates.js
// The eight first classes as unsigned candidates, and the exclusions no rule can lift (delegated decisions design,
// section 9, guardrail 1, and section 11.2). Each answer is true, false or null, and null means it can't be said: a
// fact that can't be read is never a false, since a false would read as clear. Nothing here decides anything yet: the
// seal only records what would have applied.
import { dataHash } from '../state/events.js';
import { SMALL_FIX_LINES } from './limits.js';

// A change's fact, or null when the change can't be read.
const fact = (facts, key) => (facts?.readable === true && typeof facts[key] === 'boolean' ? facts[key] : null);
const said = (value) => (typeof value === 'boolean' ? value : null);
const not = (value) => (value === null ? null : !value);
// False if any is false, else null if any can't be said, else true.
const all = (...values) => (values.includes(false) ? false : values.includes(null) ? null : true);
const named = (value) => (typeof value === 'string' && value !== '' ? true : null);

function insidePiece(facts, ctx) {
  if (facts?.readable !== true || !Array.isArray(ctx.pieceFiles)) return null;
  return facts.paths.every((file) => ctx.pieceFiles.includes(file));
}

function mergedOrTest(ctx) {
  const answers = [said(ctx.merged), said(ctx.madeForTest)];
  if (answers.includes(true)) return true;
  return answers.includes(null) ? null : false;
}

export const CANDIDATES = Object.freeze([
  {
    id: 'land', undo: 'allowed', words: 'Land finished, reviewed, green work',
    applies: (facts, ctx = {}) => all(not(fact(facts, 'guardrail')), said(ctx.permitHolds), ctx.openDecision !== true),
  },
  {
    id: 'push-draft', undo: 'allowed', words: 'Push a branch or open a draft on the project\'s own private host',
    applies: (facts, ctx = {}) => said(ctx.hostPrivate),
  },
  {
    id: 'remove-branches', undo: 'allowed', words: 'Remove merged branches and test leftovers',
    applies: (facts, ctx = {}) => mergedOrTest(ctx),
  },
  {
    id: 'defect-in-work', undo: 'switch-or-held', words: 'Fix a defect found in the same work',
    applies: (facts, ctx = {}) => all(insidePiece(facts, ctx), facts?.readable === true ? facts.lines <= SMALL_FIX_LINES : null, said(ctx.failedFirst)),
  },
  {
    id: 'run-plan', undo: 'allowed', words: 'How to run a plan: agents per task, order',
    applies: (facts, ctx = {}) => said(ctx.withinSpend),
  },
  {
    id: 'tested-choice', undo: 'switch-or-held', words: 'A technical choice tests can prove, on the principle of the proper long-term option',
    applies: (facts, ctx = {}) => all(named(ctx.doneCheck), not(fact(facts, 'schemaChanged'))),
  },
  {
    id: 'follow-mock-up', undo: 'switch-or-held', words: 'Spec and mock-up disagree: follow the mock-up, fall back safely, note it',
    applies: (facts, ctx = {}) => said(ctx.mockUp),
  },
  {
    id: 'written-rule', undo: 'switch-or-held', words: 'A written rule already answers it',
    applies: (facts, ctx = {}) => said(ctx.quoted),
  },
]);

// No check can show these are absent, so a seal can only say so.
const cannotRead = () => null;

export const COMMON_EXCLUSIONS = Object.freeze([
  { id: 'guardrail', words: 'The guardrails', hit: (facts) => fact(facts, 'guardrail') },
  { id: 'secrets', words: 'Secrets', hit: (facts) => fact(facts, 'secrets') },
  { id: 'critical-area', words: 'The project\'s critical areas', hit: (facts) => fact(facts, 'critical') },
  { id: 'data-model', words: 'A data model change', hit: (facts) => fact(facts, 'schemaChanged') },
  { id: 'dependency', words: 'A changed dependency list', hit: (facts) => fact(facts, 'depsChanged') },
  { id: 'legal', words: 'Legal and compliance', hit: cannotRead },
  { id: 'privacy', words: 'Privacy', hit: cannotRead },
  { id: 'outside-contact', words: 'Contacting anyone outside', hit: cannotRead },
  { id: 'claim-meaning', words: 'The meaning of a claim to users', hit: cannotRead },
  { id: 'paid-service', words: 'A new paid service', hit: cannotRead },
  { id: 'access', words: 'Access, or where records live', hit: cannotRead },
]);

export const exclusionsHit = (facts) => COMMON_EXCLUSIONS.filter((e) => e.hit(facts) === true).map((e) => e.id);

// Names the list, so evidence gathered under one list doesn't carry over to another.
export const exclusionsHash = () => dataHash(COMMON_EXCLUSIONS.map(({ id, words }) => ({ id, words })));
