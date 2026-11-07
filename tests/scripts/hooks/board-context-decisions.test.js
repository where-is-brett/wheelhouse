// tests/scripts/hooks/board-context-decisions.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { decide, cardsDue, DECISIONS_TAIL } from '../../../scripts/hooks/board-context.js';
import { writeProject } from '../../../scripts/lib/projects.js';
import { recordRole } from '../../../scripts/lib/role.js';
import { markSeen } from '../../../scripts/briefing/seen.js';
import { wheelhouseHome } from '../../../scripts/lib/paths.js';
import { inHome as inHomeOff, turnOn, P, raise, typedAnswer } from '../../helpers/decisions-world.js';
// Typed replies are off until the director rules; these tests are of the behaviour with them on, and say so where they mean off.
const inHome = (fn) => inHomeOff(async (home) => { turnOn(); return fn(home); });


const NOW = '2026-11-08T12:00:00.000Z';
const at = (iso) => () => new Date(iso);
const put = (file, value) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, typeof value === 'string' ? value : JSON.stringify(value));
};

// A registered project of the made-up kind, whose main folder is on `main`, and a director who wrote a minute ago.
function register(home, { on = true } = {}) {
  const repo = path.join(home, 'repo');
  put(path.join(repo, '.git', 'HEAD'), 'ref: refs/heads/main\n');
  writeProject(P, { folder: repo, remoteUrl: 'https://example.com/owner/harbour-demo.git', host: 'github', repo: 'owner/harbour-demo', connection: {} });
  put(path.join(wheelhouseHome(), 'projects', P, 'views', 'waiting.json'), []);
  // The settings view the helper keeps: typed replies confirmed on, or no setting at all (the default, off).
  if (on) put(path.join(wheelhouseHome(), 'projects', P, 'views', 'settings.json'), { typedReplies: { key: 'typedReplies', id: 's1', at: '2026-11-01T01:00:00.000Z', value: true } });
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

test('a reply that answers a decision leaves it out of the line in that same call', async () => {
  await inHome(async (home) => {
    const repo = register(home);
    raise('How often should the digest go out?', '2026-11-08T01:00:00.000Z');
    raise('Which harbour comes first on the map?', '2026-11-08T02:00:00.000Z');
    // The prompt hook records "1 B" beside this hook: this call does not list decision 1 as waiting.
    const line = contextOf(await ask(repo, '1 B'));
    assert.match(line, /Decisions waiting for the director: 2\. Which harbour comes first on the map\?\./);
    assert.ok(!line.includes('How often'));
    // With only one waiting, a lone letter answers it, and nothing is left to list.
    const alone = await inHome(async (other) => {
      const folder = register(other);
      raise('How often should the digest go out?', '2026-11-08T01:00:00.000Z');
      return ask(folder, 'B');
    });
    assert.equal(alone, undefined);
  });
});

test('a reply that answers nothing leaves every decision listed', async () => {
  await inHome(async (home) => {
    const repo = register(home);
    raise('How often should the digest go out?', '2026-11-08T01:00:00.000Z');
    raise('Which harbour comes first on the map?', '2026-11-08T02:00:00.000Z');
    // Ambiguous with two waiting, a letter beyond the options, and words that are no reply.
    for (const text of ['B', '1 E', 'looks good', '2 a.m. works']) {
      const line = contextOf(await ask(repo, text));
      assert.match(line, /1\. How often should the digest go out\?; 2\. Which harbour comes first on the map\?/, text);
    }
  });
});

test('under the same guards: a script-started or non-front-desk session leaves the decision listed', async () => {
  await inHome(async (home) => {
    const repo = register(home);
    raise('How often should the digest go out?', '2026-11-08T01:00:00.000Z');
    const scripted = decide({ cwd: repo, session_id: 's-desk', hook_event_name: 'UserPromptSubmit', prompt: '1 B' }, { now: at(NOW), env: { CLAUDE_CODE_ENTRYPOINT: 'sdk-cli' }, client });
    assert.match(contextOf(await scripted), /Decisions waiting for the director: 1\. How often/);
    // A feature session gets no decisions line at all.
    recordRole('s-feature', 'feature');
    const feature = await decide({ cwd: repo, session_id: 's-feature', hook_event_name: 'UserPromptSubmit', prompt: '1 B' }, { now: at(NOW), env: {}, client });
    assert.equal(feature, undefined);
  });
});

test('a decision is no card to ask: the count of cards leaves it out', () => {
  const card = { id: 'c1', at: '2026-11-08T01:00:00.000Z', asked: null, data: { kind: 'answer', line: 'Answer question q-w-tide-1-1', question: 'How often?', options: ['Daily', 'Weekly'] } };
  const on = { typedReplies: { key: 'typedReplies', id: 's1', at: '2026-11-01T01:00:00.000Z', value: true } };
  assert.equal(cardsDue({ waiting: [card], settings: on }, new Date(NOW)), 0);
  const approval = { id: 'c2', at: '2026-11-08T01:00:00.000Z', asked: null, data: { kind: 'approval', question: 'Put it live?', options: ['Approve', 'Not now'] } };
  assert.equal(cardsDue({ waiting: [card, approval], settings: on }, new Date(NOW)), 1);
  // Off, the default: the decision's card is a card to ask through the picker, as on main.
  assert.equal(cardsDue({ waiting: [card] }, new Date(NOW)), 1);
  assert.equal(cardsDue({ waiting: [card, approval] }, new Date(NOW)), 2);
});

test('typed replies off: the decisions are still listed, a typed reply hides none, and the cards line counts them', async () => {
  await inHomeOff(async (home) => {
    const repo = register(home, { on: false });
    raise('How often should the digest go out?', '2026-11-08T01:00:00.000Z');
    const line = contextOf(await ask(repo, '1 B'));
    assert.match(line, /Decisions waiting for the director: 1\. How often should the digest go out\?\./);
    assert.match(line, /Typed replies are switched off/);
    assert.ok(!line.includes('not shown yet'));
  });
});
