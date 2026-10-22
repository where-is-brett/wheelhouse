// tests/scripts/setup/rules.test.js
// Step 5, Rules found (design sections 9 and 15; ruling R35): the rules in the project's CLAUDE.md,
// README and docs, each with where it was found, matched back to the director's own words in their
// past sessions in this folder, shown on one card with Confirm all and Let me correct some. The
// click records each rule and its confirmation through the prompt record; the step then settles.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  findRules, matchWords, readTranscripts, rulesOf, cardsOf, rulesStep, RULE_LABELS, TRANSCRIPT_FILE_BYTES,
} from '../../../scripts/setup/rules.js';
import { answersFor } from '../../../scripts/setup/clicks.js';
import { findRun, readJournal } from '../../../scripts/setup/journal.js';
import { planHash } from '../../../scripts/setup/steps.js';
import { confirmAllLine, setLineOf, CONFIRM_ALL_LABEL, CORRECT_SOME_LABEL } from '../../../scripts/state/card-lines.js';
import { cardProblems } from '../../../scripts/hooks/card-check.js';
import { buildViews } from '../../../scripts/state/views.js';
import { readEnrolled, verify } from '../../../scripts/state/signing.js';
import { eventHash } from '../../../scripts/state/events.js';
import { withProject, lay, transcript, typed, T0 } from '../../helpers/setup-answers.js';
import { tempFolder } from '../../helpers/homes.js';

const KEY = `ghp_${'c'.repeat(36)}`;
const FILES = {
  'CLAUDE.md': [
    '<!-- CLAUDE.md -->',
    '# How we work',
    '',
    '- **Never** push straight to main.',
    '- Use British English in everything the director reads.',
    'This project is a menu app.',
    '```sh',
    '# never run this by hand',
    'npm test',
    '```',
    '1. Always run the tests before a pull request. Keep commits small.',
    `- Never paste the deploy token ${KEY} anywhere.`,
  ].join('\n'),
  'README.md': '# Café Menu\n\nCafé Menu puts a café\'s menu online.\n\n| Never | a table |\n\nPrices must show the currency.\n',
  'docs/style.md': '---\ntitle: never in front matter\n---\nWrite dates as 20 October 2026.\n> Don\'t use emoji in the menu.\n',
  'docs/deep/notes.md': 'Always run the tests before a pull request.\n',
  'src/app.md': 'Never read outside docs.\n',
};

test('rules are found with their file and line', () => {
  const folder = tempFolder('wh-rules zoë ');
  lay(folder, FILES);
  assert.deepEqual(findRules(folder), [
    { words: 'Never push straight to main.', source: { file: 'CLAUDE.md', line: 4 } },
    { words: 'Use British English in everything the director reads.', source: { file: 'CLAUDE.md', line: 5 } },
    { words: 'Always run the tests before a pull request.', source: { file: 'CLAUDE.md', line: 11 } },
    { words: 'Keep commits small.', source: { file: 'CLAUDE.md', line: 11 } },
    { words: 'Prices must show the currency.', source: { file: 'README.md', line: 7 } },
    { words: 'Write dates as 20 October 2026.', source: { file: 'docs/style.md', line: 4 } },
    { words: 'Don\'t use emoji in the menu.', source: { file: 'docs/style.md', line: 5 } },
  ]);
  // Nothing in a code block, a heading, a table, front matter or outside the three places; a rule
  // found again in the same words is listed once; and one holding a key is not kept at all.
  assert.ok(!JSON.stringify(findRules(folder)).includes(KEY));
  // A project with none of the three has none.
  assert.deepEqual(findRules(tempFolder('wh-empty-')), []);
});

