// tests/probes/71-gitlab-self-managed/scrub.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tokenShaped, scrubText, scrubFixture } from '../../../probes/71-gitlab-self-managed/scrub.js';

const PAT = `glpat-${'aB3_x9Zq'.repeat(3)}`;
const BASE64URL = 'q7Hk2_Zp9Lw3-Rt8Xv5Nb1Mc4Df6Gs0j';

test('token-shaped strings are found: prefixes, long random runs, long hex runs', () => {
  for (const one of [PAT, 'glrt-abcdefghijklmnopqrst', 'gloas-abcdefghijklmnopqrst', 'glsoat-abcdefghijklmnopqrst', BASE64URL, '3f9a1c7e5b2d4086aa13bc77', '0123456789abcdef0123456789abcdef01234567']) {
    assert.ok(tokenShaped(`value ${one} end`).length > 0, one);
  }
});

test('ordinary words, paths and names are not token-shaped', () => {
  for (const one of ['wheelhouse-gitlab-ee-8929-runner', 'resource_access_token_creation_allowed', 'https://localhost:8929/wh71-probe/trial.git', 'detailed_merge_status', 'PROBE_SECRET is not set', '2026-10-21', 'unable to get local issuer certificate']) {
    assert.deepEqual(tokenShaped(one), [], one);
  }
});

test('scrubText hides held secrets, token shapes, the home folder and the probe folder', () => {
  const text = scrubText(`a ${PAT} b mysecretvalue c /Users/someone/x d /probe/state/ca.pem`, {
    secrets: ['mysecretvalue'], home: '/Users/someone', probe: '/probe',
  });
  assert.equal(text, 'a <TOKEN> b [hidden] c <HOME>/x d <PROBE>/state/ca.pem');
});

test('scrubFixture hides tokens, ids, SHAs, emails, timestamps, dates, variable values and numbered URL parts', () => {
  const sha = 'a'.repeat(40);
  const out = scrubFixture({
    id: 7, project_id: 9, iid: 3, user_ids: [1, 2], name: 'trial', token: PAT, sha, short_id: 'aaaaaaaa',
    created_at: '2026-10-21T07:45:41.110Z', expires_at: '2026-10-22', email: 'wh-maintainer@example.test',
    web_url: 'https://localhost:8929/g/p/-/jobs/12', key: 'PROBE_SECRET', value: 'abc123', protected: true,
    avatar_url: 'https://secure.gravatar.com/avatar/d39e?s=80', note: `see ${PAT}`, allow_runner_registration_token: false,
    nested: [{ id: 5, access_level: 40 }],
  });
  assert.deepEqual(out, {
    id: '<ID>', project_id: '<ID>', iid: '<ID>', user_ids: ['<ID>', '<ID>'], name: 'trial', token: '<TOKEN>', sha: '<SHA>', short_id: '<SHA>',
    created_at: '<TIMESTAMP>', expires_at: '<DATE>', email: '<EMAIL>',
    web_url: 'https://localhost:8929/g/p/-/jobs/<ID>', key: 'PROBE_SECRET', value: '<VALUE>', protected: true,
    avatar_url: '<URL>', note: 'see <TOKEN>', allow_runner_registration_token: false,
    nested: [{ id: '<ID>', access_level: 40 }],
  });
});

test('a scrubbed fixture holds nothing token-shaped', () => {
  const out = JSON.stringify(scrubFixture({ a: PAT, b: BASE64URL, c: [{ d: `x ${BASE64URL} y` }] }));
  assert.deepEqual(tokenShaped(out), []);
});

test('a secret, a prefixed token made of hex, times and ids inside a command\'s JSON output are all hidden', () => {
  const hex = 'ab12'.repeat(16);
  const out = scrubFixture({
    secret: `gloas-${hex}`, application_id: hex, password: 'plain words here',
    output: `[{"id":61,"iid":3,"project_id":10,"sha":"${'c'.repeat(40)}","created_at":"2026-10-21T08:42:44.733Z","web_url":"https://localhost:8929/g/p/-/pipelines/61"}] PUT projects/g%2Fp/merge_requests/7/merge`,
  });
  assert.equal(out.secret, '<TOKEN>');
  assert.equal(out.application_id, '<ID>');
  assert.equal(out.password, '<TOKEN>');
  assert.equal(out.output, '[{"id":<ID>,"iid":<ID>,"project_id":<ID>,"sha":"<SHA>","created_at":"<TIMESTAMP>","web_url":"https://localhost:8929/g/p/-/pipelines/<ID>"}] PUT projects/g%2Fp/merge_requests/<ID>/merge');
  assert.deepEqual(tokenShaped(JSON.stringify(out)), []);
  assert.doesNotMatch(JSON.stringify(out), /gloas-/);
});

test('a prefixed token whose body is hex is hidden whole, not left as its prefix', () => {
  const out = scrubFixture({ note: `x gloas-${'ab12'.repeat(16)} y` });
  assert.equal(out.note, 'x <TOKEN> y');
});

test('a bot user\'s name (project id and hex suffix joined by underscores) and a commit id in text are hidden', () => {
  const name = `project_13_bot_${'0d95'.repeat(8)}`;
  assert.ok(tokenShaped(`x_${'0d95'.repeat(8)}`).length > 0);
  assert.equal(scrubText(`as ${name} at ${'c'.repeat(40)}`), 'as project_<ID>_bot_<SUFFIX> at <SHA>');
  assert.equal(scrubFixture({ username: name }).username, 'project_<ID>_bot_<SUFFIX>');
});
