// tests/scripts/host/host-approval.test.js
// The person's own approval on GitHub as a condition of a Copilot project's merge (Task B1): read from the pull
// request's reviews, and required by both merge routes, the broker's permit and the helper's /merge.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { hostApprovalReady, HOST_APPROVAL_CHECKED } from '../../../scripts/host/approval-ready.js';
import { hostApproved, hostApprovalNeeded, githubApprovalRules, NO_HOST_APPROVAL } from '../../../scripts/host/host-approval.js';
import { githubCommands, reviewOf } from '../../../scripts/host/github.js';
import { brokerDecision } from '../../../scripts/engine/broker/rules.js';
import { gateDecision } from '../../../scripts/gate/conditions.js';
import { makeEvent } from '../../../scripts/state/events.js';
import { makeSigningKey, enrol, readEnrolled } from '../../../scripts/state/signing.js';
import { as, tempFolder } from '../../helpers/homes.js';

const HEAD = 'a'.repeat(40);
const OLD = 'b'.repeat(40);
const PERSON = 'the-director';
const fixture = (name) => JSON.parse(fs.readFileSync(path.join(import.meta.dirname, '..', '..', 'fixtures', 'github-reviews', `${name}.json`), 'utf8')).reviews.map(reviewOf);
const adapterOf = (reviews) => ({ reviews: async () => reviews });

test('the switch starts off and GitHub is not ready until its check passes', () => {
  assert.equal(HOST_APPROVAL_CHECKED, false);
  assert.equal(hostApprovalReady({ host: 'github' }), false);
  assert.equal(hostApprovalReady(), false);
});

test('GitLab is never ready', () => {
  assert.equal(hostApprovalReady({ host: 'gitlab', plan: 'premium' }, { checked: true }), false);
  assert.equal(hostApprovalReady({ host: 'github' }, { checked: true }), true);
});

test('a review of the head counts', async () => {
  assert.equal(await hostApproved({ adapter: adapterOf(fixture('approved-head')), number: 7, sha: HEAD, person: PERSON }), true);
});

test('a commit added after the approval removes it', async () => {
  assert.equal(await hostApproved({ adapter: adapterOf(fixture('approved-old-head')), number: 7, sha: HEAD, person: PERSON }), false);
});

test('the bot\'s own approval and anyone else\'s don\'t count', async () => {
  assert.equal(await hostApproved({ adapter: adapterOf(fixture('bot-approved')), number: 7, sha: HEAD, person: PERSON }), false);
});

test('a dismissed review and a later request for changes don\'t count', async () => {
  assert.equal(await hostApproved({ adapter: adapterOf(fixture('dismissed')), number: 7, sha: HEAD, person: PERSON }), false);
  assert.equal(await hostApproved({ adapter: adapterOf(fixture('changes-requested-later')), number: 7, sha: HEAD, person: PERSON }), false);
});

test('a review that can\'t be read is no approval', async () => {
  const broken = { reviews: async () => { throw new Error('GitHub did not answer'); } };
  assert.equal(await hostApproved({ adapter: broken, number: 7, sha: HEAD, person: PERSON }), false);
  assert.equal(await hostApproved({ adapter: {}, number: 7, sha: HEAD, person: PERSON }), false, 'an adapter that reads none');
  assert.equal(await hostApproved({ adapter: adapterOf(fixture('approved-head')), number: 7, sha: HEAD, person: '' }), false, 'no person named');
  assert.equal(await hostApproved({ adapter: adapterOf('nonsense'), number: 7, sha: HEAD, person: PERSON }), false);
});

test('the adapter reads the reviews in pages of a hundred', async () => {
  const asked = [];
  const page = (n) => Array.from({ length: n }, (_, i) => ({ id: i, user: { login: 'x' }, state: 'COMMENTED', commit_id: HEAD, submitted_at: '2026-11-02T01:00:00Z' }));
  const answers = [page(100), [{ id: 999, user: { login: PERSON, type: 'User' }, state: 'APPROVED', commit_id: HEAD, submitted_at: '2026-11-02T03:00:00Z' }]];
  const commands = githubCommands({
    call: async (args) => { asked.push(args.at(-1)); return answers[asked.length - 1] ?? []; },
    attempt: async () => ({ code: 1, stdout: '', stderr: '' }), repo: 'o/p',
    json: (args, text) => text, fromAddress: () => null, refusal: () => '', settle: async () => null, httpsOnly: () => null,
  });
  const got = await commands.reviews(7);
  assert.equal(got.length, 101);
  assert.deepEqual(asked, ['repos/o/p/pulls/7/reviews?per_page=100&page=1', 'repos/o/p/pulls/7/reviews?per_page=100&page=2']);
  assert.deepEqual(got.at(-1), { login: PERSON, type: 'User', state: 'APPROVED', commit: HEAD, at: '2026-11-02T03:00:00Z' });
});