test('a rule matched in a past transcript keeps the director\'s words; others are marked paraphrase', async () => {
  await withProject(async ({ folder, user, config }) => {
    const elsewhere = path.join(user, 'Projects', 'Other');
    // A session in this folder, filed under a name that isn't the folder's; one in a subfolder; one
    // in another folder whose words would match; a tool's result, Claude Code's own messages, a
    // subagent's prompt and lines that aren't entries.
    transcript(config, 'not-the-folder-name', 'a', [
      typed(folder, 'Please, never push straight to MAIN — ever.\nAnd keep commits small, thanks!'),
      { type: 'user', cwd: folder, message: { role: 'user', content: [{ type: 'tool_result', content: 'Use British English in everything the director reads' }] } },
      { type: 'user', cwd: folder, isMeta: true, message: { role: 'user', content: 'use british english in everything the director reads' } },
      { type: 'user', cwd: folder, isSidechain: true, message: { role: 'user', content: 'Use British English in everything the director reads, please' } },
      typed(folder, '<command-name>/clear</command-name> use british english in everything the director reads'),
      'not json',
      { type: 'assistant', cwd: folder, message: { role: 'assistant', content: 'Prices must show the currency, I will.' } },
    ]);
    transcript(config, 'sub', 'b', [typed(path.join(folder, 'src'), 'Write the dates as 20 October 2026 please.')]);
    transcript(config, folder.replace(/[^A-Za-z0-9]/g, '-'), 'c', [typed(elsewhere, 'Prices must always show the currency symbol.')]);
    const said = readTranscripts(folder, { userHome: user });
    assert.deepEqual(said.sort(), ['Please, never push straight to MAIN — ever.\nAnd keep commits small, thanks!', 'Write the dates as 20 October 2026 please.'].sort());
    assert.deepEqual(matchWords({ words: 'Never push straight to main.' }, said), { words: 'Please, never push straight to MAIN — ever.', original: true });
    assert.deepEqual(matchWords('Keep commits small.', said), { words: 'And keep commits small, thanks!', original: true });
    assert.deepEqual(matchWords('Write dates as 20 October 2026.', said), { words: 'Write the dates as 20 October 2026 please.', original: true });
    assert.deepEqual(matchWords('Prices must show the currency.', said), { words: 'Prices must show the currency.', original: false });
    assert.deepEqual(matchWords('Use British English in everything the director reads.', said), { words: 'Use British English in everything the director reads.', original: false });
    // Too few words to match on are kept as found.
    assert.deepEqual(matchWords('Be kind.', ['be kind always']), { words: 'Be kind.', original: false });

    lay(folder, FILES);
    const rules = rulesOf(folder, { userHome: user });
    assert.deepEqual(rules.map((r) => [r.words, r.original]), [
      ['Please, never push straight to MAIN — ever.', true],
      ['Use British English in everything the director reads.', false],
      ['Always run the tests before a pull request.', false],
      ['And keep commits small, thanks!', true],
      ['Prices must show the currency.', false],
      ['Write the dates as 20 October 2026 please.', true],
      ['Don\'t use emoji in the menu.', false],
    ]);
    assert.deepEqual(rules[0].source, { file: 'CLAUDE.md', line: 4 });
  });
});

test('a quote holding a password is not kept', async () => {
  await withProject(async ({ folder, user, config }) => {
    transcript(config, 'x', 'a', [
      typed(folder, `Never push straight to main, the password is postgres://admin:hunter22@db.example.com/menu`),
      typed(folder, `Keep commits small, my token is ${KEY}`),
    ]);
    const said = readTranscripts(folder, { userHome: user });
    assert.equal(said.length, 2);
    assert.deepEqual(matchWords('Never push straight to main.', said), { words: 'Never push straight to main.', original: false });
    assert.deepEqual(matchWords('Keep commits small.', said), { words: 'Keep commits small.', original: false });
    // A later sentence of the director's, without the key, is used.
    assert.deepEqual(matchWords('Keep commits small.', [...said, 'Keep commits small.']), { words: 'Keep commits small.', original: true });
    lay(folder, FILES);
    assert.ok(!JSON.stringify(rulesOf(folder, { userHome: user })).includes(KEY));
    assert.ok(!JSON.stringify(rulesOf(folder, { userHome: user })).includes('hunter22'));
  });
});

