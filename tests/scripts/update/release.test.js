// tests/scripts/update/release.test.js
// Finding a release for the update: version precedence, listing and picking the latest tag, fetching a
// tag into the mirror, and reading what it says about itself. Git runs for real, but only against a
// repository on this computer; nothing reaches a network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { run as realRun } from '../../../scripts/lib/run.js';
import {
  checkTarget, compareVersions, fetchTag, latestRelease, listReleases, tagRefFor, tagTree,
} from '../../../scripts/update/release.js';
import { RELEASE_WHY } from '../../../scripts/lineage/release.js';
import { g } from '../../helpers/git-fixture.js';
import { tempFolder } from '../../helpers/homes.js';

test('compareVersions orders by semantic versioning precedence', () => {
  assert.equal(compareVersions('0.3.0-rc.1', '0.3.0'), -1);
  assert.equal(compareVersions('0.3.0', '0.3.0-rc.1'), 1);
  assert.equal(compareVersions('v0.2.10', '0.2.9'), 1);
  assert.equal(compareVersions('v0.2.9', 'v0.2.9'), 0);
  assert.equal(compareVersions('0.2', '0.2.0'), 0);
  assert.equal(compareVersions('0.3.0+build5', '0.3.0'), 0);
  assert.equal(compareVersions('0.3.0-rc.2', '0.3.0-rc.10'), -1);
  assert.equal(compareVersions('0.3.0-rc', '0.3.0-rc.1'), -1);
  assert.equal(compareVersions('0.3.0-1', '0.3.0-alpha'), -1);
  assert.equal(compareVersions('0.3.0-alpha', '0.3.0-beta'), -1);
  assert.equal(compareVersions('rc', '0.2.0'), null);
  assert.equal(compareVersions('0.2.0', undefined), null);
  assert.equal(compareVersions('', '0.2.0'), null);
});

test('latestRelease picks the highest plain vX.Y.Z', () => {
  const sha = (n) => String(n).repeat(40);
  const list = [
    { tag: 'v0.2.9', sha: sha(1) }, { tag: 'v0.2.10', sha: sha(2) }, { tag: 'v0.3.0-rc.1', sha: sha(3) },
    { tag: 'v0.2', sha: sha(4) }, { tag: 'nightly', sha: sha(5) },
  ];
  assert.deepEqual(latestRelease(list), { tag: 'v0.2.10', sha: sha(2) });
  assert.equal(latestRelease([{ tag: 'v0.3.0-rc.1', sha: sha(3) }]), null);
  assert.equal(latestRelease([]), null);
  assert.equal(latestRelease(null), null);
});

// A stand-in for Wheelhouse's repository, on this computer.
async function stand() {
  const dir = tempFolder('wh-update-release-');
  const repo = path.join(dir, 'wheelhouse');
  fs.mkdirSync(repo);
  await g(repo, 'init', '-q', '-b', 'main');
  const put = async (files, message) => {
    for (const [name, text] of Object.entries(files)) {
      const file = path.join(repo, name);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, text);
    }
    await g(repo, 'add', '-A');
    await g(repo, 'commit', '-q', '-m', message);
    return g(repo, 'rev-parse', 'HEAD');
  };
  const plugin = (version) => `${JSON.stringify({ name: 'wheelhouse', version })}\n`;
  const manifest = `${JSON.stringify({ v: 1, claudeCode: { floor: '2.1.299' }, node: { floor: '22.0.0' } })}\n`;
  const shas = {};
  shas['v0.2.9'] = await put({ '.claude-plugin/plugin.json': plugin('0.2.9') }, 'v0.2.9');
  await g(repo, 'tag', 'v0.2.9');
  shas['v0.2.10'] = await put({
    '.claude-plugin/plugin.json': plugin('0.2.10'),
    'lineage/manifest.json': manifest,
    'lineage/release.json': `${JSON.stringify({ kind: 'changes', lineage: 'passed', says: 'It can update itself.\nIt keeps your own files.' })}\n`,
  }, 'v0.2.10');
  await g(repo, 'tag', '-a', 'v0.2.10', '-m', 'release');
  shas['v0.2.11'] = await put({ '.claude-plugin/plugin.json': plugin('0.2.12') }, 'v0.2.11');
  await g(repo, 'tag', 'v0.2.11');
  shas['v0.3.0-rc.1'] = await put({ '.claude-plugin/plugin.json': plugin('0.3.0-rc.1') }, 'rc');
  await g(repo, 'tag', 'v0.3.0-rc.1');
  await g(repo, 'checkout', '-q', '-b', 'side');
  shas['v0.4.0'] = await put({ '.claude-plugin/plugin.json': plugin('0.4.0') }, 'side');
  await g(repo, 'tag', 'v0.4.0');
  await g(repo, 'checkout', '-q', 'main');
  return { dir, repo, url: pathToFileURL(repo).href, shas, mirror: path.join(dir, 'mirror.git') };
}

test('listReleases reads the tags and prefers an annotated tag\'s commit', async () => {
  const s = await stand();
  const list = await listReleases({ run: realRun, url: s.url });
  const byTag = Object.fromEntries(list.map(({ tag, sha }) => [tag, sha]));
  assert.equal(byTag['v0.2.10'], s.shas['v0.2.10'], 'the peeled commit, not the tag object');
  assert.equal(byTag['v0.2.9'], s.shas['v0.2.9']);
  assert.deepEqual(latestRelease(list), { tag: 'v0.4.0', sha: s.shas['v0.4.0'] }, 'the list does not check the default branch; fetchTag does');
  assert.equal(list.some((item) => item.tag.includes('^')), false);
});

