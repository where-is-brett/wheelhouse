// tests/e2e/project-under-way.test.js
// Fitting around a project already under way, end to end (design section 15, "Fitting around a
// project already under way", rulings A1 to A9). A made-up project, cafe-menu, set up on a computer
// as tests/e2e/setup.test.js sets one up (tests/helpers/setup-e2e.js: a real helper on a socket,
// setup's ten real steps on a fake computer, a stand-in host of bare repositories), shaped like one
// in flight: an older agent setup's instructions, an open pull request on the host, two worktrees
// each one commit off the default branch, two scheduled workflows, and two secret files.
//
// Finishing setup records one survey with what it found and changes nothing in the folder or on
// the host; at Balanced it ends with the carry-on card and the first briefing leaves the in-flight
// line out, at Trusting the briefing says Wheelhouse is carrying it on; the instructions line is
// said once. Carrying the request on and archiving the instructions each give a ready-made change,
// work recorded from one is held until the director approves it, and the foreman then starts it on
// a line of its own, from the recorded commit. The host's tool is a stand-in found first on the
// PATH, answering the survey's two reads from the host's own records; nothing real is run.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  standInHost, makeClock, makeComputer, shimTools, shutOutGitConfig, follow, listing,
} from '../helpers/setup-e2e.js';
import { HOST_LABELS, WAYS, REAL_USERS } from '../../scripts/setup/host.js';
import { LIVE_DATA, PRODUCT } from '../../scripts/setup/questions.js';
import { READY, ARRIVED } from '../../scripts/setup/notify.js';
import { listEvents } from '../../scripts/state/events.js';
import { approveWorkLine, confirmLine } from '../../scripts/state/card-lines.js';
import { stateDir } from '../../scripts/lib/paths.js';
import { readSurveyAt } from '../../scripts/briefing/seen.js';
import { readReadyRecord } from '../../scripts/survey/ready-record.js';
import { carryOnCard, trustingLine, briefingLines } from '../../scripts/survey/words.js';
import { composeCard } from '../../scripts/cards/compose.js';
import { briefHash, featurePaths, parseBrief } from '../../scripts/feature/files.js';
import { main as frontDesk } from '../../scripts/frontdesk/cli.js';
import { main as foreman } from '../../scripts/foreman/act.js';
import { decide as promptRecord } from '../../scripts/hooks/prompt-record.js';
import { decide as boardContext } from '../../scripts/hooks/board-context.js';
import { branchOf } from '../../scripts/hooks/session-start.js';
import { g } from '../helpers/git-fixture.js';
import { tempFolder } from '../helpers/homes.js';
import { waitLongerOnTheHelper } from '../helpers/until.js';

waitLongerOnTheHelper();

// The session start and setup's ending find the helper at the director's own named pipe on
// Windows, which a test must never reach (as tests/e2e/setup.test.js).
const SKIP = process.platform === 'win32' ? 'setup\'s ending finds the helper at the user\'s own named pipe on Windows' : false;

const REPO = 'a-director/cafe-menu';
const SLUG = 'a-director__cafe-menu';
const REQUEST = 7;
const REQUEST_LINE = 'add-prices';
// The older agent setup's instructions, as the survey lists them.
const INSTRUCTIONS = ['.claude/agents/checker.md', '.claude/agents/writer.md', '.claude/skills/helper-skill/SKILL.md', 'AGENTS.md'];
const WORKFLOW = (cron) => `name: Nightly\non:\n  schedule:\n    - cron: '${cron}'\njobs:\n  check:\n    runs-on: ubuntu-latest\n    steps:\n      - run: echo checked\n`;
// The survey's reads of the host when setup finishes: the default branch and the open pull requests.
const SURVEY_CALLS = [
  `gh repo view ${REPO} --json defaultBranchRef`,
  `gh pr list --repo ${REPO} --state open --json number,title,body,headRefName,headRefOid,isDraft,isCrossRepository --limit 100`,
];

