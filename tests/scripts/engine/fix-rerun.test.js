// tests/scripts/engine/fix-rerun.test.js
// The fix-main lane's first step: the main line's failed runs of its newest commit have their failed jobs run again
// once, through the broker's gh, and the step waits to see whether that made it green.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { main } from '../../../scripts/engine/fix-rerun.js';

const HEAD = 'c'.repeat(40);
// A stand-in gh: `answers` maps the call's first words to its result, in turn when a list is given.
function gh(answers) {
  const calls = [];
  const run = async (file, args) => {
    calls.push([file, ...args]);
    const key = args.slice(0, 2).join(' ');
    const answer = answers[key];
    const got = Array.isArray(answer) ? answer.shift() : answer;
    return got ?? { code: 1, stdout: '', stderr: 'refused' };
  };
  return { run, calls };
}
const ok = (json) => ({ code: 0, stdout: `${JSON.stringify(json)}\n`, stderr: '' });
const said = () => { const lines = []; return { lines, out: (line) => lines.push(line) }; };
const ARGS = ['--run', 'r1', '--base', 'main', '--every-ms', '1', '--wait-ms', '50'];
const asked = (answer) => ({ engine: { mainCheck: async () => answer } });
const hosted = asked({ ok: true, here: false });

test('fix-rerun asks the helper and never calls gh where checks run here', async () => {
  for (const [green, said_] of [[true, { green: true, rerun: false }], [false, { green: false, rerun: false }]]) {
    const { run, calls } = gh({});
    const o = said();
    assert.equal(await main(ARGS, { run, out: o.out, client: asked({ ok: true, here: true, green, rerun: false }) }), 0);
    assert.deepEqual(JSON.parse(o.lines.at(-1)), said_);
    assert.deepEqual(calls, []);
  }
});

test('a helper that can\'t say where checks run means not green, and no gh', async () => {
  for (const client of [asked({ ok: false, refused: 'no' }), { engine: { mainCheck: async () => { throw new Error('gone'); } } }]) {
    const { run, calls } = gh({});
    const o = said();
    assert.equal(await main(ARGS, { run, out: o.out, client }), 0);
    assert.deepEqual(JSON.parse(o.lines.at(-1)), { green: false, rerun: false });
    assert.deepEqual(calls, []);
  }
});

test('fix-rerun re-runs the newest failed run on the base head and reports green', async () => {
  const { run, calls } = gh({
    'run list': ok([{ databaseId: 77, headSha: HEAD, status: 'completed', conclusion: 'failure' }]),
    'run rerun': ok({}),
    'run view': [ok({ status: 'in_progress', conclusion: '' }), ok({ status: 'completed', conclusion: 'success' })],
  });
  const o = said();
  assert.equal(await main(ARGS, { run, out: o.out, client: hosted }), 0);
  assert.deepEqual(JSON.parse(o.lines.at(-1)), { green: true, rerun: true });
  assert.deepEqual(calls.find((c) => c[1] === 'run' && c[2] === 'rerun'), ['gh', 'run', 'rerun', '77', '--failed']);
  assert.ok(calls.every((c) => c[0] === 'gh'), 'only the broker on PATH');
});

test('fix-rerun reports not green when the re-run fails again', async () => {
  const { run } = gh({
    'run list': ok([{ databaseId: 77, headSha: HEAD, status: 'completed', conclusion: 'failure' }]),
    'run rerun': ok({}),
    'run view': ok({ status: 'completed', conclusion: 'failure' }),
  });
  const o = said();
  assert.equal(await main(ARGS, { run, out: o.out, client: hosted }), 0);
  assert.deepEqual(JSON.parse(o.lines.at(-1)), { green: false, rerun: true });
});

test('fix-rerun reports not green when no failed run of the base head is found', async () => {
  // None at all, and a failure only of an older commit than the newest.
  const older = [{ databaseId: 10, headSha: HEAD, status: 'completed', conclusion: 'success' }, { databaseId: 9, headSha: 'd'.repeat(40), status: 'completed', conclusion: 'failure' }];
  for (const list of [ok([]), ok(older)]) {
    const { run, calls } = gh({ 'run list': list });
    const o = said();
    assert.equal(await main(ARGS, { run, out: o.out, client: hosted }), 0);
    assert.deepEqual(JSON.parse(o.lines.at(-1)), { green: false, rerun: false });
    assert.equal(calls.some((c) => c[2] === 'rerun'), false);
  }
});

test('fix-rerun reports not green when the broker refuses', async () => {
  const { run } = gh({ 'run list': ok([{ databaseId: 77, headSha: HEAD, status: 'completed', conclusion: 'failure' }]) });
  const o = said();
  assert.equal(await main(ARGS, { run, out: o.out, client: hosted }), 0);
  assert.deepEqual(JSON.parse(o.lines.at(-1)), { green: false, rerun: false });
});

test('fix-rerun stops waiting at its limit', async () => {
  const { run } = gh({
    'run list': ok([{ databaseId: 77, headSha: HEAD, status: 'completed', conclusion: 'failure' }]),
    'run rerun': ok({}),
    'run view': { code: 0, stdout: JSON.stringify({ status: 'in_progress', conclusion: '' }), stderr: '' },
  });
  const o = said();
  assert.equal(await main(ARGS, { run, out: o.out, client: hosted }), 0);
  assert.deepEqual(JSON.parse(o.lines.at(-1)), { green: false, rerun: true });
});

test('fix-rerun lists the base branch\'s runs, and re-runs each failed one of its newest commit', async () => {
  const runs = [
    { databaseId: 81, headSha: HEAD, status: 'completed', conclusion: 'failure' },
    { databaseId: 80, headSha: HEAD, status: 'completed', conclusion: 'success' },
    { databaseId: 79, headSha: HEAD, status: 'completed', conclusion: 'failure' },
  ];
  const { run, calls } = gh({ 'run list': ok(runs), 'run rerun': [ok({}), ok({})], 'run view': ok({ status: 'completed', conclusion: 'success' }) });
  const o = said();
  assert.equal(await main(ARGS, { run, out: o.out, client: hosted }), 0);
  assert.deepEqual(JSON.parse(o.lines.at(-1)), { green: true, rerun: true });
  assert.deepEqual(calls.find((c) => c[2] === 'list'), ['gh', 'run', 'list', '--branch', 'main', '--limit', '20', '--json', 'databaseId,headSha,status,conclusion']);
  assert.deepEqual(calls.filter((c) => c[2] === 'rerun').map((c) => c[3]), ['81', '79']);
});

test('fix-rerun needs the base branch', async () => {
  const o = said();
  assert.equal(await main(['--run', 'r1'], { run: async () => ({ code: 0 }), out: o.out }), 2);
});
