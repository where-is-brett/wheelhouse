// tests/scripts/engine/archon/copilot-skills.test.js
// The Copilot form of the pack's skills (Archon design, section 7.1; ruling 3 of part 3b): a Copilot step reads its
// skills by plain name from the worktree's .agents/skills/, so the pack's Copilot form writes the copies there first.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { plainSkillName, writeStepSkills } from '../../../../scripts/engine/archon/copilot-skills.js';
import { tempFolder } from '../../../helpers/homes.js';

test('a Claude step\'s skill name becomes the plain name a Copilot step uses', () => {
  assert.equal(plainSkillName('wheelhouse:codebase-design'), 'codebase-design');
  assert.throws(() => plainSkillName('other:tdd'), /isn't one of Wheelhouse's/);
});

test('the copies a step names are written to the worktree\'s .agents/skills/ by their plain names', () => {
  const { worktree } = projectWithWorktree();
  const written = writeStepSkills({ worktree, skills: ['wheelhouse:codebase-design', 'wheelhouse:pr'] });
  assert.deepEqual(written, ['codebase-design', 'pr']);
  for (const name of written) assert.ok(fs.existsSync(path.join(worktree, '.agents', 'skills', name, 'SKILL.md')));
  assert.ok(fs.existsSync(path.join(worktree, '.agents', 'skills', 'codebase-design', 'LICENSE')), 'with its licence');
  assert.throws(() => writeStepSkills({ worktree, skills: ['wheelhouse:no-such-copy'] }), /matches no copy/);
});

import { execFileSync } from 'node:child_process';
import { writeWorktreeSkills, main } from '../../../../scripts/engine/archon/copilot-skills.js';

const gitIn = (cwd, ...args) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t.invalid', ...args], { cwd, encoding: 'utf8' }).trim();

// A project with a run's worktree, as Archon makes one.
function projectWithWorktree() {
  const root = tempFolder('wh-proj-');
  const project = path.join(root, 'project');
  fs.mkdirSync(project);
  gitIn(project, 'init', '-q', '-b', 'main');
  fs.writeFileSync(path.join(project, 'README.md'), 'shop\n');
  gitIn(project, 'add', '-A');
  gitIn(project, 'commit', '-q', '-m', 'Start');
  const worktree = path.join(project, '.wheelhouse', 'worktrees', 'run-1');
  gitIn(project, 'worktree', 'add', '-q', '-b', 'wh/run-1', worktree);
  return { project, worktree };
}

test('the copies are written into a run\'s worktree and kept out of git, so nothing commits them', () => {
  const { worktree } = projectWithWorktree();
  const got = writeWorktreeSkills({ worktree, names: ['codebase-design', 'pr'] });
  assert.deepEqual(got, { written: ['codebase-design', 'pr'], kept: [] });
  assert.ok(fs.existsSync(path.join(worktree, '.agents', 'skills', 'pr', 'SKILL.md')));
  assert.equal(gitIn(worktree, 'status', '--porcelain', '--untracked-files=all'), '');
  // Written again (a later step, or a carried-on run): nothing changes and the exclude line isn't doubled.
  assert.deepEqual(writeWorktreeSkills({ worktree, names: ['pr'] }), { written: [], kept: ['pr'] });
  const exclude = fs.readFileSync(gitIn(worktree, 'rev-parse', '--path-format=absolute', '--git-path', 'info/exclude'), 'utf8');
  assert.equal(exclude.split('\n').filter((l) => l === '/.agents/skills/pr/').length, 1);
});

test('a project\'s own skill of the same name is kept, never written over', () => {
  const { project, worktree } = projectWithWorktree();
  fs.mkdirSync(path.join(worktree, '.agents', 'skills', 'pr'), { recursive: true });
  fs.writeFileSync(path.join(worktree, '.agents', 'skills', 'pr', 'SKILL.md'), 'the project\'s own\n');
  gitIn(worktree, 'add', '-A');
  gitIn(worktree, 'commit', '-q', '-m', 'Own skill');
  assert.deepEqual(writeWorktreeSkills({ worktree, names: ['pr'] }), { written: [], kept: ['pr'] });
  assert.equal(fs.readFileSync(path.join(worktree, '.agents', 'skills', 'pr', 'SKILL.md'), 'utf8'), 'the project\'s own\n');
  assert.ok(project);
});

test('a name that isn\'t a plain copy is refused, and a linked skills folder is never written through', () => {
  const { worktree } = projectWithWorktree();
  assert.throws(() => writeWorktreeSkills({ worktree, names: ['../escape'] }), /matches no copy/);
  assert.throws(() => writeWorktreeSkills({ worktree, names: ['wheelhouse:pr'] }), /matches no copy/);
  const elsewhere = tempFolder('wh-else-');
  fs.mkdirSync(path.join(worktree, '.agents'));
  fs.symlinkSync(elsewhere, path.join(worktree, '.agents', 'skills'));
  assert.throws(() => writeWorktreeSkills({ worktree, names: ['pr'] }), /link/);
  assert.deepEqual(fs.readdirSync(elsewhere), []);
});

test('the step\'s command writes the names it is given into the folder it runs in', () => {
  const { worktree } = projectWithWorktree();
  const lines = [];
  assert.equal(main(['--names', 'codebase-design,pr'], { cwd: worktree, out: (l) => lines.push(l) }), 0);
  assert.deepEqual(JSON.parse(lines[0]), { written: ['codebase-design', 'pr'], kept: [] });
  assert.equal(main([], { cwd: worktree, out: (l) => lines.push(l) }), 2);
  assert.equal(main(['--names', 'nope'], { cwd: worktree, out: (l) => lines.push(l) }), 1);
});
