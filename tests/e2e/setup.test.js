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
  standInHost, makeClock, makeComputer, shimTools, follow, listing, differences,
} from '../helpers/setup-e2e.js';
import { NEW_PRODUCT, HOST_LABELS, WAYS, REAL_USERS, PROFILE_REPO, fromOtherComputer } from '../../scripts/setup/host.js';
import { LIVE_DATA, PRODUCT } from '../../scripts/setup/questions.js';
import { askedRecord } from '../../scripts/setup/clicks.js';
import { listHash } from '../../scripts/lib/setup-writes.js';
import { READY, ARRIVED } from '../../scripts/setup/notify.js';
import { SETUP_FILES, COMMIT_MESSAGE } from '../../scripts/setup/project-files.js';
import { HEALTH_BRANCH } from '../../scripts/setup/health.js';
import { setupLine, setLineOf, confirmAllLine, trustLine, SETUP_TITLES, UNINSTALL_LABEL, CONFIRM_ALL_LABEL, TRUST_LABEL } from '../../scripts/state/card-lines.js';
import { NOT_SET_UP, partWay, REMOVED, TRUST_ASK } from '../../scripts/hooks/session-start.js';
import { fingerprint } from '../../scripts/lib/trust-clicks.js';
import { composeCard } from '../../scripts/cards/compose.js';
import { UNINSTALL_BRANCH } from '../../scripts/setup/uninstall-run.js';
import { PLUGIN_LINE } from '../../scripts/setup/uninstall.js';
import { NOT_AN_ANSWER } from '../../scripts/setup/engine.js';
import { listEvents, eventPath } from '../../scripts/state/events.js';
import { readJournal } from '../../scripts/setup/journal.js';
import { healthGreen, firstUnfinished, runClosed, stepsFor, joinedRepo, SETUP_STEPS, JOINING_STEPS } from '../../scripts/lib/setup-run.js';
import { clicksDir, usedDir } from '../../scripts/lib/setup-clicks.js';
import { readEnrolled, ownKey, verify } from '../../scripts/state/signing.js';
import { readProject } from '../../scripts/lib/projects.js';
import { stateDir } from '../../scripts/lib/paths.js';
import { toolPath } from '../../scripts/lib/host-tools.js';
import { STATE_BRANCH } from '../../scripts/state/clone.js';
import { run as realRun } from '../../scripts/lib/run.js';
import { g } from '../helpers/git-fixture.js';
import { transcript, typed } from '../helpers/setup-answers.js';

// The session start hook finds the helper at the director's own named pipe on Windows, which a test
// must never reach (as tests/e2e/mod.test.js).
const SKIP = process.platform === 'win32' ? 'the session start and setup\'s ending find the helper at the user\'s own named pipe on Windows' : false;

const REPO = 'a-director/Cafe-Menu';
const SLUG = 'a-director__Cafe-Menu';

// Programs run by name are stand-ins for the whole file (tests/helpers/setup-e2e.js, shimTools).
let shims;
before(() => { if (!SKIP) shims = shimTools(); });
after(() => shims?.restore());

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
// The board at the end of a log `follow` gave.
const log10 = (log) => log.at(-1).health;
const byId = (answers) => (id) => answers[Object.keys(answers).find((k) => id === k || id.startsWith(`${k}-`))];

// The signed setup clicks kept on a computer, each with whether the helper used it.
const keptClicks = (c) => c.act(() => fs.readdirSync(clicksDir()).map((name) => JSON.parse(fs.readFileSync(path.join(clicksDir(), name), 'utf8')))
  .map((event) => ({ event, used: fs.existsSync(path.join(usedDir(), event.id)), signed: verify(event, readEnrolled()) })));

const lsRemote = async (url, ref) => (await realRun('git', ['ls-remote', url, ref])).stdout.trim();

