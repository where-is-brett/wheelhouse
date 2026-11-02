// tests/vscode/versions.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { require, fakeVscode } from './helpers.js';
import { tempFolder } from '../helpers/homes.js';
import { readVersions, versionsFile } from '../../scripts/agents/copilot/versions.js';

const { writeVersions, watchVersions } = require('../../vscode/versions.cjs');

const withCopilot = (vscode, version) => {
  vscode.extensions = { getExtension: (id) => (id.toLowerCase() === 'github.copilot-chat' && version ? { packageJSON: { version } } : undefined), onDidChange: (fn) => { vscode.changed = fn; return { dispose() {} }; } };
  return vscode;
};

test('the versions file is written, and the scripts read it back', async () => {
  const home = tempFolder('wh-versions-');
  const vscode = withCopilot(fakeVscode(), '0.31.2');
  const file = versionsFile(home);
  const wrote = await writeVersions({ vscode, file });
  assert.equal(wrote, true);
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), { vscode: '1.105.0', runtime: '0.31.2' });
  assert.deepEqual(await readVersions({ home, env: {} }), { vscode: '1.105.0', runtime: '0.31.2', cli: null });
});

test('the versions file is written again when the add-ons change', async () => {
  const home = tempFolder('wh-versions-');
  const file = versionsFile(home);
  const vscode = withCopilot(fakeVscode(), '0.31.2');
  await writeVersions({ vscode, file });
  watchVersions({ vscode, file });
  vscode.extensions.getExtension = () => ({ packageJSON: { version: '0.32.0' } });
  await vscode.changed();
  assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).runtime, '0.32.0');
});

test('a version it can\'t read is left out, never guessed', async () => {
  const home = tempFolder('wh-versions-');
  const file = versionsFile(home);
  await writeVersions({ vscode: withCopilot(fakeVscode(), null), file });
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), { vscode: '1.105.0' });
  const odd = withCopilot(fakeVscode(), 'latest');
  await writeVersions({ vscode: odd, file });
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), { vscode: '1.105.0' });
});

test('an unchanged record is not written again, and a record that can\'t be written is no failure', async () => {
  const home = tempFolder('wh-versions-');
  const file = versionsFile(home);
  const vscode = withCopilot(fakeVscode(), '0.31.2');
  assert.equal(await writeVersions({ vscode, file }), true);
  const before = fs.statSync(file).mtimeMs;
  assert.equal(await writeVersions({ vscode, file }), false);
  assert.equal(fs.statSync(file).mtimeMs, before);
  // A file under a file: it can't be made.
  const blocked = path.join(file, 'x', 'y.json');
  assert.equal(await writeVersions({ vscode, file: blocked }), false);
});
