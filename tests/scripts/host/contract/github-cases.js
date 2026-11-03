// tests/scripts/host/contract/github-cases.js
// The shared contract cases for the two GitHub backends. Each case is one adapter call, what GitHub answered
// (as `gh` printed it, and as the web API sent it), and what the adapter must give. The same list runs over a
// fake `gh` and a fake `curl` (tests/scripts/host/contract-github.test.js), so the backends cannot answer differently.
//
// A case: { name, call(adapter), gh: [{ code, stdout, stderr }], rest: [{ status, body, exit }], expect | throws | check }.
import { readFileSync } from 'node:fs';

const read = (dir, name) => readFileSync(new URL(`../../../fixtures/host/${dir}/${name}`, import.meta.url), 'utf8');
export const ghFile = (name) => read('github', name);
export const rs = (name) => read('github-rest', name);

export const SHA = '46322a2e182ab8e1bcace1b058b1818f5c93f61f';
export const MOVED = '9d1c0b7a5e3f2a8c6b4d1e0f7a9c3b5d2e8f4a6c';
export const REPO = 'a-director/product';

const text = (value) => JSON.stringify(value);
const PR_URL = 'https://github.com/a-director/product/pull/4';
const ISSUE_URL = 'https://github.com/a-director/product/issues/7';

// A pull request as the web API gives it, and as `gh pr view` gives it.
const pull = (over = {}) => ({
  number: 4, html_url: PR_URL, state: 'open', merged: false, mergeable: true, title: 'Add the welcome page', body: 'Words',
  node_id: 'PR_kwDOAAAAAA0000001',
  head: { sha: SHA, ref: 'wheelhouse/welcome-page', repo: { full_name: REPO } },
  base: { ref: 'main', repo: { full_name: REPO } },
  ...over,
});
const view = (over = {}) => ({
  number: 4, url: PR_URL, headRefOid: SHA, headRefName: 'wheelhouse/welcome-page', baseRefName: 'main', mergeable: 'MERGEABLE',
  state: 'OPEN', title: 'Add the welcome page', body: 'Words', ...over,
});

const ok = (body, status = 200) => ({ status, body: typeof body === 'string' ? body : text(body) });
// What `gh api` prints for a refusal: the status on standard error, the host's JSON on standard output.
const refused = (status, words, extra = {}) => ({ code: 1, stdout: text({ message: words, ...extra }), stderr: `gh: ${words} (HTTP ${status})\n` });
const refusedRest = (status, words, extra = {}) => ({ status, body: text({ message: words, ...extra }) });
const both = (gh, rest) => ({ gh, rest });
const same = (body, status = 200) => ({ gh: [{ stdout: typeof body === 'string' ? body : text(body) }], rest: [ok(body, status)] });
const rules = (count) => [{ type: 'pull_request', parameters: { required_approving_review_count: count } }, { type: 'required_status_checks', parameters: { required_status_checks: [{ context: 'test' }] } }];
const review = (login, state, commit = SHA, type = 'User') => ({ user: { login, type }, state, commit_id: commit, submitted_at: '2026-11-03T01:00:00Z' });
const JOINED = (...parts) => ({
  gh: parts.map((p) => p.gh).flat(),
  rest: parts.map((p) => p.rest).flat(),
});

