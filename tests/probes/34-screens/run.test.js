// tests/probes/34-screens/run.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PAGES, startServer, summarise } from '../../../probes/34-screens/run.js';

const shot = (hash, ms = 100, extra = {}) => ({ ms, code: 1, ended: 'stopped', png: Boolean(hash), ...(hash ? { hash } : {}), ...extra });

test('the late page starts blank and its final content is the still page\'s', () => {
  const [markup, script] = PAGES.late.split('<script>');
  assert.ok(!markup.includes('Wheelhouse check 34'));
  assert.ok(script.includes('setTimeout') && script.includes('Wheelhouse check 34'));
  assert.equal(PAGES.lateFinal, PAGES.still);
});

test('the server gives its pages, 404 for others, and drops the connection on failsDrop', async () => {
  const { server, port } = await startServer();
  try {
    const ok = await fetch(`http://127.0.0.1:${port}/still`);
    assert.equal(ok.status, 200);
    assert.equal(await ok.text(), PAGES.still);
    assert.equal((await fetch(`http://127.0.0.1:${port}/nothing`)).status, 404);
    await assert.rejects(fetch(`http://127.0.0.1:${port}/failsDrop`));
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
});

test('summarise: matches, the late page against its final content, failures and the time limit', () => {
  const runs = {
    still: { '1280x800': [shot('a', 900), shot('a', 1100)] },
    clock: { '1280x800': [shot('a'), shot('b')] },
    late: { '1280x800': [shot('c'), shot('c')] },
    lateFinal: { '1280x800': [shot('c'), shot('c')] },
    failsDrop: { '1280x800': [shot(null, 30005, { ended: 'timed out', saysLoadFailed: true }), shot(null, 30004, { ended: 'timed out', saysLoadFailed: true })] },
    failsClosed: { '1280x800': [shot('e'), shot('e')] },
  };
  const s = summarise(runs, 30000);
  assert.equal(s.pages.still['1280x800'].matched, true);
  assert.equal(s.pages.clock['1280x800'].matched, false);
  assert.equal(s.pages.failsDrop['1280x800'].matched, false);
  assert.equal(s.lateShowsDrawnContent, true);
  assert.deepEqual(s.failsGivePicture, { failsDrop: false, failsClosed: true });
  assert.deepEqual(s.pages.failsDrop['1280x800'].ended, ['timed out', 'timed out']);
  assert.deepEqual(s.pages.failsDrop['1280x800'].saysLoadFailed, [true, true]);
  assert.deepEqual(s.pages.still['1280x800'].saysLoadFailed, [false, false]);
  // A run with no picture runs to the limit; the time is that of the slowest run with one.
  assert.equal(s.slowestPictureMs, 1100);
  assert.equal(s.slowestFitsTimeout, true);
  assert.equal(summarise(runs, 1000).slowestFitsTimeout, false);
});

test('summarise: a late page that stayed blank does not show the drawn content', () => {
  const runs = { late: { '390x844': [shot('blank'), shot('blank')] }, lateFinal: { '390x844': [shot('c'), shot('c')] } };
  assert.equal(summarise(runs).lateShowsDrawnContent, false);
});
