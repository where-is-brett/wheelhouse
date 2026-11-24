// tests/scripts/lib/window-lines.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { windowLines } from '../../../scripts/lib/window-lines.js';

test('the window leaves out the set line and the reply code line, and keeps every other line', () => {
  const question = 'Add a greeting line has not moved for 20 minutes. What should happen?\n\nWhy this comes to you: nothing has moved it on.\nAnswer question q-readme-greeting-line-1000002\nReply code: FNVW';
  assert.deepEqual(windowLines(question), ['Add a greeting line has not moved for 20 minutes. What should happen?', '', 'Why this comes to you: nothing has moved it on.']);
  assert.deepEqual(windowLines('Approve pull request 12\nAnswer question not-an-id'), ['Approve pull request 12', 'Answer question not-an-id']);
});
