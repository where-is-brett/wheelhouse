// tests/scripts/update/account-settings.test.js
// The one line of the account's settings the update may change: the Wheelhouse catalogue's `ref`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { accountCatalogue, moveAccountRef } from '../../../scripts/update/account-settings.js';
import { tempFolder } from '../../helpers/homes.js';

const github = (ref) => ({ source: { source: 'github', repo: 'where-is-brett/wheelhouse', ...(ref ? { ref } : {}) } });
function home(text) {
  const dir = tempFolder('wh-acct-');
  if (text !== null) fs.writeFileSync(path.join(dir, 'settings.json'), text);
  return { dir, file: path.join(dir, 'settings.json'), read: () => fs.readFileSync(path.join(dir, 'settings.json'), 'utf8') };
}

test('accountCatalogue: not declared, or no file, is nothing to do', () => {
  assert.equal(accountCatalogue({ claudeHome: home(null).dir }), null);
  assert.equal(accountCatalogue({ claudeHome: home('{"model":"x"}').dir }), null);
  assert.equal(accountCatalogue({ claudeHome: home(JSON.stringify({ extraKnownMarketplaces: { other: github('v1.0.0') } })).dir }), null);
  assert.equal(accountCatalogue({ claudeHome: home(JSON.stringify({ extraKnownMarketplaces: { wheelhouse: github() } })).dir }), null, 'no ref means no old ref');
});

test('accountCatalogue: the old ref is named, in every form of the repository address', () => {
  const at = (entry) => accountCatalogue({ claudeHome: home(JSON.stringify({ extraKnownMarketplaces: { wheelhouse: entry } })).dir });
  assert.deepEqual(at(github('v1.0.0')), { ref: 'v1.0.0' });
  assert.deepEqual(at({ source: { source: 'git', url: 'https://github.com/where-is-brett/wheelhouse.git', ref: 'v1.0.0' } }), { ref: 'v1.0.0' });
  assert.deepEqual(at({ source: { source: 'url', url: 'https://github.com/where-is-brett/wheelhouse', ref: 'v1.0.0' } }), { ref: 'v1.0.0' });
});

test('accountCatalogue: another source, or a file that cannot be read, is refused', () => {
  const at = (text) => accountCatalogue({ claudeHome: home(text).dir });
  assert.match(at(JSON.stringify({ extraKnownMarketplaces: { wheelhouse: { source: { source: 'github', repo: 'someone/else', ref: 'v1.0.0' } } } })).refused, /not the Wheelhouse repository/);
  assert.match(at(JSON.stringify({ extraKnownMarketplaces: { wheelhouse: { source: { source: 'git', url: 'https://example.invalid/wheelhouse.git', ref: 'v1.0.0' } } } })).refused, /not the Wheelhouse repository/);
  assert.match(at('{ not json').refused, /can't be read/);
  assert.ok(at(JSON.stringify({ extraKnownMarketplaces: { wheelhouse: { source: { source: 'github', repo: 'where-is-brett/wheelhouse', ref: 5 } } } })).refused);
});

test('moveAccountRef: only the ref changes, every other byte stays', () => {
  const text = '{\r\n\t"model":"mine" ,\n\t"note": "ref\\"x\\" \\u00e9 \\"ref\\": \\"v1.0.0\\"",\n\t"extraKnownMarketplaces": {"other": {"source": {"ref": "v1.0.0"}},\n\t\t"wheelhouse": { "source": { "ref":"v1.0.0", "repo": "where-is-brett/wheelhouse", "source": "github" } } },\n\t"list": [1,2,  3]\n}';
  const h = home(text);
  const done = moveAccountRef({ claudeHome: h.dir, tag: 'v1.1.0' });
  assert.deepEqual(done, { ok: true, changed: true, from: 'v1.0.0' });
  assert.equal(h.read(), text.replace('"ref":"v1.0.0", "repo"', '"ref":"v1.1.0", "repo"'));
});

test('moveAccountRef: nothing to do changes nothing, and a refusal changes nothing', () => {
  const same = home(JSON.stringify({ extraKnownMarketplaces: { wheelhouse: github('v1.1.0') } }));
  const before = same.read();
  assert.deepEqual(moveAccountRef({ claudeHome: same.dir, tag: 'v1.1.0' }), { ok: true, changed: false });
  assert.equal(same.read(), before);
  const other = home(JSON.stringify({ extraKnownMarketplaces: { wheelhouse: { source: { source: 'github', repo: 'someone/else', ref: 'v1.0.0' } } } }));
  const kept = other.read();
  assert.equal(moveAccountRef({ claudeHome: other.dir, tag: 'v1.1.0' }).ok, false);
  assert.equal(other.read(), kept);
  const broken = home('{ nope');
  assert.equal(moveAccountRef({ claudeHome: broken.dir, tag: 'v1.1.0' }).ok, false);
  assert.equal(broken.read(), '{ nope');
  assert.equal(moveAccountRef({ claudeHome: same.dir, tag: 'main' }).ok, false, 'only a release tag');
  assert.deepEqual(moveAccountRef({ claudeHome: home(null).dir, tag: 'v1.1.0' }), { ok: true, changed: false });
});