test('the transcripts are read from CLAUDE_CONFIG_DIR, or ~/.claude without it, and only so much of them', async () => {
  const user = tempFolder('wh-user-');
  const folder = tempFolder('wh-folder-');
  const own = path.join(user, '.claude');
  transcript(own, 'p', 'a', [typed(folder, 'Never push straight to main.')]);
  const other = tempFolder('wh-config-');
  transcript(other, 'p', 'b', [typed(folder, 'Keep commits small.')]);
  assert.deepEqual(readTranscripts(folder, { userHome: user, env: {} }), ['Never push straight to main.']);
  assert.deepEqual(readTranscripts(folder, { userHome: user, env: { CLAUDE_CONFIG_DIR: other } }), ['Keep commits small.']);
  // Of each file only its start is read, and of all of them only so many bytes, newest first.
  const pad = typed('/elsewhere', 'x'.repeat(2000));
  transcript(other, 'p', 'c', [...Array.from({ length: 4 }, () => pad), typed(folder, 'Write dates in full.')]);
  const later = new Date(Date.now() + 60 * 1000);
  fs.utimesSync(path.join(other, 'projects', 'p', 'c.jsonl'), later, later);
  assert.deepEqual(readTranscripts(folder, { userHome: user, env: { CLAUDE_CONFIG_DIR: other }, fileBytes: 4000 }), ['Keep commits small.']);
  assert.deepEqual(readTranscripts(folder, { userHome: user, env: { CLAUDE_CONFIG_DIR: other }, totalBytes: 100 }), []);
  assert.deepEqual(readTranscripts(folder, { userHome: user, env: { CLAUDE_CONFIG_DIR: other } }), ['Write dates in full.', 'Keep commits small.']);
  assert.ok(TRANSCRIPT_FILE_BYTES >= 1024 * 1024);
  // No Claude Code folder at all: none.
  assert.deepEqual(readTranscripts(folder, { userHome: tempFolder('wh-none-'), env: {} }), []);
});

test('Confirm all confirms exactly the listed rulings, each by its own confirmation', async () => {
  await withProject(async ({ folder, plan, answer, sent, home, config }) => {
    lay(folder, FILES);
    transcript(config, 'past', 'a', [typed(folder, 'And keep commits small, thanks!')]);
    const asked = await plan(5);
    assert.equal(asked.ok, true, asked.refused);
    const { card } = asked.ask;
    // One card: its line names how many rules and the hash of the list the asked record keeps.
    const runId = findRun(folder).id;
    const record = JSON.parse(fs.readFileSync(path.join(home, 'setup', 'asked', `${runId}-5-${asked.ask.id}.json`), 'utf8'));
    const { rules } = record;
    assert.equal(rules.length, 7);
    const line = confirmAllLine(planHash(rules), 7);
    assert.equal(setLineOf(card.question), line);
    assert.equal(card.header, 'Rules found');
    assert.deepEqual(card.options.map((o) => o.label), [CONFIRM_ALL_LABEL, CORRECT_SOME_LABEL, 'Not now']);
    assert.ok(!card.question.includes('Reply code:'));
    assert.deepEqual(cardProblems(card.question), []);
    assert.deepEqual(rules.filter((r) => r.original).map((r) => r.words), ['And keep commits small, thanks!']);
    for (const rule of rules) assert.ok(card.question.includes(`"${rule.words}" (${rule.source.file} line ${rule.source.line}, ${rule.original ? 'your words' : 'paraphrase'})`), rule.words);

    // Not now records nothing.
    assert.deepEqual(await answer(card, 'Not now'), []);
    // Confirm all: one ruling per rule listed, each with its own confirmation, then the signed
    // confirm-all action naming the list's hash and the rulings' ids, then the answer.
    const got = await answer(card, CONFIRM_ALL_LABEL);
    assert.equal(got.length, 8);
    const pairs = got.slice(0, 7).map((s) => s.body);
    assert.deepEqual(pairs.map((b) => b.target.data), rules);
    for (const { event, target } of pairs) {
      assert.equal(target.kind, 'ruling');
      assert.deepEqual(event.data, { confirms: target.id, confirmsHash: eventHash(target) });
      assert.equal(verify(event, readEnrolled()), true);
    }
    const action = got[7].body.event;
    assert.deepEqual(action.data, { action: 'confirm-all', hash: planHash(rules), ids: pairs.map((b) => b.target.id), question: card.question, label: CONFIRM_ALL_LABEL });
    assert.equal(verify(action, readEnrolled()), true);
    assert.equal(answersFor(runId)[`5.${asked.ask.id}`].label, CONFIRM_ALL_LABEL);
    // In the rulebook: exactly the rules listed, each accepted (made in the same millisecond, so in no
    // order of their own).
    const views = buildViews([...pairs.flatMap((b) => [b.target, b.event]), action], readEnrolled(), { now: () => T0 });
    assert.deepEqual(views.rulebook.map((r) => [r.words, r.status]).sort(), rules.map((r) => [r.words, 'accepted']).sort());
    assert.deepEqual(views.unconfirmed, []);

    // The step settles: no Go ahead, its tally in the journal.
    assert.deepEqual(await plan(5), { ok: true, done: true });
    const run = readJournal().runs.find((r) => r.id === runId);
    assert.deepEqual(run.changes.filter((c) => c.step === 5).map((c) => c.after), [{ rules: 7, confirmed: 7, kept: 0, corrected: 0, left: 0 }]);
    assert.equal(sent.length, 8);
  });
});