const ANSWERS = {
  join: 'unused', 'real-users': REAL_USERS.no, host: HOST_LABELS.github, connection: WAYS.quick,
  product: PRODUCT.readme, 'live-data': LIVE_DATA.no, 'phone-ready': READY.ready, 'push-arrived': ARRIVED.yes,
};
const byId = (id) => ANSWERS[Object.keys(ANSWERS).find((k) => id === k || id.startsWith(`${k}-`))];

let gitConfig;
before(() => {
  if (!SKIP) gitConfig = shutOutGitConfig();
});
after(() => gitConfig?.restore());

// The host with the director's repository on it, its open pull request's line pushed under both
// its own name and the host's pull ref; and the director's computer, whose folder is their
// checkout of it with two worktrees and two secret files. The stand-in `gh` on the PATH answers the
// survey's two reads from what is on the host. { host, a, shims, request, worktrees }.
async function underWay() {
  const clock = makeClock();
  // The stand-in `gh` is made once the request's head is known; the host reads its log through this.
  let shims = null;
  const host = standInHost({ shims: { calls: () => shims?.calls() ?? [] } });
  await host.seed(REPO, {
    'README.md': '# cafe-menu\n\ncafe-menu shows a small cafe\'s menu and prices online.\n',
    'AGENTS.md': 'Agents: the writer drafts each page and the checker reads it over.\n',
    '.claude/skills/helper-skill/SKILL.md': '---\nname: helper-skill\ndescription: Helps write menu pages.\n---\n\nWrite menu pages plainly.\n',
    '.claude/agents/writer.md': '---\nname: writer\ndescription: Drafts pages.\n---\n\nDraft the page asked for.\n',
    '.claude/agents/checker.md': '---\nname: checker\ndescription: Reads pages over.\n---\n\nRead the page over.\n',
    '.github/workflows/nightly.yml': WORKFLOW('0 2 * * *'),
    '.github/workflows/weekly.yml': WORKFLOW('0 3 * * 1'),
  });
  // The open pull request: one commit on its own line, which the host also keeps at its pull ref.
  const work = tempFolder('wh-request-');
  await g(work, 'clone', '-q', host.url({ repo: REPO }), '.');
  await g(work, 'checkout', '-q', '-b', REQUEST_LINE);
  fs.mkdirSync(path.join(work, 'menu'));
  fs.writeFileSync(path.join(work, 'menu', 'prices.md'), '# Prices\n\nFlat white: 4.50\n');
  await g(work, 'add', '-A');
  await g(work, 'commit', '-q', '-m', 'Add the prices page');
  const head = await g(work, 'rev-parse', 'HEAD');
  await g(work, 'push', '-q', 'origin', `${REQUEST_LINE}:refs/heads/${REQUEST_LINE}`, `${REQUEST_LINE}:refs/pull/${REQUEST}/head`);
  const request = { number: REQUEST, title: 'Add the prices page', body: 'Adds a page listing the prices.', branch: REQUEST_LINE, head, draft: false, fork: false };

  // The host's own adapter (the helper's, for carrying the request on) knows the request too.
  const plain = host.adapter;
  host.adapter = (repo) => ({
    ...plain(repo),
    openRequests: async () => [request],
    requestDetails: async () => ({ files: [{ path: 'menu/prices.md', additions: 3, deletions: 0 }], commits: ['Add the prices page'] }),
    pullRef: (n) => `refs/pull/${n}/head`,
  });
  // The stand-in `gh` answers the survey as GitHub would.
  shims = shimTools({
    answer: {
      gh: [
        { args: ['repo', 'view'], stdout: `${JSON.stringify({ defaultBranchRef: { name: 'main' } })}\n` },
        {
          args: ['pr', 'list'],
          stdout: `${JSON.stringify([{
            number: REQUEST, title: request.title, body: request.body, headRefName: REQUEST_LINE, headRefOid: head, isDraft: false, isCrossRepository: false,
          }])}\n`,
        },
      ],
    },
  });
  host.shims = shims;

  // The director's checkout: its origin the host's address, with the install line's settings
  // beside it; two pieces of unfinished work in worktrees, and two secret files.
  const a = makeComputer(host, clock, { name: 'cafe-menu' });
  await g(a.folder, 'init', '-q', '-b', 'main');
  await g(a.folder, 'remote', 'add', 'origin', host.url({ repo: REPO }));
  await g(a.folder, 'fetch', '-q', 'origin');
  await g(a.folder, 'reset', '-q', '--hard', 'origin/main');
  await g(a.folder, 'remote', 'set-url', 'origin', `https://github.com/${REPO}.git`);
  const trees = tempFolder('wh-trees-');
  const worktrees = {};
  for (const name of ['menu-photos', 'opening-hours']) {
    const dir = path.join(trees, name);
    await g(a.folder, 'worktree', 'add', '-q', '-b', name, dir, 'main');
    fs.writeFileSync(path.join(dir, `${name}.md`), `# ${name}\n\nNot finished.\n`);
    await g(dir, 'add', '-A');
    await g(dir, 'commit', '-q', '-m', `Start ${name}`);
    worktrees[name] = dir;
  }
  fs.writeFileSync(path.join(a.folder, '.env'), 'MENU_API_KEY=not-a-real-key\n');
  fs.writeFileSync(path.join(a.folder, '.env.local'), 'MENU_DEBUG=1\n');
  return { host, a, shims, request, worktrees };
}

