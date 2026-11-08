// tests/scripts/lib/role.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { sessionRole, recordRole, recordAside, roleFile, ROLES, ASIDE_COMMAND, asideKind, asideByChoice } from '../../../scripts/lib/role.js';
import { FOREMAN_PROMPT_LEAD } from '../../../scripts/foreman/start.js';
import { withHome } from '../../helpers/homes.js';
import { makeFeatureFolder } from '../../helpers/made-feature.js';

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
    makeFeatureFolder(tree, 'gift-cards');
    assert.equal(sessionRole({ sessionId: 's1', env: {}, cwd: tree }), 'feature');
    fs.writeFileSync(path.join(home, 'main', '.git', 'worktrees', 'tree', 'HEAD'), 'ref: refs/heads/main\n');
    assert.equal(sessionRole({ sessionId: 's2', env: {}, cwd: tree }), 'aside');
    const main = path.join(home, 'main');
    fs.mkdirSync(path.join(main, '.git'), { recursive: true });
    assert.equal(sessionRole({ sessionId: 's3', env: {}, cwd: main, seat: null }), 'front-desk');
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

test('a feature/ branch with no feature folder is not a feature session', () => {
  withHome((home) => {
    const tree = worktree(home, 'feature/login');
    assert.notEqual(sessionRole({ sessionId: 's1', env: {}, cwd: tree }), 'feature');
  });
});

test('a feature/ branch whose brief names another piece is not a feature session', () => {
  withHome((home) => {
    const tree = makeFeatureFolder(worktree(home, 'feature/login'), 'other');
    assert.notEqual(sessionRole({ sessionId: 's1', env: {}, cwd: tree }), 'feature');
  });
});

test('a feature worktree Wheelhouse made is a feature session', () => {
  withHome((home) => {
    const tree = makeFeatureFolder(worktree(home, 'feature/login'), 'login');
    assert.equal(sessionRole({ sessionId: 's1', env: {}, cwd: tree }), 'feature');
  });
});

test('a helm worktree stays a feature session', () => {
  withHome((home) => {
    // helm: the crew visibility build gives the helm's worktree its own marker; until it is on main this is a plain made feature worktree.
    const tree = makeFeatureFolder(worktree(home, 'feature/helm'), 'helm');
    assert.equal(sessionRole({ sessionId: 's1', env: {}, cwd: tree }), 'feature');
  });
});

test('aside is a role, and the aside command is /wheelhouse:aside', () => {
  assert.ok(ROLES.includes('aside'));
  assert.equal(ASIDE_COMMAND, '/wheelhouse:aside');
});

test('the seat holder is the front desk; another session\'s seat makes this one aside; no seat is the front desk', () => {
  withHome(() => {
    assert.equal(sessionRole({ sessionId: 'a', env: {}, seat: { session: 'a' } }), 'front-desk');
    assert.equal(sessionRole({ sessionId: 'a', env: {}, seat: { session: 'b' } }), 'aside');
    assert.equal(sessionRole({ sessionId: 'a', env: {}, seat: null }), 'front-desk');
    assert.equal(sessionRole({ sessionId: 'a', env: {}, seat: {} }), 'front-desk');
  });
});

test('a recorded front desk follows the seat', () => {
  withHome(() => {
    recordRole('a', 'front-desk');
    assert.equal(sessionRole({ sessionId: 'a', env: {}, seat: { session: 'b' } }), 'aside');
    assert.equal(sessionRole({ sessionId: 'a', env: {}, seat: { session: 'a' } }), 'front-desk');
  });
});

test('the aside command makes an aside', () => {
  withHome(() => {
    assert.equal(sessionRole({ sessionId: 'a', env: {}, prompt: '/wheelhouse:aside', seat: null }), 'aside');
    assert.equal(sessionRole({ sessionId: 'a', env: {}, prompt: '/wheelhouse:aside research', seat: null }), 'aside');
    assert.equal(sessionRole({ sessionId: 'a', env: {}, prompt: '/wheelhouse:asides', seat: null }), 'front-desk');
    assert.equal(sessionRole({ sessionId: 'a', env: {}, prompt: 'what is /wheelhouse:aside', seat: null }), 'front-desk');
  });
});

test('a linked worktree that isn\'t a feature is aside; a made feature worktree is a feature whatever the seat', () => {
  withHome((home) => {
    const tree = worktree(home, 'feature/desk');
    assert.equal(sessionRole({ sessionId: 'a', env: {}, cwd: tree, seat: null }), 'aside');
    makeFeatureFolder(tree, 'desk');
    assert.equal(sessionRole({ sessionId: 'a', env: {}, cwd: tree, seat: { session: 'b' } }), 'feature');
    assert.equal(sessionRole({ sessionId: 'a', env: {}, cwd: tree, seat: null }), 'feature');
  });
});

test('why and foreman come before the seat', () => {
  withHome(() => {
    assert.equal(sessionRole({ sessionId: 'a', env: { WHEELHOUSE_ROLE: 'why' }, seat: { session: 'b' } }), 'why');
    assert.equal(sessionRole({ sessionId: 'a', env: { WHEELHOUSE_ROLE: 'foreman' }, seat: { session: 'b' } }), 'foreman');
  });
});

test('no session id is the front desk, whatever the seat', () => {
  withHome(() => {
    assert.equal(sessionRole({ sessionId: undefined, env: {}, seat: { session: 'b' } }), 'front-desk');
  });
});

test('with no seat given, the seat is read from the cwd\'s project; no project is the front desk', () => {
  withHome((home) => {
    const main = path.join(home, 'plain');
    fs.mkdirSync(path.join(main, '.git'), { recursive: true });
    assert.equal(sessionRole({ sessionId: 'a', env: {}, cwd: main }), 'front-desk');
  });
});

test('asideKind: the main checkout is main; a linked worktree is worktree', () => {
  withHome((home) => {
    const main = path.join(home, 'plain');
    fs.mkdirSync(path.join(main, '.git'), { recursive: true });
    assert.equal(asideKind({ cwd: main }), 'main');
    assert.equal(asideKind({ cwd: worktree(home, 'feature/desk') }), 'worktree');
    assert.equal(asideKind({}), 'main');
  });
});

test('recordAside turns a recorded front desk into an aside, and replaces nothing else', () => {
  withHome(() => {
    assert.equal(recordAside('s-none'), false);
    assert.equal(fs.existsSync(roleFile('s-none')), false);
    recordRole('s-desk', 'front-desk');
    assert.equal(recordAside('s-desk'), true);
    assert.equal(JSON.parse(fs.readFileSync(roleFile('s-desk'), 'utf8')).role, 'aside');
    for (const role of ['feature', 'foreman', 'why']) {
      recordRole(`s-${role}`, role);
      assert.equal(recordAside(`s-${role}`), false);
      assert.equal(JSON.parse(fs.readFileSync(roleFile(`s-${role}`), 'utf8')).role, role);
    }
  });
});

test('only the aside command as a word counts: /wheelhouse:asides does not', () => {
  assert.equal(asideByChoice({ prompt: ASIDE_COMMAND }), true);
  assert.equal(asideByChoice({ prompt: `${ASIDE_COMMAND} research` }), true);
  assert.equal(asideByChoice({ prompt: `${ASIDE_COMMAND}s` }), false);
  assert.equal(asideByChoice({ prompt: `${ASIDE_COMMAND}-x` }), false);
});
