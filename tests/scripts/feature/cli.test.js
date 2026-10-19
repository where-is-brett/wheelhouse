// tests/scripts/feature/cli.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { ask, answer, report, openPr, recordPlan, main, CliError } from '../../../scripts/feature/cli.js';
import { featurePaths, readQuestions } from '../../../scripts/feature/files.js';
import { REPORT_WORDS } from '../../../scripts/lib/build-loop.js';
import { writeProject } from '../../../scripts/lib/projects.js';
import { tempFolder } from '../../helpers/homes.js';

const CLI = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'scripts', 'feature', 'cli.js');
const real = (dir) => fs.realpathSync.native(dir);
const write = (file, text) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
};
const fence = (obj) => `\`\`\`json\n${JSON.stringify(obj, null, 2)}\n\`\`\`\n`;

const brief = () => ({
  v: 1, work: 'login-page', lane: 'feature', version: 1, goal: 'Let people sign in', done: ['Sign in works'],
  appetite: { sessions: 2, tokens: 400000 }, rulings: [], routing: {}, shownFirst: true,
});

// A feature worktree made by hand: a .git folder on feature/login-page and the brief.
function feature() {
  const tree = real(tempFolder('wh-cli-'));
  write(path.join(tree, '.git', 'HEAD'), 'ref: refs/heads/feature/login-page\n');
  write(featurePaths(tree).brief, `${fence(brief())}\nThe brief.\n`);
  return tree;
}

const reportFields = (extra = {}) => ({
  v: 1, work: 'login-page', status: 'done', pr: 7, head: 'abc', tests: '10 pass', assumptions: [], concerns: [], rulings: [], ...extra,
});

const ASK = ['--what', 'Which provider?', '--why', 'It decides what users see', '--option', 'A=Use A', '--option', 'B=Use B', '--recommend', 'A', '--level', '3'];

test('ask writes a question with the next id and the session can read it back', () => {
  const tree = feature();
  const first = ask({ worktree: tree, argv: ASK });
  assert.deepEqual(first, { id: 'q-login-page-1' });
  const second = ask({ worktree: tree, argv: ['--kind', 'extra-plan', '--plan', 'docs/plans/part.md', ...ASK] });
  assert.deepEqual(second, { id: 'q-login-page-2' });
  const { questions, skipped } = readQuestions(featurePaths(tree).questions);
  assert.equal(skipped, 0);
  assert.deepEqual(questions[0], {
    id: 'q-login-page-1', kind: 'question', what: 'Which provider?', why: 'It decides what users see',
    options: [{ label: 'A', says: 'Use A' }, { label: 'B', says: 'Use B' }], recommendation: 'A', level: 3,
  });
  assert.equal(questions[1].kind, 'extra-plan');
  assert.equal(questions[1].plan, 'docs/plans/part.md');
  // The next id follows the highest one, not the count.
  fs.appendFileSync(featurePaths(tree).questions, `${JSON.stringify({ ...questions[0], id: 'q-login-page-9' })}\n`);
  assert.equal(ask({ worktree: tree, argv: ASK }).id, 'q-login-page-10');
});