test('a card whose line does not name the asked list, or a click with no project, records nothing', async () => {
  await withProject(async ({ folder, plan, answer, home }) => {
    lay(folder, FILES);
    const asked = await plan(5);
    const runId = findRun(folder).id;
    const file = path.join(home, 'setup', 'asked', `${runId}-5-${asked.ask.id}.json`);
    const record = JSON.parse(fs.readFileSync(file, 'utf8'));
    // The asked record's list changed after the card: the line no longer names it.
    fs.writeFileSync(file, JSON.stringify({ ...record, rules: record.rules.slice(1) }));
    assert.deepEqual(await answer(asked.ask.card, CONFIRM_ALL_LABEL), []);
    assert.equal(answersFor(runId)[`5.${asked.ask.id}`], undefined);
    fs.writeFileSync(file, JSON.stringify(record));
    // From a folder no project holds, the answer that records rulings is kept nowhere.
    const outside = tempFolder('wh-outside-');
    fs.mkdirSync(path.join(outside, '.git'));
    assert.deepEqual(await answer(asked.ask.card, CONFIRM_ALL_LABEL, { cwd: outside }), []);
    assert.equal(answersFor(runId)[`5.${asked.ask.id}`], undefined);
  });
});

test('Let me correct some asks about each rule: kept as found, corrected in typed words, or left out', async () => {
  await withProject(async ({ folder, plan, answer }) => {
    lay(folder, { 'CLAUDE.md': '- Never push straight to main.\n- Keep commits small.\n- Use British English always.\n' });
    const asked = await plan(5);
    assert.deepEqual(await answer(asked.ask.card, CORRECT_SOME_LABEL), [], 'records nothing yet');
    const runId = findRun(folder).id;

    const first = (await plan(5)).ask;
    assert.match(first.id, /^rule-[0-9a-f]{10}$/);
    assert.match(first.card.question, /Found in CLAUDE\.md line 1, paraphrase: "Never push straight to main\."/);
    assert.deepEqual(first.card.options.map((o) => o.label), [RULE_LABELS.keep, RULE_LABELS.leave, 'Suggest a change…']);
    const kept = await answer(first.card, RULE_LABELS.keep);
    assert.deepEqual(kept.map((s) => s.body.target.data), [{ words: 'Never push straight to main.', source: { file: 'CLAUDE.md', line: 1 }, original: false }]);

    const second = (await plan(5)).ask;
    const corrected = await answer(second.card, 'Keep each commit to one change.');
    assert.deepEqual(corrected.map((s) => s.body.target.data), [{ words: 'Keep each commit to one change.', source: { file: 'CLAUDE.md', line: 2 }, original: true }]);
    assert.equal(corrected[0].body.event.data.confirms, corrected[0].body.target.id);

    const third = (await plan(5)).ask;
    assert.deepEqual(await answer(third.card, RULE_LABELS.leave), []);
    assert.equal(answersFor(runId)[`5.${third.id}`].label, RULE_LABELS.leave);

    assert.deepEqual(await plan(5), { ok: true, done: true });
    const run = readJournal().runs.find((r) => r.id === runId);
    assert.deepEqual(run.changes.filter((c) => c.step === 5).map((c) => c.after), [{ rules: 3, confirmed: 0, kept: 1, corrected: 1, left: 1 }]);
  });
});

