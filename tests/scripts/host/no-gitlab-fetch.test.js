// tests/scripts/host/no-gitlab-fetch.test.js
// Wheelhouse's own calls to GitLab go through curl (scripts/host/curl.js), which can pass a company's proxy;
// Node's fetch cannot. No fetch call in scripts/host, scripts/setup or scripts/install names a GitLab address,
// and the files that make the GitLab client and the certificate probe do not take a fetch at all.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const FOLDERS = ['scripts/host', 'scripts/setup', 'scripts/install'];

const jsFiles = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
  const full = path.join(dir, e.name);
  if (e.isDirectory()) return jsFiles(full);
  return e.name.endsWith('.js') ? [full] : [];
});

// The lines of a file that call fetch and say GitLab in the same line (an address, GITLAB or a client's root).
const GITLAB_WORDS = /api\/v4|gitlab|\$\{root\}/i;
export function gitlabFetchLines(text) {
  return text.split('\n').filter((line) => /(?<![\w.])fetch\s*\(/.test(line) && GITLAB_WORDS.test(line));
}

test('no GitLab call in scripts/host, scripts/setup or scripts/install is made with fetch', () => {
  const found = [];
  for (const folder of FOLDERS) {
    for (const file of jsFiles(path.join(ROOT, folder))) {
      const hits = gitlabFetchLines(fs.readFileSync(file, 'utf8'));
      if (hits.length > 0) found.push(path.relative(ROOT, file));
    }
  }
  assert.deepEqual(found, []);
});

test('the check sees a fetch of a GitLab address and leaves a GitHub one alone', () => {
  assert.equal(gitlabFetchLines('const r = await fetch(`${root}${path}`, {});').length, 1);
  assert.equal(gitlabFetchLines("await fetch('https://gitlab.com/api/v4/version');").length, 1);
  assert.equal(gitlabFetchLines('const r = await fetch(`${GITHUB_API}/user/installations`);').length, 0);
});

test('the GitLab client and the certificate probe take no fetch', () => {
  for (const file of ['scripts/host/gitlab-key.js', 'scripts/host/company-ca.js', 'scripts/host/cut-access.js']) {
    assert.doesNotMatch(fs.readFileSync(path.join(ROOT, file), 'utf8'), /\bfetch\b(?!-| mirror)/, `${file} mentions fetch`);
  }
});
