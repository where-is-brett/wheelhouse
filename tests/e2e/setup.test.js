// tests/e2e/setup.test.js
// Setup, a second computer and uninstall end to end (design section 15). Each computer has its own
// scratch homes (WHEELHOUSE_HOME, a user home with a space and an accent, its Claude Code folder
// through CLAUDE_CONFIG_DIR) and a real helper on a socket in its own Wheelhouse home, running
// setup's ten real steps on a fake computer (tests/helpers/setup-e2e-steps.js) against a stand-in
// host of bare repositories. The playbook's commands are scripts/setup/cli.js's own forms, each
// first let through by the PreToolUse guards; every card is the one the helper composed, passed by
// the card check; every click and typed answer is the prompt record's decide, as Claude Code calls
// it after AskUserQuestion, and every session start the session start hook's. Nothing real is
// installed, signed in to, fetched or pushed beyond the scratch folders: see
// tests/helpers/setup-e2e.js for what stands in for what. The tests on step 4's resume and on step 4's
// first card found engine bugs (rulings R136, R137), named where they stand.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  standInHost, makeClock, makeComputer, shimTools, shutOutGitConfig, follow, listing, differences,
} from '../helpers/setup-e2e.js';
import { NEW_PRODUCT, HOST_LABELS, WAYS, REAL_USERS } from '../../scripts/setup/host.js';
import { LIVE_DATA, PRODUCT } from '../../scripts/setup/questions.js';
import { rulesOf } from '../../scripts/setup/rules.js';
import { READY, ARRIVED } from '../../scripts/setup/notify.js';
import { SETUP_FILES, COMMIT_MESSAGE } from '../../scripts/setup/project-files.js';
import { HEALTH_BRANCH } from '../../scripts/setup/health.js';
import { setupLine, SETUP_TITLES, UNINSTALL_LABEL } from '../../scripts/state/card-lines.js';
import { NOT_SET_UP, partWay, REMOVED } from '../../scripts/hooks/session-start.js';
import { UNINSTALL_BRANCH } from '../../scripts/setup/uninstall-run.js';
import { PLUGIN_LINE } from '../../scripts/setup/uninstall.js';
import { NOT_AN_ANSWER } from '../../scripts/setup/engine.js';
import { listEvents } from '../../scripts/state/events.js';
import { readJournal } from '../../scripts/setup/journal.js';
import { healthGreen, firstUnfinished, runClosed, SETUP_STEPS } from '../../scripts/lib/setup-run.js';
import { clicksDir, usedDir, keptAnswers } from '../../scripts/lib/setup-clicks.js';
import { readEnrolled, ownKey, verify } from '../../scripts/state/signing.js';
import { readProject } from '../../scripts/lib/projects.js';
import { stateDir } from '../../scripts/lib/paths.js';
import { toolPath } from '../../scripts/lib/host-tools.js';
import { STATE_BRANCH } from '../../scripts/state/record.js';
import { run as realRun, withoutGitVars } from '../../scripts/lib/run.js';
import { g } from '../helpers/git-fixture.js';
import { transcript, typed } from '../helpers/setup-answers.js';
import { tempFolder } from '../helpers/homes.js';
import { waitLongerOnTheHelper } from '../helpers/until.js';

// These tests run the real helper and check what reaches it, however loaded the computer is.
waitLongerOnTheHelper();

// The session start hook finds the helper at the director's own named pipe on Windows, which a test
// must never reach (as tests/e2e/mod.test.js).
const SKIP = process.platform === 'win32' ? 'the session start and setup\'s ending find the helper at the user\'s own named pipe on Windows' : false;

const REPO = 'a-director/Cafe-Menu';
// The survey's calls when setup finishes (design section 15, ruling A1): it only reads, asking the
// host for the default branch and the open pull requests. The stand-in `gh` refuses both, so the
// survey records that it couldn't reach the host.
const SURVEY_CALLS = [
  `gh repo view ${REPO} --json defaultBranchRef`,
  `gh pr list --repo ${REPO} --state open --json number,title,body,headRefName,headRefOid,isDraft,isCrossRepository --limit 100`,
];
const SLUG = 'a-director__Cafe-Menu';

// Programs run by name are stand-ins for the whole file (tests/helpers/setup-e2e.js, shimTools), and
// git runs with the global and system config shut out (shutOutGitConfig, ruling R144).
let shims;
let gitConfig;
before(() => {
  if (SKIP) return;
  shims = shimTools();
  gitConfig = shutOutGitConfig();
});
after(() => {
  shims?.restore();
  gitConfig?.restore();
});

// A stand-in host and the director's first computer on it, on one clock, with nothing run by name
// yet.
function fresh() {
  shims.reset();
  const clock = makeClock();
  const host = standInHost({ shims });
  return { clock, host, a: makeComputer(host, clock) };
}

