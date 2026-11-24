// tests/docs/readme-throwaway-home.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const readme = fs.readFileSync(fileURLToPath(new URL('../../README.md', import.meta.url)), 'utf8');
const start = readme.indexOf('## Trying Wheelhouse without touching your usual setup');
const section = start === -1 ? '' : readme.slice(start, readme.indexOf('\n## ', start + 5));

test('the README has the throwaway home section, with the WHEELHOUSE_HOME line for the project\'s settings', () => {
  assert.notEqual(start, -1, 'the section is there');
  assert.match(section, /"env": \{ "WHEELHOUSE_HOME": "[^"]+" \}/);
  assert.match(section, /\.claude\/settings\.json/);
});

test('the section says how a trial ends: processes stop after an hour, All stop, then delete the folder', () => {
  assert.match(section, /an hour after the last session/);
  assert.match(section, /All stop, then deleting the folder/);
});
