// tests/scripts/foreman/desktop-start.test.js
// A Desktop builder's title and prompt (builders and settings design, sections 7.3 and 7.4).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { builderStart, builderTitle, markerLine, MARKER_LEAD, markerOf } from '../../../scripts/foreman/desktop-start.js';
import { BUILDER_PROMPT_LEAD } from '../../../scripts/foreman/prompt-lead.js';

const NESTED = { cwdOnOffer: false, nesting: { how: 'parent_session' } };
const FLAT = { cwdOnOffer: false, nesting: { how: null } };
const F = 'ffffffff-1111-2222-3333-444444444444';

test('the title carries the project only when nesting is not available', () => {
  assert.equal(builderTitle({ project: 'o__p', title: 'Add login', nested: true }), 'Wheelhouse · Add login');
  assert.equal(builderTitle({ project: 'o__p', title: 'Add login', nested: false }), 'Wheelhouse · o__p · Add login');
});

test('the title is under 60 characters and the piece\'s title is shortened first', () => {
  const long = 'A very long piece title that goes on and on and on past any sensible length';
  for (const nested of [true, false]) {
    const t = builderTitle({ project: 'o__project', title: long, nested });
    assert.ok(t.length < 60, t);
    assert.ok(t.startsWith(nested ? 'Wheelhouse · A very' : 'Wheelhouse · o__project · A very'), t);
    assert.ok(t.endsWith('…'));
  }
  assert.ok(builderTitle({ project: 'p'.repeat(90), title: 'x', nested: false }).length < 60);
  assert.ok(builderTitle({ project: 'o__p', title: '', nested: true }).length < 60);
});

test('the prompt starts with the builder lead, then one marker line naming the project and work, then the brief', () => {
  const s = builderStart({ project: 'o__p', work: 'add-login', title: 'Add login', brief: '# The goal\n\nLogin.\n', findings: FLAT });
  const lines = s.prompt.split('\n');
  assert.ok(lines[0].startsWith(BUILDER_PROMPT_LEAD));
  assert.equal(lines[1], markerLine('o__p', 'add-login'));
  assert.equal(lines[1], `${MARKER_LEAD} o__p add-login`);
  assert.equal(lines.filter((l) => l.startsWith(MARKER_LEAD)).length, 1);
  assert.ok(s.prompt.endsWith('# The goal\n\nLogin.\n'));
  assert.deepEqual(markerOf(s.prompt), { project: 'o__p', work: 'add-login' });
});

test('a marker is read only from the second line of a prompt that begins with the builder lead', () => {
  assert.equal(markerOf(`${markerLine('o__p', 'a')}\n`), null);
  assert.equal(markerOf(`${BUILDER_PROMPT_LEAD} x\nnot it\n${markerLine('o__p', 'a')}`), null);
  assert.equal(markerOf(`${BUILDER_PROMPT_LEAD} x\n${MARKER_LEAD} o__p Bad_Work`), null);
  assert.equal(markerOf(`${BUILDER_PROMPT_LEAD} x\n${MARKER_LEAD} o__p a extra`), null);
  assert.equal(markerOf(undefined), null);
});

test('nest is the probe\'s option, given the foreman\'s own session id, and absent when nesting is not available', () => {
  const a = builderStart({ project: 'o__p', work: 'w', title: 'T', brief: 'b', findings: NESTED, foremanSessionId: F });
  assert.deepEqual(a.nest, { parent_session: F });
  assert.equal(a.title, 'Wheelhouse · T');
  const b = builderStart({ project: 'o__p', work: 'w', title: 'T', brief: 'b', findings: FLAT, foremanSessionId: F });
  assert.equal('nest' in b, false);
  assert.equal(b.title, 'Wheelhouse · o__p · T');
  const c = builderStart({ project: 'o__p', work: 'w', title: 'T', brief: 'b', findings: NESTED });
  assert.equal('nest' in c, false);
});

test('cwd is given only when the probe showed an offer accepts it, and is the worktree Wheelhouse made', () => {
  assert.equal('cwd' in builderStart({ project: 'o__p', work: 'w', title: 'T', brief: 'b', findings: FLAT, worktree: '/x/y' }), false);
  const s = builderStart({ project: 'o__p', work: 'w', title: 'T', brief: 'b', findings: { cwdOnOffer: true, nesting: { how: null } }, worktree: '/x/y' });
  assert.equal(s.cwd, '/x/y');
});

test('the start always asks for an offer, fresh context, Auto and wake_when_done', () => {
  const s = builderStart({ project: 'o__p', work: 'w', title: 'T', brief: 'b', findings: FLAT });
  assert.deepEqual({ initiation: s.initiation, fresh: s.freshContext, mode: s.permissionMode, wake: s.wakeWhenDone, worktree: s.worktree }, { initiation: 'offer', fresh: true, mode: 'auto', wake: true, worktree: true });
});

test('a project or work that is not a slug-shaped name is refused', () => {
  assert.throws(() => builderStart({ project: 'o p', work: 'w', title: 'T', brief: 'b', findings: FLAT }), /project/);
  assert.throws(() => builderStart({ project: 'o__p', work: 'W x', title: 'T', brief: 'b', findings: FLAT }), /work/);
});
