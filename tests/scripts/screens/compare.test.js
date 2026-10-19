// tests/scripts/screens/compare.test.js
// Whether two commits' previews look the same on every page at every size, and the per-commit
// cache of their hashes. Any doubt answers false.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { screenshotsMatch, cachedShooter } from '../../../scripts/screens/compare.js';
import { shoot, findBrowser } from '../../../scripts/screens/shoot.js';
import { SCREEN_SIZES } from '../../../scripts/lib/front-desk.js';
import { encodePng, solid } from '../../fixtures/screens/encode.js';
import { tempFolder } from '../../helpers/homes.js';

const BEFORE = 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678';
const AFTER = 'ffeeddccbbaa99887766554433221100ffeeddcc';
const H1 = '1'.repeat(64);
const H2 = '2'.repeat(64);

// A shootAt from a table of "<sha> <page> <width>x<height>" → hash (missing: a failed shot).
function table(hashes) {
  const calls = [];
  const shootAt = async (sha, page, size) => {
    calls.push(`${sha} ${page} ${size.width}x${size.height}`);
    const hash = hashes[`${sha} ${page} ${size.width}x${size.height}`];
    return hash ? { ok: true, hash } : { ok: false, why: 'no picture' };
  };
  shootAt.calls = calls;
  return shootAt;
}

// Every page at every size for both commits, with the same hash unless `except` says otherwise.
function allSame(pages, except = {}) {
  const hashes = {};
  for (const sha of [BEFORE, AFTER]) {
    for (const page of pages) for (const { width, height } of SCREEN_SIZES) hashes[`${sha} ${page} ${width}x${height}`] = H1;
  }
  return { ...hashes, ...except };
}

// A fake shoot that remembers what it was asked and answers `answer`.
function fakeShoot(answer = { ok: true, hash: H1 }) {
  const calls = [];
  const fn = async (options) => {
    calls.push(options);
    return typeof answer === 'function' ? answer(options) : answer;
  };
  fn.calls = calls;
  return fn;
}

const previews = { [BEFORE]: 'https://shop-a1b2c3d.example.app', [AFTER]: 'https://shop-ffeeddc.example.app/' };
const previewUrl = async (sha) => previews[sha] ?? null;

test('every page and every size must match', async () => {
  const pages = ['/', '/pricing'];
  assert.equal(await screenshotsMatch({ before: BEFORE, after: AFTER, pages, shootAt: table(allSame(pages)) }), true);
  for (const { width, height } of SCREEN_SIZES) {
    for (const page of pages) {
      const differs = table(allSame(pages, { [`${AFTER} ${page} ${width}x${height}`]: H2 }));
      assert.equal(await screenshotsMatch({ before: BEFORE, after: AFTER, pages, shootAt: differs }), false, `${page} ${width}x${height}`);
      const missing = table(allSame(pages, { [`${BEFORE} ${page} ${width}x${height}`]: undefined }));
      assert.equal(await screenshotsMatch({ before: BEFORE, after: AFTER, pages, shootAt: missing }), false);
    }
  }
  // Every size was asked for, at both commits.
  const shootAt = table(allSame(pages));
  await screenshotsMatch({ before: BEFORE, after: AFTER, pages, shootAt });
  assert.equal(shootAt.calls.length, pages.length * SCREEN_SIZES.length * 2);
  // It stops at the first difference.
  const early = table(allSame(pages, { [`${AFTER} / 1280x800`]: H2 }));
  await screenshotsMatch({ before: BEFORE, after: AFTER, pages, shootAt: early });
  assert.equal(early.calls.length, 2);
});

test('no pages, no commits or a shooter that throws do not match', async () => {
  const shootAt = table(allSame(['/']));
  assert.equal(await screenshotsMatch({ before: BEFORE, after: AFTER, pages: [], shootAt }), false);
  assert.equal(await screenshotsMatch({ before: BEFORE, after: AFTER, shootAt }), false);
  assert.equal(await screenshotsMatch({ before: '', after: AFTER, pages: ['/'], shootAt }), false);
  assert.equal(await screenshotsMatch({ before: BEFORE, after: null, pages: ['/'], shootAt }), false);
  assert.equal(await screenshotsMatch({ before: BEFORE, after: AFTER, pages: ['/'], sizes: [], shootAt }), false);
  assert.equal(await screenshotsMatch({ before: BEFORE, after: AFTER, pages: ['/'] }), false);
  assert.equal(await screenshotsMatch(), false);
  const throws = async () => { throw new Error('boom'); };
  assert.equal(await screenshotsMatch({ before: BEFORE, after: AFTER, pages: ['/'], shootAt: throws }), false);
  // An answer that says ok but carries no hash is not a match either.
  assert.equal(await screenshotsMatch({ before: BEFORE, after: AFTER, pages: ['/'], shootAt: async () => ({ ok: true }) }), false);
});

