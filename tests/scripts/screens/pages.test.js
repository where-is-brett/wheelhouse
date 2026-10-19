// tests/scripts/screens/pages.test.js
// Where the helper's browser may be pointed: a plain page path, on a preview's https address on a
// public host. Anything on this computer or its local network is refused, however it is spelt.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isPage, publicHttps } from '../../../scripts/screens/pages.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

test('a page is a plain path on the preview', () => {
  for (const page of ['/', '/pricing', '/pricing?plan=pro', '/v1.2/notes...', '/search?q=../x', '/a/b#c']) assert.equal(isPage(page), true, page);
  for (const page of ['pricing', '//evil.example.com/', 'https://evil.example.com/', '/\\evil', '/a b', '', null, 7, '/../x', '/%2e%2e/x', '/./x', '/a/..']) {
    assert.equal(isPage(page), false, String(page));
  }
});

test('an ordinary https address on a public host passes, as the host gave it', () => {
  for (const [given, href] of [
    ['https://preview-abc.example.app/', 'https://preview-abc.example.app/'],
    ['https://review.example.com/shop/mr-12', 'https://review.example.com/shop/mr-12'],
    ['https://8.8.8.8/', 'https://8.8.8.8/'],
    ['https://172.32.0.1/', 'https://172.32.0.1/'],
    ['https://[2606:4700::1111]/', 'https://[2606:4700::1111]/'],
    ['https://mylocalhost.example/', 'https://mylocalhost.example/'],
    ['https://localhost.example.app/', 'https://localhost.example.app/'],
  ]) assert.equal(publicHttps(given), href, given);
});

test('anything not https, or not an address, is refused', () => {
  for (const given of ['http://preview.example.app/', 'file:///etc/passwd', 'javascript:alert(1)', '/pricing', '', 'not an address', null, undefined, 7]) {
    assert.equal(publicHttps(given), null, String(given));
  }
});

test('loopback, private, link-local and unspecified IPv4 addresses are refused, however they are spelt', () => {
  for (const given of [
    // loopback, 127/8, including the short, hexadecimal, whole-number and trailing-dot spellings
    'https://127.0.0.1/', 'https://127.1.2.3:8443/x', 'https://127.1/', 'https://0x7f.0.0.1/', 'https://2130706433/', 'https://127.0.0.1./',
    // private: 10/8, 172.16/12, 192.168/16
    'https://10.0.0.1/', 'https://10.255.255.255/', 'https://172.16.0.1/', 'https://172.31.255.254/', 'https://192.168.1.10/',
    // link-local, 169.254/16 (a cloud computer's metadata address among them)
    'https://169.254.169.254/latest/meta-data/', 'https://169.254.0.1/',
    // unspecified
    'https://0.0.0.0/', 'https://0/',
  ]) assert.equal(publicHttps(given), null, given);
});

test('loopback, private, link-local and unspecified IPv6 addresses are refused, however they are spelt', () => {
  for (const given of [
    'https://[::1]/', 'https://[0:0:0:0:0:0:0:1]/', 'https://[::]/',
    // unique local, fc00::/7
    'https://[fc00::1]/', 'https://[fd12:3456:789a::1]/',
    // link-local, fe80::/10
    'https://[fe80::1]/', 'https://[febf::1]/',
    // an IPv4 address written as IPv6, mapped or compatible
    'https://[::ffff:127.0.0.1]/', 'https://[::ffff:7f00:1]/', 'https://[::ffff:10.0.0.1]/', 'https://[::127.0.0.1]/',
  ]) assert.equal(publicHttps(given), null, given);
});

test('localhost and every name under .localhost are refused', () => {
  for (const given of ['https://localhost/', 'https://LOCALHOST:3000/', 'https://localhost./', 'https://shop.localhost/', 'https://a.b.Localhost/', 'https://shop.localhost./']) {
    assert.equal(publicHttps(given), null, given);
  }
});

test('the gate\'s configuration check loads neither the browser runner nor the comparison', () => {
  // Every module guardrails.js reaches through its imports, read from the files themselves.
  const reached = new Set();
  const visit = (file) => {
    if (reached.has(file)) return;
    reached.add(file);
    const source = fs.readFileSync(file, 'utf8');
    for (const [, spec] of source.matchAll(/^\s*import\s[^'"]*['"](\.{1,2}\/[^'"]+)['"]/gm)) visit(path.resolve(path.dirname(file), spec));
  };
  visit(path.join(ROOT, 'scripts/gate/guardrails.js'));
  const names = [...reached].map((file) => path.relative(ROOT, file).split(path.sep).join('/'));
  assert.ok(names.includes('scripts/screens/pages.js'), names.join(', '));
  for (const heavy of ['scripts/screens/shoot.js', 'scripts/screens/compare.js', 'scripts/screens/png.js', 'scripts/lib/run.js']) {
    assert.equal(names.includes(heavy), false, heavy);
  }
});
