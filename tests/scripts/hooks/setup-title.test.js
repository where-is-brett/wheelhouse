// tests/scripts/hooks/setup-title.test.js
// A session that began as setup gives its bar the First Mate's title once setup has finished, and a session never titled Setup keeps its own.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { markSetupTitled, takeSetupTitled } from '../../../scripts/lib/setup-title.js';
import { decide } from '../../../scripts/hooks/board-context.js';
import { writeProject } from '../../../scripts/lib/projects.js';
import { as, shortHome } from '../../helpers/homes.js';

const P = 'owner__name';

test('a mark is made for a session, taken away once, and refused for an unsafe id', async () => {
  await as(shortHome(), async () => {
    assert.equal(takeSetupTitled('s-1'), false);
    assert.equal(markSetupTitled('s-1'), true);
    assert.equal(takeSetupTitled('s-1'), true);
    assert.equal(takeSetupTitled('s-1'), false, 'taken away');
    assert.equal(markSetupTitled('../escape'), false);
    assert.equal(markSetupTitled(undefined), false);
  });
});

test('the first message after setup retitles a session that was titled Setup, once, and no other', async () => {
  const home = shortHome();
  await as(home, async () => {
    const repo = path.join(home, 'repo');
    fs.mkdirSync(path.join(repo, '.git'), { recursive: true });
    fs.writeFileSync(path.join(repo, '.git', 'HEAD'), 'ref: refs/heads/main\n');
    writeProject(P, { folder: repo, remoteUrl: 'https://example.com/owner/name.git', host: 'github', repo: 'owner/name', connection: {} });
    const ask = (session) => decide({ cwd: repo, prompt: 'hello', session_id: session, hook_event_name: 'UserPromptSubmit' }, { now: () => new Date('2026-11-24T00:00:00.000Z'), waitMs: 50, learnWaitMs: 50 });
    markSetupTitled('s-setup');
    const first = await ask('s-setup');
    assert.equal(first?.hookSpecificOutput?.sessionTitle, 'Wheelhouse · First Mate');
    assert.equal((await ask('s-setup'))?.hookSpecificOutput?.sessionTitle, undefined, 'once');
    assert.equal((await ask('s-other'))?.hookSpecificOutput?.sessionTitle, undefined, 'a session never titled Setup keeps its own');
  });
});