test('a new product: every step\'s card, its click, and a green board at the end', { skip: SKIP }, async () => {
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

    const log = await follow(a, { answer: byId(NEW_ANSWERS) });

    // Every step, in order: the questions asked, a Go-ahead card for each step that changes
    // something, and the steps with nothing to click settling on their own.
    assert.deepEqual(log.map((e) => [e.step, e.ask?.replace(/-[0-9a-f]{10}$/, '') ?? (e.goAhead ? 'go ahead' : e.settled ? 'settled' : e.health ? 'health' : 'wait')]), [
      [1, 'settled'],
      [2, 'go ahead'],
      [3, 'join'], [3, 'real-users'], [3, 'host'], [3, 'connection'], [3, 'go ahead'],
      [4, 'product-before-launch'], [4, 'live-data'], [4, 'settled'],
      [5, 'settled'],
      [6, 'go ahead'],
      [7, 'go ahead'],
      [8, 'settled'],
      [9, 'phone-ready'], [9, 'wait'], [9, 'push-arrived'], [9, 'settled'],
      [10, 'go ahead'],
      [10, 'health'],
    ]);
    // Each Go-ahead card names its step and the hash of its list in its set line; apply refused it
    // until the director's click, which the prompt record signed and the helper used once.
    const clicks = await keptClicks(a);
    for (const { step, goAhead, card, refusedBefore } of log.filter((e) => e.goAhead)) {
      assert.equal(setLineOf(card.question), setupLine(step, goAhead), `step ${step}`);
      assert.match(refusedBefore, /needs the director's click on its card/, `step ${step}`);
      const mine = clicks.filter((k) => k.event.data.step === step && k.event.data.hash === goAhead);
      assert.equal(mine.length, 1, `step ${step}: one click on its card`);
      assert.equal(mine[0].signed, true, `step ${step}: signed by this computer's enrolled key`);
      assert.equal(mine[0].used, true, `step ${step}: used by the helper`);
      assert.equal(mine[0].event.data.question, card.question, `step ${step}: the click names the card as shown`);
    }
    assert.equal(clicks.length, log.filter((e) => e.goAhead).length, 'no click but the director\'s on each Go-ahead card');

    // Step 2 fetched gh, missing here, into Wheelhouse's own tools folder, from its release page
    // as tools.js checks it, and every later gh call ran that copy.
    const two = await a.setupRun();
    assert.deepEqual(two.changes.filter((ch) => ch.step === 2).map((ch) => [ch.kind, ch.after?.tool ?? ch.key?.join('.')]), [['folder', 'gh'], ['json-key', 'permissions.allow']]);
    assert.equal(await a.act(() => toolPath('gh')), path.join(a.home, 'tools', 'gh', 'bin', 'gh'));

    // The board is green, setup's ending ran, and the journal says the run is finished.
    const { health } = log.at(-1);
    assert.equal(health.green, true, health.lines.join('\n'));
    assert.ok(health.lines.every((l) => /^(Passed|Board):/.test(l)), health.lines.join('\n'));
    assert.match(health.board, /Wheelhouse's board for a-director__Cafe-Menu/);
    assert.match(health.board, /Phase: before launch/);
    assert.match(health.started, /watcher is running/);
    assert.equal(typeof health.briefing, 'string');
    const run = await a.setupRun();
    assert.equal(healthGreen(run), true);
    assert.equal(firstUnfinished(run), null);
    // The director's time, as the timed runs read it: each card's shown, clicked and done times.
    for (const { n } of SETUP_STEPS) assert.equal(typeof run.steps[n]?.doneAt, 'string', `step ${n}, ${SETUP_TITLES[n]}`);
    for (const { step } of log.filter((e) => e.goAhead)) {
      const t = run.steps[step];
      assert.ok(Date.parse(t.shownAt) <= Date.parse(t.clickedAt) && Date.parse(t.clickedAt) <= Date.parse(t.doneAt), `step ${step}: ${JSON.stringify(t)}`);
    }
    // Once setup is finished, the folder is a project like any other: the session start says no
    // more about setup.
    assert.ok(!(await a.sessionStart()).some((l) => /setup/i.test(l) && /Follow wheelhouse:setup/.test(l)));
    // Setup followed again there finds every step done and opens no run of its own (ruling R140).
    assert.equal((await a.cli('resume')).plan, null);
    for (const { n } of SETUP_STEPS) assert.match((await a.cliTry('plan', String(n))).refused, /is already done/, `step ${n}`);
    assert.deepEqual(await a.act(() => readJournal().runs.map((r) => r.id)), [run.id]);

    // On the host: the product's private repository, setup's one commit of its three files on main,
    // the state branch, the profile with this computer's key, protection on, and the trial pull
    // request closed with its branch gone.
    const product = host.url({ repo: REPO });
    const tip = await g(product, 'rev-parse', 'main');
    assert.equal(await g(product, 'log', '-1', '--format=%s', tip), COMMIT_MESSAGE);
    assert.deepEqual((await g(product, 'diff-tree', '--no-commit-id', '--name-only', '-r', tip)).split('\n').sort(), [...SETUP_FILES].sort());
    assert.notEqual(await lsRemote(product, `refs/heads/${STATE_BRANCH}`), '');
    assert.equal(await lsRemote(product, `refs/heads/${HEALTH_BRANCH}`), '');
    assert.ok(host.protected.has(REPO));
    assert.equal(await a.act(() => JSON.parse(fs.readFileSync(path.join(a.home, 'profile.json'), 'utf8')).repo), `a-director/${PROFILE_REPO}`);
    const enrolment = JSON.parse(await g(host.url({ repo: `a-director/${PROFILE_REPO}` }), 'show', `wheelhouse-profile:enrolments/${own.computer}.json`));
    assert.equal(enrolment.publicKey, own.publicKey);
    assert.deepEqual(host.pulls().map(([, pr]) => [pr.head, pr.state]), [[HEALTH_BRANCH, 'closed']]);
    // The folder is the project's checkout, registered, its state cloned, its pins installed.
    assert.equal(await g(a.folder, 'rev-parse', 'HEAD'), tip);
    assert.equal(await a.act(() => readProject(SLUG)?.folder), a.folder);
    assert.ok(fs.existsSync(await a.act(() => path.join(stateDir(SLUG), '.git'))));
    assert.equal(a.world.checkPins({ folder: a.folder }), 'match');

    // Nothing else was run: no installer, no launchctl, no browser, and of the host's tool by name
    // only the trial pull request's close.
    assert.deepEqual(a.refused, []);
    assert.deepEqual(shims.calls(), [`gh pr close 12 --repo ${REPO}`]);
  } finally {
    await a.cleanup();
  }
});

test('an existing project with rules: Confirm all records each ruling confirmed', { skip: SKIP }, async () => {
  shims.reset();
  const clock = makeClock();
  const host = standInHost({ shims });
  const repo = 'a-director/Harbour-Log';
  const slug = 'a-director__Harbour-Log';
  // The director's own repository, with rules in its CLAUDE.md, and their checkout of it, its
  // origin the host's address, with the install line's settings beside it.
  await host.seed(repo, {
    'README.md': '# Harbour Log\n\nHarbour Log keeps the tide tables for the harbour\'s skippers.\n',
    'CLAUDE.md': '# Harbour Log\n\n- Keep every price in pounds and pence.\n- Write a test for each tide calculation.\n- Always show times in the harbour\'s own time zone.\n',
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
    const confirmCards = [];
    const log = await follow(a, {
      through: 5,
      answer: (id, plan) => {
        if (id.startsWith('rules-')) {
          confirmCards.push(plan.ask);
          return CONFIRM_ALL_LABEL;
        }
        return byId({ ...NEW_ANSWERS, product: PRODUCT.readme })(id);
      },
    });
    // An existing project: no joining question and no repository made; its card says it is kept.
    assert.deepEqual(log.map((e) => [e.step, e.ask?.replace(/-[0-9a-f]{10}$/, '') ?? (e.goAhead ? 'go ahead' : 'settled')]), [
      [1, 'settled'], [2, 'go ahead'],
      [3, 'real-users'], [3, 'connection'], [3, 'go ahead'],
      [4, 'product-before-launch'], [4, 'live-data'], [4, 'settled'],
      [5, 'rules'], [5, 'settled'],
    ]);
    assert.match(log.find((e) => e.step === 3 && e.goAhead).card.question, /a-director\/Harbour-Log on GitHub, kept as it is/);
    assert.ok(!a.calls.some((call) => call[1] === 'repo' && call[2] === 'create' && call[3] === repo));

    // The card of the rules found: each rule quoted with where it was found, the one in the
    // director's own words as theirs, and its line naming how many and the hash of that list.
    assert.equal(confirmCards.length, 1);
    const [card] = confirmCards;
    const run = await a.setupRun();
    const rules = await a.act(() => askedRecord(run.id, 5, card.id).rules);
    assert.deepEqual(rules.map((r) => [r.words, r.source.file, r.source.line, r.original]), [
      ['Keep every price in pounds and pence.', 'CLAUDE.md', 3, false],
      ['Write a test for each tide calculation.', 'CLAUDE.md', 4, false],
      ['Always show times in the harbour\'s own time zone, please.', 'CLAUDE.md', 5, true],
    ]);
    assert.equal(setLineOf(card.card.question), confirmAllLine(listHash(rules), 3));
    for (const r of rules) assert.ok(card.card.question.includes(r.words), r.words);
    assert.deepEqual(run.changes.filter((c) => c.step === 5 && c.kind === 'answer').map((c) => c.after), [{ rules: 3, confirmed: 3, kept: 0, corrected: 0, left: 0 }]);

    // Confirm all recorded each rule as a ruling with its own confirmation, signed by this computer,
    // then the confirm-all action naming them; the helper recorded each in the project's state and
    // pushed it to the host.
    const events = await a.act(() => listEvents(stateDir(slug), { report: () => {} }));
    const rulings = events.filter((e) => e.kind === 'ruling');
    assert.deepEqual(rulings.map((e) => e.data).sort((x, y) => x.source.line - y.source.line), rules);
    const enrolled = await a.act(() => readEnrolled());
    for (const ruling of rulings) {
      const confirmations = events.filter((e) => e.kind === 'confirmation' && e.data?.confirms === ruling.id);
      assert.equal(confirmations.length, 1, ruling.data.words);
      assert.equal(verify(confirmations[0], enrolled), true, `${ruling.data.words}: signed by this computer's enrolled key`);
    }
    const [all] = events.filter((e) => e.kind === 'action' && e.data?.action === 'confirm-all');
    assert.deepEqual([...all.data.ids].sort(), rulings.map((e) => e.id).sort());
    assert.equal(all.data.hash, listHash(rules));
    assert.equal(verify(all, enrolled), true);
    const views = (await a.act(() => a.client.state.views({ project: slug }))).views;
    assert.deepEqual(views.rulebook.map((r) => [r.words, r.status]).sort(), rules.map((r) => [r.words, 'accepted']).sort());
    assert.deepEqual(views.unconfirmed, []);
    const onHost = await g(host.url({ repo }), 'ls-tree', '-r', '--name-only', STATE_BRANCH);
    const confirmations = events.filter((e) => e.kind === 'confirmation' && rulings.some((r) => r.id === e.data.confirms));
    for (const e of [...rulings, ...confirmations, all]) assert.ok(onHost.split('\n').includes(eventPath(e).split(path.sep).join('/')), `${e.kind} ${e.id} on the host's state branch`);
    assert.deepEqual(a.refused, []);
    assert.deepEqual(shims.calls(), []);
  } finally {
    await a.cleanup();
  }
});

test('setup stopped at step 3\'s host card resumes there in the next session, with the answers already given, never repeating a finished step', { skip: SKIP }, async () => {
  const { a } = fresh();
  try {
    await a.start();
    await a.sessionStart();
    // Steps 1 and 2 done, and two of step 3's questions answered; Desktop is closed while its
    // host card is asked.
    const first = await follow(a, { answer: byId(NEW_ANSWERS), through: 2 });
    assert.deepEqual(first.map((e) => e.step), [1, 2]);
    const asked = [];
    for (;;) {
      const { plan } = await a.cli('resume');
      if (plan.ask.id === 'host') break;
      asked.push(plan.ask.id);
      await a.click(plan.ask.card, byId(NEW_ANSWERS)(plan.ask.id));
    }
    assert.deepEqual(asked, ['join', 'real-users']);
    const stopped = await a.setupRun();
    await a.stop();

    // The next session: a helper started afresh, and the session start's reload.
    await a.start();
    assert.deepEqual(await a.sessionStart(), [partWay(3, SETUP_TITLES[3])]);
    const resumed = await a.cli('resume');
    assert.equal(resumed.next, 3);
    assert.equal(resumed.plan.ask.id, 'host', 'the questions already answered are not asked again');
    for (const n of [1, 2]) assert.match((await a.cliTry('plan', String(n))).refused, /is already done/, `step ${n}`);

    const log = await follow(a, { answer: byId(NEW_ANSWERS), through: 3 });
    assert.deepEqual(log.map((e) => e.ask?.replace(/-[0-9a-f]{10}$/, '') ?? (e.goAhead ? 'go ahead' : 'other')), ['host', 'connection', 'go ahead']);
    const now = await a.setupRun();
    assert.equal(now.id, stopped.id, 'the same run, carried on');
    for (const n of [1, 2]) assert.deepEqual(now.steps[n], stopped.steps[n], `step ${n}`);
    assert.deepEqual(now.changes.filter((ch) => ch.step <= 2), stopped.changes.filter((ch) => ch.step <= 2), 'nothing of steps 1 and 2 made again');
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
test('setup stopped at step 4 resumes at step 4 in the next session', { skip: SKIP }, async () => {
  const { a } = fresh();
  try {
    await a.start();
    await a.sessionStart();
    await follow(a, { answer: byId(NEW_ANSWERS), through: 3 });
    // Step 4's first card is asked; Desktop is closed before the director answers it.
    const asked = (await a.cli('resume')).plan;
    assert.equal(asked.step, 4);
    assert.match(asked.ask.id, /^product-/);
    const stopped = await a.setupRun();
    const made = a.calls.filter((call) => call[0] === 'gh' && call[1] === 'repo' && call[2] === 'create');
    assert.deepEqual(made.map((call) => call[3]), [REPO, `a-director/${PROFILE_REPO}`]);
    await a.stop();
    assert.equal(a.helper, null);

    // The next session: a helper started afresh, with nothing of the last one's in memory, and the
    // session start's reload, which says where setup stands.
    await a.start();
    // It says where setup stands, and nothing of a lineage hold: setup installs the kits at step 7.
    assert.deepEqual(await a.sessionStart(), [partWay(4, SETUP_TITLES[4])]);
    const resumed = await a.cli('resume');
    assert.equal(resumed.next, 4);
    assert.equal(resumed.plan.step, 4);
    assert.equal(resumed.plan.ask.id, asked.ask.id);
    assert.equal(resumed.plan.ask.card.question, asked.ask.card.question, 'the same card, asked again');
    assert.ok(resumed.lines.includes(`Next: step 4, ${SETUP_TITLES[4]}.`), resumed.lines.join('\n'));
    // A finished step is never planned or applied again.
    for (const n of [1, 2, 3]) {
      const again = await a.cliTry('plan', String(n));
      assert.equal(again.ok, false, `step ${n}`);
      assert.match(again.refused, /is already done/, `step ${n}`);
    }

    // The director answers, and setup carries on from step 4, through step 5.
    const log = await follow(a, { answer: byId(NEW_ANSWERS), through: 5 });
    assert.deepEqual(log.map((e) => [e.step, e.ask?.replace(/-[0-9a-f]{10}$/, '') ?? (e.settled ? 'settled' : 'other')]), [
      [4, 'product-before-launch'], [4, 'live-data'], [4, 'settled'], [5, 'settled'],
    ]);
    const now = await a.setupRun();
    assert.equal(now.id, stopped.id, 'the same run, carried on');
    // Steps 1 to 3 exactly as they were when setup stopped: their times and every change they made,
    // none made again, and no repository made twice.
    for (const n of [1, 2, 3]) assert.deepEqual(now.steps[n], stopped.steps[n], `step ${n}`);
    assert.deepEqual(now.changes.filter((ch) => ch.step <= 3), stopped.changes.filter((ch) => ch.step <= 3));
    assert.deepEqual(a.calls.filter((call) => call[0] === 'gh' && call[1] === 'repo' && call[2] === 'create'), made);
    assert.equal(typeof now.steps[4].doneAt, 'string');
    assert.equal(typeof now.steps[5].doneAt, 'string');
    assert.equal((await a.cli('resume')).next, 6);
    // The answer recorded in the project's records once: the product's glossary entry.
    const views = await a.act(() => a.client.state.views({ project: SLUG }));
    assert.equal(views.views.glossary['Cafe-Menu'].data.plain, NEW_ANSWERS.product);
    assert.deepEqual(a.refused, []);
    assert.deepEqual(shims.calls(), []);
  } finally {
    await a.cleanup();
  }
});

// On step 4's first card, which records the product's glossary entry and phase from the answer, a
// refused typed answer records nothing and claims nothing (ruling R137; found end to end by Task 17).
test('step 4\'s first card refuses a hand-back and a first question, records neither, and takes the question typed again (rulings R125, R132)', { skip: SKIP }, async () => {
  const { a } = fresh();
  try {
    await a.start();
    await a.sessionStart();
    await follow(a, { answer: byId(NEW_ANSWERS), through: 3 });
    // Typed on its first card in turn: the choice handed back, a question, and the question again.
    const texts = ['you decide', 'Tide tables for sailors?', 'Tide tables for sailors?'];
    const why = [];
    const log = await follow(a, {
      through: 4,
      answer: (id, plan) => (id.startsWith('product-') ? texts[why.push(plan.unanswered ?? null) - 1] : byId(NEW_ANSWERS)(id)),
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

test('a second computer joins, and its records count on the first only after Trust it', { skip: SKIP }, async () => {
  const { clock, host, a } = fresh();
  const b = makeComputer(host, clock, { name: 'Cafe Menu' });
  try {
    // The first computer sets up the product, and a ruling is written to the project's state, as
    // the front desk writes one, for the director to confirm. Then Desktop is closed there.
    await a.start();
    await a.sessionStart();
    assert.equal(log10(await follow(a, { answer: byId(NEW_ANSWERS) })).green, true);
    const words = 'Prices are shown in pounds and pence.';
    const written = await a.act(() => a.client.state.write({ project: SLUG, kind: 'ruling', data: { words } }));
    assert.equal(written.ok, true, JSON.stringify(written));
    await a.stop();

    // The second computer: its own key at its first session start, then setup joins the product
    // from an empty folder and runs only the joining steps (ruling R74).
    await b.start();
    assert.deepEqual(await b.sessionStart(), [NOT_SET_UP]);
    const keyB = await b.act(() => ownKey());
    const joined = await follow(b, { answer: byId({ ...NEW_ANSWERS, join: fromOtherComputer('Cafe-Menu') }) });
    assert.deepEqual([...new Set(joined.map((e) => e.step))], [1, 2, 3, 6, 7, 8, 9]);
    assert.deepEqual(joined.filter((e) => e.step === 3 && e.ask).map((e) => e.ask.replace(/-[0-9a-f]{10}$/, '')), ['join', 'host', 'connection']);
    const runB = await b.setupRun();
    assert.equal(joinedRepo(runB), REPO);
    assert.equal(stepsFor(runB), JOINING_STEPS);
    assert.equal(firstUnfinished(runB), null, 'finished');
    assert.equal(healthGreen(runB), false, 'with no green mark: no step 10 on a joining computer');
    assert.match((await b.cliTry('plan', '10')).refused, /a computer joining a project set up on another runs only steps 1, 2, 3, 6, 7, 8, 9/);
    assert.equal(await g(b.folder, 'rev-parse', 'HEAD'), await g(host.url({ repo: REPO }), 'rev-parse', 'main'));
    // Its key went into the profile, published by step 3.
    const published = JSON.parse(await g(host.url({ repo: `a-director/${PROFILE_REPO}` }), 'show', `wheelhouse-profile:enrolments/${keyB.computer}.json`));
    assert.equal(published.publicKey, keyB.publicKey);

    // On the second computer the director confirms the ruling, signed there and pushed to the host.
    const ruling = await b.act(() => listEvents(stateDir(SLUG), { report: () => {} }).find((e) => e.kind === 'ruling' && e.data.words === words));
    assert.ok(ruling, 'the ruling reached the second computer\'s state');
    const confirm = composeCard({
      kind: 'confirm', level: 3, what: `A rule for the product: ${words}`, why: 'It holds only once you confirm it.',
      options: [{ label: 'Confirm', says: 'It goes into the rulebook.' }], recommend: 'Confirm', because: 'you asked for it', meanwhile: 'Nothing changes.',
      target: { event: ruling },
    }).question;
    await b.click(confirm, 'Confirm');
    const confirmation = await b.act(() => listEvents(stateDir(SLUG), { report: () => {} }).find((e) => e.kind === 'confirmation' && e.data.confirms === ruling.id));
    assert.equal(confirmation.computer, keyB.computer);
    await b.stop();

    // Back on the first computer: the session start syncs the state and fetches the profile's
    // enrolments. The second computer's confirmation is there, but it doesn't count: its key is
    // found in the profile, not trusted.
    await a.start();
    const lines = await a.sessionStart();
    const events = await a.act(() => listEvents(stateDir(SLUG), { report: () => {} }));
    assert.ok(events.some((e) => e.id === confirmation.id), 'the confirmation reached the first computer');
    assert.equal(await a.act(() => verify(confirmation, readEnrolled())), false);
    const unconfirmed = async () => (await a.act(() => a.client.state.views({ project: SLUG }))).views.unconfirmed.map((u) => u.id);
    assert.ok((await unconfirmed()).includes(ruling.id), 'still unconfirmed here');
    // The trust card names the second computer, the day its key was added and the key's
    // fingerprint; Not now trusts nothing.
    const offered = lines.filter((l) => l.startsWith(TRUST_ASK));
    assert.equal(offered.length, 1, lines.join('\n'));
    const card = JSON.parse(offered[0].slice(TRUST_ASK.length));
    assert.equal(setLineOf(card.question), trustLine(keyB.computer, published.at, fingerprint(keyB.publicKey)));
    await a.click(card, 'Not now');
    assert.equal(await a.act(() => readEnrolled().some((e) => e.computer === keyB.computer)), false);
    assert.ok((await unconfirmed()).includes(ruling.id));
    // Trust it: the second computer's key is enrolled here, and its confirmation counts.
    await a.click(card, TRUST_LABEL);
    assert.deepEqual(await a.act(() => readEnrolled().find((e) => e.computer === keyB.computer)?.publicKey), keyB.publicKey);
    assert.equal(await a.act(() => verify(confirmation, readEnrolled())), true);
    assert.ok(!(await unconfirmed()).includes(ruling.id), 'confirmed by the second computer\'s click');
    const rulebook = (await a.act(() => a.client.state.views({ project: SLUG }))).views.rulebook;
    assert.deepEqual(rulebook.filter((r) => r.words === words).map((r) => r.status), ['accepted']);
    // Trusted, it is offered no more.
    assert.ok(!(await a.sessionStart()).some((l) => l.startsWith(TRUST_ASK)));
    assert.deepEqual([...a.refused, ...b.refused], []);
    assert.deepEqual(shims.calls(), [`gh pr close 12 --repo ${REPO}`]);
  } finally {
    await b.cleanup();
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
    const own = await a.act(() => ownKey());
    // After setup, the director sets their own transcript retention (Review Focus 2).
    const set = JSON.parse(fs.readFileSync(userSettings, 'utf8'));
    assert.equal(set.cleanupPeriodDays, 30, 'setup\'s');
    fs.writeFileSync(userSettings, `${JSON.stringify({ ...set, cleanupPeriodDays: 90 }, null, 2)}\n`);

    // Uninstall's plan: its card and the level 4 cards for what setup made on the host.
    const plan = await a.cli('uninstall', 'plan');
    assert.equal(plan.last, true, 'the last project on this computer');
    assert.deepEqual(plan.asks.map((x) => x.about), ['product', 'state', 'profile']);
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
    assert.ok(status.includes(`Kept: ${REPO}.`) && status.includes(`Kept: ${REPO}:${STATE_BRANCH}.`) && status.includes(`Kept: a-director/${PROFILE_REPO}.`), status.join('\n'));
    assert.ok(status.includes(`${PLUGIN_LINE}.`), status.join('\n'));
    // The last uninstall on this computer stops the helper once that answer has gone, and its
    // jobs were stopped first: the watcher among them.
    assert.equal(a.helper, null, 'the helper stopped itself');
    assert.deepEqual(a.uninstallOps.stops, ['foreman', 'watcher', 'receiver']);
    assert.equal(a.watcher, null);

    // On the host: setup's files go out by a pull request the director merges; the product, its
    // state branch and the profile are kept, as the director chose; this computer's key has left the
    // profile; protection stays on.
    const [[, pr]] = host.pulls().filter(([, p]) => p.head === UNINSTALL_BRANCH);
    assert.equal(pr.state, 'open');
    assert.equal(await g(product, 'rev-parse', 'main'), main, 'main as setup left it, until the director merges');
    const taken = (await g(product, 'diff', '--name-only', `main...${UNINSTALL_BRANCH}`)).split('\n').sort();
    assert.deepEqual(taken, [...SETUP_FILES].sort());
    assert.notEqual(await lsRemote(product, `refs/heads/${STATE_BRANCH}`), '');
    const profile = host.url({ repo: `a-director/${PROFILE_REPO}` });
    assert.ok(host.has(`a-director/${PROFILE_REPO}`));
    assert.notEqual((await realRun('git', ['cat-file', '-e', `wheelhouse-profile:enrolments/${own.computer}.json`], { cwd: profile })).code, 0, 'this computer\'s key withdrawn');
    assert.ok(host.protected.has(REPO));

    // On this computer: the run closed, and the folder's session start says Wheelhouse was removed.
    assert.equal(runClosed(await a.setupRun()), true);
    assert.deepEqual(await a.sessionStart(), [REMOVED]);

    // The homes now, against before setup.
    const now = { home: listing(a.home), user: listing(a.user) };
    const home = differences(before.home, now.home);
    const user = differences(before.user, now.user);
    // Kept in Wheelhouse's home, as docs/data.md says: setup's journal and uninstall's record.
    const kept = (p) => p === 'setup' || p === 'setup/journal.json' || p === 'setup/uninstalls' || /^setup\/uninstalls\/[0-9a-f]+\.json$/.test(p);
    // Nothing else of Wheelhouse's is left (ruling R138): the signing key, the trusted-keys list and
    // this computer's id, the project's records and the gh setup fetched, and their folders, all gone.
    assert.deepEqual(home.added.filter((p) => !kept(p)), [], 'nothing else of Wheelhouse\'s is left');
    assert.deepEqual([...home.removed, ...home.changed], []);
    // In the user's home: the product's checkout of the repository the director kept, exactly as
    // committed on main (setup's commit with its three files, which the pull request takes out once
    // merged); Claude Code's own record and copy of the pinned kits it installed for the project;
    // and in the user settings the director's own retention, kept, with setup's other keys gone, and
    // the `env` setup made for them (ruling R138).
    const folder = 'Projects/Café Menu/';
    const checkout = (p) => p === `${folder}.git` || p.startsWith(`${folder}.git/`) || ['README.md', 'CLAUDE.md', '.claude/wheelhouse.json', '.claude/settings.json'].includes(p.slice(folder.length));
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
    assert.deepEqual(shims.calls(), [`gh pr close 12 --repo ${REPO}`]);
  } finally {
    await a.cleanup();
  }
});
