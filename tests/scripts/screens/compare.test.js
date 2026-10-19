// tests/scripts/screens/compare.test.js
// Whether two commits' previews look the same on every page at every size, and the per-commit
// cache of their hashes, each kept with the preview address it came from. Any doubt answers false.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { screenshotsMatch, compareCommits, photographCommit } from '../../../scripts/screens/compare.js';
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

const S0 = `${SCREEN_SIZES[0].width}x${SCREEN_SIZES[0].height}`;
const keyed = (pages) => pages.flatMap((page) => SCREEN_SIZES.map(({ width, height }) => `${page} ${width}x${height}`));
const savedOf = (dir, sha) => JSON.parse(fs.readFileSync(path.join(dir, `${sha}.json`), 'utf8'));
const compare = (options) => compareCommits({ before: BEFORE, after: AFTER, pages: ['/'], previewUrl, browser: '/bin/chrome', ...options });

test('no browser installed means no match', async () => {
  const browser = findBrowser({ platform: 'darwin', exists: () => false, env: { HOME: '/Users/director' } });
  assert.equal(browser, null);
  const shot = fakeShoot();
  const dir = tempFolder('wh-screens-');
  assert.equal(await compare({ dir, shoot: shot, browser }), false);
  assert.equal(await photographCommit({ sha: BEFORE, pages: ['/'], dir, previewUrl, shoot: shot, browser }), 0);
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
  assert.equal(await compare({ dir, pages: ['/missing'], shoot, run, fetch, tmp: tempFolder('wh-shoot-') }), false);
  assert.equal(runs.length, 0);
  // Nothing failed is kept.
  assert.deepEqual(fs.readdirSync(dir), []);
});

test('a preview missing for either commit does not match', async () => {
  for (const missing of [BEFORE, AFTER]) {
    const shot = fakeShoot();
    const dir = tempFolder('wh-screens-');
    assert.equal(await compare({ dir, shoot: shot, previewUrl: async (sha) => (sha === missing ? null : previews[sha]) }), false);
    assert.equal(await photographCommit({ sha: missing, pages: ['/'], dir, previewUrl: async () => null, shoot: shot, browser: '/bin/chrome' }), 0);
    // With no preview of the head, nothing at all is photographed.
    if (missing === AFTER) assert.equal(shot.calls.length, 0);
  }
  // A preview lookup that fails is the same as none.
  const shot = fakeShoot();
  assert.equal(await compare({ dir: tempFolder('wh-screens-'), shoot: shot, previewUrl: async () => { throw new Error('host down'); } }), false);
  assert.equal(shot.calls.length, 0);
});

test('pages are joined onto the preview and must stay on it', async () => {
  const shot = fakeShoot();
  const run = async () => ({ code: 0 });
  const fetch = async () => new Response(null);
  const tmp = tempFolder('wh-shoot-');
  const dir = tempFolder('wh-screens-');
  const one = { sizes: [SCREEN_SIZES[1]], dir, shoot: shot, browser: '/bin/chrome', previewUrl, run, fetch, tmp };
  assert.equal(await photographCommit({ ...one, sha: BEFORE, pages: ['/pricing?plan=pro'] }), 1);
  assert.equal(await photographCommit({ ...one, sha: AFTER, pages: ['/'] }), 1);
  assert.equal(shot.calls[0].url, 'https://shop-a1b2c3d.example.app/pricing?plan=pro');
  assert.equal(shot.calls[1].url, 'https://shop-ffeeddc.example.app/');
  assert.deepEqual(shot.calls[0].size, SCREEN_SIZES[1]);
  assert.equal(shot.calls[0].browser, '/bin/chrome');
  assert.equal(shot.calls[0].run, run);
  assert.equal(shot.calls[0].fetch, fetch);
  assert.equal(shot.calls[0].tmp, tmp);

  for (const page of ['pricing', '//evil.example.com/', 'https://evil.example.com/', '/\\evil.example.com', '', null, 7]) {
    assert.equal(await photographCommit({ ...one, sha: BEFORE, pages: [page] }), 0, String(page));
    assert.equal(await compare({ dir: tempFolder('wh-screens-'), shoot: shot, pages: [page] }), false, String(page));
  }
  assert.equal(shot.calls.length, 2);

  // A preview under a path keeps it.
  const nested = fakeShoot();
  const under = (page) => photographCommit({ sha: BEFORE, pages: [page], sizes: [SCREEN_SIZES[0]], dir: tempFolder('wh-screens-'), previewUrl: async () => 'https://review.example.com/shop/mr-12/', shoot: nested, browser: '/bin/chrome' });
  await under('/pricing');
  assert.equal(nested.calls[0].url, 'https://review.example.com/shop/mr-12/pricing');

  // A page can't climb out of a preview under a path into another deployment, however it is spelt.
  for (const page of ['/../mr-11/', '/%2e%2e/mr-11/', '/%2E%2E/mr-11/', '/.%2e/mr-11/', '/./pricing', '/%2e/pricing', '/a/../../mr-11/', '/..', '/pricing/..?x=1']) {
    assert.equal(await under(page), 0, page);
  }
  // Dots inside a name, or after the path, are fine.
  await under('/v1.2/notes...');
  await under('/search?q=../x');
  assert.deepEqual(nested.calls.slice(1).map((c) => c.url), ['https://review.example.com/shop/mr-12/v1.2/notes...', 'https://review.example.com/shop/mr-12/search?q=../x']);
});

