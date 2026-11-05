// tests/docs/readme-install.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const readme = fs.readFileSync(fileURLToPath(new URL('../../README.md', import.meta.url)), 'utf8');
const install = readme.slice(readme.indexOf('## Install'), readme.indexOf('## Update'));

test('the install message tells Claude to say once that a new chat is needed, and nothing else', () => {
  const message = install.slice(install.indexOf('```text'), install.indexOf('```', install.indexOf('```text') + 7));
  assert.match(message, /Open a new chat on this folder now/);
  assert.match(message, /do nothing else in this chat/);
  assert.doesNotMatch(message, /tell me when both have finished/);
});

test('the install step after the commands is the one restart, in plain words', () => {
  assert.match(install, /Open a new chat on the same folder now/);
  assert.match(install, /the only restart/);
});