test('a Copilot project with real users needs it, when GitHub is ready', () => {
  const ready = () => true;
  assert.equal(hostApprovalNeeded({ agent: 'copilot', realUsers: true, host: 'github' }, { ready }), true);
  assert.equal(hostApprovalNeeded({ agent: 'copilot', realUsers: false, host: 'github' }, { ready }), false);
  assert.equal(hostApprovalNeeded({ agent: 'claude-code', realUsers: true, host: 'github' }, { ready }), false, 'a Claude project\'s merge is unchanged');
  assert.equal(hostApprovalNeeded({ agent: null, realUsers: true, host: 'github' }, { ready }), true, 'an agent that can\'t be told fails closed');
  assert.equal(hostApprovalNeeded({ agent: 'copilot', realUsers: true, host: 'github' }), false, 'switch off');
  assert.equal(hostApprovalNeeded({ agent: 'copilot', realUsers: true, host: 'gitlab' }, { ready }), false);
});

test('the rule asks for one approval, stale ones dismissed, the last push approved', () => {
  const rule = githubApprovalRules();
  assert.equal(rule.type, 'pull_request');
  assert.deepEqual(rule.parameters, {
    required_approving_review_count: 1,
    dismiss_stale_reviews_on_push: true,
    require_code_owner_review: false,
    require_last_push_approval: true,
    required_review_thread_resolution: false,
  });
});

test('the broker refuses a merge the host\'s approval is missing from, and passes it with the approval', async () => {
  await as(path.join(tempFolder('wh-hostapproval-'), 'home'), () => {
    const { computer, publicKey } = makeSigningKey();
    enrol({ computer, publicKey, enrolledAt: '2026-11-02T00:00:00.000Z' });
    const review = makeEvent({ kind: 'review', data: { pr: 7, commit: HEAD, verdict: 'CLEAN' } });
    const call = { kind: 'merge', pr: 7, sha: HEAD };
    const base = { stop: false, lockHeld: true, defaultBranch: 'main', incident: { open: false }, enrolled: readEnrolled(), review, shownFirst: false, level: 2, guardrail: false };
    assert.equal(brokerDecision(call, base).allow, true, 'a merge that needs none is as before');
    const refused = brokerDecision(call, { ...base, hostApproval: false });
    assert.equal(refused.allow, false);
    assert.match(refused.reason, new RegExp(`the director's approval on GitHub of ${HEAD.slice(0, 7)} isn't there`));
    assert.equal(brokerDecision(call, { ...base, hostApproval: true }).allow, true);
    assert.equal(brokerDecision(call, { ...base, hostApproval: 'yes' }).allow, false, 'only true counts');
    assert.equal(NO_HOST_APPROVAL(HEAD.slice(0, 7)), `the director's approval on GitHub of ${HEAD.slice(0, 7)} isn't there`);
  });
});

test('the /merge gate refuses it too, and a Claude project\'s gate is unchanged', () => {
  const input = {
    stop: false, bypass: false, holdsLock: true, headSha: HEAD, ci: { sha: HEAD, state: 'success' },
    reviewRequired: false, approvalRequired: false, touchesGuardrails: false, enrolled: [],
    upToDate: true, provenance: { ok: true }, incident: { open: false },
  };
  assert.deepEqual(gateDecision(input), { allow: true, reasons: [] });
  assert.deepEqual(gateDecision({ ...input, hostApproval: true }), { allow: true, reasons: [] });
  const refused = gateDecision({ ...input, hostApproval: false });
  assert.equal(refused.allow, false);
  assert.deepEqual(refused.reasons, [NO_HOST_APPROVAL(HEAD.slice(0, 7))]);
  assert.equal(gateDecision({ ...input, hostApproval: 'true' }).allow, false);
  assert.equal(gateDecision({ ...input, hostApproval: null }).allow, false, 'a failed read is not an approval');
});