test('hashes are cached per commit with the address they came from, and answer when the approved commit\'s preview has gone', async () => {
  const dir = tempFolder('wh-screens-');
  const shot = fakeShoot();
  const pages = ['/', '/about'];
  let gone = false;
  const live = async (sha) => (gone && sha === BEFORE ? null : previews[sha]);
  assert.equal(await compare({ dir, shoot: shot, pages, previewUrl: live }), true);
  assert.equal(shot.calls.length, pages.length * SCREEN_SIZES.length * 2);
  assert.deepEqual(savedOf(dir, BEFORE), { address: previews[BEFORE], shots: Object.fromEntries(keyed(pages).map((k) => [k, H1])) });
  assert.equal(savedOf(dir, AFTER).address, previews[AFTER]);

  gone = true;
  assert.equal(await compare({ dir, shoot: shot, pages, previewUrl: live }), true);
  assert.equal(shot.calls.length, pages.length * SCREEN_SIZES.length * 2, 'every picture came from the cache');
  // A page not photographed at the approved commit needs its preview.
  assert.equal(await compare({ dir, shoot: shot, pages: ['/', '/contact'], previewUrl: live }), false);

  // The head's pictures count only from the address the host gives for it now.
  const moved = async (sha) => (sha === AFTER ? 'https://shop-moved.example.app/' : null);
  const before = shot.calls.length;
  assert.equal(await compare({ dir, shoot: shot, pages, previewUrl: moved }), true);
  assert.equal(shot.calls.length - before, pages.length * SCREEN_SIZES.length);
  assert.ok(shot.calls.slice(before).every((c) => c.url.startsWith('https://shop-moved.example.app/')));
  assert.equal(savedOf(dir, AFTER).address, 'https://shop-moved.example.app/');
  assert.equal(Object.keys(savedOf(dir, AFTER).shots).length, pages.length * SCREEN_SIZES.length, 'the older address\'s pictures are dropped');
});

test('one address given for both commits never matches, and nothing is photographed under it', async () => {
  // A branch's address shows whatever is newest, so every picture would match.
  const branch = 'https://shop-git-feature.example.app/';
  const dir = tempFolder('wh-screens-');
  const shot = fakeShoot();
  for (let attempt = 0; attempt < 10; attempt += 1) {
    assert.equal(await compare({ dir, shoot: shot, pages: ['/', '/pricing'], previewUrl: async () => branch }), false, `attempt ${attempt}`);
  }
  assert.equal(shot.calls.length, 0);
  assert.deepEqual(fs.readdirSync(dir), []);

  // The approved commit photographed from an address the head is given later: no match either.
  assert.equal(await photographCommit({ sha: BEFORE, pages: ['/'], dir, previewUrl: async () => branch, shoot: shot, browser: '/bin/chrome' }), SCREEN_SIZES.length);
  const taken = shot.calls.length;
  for (const old of [null, previews[BEFORE]]) {
    assert.equal(await compare({ dir, shoot: shot, previewUrl: async (sha) => (sha === AFTER ? branch : old) }), false, String(old));
  }
  assert.equal(shot.calls.length, taken, 'no picture is taken once the addresses are known');
});

