// tests/scripts/engine/preview.test.js
// The pack's preview step (Archon design, section 9.1): it uses the host's preview of the head where there is one,
// else the project's own preview command in the worktree; photographs the order's pages and up to five the change
// touches at both sizes; and for a change with nothing to look at writes a one-line summary, never a blank.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { makePreview, touchedPages, pictureName, localAddress, startCommand, main, accessibilityProblems, pageText } from '../../../scripts/engine/preview.js';
import { tempFolder } from '../../helpers/homes.js';

const HEAD = '1111111a2b3c4d5e6f708192a3b4c5d6e7f80912';
const PNG = Buffer.from('89504e470d0a1a0a', 'hex');

// A stood-in helper client: the find answer, and the calls made.
function fakeClient(found, calls = []) {
  return {
    calls,
    engine: {
      previewFind: async (body) => { calls.push({ call: 'find', ...body }); return { ok: true, pr: 14, head: HEAD, ...found }; },
      preview: async (body) => { calls.push({ call: 'keep', ...body }); return { ok: true, folder: '/record/previews/card-1', pictures: 0 }; },
    },
  };
}
// A stood-in browser that writes a picture for each address it is given.
function fakePicture(shots = []) {
  return async ({ url, size, out }) => {
    shots.push({ url, size, out });
    fs.writeFileSync(out, PNG);
    return { ok: true };
  };
}
const changes = (...paths) => paths.map((p) => ({ status: 'M', path: p }));

test('the host\'s preview is used when there is one', async () => {
  const out = tempFolder('wh-shots-');
  const shots = [];
  let started = false;
  const got = await makePreview({
    runId: 'run-1', out, client: fakeClient({ visible: true, pages: ['/'], url: 'https://pr-14.preview.example.com' }),
    browser: '/chrome', picture: fakePicture(shots), changes: async () => [], config: () => ({ preview: { command: 'npm run preview', port: 4173, ready: 'Local:' } }),
    startCommand: async () => { started = true; return { ok: true, stop: async () => {} }; },
  });
  assert.equal(started, false, 'the project\'s command isn\'t started when the host has a preview');
  assert.deepEqual(shots.map((s) => s.url), ['https://pr-14.preview.example.com/', 'https://pr-14.preview.example.com/']);
  assert.equal(got.pictures, 2);
});

test('the project\'s preview command is started when there is no host preview, and stopped after', async () => {
  const out = tempFolder('wh-shots-');
  const shots = [];
  const events = [];
  const got = await makePreview({
    runId: 'run-1', out, cwd: '/worktree', client: fakeClient({ visible: true, pages: ['/prices'], url: null }),
    browser: '/chrome', picture: fakePicture(shots), changes: async () => [],
    config: () => ({ preview: { command: 'npm run preview', port: 4173, ready: 'Local:' } }),
    startCommand: async ({ preview, cwd }) => { events.push(['start', preview.command, cwd]); return { ok: true, stop: async () => { events.push(['stop']); } }; },
  });
  assert.deepEqual(events, [['start', 'npm run preview', '/worktree'], ['stop']]);
  assert.equal(shots[0].url, 'http://127.0.0.1:4173/prices');
  assert.equal(got.pictures, 2);
});

test('pictures are taken at both sizes, for the listed pages and up to five the change touches', async () => {
  const out = tempFolder('wh-shots-');
  const shots = [];
  const calls = [];
  const got = await makePreview({
    runId: 'run-1', out, client: fakeClient({ visible: true, pages: ['/', '/about'], url: 'https://pr-14.preview.example.com' }, calls),
    browser: '/chrome', picture: fakePicture(shots),
    changes: async () => changes('src/pages/about.tsx', 'src/pages/a.tsx', 'src/pages/b.tsx', 'src/pages/c.tsx', 'src/pages/d.tsx', 'src/pages/e.tsx', 'src/pages/f.tsx', 'README.md'),
  });
  const pages = [...new Set(shots.map((s) => new URL(s.url).pathname))];
  assert.deepEqual(pages, ['/', '/about', '/a', '/b', '/c', '/d']);
  assert.deepEqual([...new Set(shots.map((s) => `${s.size.width}x${s.size.height}`))], ['1280x800', '390x844']);
  assert.equal(got.pictures, 12);
  assert.ok(fs.existsSync(path.join(out, 'home-1280x800.png')));
  assert.ok(fs.existsSync(path.join(out, 'about-390x844.png')));
  const notes = JSON.parse(fs.readFileSync(path.join(out, 'notes.json'), 'utf8'));
  assert.deepEqual(notes.pages, pages);
  assert.equal(notes.taken.length, 12);
  assert.ok(notes.taken.includes('about-390x844.png'));
  assert.deepEqual(calls.map((c) => c.call), ['find', 'keep'], 'the helper keeps the pictures once they are taken');
});