test('ask refuses malformed input in plain words and writes nothing', () => {
  const tree = feature();
  const without = (flag) => {
    const i = ASK.indexOf(flag);
    return ASK.filter((_, k) => k !== i && k !== i + 1);
  };
  const bad = {
    'an extra-plan with no --plan': [...ASK, '--kind', 'extra-plan'],
    'a --plan on a plain question': [...ASK, '--plan', 'x.md'],
    'a recommendation that is no option': ASK.map((a, i) => (ASK[i - 1] === '--recommend' ? 'C' : a)),
    'a level of 5': ASK.map((a, i) => (ASK[i - 1] === '--level' ? '5' : a)),
    'a level of 0': ASK.map((a, i) => (ASK[i - 1] === '--level' ? '0' : a)),
    'a level that is not a number': ASK.map((a, i) => (ASK[i - 1] === '--level' ? 'high' : a)),
    'a kind that is not known': [...ASK, '--kind', 'chat'],
    'no --what': without('--what'),
    'no --why': without('--why'),
    'no --recommend': without('--recommend'),
    'no --level': without('--level'),
    'an option with no =': ['--option', 'A', ...ASK],
    'a flag with no value': [...ASK, '--plan'],
    'a flag that is not known': [...ASK, '--colour', 'red'],
    'one option only': ['--what', 'w', '--why', 'y', '--option', 'A=a', '--recommend', 'A', '--level', '2'],
    'two options with one label': [...ASK, '--option', 'A=again'],
    'a stray word': [...ASK, 'extra'],
  };
  for (const [name, argv] of Object.entries(bad)) {
    assert.throws(() => ask({ worktree: tree, argv }), (e) => e instanceof CliError && e.message.length > 0 && !e.message.includes('\n'), name);
  }
  assert.equal(fs.existsSync(featurePaths(tree).questions), false);
});

