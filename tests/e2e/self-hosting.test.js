// tests/e2e/self-hosting.test.js
// Wheelhouse set up on its own repository (docs/research/self-hosting-2026-10.md). The folder is
// a copy of this repository's own committed tree, as the director's checkout of it would be: its
// own CLAUDE.md, .claude/wheelhouse.json and plugin files, a change not yet committed, other
// lines of work, worktrees that Claude Desktop keeps under .claude/worktrees/, and a pull request
// open on the host. Setup's ten real steps run against a stand-in host (tests/helpers/setup-e2e.js),
// on a fake computer, with nothing real reached.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  standInHost, makeClock, makeComputer, shimTools, shutOutGitConfig, follow,
} from '../helpers/setup-e2e.js';
import { HOST_LABELS, WAYS, REAL_USERS, notPrivate, NOT_PRIVATE } from '../../scripts/setup/host.js';
import { LIVE_DATA, PRODUCT } from '../../scripts/setup/questions.js';
import { READY, ARRIVED } from '../../scripts/setup/notify.js';
import { listEvents } from '../../scripts/state/events.js';
import { stateDir } from '../../scripts/lib/paths.js';
import { classifyChange, readConfig } from '../../scripts/gate/guardrails.js';
import { g } from '../helpers/git-fixture.js';
import { waitLongerOnTheHelper } from '../helpers/until.js';

waitLongerOnTheHelper();

const SKIP = process.platform === 'win32' ? 'setup\'s ending finds the helper at the user\'s own named pipe on Windows' : false;

const REPO = 'a-director/wheelhouse';
const SLUG = 'a-director__wheelhouse';
const ROOT = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));

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

// This repository's committed tree at HEAD, as { path: contents }, less the files git keeps as links.
// Each file is read from the commit, never the working copy, so changes not yet committed don't count.
function ownTree() {
  const git = (args) => execFileSync('git', args, { cwd: ROOT, maxBuffer: 256 * 1024 * 1024 });
  const listed = git(['ls-tree', '-r', '-z', 'HEAD']).toString('utf8');
  const files = {};
  for (const entry of listed.split('\0').filter(Boolean)) {
    const [meta, file] = entry.split('\t');
    const [mode, , blob] = meta.split(' ');
    if (!mode.startsWith('100')) continue;
    files[file] = git(['cat-file', 'blob', blob]);
  }
  return files;
}

async function selfHosted() {
  const clock = makeClock();
  let shims = null;
  const host = standInHost({ shims: { calls: () => shims?.calls() ?? [] } });
  await host.seed(REPO, ownTree());
  shims = shimTools({
    answer: {
      gh: [
        { args: ['repo', 'view'], stdout: `${JSON.stringify({ defaultBranchRef: { name: 'main' } })}\n` },
        { args: ['pr', 'list'], stdout: '[]\n' },
      ],
    },
  });
  host.shims = shims;
  const a = makeComputer(host, clock, { name: 'wheelhouse' });
  await g(a.folder, 'init', '-q', '-b', 'main');
  await g(a.folder, 'remote', 'add', 'origin', host.url({ repo: REPO }));
  await g(a.folder, 'fetch', '-q', 'origin');
  await g(a.folder, 'reset', '-q', '--hard', 'origin/main');
  await g(a.folder, 'remote', 'set-url', 'origin', `https://github.com/${REPO}.git`);
  // Claude Desktop's worktrees, inside the folder, kept out of git by the folder's own exclude list.
  fs.appendFileSync(path.join(a.folder, '.git', 'info', 'exclude'), '.superpowers/\n.claude/worktrees/\n');
  const worktrees = {};
  for (const name of ['mac-sitting-3', 'front-desk-model']) {
    const dir = path.join(a.folder, '.claude', 'worktrees', name);
    await g(a.folder, 'worktree', 'add', '-q', '-b', `feature/${name}`, dir, 'main');
    fs.writeFileSync(path.join(dir, `${name}.md`), `<!-- ${name}.md -->\n\nNot finished.\n`);
    await g(dir, 'add', '-A');
    await g(dir, 'commit', '-q', '-m', `Start ${name}`);
    worktrees[name] = dir;
  }
  // Lines of work with no worktree, and a change not yet committed in the main folder.
  for (const name of ['fix/one', 'fix/two', 'claude/old-session']) await g(a.folder, 'branch', name, 'main');
  fs.appendFileSync(path.join(a.folder, 'HANDOVER.md'), '\nA note not yet committed.\n');
  return { host, a, shims, worktrees };
}

