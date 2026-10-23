// tests/scripts/survey/words.test.js
// What the first briefing says about the survey (design section 15, rulings A2, A4 and A6): plain
// words, the host named as it is, nothing said of a part that is empty.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { briefingLines, carryOnCard, trustingLine } from '../../../scripts/survey/words.js';
import { composeCard } from '../../../scripts/cards/compose.js';

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

test('lines can be left out by name, so a caller says one of them itself', () => {
  const found = survey({ requests: [request(1)], instructions: { files: ['AGENTS.md'], sections: [] } });
  assert.equal(briefingLines(found, { host: 'github', leave: ['inFlight'] }).length, 1);
  assert.match(briefingLines(found, { host: 'github', leave: ['inFlight'] })[0], /^This project also has instructions/);
  assert.match(briefingLines(found, { host: 'github', leave: ['instructions'] })[0], /^Already under way here/);
  assert.deepEqual(briefingLines(found, { host: 'github', leave: ['inFlight', 'instructions'] }), []);
  assert.deepEqual(briefingLines(survey({ hostReached: false }), { host: 'github', leave: ['missed'] }), []);
});

test('a survey taken again after an earlier one was said names only what is new since it', () => {
  const earlier = survey({ hostReached: false, local: [item('a'), item('b')], instructions: { files: ['AGENTS.md'], sections: [] } });
  const again = survey({ requests: [request(7)], pushed: [item('b')], local: [item('a'), item('c')], instructions: { files: ['AGENTS.md'], sections: [] } });
  // Pieces are known by name wherever they are now; requests by number; the same instructions aren't said again.
  assert.deepEqual(briefingLines(again, { host: 'github', since: earlier }), [
    'Already under way here: 1 change waiting to be merged on GitHub, and 1 piece of unfinished work on this computer. Say if you\'d like me to carry any of them on.',
  ]);
  assert.deepEqual(briefingLines(again, { host: 'github', since: earlier, carrying: true }), [
    'Already under way here: 1 change waiting to be merged on GitHub, and 1 piece of unfinished work on this computer. I\'m carrying them on, one brief each; say stop if you\'d rather I didn\'t.',
  ]);
  // Nothing new, nothing said; other instructions than before are said.
  assert.deepEqual(briefingLines(survey({ local: [item('a')] }), { host: 'github', since: earlier }), []);
  assert.match(briefingLines(survey({ instructions: { files: ['AGENTS.md', '.cursorrules'], sections: [] } }), { host: 'github', since: earlier })[0], /^This project also has instructions/);
});

// ---- The card at setup's end, and the line at Trusting (ruling A9) ----

test('the carry-on card holds the design\'s words, with the project\'s name and the host filled in', () => {
  const found = survey({ requests: [request(1), request(2)], local: [item('a'), item('b'), item('c')] });
  const input = carryOnCard(found, { project: 'tide-tables', host: 'github' });
  assert.equal(input.kind, 'question');
  assert.equal(input.level, 3);
  assert.equal(input.topic, 'under-way');
  const { question, card } = composeCard(input);
  assert.deepEqual(question.question.split('\n'), [
    'Wheelhouse found work already under way in tide-tables: 2 changes waiting to be merged on GitHub, and 3 pieces of unfinished work on this computer. Shall I carry them on?',
    'Each piece would go through the usual intake: a short brief of its own, built on from where it stands, and checked by the reviewer before anything is merged. The original work is never changed.',
    'Nothing is touched while you decide.',
    'To know more, just ask.',
  ]);
  assert.deepEqual(question.options, [
    { label: 'Carry on with it', description: 'Recommended: Each piece gets its own brief and joins the queue, and you see each brief as usual, because the original work stays as it is and nothing is merged without a review.' },
    { label: 'Leave it for now', description: 'It stays exactly as it is. I\'ll offer it once more in a briefing a week from now, or whenever you ask.' },
  ]);
  assert.equal(card.line, null, 'a product question: its click is a plain card-answer');
  assert.equal(card.topic, 'under-way');
});

test('the carry-on card counts as the briefing does: one is "it", a list cut short is "at least", GitLab named as it is', () => {
  const one = composeCard(carryOnCard(survey({ requests: [request(9)] }), { project: 'shop', host: 'gitlab' })).question.question.split('\n')[0];
  assert.equal(one, 'Wheelhouse found work already under way in shop: 1 change waiting to be merged on GitLab. Shall I carry it on?');
  const cut = carryOnCard(survey({ local: Array.from({ length: 200 }, (_, i) => item(`w${i}`)), more: { pushed: false, local: true } }), { project: 'shop', host: 'github' });
  assert.match(cut.what, /in shop: at least 200 pieces of unfinished work on this computer\. Shall I carry them on\?$/);
  const alone = carryOnCard(survey({ pushed: [item('p')], local: [item('l')] }), { project: 'shop', host: null });
  assert.match(alone.what, /in shop: 2 pieces of unfinished work on this computer\. Shall I carry them on\?$/);
});

test('no work in flight, no card and no Trusting line', () => {
  const quiet = survey({ instructions: { files: FILES, sections: [] }, scheduled: 2, secrets: 1 });
  for (const host of ['github', 'gitlab', null]) {
    assert.equal(carryOnCard(quiet, { project: 'shop', host }), null);
    assert.equal(trustingLine(quiet, { host }), null);
  }
  // In git alone, a request can't be found, so it is no work in flight.
  assert.equal(carryOnCard(survey({ requests: [request(1)] }), { project: 'shop', host: null }), null);
});

test('at Trusting, the line says Wheelhouse is carrying the work on, in place of the offer', () => {
  const found = survey({ requests: [request(1), request(2)], local: [item('a'), item('b'), item('c')] });
  assert.equal(trustingLine(found, { host: 'github' }),
    'Already under way here: 2 changes waiting to be merged on GitHub, and 3 pieces of unfinished work on this computer. I\'m carrying them on, one brief each; say stop if you\'d rather I didn\'t.');
  assert.equal(trustingLine(survey({ local: [item('a')] }), { host: 'github' }),
    'Already under way here: 1 piece of unfinished work on this computer. I\'m carrying it on; say stop if you\'d rather I didn\'t.');
  assert.deepEqual(briefingLines(found, { host: 'github', carrying: true }), [trustingLine(found, { host: 'github' })]);
});

test('neither the card nor the Trusting line holds the git words', () => {
  const found = survey({ requests: [request(1)], pushed: [item('p')], local: [item('l')] });
  const { question } = composeCard(carryOnCard(found, { project: 'shop', host: 'github' }));
  const text = [question.question, ...question.options.map((o) => o.description), trustingLine(found, { host: 'github' })].join('\n');
  assert.doesNotMatch(text, /commit|branch|worktree/i);
});