test('ask refuses a question the director\'s card could not carry, in the composer\'s words, and writes nothing', () => {
  const tree = feature();
  const options = (labels) => labels.flatMap((label) => ['--option', `${label}=Use ${label}`]);
  const asked = (extra) => ['--what', 'Which provider?', '--why', 'It decides what users see', ...extra, '--level', '3'];
  for (const [name, argv, why] of [
    ['five options', asked([...options(['A', 'B', 'C', 'D', 'E']), '--recommend', 'A']), /at most 4/],
    ['a put-off label', asked([...options(['A', 'Not now']), '--recommend', 'A']), /Not now/],
    ['words past the card\'s length', ['--what', 'w'.repeat(1200), '--why', 'y', ...options(['A', 'B']), '--recommend', 'A', '--level', '3'], /1200 characters/],
  ]) {
    assert.throws(() => ask({ worktree: tree, argv }), (e) => e instanceof CliError && why.test(e.message) && /can't be put to the director as a card/.test(e.message), name);
  }
  assert.equal(fs.existsSync(featurePaths(tree).questions), false);
  // An extra plan is no card for the director, so its options are the foreman's business.
  assert.equal(ask({ worktree: tree, argv: ['--kind', 'extra-plan', '--plan', 'x.md', ...asked([...options(['A', 'B', 'C', 'D', 'E']), '--recommend', 'A'])] }).id, 'q-login-page-1');
});

test('ask from the command line prints the id, and malformed input exits non-zero with a message', () => {
  const tree = feature();
  const good = spawnSync(process.execPath, [CLI, 'ask', ...ASK], { cwd: tree, encoding: 'utf8' });
  assert.equal(good.status, 0, good.stderr);
  assert.equal(good.stdout.trim(), 'q-login-page-1');
  const bad = spawnSync(process.execPath, [CLI, 'ask', ...ASK, '--level', '9'], { cwd: tree, encoding: 'utf8' });
  assert.notEqual(bad.status, 0);
  assert.match(bad.stderr, /level/);
  const unknown = spawnSync(process.execPath, [CLI, 'frobnicate'], { cwd: tree, encoding: 'utf8' });
  assert.notEqual(unknown.status, 0);
  const outside = spawnSync(process.execPath, [CLI, 'ask', ...ASK], { cwd: real(tempFolder('wh-cli-out-')), encoding: 'utf8' });
  assert.notEqual(outside.status, 0);
  assert.match(outside.stderr, /feature/);
});

test('answer gives only a verified answer; an unsigned card answer gives none', async () => {
  const calls = [];
  // The helper's answer: a label only for the question that has a verified answer.
  const client = {
    state: {
      answer: async (args) => {
        calls.push(args);
        return { ok: true, answer: args.questionId === 'q-login-page-1' ? 'A' : null };
      },
    },
  };
  assert.deepEqual(await answer({ client, project: 'o__p', questionId: 'q-login-page-1' }), { answer: 'A' });
  assert.deepEqual(await answer({ client, project: 'o__p', questionId: 'q-login-page-2' }), { answer: null });
  assert.deepEqual(calls, [{ project: 'o__p', questionId: 'q-login-page-1' }, { project: 'o__p', questionId: 'q-login-page-2' }]);
  // Anything but a label or null from the helper is no answer.
  for (const odd of [{ ok: true, answer: { label: 'A' } }, { ok: true, answer: '' }, { ok: true }, { ok: false, refused: 'the helper is stopped' }]) {
    await assert.rejects(answer({ client: { state: { answer: async () => odd } }, project: 'o__p', questionId: 'q-login-page-1' }), CliError);
  }
  await assert.rejects(answer({ client, project: 'o__p', questionId: '../x' }), /question/);
  assert.equal(calls.length, 2, 'a malformed id never reaches the helper');
});

test('answer from the command line prints the label, or says there is none yet', async () => {
  const tree = feature();
  const lines = [];
  const io = (reply) => ({
    cwd: tree,
    client: { state: { answer: async () => reply } },
    projectOf: () => ({ project: 'o__p' }),
    out: (t) => lines.push(['out', t]),
    err: (t) => lines.push(['err', t]),
  });
  assert.equal(await main(['answer', 'q-login-page-1'], io({ ok: true, answer: 'A' })), 0);
  assert.equal(await main(['answer', 'q-login-page-1'], io({ ok: true, answer: null })), 0);
  assert.equal(await main(['answer', 'q-login-page-1'], io({ ok: false, refused: 'the host helper could not be reached' })), 1);
  assert.equal(await main(['answer'], io({ ok: true, answer: 'A' })), 1);
  assert.equal(lines[0][1].trim(), 'A');
  assert.match(lines[1][1], /no answer yet/i);
  assert.equal(lines[2][0], 'err');
});

test('report names each ruling missing from the report', () => {
  const tree = feature();
  const p = featurePaths(tree);
  write(p.rulings, `${JSON.stringify('Ruling: use A')}\n${JSON.stringify('Ruling: keep the cache')}\nnot a ruling line\n`);
  write(p.report, `${fence(reportFields({ rulings: ['Ruling: use A'] }))}\nShipped.\n`);
  const found = report({ worktree: tree });
  assert.equal(found.missing.length, 1);
  assert.match(found.missing[0], /Ruling: keep the cache/);
  assert.doesNotMatch(found.missing.join('\n'), /use A/);

  write(p.report, `${fence(reportFields({ rulings: ['  Ruling: use A', 'Ruling: keep the cache'] }))}\nShipped.\n`);
  assert.deepEqual(report({ worktree: tree }), { missing: [] }, 'whitespace around a ruling does not matter');

  // No rulings file asks for no rulings.
  fs.rmSync(p.rulings);
  write(p.report, `${fence(reportFields())}\nShipped.\n`);
  assert.deepEqual(report({ worktree: tree }), { missing: [] });
});

test('report names a missing report, missing fields, the wrong work and too many words', () => {
  const tree = feature();
  const p = featurePaths(tree);
  assert.match(report({ worktree: tree }).missing[0], /report\.md/);

  write(p.report, 'Shipped.\n');
  assert.match(report({ worktree: tree }).missing[0], /json/);

  const { tests, concerns, ...partial } = reportFields();
  write(p.report, `${fence(partial)}\nShipped.\n`);
  const fields = report({ worktree: tree }).missing.join('\n');
  assert.match(fields, /tests/);
  assert.match(fields, /concerns/);

  write(p.report, `${fence(reportFields({ work: 'other-work' }))}\nShipped.\n`);
  assert.match(report({ worktree: tree }).missing.join('\n'), /login-page/);

  write(p.report, `${fence(reportFields())}\n${'word '.repeat(REPORT_WORDS + 20)}\n`);
  assert.match(report({ worktree: tree }).missing.join('\n'), new RegExp(`${REPORT_WORDS}`));
});

test('report from the command line exits non-zero when anything is missing', () => {
  const tree = feature();
  const p = featurePaths(tree);
  write(p.rulings, `${JSON.stringify('Ruling: use A')}\n`);
  write(p.report, `${fence(reportFields())}\nShipped.\n`);
  const short = spawnSync(process.execPath, [CLI, 'report'], { cwd: tree, encoding: 'utf8' });
  assert.notEqual(short.status, 0);
  assert.match(short.stdout + short.stderr, /use A/);
  write(p.report, `${fence(reportFields({ rulings: ['Ruling: use A'] }))}\nShipped.\n`);
  const whole = spawnSync(process.execPath, [CLI, 'report'], { cwd: tree, encoding: 'utf8' });
  assert.equal(whole.status, 0, whole.stdout + whole.stderr);
});

test('open-pr opens against the default branch and keeps the number', async () => {
  const tree = feature();
  const p = featurePaths(tree);
  write(p.session, `${JSON.stringify({ sessionId: 'sess-abc_1' })}\n`);
  write(p.report, `${fence(reportFields())}\nShipped the sign-in page.\n`);
  const calls = [];
  const client = { openPr: async (args) => { calls.push(args); return { ok: true, result: { number: 7, url: 'https://example.com/pull/7' } }; } };
  const opened = await openPr({ client, project: 'o__p', worktree: tree, argv: ['--title', 'Add the sign-in page'] });
  assert.deepEqual(opened, { number: 7, already: false });
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0], {
    project: 'o__p', head: 'feature/login-page', title: 'Add the sign-in page', body: 'Shipped the sign-in page.', session: 'sess-abc_1',
  });
  assert.equal('base' in calls[0], false, 'the helper takes a missing base as the default branch');
  assert.deepEqual(JSON.parse(fs.readFileSync(p.pr, 'utf8')), { pr: 7 });

  // A second run finds the pull request open already and asks the host nothing.
  assert.deepEqual(await openPr({ client, project: 'o__p', worktree: tree, argv: ['--title', 'Again'] }), { number: 7, already: true });
  assert.equal(calls.length, 1);
});