// What must not change: the older setup's files, the workflows and the secret files in the folder;
// the worktrees, each line of work in the folder but main, and the host's lines but its main, the
// state's and setup's own trial line.
async function untouched({ host, a, worktrees }) {
  const files = Object.fromEntries([...INSTRUCTIONS, '.github/workflows/nightly.yml', '.github/workflows/weekly.yml', '.env', '.env.local']
    .map((f) => [f, fs.existsSync(path.join(a.folder, f)) ? fs.readFileSync(path.join(a.folder, f), 'utf8') : null]));
  const trees = Object.fromEntries(Object.entries(worktrees).map(([name, dir]) => [name, listing(dir)]));
  const lines = (await g(a.folder, 'for-each-ref', '--format=%(refname) %(objectname)', 'refs/heads/')).split('\n').filter((l) => !l.startsWith('refs/heads/main '));
  const worktreeList = await g(a.folder, 'worktree', 'list', '--porcelain');
  const onHost = (await g(host.url({ repo: REPO }), 'for-each-ref', '--format=%(refname) %(objectname)', `refs/heads/${REQUEST_LINE}`, 'refs/pull/'));
  // Each worktree but the main folder's, whose main line setup moves on.
  const others = worktreeList.split('\n\n').filter((block) => !block.startsWith(`worktree ${a.folder}\n`));
  return { files, trees, lines, worktrees: others, onHost };
}

const eventsOf = (a, kind) => a.act(() => listEvents(stateDir(SLUG), { report: () => {} }).filter((e) => e.kind === kind));

// The director's click on a card, as Claude Code sends it to the prompt-record hook.
const click = (a, { question, options, label }) => a.act(async () => {
  const questions = [{ question, header: 'Wheelhouse', multiSelect: false, options: options.map((o) => ({ label: o, description: o })) }];
  await promptRecord({
    session_id: a.session, cwd: a.folder, permission_mode: 'default', hook_event_name: 'PostToolUse', tool_name: 'AskUserQuestion',
    tool_input: { questions, answers: { [question]: label } }, tool_response: { questions, answers: { [question]: label } }, tool_use_id: 'toolu_1',
  }, { client: a.client, now: a.clock.now, dir: a.managedDir });
  a.clock.tick();
});

