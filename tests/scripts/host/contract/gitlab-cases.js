// tests/scripts/host/contract/gitlab-cases.js
// The shared contract cases for the two GitLab backends. Each case is one adapter call, what GitLab
// answered (as `glab` printed it, and as the web API sent it), and what the adapter must give. The
// same list runs over a fake `glab` and a fake `curl` (tests/scripts/host/contract-gitlab.test.js), so the
// backends cannot answer differently.
//
// A case: { name, call(adapter), glab: [{ code, stdout, stderr }], rest: [{ status, body, exit }], expect | throws | check }.
import { readFileSync } from 'node:fs';

const read = (dir, name) => readFileSync(new URL(`../../../fixtures/host/${dir}/${name}`, import.meta.url), 'utf8');
export const gl = (name) => read('gitlab', name);
export const rs = (name) => read('gitlab-rest', name);

export const SHA = '3f6c1a9e2b7d4c8f0a5e1b9d6c2f7a4e8b0d3c5f';
export const REPO = 'a-director/product';

// GitLab's JSON, passed through by `glab api` and sent as it is by the web API.
const json = (text, status = 200) => [{ stdout: text }, { status, body: text }];
const same = (name, status) => json(gl(name), status);
const both = (glab, rest) => ({ glab, rest });
const answers = (...pairs) => ({ glab: pairs.map((p) => p[0]), rest: pairs.map((p) => p[1]) });

const text = (value) => JSON.stringify(value);
const MR_URL = 'https://gitlab.com/a-director/product/-/merge_requests/4';
const ISSUE_URL = 'https://gitlab.com/a-director/product/-/issues/7';
const REFUSED = (words) => ({ code: 1, stderr: `ERROR: ${words}\n` });
const UNREACHABLE = both([{ code: 1, stderr: 'Get "https://gitlab.com/api/v4/projects": dial tcp: lookup gitlab.com: no such host' }], [{ exit: 6 }]);
const TIMED_OUT = both([{ code: 1, stderr: 'Put "https://gitlab.com/api/v4/x": context deadline exceeded (i/o timeout)' }], [{ exit: 28 }]);