test('plan records the plan just written, inside the worktree only (R87)', async () => {
  const tree = feature();
  const p = featurePaths(tree);
  write(path.join(tree, 'docs', 'plans', 'slice-1.md'), '# Plan\n');
  assert.deepEqual(recordPlan({ worktree: tree, argv: ['docs/plans/slice-1.md'] }), { plan: 'docs/plans/slice-1.md' });
  assert.deepEqual(JSON.parse(fs.readFileSync(p.plan, 'utf8')), { plan: 'docs/plans/slice-1.md' });
  assert.deepEqual(recordPlan({ worktree: tree, argv: [path.join(tree, 'docs', 'plans', 'slice-1.md')] }), { plan: 'docs/plans/slice-1.md' });
  for (const bad of [[], ['a', 'b'], ['../x.md'], ['/etc/hosts'], ['docs/plans/missing.md'], ['docs/plans']]) {
    assert.throws(() => recordPlan({ worktree: tree, argv: bad }), CliError, bad.join(' '));
  }
  const said = { out: '', err: '' };
  const code = await main(['plan', 'docs/plans/slice-1.md'], {
    cwd: tree, find: () => ({ root: tree }), out: (t) => { said.out += t; }, err: (t) => { said.err += t; },
  });
  assert.equal(code, 0, said.err);
  assert.equal(said.out, 'Recorded the plan: docs/plans/slice-1.md\n');
});

