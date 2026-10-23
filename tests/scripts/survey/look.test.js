// tests/scripts/survey/look.test.js
// The survey (design section 15, ruling A1; plan rulings P1 and P2): what a project already holds,
// read and changed in nothing: work in flight, another agent setup's instructions, scheduled jobs
// and secret files, counted. Every part may be empty.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  INSTRUCTION_PATHS, instructionsOf, scheduledOf, secretFilesOf, inFlightOf, surveyOf,
} from '../../../scripts/survey/look.js';
import { setupGit } from '../../../scripts/setup/git.js';
import { makeBareRemote, g } from '../../helpers/git-fixture.js';
import { tempFolder } from '../../helpers/homes.js';

const lay = (folder, files) => {
  for (const [rel, text] of Object.entries(files)) {
    const file = path.join(folder, ...rel.split('/'));
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, text);
  }
};
const gitIn = (folder) => setupGit({ cwd: folder, workTree: folder });
const change = async (dir, file, words) => {
  fs.writeFileSync(path.join(dir, file), words);
  await g(dir, 'add', file);
  await g(dir, 'commit', '-q', '-m', words);
  return g(dir, 'rev-parse', 'HEAD');
};

const WORKFLOWS = {
  '.github/workflows/nightly.yml': [
    'name: Nightly',
    'on:',
    '  schedule:',
    '    - cron: "0 2 * * *"',
    '    # - cron: "0 3 * * *"',
    '    - cron: \'30 4 * * 1\'',
    '  push:',
    '    branches: [main]',
    'jobs:',
    '  build:',
    '    runs-on: ubuntu-latest',
    '    steps:',
    '      - run: echo "cron: not this one"',
  ].join('\n'),
  '.github/workflows/test.yaml': 'on:\n  push:\njobs:\n  test:\n    runs-on: ubuntu-latest\n',
  // A list at the same indent as its key is still inside it.
  '.github/workflows/early.yml': 'on:\n  schedule:\n  - cron: "0 1 * * *"\n  workflow_dispatch:\njobs:\n  a:\n    steps:\n    - cron: not a schedule\n',
  '.github/workflows/notes.txt': 'on:\n  schedule:\n    - cron: "0 0 * * *"\n',
  '.gitlab-ci.yml': [
    'stages: [test]',
    'workflow:',
    '  rules:',
    '    - if: $CI_PIPELINE_SOURCE == "schedule"',
    'clean-up:',
    '  script: ./clean.sh',
    '  rules:',
    '    - if: $CI_PIPELINE_SOURCE == "schedule"',
    'test:',
    '  script: npm test',
    '  only:',
    '    - merge_requests',
    'night:',
    '  script: ./night.sh',
    '  rules:',
    '  - if: $CI_PIPELINE_SOURCE == "schedule"',
    'review:',
    '  rules:',
    '  - if: $CI_PIPELINE_SOURCE == "merge_request_event"',
    '  script: echo schedule',
    '.hidden:',
    '  only:',
    '    - schedules',
  ].join('\n'),
};
const INSTRUCTIONS = {
  '.claude/skills/helper-skill/SKILL.md': '# Helper\n',
  '.claude/agents/writer.md': '# Writer\n',
  'AGENTS.md': '# Agents\n',
  '.wheelhouse-archive/AGENTS.md': '# Archived\n',
  'docs/AGENTS.md': '# Not at the top\n',
  'CLAUDE.md': [
    '# Project',
    '',
    '## Agents and delegation',
    'The lead agent hands work out.',
    '```md',
    '## Agents in a code block',
    '```',
    '## Style',
    '### Command centre',
  ].join('\n'),
};
const SECRETS = {
  '.env': 'A=1\n',
  'api/.env.local': 'B=2\n',
  '.env.example': 'A=\n',
  'node_modules/x/.env': 'C=3\n',
  'a/b/c/d/e/.env': 'too deep\n',
};