// The front desk's command, scripts/frontdesk/cli.js, in the product folder: its JSON answer.
const desk = (a, ...argv) => a.act(async () => {
  let out = '';
  let err = '';
  const code = await frontDesk(argv, { client: a.client, cwd: a.folder, now: a.clock.now, out: (t) => { out += t; }, err: (t) => { err += t; } });
  if (code !== 0) throw new Error(`frontdesk cli.js ${argv.join(' ')}: ${err.trim()}`);
  return JSON.parse(out);
});

// The foreman's start, as the helper runs act.js for the project, with a stand-in waker.
const START = (work) => ['start', work, '--goal', 'Carry the prices page on', '--done', 'The prices page shows every price', '--appetite-sessions', '1', '--appetite-tokens', '200000'];
const startFor = (a, work) => a.act(async () => {
  const said = { out: '', err: '' };
  const starts = [];
  const wakerFor = () => ({ startFeature: async ({ worktree }) => { starts.push(worktree); return { printed: true }; } });
  const code = await foreman(START(work), {
    project: SLUG, client: a.client, now: a.clock.now, wakerFor, out: (t) => { said.out += t; }, err: (t) => { said.err += t; },
  });
  return { code, starts, ...said };
});

// A briefing asked for by the director after setup, as the board-context hook gives it.
const briefingNow = (a) => a.act(async () => {
  const got = await boardContext({ session_id: a.session, cwd: a.folder, hook_event_name: 'UserPromptSubmit', prompt: '/wheelhouse:briefing' }, {
    now: a.clock.now, env: {}, client: a.client, dir: a.managedDir,
  });
  return String(got?.hookSpecificOutput?.additionalContext ?? '');
});