test('open-pr keeps the plan with the number, and opens the next slice\'s once the kept one is merged (R88)', async () => {
  const tree = feature();
  const p = featurePaths(tree);
  write(path.join(tree, 'docs', 'plans', 'slice-1.md'), '# Plan\n');
  recordPlan({ worktree: tree, argv: ['docs/plans/slice-1.md'] });
  write(p.report, `${fence(reportFields())}\nShipped.\n`);
  let number = 7;
  const client = { openPr: async () => ({ ok: true, result: { number } }) };
  assert.deepEqual(await openPr({ client, project: 'o__p', worktree: tree, argv: ['--title', 't'] }), { number: 7, already: false });
  assert.deepEqual(JSON.parse(fs.readFileSync(p.pr, 'utf8')), { pr: 7, plan: 'docs/plans/slice-1.md' });
  assert.deepEqual(await openPr({ client, project: 'o__p', worktree: tree, argv: ['--title', 't'] }), { number: 7, already: true });
  // The foreman merges it; the next slice's plan is recorded and its pull request opened.
  write(p.pr, JSON.stringify({ pr: 7, plan: 'docs/plans/slice-1.md', merged: true }));
  write(path.join(tree, 'docs', 'plans', 'slice-2.md'), '# Plan\n');
  recordPlan({ worktree: tree, argv: ['docs/plans/slice-2.md'] });
  number = 8;
  assert.deepEqual(await openPr({ client, project: 'o__p', worktree: tree, argv: ['--title', 't'] }), { number: 8, already: false });
  assert.deepEqual(JSON.parse(fs.readFileSync(p.pr, 'utf8')), { pr: 8, plan: 'docs/plans/slice-2.md' });
});

test('open-pr is refused while the report is missing or incomplete, and the host is never asked', async () => {
  const tree = feature();
  const p = featurePaths(tree);
  const calls = [];
  const client = { openPr: async (args) => { calls.push(args); return { ok: true, result: { number: 7 } }; } };
  const open = () => openPr({ client, project: 'o__p', worktree: tree, argv: ['--title', 't'] });

  await assert.rejects(open(), (e) => e instanceof CliError && /report\.md is not there/.test(e.message) && !e.message.includes('\n'));

  write(p.report, 'Shipped.\n');
  await assert.rejects(open(), /json/);

  const { tests, ...partial } = reportFields();
  write(p.report, `${fence(partial)}\nShipped.\n`);
  await assert.rejects(open(), /tests/);

  // A ruling the report leaves out holds the pull request back too.
  write(p.rulings, `${JSON.stringify('Ruling: use A')}\n`);
  write(p.report, `${fence(reportFields())}\nShipped.\n`);
  await assert.rejects(open(), /Ruling: use A/);

  write(p.report, `${fence(reportFields({ rulings: ['Ruling: use A'] }))}\n${'word '.repeat(REPORT_WORDS + 5)}\n`);
  await assert.rejects(open(), new RegExp(`${REPORT_WORDS}`));

  assert.equal(calls.length, 0);
  assert.equal(fs.existsSync(p.pr), false);

  // Once the report passes, its text is the body.
  write(p.report, `${fence(reportFields({ rulings: ['Ruling: use A'] }))}\n  Shipped it.  \n`);
  assert.deepEqual(await open(), { number: 7, already: false });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].body, 'Shipped it.');
});

