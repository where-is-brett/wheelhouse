// tests/scripts/screens/shoot.test.js
// Finding the browser and photographing one page with it, against a fake browser and a fake
// fetch: no real browser runs here.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { findBrowser, browserArgs, shoot } from '../../../scripts/screens/shoot.js';
import { pixelHash } from '../../../scripts/screens/png.js';
import { SCREEN_TIMEOUT_MS, SCREEN_SETTLE_MS } from '../../../scripts/lib/front-desk.js';
import { encodePng, solid } from '../../fixtures/screens/encode.js';
import { tempFolder } from '../../helpers/homes.js';

const URL_ = 'https://preview-abc.example.app/pricing';
const SIZE = { width: 1280, height: 800 };
const PNG = encodePng({ width: 4, height: 3, pixels: solid(4, 3, [250, 250, 250]) });

const argOf = (args, name) => args.find((a) => a.startsWith(`${name}=`))?.slice(name.length + 1);

// A fake browser: writes `png` where --screenshot says (unless told not to) and remembers each run.
function fakeRun({ png = PNG, code = 0, timedOut = false, write = true, throws = false } = {}) {
  const runs = [];
  const run = async (file, args, options) => {
    const profile = argOf(args, '--user-data-dir');
    runs.push({ file, args, options, profile, profileExisted: fs.existsSync(profile) });
    if (throws) throw new Error('spawn ENOENT');
    if (write) fs.writeFileSync(argOf(args, '--screenshot'), png);
    return timedOut ? { code: 1, stdout: '', stderr: '', timedOut: true } : { code, stdout: '', stderr: '' };
  };
  run.runs = runs;
  return run;
}

// A fake fetch answering from a table of address → [status, location?].
function fakeFetch(table) {
  const calls = [];
  const fetch = async (url, options) => {
    calls.push({ url: String(url), options });
    const answer = table[String(url)];
    if (!answer) throw new TypeError('fetch failed');
    const [status, location] = answer;
    return new Response(null, { status, headers: location ? { location } : {} });
  };
  fetch.calls = calls;
  return fetch;
}

const ok200 = () => fakeFetch({ [URL_]: [200] });

test('findBrowser looks for Chrome, then Edge, in their usual places', () => {
  const only = (want) => (p) => p === want;
  const mac = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  const macEdge = '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge';
  const userChrome = '/Users/director/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  const macEnv = { HOME: '/Users/director' };
  assert.equal(findBrowser({ platform: 'darwin', exists: () => true, env: macEnv }), mac);
  assert.equal(findBrowser({ platform: 'darwin', exists: only(macEdge), env: macEnv }), macEdge);
  assert.equal(findBrowser({ platform: 'darwin', exists: only(userChrome), env: macEnv }), userChrome);
  // Chrome in the director's own Applications comes before Edge.
  assert.equal(findBrowser({ platform: 'darwin', exists: (p) => p === userChrome || p === macEdge, env: macEnv }), userChrome);

  const winEnv = { ProgramFiles: 'C:\\Program Files', 'ProgramFiles(x86)': 'C:\\Program Files (x86)', LOCALAPPDATA: 'C:\\Users\\d\\AppData\\Local' };
  const winChrome = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
  const localChrome = 'C:\\Users\\d\\AppData\\Local\\Google\\Chrome\\Application\\chrome.exe';
  const edge = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
  assert.equal(findBrowser({ platform: 'win32', exists: () => true, env: winEnv }), winChrome);
  assert.equal(findBrowser({ platform: 'win32', exists: (p) => p === localChrome || p === edge, env: winEnv }), localChrome);
  assert.equal(findBrowser({ platform: 'win32', exists: only(edge), env: winEnv }), edge);
  // Windows names its variables in any case.
  assert.equal(findBrowser({ platform: 'win32', exists: only(localChrome), env: { LocalAppData: 'C:\\Users\\d\\AppData\\Local' } }), localChrome);

  assert.equal(findBrowser({ platform: 'linux', exists: only('/usr/bin/chromium'), env: {} }), '/usr/bin/chromium');
  assert.equal(findBrowser({ platform: 'linux', exists: () => true, env: {} }), '/usr/bin/google-chrome');
  for (const platform of ['darwin', 'win32', 'linux']) assert.equal(findBrowser({ platform, exists: () => false, env: { ...macEnv, ...winEnv } }), null);
});

test('browserArgs runs a hidden browser at one size with its own profile, the address last', () => {
  const args = browserArgs({ url: URL_, size: { width: 390, height: 844 }, profile: '/tmp/p', out: '/tmp/p/screen.png' });
  for (const flag of ['--headless=new', '--hide-scrollbars', '--window-size=390,844', '--user-data-dir=/tmp/p', '--screenshot=/tmp/p/screen.png', '--no-first-run']) assert.ok(args.includes(flag), flag);
  assert.equal(args.at(-1), URL_);
  // A client-rendered page gets time to draw before its picture.
  assert.equal(SCREEN_SETTLE_MS, 5000);
  assert.ok(args.includes(`--virtual-time-budget=${SCREEN_SETTLE_MS}`));
  // The browser's own sandbox is never turned off.
  assert.ok(!args.some((a) => /sandbox/i.test(a)), 'no sandbox flag');
});