test('a project under way at Balanced: one survey, nothing changed, the carry-on card, then carrying on and archiving from ready-made changes', { skip: SKIP }, async () => {
  const world = await underWay();
  const { host, a, shims, request } = world;
  try {
    const before = await untouched(world);
    await a.start();
    await a.sessionStart();
    const log = await follow(a, { answer: (id) => byId(id) });
    const { health } = log.at(-1);
    assert.equal(health.green, true, health.lines.join('\n'));

    // One survey, with what the project holds: the open request, the two worktrees' work, the
    // four instruction files, two scheduled workflows and two secret files.
    const surveys = await eventsOf(a, 'survey');
    assert.equal(surveys.length, 1);
    const survey = surveys[0].data;
    assert.equal(survey.hostReached, true);
    assert.deepEqual(survey.requests, [{ number: REQUEST, title: request.title, draft: false }]);
    assert.deepEqual(survey.pushed, []);
    assert.deepEqual(survey.local.map((i) => [i.name, i.commits]).sort(), [['menu-photos', 1], ['opening-hours', 1]]);
    assert.deepEqual(survey.instructions.files, INSTRUCTIONS);
    assert.equal(survey.scheduled, 2);
    assert.equal(survey.secrets, 2);

    // Nothing in the folder or on the host changed: the host's tool was asked only setup's own
    // trial close and the survey's two reads; no close, delete or push of the director's work.
    assert.deepEqual(await untouched(world), before);
    assert.deepEqual(shims.calls(), [`gh pr close 12 --repo ${REPO}`, ...SURVEY_CALLS]);
    assert.deepEqual(a.refused, []);
    assert.deepEqual(host.pulls().map(([n, pr]) => [n, pr.state]), [[12, 'closed']]);

    // At Balanced, setup ends with the carry-on card, recorded as the front desk records a card,
    // and the first briefing leaves the in-flight line out but says the instructions line.
    const expected = composeCard(carryOnCard(survey, { project: 'cafe-menu', host: 'github' }));
    assert.deepEqual(health.card.question, expected.question);
    assert.deepEqual(health.card.question.options.map((o) => o.label), ['Carry on with it', 'Leave it for now']);
    assert.match(health.card.question.question, /^Wheelhouse found work already under way in cafe-menu: 1 change waiting to be merged on GitHub, and 2 pieces of unfinished work on this computer\. Shall I carry them on\?/);
    const cards = await eventsOf(a, 'card');
    assert.ok(cards.some((e) => e.id === health.card.id), 'the card is in the state');
    const asked = await eventsOf(a, 'asked');
    assert.ok(asked.some((e) => e.data.cards.includes(health.card.id)), 'and marked as asked');
    const [instructionsLine] = briefingLines(survey, { host: 'github', leave: ['inFlight'] });
    assert.match(instructionsLine, /^This project also has instructions for another agent setup \(AGENTS\.md and 3 more files\)\. Mine come first where they differ\./);
    assert.equal(health.briefing.split(instructionsLine).length, 2, health.briefing);
    assert.doesNotMatch(health.briefing, /Already under way here/);
    assert.equal(await a.act(() => readSurveyAt(SLUG)), surveys[0].id);
    // The instructions line once: the next briefing doesn't say it again.
    a.clock.tick(3 * 60 * 60 * 1000);
    const later = await briefingNow(a);
    assert.ok(later.length > 0);
    assert.ok(!later.includes(instructionsLine), later);

    // Carrying the request on: a ready-made change whose ref and ready record name its head.
    const carried = await desk(a, 'carry-on', String(REQUEST));
    assert.equal(carried.work, `carry-on-${REQUEST}`, JSON.stringify(carried));
    assert.deepEqual(carried.from, { sha: request.head, ref: `refs/wheelhouse/from/${carried.work}`, request: REQUEST });
    assert.equal(await g(a.folder, 'rev-parse', carried.from.ref), request.head);
    assert.deepEqual(await a.act(() => readReadyRecord(SLUG, carried.work)), { ...carried.from, branch: REQUEST_LINE });

    // Archiving: a ready-made change on the default branch moving exactly the four files.
    const archived = await desk(a, 'archive');
    assert.equal(typeof archived.work, 'string', JSON.stringify(archived));
    assert.deepEqual(archived.moved, INSTRUCTIONS);
    assert.deepEqual(JSON.parse(await g(a.folder, 'show', `${archived.from.sha}:.wheelhouse-archive/archived.json`)).moved,
      INSTRUCTIONS.map((f) => ({ from: f, to: `.wheelhouse-archive/${f}` })));
    const parent = await g(a.folder, 'rev-parse', `${archived.from.sha}^`);
    assert.equal(parent, await g(host.url({ repo: REPO }), 'rev-parse', 'main'));
    const changed = (await g(a.folder, 'diff-tree', '--no-commit-id', '--name-status', '-r', '--no-renames', parent, archived.from.sha)).split('\n').sort();
    assert.deepEqual(changed, [
      ...INSTRUCTIONS.map((f) => `D\t${f}`),
      ...INSTRUCTIONS.map((f) => `A\t.wheelhouse-archive/${f}`),
      'A\t.wheelhouse-archive/README.md',
      'A\t.wheelhouse-archive/archived.json',
    ].sort());
    // Still nothing of the director's moved, in the folder or on the host.
    assert.deepEqual(await untouched(world), before);

    // Work recorded from the carried change, shown to the director first, is held until approved.
    const doc = `docs/work/${carried.work}.md`;
    const text = `# Carry on the prices page\n\nCarries on #${REQUEST}: the prices page.\n`;
    fs.mkdirSync(path.join(a.folder, 'docs', 'work'), { recursive: true });
    fs.writeFileSync(path.join(a.folder, doc), text);
    const hash = briefHash(text);
    const recorded = await a.act(() => a.client.state.write({
      cwd: a.folder, kind: 'work',
      data: { id: carried.work, title: 'Carry on the prices page', lane: 'small', visible: true, dependsOn: [], doc: { path: doc, hash }, from: carried.from },
    }));
    assert.equal(recorded.ok, true, JSON.stringify(recorded));
    const held = await startFor(a, carried.work);
    assert.equal(held.code, 1, held.out);
    assert.equal(held.err, `${carried.work} can't start: not approved yet\n`);
    assert.equal(fs.existsSync(path.join(a.folder, '.claude', 'worktrees', carried.work)), false);

    // Once approved, the foreman makes feature/<work> from the recorded commit.
    await click(a, { question: approveWorkLine(carried.work, 'small', hash), options: ['Approve', 'Not yet'], label: 'Approve' });
    const started = await startFor(a, carried.work);
    assert.equal(started.code, 0, started.err);
    const wt = path.join(a.folder, '.claude', 'worktrees', carried.work);
    assert.equal(branchOf(wt), `feature/${carried.work}`);
    assert.equal(await g(wt, 'rev-parse', 'HEAD'), request.head);
    assert.deepEqual(parseBrief(fs.readFileSync(featurePaths(wt).brief, 'utf8')).fields.from, carried.from);
    assert.deepEqual(started.starts, [wt]);

    // And still nothing pushed to, closed or deleted on the host: the request's own line as it was.
    assert.deepEqual((await untouched(world)).onHost, before.onHost);
    assert.deepEqual(shims.calls(), [`gh pr close 12 --repo ${REPO}`, ...SURVEY_CALLS]);
    assert.deepEqual(a.refused, []);
  } finally {
    await a.cleanup();
    shims.restore();
  }
});

