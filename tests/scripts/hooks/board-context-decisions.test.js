// tests/scripts/hooks/board-context-decisions.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { decide, cardsDue, DECISIONS_TAIL } from '../../../scripts/hooks/board-context.js';
import { keepNote, recordAnswer } from '../../../scripts/decisions/answer.js';
import { writeProject } from '../../../scripts/lib/projects.js';
import { markSeen } from '../../../scripts/briefing/seen.js';
import { wheelhouseHome } from '../../../scripts/lib/paths.js';
import { inHome, P, raise, typedAnswer } from '../../helpers/decisions-world.js';

const NOW = '2026-11-08T12:00:00.000Z';
const at = (iso) => () => new Date(iso);
const put = (file, value) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, typeof value === 'string' ? value : JSON.stringify(value));
};

// A registered project of the made-up kind, whose main folder is on `main`, and a director who wrote a minute ago.
function register(home) {
  const repo = path.join(home, 'repo');
  put(path.join(repo, '.git', 'HEAD'), 'ref: refs/heads/main\n');
  writeProject(P, { folder: repo, remoteUrl: 'https://example.com/owner/harbour-demo.git', host: 'github', repo: 'owner/harbour-demo', connection: {} });
  put(path.join(wheelhouseHome(), 'projects', P, 'views', 'waiting.json'), []);
  markSeen(P, { promptAt: new Date('2026-11-08T11:59:00.000Z') });
  return repo;
}

const client = { health: async () => ({ ok: true }), lock: { read: async () => ({ ok: true, result: null }) } };
const ask = (repo, text, session = 's-desk') => decide({ cwd: repo, session_id: session, hook_event_name: 'UserPromptSubmit', prompt: text }, { now: at(NOW), env: {}, client });
const contextOf = (out) => out?.hookSpecificOutput?.additionalContext;

test('each prompt lists the waiting decisions by number and question', async () => {
  await inHome(async (home) => {
    const repo = register(home);
    raise('How often should the digest go out?', '2026-11-08T01:00:00.000Z');
    const second = raise('Which harbour comes first on the map?', '2026-11-08T02:00:00.000Z');
    const text = contextOf(await ask(repo, 'What is going on?'));
    assert.match(text, /Decisions waiting for the director: 1\. How often should the digest go out\?; 2\. Which harbour comes first on the map\?\./);
    assert.ok(text.includes(DECISIONS_TAIL));
    // They are no cards for the question picker.
    assert.ok(!text.includes('Cards to ask this visit'));
    // Each prompt says so again while they wait, and drops one once it is answered.
    typedAnswer(second, { n: 2, label: 'A' }, '2026-11-08T03:00:00.000Z');
    const later = contextOf(await ask(repo, 'And now?'));
    assert.match(later, /Decisions waiting for the director: 1\. How often should the digest go out\?\./);
    assert.ok(!later.includes('Which harbour'));
  });
});

test('no decision waiting adds nothing about decisions', async () => {
  await inHome(async (home) => {
    const repo = register(home);
    assert.equal(await ask(repo, 'Hello'), undefined);
  });
});

test('a refused reply\'s note is shown once', async () => {
  await inHome(async (home) => {
    const repo = register(home);
    raise('How often should the digest go out?', '2026-11-08T01:00:00.000Z');
    raise('Which harbour comes first on the map?', '2026-11-08T02:00:00.000Z');
    // The prompt hook's note for an ambiguous reply, as the hook keeps it.
    await recordAnswer({ project: P, sessionId: 's-desk', prompt: 'B', at: new Date(NOW), cwd: repo, env: {}, client: {} });
    const first = contextOf(await ask(repo, 'B'));
    assert.match(first, /could answer decision 1 or 2\. Nothing was recorded/);
    const second = contextOf(await ask(repo, 'Anything else?'));
    assert.ok(!second.includes('Nothing was recorded'));
  });
});

test('another session\'s note is left for that session', async () => {
  await inHome(async (home) => {
    const repo = register(home);
    raise('How often should the digest go out?', '2026-11-08T01:00:00.000Z');
    keepNote('s-other', 'A note for the other session.');
    assert.ok(!contextOf(await ask(repo, 'Hello', 's-desk')).includes('A note for the other session'));
    assert.match(contextOf(await ask(repo, 'Hello', 's-other')), /A note for the other session/);
  });
});

test('a decision is no card to ask: the count of cards leaves it out', () => {
  const card = { id: 'c1', at: '2026-11-08T01:00:00.000Z', asked: null, data: { kind: 'answer', line: 'Answer question q-w-tide-1-1', question: 'How often?', options: ['Daily', 'Weekly'] } };
  assert.equal(cardsDue({ waiting: [card] }, new Date(NOW)), 0);
  const approval = { id: 'c2', at: '2026-11-08T01:00:00.000Z', asked: null, data: { kind: 'approval', question: 'Put it live?', options: ['Approve', 'Not now'] } };
  assert.equal(cardsDue({ waiting: [card, approval] }, new Date(NOW)), 1);
});
