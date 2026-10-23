// tests/scripts/setup/rules.test.js
// Step 5, Rules found (design sections 9 and 15; plan ruling P7): the rules in the project's
// CLAUDE.md, README, docs and another agent setup's instruction files, each with where it was found,
// matched back to the director's own words in their past sessions in this folder. The step asks
// nothing: it settles at once with how many it found, and the survey keeps the rules themselves.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  findRules, matchWords, readTranscripts, rulesOf, rulesStep, TRANSCRIPT_FILE_BYTES,
} from '../../../scripts/setup/rules.js';
import { findRun, readJournal } from '../../../scripts/setup/journal.js';
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

test('another agent setup\'s instruction files are read for rules, with their source', () => {
  const folder = tempFolder('wh-other-');
  lay(folder, {
    'CLAUDE.md': '- Keep commits small.\n',
    'AGENTS.md': '# Agents\n\nNever edit the generated files.\nAlways keep commits small.\n',
    '.cursorrules': 'Always use tabs for indentation.\n',
    '.windsurfrules': 'Prefer small pull requests.\n',
    '.cursor/rules/style.mdc': '---\ndescription: never in front matter\nalwaysApply: true\n---\nDo not use default exports.\n',
    '.github/copilot-instructions.md': '- Run the linter before you push.\n',
  });
  assert.deepEqual(findRules(folder), [
    { words: 'Keep commits small.', source: { file: 'CLAUDE.md', line: 1 } },
    { words: 'Do not use default exports.', source: { file: '.cursor/rules/style.mdc', line: 5 } },
    { words: 'Always use tabs for indentation.', source: { file: '.cursorrules', line: 1 } },
    { words: 'Run the linter before you push.', source: { file: '.github/copilot-instructions.md', line: 1 } },
    { words: 'Prefer small pull requests.', source: { file: '.windsurfrules', line: 1 } },
    { words: 'Never edit the generated files.', source: { file: 'AGENTS.md', line: 3 } },
    { words: 'Always keep commits small.', source: { file: 'AGENTS.md', line: 4 } },
  ]);
});

test('a rule holding a sign-in in an address is kept hidden, as anything shown would be', () => {
  const folder = tempFolder('wh-hidden-');
  lay(folder, { 'CLAUDE.md': '- Always clone over ssh://git@github.com/o/menu.git only.\n- Never fetch from https://abc123secret@example.com/menu either.\n' });
  assert.deepEqual(findRules(folder).map((r) => r.words), [
    'Always clone over ssh://[hidden]@github.com/o/menu.git only.', 'Never fetch from https://[hidden]@example.com/menu either.',
  ]);
});

test('install steps, code and command lines are not rules', () => {
  const folder = tempFolder('wh-install-');
  lay(folder, {
    'README.md': '# Menu\n\n## Installation\n\nRun the installer, then open the app.\nAlways restart afterwards.\n\n## Rules\n\nAlways show prices in dollars.\n',
    'CLAUDE.md': '- Run npm install.\n- Use `npm test` before you push.\n- Run the tests before every pull request.\n```\nnever run this\n```\n',
  });
  assert.deepEqual(findRules(folder).map((r) => r.words), ['Run the tests before every pull request.', 'Always show prices in dollars.']);
});

test('step 5 asks nothing: it settles at once with how many rules it found, and says so', async () => {
  await withProject(async ({ plan, folder }) => {
    assert.deepEqual(await plan(5), { ok: true, done: true, said: 'No rules found to follow.' });
    const run = readJournal().runs.find((r) => r.id === findRun(folder).id);
    assert.deepEqual(run.changes.filter((c) => c.step === 5).map((c) => c.after), [{ rules: 0 }]);
  });
  await withProject(async ({ plan, folder, config, sent }) => {
    lay(folder, { 'CLAUDE.md': '- Never push straight to main.\n- Keep commits small.\n', 'AGENTS.md': 'Always write tests.\n' });
    transcript(config, 'past', 'a', [typed(folder, 'And keep commits small, thanks!')]);
    assert.deepEqual(await plan(5), { ok: true, done: true, said: 'Found 3 rules in the project; they\'re followed as they are.' });
    const run = readJournal().runs.find((r) => r.id === findRun(folder).id);
    assert.deepEqual(run.changes.filter((c) => c.step === 5).map((c) => c.after), [{ rules: 3 }]);
    assert.equal(run.steps[5].clickedAt, undefined, 'no Go ahead');
    assert.deepEqual(sent, [], 'nothing is recorded as a ruling');
    // A rule found in the transcript's words is the rule as they said it.
    assert.equal(rulesOf(folder, { userHome: folder, env: { CLAUDE_CONFIG_DIR: config } }).filter((r) => r.original).length, 1);
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