test('a project under way at Trusting: no card, and the first briefing says Wheelhouse is carrying the work on', { skip: SKIP }, async () => {
  const world = await underWay();
  const { a, shims } = world;
  try {
    const before = await untouched(world);
    await a.start();
    await a.sessionStart();
    await follow(a, { answer: (id) => byId(id), through: 9 });
    // The director chose Trusting before setup finished: a setting confirmed by their click.
    const wrote = await a.act(() => a.client.state.write({ cwd: a.folder, kind: 'setting', data: { key: 'autonomy', value: 'trusting', words: 'Let Wheelhouse get on with things' } }));
    assert.equal(wrote.ok, true, JSON.stringify(wrote));
    const [setting] = (await eventsOf(a, 'setting')).filter((e) => e.id === wrote.id);
    await click(a, { question: `${confirmLine(setting)}?`, options: ['Confirm', 'Not now'], label: 'Confirm' });
    const log = await follow(a, { answer: (id) => byId(id) });
    const { health } = log.at(-1);
    assert.equal(health.green, true, health.lines.join('\n'));

    const surveys = await eventsOf(a, 'survey');
    assert.equal(surveys.length, 1);
    const survey = surveys[0].data;
    assert.equal(health.card, undefined);
    assert.deepEqual((await eventsOf(a, 'card')).filter((e) => e.data.topic === 'under-way'), []);
    // The trustingLine's words, as the briefing's plain-words layer gives them.
    assert.equal(trustingLine(survey, { host: 'github' }), 'Already under way here: 1 change waiting to be merged on GitHub, and 2 pieces of unfinished work on this computer. I\'m carrying them on, one brief each; say stop if you\'d rather I didn\'t.');
    assert.match(health.briefing, /^- Already under way here: 1 change waiting to be (?:merged|combined) on GitHub, and 2 pieces of unfinished work on this computer\. I'm carrying them on, one brief each; say stop if you'd rather I didn't\.$/m);
    assert.doesNotMatch(health.briefing, /Say if you'd like me to carry/);
    const [instructionsLine] = briefingLines(survey, { host: 'github', leave: ['inFlight'] });
    assert.equal(health.briefing.split(instructionsLine).length, 2, 'the instructions line once');

    assert.deepEqual(await untouched(world), before);
    assert.deepEqual(shims.calls(), [`gh pr close 12 --repo ${REPO}`, ...SURVEY_CALLS]);
    assert.deepEqual(a.refused, []);
  } finally {
    await a.cleanup();
    shims.restore();
  }
});