const eventsOf = (a, kind) => a.act(() => listEvents(stateDir(SLUG), { report: () => {} }).filter((e) => e.kind === kind));

test('on a public repository setup stops at step 3, before anything of Wheelhouse\'s goes up', { skip: SKIP }, async () => {
  const { host, a } = await selfHosted();
  host.public.add(REPO);
  try {
    await a.start();
    await a.sessionStart();
    // The one card's Go ahead, steps 1 and 2; then step 3 puts the public repository to the director
    // on a card of its own, which the Go ahead never covers (design section 15.1).
    await follow(a, { answer: (id) => byId(id), through: 2 });
    const asked = (await a.cli('resume')).plan;
    assert.equal(asked.step, 3);
    assert.equal(asked.ask.id, 'not-private-0');
    assert.match(asked.ask.card.question, new RegExp(`^${REPO} on GitHub is not private, so Wheelhouse can't set it up yet\\.`));
    // Still public after "I've made it private": asked again. Then Stop setup here: it holds at step 3.
    await a.click(asked.ask.card, NOT_PRIVATE.again);
    const again = (await a.cli('resume')).plan;
    assert.equal(again.ask.id, 'not-private-1');
    await a.click(again.ask.card, NOT_PRIVATE.stop);
    const held = (await a.cli('resume')).plan;
    assert.equal(held.step, 3);
    assert.equal(held.waitsFor, undefined);
    assert.ok(held.why.startsWith(notPrivate({ host: 'github', repo: REPO })), held.why);
    assert.equal((await a.setupRun()).steps[3]?.doneAt, undefined, 'step 3 holds');
    assert.deepEqual((await a.setupRun()).changes.filter((c) => c.step === 3), [], 'nothing of step 3 made');
    assert.equal(await host.tip(REPO, 'refs/heads/wheelhouse-state'), null, 'no state branch on the public repository');
    assert.equal(await host.tip(REPO, 'refs/heads/wheelhouse-lock'), null, 'and no lock branch');
    assert.equal(await a.act(() => fs.existsSync(path.join(stateDir(SLUG), '.git'))), false);
  } finally {
    await a.cleanup();
  }
});

test('on a private copy setup finishes, leaves the work in flight as it is, and the plugin\'s safety code is a guardrail', { skip: SKIP }, async () => {
  const { host, a, worktrees } = await selfHosted();
  try {
    const trees = Object.fromEntries(await Promise.all(Object.entries(worktrees).map(async ([name, dir]) => [name, await g(dir, 'rev-parse', 'HEAD')])));
    await a.start();
    await a.sessionStart();
    const log = await follow(a, { answer: (id) => byId(id) });
    const { health } = log.at(-1);
    assert.equal(health.green, true, health.lines.join('\n'));
    assert.deepEqual(a.refused, []);

    // The work in flight: the change not yet committed, the worktrees and the other lines, as they were.
    assert.equal(await g(a.folder, 'status', '--porcelain', '--', 'HANDOVER.md'), 'M HANDOVER.md');
    for (const [name, dir] of Object.entries(worktrees)) assert.equal(await g(dir, 'rev-parse', 'HEAD'), trees[name], name);
    const [survey] = await eventsOf(a, 'survey');
    assert.deepEqual(survey.data.local.map((i) => i.name).sort(), ['feature/front-desk-model', 'feature/mac-sitting-3']);

    // The setup commit kept the repository's own configuration, critical areas and all, and the
    // gate reads it from the default branch, where the plugin's manifest makes its parts guardrails.
    const committed = readConfig(await g(host.url({ repo: REPO }), 'show', 'main:.claude/wheelhouse.json'));
    assert.deepEqual(committed.criticalAreas.map((c) => c.name), ['lineage', 'safety checks']);
    const config = { ...committed, plugin: true };
    for (const file of ['scripts/hooks/tool-guard.js', 'hooks/hooks.json', 'skills/setup/SKILL.md', 'agents/builder.md', 'CLAUDE.md']) {
      assert.equal(classifyChange({ paths: [file], config }).touchesGuardrails, true, file);
    }
    assert.equal(classifyChange({ paths: ['docs/research/x.md'], config }).touchesGuardrails, false);
    // CLAUDE.md keeps the repository's own rules, with setup's section added.
    const claude = await g(host.url({ repo: REPO }), 'show', 'main:CLAUDE.md');
    assert.match(claude, /A session started by hand starts by reading `HANDOVER.md`/);
    assert.match(claude, /Compact instructions/);
  } finally {
    await a.cleanup();
  }
});
