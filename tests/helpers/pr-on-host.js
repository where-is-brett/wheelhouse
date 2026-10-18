// tests/helpers/pr-on-host.js
// A pull request on a stand-in host (a bare repository): a commit on top of the
// default branch, at the ref GitHub keeps for pull request `number`, so the
// helper can fetch it and finds it up to date. The default branch is made
// first when the host has none. Resolves with the pull request's head commit.
import fs from 'node:fs';
import path from 'node:path';
import { g } from './git-fixture.js';
import { tempFolder } from './homes.js';

export async function prOnHost(remoteUrl, { number = 7, branch = 'main', files = { 'feature.txt': 'the feature\n' } } = {}) {
  const work = tempFolder('wh-pr-');
  await g(work, 'init', '-q', '-b', branch);
  if ((await g(work, 'ls-remote', '--heads', remoteUrl, `refs/heads/${branch}`)) !== '') {
    await g(work, 'fetch', '-q', remoteUrl, `refs/heads/${branch}`);
    await g(work, 'reset', '-q', '--hard', 'FETCH_HEAD');
  } else {
    fs.writeFileSync(path.join(work, 'README.md'), 'The product.\n');
    await g(work, 'add', '-A');
    await g(work, 'commit', '-q', '-m', 'Base');
    await g(work, 'push', '-q', remoteUrl, `HEAD:refs/heads/${branch}`);
  }
  for (const [name, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(work, name)), { recursive: true });
    fs.writeFileSync(path.join(work, name), text);
  }
  await g(work, 'add', '-A');
  await g(work, 'commit', '-q', '-m', 'The feature');
  await g(work, 'push', '-q', remoteUrl, `HEAD:refs/pull/${number}/head`);
  return g(work, 'rev-parse', 'HEAD');
}
