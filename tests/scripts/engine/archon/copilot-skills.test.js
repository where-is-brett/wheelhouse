// tests/scripts/engine/archon/copilot-skills.test.js
// The Copilot form of the pack's skills (Archon design, section 7.1; ruling 3 of part 3b): a Copilot step reads its
// skills by plain name from the worktree's .agents/skills/, so the copies are written there. Only the stub is built
// here; Copilot steps come later.
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
  const worktree = tempFolder('wh-wt-');
  const written = writeStepSkills({ worktree, skills: ['wheelhouse:codebase-design', 'wheelhouse:pr'] });
  assert.deepEqual(written, ['codebase-design', 'pr']);
  for (const name of written) assert.ok(fs.existsSync(path.join(worktree, '.agents', 'skills', name, 'SKILL.md')));
  assert.ok(fs.existsSync(path.join(worktree, '.agents', 'skills', 'codebase-design', 'LICENSE')), 'with its licence');
  assert.throws(() => writeStepSkills({ worktree, skills: ['wheelhouse:no-such-copy'] }), /matches no copy/);
});
