// tests/scripts/survey/words.test.js
// What the first briefing says about the survey (design section 15, rulings A2, A4 and A6): plain
// words, the host named as it is, nothing said of a part that is empty.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { briefingLines } from '../../../scripts/survey/words.js';

const item = (name) => ({ name, head: 'a'.repeat(40), commits: 1, subject: 'Work', at: '2026-10-24T09:00:00+11:00' });
const request = (number) => ({ number, title: `Change ${number}`, draft: false });
const survey = (parts = {}) => ({
  v: 1, hostReached: true, requests: [], pushed: [], local: [], instructions: { files: [], sections: [] }, scheduled: 0, secrets: 0, rules: [], ...parts,
});
const FILES = ['.claude/agents/checker.md', '.claude/agents/writer.md', '.claude/skills/helper-skill/SKILL.md', '.cursorrules', 'AGENTS.md'];

test('an empty survey says nothing, on any host', () => {
  for (const host of ['github', 'gitlab', null]) assert.deepEqual(briefingLines(survey(), { host }), []);
  // Scheduled jobs and secret files are never mentioned (ruling A5).
  assert.deepEqual(briefingLines(survey({ scheduled: 3, secrets: 2 }), { host: 'github' }), []);
});

test('the design\'s words, on GitHub', () => {
  assert.deepEqual(briefingLines(survey({
    requests: [request(1), request(2)], local: [item('a'), item('b'), item('c')], instructions: { files: FILES, sections: [] },
  }), { host: 'github' }), [
    'Already under way here: 2 changes waiting to be merged on GitHub, and 3 pieces of unfinished work on this computer. Say if you\'d like me to carry any of them on.',
    'This project also has instructions for another agent setup (AGENTS.md and 4 more files). Mine come first where they differ. I can move them into an archive folder, which you can undo at any time.',
  ]);
});

test('work pushed counts as unfinished work on the host, and one of each is singular', () => {
  assert.deepEqual(briefingLines(survey({ requests: [request(4)], pushed: [item('p')], local: [item('l')] }), { host: 'gitlab' }), [
    'Already under way here: 1 change waiting to be merged on GitLab, 1 piece of unfinished work on GitLab, and 1 piece of unfinished work on this computer. Say if you\'d like me to carry any of them on.',
  ]);
  assert.deepEqual(briefingLines(survey({ pushed: [item('p'), item('q')] }), { host: 'github' }), [
    'Already under way here: 2 pieces of unfinished work on GitHub. Say if you\'d like me to carry any of them on.',
  ]);
  assert.deepEqual(briefingLines(survey({ requests: [request(9)] }), { host: 'github' }), [
    'Already under way here: 1 change waiting to be merged on GitHub. Say if you\'d like me to carry it on.',
  ]);
});

test('a list cut short is said as at least what was found', () => {
  const many = Array.from({ length: 150 }, (_, i) => item(`l${i}`));
  assert.deepEqual(briefingLines(survey({ local: many, more: { pushed: true, local: true }, pushed: [item('p')] }), { host: 'github' }), [
    'Already under way here: at least 1 piece of unfinished work on GitHub, and at least 150 pieces of unfinished work on this computer. Say if you\'d like me to carry any of them on.',
  ]);
  assert.deepEqual(briefingLines(survey({ local: [item('l')], more: { pushed: true, local: false } }), { host: null }), [
    'Already under way here: at least 1 piece of unfinished work on this computer. Say if you\'d like me to carry any of them on.',
  ]);
  // Cut short with nothing found: nothing to say.
  assert.deepEqual(briefingLines(survey({ more: { pushed: true, local: true } }), { host: 'gitlab' }), []);
});

test('in git alone, everything is on this computer', () => {
  assert.deepEqual(briefingLines(survey({ pushed: [item('p')], local: [item('l'), item('m')] }), { host: null }), [
    'Already under way here: 3 pieces of unfinished work on this computer. Say if you\'d like me to carry any of them on.',
  ]);
  assert.deepEqual(briefingLines(survey({ local: [item('l')], hostReached: false }), { host: null }), [
    'Already under way here: 1 piece of unfinished work on this computer. Say if you\'d like me to carry it on.',
  ]);
});

test('instructions: one file, several, and parts of CLAUDE.md', () => {
  const lines = (instructions) => briefingLines(survey({ instructions }), { host: 'github' });
  assert.deepEqual(lines({ files: ['.windsurfrules'], sections: [] }), [
    'This project also has instructions for another agent setup (.windsurfrules). Mine come first where they differ. I can move it into an archive folder, which you can undo at any time.',
  ]);
  assert.deepEqual(lines({ files: ['.claude/agents/writer.md', '.cursorrules'], sections: [] }), [
    'This project also has instructions for another agent setup (.cursorrules and 1 more file). Mine come first where they differ. I can move them into an archive folder, which you can undo at any time.',
  ]);
  assert.deepEqual(lines({ files: ['AGENTS.md'], sections: [{ heading: 'Agents', line: 3 }] }), [
    'This project also has instructions for another agent setup (AGENTS.md and a part of CLAUDE.md). Mine come first where they differ. I can move AGENTS.md into an archive folder, which you can undo at any time.',
  ]);
  // A part of CLAUDE.md can't be archived on its own, so nothing is offered.
  assert.deepEqual(lines({ files: [], sections: [{ heading: 'Agents', line: 3 }, { heading: 'Delegation', line: 9 }] }), [
    'This project also has instructions for another agent setup (2 parts of CLAUDE.md). Mine come first where they differ.',
  ]);
});

test('a host that couldn\'t be reached is said once, after what was found', () => {
  assert.deepEqual(briefingLines(survey({ hostReached: false, local: [item('l')] }), { host: 'github' }), [
    'Already under way here: 1 piece of unfinished work on this computer. Say if you\'d like me to carry it on.',
    'I couldn\'t look at GitHub for changes waiting to be merged; I\'ll look again next time.',
  ]);
  assert.deepEqual(briefingLines(survey({ hostReached: false }), { host: 'gitlab' }), [
    'I couldn\'t look at GitLab for changes waiting to be merged; I\'ll look again next time.',
  ]);
});

test('no line holds the git words', () => {
  const full = survey({
    hostReached: false, requests: [request(1)], pushed: [item('p')], local: [item('l')], instructions: { files: FILES, sections: [{ heading: 'Agents', line: 1 }] },
  });
  for (const host of ['github', 'gitlab', null]) {
    for (const line of briefingLines(full, { host })) assert.doesNotMatch(line, /commit|branch|worktree/i);
  }
});