test('no browser installed means no match', async () => {
  const browser = findBrowser({ platform: 'darwin', exists: () => false, env: { HOME: '/Users/director' } });
  assert.equal(browser, null);
  const shot = fakeShoot();
  const shootAt = cachedShooter({ dir: tempFolder('wh-screens-'), previewUrl, shoot: shot, browser });
  assert.deepEqual(await shootAt(BEFORE, '/', SCREEN_SIZES[0]), { ok: false, why: 'no browser' });
  assert.equal(await screenshotsMatch({ before: BEFORE, after: AFTER, pages: ['/'], shootAt }), false);
  assert.equal(shot.calls.length, 0);
});

test('a page that loads with a 404 at both commits does not match', async () => {
  // The real shoot, with a fetch that answers 404 everywhere and a browser that would draw the same page.
  const png = encodePng({ width: 2, height: 2, pixels: solid(2, 2, [255, 255, 255]) });
  const runs = [];
  const run = async (file, args) => {
    runs.push(args);
    fs.writeFileSync(args.find((a) => a.startsWith('--screenshot=')).slice('--screenshot='.length), png);
    return { code: 0, stdout: '', stderr: '' };
  };
  const fetch = async () => new Response('Not found', { status: 404 });
  const dir = tempFolder('wh-screens-');
  const shootAt = cachedShooter({ dir, previewUrl, shoot, browser: '/bin/chrome', run, fetch, tmp: tempFolder('wh-shoot-') });
  assert.equal(await screenshotsMatch({ before: BEFORE, after: AFTER, pages: ['/missing'], shootAt }), false);
  assert.equal(runs.length, 0);
  // Nothing failed is kept.
  assert.deepEqual(fs.readdirSync(dir), []);
});

test('a preview missing for either commit does not match', async () => {
  for (const missing of [BEFORE, AFTER]) {
    const shot = fakeShoot();
    const shootAt = cachedShooter({ dir: tempFolder('wh-screens-'), previewUrl: async (sha) => (sha === missing ? null : previews[sha]), shoot: shot, browser: '/bin/chrome' });
    assert.equal(await screenshotsMatch({ before: BEFORE, after: AFTER, pages: ['/'], shootAt }), false);
    assert.deepEqual(await shootAt(missing, '/', SCREEN_SIZES[0]), { ok: false, why: 'no preview' });
  }
  // A preview lookup that fails is the same as none.
  const shootAt = cachedShooter({ dir: tempFolder('wh-screens-'), previewUrl: async () => { throw new Error('host down'); }, shoot: fakeShoot(), browser: '/bin/chrome' });
  assert.equal((await shootAt(BEFORE, '/', SCREEN_SIZES[0])).ok, false);
});

test('pages are joined onto the preview and must stay on it', async () => {
  const shot = fakeShoot();
  const run = async () => ({ code: 0 });
  const fetch = async () => new Response(null);
  const tmp = tempFolder('wh-shoot-');
  const shootAt = cachedShooter({ dir: tempFolder('wh-screens-'), previewUrl, shoot: shot, browser: '/bin/chrome', run, fetch, tmp });
  assert.deepEqual(await shootAt(BEFORE, '/pricing?plan=pro', SCREEN_SIZES[1]), { ok: true, hash: H1 });
  assert.deepEqual(await shootAt(AFTER, '/', SCREEN_SIZES[1]), { ok: true, hash: H1 });
  assert.equal(shot.calls[0].url, 'https://shop-a1b2c3d.example.app/pricing?plan=pro');
  assert.equal(shot.calls[1].url, 'https://shop-ffeeddc.example.app/');
  assert.deepEqual(shot.calls[0].size, SCREEN_SIZES[1]);
  assert.equal(shot.calls[0].browser, '/bin/chrome');
  assert.equal(shot.calls[0].run, run);
  assert.equal(shot.calls[0].fetch, fetch);
  assert.equal(shot.calls[0].tmp, tmp);

  for (const page of ['pricing', '//evil.example.com/', 'https://evil.example.com/', '/\\evil.example.com', '', null, 7]) {
    const answer = await shootAt(BEFORE, page, SCREEN_SIZES[0]);
    assert.equal(answer.ok, false, String(page));
  }
  assert.equal(shot.calls.length, 2);

  // A preview under a path keeps it.
  const nested = fakeShoot();
  const under = cachedShooter({ dir: tempFolder('wh-screens-'), previewUrl: async () => 'https://review.example.com/shop/mr-12/', shoot: nested, browser: '/bin/chrome' });
  await under(BEFORE, '/pricing', SCREEN_SIZES[0]);
  assert.equal(nested.calls[0].url, 'https://review.example.com/shop/mr-12/pricing');

  // A page can't climb out of a preview under a path into another deployment, however it is spelt.
  for (const page of ['/../mr-11/', '/%2e%2e/mr-11/', '/%2E%2E/mr-11/', '/.%2e/mr-11/', '/./pricing', '/%2e/pricing', '/a/../../mr-11/', '/..', '/pricing/..?x=1']) {
    assert.equal((await under(BEFORE, page, SCREEN_SIZES[0])).ok, false, page);
  }
  // Dots inside a name, or after the path, are fine.
  await under(BEFORE, '/v1.2/notes...', SCREEN_SIZES[0]);
  await under(BEFORE, '/search?q=../x', SCREEN_SIZES[0]);
  assert.deepEqual(nested.calls.slice(1).map((c) => c.url), ['https://review.example.com/shop/mr-12/v1.2/notes...', 'https://review.example.com/shop/mr-12/search?q=../x']);
});