export const cases = [
  // ---- reads ----
  { name: 'defaultBranch', call: (a) => a.defaultBranch(), ...answers(same('project.json')), expect: 'main' },
  { name: 'branchHead', call: (a) => a.branchHead('feature/x'), ...answers(json(text({ name: 'feature/x', commit: { id: SHA } }))), expect: SHA },
  { name: 'isPublic is true for a public project', call: (a) => a.isPublic(), ...answers(json(text({ visibility: 'public' }))), expect: true },
  { name: 'isPublic is false for a private or internal project', call: async (a) => [await a.isPublic()], ...answers(json(text({ visibility: 'internal' }))), expect: [false] },
  { name: 'isPublic with no visibility given is an error, never a guess', call: (a) => a.isPublic(), ...answers(json(text({ id: 3 }))), throws: /did not say whether/ },

  // ---- opening, changing and closing ----
  { name: 'openPr gives the number and the address', call: (a) => a.openPr({ head: 'wheelhouse/welcome-page', base: 'main', title: 'Add the welcome page', body: 'Words' }),
    ...answers([{ stdout: gl('mr-create.txt') }, { status: 201, body: rs('mr-create.json') }]), expect: { number: 4, url: MR_URL } },
  { name: 'openPr says when one is already open', call: (a) => a.openPr({ head: 'wheelhouse/welcome-page', base: 'main', title: 'T', body: '' }),
    ...answers([REFUSED('409 Conflict {message: Another open merge request already exists for this source branch: !4}'), { status: 409, body: rs('mr-already-open.json') }]), throws: /already/i },
  { name: 'updatePr', call: (a) => a.updatePr({ number: 4, title: 'New title', body: 'New words' }),
    ...answers([{ stdout: gl('mr-update.txt') }, { status: 200, body: gl('mr-view-open.json') }]), expect: { number: 4 } },
  { name: 'closePr', call: (a) => a.closePr(4), ...answers([{ stdout: '' }, { status: 200, body: gl('mr-view-closed.json') }]), expect: { number: 4 } },

  // ---- the state of a request ----
  ...[
    ['open and mergeable', 'mr-view-open.json', 'open', 'yes'],
    ['open and still checking', 'mr-view-checking.json', 'open', 'unknown'],
    ['open with a conflict', 'mr-view-conflict.json', 'open', 'no'],
    ['merged', 'mr-view-merged.json', 'merged', 'no'],
    ['closed', 'mr-view-closed.json', 'closed', 'no'],
  ].map(([what, file, state, mergeable]) => ({
    name: `prState ${what}`, call: (a) => a.prState(1), ...answers(same(file)),
    check: (got) => { assert(got.headSha === SHA && got.state === state && got.mergeable === mergeable && got.baseRef === 'main' && got.headRef === 'wheelhouse/welcome-page', got); },
  })),
  { name: 'prState reads a state it does not know as unknown', call: (a) => a.prState(1),
    ...answers(json(text({ ...JSON.parse(gl('mr-view-open.json')), state: 'something_new' }))), check: (got) => { assert(got.state === 'unknown', got); } },

  // ---- checks ----
  { name: 'ciState of a running pipeline', call: (a) => a.ciState(SHA), ...answers(same('pipelines.json')), expect: { sha: SHA, state: 'pending' } },
  { name: 'ciState with no pipeline and no merge request is none', call: (a) => a.ciState(SHA), ...answers(same('pipelines-none.json'), json('[]')), expect: { sha: SHA, state: 'none' } },
  { name: 'hasCi is true when a pipeline ran', call: (a) => a.hasCi(SHA, 'main'), ...answers(same('pipelines.json')), expect: true },
  { name: 'hasCi is true when the branch holds a CI file', call: (a) => a.hasCi(SHA, 'main'),
    ...answers(same('pipelines-none.json'), json('[]'), json(text({ file_name: '.gitlab-ci.yml' }))), expect: true },
  { name: 'hasCi is false when there is no CI file', call: (a) => a.hasCi(SHA, 'main'),
    ...answers(same('pipelines-none.json'), json('[]'), [{ code: 1, stderr: 'ERROR: 404 Not Found {message: 404 File Not Found}' }, { status: 404, body: text({ message: '404 File Not Found' }) }]), expect: false },
  { name: 'previewUrl is the newest deployment of the commit', call: (a) => a.previewUrl(SHA), ...answers(same('deployments.json')), expect: 'https://feature-welcome-page-3f6c1a9e.review.example.org/' },
  { name: 'previewUrl is none when nothing was deployed', call: (a) => a.previewUrl(SHA), ...answers(same('deployments-none.json')), expect: null },

  // ---- merging ----
  { name: 'merge that GitLab made', call: (a) => a.merge({ number: 1, sha: SHA }),
    ...answers([{ stdout: '' }, { status: 200, body: text({ iid: 1, state: 'merged' }) }], same('mr-view-merged.json')), expect: { merged: true } },
  { name: 'merge refused: the head moved', call: (a) => a.merge({ number: 1, sha: SHA }),
    ...answers([{ code: 1, stderr: gl('merge-refused.txt') }, { status: 409, body: rs('merge-head-moved.json') }]), check: (got) => { assert(got.merged === false && /head .* moved/i.test(got.reason), got); } },
  { name: 'merge refused: a conflict', call: (a) => a.merge({ number: 1, sha: SHA }),
    ...answers([REFUSED('406 Not Acceptable {message: Branch cannot be merged because of a merge conflict}'), { status: 406, body: rs('merge-conflict.json') }]), check: (got) => { assert(got.merged === false && /merge conflict/i.test(got.reason), got); } },
  { name: 'merge refused: the checks have not passed', call: (a) => a.merge({ number: 1, sha: SHA }),
    ...answers([REFUSED('405 Method Not Allowed {message: Pipeline must succeed}'), { status: 405, body: rs('merge-checks.json') }]), check: (got) => { assert(got.merged === false && /required checks/i.test(got.reason), got); } },
  { name: 'merge refused: not allowed', call: (a) => a.merge({ number: 1, sha: SHA }),
    ...answers([REFUSED('403 Forbidden'), { status: 403, body: rs('merge-forbidden.json') }]), check: (got) => { assert(got.merged === false && /not allowed to merge/i.test(got.reason), got); } },
  { name: 'merge refused: the key is not accepted', call: (a) => a.merge({ number: 1, sha: SHA }),
    ...answers([REFUSED('401 Unauthorized'), { status: 401, body: rs('unauthorized.json') }]), check: (got) => { assert(got.merged === false && got.keyRefused === true, got); } },
  { name: 'merge that GitLab queued is taken back and refused', call: (a) => a.merge({ number: 1, sha: SHA }),
    ...answers([{ stdout: '' }, { status: 200, body: text({ iid: 1, state: 'opened' }) }], same('mr-view-open.json'), json('{}')), check: (got) => { assert(got.merged === false && got.queued === true && /queues merges/.test(got.reason), got); } },
  { name: 'merge that cannot reach GitLab says so', call: (a) => a.merge({ number: 1, sha: SHA }),
    ...UNREACHABLE, check: (got) => { assert(got.merged === false && got.unreachable === true && /can't be reached/.test(got.reason) && /^Not merged/.test(got.reason), got); } },
  { name: 'merge that timed out could not be confirmed', call: (a) => a.merge({ number: 1, sha: SHA }),
    ...TIMED_OUT, check: (got) => { assert(got.merged === false && got.unreachable === true && /could not be confirmed/.test(got.reason), got); } },

  // ---- approving ----
  { name: 'approvalsNeeded counts what is left', call: (a) => a.approvalsNeeded(4), ...answers(json(rs('approvals-needed.json'))), expect: 1 },
  { name: 'approvalsNeeded is 0 when none is wanted', call: (a) => a.approvalsNeeded(4), ...answers(json(rs('approvals-none.json'))), expect: 0 },
  { name: 'approve', call: (a) => a.approve({ number: 4, sha: SHA }), ...answers([{ stdout: '' }, { status: 201, body: rs('approve-ok.json') }]), expect: { approved: true } },
  { name: 'approve refused for the author gives the plain line', call: (a) => a.approve({ number: 4, sha: SHA }),
    ...answers([REFUSED('403 Forbidden {message: You can\'t approve your own merge request}'), { status: 403, body: rs('approve-self.json') }]),
    check: (got) => { assert(got.approved === false && got.selfApproval === true && /doesn't let the author approve their own merge request/.test(got.reason) && /project-only key/.test(got.reason), got); } },
  { name: 'approve says when the head has moved', call: (a) => a.approve({ number: 4, sha: SHA }),
    ...answers([REFUSED('409 Conflict {message: SHA does not match HEAD of source branch}'), { status: 409, body: rs('approve-head-moved.json') }]),
    check: (got) => { assert(got.approved === false && /head .* moved/i.test(got.reason) && got.selfApproval === undefined, got); } },
  { name: 'approve refused: the key is not accepted', call: (a) => a.approve({ number: 4, sha: SHA }),
    ...answers([REFUSED('401 Unauthorized'), { status: 401, body: rs('unauthorized.json') }]), check: (got) => { assert(got.approved === false && got.keyRefused === true, got); } },
  { name: 'approve that cannot reach GitLab says so', call: (a) => a.approve({ number: 4, sha: SHA }),
    ...UNREACHABLE, check: (got) => { assert(got.approved === false && got.unreachable === true && /^Not approved/.test(got.reason), got); } },

  // ---- lists and details ----
  { name: 'openRequests are sorted, with the fork and draft flags', call: (a) => a.openRequests(), ...answers(json(rs('merge-requests-list.json'))),
    expect: [
      { number: 4, title: 'First', body: 'Words', branch: 'one', head: '46322a2e182ab8e1bcace1b058b1818f5c93f61f', draft: false, fork: false },
      { number: 9, title: 'Second', body: '', branch: 'two', head: SHA, draft: true, fork: true },
    ] },
  { name: 'requestDetails counts lines and orders commits oldest first', call: (a) => a.requestDetails(4),
    ...answers([{ stdout: rs('mr-changes.json') }, { status: 200, body: rs('mr-diffs.json') }], json(rs('mr-commits.json'))),
    expect: { files: [{ path: 'src/a.js', additions: 2, deletions: 1 }, { path: 'README.md', additions: 1, deletions: 1 }], commits: ['First change', 'Second change'] } },
  { name: 'issue.create', call: (a) => a.issue.create({ title: 'Backlog item', body: 'Words', labels: ['wheelhouse'] }),
    ...answers([{ stdout: gl('issue-create.txt') }, { status: 201, body: rs('issue-create.json') }]), expect: { number: 7, url: ISSUE_URL } },
  { name: 'issue.update', call: (a) => a.issue.update({ number: 7, body: 'New words' }),
    ...answers([{ stdout: gl('issue-update.txt') }, { status: 200, body: rs('issue-create.json') }]), expect: { number: 7 } },
  { name: 'issue.list', call: (a) => a.issue.list({ label: 'wheelhouse' }), ...answers(same('issue-list.json')),
    expect: [{ number: 7, title: 'Wheelhouse checklist', body: '- [ ] Add the welcome page\n- [x] Set up the project', url: ISSUE_URL, labels: ['wheelhouse'], state: 'open' }] },

  // ---- reaching the host ----
  { name: 'a read that cannot reach GitLab throws with its code', call: (a) => a.defaultBranch(), ...UNREACHABLE, throws: /can't be reached/, code: 'HOST_UNREACHABLE' },
  { name: 'a read refused with 404 is an error', call: (a) => a.defaultBranch(),
    ...answers([REFUSED('404 Not Found'), { status: 404, body: text({ message: '404 Project Not Found' }) }]), throws: /404/ },
];

// A failed condition throws with the value that broke it.
function assert(condition, got) {
  if (!condition) throw new Error(`The adapter's answer was not as the case expects: ${JSON.stringify(got)}`);
}

