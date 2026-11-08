// tests/scripts/hooks/board-context-digest.test.js
// The daily digest the watcher made waits for the director's next message in the front desk, is shown there once, and answers
// nothing. Made-up project: harbour-demo.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { decide } from '../../../scripts/hooks/board-context.js';
import { writeProject } from '../../../scripts/lib/projects.js';
import { recordRole } from '../../../scripts/lib/role.js';
import { markSeen, readDigestSeen } from '../../../scripts/briefing/seen.js';
import { writeDigest, readDigest } from '../../../scripts/digest/due.js';
import { wheelhouseHome } from '../../../scripts/lib/paths.js';
import { listEvents } from '../../../scripts/state/events.js';
import { stateDir } from '../../../scripts/lib/paths.js';
import { inHome, P, raise } from '../../helpers/decisions-world.js';

const NOW = '2026-11-08T12:00:00.000Z';
const at = (iso) => () => new Date(iso);
const put = (file, value) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, typeof value === 'string' ? value : JSON.stringify(value));
};
const DIGEST = 'Daily digest, 7 November 2026\n\nMerged by itself\n- Pull request #12: Rename the tide table (no change users see)\n\nFinished and waiting for your approval\nNothing.\n\nWaiting on your decisions\nNothing.\n\nUsage this week: 1.2M tokens.';

function register(home) {
  const repo = path.join(home, 'repo');
  put(path.join(repo, '.git', 'HEAD'), 'ref: refs/heads/main\n');
  writeProject(P, { folder: repo, remoteUrl: 'https://example.com/owner/harbour-demo.git', host: 'github', repo: 'owner/harbour-demo', connection: {} });
  put(path.join(wheelhouseHome(), 'projects', P, 'views', 'waiting.json'), []);
  markSeen(P, { promptAt: new Date('2026-11-08T11:59:00.000Z') });
  return repo;
}

const client = { health: async () => ({ ok: true }), lock: { read: async () => ({ ok: true, result: null }) } };
const ask = (repo, text, { session = 's-desk', ...deps } = {}) => decide({ cwd: repo, session_id: session, hook_event_name: 'UserPromptSubmit', prompt: text }, { now: at(NOW), env: {}, client, ...deps });
const answersRecorded = () => listEvents(stateDir(P), { report: () => {} }).filter((e) => e.kind === 'decision-answer' || e.kind === 'action');
const contextOf = (out) => out?.hookSpecificOutput?.additionalContext;

test('the digest shows once, at the director\'s next message', async () => {
  await inHome(async (home) => {
    const repo = register(home);
    assert.equal(await ask(repo, 'Hello'), undefined, 'nothing waits, nothing is added');
    writeDigest(P, { at: '2026-11-07T17:00:05.000Z', text: DIGEST });
    const first = contextOf(await ask(repo, 'What is going on?'));
    assert.ok(first.includes(DIGEST), first);
    // It is taken away, and the time it was shown is kept, so the next digest starts from there.
    assert.equal(readDigest(P), null);
    assert.equal(readDigestSeen(P, { now: at(NOW) }).digestShownAt, NOW);
    assert.equal(await ask(repo, 'And now?'), undefined);
  });
});

test('a waiting digest comes with the decisions waiting, and answers none of them', async () => {
  await inHome(async (home) => {
    const repo = register(home);
    raise('How often should the digest go out?', '2026-11-08T01:00:00.000Z');
    writeDigest(P, { at: '2026-11-07T17:00:05.000Z', text: DIGEST });
    const text = contextOf(await ask(repo, 'Looks fine, thanks'));
    assert.ok(text.includes(DIGEST));
    assert.match(text, /Decisions waiting for the director: 1\. How often should the digest go out\?\./);
    assert.ok(text.indexOf('Decisions waiting') < text.indexOf('Daily digest'), 'the decisions line comes first');
    assert.deepEqual(answersRecorded(), [], 'nothing was recorded as an answer');
  });
});

test('a hook that only reads, and a session that is not the front desk, leave the digest waiting', async () => {
  await inHome(async (home) => {
    const repo = register(home);
    writeDigest(P, { at: '2026-11-07T17:00:05.000Z', text: DIGEST });
    assert.equal(await ask(repo, 'Hello', { writeVia: 'helper' }), undefined);
    assert.notEqual(readDigest(P), null);
    recordRole('s-feature', 'feature');
    assert.equal(await ask(repo, 'Hello', { session: 's-feature' }), undefined);
    assert.notEqual(readDigest(P), null);
    // The front desk's next message does show it.
    assert.ok(contextOf(await ask(repo, 'Hello again')).includes(DIGEST));
  });
});
