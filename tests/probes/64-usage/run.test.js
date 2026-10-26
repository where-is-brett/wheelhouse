// tests/probes/64-usage/run.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { tempFolder } from '../../helpers/homes.js';
import { CHECK, main, modelNames, parseOptions, scrubText, shapeOf, shapeToJson, splitHttp, summarise, usageShapes } from '../../../probes/64-usage/run.js';

const unix = process.platform !== 'win32';
const t = unix ? test : test.skip;

test('options: defaults, and bad options are refused', () => {
  assert.equal(parseOptions([]).dryRun, false);
  assert.equal(parseOptions(['--dry-run', '--gh', '/g', '--timeout-ms', '5']).gh, '/g');
  assert.throws(() => parseOptions(['--nope']), /Unknown option/);
  assert.throws(() => parseOptions(['--timeout-ms', 'x']), /milliseconds/);
});

test('shapes record paths and types, never values, and name model keys <MODEL>', () => {
  const shape = shapeToJson(shapeOf({ a: 1, b: [{ c: 'x' }, { c: null }], modelMetrics: { 'model-x': { n: 2 } } }, { modelKeyed: ['modelMetrics'] }));
  assert.deepEqual(shape['a'], ['number']);
  assert.deepEqual(shape['b[].c'], ['null', 'string']);
  assert.deepEqual(shape['modelMetrics.<MODEL>.n'], ['number']);
  assert.ok(!JSON.stringify(shape).includes('model-x'));
});

test('scrubbing replaces every name', () => {
  assert.equal(scrubText('a model-x b model-x', ['model-x']), 'a <MODEL> b <MODEL>');
  assert.equal(scrubText('hi bob', ['bob'], '<LOGIN>'), 'hi <LOGIN>');
});

test('http output splits into status, headers and body', () => {
  const http = splitHttp('HTTP/2.0 403 Forbidden\nX-OAuth-Scopes: repo\n\n{"message":"no"}');
  assert.equal(http.status, 'HTTP/2.0 403 Forbidden');
  assert.equal(http.headers['x-oauth-scopes'], 'repo');
  assert.equal(http.body, '{"message":"no"}');
});

test('usage shapes pick the result usage, checkpoints and usage-like fields, and drop model names', () => {
  const events = [
    { type: 'model.call_final_result', data: { model: 'model-x', usage: { inputTokens: 5 }, other: 'z' } },
    { type: 'session.usage_checkpoint', data: { totalNanoAiu: 3 } },
    { type: 'result', sessionId: 's', usage: { premiumRequests: 1 } },
  ];
  assert.deepEqual(modelNames(events, { modelMetrics: { 'model-xx': {} } }), ['model-xx', 'model-x']);
  const s = usageShapes(events, { totalNanoAiu: 1, modelMetrics: { 'model-xx': { requests: { count: 1 } } } });
  assert.deepEqual(s.resultEventFields['usage.premiumRequests'], ['number']);
  assert.equal(s.usageCheckpointCount, 1);
  assert.deepEqual(s.usageFileFields['modelMetrics.<MODEL>.requests.count'], ['number']);
  assert.ok('data.usage.inputTokens' in s.usageLikeFieldsByEventType['model.call_final_result']);
  assert.ok(!('data.other' in s.usageLikeFieldsByEventType['model.call_final_result']));
  assert.ok(!JSON.stringify(s).includes('model-x'));
});

t('--dry-run makes both runs, the help read and the REST call, records shapes only, and undoes everything', async () => {
  const resultsDir = tempFolder('wh-results-');
  const printed = [];
  const { results, file } = await main(['--dry-run', '--results-dir', resultsDir], { out: (line) => printed.push(line) });
  assert.equal(results.error, null);
  assert.equal(file, path.join(resultsDir, `${CHECK}.dry-run.json`));
  assert.deepEqual(results.runs.map((r) => r.id), ['plain', 'tool']);
  for (const r of results.runs) {
    assert.equal(r.code, 0);
    assert.equal(r.usageFile.parsed, true);
    assert.deepEqual(r.shapes.resultEventFields['usage.premiumRequests'], ['number']);
    assert.equal(r.shapes.usageCheckpointCount, 1);
    assert.ok(r.args.includes('<usage file>'));
  }
  assert.match(results.help.text, /Billing/);
  assert.equal(results.rest.length, 1);
  assert.match(results.rest[0].status, /200/);
  assert.equal(results.rest[0].endpoint, '/users/<LOGIN>/settings/billing/ai_credit/usage');
  assert.deepEqual(results.rest[0].bodyFields['usageItems[].quantity'], ['number']);
  const raw = fs.readFileSync(file, 'utf8');
  assert.ok(!raw.includes('standin-login'));
  assert.ok(!raw.includes('standin-model'));
  // The stand-in usage figure, as a value anywhere in the record: a timing could hold the same digits.
  const values = (v) => (v !== null && typeof v === 'object' ? Object.values(v).flatMap(values) : [v]);
  assert.ok(!values(JSON.parse(raw)).some((v) => v === 12.5 || v === '12.5'));
  assert.match(printed[0], /2 model run/);
  assert.equal(printed.at(-1), `Raw results: ${file}`);
  assert.match(summarise(results), /rest \/users/);
});

t('a refusal records the message and scope headers; a 404 falls through to the second endpoint; sign-out skips the call', async () => {
  const run = async (mode) => {
    process.env.WHEELHOUSE_FAKE_GH = mode;
    try { return (await main(['--dry-run', '--results-dir', tempFolder('wh-results-')], { out: () => {} })).results; } finally { delete process.env.WHEELHOUSE_FAKE_GH; }
  };
  const refused = await run('refused');
  assert.equal(refused.rest.length, 1);
  assert.match(refused.rest[0].status, /403/);
  assert.match(refused.rest[0].errorMessage, /<LOGIN>/);
  assert.equal(refused.rest[0].headers['x-accepted-oauth-scopes'], 'user');
  const missing = await run('missing');
  assert.equal(missing.rest.length, 2);
  assert.match(missing.rest[1].endpoint, /premium_request/);
  const out = await run('signedout');
  assert.equal(out.rest.length, 0);
  assert.match(out.restSkipped, /could not give/);
});

t('a session that fails before any event is tried again, and its stderr and debug log are kept', async () => {
  process.env.WHEELHOUSE_FAKE_FAIL = '1';
  let results;
  try { results = (await main(['--dry-run', '--results-dir', tempFolder('wh-results-')], { out: () => {} })).results; } finally { delete process.env.WHEELHOUSE_FAKE_FAIL; }
  for (const r of results.runs) {
    assert.equal(r.code, 1);
    assert.equal(r.attempts, 2);
    assert.equal(r.earlierAttempts.length, 1);
    assert.match(r.stderr, /Failed to load models/);
    assert.deepEqual(r.debugLog, ['debug line (stand-in) standin-model-1']);
  }
  assert.match(summarise(results), /2 attempts/);
});