// The director's answers to a new product's questions, by the question's id (an id may carry a
// digest after its name).
const NEW_ANSWERS = {
  join: NEW_PRODUCT, 'real-users': REAL_USERS.no, host: HOST_LABELS.github, connection: WAYS.quick,
  product: 'Tide tables for sailors, used by the harbour\'s skippers.', 'live-data': LIVE_DATA.no,
  'phone-ready': READY.ready, 'push-arrived': ARRIVED.yes,
};
// The board in a log `follow` gave.
const log10 = (log) => log.find((e) => e.health).health;
// Answers that click Customise on the first one card and Go ahead on the next (design section
// 15.1), and answer each question as `answers` says.
const customiseOnce = (answers) => {
  let cards = 0;
  return (id, plan, ask) => (id.startsWith('plan-') ? (cards++ === 0 ? 'Customise' : 'Go ahead') : byId(answers)(id, plan, ask));
};
// A log as [step, what] pairs: a question by its id without its digest, else what happened.
const shape = (log) => log.map((e) => [e.step, e.ask?.replace(/-[0-9a-f]{10,12}$/, '') ?? (e.covered ? 'covered' : e.goAhead ? 'go ahead' : e.settled ? 'settled' : e.health ? 'health' : 'wait')]);
const byId = (answers) => (id) => answers[Object.keys(answers).find((k) => id === k || id.startsWith(`${k}-`))];

// The signed setup clicks kept on a computer, each with whether the helper used it.
const keptClicks = (c) => c.act(() => (fs.existsSync(clicksDir()) ? fs.readdirSync(clicksDir()) : []).map((name) => JSON.parse(fs.readFileSync(path.join(clicksDir(), name), 'utf8')))
  .map((event) => ({ event, used: fs.existsSync(path.join(usedDir(), event.id)), signed: verify(event, readEnrolled()) })));

const lsRemote = async (url, ref) => (await realRun('git', ['ls-remote', url, ref])).stdout.trim();

// Ruling R144: the tests' git, the world's and the helper's alike, runs as setup's own does (R109),
// with the global and system config shut out, so nothing in the developer's own git config (a hooks
// path, commit signing, an insteadOf) changes what it does. A global config of the test's own, where
// git looks for one, is read by a git that isn't shut out, and by none of these.
test('the end-to-end tests\' git reads no global or system config (ruling R144)', { skip: SKIP }, async () => {
  const { a } = fresh();
  const xdg = tempFolder('wh-xdg-');
  fs.mkdirSync(path.join(xdg, 'git'));
  fs.writeFileSync(path.join(xdg, 'git', 'config'), '[wheelhouse]\n\tprobe = global\n');
  const dir = tempFolder('wh-git-');
  const was = process.env.XDG_CONFIG_HOME;
  process.env.XDG_CONFIG_HOME = xdg;
  try {
    const probe = ['config', '--get', 'wheelhouse.probe'];
    // Read, by a git with the config not shut out.
    assert.equal((await realRun('git', probe, { cwd: dir, baseEnv: withoutGitVars(process.env) })).stdout.trim(), 'global');
    // Not read by the tests' own git, the fixture's, or the world's (as the helper calls it, with
    // every inherited GIT_* variable taken out).
    assert.notEqual((await realRun('git', probe, { cwd: dir })).code, 0);
    await assert.rejects(g(dir, ...probe));
    assert.notEqual((await a.run('git', probe, { cwd: dir, baseEnv: withoutGitVars(process.env) })).code, 0);
  } finally {
    if (was === undefined) delete process.env.XDG_CONFIG_HOME; else process.env.XDG_CONFIG_HOME = was;
    await a.cleanup();
  }
});