test('a failed photograph is not cached, and a broken cache file, or one from before addresses were kept, is no picture', async () => {
  const dir = tempFolder('wh-screens-');
  let answer = { ok: false, why: 'timed out' };
  const shot = fakeShoot(() => answer);
  const once = (sha) => photographCommit({ sha, pages: ['/'], sizes: [SCREEN_SIZES[0]], dir, previewUrl, shoot: shot, browser: '/bin/chrome' });
  assert.equal(await once(BEFORE), 0);
  assert.equal(fs.existsSync(path.join(dir, `${BEFORE}.json`)), false);
  answer = { ok: true, hash: H2 };
  assert.equal(await once(BEFORE), 1);
  assert.equal(await once(BEFORE), 0, 'already kept from that address');
  assert.equal(shot.calls.length, 2);

  for (const broken of [
    '{not json', '[]', 'null', JSON.stringify({ address: previews[AFTER], shots: { [`/ ${S0}`]: 'not a hash' } }),
    JSON.stringify({ address: 7, shots: { [`/ ${S0}`]: H2 } }), JSON.stringify({ address: previews[AFTER], shots: [] }),
  ]) {
    fs.writeFileSync(path.join(dir, `${AFTER}.json`), broken);
    const before = shot.calls.length;
    assert.equal(await once(AFTER), 1, broken);
    assert.equal(shot.calls.length, before + 1, broken);
  }

  // A file from before addresses were kept is no picture: with the approved commit's preview gone, no match.
  const legacy = tempFolder('wh-screens-');
  fs.writeFileSync(path.join(legacy, `${BEFORE}.json`), JSON.stringify(Object.fromEntries(keyed(['/']).map((k) => [k, H1]))));
  const fresh = fakeShoot();
  assert.equal(await compare({ dir: legacy, shoot: fresh, previewUrl: async (sha) => (sha === AFTER ? previews[AFTER] : null) }), false);
  assert.equal(fresh.calls.length, 0);
});

test('a photograph whose cache can not be written is still answered', async () => {
  const blocker = path.join(tempFolder('wh-screens-'), 'a-file');
  fs.writeFileSync(blocker, '');
  const shot = fakeShoot({ ok: true, hash: H2 });
  // The cache folder sits under a file, so it can't be made.
  assert.equal(await compare({ dir: path.join(blocker, 'cache'), shoot: shot }), true);
  assert.equal(shot.calls.length, 2 * SCREEN_SIZES.length);
});

test('two commits\' pictures, or two runs for one commit at once, all reach their cache files', async () => {
  const dir = tempFolder('wh-screens-');
  const run = (sha, size) => photographCommit({ sha, pages: ['/'], sizes: [size], dir, previewUrl, shoot: fakeShoot(), browser: '/bin/chrome' });
  await Promise.all(SCREEN_SIZES.flatMap((size) => [run(BEFORE, size), run(AFTER, size)]));
  assert.deepEqual(fs.readdirSync(dir).sort(), [`${AFTER}.json`, `${BEFORE}.json`].sort());
  for (const sha of [BEFORE, AFTER]) assert.deepEqual(Object.keys(savedOf(dir, sha).shots).sort(), keyed(['/']).sort());
});

test('photographing stops as soon as it is told to', async () => {
  const shot = fakeShoot();
  let left = 1;
  const taken = await photographCommit({ sha: BEFORE, pages: ['/', '/about'], dir: tempFolder('wh-screens-'), previewUrl, shoot: shot, browser: '/bin/chrome', keepGoing: () => (left -= 1) >= 0 });
  assert.deepEqual([taken, shot.calls.length], [1, 1]);
});

test('a commit that is not a commit id is refused, never used as a path', async () => {
  const dir = tempFolder('wh-screens-');
  const shot = fakeShoot();
  for (const sha of ['../../etc/passwd', 'abc', 'HEAD', `${BEFORE}/x`, '', null, 'g'.repeat(40)]) {
    assert.equal(await photographCommit({ sha, pages: ['/'], dir, previewUrl: async () => 'https://shop.example.app', shoot: shot, browser: '/bin/chrome' }), 0, String(sha));
    assert.equal(await compare({ dir, shoot: shot, before: sha }), false, String(sha));
    assert.equal(await compare({ dir, shoot: shot, after: sha }), false, String(sha));
  }
  assert.equal(shot.calls.length, 0);
  assert.deepEqual(fs.readdirSync(dir), []);
});