export const cases = [
  // ---- reads ----
  { name: 'defaultBranch', call: (a) => a.defaultBranch(), ...both([{ stdout: ghFile('repo-view.json') }], [ok({ default_branch: 'main' })]), expect: 'main' },
  { name: 'branchHead', call: (a) => a.branchHead('feature/x'), ...same({ name: 'feature/x', commit: { sha: SHA } }), expect: SHA },
  { name: 'login', call: (a) => a.login(), ...same({ login: 'a-director-bot' }), expect: 'a-director-bot' },

  // ---- opening, changing and closing ----
  { name: 'openPr gives the number and the address', call: (a) => a.openPr({ head: 'wheelhouse/welcome-page', base: 'main', title: 'Add the welcome page', body: 'Words' }),
    ...both([{ stdout: ghFile('pr-create.txt') }], [ok(pull(), 201)]), expect: { number: 4, url: PR_URL } },
  { name: 'openPr says when one is already open', call: (a) => a.openPr({ head: 'wheelhouse/welcome-page', base: 'main', title: 'T', body: '' }),
    ...both([{ code: 1, stderr: 'GraphQL: A pull request already exists for a-director:wheelhouse/welcome-page. (createPullRequest)\n' }],
      [refusedRest(422, 'Validation Failed', { errors: [{ message: 'A pull request already exists for a-director:wheelhouse/welcome-page.' }] })]), throws: /already/i },
  { name: 'updatePr', call: (a) => a.updatePr({ number: 4, title: 'New title', body: 'New words' }), ...both([{ stdout: ghFile('pr-edit.txt') }], [ok(pull())]), expect: { number: 4 } },
  { name: 'closePr', call: (a) => a.closePr(4), ...both([{ stdout: '' }], [ok(pull({ state: 'closed' }))]), expect: { number: 4 } },

  // ---- the state of a request ----
  ...[
    ['open and mergeable', {}, {}, 'open', 'yes'],
    ['open and still checking', { mergeable: null }, { mergeable: 'UNKNOWN' }, 'open', 'unknown'],
    ['open with a conflict', { mergeable: false }, { mergeable: 'CONFLICTING' }, 'open', 'no'],
    ['merged', { state: 'closed', merged: true, mergeable: false }, { state: 'MERGED', mergeable: 'UNKNOWN' }, 'merged', 'unknown'],
    ['closed', { state: 'closed', mergeable: null }, { state: 'CLOSED', mergeable: 'UNKNOWN' }, 'closed', 'unknown'],
  ].map(([what, restOver, ghOver, state, mergeable]) => ({
    name: `prState ${what}`, call: (a) => a.prState(4), ...both([{ stdout: text(view(ghOver)) }], [ok(pull(restOver))]),
    check: (got) => { assert(got.headSha === SHA && got.state === state && got.mergeable === mergeable && got.baseRef === 'main' && got.headRef === 'wheelhouse/welcome-page' && got.title === 'Add the welcome page' && got.body === 'Words', got); },
  })),

  // ---- checks ----
  { name: 'ciState success', call: (a) => a.ciState(SHA), ...same(ghFile('ci-success.json')), expect: { sha: SHA, state: 'success' } },
  { name: 'ciState pending', call: (a) => a.ciState(SHA), ...same(ghFile('ci-pending.json')), expect: { sha: SHA, state: 'pending' } },
  { name: 'ciState none', call: (a) => a.ciState(SHA), ...same(ghFile('ci-none.json')), expect: { sha: SHA, state: 'none' } },
  { name: 'ciState turns a GraphQL error into an error', call: (a) => a.ciState(SHA), ...same({ data: null, errors: [{ message: 'boom' }] }), throws: /could not read the commit's checks/ },
  { name: 'checkContexts', call: (a) => a.checkContexts(SHA),
    ...same({ data: { repository: { object: { statusCheckRollup: { contexts: { nodes: [
      { __typename: 'CheckRun', name: 'test', status: 'COMPLETED', conclusion: 'SUCCESS', startedAt: '2026-11-03T01:00:00Z', completedAt: '2026-11-03T01:02:00Z', checkSuite: { app: { slug: 'github-actions' } } },
      { __typename: 'StatusContext', context: 'wheelhouse/checks', state: 'SUCCESS', createdAt: '2026-11-03T01:03:00Z', creator: { login: 'a-director-bot' } },
    ] } } } } } }),
    expect: [
      { name: 'test', state: 'success', startedAt: '2026-11-03T01:00:00Z', app: 'github-actions' },
      { name: 'wheelhouse/checks', state: 'success', startedAt: '2026-11-03T01:03:00Z', app: 'a-director-bot' },
    ] },
  { name: 'requiredChecks names the required checks', call: (a) => a.requiredChecks('main'), ...same(rules(1)), expect: ['test'] },
  { name: 'requiredChecks is empty on a plan with no rules', call: (a) => a.requiredChecks('main'),
    ...both([{ code: 1, stderr: 'gh: Upgrade to GitHub Pro or make this repository public to enable this feature. (HTTP 403)\n' }], [refusedRest(403, 'Upgrade to GitHub Pro or make this repository public to enable this feature.')]), expect: [] },
  { name: 'requiredChecks is null when the rules cannot be read', call: (a) => a.requiredChecks('main'),
    ...both([{ code: 1, stderr: 'gh: Not Found (HTTP 404)\n' }], [refusedRest(404, 'Not Found')]), expect: null },
  { name: 'setStatus', call: (a) => a.setStatus({ sha: SHA, state: 'success', description: 'All checks passed' }), ...same({ id: 1 }, 201), expect: { ok: true } },
  { name: 'setStatus refused for want of permission', call: (a) => a.setStatus({ sha: SHA, state: 'success', description: 'x' }),
    ...both([refused(403, 'Resource not accessible by integration')], [refusedRest(403, 'Resource not accessible by integration')]), expect: { refused: 'permission' } },
  { name: 'hasCi is true when the commit has checks', call: (a) => a.hasCi(SHA, 'main'), ...same(ghFile('ci-success.json')), expect: true },
  { name: 'hasCi is true when the branch holds workflows', call: (a) => a.hasCi(SHA, 'main'),
    ...JOINED(same(ghFile('ci-none.json')), same([{ name: 'ci.yml' }])), expect: true },
  { name: 'hasCi is false when there is no workflows folder', call: (a) => a.hasCi(SHA, 'main'),
    ...JOINED(same(ghFile('ci-none.json')), both([{ code: 1, stderr: 'gh: Not Found (HTTP 404)\n' }], [refusedRest(404, 'Not Found')])), expect: false },
  { name: 'previewUrl is the newest successful deployment', call: (a) => a.previewUrl(SHA),
    ...JOINED(same(ghFile('deployments.json')), same(ghFile('deployment-statuses.json'))), expect: 'https://product-4f2a91c-a-director.example.app/' },
  { name: 'previewUrl is none when nothing was deployed', call: (a) => a.previewUrl(SHA), ...same(ghFile('deployments-none.json')), expect: null },

  // ---- merging ----
  { name: 'merge that GitHub made', call: (a) => a.merge({ number: 4, sha: SHA }),
    ...both([{ stdout: '' }, { stdout: text({ state: 'MERGED' }) }], [ok({ merged: true, sha: MOVED }), ok(pull({ state: 'closed', merged: true }))]), expect: { merged: true } },
  { name: 'merge refused: the head moved', call: (a) => a.merge({ number: 4, sha: SHA }),
    ...both([{ code: 1, stderr: ghFile('merge-refused.txt') }], [refusedRest(409, 'Head branch was modified. Review and try the merge again.')]), check: (got) => { assert(got.merged === false && /head .* moved/i.test(got.reason), got); } },
  { name: 'merge refused: a conflict', call: (a) => a.merge({ number: 4, sha: SHA }),
    ...both([{ code: 1, stderr: 'GraphQL: Pull Request is not mergeable: merge conflict (mergePullRequest)\n' }], [refusedRest(405, 'Pull Request is not mergeable: merge conflict')]), check: (got) => { assert(got.merged === false && /merge conflict/i.test(got.reason), got); } },
  { name: 'merge refused: the checks have not passed', call: (a) => a.merge({ number: 4, sha: SHA }),
    ...both([{ code: 1, stderr: 'GraphQL: Required status check "test" is expected. (mergePullRequest)\n' }], [refusedRest(405, 'Required status check "test" is expected.')]), check: (got) => { assert(got.merged === false && /required checks/i.test(got.reason), got); } },
  { name: 'merge refused: an approving review is needed', call: (a) => a.merge({ number: 4, sha: SHA }),
    ...both([{ code: 1, stderr: 'GraphQL: At least 1 approving review is required by reviewers with write access. (mergePullRequest)\n' }], [refusedRest(405, 'At least 1 approving review is required by reviewers with write access.')]),
    check: (got) => { assert(got.merged === false && /approving review/i.test(got.reason), got); } },
  { name: 'merge refused: not allowed', call: (a) => a.merge({ number: 4, sha: SHA }),
    ...both([{ code: 1, stderr: 'GraphQL: Resource not accessible by integration (mergePullRequest)\n' }], [refusedRest(403, 'Resource not accessible by integration')]), check: (got) => { assert(got.merged === false && /not allowed to merge/i.test(got.reason), got); } },
  { name: 'merge that GitHub queued is taken back and refused', call: (a) => a.merge({ number: 4, sha: SHA }),
    ...both([{ stdout: '' }, { stdout: text({ state: 'OPEN' }) }, { stdout: '' }], [ok({ merged: true }), ok(pull()), ok({ data: { disablePullRequestAutoMerge: { clientMutationId: null } } })]),
    check: (got) => { assert(got.merged === false && got.queued === true && /queues merges/.test(got.reason), got); } },

  // ---- approving ----
  { name: 'approve', call: (a) => a.approve({ number: 4, sha: SHA }),
    ...both([{ stdout: text({ headRefOid: SHA }) }, { stdout: rs('review-approved.json') }], [ok(pull()), ok(rs('review-approved.json'))]), expect: { approved: true } },
  { name: 'approve says when the head has moved, and posts nothing', call: (a) => a.approve({ number: 4, sha: SHA }),
    ...both([{ stdout: text({ headRefOid: MOVED }) }], [ok(pull({ head: { sha: MOVED, ref: 'wheelhouse/welcome-page', repo: { full_name: REPO } } }))]),
    check: (got) => { assert(got.approved === false && /head .* moved/i.test(got.reason) && got.selfApproval === undefined, got); } },
  { name: 'approve refused for the author gives the plain line', call: (a) => a.approve({ number: 4, sha: SHA }),
    ...both([{ stdout: text({ headRefOid: SHA }) }, refused(422, 'Unprocessable Entity', { errors: ['Can not approve your own pull request'] })],
      [ok(pull()), refusedRest(422, 'Unprocessable Entity', { errors: ['Can not approve your own pull request'] })]),
    check: (got) => { assert(got.approved === false && got.selfApproval === true && /doesn't let the author approve their own pull request/.test(got.reason) && /project-only key/.test(got.reason), got); } },
  { name: 'approve refused: the key is not accepted', call: (a) => a.approve({ number: 4, sha: SHA }),
    ...both([{ stdout: text({ headRefOid: SHA }) }, refused(401, 'Bad credentials')], [ok(pull()), refusedRest(401, 'Bad credentials')]),
    check: (got) => { assert(got.approved === false && got.keyRefused === true, got); } },
  { name: 'approve refused: not allowed', call: (a) => a.approve({ number: 4, sha: SHA }),
    ...both([{ stdout: text({ headRefOid: SHA }) }, refused(403, 'Resource not accessible by integration')], [ok(pull()), refusedRest(403, 'Resource not accessible by integration')]),
    check: (got) => { assert(got.approved === false && got.selfApproval === undefined && got.keyRefused === undefined && /did not approve/.test(got.reason), got); } },
  { name: 'approvalsNeeded counts what is left', call: (a) => a.approvalsNeeded(4),
    ...JOINED(both([{ stdout: text(view()) }], [ok(pull())]), same(rules(2)), same([review('colleague', 'APPROVED')])), expect: 1 },
  { name: 'approvalsNeeded ignores an approval of an older head, and one since taken back', call: (a) => a.approvalsNeeded(4),
    ...JOINED(both([{ stdout: text(view()) }], [ok(pull())]), same(rules(2)),
      same([review('one', 'APPROVED', MOVED), review('two', 'APPROVED'), review('two', 'CHANGES_REQUESTED'), review('three', 'APPROVED'), review('three', 'COMMENTED')])), expect: 1 },
  { name: 'approvalsNeeded is 0 when enough have approved', call: (a) => a.approvalsNeeded(4),
    ...JOINED(both([{ stdout: text(view()) }], [ok(pull())]), same(rules(1)), same([review('colleague', 'APPROVED')])), expect: 0 },
  { name: 'approvalsNeeded is 0 when no review is required', call: (a) => a.approvalsNeeded(4),
    ...JOINED(both([{ stdout: text(view()) }], [ok(pull())]), same([{ type: 'deletion' }]), same([])), expect: 0 },
  { name: 'approvalsNeeded is 0 on a plan with no rules', call: (a) => a.approvalsNeeded(4),
    ...JOINED(both([{ stdout: text(view()) }], [ok(pull())]),
      both([{ code: 1, stderr: 'gh: Upgrade to GitHub Pro or make this repository public to enable this feature. (HTTP 403)\n' }], [refusedRest(403, 'Upgrade to GitHub Pro or make this repository public to enable this feature.')]), same([])), expect: 0 },
  { name: 'approvalsNeeded throws when the rules cannot be read', call: (a) => a.approvalsNeeded(4),
    ...JOINED(both([{ stdout: text(view()) }], [ok(pull())]), both([{ code: 1, stderr: 'gh: Server Error (HTTP 500)\n' }], [refusedRest(500, 'Server Error')])), throws: /approvals/i },

  // ---- lists and details ----
  { name: 'openRequests are sorted, with the fork and draft flags', call: (a) => a.openRequests(),
    ...both([{ stdout: text([
      { number: 9, title: 'Second', body: null, headRefName: 'two', headRefOid: MOVED, isDraft: true, isCrossRepository: true },
      { number: 4, title: 'First', body: 'Words', headRefName: 'one', headRefOid: SHA, isDraft: false, isCrossRepository: false },
    ]) }], [ok([
      pull({ number: 9, title: 'Second', body: null, draft: true, head: { sha: MOVED, ref: 'two', repo: { full_name: 'someone/product' } } }),
      pull({ number: 4, title: 'First', body: 'Words', draft: false, head: { sha: SHA, ref: 'one', repo: { full_name: REPO } } }),
    ])]),
    expect: [
      { number: 4, title: 'First', body: 'Words', branch: 'one', head: SHA, draft: false, fork: false },
      { number: 9, title: 'Second', body: '', branch: 'two', head: MOVED, draft: true, fork: true },
    ] },
  { name: 'requestDetails gives files and commit subjects, oldest first', call: (a) => a.requestDetails(4),
    ...both([{ stdout: text({ files: [{ path: 'src/a.js', additions: 2, deletions: 1 }, { path: 'README.md', additions: 1, deletions: 1 }], commits: [{ messageHeadline: 'First change' }, { messageHeadline: 'Second change' }] }) }],
      [ok([{ filename: 'src/a.js', additions: 2, deletions: 1 }, { filename: 'README.md', additions: 1, deletions: 1 }]), ok([{ commit: { message: 'First change\n\nLong words' } }, { commit: { message: 'Second change' } }])]),
    expect: { files: [{ path: 'src/a.js', additions: 2, deletions: 1 }, { path: 'README.md', additions: 1, deletions: 1 }], commits: ['First change', 'Second change'] } },
  { name: 'verdictComment posts one and keeps its id', call: (a) => a.verdictComment({ number: 4, body: 'Verdict' }), ...same({ id: 555 }, 201), expect: { id: 555 } },
  { name: 'verdictComment edits the kept one in place', call: (a) => a.verdictComment({ number: 4, id: 555, body: 'Verdict' }), ...same({ id: 555 }), expect: { id: 555 } },
  { name: 'verdictComment posts again when the kept one is gone', call: (a) => a.verdictComment({ number: 4, id: 555, body: 'Verdict' }),
    ...JOINED(both([{ code: 1, stderr: 'gh: Not Found (HTTP 404)\n' }], [refusedRest(404, 'Not Found')]), same({ id: 556 }, 201)), expect: { id: 556 } },
  { name: 'issue.create', call: (a) => a.issue.create({ title: 'Backlog item', body: 'Words', labels: ['wheelhouse'] }),
    ...both([{ stdout: ghFile('issue-create.txt') }], [ok({ number: 7, html_url: ISSUE_URL }, 201)]), expect: { number: 7, url: ISSUE_URL } },
  { name: 'issue.update', call: (a) => a.issue.update({ number: 7, body: 'New words' }), ...both([{ stdout: ghFile('issue-edit.txt') }], [ok({ number: 7, html_url: ISSUE_URL })]), expect: { number: 7 } },
  { name: 'issue.list leaves out pull requests', call: (a) => a.issue.list({ label: 'wheelhouse' }),
    ...both([{ stdout: ghFile('issue-list.json') }], [ok([
      { number: 7, title: 'Wheelhouse checklist', body: '- [ ] Add the welcome page\n- [x] Set up the project', html_url: ISSUE_URL, labels: [{ name: 'wheelhouse' }], state: 'open' },
      { number: 8, title: 'A pull request', body: '', html_url: PR_URL, labels: [], state: 'open', pull_request: {} },
    ])]),
    expect: [{ number: 7, title: 'Wheelhouse checklist', body: '- [ ] Add the welcome page\n- [x] Set up the project', url: ISSUE_URL, labels: ['wheelhouse'], state: 'open' }] },

  // ---- reaching the host ----
  { name: 'a read refused with 404 is an error', call: (a) => a.defaultBranch(), ...both([{ code: 1, stderr: 'GraphQL: Could not resolve to a Repository (HTTP 404)\n' }], [refusedRest(404, 'Not Found')]), throws: /404/ },
];

// A failed condition throws with the value that broke it.
function assert(condition, got) {
  if (!condition) throw new Error(`The adapter's answer was not as the case expects: ${JSON.stringify(got)}`);
}
