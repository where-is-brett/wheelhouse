// scripts/host/gitlab-shared.js
// What the two GitLab backends read the same way: `gitlab.js` (GitLab's tool, `glab`) and
// `gitlab-rest.js` (the web API through `curl`). The mappings from GitLab's answers to the adapter's
// values live here once, so the backends cannot drift apart.

// Mergeability comes from `detailed_merge_status`. The recorded merge request
// (tests/fixtures/host/gitlab/mr-view-closed.json) has this field and no
// `merge_status`, which GitLab has deprecated.
//
//   mergeable                                   -> yes
//   unchecked, checking, preparing,
//   approvals_syncing, ci_still_running         -> unknown (not settled yet: not yes, not no)
//   any other documented value, such as
//   conflict, need_rebase, not_open, draft_status,
//   discussions_not_resolved, ci_must_pass,
//   not_approved, blocked_status,
//   requested_changes, merge_time, ...          -> no (it cannot merge now)
//   a value not listed here                     -> unknown, never yes
const UNKNOWN = new Set(['unchecked', 'checking', 'preparing', 'approvals_syncing', 'ci_still_running']);
const CANNOT = new Set([
  'blocked_status', 'broken_status', 'ci_must_pass', 'commits_status', 'conflict',
  'discussions_not_resolved', 'draft_status', 'jira_association_missing', 'locked_lfs_files', 'locked_paths',
  'merge_request_blocked', 'merge_time', 'need_rebase', 'not_approved', 'not_open', 'requested_changes',
  'security_policy_violations', 'security_policy_pipeline_check', 'status_checks_must_pass', 'title_regex',
]);

export function mergeable(status) {
  if (status === 'mergeable') return 'yes';
  if (UNKNOWN.has(status)) return 'unknown';
  if (CANNOT.has(status)) return 'no';
  return 'unknown';
}

// 'locked' (a merge in progress) and any state not listed are unknown, never closed.
export const STATE = { opened: 'open', merged: 'merged', closed: 'closed' };

// The newest pipeline for the commit. A skipped pipeline ran nothing, so it
// counts as none; anything not yet finished is pending.
const PIPELINE = {
  success: 'success',
  failed: 'failure', canceled: 'failure', canceling: 'failure',
  created: 'pending', waiting_for_resource: 'pending', preparing: 'pending', waiting_for_callback: 'pending',
  pending: 'pending', running: 'pending', scheduled: 'pending', manual: 'pending',
  skipped: 'none',
};

// A pipeline whose source is `external` is a commit status someone posted with a key, not a run
// (check 71, step 4): at Free the project key can post one for a commit that has no pipeline, so it
// stands for no run of the project's tests and reads as none. This narrows Wheelhouse's own gate
// only; GitLab's own page still shows such a merge request as mergeable.
export const stateOf = (pipeline) => (pipeline.source === 'external' ? 'none' : (PIPELINE[pipeline.status] ?? 'pending'));

// ---- Merged results ----

// A pipeline for merged results runs on a merge commit of the target and the head, so the
// `sha` filter does not find it. For each open merge request of the head, its own
// `head_pipeline` is used first, when it ran on the head or on a merged-results commit that
// has the head as a parent; failing that, the merge request's list of pipelines is searched
// the same way. Anything not found, or not readable, is 'none'.
// `get(path)` gives GitLab's JSON for an API path under /api/v4 (and throws when it can't).
// With `strict`, a failed lookup is thrown instead of read as 'none' (the health read tells
// not being able to look from having looked and found nothing; the gate keeps the 'none').
const MERGE_REF = /^refs\/merge-requests\/\d+\/merge$/;

export async function mergedResults({ get, project, sha, strict = false }) {
  async function ranOnHead(pipeline) {
    if (typeof pipeline?.sha !== 'string') return false;
    if (pipeline.sha === sha) return true;
    if (typeof pipeline.ref !== 'string' || !MERGE_REF.test(pipeline.ref)) return false;
    const commit = await get(`${project}/repository/commits/${pipeline.sha}`);
    return Array.isArray(commit?.parent_ids) && commit.parent_ids.includes(sha);
  }
  try {
    const requests = await get(`${project}/repository/commits/${sha}/merge_requests`);
    const open = (Array.isArray(requests) ? requests : []).filter((r) => r?.state === 'opened' && Number.isInteger(r.iid));
    for (const request of open.slice(0, 5)) {
      const full = await get(`${project}/merge_requests/${request.iid}`);
      if (await ranOnHead(full?.head_pipeline)) return stateOf(full.head_pipeline);
      const list = await get(`${project}/merge_requests/${request.iid}/pipelines?per_page=5`);
      for (const pipeline of (Array.isArray(list) ? list : []).filter((p) => MERGE_REF.test(String(p?.ref)))) {
        if (await ranOnHead(pipeline)) return stateOf(pipeline);
        break; // the newest merged-results pipeline is the one that counts
      }
    }
  } catch (error) {
    if (strict) throw error;
    /* not readable: no pipeline is claimed */
  }
  return 'none';
}

