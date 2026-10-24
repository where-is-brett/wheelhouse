// tests/scripts/eval/override.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const text = fs.readFileSync(fileURLToPath(new URL('../../../templates/brief/override.md', import.meta.url)), 'utf8');

// Superpowers 7.0.0's own sentences, as the override must quote them (design section 7).
const anchors = [
  'Five rounds maximum per task:',
  'Critical/Important → ONE fix pass',
  '**Rulings, not stalls.**',
  'link it for your human partner',
  '1. Merge back to <base-branch> locally',
  '| A quick, clear task | the request itself | do it |',
  'invoke superpowers:writing-plans and no other skill',
  'Use the least powerful model that can handle each role to conserve cost and increase speed.',
  'Subagent (general-purpose):',
  'Dispatch a `general-purpose` subagent',
];

test('the override starts with its path, then says its rules win over any skill\'s', () => {
  const lines = text.split('\n');
  assert.equal(lines[0], '<!-- templates/brief/override.md -->');
  assert.match(text, /These rules win over any skill's/);
});

test('the override has seven numbered rules, each with a quoted line naming what it overrides', () => {
  const rules = [...text.matchAll(/^\*\*(\d)\. /gm)].map((match) => Number(match[1]));
  assert.deepEqual(rules, [1, 2, 3, 4, 5, 6, 7]);
  const sections = text.split(/^(?=\*\*\d\. )/m).slice(1);
  assert.equal(sections.length, 7);
  for (const section of sections) assert.match(section, /^> Overrides /m);
});

test('each Superpowers sentence is quoted word for word', () => {
  for (const anchor of anchors) assert.ok(text.includes(`"${anchor}"`), `missing: ${anchor}`);
});

test('rule 1 counts only BLOCKER and HIGH findings as open, as Superpowers counts Critical and Important (scenario 21)', () => {
  const rule = text.split(/^(?=\*\*\d\. )/m)[1];
  assert.match(rule, /A finding is open when Wheelhouse's reviewer rates it BLOCKER or HIGH, as Superpowers' Critical and Important are; MEDIUM and LOW are minors: record them in the ledger as deferred, and they never extend the loop or go to the director\./);
});