// A project in flight: a bare origin on main; a local line one commit ahead; a merged line; a
// worktree on a line of its own and a detached one, each a commit ahead; a pushed line with no
// request (also here, at the same place); a request's line, and one whose request has moved on
// since it was last fetched; Wheelhouse's own lines, and a feature line that isn't Wheelhouse's.
let project;
before(async () => {
  const remote = await makeBareRemote();
  const folder = tempFolder('wh-survey ');
  const dir = path.join(folder, 'menu');
  fs.mkdirSync(dir);
  await g(dir, 'init', '-q', '-b', 'main');
  await g(dir, 'remote', 'add', 'origin', remote.url);
  lay(dir, { ...WORKFLOWS, ...INSTRUCTIONS, ...SECRETS, '.gitignore': 'node_modules\n' });
  try {
    fs.symlinkSync(path.join(dir, 'AGENTS.md'), path.join(dir, '.cursorrules'), 'file');
  } catch { /* no links on this system: the test still holds */ }
  await g(dir, 'add', '-A');
  await g(dir, 'commit', '-q', '-m', 'Start');
  await g(dir, 'switch', '-q', '-c', 'old-work');
  await change(dir, 'old.txt', 'Old work');
  await g(dir, 'switch', '-q', 'main');
  await g(dir, 'merge', '-q', '--no-ff', '-m', 'Merge old work', 'old-work');
  await g(dir, 'push', '-q', 'origin', 'main');
  await g(dir, 'switch', '-q', '-c', 'tidy-menu');
  await change(dir, 'tidy.txt', 'Tidy the menu');
  await g(dir, 'switch', '-q', '-c', 'prices', 'main');
  await change(dir, 'prices.txt', 'Show prices');
  await g(dir, 'push', '-q', 'origin', 'prices');
  await g(dir, 'switch', '-q', '-c', 'request-line', 'main');
  const requestHead = await change(dir, 'request.txt', 'Add a request');
  await g(dir, 'push', '-q', 'origin', 'request-line');
  await g(dir, 'switch', '-q', '-c', 'stale-request', 'main');
  await change(dir, 'stale.txt', 'Older request');
  await g(dir, 'push', '-q', 'origin', 'stale-request');
  await g(dir, 'switch', '-q', '-c', 'feature/theirs', 'main');
  await change(dir, 'theirs.txt', 'Their feature');
  await g(dir, 'push', '-q', 'origin', 'feature/theirs');
  await g(dir, 'switch', '-q', '-c', 'feature/w-1', 'main');
  await change(dir, 'feature.txt', 'Own work');
  await g(dir, 'push', '-q', 'origin', 'feature/w-1');
  await g(dir, 'switch', '-q', '--orphan', 'wheelhouse-state');
  await change(dir, 'state.txt', 'State');
  await g(dir, 'push', '-q', 'origin', 'wheelhouse-state');
  await g(dir, 'switch', '-q', '-f', 'main');
  await g(dir, 'worktree', 'add', '-q', '-b', 'side-a', path.join(folder, 'wt-a'), 'main');
  await change(path.join(folder, 'wt-a'), 'a.txt', 'Side A');
  await g(dir, 'worktree', 'add', '-q', '--detach', path.join(folder, 'wt-b'), 'main');
  await change(path.join(folder, 'wt-b'), 'b.txt', 'Side B');
  project = { dir, folder, remote, requestHead };
});

const fakeAdapter = (requests) => ({ openRequests: async () => requests });
const REQUEST = (head) => ({ number: 7, title: 'Add a request', body: 'Adds one.', branch: 'request-line', head, draft: false, fork: false });
// The request on stale-request has moved on since the last fetch; one from someone's own copy has
// a line of the same name as one here, which is still the project's own.
const STALE = { number: 8, title: 'Older request', body: '', branch: 'stale-request', head: 'f'.repeat(40), draft: true, fork: false };
const FORK = { number: 9, title: 'From a copy', body: '', branch: 'prices', head: 'e'.repeat(40), draft: false, fork: true };
const OWN = ['feature/w-1'];

test('the places another agent setup keeps its instructions', () => {
  assert.deepEqual(INSTRUCTION_PATHS, [
    '.claude/skills/**', '.claude/agents/**', 'AGENTS.md', '.cursor/rules/**', '.cursorrules',
    '.github/copilot-instructions.md', '.windsurfrules',
  ]);
});

