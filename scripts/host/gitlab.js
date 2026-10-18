// scripts/host/gitlab.js
// The `glab` command lines behind the adapter, and how GitLab's answers map to
// the adapter's values. Values the caller supplies are passed as `--flag=value`,
// so one that starts with "-" cannot be read as a flag; descriptions go on
// standard input. Commands that would otherwise ask for confirmation get --yes.

// Mergeability comes from `detailed_merge_status`. The recorded merge request
// (tests/fixtures/host/gitlab/mr-view-closed.json) has this field and no
// `merge_status`, which GitLab has deprecated.
//
//   mergeable                                   -> yes
//   unchecked, checking, preparing,
//   approvals_syncing                           -> unknown (GitLab is still working it out)
//   any other documented value, such as
//   conflict, need_rebase, not_open, draft_status,
//   discussions_not_resolved, ci_must_pass,
//   ci_still_running, not_approved, blocked_status,
//   requested_changes, merge_time, ...          -> no (it cannot merge now)
//   a value not listed here                     -> unknown, never yes
const UNKNOWN = new Set(['unchecked', 'checking', 'preparing', 'approvals_syncing']);
const CANNOT = new Set([
  'blocked_status', 'broken_status', 'ci_must_pass', 'ci_still_running', 'commits_status', 'conflict',
  'discussions_not_resolved', 'draft_status', 'jira_association_missing', 'locked_lfs_files', 'locked_paths',
  'merge_request_blocked', 'merge_time', 'need_rebase', 'not_approved', 'not_open', 'requested_changes',
  'security_policy_violations', 'security_policy_pipeline_check', 'status_checks_must_pass', 'title_regex',
]);

function mergeable(status) {
  if (status === 'mergeable') return 'yes';
  if (UNKNOWN.has(status)) return 'unknown';
  if (CANNOT.has(status)) return 'no';
  return 'unknown';
}

const STATE = { opened: 'open', merged: 'merged', closed: 'closed', locked: 'closed' };

// The newest pipeline for the commit. A skipped pipeline ran nothing, so it
// counts as none; anything not yet finished is pending.
const PIPELINE = {
  success: 'success',
  failed: 'failure', canceled: 'failure', canceling: 'failure',
  created: 'pending', waiting_for_resource: 'pending', preparing: 'pending', waiting_for_callback: 'pending',
  pending: 'pending', running: 'pending', scheduled: 'pending', manual: 'pending',
  skipped: 'none',
};

const MR_ADDRESS = /(https?:\/\/\S+\/-\/merge_requests\/(\d+))/;
const ISSUE_ADDRESS = /(https?:\/\/\S+\/-\/(?:issues|work_items)\/(\d+))/;

export function gitlabCommands({ call, attempt, json, repo, fromAddress, reason }) {
  const R = ['-R', repo];
  const project = `projects/${encodeURIComponent(repo)}`;
  const ask = async (args, input) => json(args, await call(args, input));

  return {
    async defaultBranch() {
      const answer = await ask(['api', project]);
      if (typeof answer?.default_branch !== 'string') throw new Error('GitLab did not say which branch is the default');
      return answer.default_branch;
    },

    async openPr({ head, base, title, body }) {
      const args = ['mr', 'create', ...R, `--source-branch=${head}`, `--target-branch=${base}`, `--title=${title}`, '--description-file', '-', '--yes'];
      return fromAddress(await call(args, body), MR_ADDRESS);
    },

    async updatePr({ number, title, body }) {
      const args = ['mr', 'update', String(number), ...R];
      if (title !== undefined) args.push(`--title=${title}`);
      if (body !== undefined) args.push('--description-file', '-');
      args.push('--yes');
      await call(args, body);
      return { number };
    },

    async prState(number) {
      const mr = await ask(['mr', 'view', String(number), ...R, '--output', 'json']);
      return { headSha: mr.sha, mergeable: mergeable(mr.detailed_merge_status), state: STATE[mr.state] ?? 'closed' };
    },

    async ciState(sha) {
      const pipelines = await ask(['api', `${project}/pipelines?sha=${sha}&per_page=1&order_by=id&sort=desc`]);
      const newest = Array.isArray(pipelines) ? pipelines[0] : undefined;
      return { sha, state: newest ? (PIPELINE[newest.status] ?? 'pending') : 'none' };
    },

    // --auto-merge=false: otherwise, with a pipeline running, glab queues the
    // merge to happen later, after the gate's checks (check 5). A refusal is an
    // answer, not an error.
    async merge({ number, sha }) {
      const { code, stdout, stderr } = await attempt(['mr', 'merge', String(number), ...R, '--sha', sha, '--auto-merge=false', '--yes']);
      if (code === 0) return { merged: true };
      return { merged: false, reason: reason(stderr || stdout) || 'GitLab did not merge the merge request' };
    },

    issue: {
      async create({ title, body, labels }) {
        const args = ['issue', 'create', ...R, `--title=${title}`, '--description-file', '-', ...labels.map((l) => `--label=${l}`), '--yes'];
        return fromAddress(await call(args, body), ISSUE_ADDRESS);
      },
      async update({ number, body }) {
        await call(['issue', 'update', String(number), ...R, '--description-file', '-'], body);
        return { number };
      },
      // Open issues carrying the label, up to 100.
      async list({ label }) {
        const issues = await ask(['issue', 'list', ...R, `--label=${label}`, '--per-page', '100', '--output', 'json']);
        return issues.map((i) => ({
          number: i.iid, title: i.title, body: i.description ?? '', url: i.web_url,
          labels: i.labels ?? [], state: i.state === 'opened' ? 'open' : 'closed',
        }));
      },
    },
  };
}