test('listReleases throws when the repository can\'t be read', async () => {
  const dir = tempFolder('wh-update-release-none-');
  await assert.rejects(() => listReleases({ run: realRun, url: pathToFileURL(path.join(dir, 'missing')).href }), /could not be read/);
});

test('fetchTag keeps the tag in the mirror and refuses one off the default branch', async () => {
  const s = await stand();
  const got = await fetchTag({ ref: 'v0.2.10', run: realRun, mirror: s.mirror, url: s.url });
  assert.deepEqual(got, { ok: true, sha: s.shas['v0.2.10'] });
  const kept = await g(s.mirror, 'rev-parse', `${tagRefFor('v0.2.10')}^{commit}`);
  assert.equal(kept, s.shas['v0.2.10'], 'the tag ref stays for the own-files look');
  const refs = await g(s.mirror, 'for-each-ref', '--format=%(refname)');
  assert.equal(refs.includes('wheelhouse/release/default'), false, 'the default branch ref is tidied away');

  const side = await fetchTag({ ref: 'v0.4.0', run: realRun, mirror: s.mirror, url: s.url });
  assert.deepEqual(side, { ok: false, why: RELEASE_WHY.branch });
  const gone = await fetchTag({ ref: 'v9.9.9', run: realRun, mirror: s.mirror, url: s.url });
  assert.deepEqual(gone, { ok: false, why: RELEASE_WHY.fetch });
  const odd = await fetchTag({ ref: '--upload-pack=x', run: realRun, mirror: s.mirror, url: s.url });
  assert.deepEqual(odd, { ok: false, why: RELEASE_WHY.shape });
});

test('checkTarget reads the version, the lines for the card and the floors', async () => {
  const s = await stand();
  await fetchTag({ ref: 'v0.2.10', run: realRun, mirror: s.mirror, url: s.url });
  const got = await checkTarget({ tag: 'v0.2.10', sha: s.shas['v0.2.10'], run: realRun, mirror: s.mirror });
  assert.deepEqual(got, {
    ok: true, version: '0.2.10', says: 'It can update itself.\nIt keeps your own files.', nodeFloor: '22.0.0', claudeFloor: '2.1.299',
  });
});

test('checkTarget gives null for a release with no summary or manifest', async () => {
  const s = await stand();
  await fetchTag({ ref: 'v0.2.9', run: realRun, mirror: s.mirror, url: s.url });
  const got = await checkTarget({ tag: 'v0.2.9', sha: s.shas['v0.2.9'], run: realRun, mirror: s.mirror });
  assert.deepEqual(got, { ok: true, version: '0.2.9', says: null, nodeFloor: null, claudeFloor: null });
});

test('checkTarget refuses a tag whose plugin.json says another version, naming it', async () => {
  const s = await stand();
  await fetchTag({ ref: 'v0.2.11', run: realRun, mirror: s.mirror, url: s.url });
  const got = await checkTarget({ tag: 'v0.2.11', sha: s.shas['v0.2.11'], run: realRun, mirror: s.mirror });
  assert.equal(got.ok, false);
  assert.match(got.why, /v0\.2\.11/);
  assert.match(got.why, /0\.2\.12/);
});

test('checkTarget refuses a commit that isn\'t the tag\'s, and a tag that was not fetched', async () => {
  const s = await stand();
  await fetchTag({ ref: 'v0.2.10', run: realRun, mirror: s.mirror, url: s.url });
  const wrong = await checkTarget({ tag: 'v0.2.10', sha: s.shas['v0.2.9'], run: realRun, mirror: s.mirror });
  assert.deepEqual([wrong.ok, wrong.why], [false, RELEASE_WHY.commit]);
  const notFetched = await checkTarget({ tag: 'v0.2.9', sha: s.shas['v0.2.9'], run: realRun, mirror: s.mirror });
  assert.deepEqual([notFetched.ok, notFetched.why], [false, RELEASE_WHY.fetch]);
  const shape = await checkTarget({ tag: 'v0.3.0-rc.1', sha: s.shas['v0.3.0-rc.1'], run: realRun, mirror: s.mirror });
  assert.deepEqual([shape.ok, shape.why], [false, RELEASE_WHY.shape]);
});

test('tagTree maps every path of the tag to its blob hash', async () => {
  const s = await stand();
  await fetchTag({ ref: 'v0.2.10', run: realRun, mirror: s.mirror, url: s.url });
  const tree = await tagTree({ tag: 'v0.2.10', run: realRun, mirror: s.mirror });
  assert.deepEqual([...tree.keys()].sort(), ['.claude-plugin/plugin.json', 'lineage/manifest.json', 'lineage/release.json']);
  const expected = await g(s.repo, 'rev-parse', 'v0.2.10:lineage/manifest.json');
  assert.equal(tree.get('lineage/manifest.json'), expected);
  await assert.rejects(() => tagTree({ tag: 'v0.2.9', run: realRun, mirror: s.mirror }), /could not be read/);
});