test('instructions are the files found there, never through a link, and the parts of CLAUDE.md that manage agents', () => {
  assert.deepEqual(instructionsOf(project.dir), {
    files: ['.claude/agents/writer.md', '.claude/skills/helper-skill/SKILL.md', 'AGENTS.md'],
    sections: [{ heading: 'Agents and delegation', line: 3 }, { heading: 'Command centre', line: 9 }],
  });
});

test('a linked folder is not gone into', () => {
  const folder = tempFolder('wh-survey-link ');
  const elsewhere = tempFolder('wh-survey-elsewhere ');
  lay(elsewhere, { 'agents/one.md': '# One\n' });
  try {
    fs.mkdirSync(path.join(folder, '.claude'));
    fs.symlinkSync(path.join(elsewhere, 'agents'), path.join(folder, '.claude', 'agents'), 'dir');
  } catch {
    return;
  }
  assert.deepEqual(instructionsOf(folder), { files: [], sections: [] });
});

test('at most 200 files are listed', () => {
  const folder = tempFolder('wh-survey-many ');
  lay(folder, Object.fromEntries(Array.from({ length: 230 }, (_, i) => [`.claude/agents/a${String(i).padStart(3, '0')}.md`, 'x'])));
  const { files } = instructionsOf(folder);
  assert.equal(files.length, 200);
  assert.equal(files[0], '.claude/agents/a000.md');
});

test('scheduled jobs are counted: cron lines under on.schedule, and GitLab jobs run on a schedule', () => {
  assert.equal(scheduledOf(project.dir), 5);
});

test('secret files are counted, leaving out examples, node_modules and anything deeper than four', () => {
  assert.equal(secretFilesOf(project.dir), 2);
});

test('work in flight: on this computer and pushed, leaving out the merged, the requests and Wheelhouse\'s own', async () => {
  const got = await inFlightOf(gitIn(project.dir), {
    defaultBranch: 'main', requestHeads: [project.requestHead], requestBranches: ['stale-request'], own: OWN,
  });
  const shape = (items) => items.map(({ name, commits, subject }) => ({ name, commits, subject }));
  assert.deepEqual(shape(got.pushed), [
    { name: 'feature/theirs', commits: 1, subject: 'Their feature' },
    { name: 'prices', commits: 1, subject: 'Show prices' },
  ]);
  assert.deepEqual(shape(got.local), [
    { name: 'side-a', commits: 1, subject: 'Side A' },
    { name: 'tidy-menu', commits: 1, subject: 'Tidy the menu' },
    { name: 'wt-b', commits: 1, subject: 'Side B' },
  ]);
  for (const item of [...got.pushed, ...got.local]) {
    assert.match(item.head, /^[0-9a-f]{40}$/);
    assert.ok(!Number.isNaN(Date.parse(item.at)));
  }
  assert.deepEqual(got.more, { pushed: false, local: false });
});

test('the survey gathers every part, changes nothing and gives the same twice', async () => {
  const before = await g(project.dir, 'for-each-ref', '--format=%(refname) %(objectname)');
  const status = await g(project.dir, 'status', '--porcelain');
  const args = {
    folder: project.dir, git: gitIn(project.dir), adapter: fakeAdapter([REQUEST(project.requestHead), STALE, FORK]), defaultBranch: 'main', rules: [], own: OWN,
  };
  const one = await surveyOf(args);
  assert.equal(one.v, 1);
  assert.equal(one.hostReached, true);
  assert.deepEqual(one.requests, [
    { number: 7, title: 'Add a request', draft: false }, { number: 8, title: 'Older request', draft: true }, { number: 9, title: 'From a copy', draft: false },
  ]);
  assert.deepEqual(one.pushed.map((i) => i.name), ['feature/theirs', 'prices']);
  assert.deepEqual(one.local.map((i) => i.name), ['side-a', 'tidy-menu', 'wt-b']);
  assert.equal(one.instructions.files.length, 3);
  assert.equal(one.scheduled, 5);
  assert.equal(one.secrets, 2);
  assert.deepEqual(one.rules, []);
  assert.deepEqual(one.more, { pushed: false, local: false });
  assert.deepEqual(await surveyOf(args), one);
  assert.equal(await g(project.dir, 'for-each-ref', '--format=%(refname) %(objectname)'), before);
  assert.equal(await g(project.dir, 'status', '--porcelain'), status);
});

