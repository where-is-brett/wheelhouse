// tests/probes/71-gitlab-self-managed/fixtures.test.js
// What check 71 keeps (the recorded responses and the note) holds no key, no identifier worth
// keeping, no time, and nothing from the computer it was recorded on.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { tokenShaped } from '../../../probes/71-gitlab-self-managed/scrub.js';
import { STEPS } from '../../../probes/71-gitlab-self-managed/run.js';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const FIXTURES = path.join(ROOT, 'tests', 'fixtures', 'gitlab-ee', 'free');
const NOTE = path.join(ROOT, 'docs', 'checks', '71-gitlab-self-managed.md');

const files = () => fs.readdirSync(FIXTURES).filter((name) => name.endsWith('.json')).map((name) => path.join(FIXTURES, name));

test('there is a fixture for every step', () => {
  for (const step of STEPS) {
    assert.ok(fs.existsSync(path.join(FIXTURES, `step-${step.n}-${step.slug}.json`)), `step ${step.n}`);
  }
});

test('no fixture and no note holds a token prefix or a random-looking run', () => {
  for (const file of [...files(), NOTE]) {
    const text = fs.readFileSync(file, 'utf8');
    assert.deepEqual(tokenShaped(text), [], path.basename(file));
    for (const prefix of ['glpat-', 'glrt-', 'gloas-', 'glsoat-']) assert.ok(!text.includes(prefix), `${path.basename(file)}: ${prefix}`);
  }
});

test('no fixture and no note names a folder or a person on the computer it was recorded on', () => {
  for (const file of [...files(), NOTE]) {
    const text = fs.readFileSync(file, 'utf8');
    assert.doesNotMatch(text, /\/Users\/|\/private\/var|\/var\/folders|C:\\Users/, path.basename(file));
    assert.doesNotMatch(text, /@(?!example\.test)[A-Za-z0-9-]+\.[a-z]{2,}\b/, `${path.basename(file)}: an email address`);
  }
});

test('the fixtures use placeholders, not ids, SHAs or times', () => {
  for (const file of files()) {
    const text = fs.readFileSync(file, 'utf8');
    assert.doesNotMatch(text, /\b[0-9a-f]{40}\b/, `${path.basename(file)}: a full SHA`);
    assert.doesNotMatch(text, /\d{4}-\d\d-\d\dT\d\d:\d\d/, `${path.basename(file)}: a time`);
    assert.doesNotMatch(text, /"(?:id|iid|[a-z_]+_id)\\?"\s*:\s*\d+/, `${path.basename(file)}: an id`);
  }
});

test('the PROBE_SECRET value is not in any fixture', () => {
  for (const file of files()) {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    const text = JSON.stringify(parsed);
    for (const variable of text.matchAll(/"key":"PROBE_(?:SECRET|PLAIN)","value":"([^"]*)"/g)) assert.equal(variable[1], '<VALUE>', path.basename(file));
  }
});
