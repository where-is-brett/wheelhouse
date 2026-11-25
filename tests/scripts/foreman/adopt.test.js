// tests/scripts/foreman/adopt.test.js
// A Desktop builder's first prompt names the piece, and the builder records the worktree Desktop made (builders and settings
// design, section 7.3).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { adoptBuilder } from '../../../scripts/foreman/adopt.js';
import { readBuilder } from '../../../scripts/foreman/desktop-builders.js';
import { builderStart } from '../../../scripts/foreman/desktop-start.js';
import { desktopFindings } from '../../../scripts/foreman/desktop-findings.js';
import { withHome } from '../../helpers/homes.js';
import { P, project } from '../../helpers/foreman.js';

const S = 'bbbbbbbb-1111-2222-3333-444444444444';
const prompt = (work = 'alpha', project = P) => builderStart({ project, work, title: 'Alpha', brief: 'The brief.\n', findings: desktopFindings() }).prompt;

// A linked worktree of `checkout` as git leaves one, on `branch`, outside the checkout (Desktop puts its own where it likes).
function linked(checkout, name, branch) {
  const tree = fs.realpathSync.native(fs.mkdtempSync(path.join(path.dirname(checkout), `${name}-`)));
  const gitdir = path.join(checkout, '.git', 'worktrees', name);
  fs.mkdirSync(gitdir, { recursive: true });
  fs.writeFileSync(path.join(tree, '.git'), `gitdir: ${gitdir}\n`);
  fs.writeFileSync(path.join(gitdir, 'HEAD'), `ref: refs/heads/${branch}\n`);
  fs.writeFileSync(path.join(gitdir, 'commondir'), '../..\n');
  return tree;
}

test('a first prompt with the marker, in a linked worktree of the project, records the session, worktree and branch', () => withHome(async () => {
  const checkout = await project();
  const tree = linked(checkout, 'alpha', 'claude/alpha-1');
  assert.deepEqual(adoptBuilder({ project: P, checkout, sessionId: S, prompt: prompt(), cwd: tree }), { adopted: true, work: 'alpha' });
  const rec = readBuilder(P, 'alpha');
  assert.equal(rec.sessionId, S);
  assert.equal(rec.worktree, tree);
  assert.equal(rec.branch, 'claude/alpha-1');
}));

test('a prompt with no marker, a marker for another project, or typed marker words below the lead record nothing', () => withHome(async () => {
  const checkout = await project();
  const tree = linked(checkout, 'alpha', 'claude/alpha-1');
  for (const p of ['Please build alpha', prompt('alpha', 'other__proj'), `hello\n${prompt()}`]) {
    assert.equal(adoptBuilder({ project: P, checkout, sessionId: S, prompt: p, cwd: tree }).adopted, false);
  }
  assert.equal(readBuilder(P, 'alpha'), null);
}));

test('the main checkout, a folder that is not a worktree of this project, and an unreadable branch record nothing', () => withHome(async () => {
  const checkout = await project();
  assert.equal(adoptBuilder({ project: P, checkout, sessionId: S, prompt: prompt(), cwd: checkout }).adopted, false);
  const other = await project();
  const foreign = linked(other, 'alpha', 'claude/alpha-1');
  assert.equal(adoptBuilder({ project: P, checkout, sessionId: S, prompt: prompt(), cwd: foreign }).adopted, false);
  const tree = linked(checkout, 'beta', 'claude/beta');
  fs.writeFileSync(path.join(checkout, '.git', 'worktrees', 'beta', 'HEAD'), '0123456789012345678901234567890123456789\n');
  assert.equal(adoptBuilder({ project: P, checkout, sessionId: S, prompt: prompt('beta'), cwd: tree }).adopted, false);
  assert.equal(adoptBuilder({ project: P, checkout, sessionId: 'a b', prompt: prompt(), cwd: linked(checkout, 'gamma', 'x') }).adopted, false);
  assert.equal(readBuilder(P, 'alpha'), null);
  assert.equal(readBuilder(P, 'beta'), null);
}));

test('the prompt hook records the worktree on a builder\'s first prompt only, and not for a typed lead in the main checkout', () => withHome(async () => {
  const { decide } = await import('../../../scripts/hooks/board-context.js');
  const checkout = await project();
  const tree = linked(checkout, 'alpha', 'claude/alpha-1');
  await decide({ session_id: 'dddddddd-1111-2222-3333-444444444444', cwd: checkout, prompt: prompt() });
  assert.equal(readBuilder(P, 'alpha'), null, 'typed in the main checkout');
  await decide({ session_id: 'cccccccc-1111-2222-3333-444444444444', cwd: tree, prompt: 'hello' });
  assert.equal(readBuilder(P, 'alpha'), null, 'no lead');
  await decide({ session_id: S, cwd: tree, prompt: prompt() });
  assert.equal(readBuilder(P, 'alpha').sessionId, S);
}));
