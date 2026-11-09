// tests/skills/intake.test.js
// The intake's playbook, pinned: the confirming message names the piece's watch level, and the phrases that change it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { readFacts } from '../../scripts/frontdesk/lane-facts.js';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const intake = fs.readFileSync(path.join(ROOT, 'skills/intake/SKILL.md'), 'utf8').replaceAll('\r\n', '\n');
const deskText = fs.readFileSync(path.join(ROOT, 'skills/front-desk/SKILL.md'), 'utf8').replaceAll('\r\n', '\n');

test('intake: the confirming message names the watch level', () => {
  assert.ok(intake.includes('Watch: steps. Say "background", "full transcript" or "I\'ll steer it" to change.'));
});

test('intake: the watch phrases record a watch event at the level they name', () => {
  for (const text of [intake, deskText]) {
    assert.match(text, /"background" or "don't show me this one"[^\n]*`off`/i);
    assert.match(text, /"steps" or "keep me posted"[^\n]*`steps`/i);
    assert.match(text, /"full transcript" or "show me everything"[^\n]*`transcript`/i);
    assert.match(text, /"I'll steer it" or "let me drive this one"[^\n]*`transcript`[^\n]*`helm steer <work id>`/i);
    assert.match(text, /record watch/);
  }
});

test('intake: route 3 sends a change to its own file through `record amendment` with `doc`, and route 9 says record work refuses a design with no slices', () => {
  const rule = intake.split('\n').find((line) => line.includes('**A change to what an approved brief or design builds')) ?? '';
  assert.match(rule, /`cli\.js record amendment`/);
  assert.match(rule, /and `doc`: that file/);
  assert.ok(rule.includes('If the director drops a change, `record work` again with the same document; that lets the work go.'));
  assert.doesNotMatch(intake, /edit the approved document in place|replace its approval line|replace its approval/i);
  assert.match(intake, /`record work` refuses a feature design that has no such block\./);
});

test('intake: the lane of a change follows its wheelhouse-facts block, not brainstorming\'s size', () => {
  assert.match(intake, /wheelhouse-facts/);
  assert.match(intake, /addsPage, storesData, parsesInput and touchesMoreThanOneArea/);
  assert.match(intake, /any `true` is a feature/);
  assert.doesNotMatch(intake, /Its size sets the lane/);
});

test('intake: a chore brief ends with the all-false facts block', () => {
  assert.match(intake, /goes to the quick lane, as in route 9, its brief ending with the `wheelhouse-facts` block, all false\./);
});

test('intake: a follow-up to finished work gets a brief ending with the facts block', () => {
  assert.match(intake, /is new work: `cli\.js record work` with a new id[^\n]*its brief ending with the `wheelhouse-facts` block as in route 9/);
});

test('intake: route 9\'s example facts block reads as all false', () => {
  const found = /^```wheelhouse-facts\n([\s\S]*?)\n```$/m.exec(intake);
  assert.ok(found, 'route 9 holds a wheelhouse-facts example');
  const read = readFacts(found[0]);
  assert.equal(read.problem, undefined);
  assert.deepEqual(read.facts, { addsPage: false, storesData: false, parsesInput: false, touchesMoreThanOneArea: false });
});
