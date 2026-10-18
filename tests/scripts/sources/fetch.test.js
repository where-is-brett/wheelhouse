// tests/scripts/sources/fetch.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fetchSource } from '../../../scripts/sources/fetch.js';
import { SOURCES } from '../../../scripts/lib/core-numbers.js';

const fixture = (name) => fs.readFileSync(new URL(`../../fixtures/sources/${name}`, import.meta.url), 'utf8');
const PAGE = { id: 'models', url: 'https://docs.example.test/docs/en/models', kind: 'page' };
const html = (body, status = 200) => new Response(body, { status, headers: { 'content-type': 'text/html; charset=utf-8' } });
const redirect = (location, status = 302) => new Response(null, { status, headers: { location } });

// A fake fetch answering from a table of URL -> (init) => Response, keeping the calls.
function fakeFetch(table) {
  const calls = [];
  const fetch = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    const answer = table[String(url)];
    if (!answer) return new Response('not here', { status: 404 });
    return answer(init);
  };
  fetch.calls = calls;
  return fetch;
}

test('HTML becomes stable text, so the same page twice is not a change', async () => {
  const fetch = fakeFetch({ [PAGE.url]: () => html(fixture('models-before.html')) });
  const first = await fetchSource(PAGE, { fetch });
  const second = await fetchSource(PAGE, { fetch });
  assert.equal(first.ok, true);
  assert.equal(first.text, second.text);
  const lines = first.text.split('\n');
  // One line per block; scripts, styles, comments and tags are gone.
  assert.ok(lines.includes('Models overview'));
  assert.ok(lines.includes('Start with Sample 9 for most work.'));
  assert.ok(lines.includes('Sample 9 | claude-sample-9'));
  assert.ok(lines.includes('Fish & chips cost £5 <each>.'));
  assert.ok(!/<|not text|tracking|color: red|a comment/.test(first.text.replace('<each>', '')));
  assert.ok(lines.every((line) => line === line.trim() && line !== ''));
  // White space differences alone do not change the text.
  const spaced = fixture('models-before.html').replace(/<p>/g, '<p>\n\n   ').replace(/<\/p>/g, '\t</p>\r\n');
  const again = await fetchSource(PAGE, { fetch: fakeFetch({ [PAGE.url]: () => html(spaced) }) });
  assert.equal(again.text, first.text);
});

test('links are the absolute https links on the same site', async () => {
  const fetch = fakeFetch({ [PAGE.url]: () => html(fixture('models-before.html')) });
  const { links } = await fetchSource(PAGE, { fetch });
  assert.deepEqual(links, ['https://docs.example.test/docs/en/models/sample-9/overview']);
});

test('a page that cannot be fetched is answered as not read', async () => {
  const notFound = await fetchSource(PAGE, { fetch: fakeFetch({}) });
  assert.deepEqual(notFound, { ok: false, why: 'The site answered 404' });
  const broken = await fetchSource(PAGE, { fetch: async () => { throw new Error('connection reset'); } });
  assert.equal(broken.ok, false);
  assert.match(broken.why, /connection reset/);
  const plain = await fetchSource({ ...PAGE, url: 'http://docs.example.test/x' }, { fetch: fakeFetch({}) });
  assert.equal(plain.ok, false);
  assert.match(plain.why, /https/);
  const empty = await fetchSource(PAGE, { fetch: fakeFetch({ [PAGE.url]: () => html('<html><script>x</script></html>') }) });
  assert.equal(empty.ok, false);
});

test('a page that never answers is given up on at the time limit', async () => {
  const hang = () => new Promise(() => {});
  const started = Date.now();
  const result = await fetchSource(PAGE, { fetch: hang, timeoutMs: 40 });
  assert.equal(result.ok, false);
  assert.match(result.why, /time/i);
  assert.ok(Date.now() - started < 2000);
  assert.equal(SOURCES.timeoutMs, 20000);
});

test('a redirect to another site is refused; one on the same site is followed', async () => {
  const other = fakeFetch({ [PAGE.url]: () => redirect('https://elsewhere.example.org/models') });
  const refused = await fetchSource(PAGE, { fetch: other });
  assert.equal(refused.ok, false);
  assert.match(refused.why, /another site/);
  assert.equal(other.calls.length, 1);

  const down = fakeFetch({ [PAGE.url]: () => redirect('http://docs.example.test/models') });
  assert.equal((await fetchSource(PAGE, { fetch: down })).ok, false);

  const same = fakeFetch({
    [PAGE.url]: () => redirect('/docs/en/models/moved', 301),
    'https://docs.example.test/docs/en/models/moved': () => html('<p>Moved here</p><a href="more">More</a>'),
  });
  const followed = await fetchSource(PAGE, { fetch: same });
  assert.equal(followed.ok, true);
  assert.equal(followed.text, 'Moved here\nMore');
  assert.deepEqual(followed.links, ['https://docs.example.test/docs/en/models/more']);
  assert.ok(same.calls.every((call) => call.init.redirect === 'manual'));
});

test('no more than three redirects are followed', async () => {
  const hop = (n) => `https://docs.example.test/hop-${n}`;
  const table = { [PAGE.url]: () => redirect(hop(1)) };
  for (let n = 1; n <= 4; n += 1) table[hop(n)] = () => redirect(hop(n + 1));
  table[hop(5)] = () => html('<p>End</p>');
  const refused = await fetchSource(PAGE, { fetch: fakeFetch(table) });
  assert.equal(refused.ok, false);
  assert.match(refused.why, /redirect/i);
  // Three hops are allowed.
  const three = { [PAGE.url]: () => redirect(hop(1)), [hop(1)]: () => redirect(hop(2)), [hop(2)]: () => redirect(hop(3)), [hop(3)]: () => html('<p>End</p>') };
  assert.equal((await fetchSource(PAGE, { fetch: fakeFetch(three) })).text, 'End');
});

test('a page over 2 MB is cut and the cut is noted', async () => {
  const line = '<p>0123456789012345678901234567890123456789012345678901234567890123456789</p>\n';
  const big = line.repeat(Math.ceil((SOURCES.maxBytes * 1.2) / line.length));
  const cutResult = await fetchSource(PAGE, { fetch: fakeFetch({ [PAGE.url]: () => html(big) }) });
  assert.equal(cutResult.ok, true);
  assert.equal(cutResult.cut, true);
  assert.ok(cutResult.text.length <= SOURCES.maxBytes);
  assert.ok(cutResult.text.length > SOURCES.maxBytes * 0.5);
  // Exactly the limit is not a cut.
  const exact = 'a'.repeat(SOURCES.maxBytes);
  const whole = await fetchSource(PAGE, { fetch: fakeFetch({ [PAGE.url]: () => new Response(exact, { headers: { 'content-type': 'text/plain' } }) }) });
  assert.equal(whole.cut, false);
  assert.equal(whole.text.length, SOURCES.maxBytes);
});

test('the GitHub API is asked with a user agent and the GitHub media type, and its answer is kept as it came', async () => {
  const source = { id: 'releases:octo/alpha', url: 'https://api.github.com/repos/octo/alpha/releases?per_page=10', kind: 'releases' };
  const fetch = fakeFetch({ [source.url]: () => new Response('[{"tag_name":"v1"}]', { headers: { 'content-type': 'application/json' } }) });
  const result = await fetchSource(source, { fetch });
  assert.equal(result.text, '[{"tag_name":"v1"}]');
  assert.deepEqual(result.links, []);
  const headers = fetch.calls[0].init.headers;
  assert.equal(headers['User-Agent'], 'wheelhouse');
  assert.equal(headers.Accept, 'application/vnd.github+json');
});
