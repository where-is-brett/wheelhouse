// tests/scripts/gate/glob.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { matchGlob } from '../../../scripts/gate/glob.js';

test('matchGlob: ** spans folders, * stays in one, **/X matches X at the top', () => {
  assert.equal(matchGlob('.claude/**', '.claude/settings.json'), true);
  assert.equal(matchGlob('.claude/**', '.claude/a/b/c.json'), true);
  assert.equal(matchGlob('.claude/**', 'src/.claude/x'), false);
  assert.equal(matchGlob('**/CLAUDE.md', 'CLAUDE.md'), true);
  assert.equal(matchGlob('**/CLAUDE.md', 'a/b/CLAUDE.md'), true);
  assert.equal(matchGlob('**/CLAUDE.md', 'a/MYCLAUDE.md'), false);
  assert.equal(matchGlob('src/*.js', 'src/a.js'), true);
  assert.equal(matchGlob('src/*.js', 'src/a/b.js'), false);
  assert.equal(matchGlob('src/**/x.js', 'src/x.js'), true);
  assert.equal(matchGlob('src/**/x.js', 'src/a/b/x.js'), true);
  assert.equal(matchGlob('a?c', 'abc'), true);
  assert.equal(matchGlob('a?c', 'a/c'), false);
  assert.equal(matchGlob('a?c', 'ac'), false);
});

test('matchGlob: case-sensitive, no braces or classes, regex characters are literal', () => {
  assert.equal(matchGlob('claude.md', 'CLAUDE.md'), false);
  assert.equal(matchGlob('a.b', 'axb'), false);
  assert.equal(matchGlob('{a,b}', 'a'), false);
  assert.equal(matchGlob('{a,b}', '{a,b}'), true);
  assert.equal(matchGlob('[ab]', 'a'), false);
  assert.equal(matchGlob('[ab]', '[ab]'), true);
  assert.equal(matchGlob('.gitlab-ci.yml', '.gitlab-ci.yml'), true);
});

test('matchGlob: ignoreCase folds both sides, and only when asked', () => {
  assert.equal(matchGlob('.claude/**', '.Claude/x', { ignoreCase: true }), true);
  assert.equal(matchGlob('.claude/**', '.Claude/x'), false);
  assert.equal(matchGlob('**/CLAUDE.md', 'docs/claude.md', { ignoreCase: true }), true);
});