// ---- Answers mapped to the adapter's values ----

export function prStateOf(mr) {
  return {
    headSha: mr.sha,
    ...(typeof mr.title === 'string' ? { title: mr.title } : {}),
    ...(typeof mr.source_branch === 'string' ? { headRef: mr.source_branch } : {}),
    ...(typeof mr.target_branch === 'string' ? { baseRef: mr.target_branch } : {}),
    mergeable: mergeable(mr.detailed_merge_status),
    state: STATE[mr.state] ?? 'unknown',
    ...(typeof mr.description === 'string' ? { body: mr.description } : {}),
  };
}

export const requestOf = (r) => ({
  number: r.iid, title: r.title, body: r.description ?? '', branch: r.source_branch, head: r.sha,
  draft: r.draft === true, fork: r.source_project_id !== r.target_project_id,
});

export const issueOf = (i) => ({
  number: i.iid, title: i.title, body: i.description ?? '', url: i.web_url,
  labels: i.labels ?? [], state: i.state === 'opened' ? 'open' : 'closed',
});

// A file's lines added and removed, counted from its diff.
const count = (diff, mark) => String(diff ?? '').split('\n').filter((line) => line.startsWith(mark)).length;
export const fileOf = (f) => ({ path: f.new_path, additions: count(f.diff, '+'), deletions: count(f.diff, '-') });
// Commit subjects, oldest first (GitLab lists them newest first).
export const subjectsOf = (commits) => (Array.isArray(commits) ? commits : []).map((c) => c.title ?? '').reverse();

// The project's successful deployments, newest first (GitLab can't list them by commit). The
// address is the environment's, which shows its newest deployment, so a deployment of this
// commit counts only while it is the newest successful one in its own environment; the newest
// such gives the address. One older than the last hundred deployments is not found, so it has
// no preview.
export function previewOf(deployments, sha, httpsOnly) {
  if (!Array.isArray(deployments)) throw new Error('GitLab did not list the project\'s deployments');
  const done = deployments
    .filter((d) => d?.status === 'success' && Number.isSafeInteger(d.id) && Number.isSafeInteger(d.environment?.id))
    .sort((a, b) => b.id - a.id);
  const current = done.find((d) => d.sha === sha && done.find((e) => e.environment.id === d.environment.id) === d);
  return current ? httpsOnly(current.environment.external_url) : null;
}

// ---- Approving ----

export const SELF_APPROVAL = 'GitLab doesn\'t let the author approve their own merge request here. Ask a colleague to approve it, or choose a project-only key, so that Wheelhouse opens requests and you approve them.';
export const APPROVE_HEAD_MOVED = 'the head of the merge request has moved since it was checked';
export const APPROVE_KEY_REFUSED = 'GitLab did not accept the key, so the merge request was not approved';
export const MERGE_KEY_REFUSED = 'GitLab did not accept the key, so nothing was merged';
export const APPROVE_NOT_ALLOWED = 'GitLab did not approve the merge request';

// The first HTTP status named in a tool's output: glab's "(HTTP 403)" or "403 Forbidden".
export function statusIn(output) {
  const text = String(output ?? '');
  const found = /\(HTTP (\d{3})\)/.exec(text) ?? /\b([45]\d\d)\b/.exec(text);
  return found === null ? null : Number(found[1]);
}

// What a refused approval says, from the HTTP status (when there is one) and the host's words, which are
// read to tell the kinds apart and never repeated.
export function approvalRefusal(status, output) {
  const text = String(output ?? '').replace(/\s+/g, ' ');
  if (status === 409 || /sha does not match|head.*(?:moved|modified)/i.test(text)) return { approved: false, reason: APPROVE_HEAD_MOVED };
  if (status === 403 || /\bauthor\b/i.test(text)) return { approved: false, selfApproval: true, reason: SELF_APPROVAL };
  if (status === 401) return { approved: false, keyRefused: true, reason: APPROVE_KEY_REFUSED };
  return { approved: false, reason: APPROVE_NOT_ALLOWED };
}

// The approvals still wanted, from GitLab's answer for a request's approvals.
export function approvalsLeft(answer) {
  if (!Number.isInteger(answer?.approvals_left) || answer.approvals_left < 0) throw new Error('GitLab did not say how many approvals the merge request still needs');
  return answer.approvals_left;
}