test('a new product: one card, its Go ahead, every step with no more cards, a green board, then the phone', { skip: SKIP }, async () => {
  const { host, a } = fresh();
  try {
    await a.start();
    // The first session start in the folder the install line left: no key yet, so it makes one and
    // enrols it, and says setup hasn't started.
    assert.equal(await a.act(() => ownKey()), null);
    assert.deepEqual(await a.sessionStart(), [NOT_SET_UP]);
    const own = await a.act(() => ownKey());
    assert.ok(own);
    assert.deepEqual(await a.act(() => readEnrolled().map((e) => e.computer)), [own.computer]);

    // The phone card as the session asks it, to read what it opens with.
    const phoneCards = [];
    const answers = byId(NEW_ANSWERS);
    const log = await follow(a, { answer: (id, plan, ask) => { if (id.startsWith('phone')) phoneCards.push(plan.ask.card); return answers(id, plan, ask); }, phone: true });

    // The one card first, its Go ahead, then every step in order with no card: each list the Go
    // ahead covers is applied as it comes, and the steps with nothing to click settle on their own.
    // The phone comes last, once the board is green (design section 15.1).
    assert.deepEqual(log.map((e) => [e.step, e.ask?.replace(/-[0-9a-f]{10,12}$/, '') ?? (e.covered ? 'covered' : e.goAhead ? 'go ahead' : e.settled ? 'settled' : e.health ? 'health' : 'wait')]), [
      [0, 'plan'],
      [1, 'settled'],
      [2, 'covered'],
      [3, 'covered'],
      [4, 'settled'],
      [5, 'settled'],
      [6, 'covered'],
      [7, 'covered'],
      [8, 'settled'],
      [10, 'covered'],
      [10, 'health'],
      [9, 'phone-ready'], [9, 'wait'], [9, 'push-arrived'], [9, 'settled'],
    ]);
    // The one card: a plain line each, and two options, Go ahead recommended.
    const one = log[0];
    assert.equal(one.label, 'Go ahead');
    // No step's own Go ahead was clicked: the one card's answer, signed by this computer's enrolled
    // key, stood for each of them, and was never used up.
    assert.deepEqual(await keptClicks(a), []);
    const consent = await a.act(() => keptAnswers((readJournal().runs[0]).id).filter((e) => e.data.step === 0));
    assert.equal(consent.length, 1);
    assert.equal(consent[0].data.label, 'Go ahead');
    assert.equal(await a.act(() => verify(consent[0], readEnrolled())), true);

    // Step 2 fetched gh, missing here, into Wheelhouse's own tools folder, from its release page
    // as tools.js checks it, and every later gh call ran that copy.
    const two = await a.setupRun();
    assert.deepEqual(two.changes.filter((ch) => ch.step === 2).map((ch) => [ch.kind, ch.after?.tool ?? ch.key?.join('.')]), [['folder', 'gh'], ['json-key', 'permissions.allow']]);
    assert.equal(await a.act(() => toolPath('gh')), path.join(a.home, 'tools', 'gh', 'bin', 'gh'));

    // The board is green, setup's ending ran, and the journal says the run is finished.
    const { health } = log.find((e) => e.health);
    assert.equal(health.green, true, health.lines.join('\n'));
    assert.ok(health.lines.slice(0, -1).every((l) => /^(Passed|Board):/.test(l)), health.lines.join('\n'));
    assert.match(health.lines.at(-1), /^All \d+ checks passed\. Wheelhouse is ready\.$/);
    assert.match(health.board, /Wheelhouse's Logbook for a-director__Cafe-Menu/);
    assert.match(health.board, /Phase: before launch/);
    assert.match(health.started, /watcher is running/);
    assert.equal(typeof health.briefing, 'string');
    // The first card after the green board, the phone's, opens with the verdict and the first briefing,
    // so the director sees them as it is asked; the phone card asked again later doesn't.
    const briefing = [health.lines.at(-1), ...health.briefing.split('\n').filter((l) => l.trim() !== '')];
    assert.deepEqual(phoneCards[0].question.split('\n').slice(0, briefing.length), briefing);
    assert.ok(phoneCards.slice(1).every((c) => !c.question.startsWith(health.lines.at(-1))), 'once');
    const run = await a.setupRun();
    assert.equal(healthGreen(run), true);
    assert.equal(firstUnfinished(run), null);
    // The director's time, as the timed runs read it: each step's shown, started and done times.
    for (const { n } of SETUP_STEPS) assert.equal(typeof run.steps[n]?.doneAt, 'string', `step ${n}, ${SETUP_TITLES[n]}`);
    for (const { step } of log.filter((e) => e.goAhead)) {
      const t = run.steps[step];
      assert.ok(Date.parse(t.shownAt) <= Date.parse(t.clickedAt) && Date.parse(t.clickedAt) <= Date.parse(t.doneAt), `step ${step}: ${JSON.stringify(t)}`);
    }
    // Once setup is finished, the folder is a project like any other: the session start says no
    // more about setup.
    assert.ok(!(await a.sessionStart()).some((l) => /setup/i.test(l) && /wheelhouse:setup/.test(l)));
    // Setup followed again there finds every step done and opens no run of its own (ruling R140).
    assert.equal((await a.cli('resume')).plan, null);
    for (const { n } of SETUP_STEPS) assert.match((await a.cliTry('plan', String(n))).refused, /is already done/, `step ${n}`);
    assert.deepEqual(await a.act(() => readJournal().runs.map((r) => r.id)), [run.id]);

    // On the host: the product's private repository, setup's one commit of its three files and the
    // .gitignore (which had no .env lines) on main, protection on, and the trial pull request closed
    // with its branch gone. No state branch and no profile repository: the records stay here.
    const product = host.url({ repo: REPO });
    const tip = await g(product, 'rev-parse', 'main');
    assert.equal(await g(product, 'log', '-1', '--format=%s', tip), COMMIT_MESSAGE);
    assert.deepEqual((await g(product, 'diff-tree', '--no-commit-id', '--name-only', '-r', tip)).split('\n').sort(), [...SETUP_FILES, '.gitignore'].sort());
    assert.equal(await lsRemote(product, `refs/heads/${STATE_BRANCH}`), '');
    assert.equal(await lsRemote(product, `refs/heads/${HEALTH_BRANCH}`), '');
    assert.ok(host.protected.has(REPO));
    assert.equal(host.has('a-director/wheelhouse-profile'), false, 'no profile repository');
    assert.equal(fs.existsSync(path.join(a.home, 'profile.json')), false);
    assert.deepEqual(host.pulls().map(([, pr]) => [pr.head, pr.state]), [[HEALTH_BRANCH, 'closed']]);
    // The folder is the project's checkout, registered, its record opened, its pins installed.
    assert.equal(await g(a.folder, 'rev-parse', 'HEAD'), tip);
    assert.equal(await a.act(() => readProject(SLUG)?.folder), a.folder);
    assert.ok(fs.existsSync(await a.act(() => path.join(stateDir(SLUG), '.git'))));
    assert.equal(a.world.checkPins({ folder: a.folder }), 'match');

    // Nothing else was run: no installer, no launchctl, no browser, and of the host's tool by name
    // only the trial pull request's close and the survey's two reads.
    assert.deepEqual(a.refused, []);
    assert.deepEqual(shims.calls(), [`gh pr close 12 --repo ${REPO}`, ...SURVEY_CALLS]);
    const surveys = await a.act(() => listEvents(stateDir(SLUG)).filter((e) => e.kind === 'survey'));
    assert.deepEqual(surveys.map((e) => [e.data.hostReached, e.data.again]), [[false, undefined]]);
  } finally {
    await a.cleanup();
  }
});

test('an existing project with rules: step 5 asks nothing and follows them as they are', { skip: SKIP }, async () => {
  shims.reset();
  const clock = makeClock();
  const host = standInHost({ shims });
  const repo = 'a-director/Harbour-Log';
  const slug = 'a-director__Harbour-Log';
  // The director's own repository, with rules in its CLAUDE.md and another agent setup's file, and
  // their checkout of it, its origin the host's address, with the install line's settings beside it.
  await host.seed(repo, {
    'README.md': '# Harbour Log\n\nHarbour Log keeps the tide tables for the harbour\'s skippers.\n',
    'CLAUDE.md': '# Harbour Log\n\n- Keep every price in pounds and pence.\n- Write a test for each tide calculation.\n- Always show times in the harbour\'s own time zone.\n',
    'AGENTS.md': 'Never edit the generated tide files.\n',
  });
  const a = makeComputer(host, clock, { name: 'Harbour Log' });
  try {
    await g(a.folder, 'init', '-q', '-b', 'main');
    await g(a.folder, 'remote', 'add', 'origin', host.url({ repo }));
    await g(a.folder, 'fetch', '-q', 'origin');
    await g(a.folder, 'reset', '-q', '--hard', 'origin/main');
    await g(a.folder, 'remote', 'set-url', 'origin', `https://github.com/${repo}.git`);
    // One of the rules in the director's own words, typed in a past session in this folder.
    const yesterday = new Date(clock.now().getTime() - 24 * 60 * 60 * 1000).toISOString();
    transcript(a.config, 'harbour-log', 'past', [typed(a.folder, 'Always show times in the harbour\'s own time zone, please.', yesterday)]);

    await a.start();
    await a.sessionStart();
    const answer = customiseOnce({ ...NEW_ANSWERS, product: PRODUCT.readme });
    const log = await follow(a, {
      through: 5,
      answer: (id, plan, ask) => {
        assert.ok(!id.startsWith('rule'), `step 5 asked ${id}`);
        return answer(id, plan, ask);
      },
    });
    // An existing project: no joining question and no repository made. Customise asks its four
    // choices together, then the one card again, whose Go ahead covers every step's list; step 5
    // settles with no card.
    assert.deepEqual(shape(log), [
      [0, 'plan'],
      [3, 'real-users'], [3, 'connection'], [4, 'product-before-launch'], [4, 'live-data'],
      [0, 'plan'],
      [1, 'settled'], [2, 'covered'], [3, 'covered'], [4, 'settled'], [5, 'settled'],
    ]);
    assert.ok(log.filter((e) => e.together).every((e) => e.together === 4), 'asked together');
    assert.match(log.find((e) => e.step === 3 && e.goAhead).card.question, /a-director\/Harbour-Log on GitHub, kept as it is/);
    assert.ok(!a.calls.some((call) => call[1] === 'repo' && call[2] === 'create' && call[3] === repo));

    // The count is recorded, and nothing is a ruling yet: the survey holds the rules for the intake.
    const run = await a.setupRun();
    assert.deepEqual(run.changes.filter((c) => c.step === 5 && c.kind === 'answer').map((c) => c.after), [{ rules: 4 }]);
    const events = await a.act(() => listEvents(stateDir(slug), { report: () => {} }));
    assert.deepEqual(events.filter((e) => e.kind === 'ruling'), []);
    const found = await a.act(() => rulesOf(a.folder, { userHome: a.config, env: { CLAUDE_CONFIG_DIR: a.config }, before: run.startedAt }));
    assert.deepEqual(found.map((r) => [r.words, r.source.file, r.source.line, r.original]), [
      ['Keep every price in pounds and pence.', 'CLAUDE.md', 3, false],
      ['Write a test for each tide calculation.', 'CLAUDE.md', 4, false],
      ['Always show times in the harbour\'s own time zone, please.', 'CLAUDE.md', 5, true],
      ['Never edit the generated tide files.', 'AGENTS.md', 1, false],
    ]);
    assert.deepEqual(a.refused, []);
    assert.deepEqual(shims.calls(), []);
  } finally {
    await a.cleanup();
  }
});

test('setup stopped after Customise\'s cards resumes at the one card in the next session, with the answers already given', { skip: SKIP }, async () => {
  const { a } = fresh();
  try {
    await a.start();
    await a.sessionStart();
    // The one card, Customise, and its cards answered together; Desktop is closed before the one
    // card comes back.
    const one = await a.cli('resume');
    assert.equal(one.plan.step, 0);
    await a.click(one.plan.ask.card, 'Customise');
    const { plan } = await a.cli('resume');
    assert.deepEqual(plan.asks.map((x) => x.id.replace(/-[0-9a-f]{10}$/, '')), ['join', 'real-users', 'host', 'connection']);
    await a.clickAll(plan.asks.map((x) => x.card), plan.asks.map((x) => byId(NEW_ANSWERS)(x.id)));
    const stopped = await a.setupRun();
    await a.stop();

    // The next session: a helper started afresh, and the session start's reload.
    await a.start();
    await a.sessionStart();
    // The rest of the choices (step 4's), then the one card with the director's choices on it.
    const next = (await a.cli('resume')).plan;
    assert.deepEqual(next.asks.map((x) => x.id.replace(/-[0-9a-f]{10}$/, '')), ['product-before-launch', 'live-data'], 'the questions already answered are not asked again');
    await a.clickAll(next.asks.map((x) => x.card), next.asks.map((x) => byId(NEW_ANSWERS)(x.id)));
    const card = (await a.cli('resume')).plan;
    assert.equal(card.step, 0);
    assert.match(card.ask.card.question, /Here's the plan, with your choices\./);
    assert.match(card.ask.card.question, /Described as: "Tide tables for sailors, used by the harbour's skippers\."/);

    const log = await follow(a, { answer: byId(NEW_ANSWERS), through: 3 });
    assert.deepEqual(shape(log), [[0, 'plan'], [1, 'settled'], [2, 'covered'], [3, 'covered']]);
    const now = await a.setupRun();
    assert.equal(now.id, stopped.id, 'the same run, carried on');
    assert.equal(typeof now.steps[3].doneAt, 'string');
    assert.equal(await a.act(() => readProject(SLUG)?.folder), a.folder);
    assert.deepEqual(a.refused, []);
    assert.deepEqual(shims.calls(), []);
  } finally {
    await a.cleanup();
  }
});

// A session started between step 3, which registers the project, and step 7, which installs the
// pinned kits, holds nothing for kits not yet installed, so the playbook's own command passes the
// lineage hold's guard (ruling R136; found end to end by Task 17).
test('setup stopped after step 3 carries on at step 4 in the next session, on the same Go ahead', { skip: SKIP }, async () => {
  const { a } = fresh();
  try {
    await a.start();
    await a.sessionStart();
    await follow(a, { answer: byId(NEW_ANSWERS), through: 3 });
    const stopped = await a.setupRun();
    const made = a.calls.filter((call) => call[0] === 'gh' && call[1] === 'repo' && call[2] === 'create');
    assert.deepEqual(made.map((call) => call[3]), [REPO]);
    await a.stop();
    assert.equal(a.helper, null);

    // The next session: a helper started afresh, with nothing of the last one's in memory, and the
    // session start's reload, which says where setup stands, and nothing of a lineage hold: setup
    // installs the kits at step 7.
    await a.start();
    assert.deepEqual(await a.sessionStart(), [partWay(4, SETUP_TITLES[4])]);
    const resumed = await a.cli('resume');
    assert.equal(resumed.next, 4);
    // The one card's Go ahead still holds after the break (the director's call, 26 October 2026):
    // step 4 settles with no card.
    assert.equal(resumed.plan.step, 4);
    assert.equal(resumed.plan.done, true);
    assert.ok(resumed.lines.includes(`Next: step 4, ${SETUP_TITLES[4]}.`), resumed.lines.join('\n'));
    // A finished step is never planned or applied again.
    for (const n of [1, 2, 3]) {
      const again = await a.cliTry('plan', String(n));
      assert.equal(again.ok, false, `step ${n}`);
      assert.match(again.refused, /is already done/, `step ${n}`);
    }

    const log = await follow(a, { answer: byId(NEW_ANSWERS), through: 6 });
    assert.deepEqual(shape(log), [[5, 'settled'], [6, 'covered']]);
    const now = await a.setupRun();
    assert.equal(now.id, stopped.id, 'the same run, carried on');
    // Steps 1 to 3 exactly as they were when setup stopped: their times and every change they made,
    // none made again, and no repository made twice.
    for (const n of [1, 2, 3]) assert.deepEqual(now.steps[n], stopped.steps[n], `step ${n}`);
    assert.deepEqual(now.changes.filter((ch) => ch.step <= 3), stopped.changes.filter((ch) => ch.step <= 3));
    assert.deepEqual(a.calls.filter((call) => call[0] === 'gh' && call[1] === 'repo' && call[2] === 'create'), made);
    assert.equal(typeof now.steps[4].doneAt, 'string');
    // The phase the one card's Go ahead recorded reached the project's state once it existed.
    const views = await a.act(() => a.client.state.views({ project: SLUG }));
    assert.equal(views.views.settings?.phase?.value ?? views.views.settings?.phase, 'before-launch');
    assert.deepEqual(a.refused, []);
    assert.deepEqual(shims.calls(), []);
  } finally {
    await a.cleanup();
  }
});

// On Customise's card of the description, which records the product's glossary entry and phase from
// the answer, a refused typed answer records nothing and claims nothing (ruling R137).
test('the description\'s card refuses a hand-back and a first question, records neither, and takes the question typed again (rulings R125, R132)', { skip: SKIP }, async () => {
  const { a } = fresh();
  try {
    await a.start();
    await a.sessionStart();
    // Typed on the description's card in turn: the choice handed back, a question, and the question again.
    const texts = ['you decide', 'Tide tables for sailors?', 'Tide tables for sailors?'];
    const why = [];
    const answer = customiseOnce(NEW_ANSWERS);
    const log = await follow(a, {
      through: 4,
      answer: (id, plan, ask) => (id.startsWith('product-') ? texts[why.push(ask?.unanswered ?? null) - 1] : answer(id, plan, ask)),
    });
    assert.deepEqual(why, [null, NOT_AN_ANSWER.handedBack, NOT_AN_ANSWER.question], 'each refusal said why, once');
    assert.deepEqual(log.filter((e) => e.ask?.startsWith('product-')).map((e) => e.label), texts);
    assert.equal(typeof (await a.setupRun()).steps[4].doneAt, 'string');
    // Only the answer taken is the product's description; the refused words are recorded nowhere.
    const views = await a.act(() => a.client.state.views({ project: SLUG }));
    assert.equal(views.views.glossary['Cafe-Menu'].data.plain, 'Tide tables for sailors?');
    const glossary = await a.act(() => listEvents(stateDir(SLUG), { report: () => {} }).filter((e) => e.kind === 'glossary').map((e) => e.data.plain));
    assert.deepEqual(glossary, ['Tide tables for sailors?']);
    assert.deepEqual(a.refused, []);
    assert.deepEqual(shims.calls(), []);
  } finally {
    await a.cleanup();
  }
});

// Any answer can be changed (the director's ruling of 26 October 2026, design section 15.1): before
// its step runs, by its own card again, after which the one card comes back with the change; once a
// step has acted on it, a card offering what changing it takes, never a flat no.
test('an answer changed before its step runs comes back on the one card; one changed after offers what it takes', { skip: SKIP }, async () => {
  const { a } = fresh();
  try {
    await a.start();
    await a.sessionStart();
    // Go ahead on the one card, then setup stops after step 4 has settled on no live data.
    await follow(a, { answer: byId(NEW_ANSWERS), through: 4 });
    // The director meant live data after all: step 7 hasn't saved it, so its own card is asked again,
    // and step 4 settles again on the new answer.
    const { choices } = await a.cli('choices');
    const live = choices.find((c) => c.about === 'live data');
    assert.deepEqual([live.key, live.chosen, live.acted], ['4.live-data', LIVE_DATA.no, false]);
    const host = choices.find((c) => c.about === 'GitHub or GitLab');
    assert.equal(host.acted, true, 'step 3 has made the repository');
    const { asks } = await a.cli('change', '4.live-data');
    assert.deepEqual(asks.map((x) => x.id), ['live-data']);
    await a.click(asks[0].card, LIVE_DATA.yes);
    // The Go ahead's choice no longer holds, so the one card comes back, with the change on it.
    const again = (await a.cli('resume')).plan;
    assert.equal(again.step, 0);
    assert.match(again.ask.card.question, /Agents use test data only, to be safe\./);
    await a.click(again.ask.card, 'Go ahead');
    const redone = await follow(a, { answer: byId(NEW_ANSWERS), through: 7 });
    assert.deepEqual(shape(redone), [[4, 'settled'], [5, 'settled'], [6, 'covered'], [7, 'covered']]);
    assert.equal((await a.setupRun()).changes.filter((c) => c.step === 4 && c.kind === 'answer').at(-1).after.liveData, true);
    assert.equal(JSON.parse(fs.readFileSync(path.join(a.folder, '.claude', 'wheelhouse.json'), 'utf8')).liveData, true);

    // Once step 7 has saved it, changing it is offered as a reviewed change after setup.
    const after = await a.cli('change', '4.live-data');
    assert.match(after.asks[0].id, /^redo-live-data-/);
    assert.match(after.asks[0].card.question, /saved in the project's settings now/);
    await a.click(after.asks[0].card, 'Change it after setup');
    // The host, once step 3 has made the repository: Set up again, or Keep it.
    const moved = await a.cli('change', '3.host');
    assert.deepEqual(moved.asks[0].card.options.map((o) => o.label), ['Set up again', 'Keep it']);
    await a.click(moved.asks[0].card, 'Keep it');
    assert.equal((await a.cli('resume')).setUpAgain, undefined);
    // Real users, after step 3: the phase changes at once with the click.
    const real = await a.cli('change', '3.real-users');
    await a.click(real.asks[0].card, REAL_USERS.yes);
    const views = await a.act(() => a.client.state.views({ project: SLUG }));
    assert.equal(views.views.settings?.phase?.value ?? views.views.settings?.phase, 'launched');

    // At the end, the change asked for after setup goes to the front desk, in the director's words.
    const log = await follow(a, { answer: byId(NEW_ANSWERS) });
    assert.deepEqual(log10(log).requests, ['Change the project\'s settings to say it has no live data.']);
    assert.deepEqual(a.refused, []);
  } finally {
    await a.cleanup();
  }
});

// A Go ahead stands for the project the card described: a git address added to the folder after it,
// before step 3 has run, lapses it, and the one card is asked again (found by the review of 26
// October 2026: an agent can write in the folder).
test('a git address added to the folder after the Go ahead lapses it before step 3 runs', { skip: SKIP }, async () => {
  const { a } = fresh();
  try {
    await a.start();
    await a.sessionStart();
    await follow(a, { answer: byId(NEW_ANSWERS), through: 2 });
    await g(a.folder, 'init', '-q', '-b', 'main');
    await g(a.folder, 'remote', 'add', 'origin', 'https://github.com/someone/elsewhere.git');
    // Step 3 now asks its own question for the project the folder names, which the Go ahead never
    // answered, and nothing of step 3 is covered.
    const planned = await a.cli('plan', '3');
    assert.equal(planned.covered, undefined, 'not covered: the folder is not the one the card described');
    assert.equal(planned.hash, undefined);
    assert.match(planned.ask.id, /^connection-/);
    const again = (await a.cli('resume')).plan;
    assert.equal(again.step, 0);
    assert.match(again.ask.card.question, /- elsewhere on GitHub, as it is\./);
    assert.equal(typeof (await a.setupRun()).steps[3]?.doneAt, 'undefined');
  } finally {
    await a.cleanup();
  }
});

test('uninstall after setup leaves the home folder as it was, but for what the director keeps', { skip: SKIP }, async () => {
  const { host, a } = fresh();
  try {
    // The homes as the install line left them, before the first session start.
    const before = { home: listing(a.home), user: listing(a.user) };
    const userSettings = path.join(a.config, 'settings.json');
    const settingsBefore = JSON.parse(fs.readFileSync(userSettings, 'utf8'));
    await a.start();
    await a.sessionStart();
    await follow(a, { answer: byId(NEW_ANSWERS) });
    const product = host.url({ repo: REPO });
    const main = await g(product, 'rev-parse', 'main');
    // After setup, the director sets their own transcript retention (Review Focus 2).
    const set = JSON.parse(fs.readFileSync(userSettings, 'utf8'));
    assert.equal(set.cleanupPeriodDays, 30, 'setup\'s');
    fs.writeFileSync(userSettings, `${JSON.stringify({ ...set, cleanupPeriodDays: 90 }, null, 2)}\n`);

    // Uninstall's plan: its card and the level 4 cards for the product's repository and the record.
    const plan = await a.cli('uninstall', 'plan');
    assert.equal(plan.last, true, 'the last project on this computer');
    assert.deepEqual(plan.asks.map((x) => x.about), ['product', 'record']);
    assert.match(plan.card.question, /Left as you changed them: cleanupPeriodDays\./, 'the director\'s own setting named as kept');
    // The director keeps each, then clicks Remove it; apply is refused until then.
    for (const ask of plan.asks) {
      assert.equal(ask.card.options[0].label, 'Keep it', `${ask.about}: Keep recommended first`);
      await a.click(ask.card, 'Keep it');
    }
    assert.match((await a.cliTry('uninstall', 'apply', plan.hash)).refused, /needs the director's Remove it on its card/);
    await a.click(plan.card, UNINSTALL_LABEL);
    assert.deepEqual(await a.cli('uninstall', 'apply', plan.hash), { started: true });
    const status = await a.cli('uninstall', 'status');
    assert.equal(status[0], 'Uninstall is done.', status.join('\n'));
    assert.ok(status.includes(`Kept: ${REPO}.`) && status.includes('Kept: this project\'s private record on this computer.'), status.join('\n'));
    assert.ok(status.includes(`${PLUGIN_LINE}.`), status.join('\n'));
    // The last uninstall on this computer stops the helper once that answer has gone, and its
    // jobs were stopped first: the watcher among them.
    assert.equal(a.helper, null, 'the helper stopped itself');
    assert.deepEqual(a.uninstallOps.stops, ['foreman', 'watcher', 'receiver']);
    assert.equal(a.watcher, null);

    // On the host: setup's files go out by a pull request the director merges; the product is kept,
    // as the director chose; protection stays on.
    const [[, pr]] = host.pulls().filter(([, p]) => p.head === UNINSTALL_BRANCH);
    assert.equal(pr.state, 'open');
    assert.equal(await g(product, 'rev-parse', 'main'), main, 'main as setup left it, until the director merges');
    const taken = (await g(product, 'diff', '--name-only', `main...${UNINSTALL_BRANCH}`)).split('\n').sort();
    assert.deepEqual(taken, [...SETUP_FILES].sort());
    assert.ok(host.protected.has(REPO));

    // On this computer: the run closed, and the folder's session start says Wheelhouse was removed.
    assert.equal(runClosed(await a.setupRun()), true);
    assert.deepEqual(await a.sessionStart(), [REMOVED]);

    // The homes now, against before setup.
    const now = { home: listing(a.home), user: listing(a.user) };
    const home = differences(before.home, now.home);
    const user = differences(before.user, now.user);
    // Kept in Wheelhouse's home, as docs/data.md says: setup's journal and uninstall's record, the
    // project's private record (its own card's Keep it) and the director's settings on this computer.
    const under = (p, dir) => p === dir || p.startsWith(`${dir}/`);
    const kept = (p) => p === 'setup' || p === 'setup/journal.json' || p === 'setup/uninstalls' || /^setup\/uninstalls\/[0-9a-f]+\.json$/.test(p)
      || p === 'projects' || p === `projects/${SLUG}` || under(p, `projects/${SLUG}/record`) || under(p, 'settings');
    // Nothing else of Wheelhouse's is left (ruling R138): the signing key, the trusted-keys list and
    // this computer's id, the project's other files and the gh setup fetched, and their folders, all gone.
    assert.deepEqual(home.added.filter((p) => !kept(p)), [], 'nothing else of Wheelhouse\'s is left');
    assert.deepEqual([...home.removed, ...home.changed], []);
    // In the user's home: the product's checkout of the repository the director kept, exactly as
    // committed on main (setup's commit with its three files, which the pull request takes out once
    // merged); Claude Code's own record and copy of the pinned kits it installed for the project;
    // and in the user settings the director's own retention, kept, with setup's other keys gone, and
    // the `env` setup made for them (ruling R138).
    const folder = 'Projects/Café Menu/';
    const checkout = (p) => p === `${folder}.git` || p.startsWith(`${folder}.git/`) || ['README.md', 'CLAUDE.md', '.gitignore', '.claude/wheelhouse.json', '.claude/settings.json'].includes(p.slice(folder.length));
    // Anything under Claude Code's plugins folder is Claude Code's own: its record and copies of the
    // kits it installed for the project, which the director removes in Desktop with the plugin.
    const kits = (p) => p === 'claude config/plugins' || p.startsWith('claude config/plugins/');
    assert.deepEqual(user.added.filter((p) => !checkout(p) && !kits(p)), [], 'the local settings file setup made is gone too');
    assert.deepEqual(user.removed, []);
    assert.deepEqual(user.changed, [`${folder}.claude/settings.json`, 'claude config/settings.json']);
    assert.equal(await g(a.folder, 'rev-parse', 'HEAD'), main);
    assert.equal(await g(a.folder, 'status', '--porcelain'), '', 'every file in the checkout as committed');
    assert.deepEqual(JSON.parse(fs.readFileSync(userSettings, 'utf8')), { ...settingsBefore, cleanupPeriodDays: 90 });
    assert.equal(fs.existsSync(path.join(a.folder, '.claude', 'settings.local.json')), false);
    assert.equal(fs.readFileSync(path.join(a.folder, '.git', 'info', 'exclude'), 'utf8').includes('.wheelhouse'), false, 'no .wheelhouse/ folder, so its line went too (ruling R131)');

    assert.deepEqual(a.refused, []);
    assert.deepEqual(shims.calls(), [`gh pr close 12 --repo ${REPO}`, ...SURVEY_CALLS]);
  } finally {
    await a.cleanup();
  }
});
