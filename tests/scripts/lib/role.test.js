// tests/scripts/lib/role.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { sessionRole, recordRole, roleFile } from '../../../scripts/lib/role.js';
import { FOREMAN_PROMPT_LEAD } from '../../../scripts/foreman/start.js';
import { withHome } from '../../helpers/homes.js';

// A feature worktree made by hand as git leaves one, on `branch`.
function worktree(home, branch) {
  const tree = path.join(home, 'tree');
  const gitdir = path.join(home, 'main', '.git', 'worktrees', 'tree');
  fs.mkdirSync(tree, { recursive: true });
  fs.mkdirSync(gitdir, { recursive: true });
  fs.writeFileSync(path.join(tree, '.git'), `gitdir: ${gitdir}\n`);
  fs.writeFileSync(path.join(gitdir, 'HEAD'), `ref: refs/heads/${branch}\n`);
  return tree;
}

test('WHEELHOUSE_ROLE=foreman makes the foreman, whatever the folder; any other value does not', () => {
  withHome((home) => {
    const tree = worktree(home, 'feature/gift-cards');
    assert.equal(sessionRole({ sessionId: 's1', env: { WHEELHOUSE_ROLE: 'foreman' } }), 'foreman');
    assert.equal(sessionRole({ sessionId: 's1', env: { WHEELHOUSE_ROLE: 'foreman' }, cwd: tree }), 'foreman');
    assert.equal(sessionRole({ sessionId: 's2', env: { WHEELHOUSE_ROLE: 'builder' } }), 'front-desk');
    assert.equal(sessionRole({ sessionId: 's2', env: {} }), 'front-desk');
  });
});

test('a first prompt that begins with the foreman\'s wake line makes the foreman', () => {
  withHome(() => {
    const prompt = `${FOREMAN_PROMPT_LEAD} handle wake-1.json`;
    assert.equal(prompt, 'Wheelhouse foreman: handle wake-1.json');
    assert.equal(sessionRole({ sessionId: 's1', env: {}, prompt }), 'foreman');
    // Words that merely mention it are not the wake line.
    assert.equal(sessionRole({ sessionId: 's2', env: {}, prompt: `Please explain "${FOREMAN_PROMPT_LEAD}"` }), 'front-desk');
  });
});

test('a role recorded from the first prompt holds: a later prompt with the wake line\'s words changes nothing', () => {
  withHome(() => {
    const first = sessionRole({ sessionId: 's1', env: {}, prompt: 'How is it going?' });
    assert.equal(first, 'front-desk');
    assert.equal(recordRole('s1', first), true);
    assert.equal(sessionRole({ sessionId: 's1', env: {}, prompt: `${FOREMAN_PROMPT_LEAD} handle wake-1.json` }), 'front-desk');
    // Recording again keeps the first record.
    assert.equal(recordRole('s1', 'foreman'), false);
    assert.equal(sessionRole({ sessionId: 's1', env: {} }), 'front-desk');

    // The foreman's record is read back without its prompt, as the session start and the mod read it.
    recordRole('s2', sessionRole({ sessionId: 's2', env: {}, prompt: `${FOREMAN_PROMPT_LEAD} handle wake-2.json` }));
    assert.equal(sessionRole({ sessionId: 's2', env: {} }), 'foreman');
    assert.equal(sessionRole({ sessionId: 's2', env: {}, prompt: 'Hello' }), 'foreman');
  });
});

test('a session in a feature worktree is a feature session; in the main folder it is the front desk', () => {
  withHome((home) => {
    const tree = worktree(home, 'feature/gift-cards');
    assert.equal(sessionRole({ sessionId: 's1', env: {}, cwd: tree }), 'feature');
    fs.writeFileSync(path.join(home, 'main', '.git', 'worktrees', 'tree', 'HEAD'), 'ref: refs/heads/main\n');
    assert.equal(sessionRole({ sessionId: 's2', env: {}, cwd: tree }), 'front-desk');
  });
});

test('the record is sessions/<id>/role.json in the Wheelhouse home', () => {
  withHome((home) => {
    recordRole('s-abc', 'feature');
    const file = path.join(home, 'sessions', 's-abc', 'role.json');
    assert.equal(roleFile('s-abc'), file);
    assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), { role: 'feature' });
  });
});

test('an unsafe session id or an unknown role is never written, and a damaged record is passed over', () => {
  withHome((home) => {
    for (const id of ['../x', '..', 'a/b', '', undefined, 42]) {
      assert.equal(roleFile(id), null);
      assert.equal(recordRole(id, 'foreman'), false);
      assert.equal(sessionRole({ sessionId: id, env: {} }), 'front-desk');
    }
    assert.equal(recordRole('s1', 'builder'), false);
    assert.equal(fs.existsSync(path.join(home, 'sessions', 's1')), false);
    fs.mkdirSync(path.join(home, 'sessions', 's2'), { recursive: true });
    for (const body of ['not json', '{"role":"builder"}', '[]']) {
      fs.writeFileSync(path.join(home, 'sessions', 's2', 'role.json'), body);
      assert.equal(sessionRole({ sessionId: 's2', env: {}, prompt: `${FOREMAN_PROMPT_LEAD} x` }), 'foreman', body);
    }
  });
});
