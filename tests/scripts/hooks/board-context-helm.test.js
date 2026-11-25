// tests/scripts/hooks/board-context-helm.test.js
// The prompt hook in a Desktop builder's row (builders and settings design, section 7.4): the first prompt adopts the worktree, a
// prompt the director types takes the helm, and the foreman's own wake message doesn't.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { decide } from '../../../scripts/hooks/board-context.js';
import { writeProject } from '../../../scripts/lib/projects.js';
import { markSeen } from '../../../scripts/briefing/seen.js';
import { wheelhouseHome } from '../../../scripts/lib/paths.js';
import { helmHeld } from '../../../scripts/crew/hold.js';
import { builderStart } from '../../../scripts/foreman/desktop-start.js';
import { desktopFindings } from '../../../scripts/foreman/desktop-findings.js';
import { readBuilder } from '../../../scripts/foreman/desktop-builders.js';
import { openTestRecord } from '../../helpers/record-fixture.js';
import { inHome, P } from '../../helpers/decisions-world.js';

const NOW = new Date('2026-11-25T12:00:00.000Z');
const put = (file, value) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, typeof value === 'string' ? value : JSON.stringify(value));
};
const client = { health: async () => ({ ok: true }), lock: { read: async () => ({ ok: true, result: null }) } };

function setUp(home) {
  const repo = path.join(home, 'repo');
  put(path.join(repo, '.git', 'HEAD'), 'ref: refs/heads/main\n');
  writeProject(P, { folder: repo, remoteUrl: 'https://example.com/owner/harbour-demo.git', host: 'github', repo: 'owner/harbour-demo', connection: {} });
  const views = path.join(wheelhouseHome(), 'projects', P, 'views');
  for (const f of ['waiting', 'features', 'reports']) put(path.join(views, `${f}.json`), f === 'waiting' ? [] : {});
  put(path.join(views, 'work.json'), {});
  markSeen(P, { promptAt: new Date('2026-11-25T11:59:00.000Z') });
  // A linked worktree Desktop made, outside Wheelhouse's own worktrees folder.
  const tree = fs.realpathSync.native(fs.mkdtempSync(path.join(home, 'row-')));
  const gitdir = path.join(repo, '.git', 'worktrees', 'row');
  put(path.join(gitdir, 'HEAD'), 'ref: refs/heads/claude/alpha\n');
  put(path.join(gitdir, 'commondir'), '../..\n');
  put(path.join(tree, '.git'), `gitdir: ${gitdir}\n`);
  const wakes = path.join(tree, '.wheelhouse', 'feature', 'wakes');
  put(path.join(wakes, 'wake-1.json'), '{}\n');
  return { repo, tree, wake: path.join(wakes, 'wake-1.json') };
}
const say = (tree, session, prompt) => decide({ cwd: tree, session_id: session, hook_event_name: 'UserPromptSubmit', prompt }, { now: () => NOW, env: {}, client });
const START = builderStart({ project: P, work: 'alpha', title: 'Alpha', brief: 'The brief.\n', findings: desktopFindings() }).prompt;
const SESSION = 'dddddddd-1111-2222-3333-444444444444';

test('the first prompt adopts the worktree and takes no helm; the foreman\'s wake message takes none; the director\'s words take it', async () => {
  await inHome(async (home) => {
    await openTestRecord({ project: P });
    const { tree, wake } = setUp(home);
    await say(tree, SESSION, START);
    assert.equal(readBuilder(P, 'alpha')?.sessionId, SESSION, 'adopted');
    assert.equal(helmHeld(P, 'alpha'), false, 'the start is the foreman\'s');
    await say(tree, SESSION, `Wheelhouse: read ${wake}`);
    assert.equal(helmHeld(P, 'alpha'), false, 'the foreman\'s message is not the helm');
    await say(tree, SESSION, 'Please use the blue one instead.');
    assert.equal(helmHeld(P, 'alpha'), true, 'the director took the helm by typing');
  });
});

test('a prompt in a session that is no Desktop builder takes no helm', async () => {
  await inHome(async (home) => {
    await openTestRecord({ project: P });
    const { tree } = setUp(home);
    await say(tree, SESSION, START);
    await say(tree, 'eeeeeeee-1111-2222-3333-444444444444', 'Hello from another session in the same folder.');
    assert.equal(helmHeld(P, 'alpha'), false);
  });
});
