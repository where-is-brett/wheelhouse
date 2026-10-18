// tests/scripts/host/helper-config.test.js
// /config: the project's configuration as the default branch has it, read in
// the helper's mirror, so the watcher never reads a working copy an agent can edit.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { readConfig } from '../../../scripts/gate/guardrails.js';
import { startHelper } from '../../../scripts/host/helper.js';
import { helperClient } from '../../../scripts/host/helper-client.js';
import { writeProject } from '../../../scripts/lib/projects.js';
import { setStop } from '../../../scripts/lib/stop.js';
import { cloneState } from '../../../scripts/state/clone.js';
import { makeBareRemote, g } from '../../helpers/git-fixture.js';
import { as, shortHome, tempFolder, testAddress } from '../../helpers/homes.js';

const fakeAdapter = () => ({ defaultBranch: async () => 'main' });
const base = { v: 1, criticalAreas: [], ciFiles: [], mcpServers: [], webDomains: [] };

function write(dir, files) {
  for (const [name, text] of Object.entries(files)) {
    const file = path.join(dir, name);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, text);
  }
}

// A remote whose main holds `files`, and a branch that changes the configuration.
async function remoteWith(files) {
  const remote = await makeBareRemote({ repo: 'o/p' });
  const work = tempFolder('wh-work-');
  await g(work, 'init', '-q', '-b', 'main');
  write(work, { 'README.md': 'r\n', ...files });
  await g(work, 'add', '-A');
  await g(work, 'commit', '-q', '-m', 'Base');
  await g(work, 'remote', 'add', 'origin', remote.url);
  await g(work, 'push', '-q', 'origin', 'main');
  await g(work, 'checkout', '-q', '-b', 'feature/x');
  write(work, { '.claude/wheelhouse.json': JSON.stringify({ ...base, watcherShape: 1, sessionMode: 'plan' }) });
  await g(work, 'add', '-A');
  await g(work, 'commit', '-q', '-m', 'Change the configuration');
  await g(work, 'push', '-q', 'origin', 'feature/x');
  return remote;
}

async function withHelper(remote, fn) {
  const home = shortHome();
  return as(home, async () => {
    writeProject('o__p', {
      folder: path.join(home, 'work'), remoteUrl: remote.url, host: 'github', repo: 'o/p', connection: { host: 'github', mode: 'quick', project: 'o/p' },
    });
    await cloneState({ project: 'o__p', remoteUrl: remote.url });
    const helper = await startHelper({ address: testAddress(home), adapterFor: async () => fakeAdapter(), envFor: async () => ({}) });
    try {
      return await fn(helperClient({ address: helper.address }));
    } finally {
      await helper.close();
    }
  });
}

test('/config answers the default branch\'s configuration, also under STOP', async () => {
  const given = { ...base, watcherShape: 2, routing: { foreman: 'model-a' } };
  const remote = await remoteWith({ '.claude/wheelhouse.json': JSON.stringify(given) });
  try {
    await withHelper(remote, async (client) => {
      const answer = await client.config({ project: 'o__p' });
      assert.equal(answer.ok, true);
      assert.deepEqual(answer.config, readConfig(JSON.stringify(given)));
      setStop({ by: 'prompt' });
      assert.deepEqual((await client.config({ project: 'o__p' })).config, answer.config, 'read-only, so STOP lets it through');
    });
  } finally { remote.cleanup(); }
});

test('/config with no configuration file is the empty configuration; an unreadable one is refused', async () => {
  const none = await remoteWith({});
  try {
    await withHelper(none, async (client) => {
      assert.deepEqual((await client.config({ project: 'o__p' })).config, readConfig(null));
    });
  } finally { none.cleanup(); }
  const bad = await remoteWith({ '.claude/wheelhouse.json': JSON.stringify({ ...base, sessionMode: 'bypassPermissions' }) });
  try {
    await withHelper(bad, async (client) => {
      const answer = await client.config({ project: 'o__p' });
      assert.equal(answer.ok, false);
      assert.match(answer.refused, /configuration/);
    });
  } finally { bad.cleanup(); }
});
