// tests/scripts/lib/agent-control.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AGENT_CONTROL, CONTROL_FILE, homeControlFolders, homeControlPaths, plainControlNames } from '../../../scripts/lib/agent-control.js';

test('the files that steer an agent are named once, with the message that refuses a write to one', () => {
  assert.deepEqual(AGENT_CONTROL, [
    '.github/hooks/**', '.github/copilot/**', '.github/agents/**', '.github/skills/**', '.github/instructions/**', '.github/prompts/**',
    '.github/copilot-instructions.md', '.github/mcp.json', '.github/lsp.json', '.github/plugin/**',
    '**/AGENTS.md', '**/GEMINI.md', '.agents/**', 'plugin.json', '.plugin/**', 'com.github.copilot/**',
    '.vscode/**', '.codex/**', '.cursor/**', '.gemini/**', '.gitattributes',
  ]);
  assert.ok(Object.isFrozen(AGENT_CONTROL));
  assert.equal(CONTROL_FILE, 'That file steers an agent, so changing it is a guardrail change: ask the director');
});

test('the home folders that steer an agent, for each system, from the home given and never the real one', () => {
  const posix = (home, ...rest) => [home, ...rest].join('/');
  assert.deepEqual(homeControlFolders({ home: '/h/x', platform: 'darwin', env: {} }), [
    posix('/h/x', '.copilot'), posix('/h/x', '.agents'), posix('/h/x', '.vscode/extensions'), posix('/h/x', 'Library/Application Support/Code/User'),
  ]);
  assert.deepEqual(homeControlFolders({ home: '/h/x', platform: 'linux', env: {} }), [
    '/h/x/.copilot', '/h/x/.agents', '/h/x/.vscode/extensions', '/h/x/.config/Code/User',
  ]);
  // On Windows the user settings are under %APPDATA%, or under the home folder's AppData\Roaming when that is not set.
  assert.deepEqual(homeControlFolders({ home: 'C:\\Users\\x', platform: 'win32', env: { APPDATA: 'D:\\Roam\\x' } }), [
    'C:\\Users\\x\\.copilot', 'C:\\Users\\x\\.agents', 'C:\\Users\\x\\.vscode\\extensions', 'D:\\Roam\\x\\Code\\User',
  ]);
  assert.equal(homeControlFolders({ home: 'C:\\Users\\x', platform: 'win32', env: {} }).at(-1), 'C:\\Users\\x\\AppData\\Roaming\\Code\\User');
  assert.equal(homeControlFolders({ home: 'C:\\Users\\x', platform: 'win32', env: { APPDATA: '' } }).at(-1), 'C:\\Users\\x\\AppData\\Roaming\\Code\\User');
  assert.equal(homeControlFolders({ home: 'C:\\Users\\x', platform: 'win32', env: { appdata: 'D:\\Roam\\x' } }).at(-1), 'D:\\Roam\\x\\Code\\User', 'the variable\'s case does not matter on Windows');
  // An environment is not needed.
  assert.equal(homeControlFolders({ home: '/h/x', platform: 'darwin' }).length, 4);
});

test('the home folders, written from the home folder with forward slashes, for every system together', () => {
  assert.deepEqual(homeControlPaths(), [
    '.copilot', '.agents', '.vscode/extensions',
    'Library/Application Support/Code/User', 'AppData/Roaming/Code/User', '.config/Code/User',
  ]);
});

test('the control files and folders that are plain names, apart from those with a glob or a folder above them', () => {
  assert.deepEqual(plainControlNames(), {
    folders: ['.agents', '.plugin', 'com.github.copilot', '.vscode', '.codex', '.cursor', '.gemini'],
    files: ['plugin.json', '.gitattributes'],
  });
});