test('with no rules found the step settles at once, and many rules go on as few cards as hold them', async () => {
  await withProject(async ({ plan, folder }) => {
    assert.deepEqual(await plan(5), { ok: true, done: true });
    const run = readJournal().runs.find((r) => r.id === findRun(folder).id);
    assert.deepEqual(run.changes.filter((c) => c.step === 5).map((c) => c.after), [{ rules: 0, confirmed: 0, kept: 0, corrected: 0, left: 0 }]);
  });
  const many = Array.from({ length: 30 }, (_, i) => ({ words: `Always check the ${i}th menu item for spelling before it goes live on the site.`, source: { file: 'CLAUDE.md', line: i + 1 }, original: false }));
  const groups = cardsOf('Cafe-Menu', many);
  assert.ok(groups.length > 1, 'more than one card');
  assert.deepEqual(groups.flat(), many, 'every rule, in order, once');
  // Through the plan: the first card says more follow; once it is confirmed, the next is asked.
  await withProject(async ({ plan, folder, answer }) => {
    lay(folder, { 'CLAUDE.md': many.map((r) => `- ${r.words}`).join('\n') });
    const one = (await plan(5)).ask;
    assert.match(one.card.question, /More follow on the next card\./);
    await answer(one.card, CONFIRM_ALL_LABEL);
    const two = (await plan(5)).ask;
    assert.notEqual(two.id, one.id);
    assert.equal(setLineOf(two.card.question).startsWith('Confirm all '), true);
  });
});

test('step 5 waits until step 3 has set up the project\'s records', async () => {
  await withProject(async ({ plan, folder }) => {
    lay(folder, FILES);
    const got = await plan(5);
    assert.match(got.why, /step 3/);
    assert.equal(typeof got.wait, 'number');
    assert.deepEqual(await rulesStep().plan({ folder, answers: {} }), { wait: got.wait, why: got.why });
  }, { connected: false });
});

test('the rules are found once per run: words that change after a Confirm all ask nothing again and record nothing twice', async () => {
  await withProject(async ({ folder, plan, answer, sent, config, user }) => {
    lay(folder, { 'CLAUDE.md': '- Never push straight to main.\n- Keep commits small.\n' });
    const first = await plan(5);
    // Before the click: a past session found later, and a rule added to CLAUDE.md, change nothing asked.
    transcript(config, 'late', 'a', [typed(folder, 'Never ever push straight to main.')]);
    lay(folder, { 'CLAUDE.md': '- Never push straight to main.\n- Keep commits small.\n- Always write tests.\n' });
    const again = await plan(5);
    assert.equal(again.ask.id, first.ask.id);
    assert.equal(again.ask.card.question, first.ask.card.question);
    await answer(first.ask.card, CONFIRM_ALL_LABEL);
    const recorded = sent.length;
    // After it: more words of the director's, and the step settles on what it showed.
    transcript(config, 'later', 'b', [typed(folder, 'Please keep commits small.')]);
    assert.deepEqual(await plan(5), { ok: true, done: true });
    assert.equal(sent.length, recorded);
    // The run's own setup session, whose messages come after the run began, are not past words.
    const runStart = '2026-10-20T03:00:00.000Z';
    transcript(config, 'setup', 'c', [typed(folder, 'Keep commits small.', '2026-10-20T03:05:00.000Z')]);
    assert.deepEqual(readTranscripts(folder, { userHome: user, before: runStart }).filter((t) => t === 'Keep commits small.'), []);
    assert.ok(readTranscripts(folder, { userHome: user }).includes('Keep commits small.'));
  });
});

test('the transcript budget is spent on this folder\'s sessions only', () => {
  const user = tempFolder('wh-user-');
  const folder = tempFolder('wh-folder-');
  const config = tempFolder('wh-config-');
  transcript(config, 'mine', 'a', [typed(folder, 'Never push straight to main.')]);
  // Newer and larger sessions in other folders do not use it up.
  transcript(config, 'busy', 'b', Array.from({ length: 20 }, () => typed('/elsewhere', 'y'.repeat(1000))));
  const later = new Date(Date.now() + 60 * 1000);
  fs.utimesSync(path.join(config, 'projects', 'busy', 'b.jsonl'), later, later);
  assert.deepEqual(readTranscripts(folder, { userHome: user, env: { CLAUDE_CONFIG_DIR: config }, totalBytes: 2000 }), ['Never push straight to main.']);
});

