// tests/probes/61-sessions-chains/run.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { tempFolder } from '../../helpers/homes.js';
import { CHAIN_CASES, chainPrompt, commandOf, main } from '../../../probes/61-sessions/run.js';
import { chainArgs } from '../../../probes/61-sessions-chains/run.js';

const unix = process.platform !== 'win32';
const t = unix ? test : test.skip;
const entry = fileURLToPath(new URL('../../../probes/61-sessions-chains/run.js', import.meta.url));

test('the prompt gives the exact command and says it is a permission test', () => {
  const prompt = chainPrompt("sh -c 'touch y3'");
  assert.match(prompt, /permission system/);
  assert.ok(prompt.includes("sh -c 'touch y3'"));
  assert.equal(commandOf({ arguments: JSON.stringify({ command: 'echo $(rm y2)' }) }), 'echo $(rm y2)');
  assert.equal(commandOf({ arguments: '{"command":"cut' }), null);
  assert.equal(chainArgs(['--dry-run']).at(-1), CHAIN_CASES.map((c) => c.id).join(','));
});

t('--dry-run makes the six chain runs, judges them by tool events and files, and undoes everything', async () => {
  const resultsDir = tempFolder('wh-results-');
  const { results, file } = await main(['--dry-run', '--results-dir', resultsDir, '--only', CHAIN_CASES.map((c) => c.id).join(',')], { out: () => {}, check: '61-sessions-chains' });
  assert.equal(path.basename(file), '61-sessions-chains.dry-run.json');
  assert.equal(results.check, '61-sessions-chains');
  assert.equal(results.runs.length, 6);
  for (const run of results.runs) {
    assert.equal(run.checks.submitted, true, run.id);
    assert.equal(run.checks.outcome, 'denied', run.id);
    assert.ok(!fs.existsSync(run.cwd));
  }
  assert.match(results.runs[0].checks.effect, /y1 created: false/);
  assert.match(results.runs[3].checks.effect, /y1 removed: false/);
});

t('a rule that matches on the first word alone lets the commands through, and the runs show it', async () => {
  process.env.WHEELHOUSE_FAKE_NAIVE = '1';
  try {
    const { results } = await main(['--dry-run', '--results-dir', tempFolder('wh-results-'), '--only', CHAIN_CASES.map((c) => c.id).join(',')], { out: () => {}, check: 'x' });
    const by = (id) => results.runs.find((run) => run.id === id).checks;
    assert.equal(by('chain-and-touch').outcome, 'ran');
    assert.match(by('chain-and-touch').effect, /y1 created: true/);
    assert.match(by('chain-and-rm').effect, /y1 removed: true/);
    assert.equal(by('chain-sh-touch').outcome, 'denied');
  } finally {
    delete process.env.WHEELHOUSE_FAKE_NAIVE;
  }
});

t('run.js --dry-run works as a command', () => {
  const result = spawnSync(process.execPath, [entry, '--dry-run', '--results-dir', tempFolder('wh-results-')], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Check 61-sessions-chains \(dry run/);
  assert.match(result.stdout, /6 model run/);
  assert.match(result.stdout, /Raw results: .*61-sessions-chains\.dry-run\.json/);
});
