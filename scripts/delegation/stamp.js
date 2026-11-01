// scripts/delegation/stamp.js
// What a seal's readings rest on: the model bindings, the pack, the rules and the exclusions. Evidence gathered under one
// stamp doesn't carry over to another (delegated decisions design, section 13.3). `rule` is null until a seal says which
// rules cover its card, as their hashes by id.

export function setupStamp({ bindings = null, packDigest = null, ruleHash = null, exclusionsHash = null } = {}) {
  return { models: bindings, pack: packDigest, rule: ruleHash, exclusions: exclusionsHash };
}