test('a page is photographed and its pixels hashed', async () => {
  const run = fakeRun();
  const fetch = ok200();
  const result = await shoot({ browser: '/bin/chrome', url: URL_, size: SIZE, run, fetch, tmp: tempFolder('wh-shoot-') });
  assert.deepEqual(result, { ok: true, hash: pixelHash(PNG) });
  assert.equal(run.runs.length, 1);
  const [{ file, args, options, profileExisted }] = run.runs;
  assert.equal(file, '/bin/chrome');
  assert.ok(profileExisted);
  assert.ok(args.includes('--window-size=1280,800'));
  assert.ok(args.includes('--hide-scrollbars'));
  assert.equal(args.at(-1), URL_);
  assert.equal(options.timeoutMs, SCREEN_TIMEOUT_MS);
  assert.equal(fetch.calls[0].options.redirect, 'manual');
  assert.ok(fetch.calls[0].options.signal instanceof AbortSignal);
});

test('the browser profile folder is removed after each run', async () => {
  const tmp = tempFolder('wh-shoot-');
  for (const run of [fakeRun(), fakeRun({ code: 1 }), fakeRun({ timedOut: true }), fakeRun({ write: false }), fakeRun({ throws: true }), fakeRun({ png: Buffer.from('not a png') })]) {
    await shoot({ browser: '/bin/chrome', url: URL_, size: SIZE, run, fetch: ok200(), tmp });
    const [{ profile, profileExisted }] = run.runs;
    assert.ok(profileExisted);
    assert.ok(path.dirname(profile) === tmp, 'the profile is made under tmp');
    assert.equal(fs.existsSync(profile), false);
  }
  assert.deepEqual(fs.readdirSync(tmp), []);
});

test('a run that fails, times out or leaves no usable picture gives no hash', async () => {
  const tmp = tempFolder('wh-shoot-');
  for (const run of [fakeRun({ code: 1 }), fakeRun({ timedOut: true }), fakeRun({ write: false }), fakeRun({ throws: true }), fakeRun({ png: Buffer.from('not a png') })]) {
    const result = await shoot({ browser: '/bin/chrome', url: URL_, size: SIZE, run, fetch: ok200(), tmp });
    assert.equal(result.ok, false);
    assert.equal(typeof result.why, 'string');
  }
});

test('only an https address is photographed, refused before any fetch', async () => {
  for (const url of ['http://preview.example.app/', 'file:///Users/director/shop/index.html', '/pricing', 'not an address', 'javascript:alert(1)', undefined]) {
    const run = fakeRun();
    const fetch = ok200();
    const result = await shoot({ browser: '/bin/chrome', url, size: SIZE, run, fetch, tmp: tempFolder('wh-shoot-') });
    assert.equal(result.ok, false, String(url));
    assert.equal(fetch.calls.length, 0);
    assert.equal(run.runs.length, 0);
  }
});

test('a page with an error or empty status, or that cannot be fetched, is not photographed', async () => {
  for (const fetch of [fakeFetch({ [URL_]: [404] }), fakeFetch({ [URL_]: [204] }), fakeFetch({ [URL_]: [205] }), fakeFetch({ [URL_]: [500] }), fakeFetch({ [URL_]: [304] }), fakeFetch({})]) {
    const run = fakeRun();
    const result = await shoot({ browser: '/bin/chrome', url: URL_, size: SIZE, run, fetch, tmp: tempFolder('wh-shoot-') });
    assert.equal(result.ok, false);
    assert.equal(run.runs.length, 0);
  }
});

test('a redirect is followed only on the preview\'s own host', async () => {
  const there = 'https://preview-abc.example.app/en/pricing';
  const same = fakeFetch({ [URL_]: [301, '/en/pricing'], [there]: [200] });
  const run = fakeRun();
  const result = await shoot({ browser: '/bin/chrome', url: URL_, size: SIZE, run, fetch: same, tmp: tempFolder('wh-shoot-') });
  assert.equal(result.ok, true);
  assert.equal(run.runs[0].args.at(-1), there);

  for (const location of ['https://login.example.com/sso', 'http://preview-abc.example.app/pricing', 'https://preview-abc.example.app:8443/pricing']) {
    const off = fakeFetch({ [URL_]: [302, location], [location]: [200] });
    const offRun = fakeRun();
    const answer = await shoot({ browser: '/bin/chrome', url: URL_, size: SIZE, run: offRun, fetch: off, tmp: tempFolder('wh-shoot-') });
    assert.equal(answer.ok, false, location);
    assert.equal(off.calls.length, 1);
    assert.equal(offRun.runs.length, 0);
  }

  // A redirect with nowhere to go, and one that goes round in circles.
  const nowhere = fakeFetch({ [URL_]: [302] });
  assert.equal((await shoot({ browser: '/bin/chrome', url: URL_, size: SIZE, run: fakeRun(), fetch: nowhere, tmp: tempFolder('wh-shoot-') })).ok, false);
  const circle = fakeFetch({ [URL_]: [302, URL_] });
  assert.equal((await shoot({ browser: '/bin/chrome', url: URL_, size: SIZE, run: fakeRun(), fetch: circle, tmp: tempFolder('wh-shoot-') })).ok, false);
  assert.ok(circle.calls.length <= 6);
});

test('with no browser nothing is fetched or run', async () => {
  const run = fakeRun();
  const fetch = ok200();
  assert.deepEqual(await shoot({ browser: null, url: URL_, size: SIZE, run, fetch, tmp: tempFolder('wh-shoot-') }), { ok: false, why: 'no browser' });
  assert.equal(fetch.calls.length + run.runs.length, 0);
});