test('a host that fails gives hostReached false and no requests, never a throw', async () => {
  const adapter = { openRequests: async () => { throw new Error('gh pr list did not answer in JSON'); } };
  const got = await surveyOf({ folder: project.dir, git: gitIn(project.dir), adapter, defaultBranch: 'main', rules: [], own: OWN });
  assert.equal(got.hostReached, false);
  assert.deepEqual(got.requests, []);
  // With no requests known, the requests' lines count as work pushed.
  assert.deepEqual(got.pushed.map((i) => i.name), ['feature/theirs', 'prices', 'request-line', 'stale-request']);
});

test('a host answering with things that aren\'t requests: those are left out, never a throw', async () => {
  const adapter = fakeAdapter([null, 5, 'seven', REQUEST(project.requestHead)]);
  const got = await surveyOf({ folder: project.dir, git: gitIn(project.dir), adapter, defaultBranch: 'main', own: OWN });
  assert.equal(got.hostReached, true);
  assert.deepEqual(got.requests, [{ number: 7, title: 'Add a request', draft: false }]);
});

// A small project of its own: origin on main and one commit here, off it.
async function small(prefix) {
  const remote = await makeBareRemote();
  const dir = tempFolder(prefix);
  await g(dir, 'init', '-q', '-b', 'main');
  await g(dir, 'remote', 'add', 'origin', remote.url);
  await change(dir, 'README.md', 'Start');
  await g(dir, 'push', '-q', 'origin', 'main');
  return dir;
}

test('the main folder on no line of its own, holding work off the main line, is one item', async () => {
  const dir = await small('wh-survey-detached ');
  await g(dir, 'switch', '-q', '--detach');
  await change(dir, 'loose.txt', 'Loose work');
  const got = await inFlightOf(gitIn(dir), { defaultBranch: 'main' });
  assert.deepEqual(got.local.map(({ name, commits, subject }) => ({ name, commits, subject })), [{ name: 'this folder', commits: 1, subject: 'Loose work' }]);
});

test('at most 200 lines are looked at in each place, and the survey says when there were more', async () => {
  const dir = await small('wh-survey-lots ');
  const head = await change(dir, 'more.txt', 'More work');
  await g(dir, 'switch', '-q', 'main');
  const lines = Array.from({ length: 205 }, (_, i) => `create refs/heads/b${String(i).padStart(3, '0')} ${head}`).join('\n');
  const { run } = await import('../../../scripts/lib/run.js');
  const made = await run('git', ['update-ref', '--stdin'], { cwd: dir, input: `${lines}\n` });
  assert.equal(made.code, 0);
  const got = await inFlightOf(gitIn(dir), { defaultBranch: 'main' });
  assert.ok(got.local.length <= 200);
  assert.equal(got.local[0].name, 'b000');
  assert.deepEqual(got.more, { pushed: false, local: true });
});

test('an empty project: every part empty', async () => {
  const remote = await makeBareRemote();
  const dir = tempFolder('wh-survey-empty ');
  await g(dir, 'init', '-q', '-b', 'main');
  await g(dir, 'remote', 'add', 'origin', remote.url);
  lay(dir, { 'README.md': '# Menu\n' });
  await g(dir, 'add', '-A');
  await g(dir, 'commit', '-q', '-m', 'Start');
  await g(dir, 'push', '-q', 'origin', 'main');
  const got = await surveyOf({ folder: dir, git: gitIn(dir), adapter: fakeAdapter([]), defaultBranch: 'main' });
  assert.deepEqual(got, {
    v: 1, hostReached: true, requests: [], pushed: [], local: [], more: { pushed: false, local: false },
    instructions: { files: [], sections: [] }, scheduled: 0, secrets: 0, rules: [],
  });
});
