// scripts/delegation/rules.js
// The `rule` record (delegated decisions design, sections 9 and 11): what the director signs in advance. A rule starts at
// stage 0, where it decides nothing and only earns evidence. Its hash covers what it means, not its stage or review, so
// a rule signed again keeps the evidence it earned, and a changed word starts afresh. Only a signed confirmation of the
// whole record puts one in force (views.rules), and rules live in the private record, since an agent can edit the
// repository. The eight candidates read as rules here too, so a candidate's evidence carries over when it is signed
// with the same hash.
import { dataHash } from '../state/events.js';
import { CANDIDATES, COMMON_EXCLUSIONS } from './candidates.js';
import { RULE_REVIEW_MONTHS } from './limits.js';
import { sameOptions } from './words.js';

const isPlain = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
// A candidate's one condition: that the seal's own reading of it said it applied.
const CANDIDATE = 'candidate:';

export const ruleHash = ({ words, literal, conditions, exclusions, answer, project, paths, lanes }) => dataHash({ words, literal, conditions, exclusions, answer, project, paths, lanes });

// The review date: RULE_REVIEW_MONTHS on, or the last day of a month too short to hold the same day.
export function reviewFrom(at) {
  const out = new Date(at);
  out.setUTCDate(1);
  out.setUTCMonth(out.getUTCMonth() + RULE_REVIEW_MONTHS);
  const last = new Date(Date.UTC(out.getUTCFullYear(), out.getUTCMonth() + 1, 0)).getUTCDate();
  out.setUTCDate(Math.min(at.getUTCDate(), last));
  return out.toISOString();
}

// A rule from what it means. Its id comes from its hash, so the same rule composed again is the same rule.
export function wholeRule(meaning, at) {
  const hash = ruleHash(meaning);
  return { id: `rule-${hash.slice(0, 12)}`, ...meaning, stage: 0, review: reviewFrom(at), hash };
}

// Whether a record is a whole rule whose hash and id are its own, at the stage every rule starts at. Nothing moves a rule
// up yet, so a higher stage on a record is no rule.
export function ruleStands(rule) {
  if (!isPlain(rule) || rule.stage !== 0) return false;
  if (![rule.conditions, rule.exclusions, rule.paths, rule.lanes].every(Array.isArray)) return false;
  try {
    const hash = ruleHash(rule);
    return rule.hash === hash && rule.id === `rule-${hash.slice(0, 12)}`;
  } catch {
    return false;
  }
}

// A rule's stage now. Past its review it falls to stage 1, or stays where it is if lower, until signed again. A review
// date that can't be read counts as past, and nothing here raises a stage.
export function stageOf(rule, { now = () => new Date() } = {}) {
  const stage = Number.isInteger(rule?.stage) && rule.stage > 0 ? rule.stage : 0;
  return now().getTime() < Date.parse(rule?.review) ? stage : Math.min(stage, 1);
}

// A candidate as the rule it would be if signed: its own words, every common exclusion, and no paths of its own.
export function candidateRule(candidate, { project, now = () => new Date() }) {
  return wholeRule({
    words: candidate.words, literal: null, conditions: [`${CANDIDATE}${candidate.id}`], exclusions: COMMON_EXCLUSIONS.map((e) => e.id),
    answer: { set: null, principle: null }, project, paths: [], lanes: [],
  }, now());
}

// What a card's seal may earn evidence for: the candidates, and this project's rules in force (`rules`, as views.rules).
export function ruleSet(project, rules) {
  const signed = Object.values(isPlain(rules) ? rules : {}).map((entry) => entry.rule).filter((rule) => rule.project === project);
  return [...CANDIDATES.map((candidate) => candidateRule(candidate, { project })), ...signed];
}

// Whether a rule's scope covers a card, for its evidence and nothing else: this decides nothing. `candidates` is what the
// seal said of each, and `ctx` gives the card's lane and options. A change that can't be read is covered by no rule.
export function ruleCovers(rule, { facts, ctx = {}, candidates = {} }) {
  const candidate = rule.conditions.find((c) => c.startsWith(CANDIDATE));
  if (candidate) return candidates[candidate.slice(CANDIDATE.length)] === true;
  if (facts?.readable !== true || !Array.isArray(facts.paths) || facts.paths.length === 0 || !rule.lanes.includes(ctx.lane)) return false;
  if (!facts.paths.every((file) => rule.paths.includes(file))) return false;
  return rule.literal === null || (Array.isArray(ctx.options) && sameOptions(ctx.options, rule.literal.options));
}

// The seals that are evidence for a rule: those stamped with its hash, whether it was a candidate or signed then.
export const sealsFor = (rule, seals) => seals.filter((seal) => Object.values(seal.stamp?.rule ?? {}).includes(rule.hash));