test('open-pr sends no session when there is none, and a refusal or an odd answer keeps nothing', async () => {
  const tree = feature();
  const p = featurePaths(tree);
  write(p.report, `${fence(reportFields())}\nShipped.\n`);
  const calls = [];
  const refusing = { openPr: async (args) => { calls.push(args); return { ok: false, refused: 'STOP is on' }; } };
  await assert.rejects(openPr({ client: refusing, project: 'o__p', worktree: tree, argv: ['--title', 't'] }), /STOP is on/);
  assert.equal(calls[0].body, 'Shipped.');
  assert.equal('session' in calls[0], false);
  assert.equal(fs.existsSync(p.pr), false);

  await assert.rejects(openPr({ client: refusing, project: 'o__p', worktree: tree, argv: [] }), /title/);
  await assert.rejects(openPr({ client: refusing, project: 'o__p', worktree: tree, argv: ['--title', ''] }), /title/);
  await assert.rejects(openPr({ client: refusing, project: 'o__p', worktree: tree, argv: ['--title', 't', '--base', 'release'] }), CliError);
  assert.equal(calls.length, 1);

  // A host answer with no number is no pull request to keep.
  const odd = { openPr: async () => ({ ok: true, result: {} }) };
  await assert.rejects(openPr({ client: odd, project: 'o__p', worktree: tree, argv: ['--title', 't'] }), CliError);
  assert.equal(fs.existsSync(p.pr), false);

  // A detached head has no branch to open from.
  write(path.join(tree, '.git', 'HEAD'), `${'a'.repeat(40)}\n`);
  await assert.rejects(openPr({ client: odd, project: 'o__p', worktree: tree, argv: ['--title', 't'] }), /branch/);
});

test('report and open-pr read nothing from a feature folder that is a link to somewhere else', { skip: process.platform === 'win32' }, async () => {
  const tree = feature();
  const elsewhere = real(tempFolder('wh-cli-elsewhere-'));
  write(path.join(elsewhere, 'report.md'), `${fence(reportFields())}\nShipped.\n`);
  write(path.join(elsewhere, 'pr.json'), `${JSON.stringify({ pr: 5 })}\n`);
  const dir = featurePaths(tree).dir;
  fs.rmSync(dir, { recursive: true });
  fs.symlinkSync(elsewhere, dir, 'dir');
  assert.match(report({ worktree: tree }).missing[0], /real folder/);
  const calls = [];
  const client = { openPr: async (args) => { calls.push(args); return { ok: true, result: { number: 7 } }; } };
  await assert.rejects(openPr({ client, project: 'o__p', worktree: tree, argv: ['--title', 't'] }), /real folder/);
  assert.equal(calls.length, 0);
});

test('the project for a helper call comes from the folder, through a worktree under the checkout', async () => {
  const base = real(tempFolder('wh-cli-repo-'));
  const home = real(tempFolder('wh-cli-home-'));
  const before = process.env.WHEELHOUSE_HOME;
  process.env.WHEELHOUSE_HOME = home;
  try {
    const env = { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' };
    const git = (cwd, ...args) => execFileSync('git', args, { cwd, stdio: 'pipe', env });
    const mainDir = path.join(base, 'main');
    fs.mkdirSync(mainDir);
    git(mainDir, 'init', '-q', '-b', 'main');
    write(path.join(mainDir, 'a.txt'), 'a');
    git(mainDir, 'add', '.');
    git(mainDir, 'commit', '-q', '-m', 'first');
    writeProject('owner__name', { folder: mainDir, remoteUrl: 'https://example.com/owner/name.git', host: 'github', repo: 'owner/name', connection: {} });
    const tree = path.join(mainDir, '.claude', 'worktrees', 'login-page');
    git(mainDir, 'worktree', 'add', '-q', tree, '-b', 'feature/login-page');
    write(featurePaths(tree).brief, `${fence(brief())}\nThe brief.\n`);
    const calls = [];
    const client = { state: { answer: async (args) => { calls.push(args); return { ok: true, answer: 'A' }; } } };
    const lines = [];
    const sub = path.join(tree, 'src');
    fs.mkdirSync(sub);
    assert.equal(await main(['answer', 'q-login-page-1'], { cwd: sub, client, out: (t) => lines.push(t), err: (t) => lines.push(t) }), 0, lines.join(''));
    assert.deepEqual(calls, [{ project: 'owner__name', questionId: 'q-login-page-1' }]);
  } finally {
    if (before === undefined) delete process.env.WHEELHOUSE_HOME; else process.env.WHEELHOUSE_HOME = before;
  }
});