test('a project with no preview gives a one-line summary, not a blank', async () => {
  const out = tempFolder('wh-shots-');
  const calls = [];
  const got = await makePreview({
    runId: 'run-1', out, client: fakeClient({ visible: true, pages: ['/'], url: null }, calls), base: 'main',
    browser: '/chrome', picture: fakePicture(), changes: async () => changes('src/price.js', 'src/cart.js'), config: () => ({}),
  });
  assert.equal(got.pictures, 0);
  assert.match(got.summary, /^No preview to look at: the host has none and the project has no preview command\. Before main, after 1111111: 2 files changed \(src\/price\.js, src\/cart\.js\)\.$/);
  assert.equal(got.summary.includes('\n'), false);
  assert.equal(fs.readFileSync(path.join(out, 'summary.txt'), 'utf8').trim(), got.summary);
  assert.deepEqual(calls.map((c) => c.call), ['find', 'keep']);

  const hidden = await makePreview({
    runId: 'run-1', out: tempFolder('wh-shots-'), client: fakeClient({ visible: false, pages: [], url: null }), base: 'main',
    browser: '/chrome', picture: fakePicture(), changes: async () => changes('src/price.js'),
  });
  assert.match(hidden.summary, /^Nothing to look at: the change isn't visible\. Before main, after 1111111: 1 file changed \(src\/price\.js\)\.$/);
  const noBrowser = await makePreview({
    runId: 'run-1', out: tempFolder('wh-shots-'), client: fakeClient({ visible: true, pages: ['/'], url: 'https://pr-14.preview.example.com' }), base: 'main',
    browser: null, picture: fakePicture(), changes: async () => [],
  });
  assert.match(noBrowser.summary, /^No pictures: there's no Chrome on this computer to take them\./);
});

test('a page whose picture fails is noted, and the rest are still taken', async () => {
  const out = tempFolder('wh-shots-');
  const got = await makePreview({
    runId: 'run-1', out, client: fakeClient({ visible: true, pages: ['/', '/broken'], url: 'https://pr-14.preview.example.com' }),
    browser: '/chrome', changes: async () => [],
    picture: async ({ url, out: file }) => (url.endsWith('/broken') ? { ok: false, why: 'the page answered 500' } : (fs.writeFileSync(file, PNG), { ok: true })),
  });
  assert.equal(got.pictures, 2);
  const notes = JSON.parse(fs.readFileSync(path.join(out, 'notes.json'), 'utf8'));
  assert.deepEqual(notes.missed.map((m) => m.page), ['/broken', '/broken']);
  assert.match(notes.missed[0].why, /500/);
});

test('touchedPages reads pages from routes and templates, leaving out dynamic ones', () => {
  assert.deepEqual(touchedPages(changes('pages/index.tsx', 'src/pages/blog/index.vue', 'app/pricing/page.tsx', 'src/routes/about/+page.svelte', 'pages/[id].tsx', 'src/lib/x.ts', 'public/contact.html')), ['/', '/blog', '/pricing', '/about', '/contact']);
  assert.deepEqual(touchedPages([{ status: 'D', path: 'pages/gone.tsx' }]), [], 'a page the change takes away has nothing to show');
});

test('pictureName and localAddress', () => {
  assert.equal(pictureName('/', { width: 1280, height: 800 }), 'home-1280x800.png');
  assert.equal(pictureName('/blog/Post_1?x=1', { width: 390, height: 844 }), 'blog-post-1-x-1-390x844.png');
  assert.equal(localAddress(4173), 'http://127.0.0.1:4173');
});

test('main prints the step\'s output as one JSON line, and a refusal exits 1', async () => {
  const lines = [];
  const code = await main(['--run', 'run-1', '--out', tempFolder('wh-shots-'), '--base', 'main'], {
    client: fakeClient({ visible: false, pages: [], url: null }), out: (l) => lines.push(l), changes: async () => [], browser: null,
  });
  assert.equal(code, 0);
  const printed = JSON.parse(lines.at(-1));
  assert.deepEqual(Object.keys(printed).sort(), ['checks', 'folder', 'pictures', 'summary', 'walk', 'walked']);
  const refused = { engine: { previewFind: async () => ({ ok: false, refused: 'there is no work order for that run' }) } };
  const lines2 = [];
  assert.equal(await main(['--run', 'run-9', '--out', tempFolder('wh-shots-')], { client: refused, out: (l) => lines2.push(l) }), 1);
  assert.match(lines2.join('\n'), /no work order/);
  assert.equal(await main([], { client: refused, out: () => {} }), 2);
});

test('startCommand waits for the ready line, and stop ends the command', async () => {
  const cwd = tempFolder('wh-cmd-');
  const node = JSON.stringify(process.execPath);
  const script = "console.log('Local: ready'); setInterval(() => {}, 1000)";
  const started = await startCommand({ preview: { command: `${node} -e ${JSON.stringify(script)}`, port: 1, ready: 'Local:' }, cwd });
  assert.equal(started.ok, true);
  await started.stop();
  const ended = await startCommand({ preview: { command: `${node} -e "process.exit(3)"`, port: 1, ready: 'Local:' }, cwd });
  assert.equal(ended.ok, false);
  assert.match(ended.why, /ended with 3 before it was ready/);
  const slow = await startCommand({ preview: { command: `${node} -e "setInterval(() => {}, 1000)"`, port: 1, ready: 'Local:' }, cwd, readyMs: 300 });
  assert.match(slow.why, /didn't say "Local:"/);
});

test('a preview folder left from before is moved aside, so nothing in it is taken as this run\'s', async () => {
  const parent = tempFolder('wh-shots-');
  const out = path.join(parent, 'preview');
  fs.mkdirSync(out);
  fs.writeFileSync(path.join(out, 'checkout-1280x800.png'), PNG);
  const got = await makePreview({
    runId: 'run-1', out, client: fakeClient({ visible: true, pages: ['/'], url: 'https://pr-14.preview.example.com' }),
    browser: '/chrome', picture: fakePicture(), changes: async () => [],
  });
  assert.equal(got.pictures, 2);
  assert.deepEqual(fs.readdirSync(out).sort(), ['home-1280x800.png', 'home-390x844.png', 'notes.json']);
  const aside = fs.readdirSync(parent).filter((n) => n.startsWith('preview.') && n.endsWith('.before'));
  assert.equal(aside.length, 1);
  assert.deepEqual(fs.readdirSync(path.join(parent, aside[0])), ['checkout-1280x800.png']);
});

const LOCAL = { preview: { command: 'npm run preview', port: 4173, ready: 'Local:' } };
const PAGE = '<!doctype html><html lang="en"><head><title>Orders</title><script>var x = "hidden";</script></head><body><h1>Your orders</h1><img src="a.png"><label for="q">Search</label><input id="q"><input id="y"><button></button><a href="/x">Next</a></body></html>';

test('each page check is walked while the preview is up, and what it showed is saved for the tester', async () => {
  const out = tempFolder('wh-walk-');
  const events = [];
  const got = await makePreview({
    runId: 'run-1', out, cwd: '/worktree', client: fakeClient({ visible: true, pages: ['/'], url: null }),
    browser: '/chrome', picture: fakePicture(), changes: async () => [], config: () => LOCAL,
    startCommand: async () => { events.push('start'); return { ok: true, stop: async () => { events.push('stop'); } }; },
    walk: [{ page: '/orders', mustShow: 'Your orders' }],
    dump: async ({ url }) => { events.push(`dump ${url}`); return { ok: true, html: PAGE }; },
  });
  assert.deepEqual(events, ['start', 'dump http://127.0.0.1:4173/orders', 'stop']);
  assert.equal(got.walked, 1);
  assert.equal(got.checks, 1);
  assert.equal(got.walk, true);
  const name = pictureName('/orders', { width: 1280, height: 800 }).replace(/\.png$/, '');
  assert.equal(fs.readFileSync(path.join(out, 'walk', `${name}.html`), 'utf8'), PAGE);
  const text = fs.readFileSync(path.join(out, 'walk', `${name}.txt`), 'utf8');
  assert.match(text, /Your orders/);
  assert.doesNotMatch(text, /hidden/, 'a script\'s text isn\'t what the page shows');
  const notes = JSON.parse(fs.readFileSync(path.join(out, 'notes.json'), 'utf8'));
  assert.deepEqual(notes.walk, [{ page: '/orders', mustShow: 'Your orders', saved: true, file: `walk/${name}.txt` }]);
  assert.equal(notes.accessibility[0].page, '/orders');
  assert.equal(notes.accessibility[0].problems.length, 3);
});

test('the accessibility check names an image with no alt, a field with no label, a button with no name and a page with no language or title', () => {
  const got = accessibilityProblems(PAGE);
  assert.ok(got.some((p) => /image/.test(p)));
  assert.ok(got.some((p) => /field/.test(p)));
  assert.ok(got.some((p) => /button/.test(p)));
  assert.deepEqual(accessibilityProblems('<html><body><p>x</p></body></html>').sort(), ['the page has no title', 'the page names no language'].sort());
  assert.deepEqual(accessibilityProblems('<html lang="en"><head><title>t</title></head><body><img alt="" src="x"><label>Name <input></label><button aria-label="Go"></button><input type="hidden"></body></html>'), []);
  assert.equal(pageText('<p>a &amp; b</p><style>.x{}</style>'), 'a & b');
});

test('the switch is on only while the local preview runs, and the file is put back as it was', async () => {
  const out = tempFolder('wh-walk-');
  const cwd = tempFolder('wh-wt-');
  fs.mkdirSync(path.join(cwd, 'config'));
  const file = path.join(cwd, 'config', 'feature-flags.json');
  const before = '{\n  "order-history": false\n}\n';
  fs.writeFileSync(file, before);
  let during = null;
  const got = await makePreview({
    runId: 'run-1', out, cwd, client: fakeClient({ visible: true, pages: ['/'], url: null }),
    browser: '/chrome', picture: fakePicture(), changes: async () => [], config: () => LOCAL,
    startCommand: async () => { during = JSON.parse(fs.readFileSync(file, 'utf8')); return { ok: true, stop: async () => {} }; },
    flagOn: { name: 'order-history', file: 'config/feature-flags.json' },
  });
  assert.deepEqual(during, { 'order-history': true });
  assert.equal(fs.readFileSync(file, 'utf8'), before);
  assert.equal(got.pictures, 2);
  const host = await makePreview({
    runId: 'run-1', out: tempFolder('wh-walk-'), cwd, client: fakeClient({ visible: true, pages: ['/'], url: 'https://pr-14.preview.example.com' }),
    browser: '/chrome', picture: fakePicture(), changes: async () => [], config: () => LOCAL, flagOn: { name: 'order-history', file: 'config/feature-flags.json' },
  });
  assert.match(JSON.parse(fs.readFileSync(path.join(host.folder, 'notes.json'), 'utf8')).flag, /stays off on the host's preview/);
});

test('with nothing visible, nothing is walked, and the step says no check was walked', async () => {
  const out = tempFolder('wh-walk-');
  let dumped = 0;
  const got = await makePreview({
    runId: 'run-1', out, client: fakeClient({ visible: false, pages: [], url: null }), browser: '/chrome', picture: fakePicture(), changes: async () => [],
    walk: [], dump: async () => { dumped += 1; return { ok: true, html: '' }; },
  });
  assert.equal(dumped, 0);
  assert.deepEqual([got.walk, got.walked, got.checks], [false, 0, 0]);
});