test('hashes are cached per commit and page, and answer when the preview has gone', async () => {
  const dir = tempFolder('wh-screens-');
  const shot = fakeShoot();
  let live = true;
  const shootAt = cachedShooter({ dir, previewUrl: async (sha) => (live ? previews[sha] : null), shoot: shot, browser: '/bin/chrome' });
  assert.equal(await screenshotsMatch({ before: BEFORE, after: AFTER, pages: ['/', '/about'], shootAt }), true);
  assert.equal(shot.calls.length, 2 * SCREEN_SIZES.length * 2);
  const saved = JSON.parse(fs.readFileSync(path.join(dir, `${BEFORE}.json`), 'utf8'));
  assert.equal(saved[`/about ${SCREEN_SIZES[0].width}x${SCREEN_SIZES[0].height}`], H1);
  assert.equal(Object.keys(saved).length, 2 * SCREEN_SIZES.length);

  live = false;
  assert.equal(await screenshotsMatch({ before: BEFORE, after: AFTER, pages: ['/', '/about'], shootAt }), true);
  assert.equal(shot.calls.length, 2 * SCREEN_SIZES.length * 2);
  // A page not photographed before needs the preview.
  assert.equal(await screenshotsMatch({ before: BEFORE, after: AFTER, pages: ['/', '/contact'], shootAt }), false);
});

test('a failed photograph is not cached, and a broken cache file is a miss', async () => {
  const dir = tempFolder('wh-screens-');
  let answer = { ok: false, why: 'timed out' };
  const shot = fakeShoot(() => answer);
  const shootAt = cachedShooter({ dir, previewUrl, shoot: shot, browser: '/bin/chrome' });
  assert.equal((await shootAt(BEFORE, '/', SCREEN_SIZES[0])).ok, false);
  assert.equal(fs.existsSync(path.join(dir, `${BEFORE}.json`)), false);
  answer = { ok: true, hash: H2 };
  assert.deepEqual(await shootAt(BEFORE, '/', SCREEN_SIZES[0]), { ok: true, hash: H2 });
  assert.equal(shot.calls.length, 2);

  for (const broken of ['{not json', '[]', 'null', JSON.stringify({ [`/ ${SCREEN_SIZES[0].width}x${SCREEN_SIZES[0].height}`]: 'not a hash' })]) {
    fs.writeFileSync(path.join(dir, `${AFTER}.json`), broken);
    const before = shot.calls.length;
    assert.deepEqual(await shootAt(AFTER, '/', SCREEN_SIZES[0]), { ok: true, hash: H2 });
    assert.equal(shot.calls.length, before + 1, broken);
  }
});

test('a photograph whose cache can not be written is still answered', async () => {
  const blocker = path.join(tempFolder('wh-screens-'), 'a-file');
  fs.writeFileSync(blocker, '');
  const shot = fakeShoot({ ok: true, hash: H2 });
  // The cache folder sits under a file, so it can't be made.
  const shootAt = cachedShooter({ dir: path.join(blocker, 'cache'), previewUrl, shoot: shot, browser: '/bin/chrome' });
  assert.deepEqual(await shootAt(BEFORE, '/', SCREEN_SIZES[0]), { ok: true, hash: H2 });
  assert.equal(await screenshotsMatch({ before: BEFORE, after: AFTER, pages: ['/'], shootAt }), true);
});

test('two pictures of one commit taken at once both reach its cache file', async () => {
  const dir = tempFolder('wh-screens-');
  const shootAt = cachedShooter({ dir, previewUrl, shoot: fakeShoot(), browser: '/bin/chrome' });
  const answers = await Promise.all(SCREEN_SIZES.map((size) => shootAt(BEFORE, '/', size)));
  assert.ok(answers.every((a) => a.ok));
  assert.deepEqual(fs.readdirSync(dir), [`${BEFORE}.json`]);
});

test('a commit that is not a commit id is refused, never used as a path', async () => {
  const dir = tempFolder('wh-screens-');
  const shot = fakeShoot();
  const shootAt = cachedShooter({ dir, previewUrl: async () => 'https://shop.example.app', shoot: shot, browser: '/bin/chrome' });
  for (const sha of ['../../etc/passwd', 'abc', 'HEAD', `${BEFORE}/x`, '', null, 'g'.repeat(40)]) {
    assert.equal((await shootAt(sha, '/', SCREEN_SIZES[0])).ok, false, String(sha));
  }
  assert.equal(shot.calls.length, 0);
  assert.deepEqual(fs.readdirSync(dir), []);
});