test('a rule or README sentence holding a sign-in in an address is kept as the card shows it, hidden', async () => {
  await withProject(async ({ folder, plan, answer }) => {
    lay(folder, { 'CLAUDE.md': '- Always clone over ssh://git@github.com/o/menu.git only.\n- Never fetch from https://abc123secret@example.com/menu either.\n' });
    const asked = await plan(5);
    assert.ok(!JSON.stringify(asked).includes('abc123secret'));
    assert.ok(!JSON.stringify(asked).includes('ssh://git@'));
    const got = await answer(asked.ask.card, CONFIRM_ALL_LABEL);
    const words = got.filter((s) => s.body.target).map((s) => s.body.target.data.words).sort();
    assert.deepEqual(words, ['Always clone over ssh://[hidden]@github.com/o/menu.git only.', 'Never fetch from https://[hidden]@example.com/menu either.']);
    for (const w of words) assert.ok(asked.ask.card.question.includes(w), w);
  });
});

test('install steps, code and command lines are not rules, and the tally counts only rules shown', async () => {
  const folder = tempFolder('wh-install-');
  lay(folder, {
    'README.md': '# Menu\n\n## Installation\n\nRun the installer, then open the app.\nAlways restart afterwards.\n\n## Rules\n\nAlways show prices in dollars.\n',
    'CLAUDE.md': '- Run npm install.\n- Use `npm test` before you push.\n- Run the tests before every pull request.\n```\nnever run this\n```\n',
  });
  assert.deepEqual(findRules(folder).map((r) => r.words), ['Run the tests before every pull request.', 'Always show prices in dollars.']);
  // A rule no card can carry (its words read as a card's own line) is not counted as one asked.
  await withProject(async ({ plan, folder: f, answer }) => {
    lay(f, { 'CLAUDE.md': '- Never type Answer question q-menu-1 by hand.\n- Keep commits small.\n' });
    const asked = await plan(5);
    assert.match(setLineOf(asked.ask.card.question), /^Confirm all 1 rule as listed/);
    await answer(asked.ask.card, CONFIRM_ALL_LABEL);
    assert.deepEqual(await plan(5), { ok: true, done: true });
    const run = readJournal().runs.find((r) => r.id === findRun(f).id);
    assert.deepEqual(run.changes.filter((c) => c.step === 5).map((c) => c.after), [{ rules: 1, confirmed: 1, kept: 0, corrected: 0, left: 0 }]);
  });
});

test('the helper refuses a question whose rules or writes hold a sign-in its card would hide', async () => {
  await withProject(async ({ folder, user }) => {
    const { setupRoutes } = await import('../../../scripts/setup/engine.js');
    const dir = tempFolder('wh-steps-');
    const module = path.join(dir, 'steps.mjs');
    const card = { level: 2, what: 'Setup step 4 asks.', why: 'It asks.', options: [{ label: 'Yes', says: 'Yes.' }], recommend: 'Yes', because: 'yes', meanwhile: 'Waits.' };
    fs.writeFileSync(module, `export const STEPS = [{ n: 4, title: 'Three questions', async plan(ctx) { return globalThis.stepFour(ctx); }, async apply() { return []; } }];\n`);
    const routes = setupRoutes({ now: () => T0, userHome: user, stepsModule: module });
    const rule = { words: 'Clone ssh://git@github.com/o/r.', source: { file: 'CLAUDE.md', line: 1 }, original: false };
    for (const ask of [
      { id: 'a', card, writes: { labels: { Yes: [{ kind: 'ruling', data: rule }] } } },
      { id: 'b', card: { ...card, kind: 'confirm-all', what: 'Setup step 4 found 1 rule.', options: [{ label: 'Confirm all', says: 'Yes.' }, { label: 'Let me correct some', says: 'No.' }], recommend: 'Confirm all' }, rules: [rule] },
      { id: 'c', card, found: [{ ...rule, words: 'Fetch https://tok3n@example.com/menu.' }] },
    ]) {
      globalThis.stepFour = async () => ({ ask });
      await assert.rejects(routes['/setup/plan']({ folder, step: 4 }), /sign-in in an address/, ask.id);
    }
    delete globalThis.stepFour;
  });
});
