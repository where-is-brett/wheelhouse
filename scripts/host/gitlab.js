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

function mergeable(status) {
  if (status === 'mergeable') return 'yes';
  if (UNKNOWN.has(status)) return 'unknown';
  if (CANNOT.has(status)) return 'no';
  return 'unknown';
}

// 'locked' (a merge in progress) and any state not listed are unknown, never closed.
const STATE = { opened: 'open', merged: 'merged', closed: 'closed' };

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
const stateOf = (pipeline) => (pipeline.source === 'external' ? 'none' : (PIPELINE[pipeline.status] ?? 'pending'));

const MR_ADDRESS = /(https?:\/\/\S+\/-\/merge_requests\/(\d+))/;
const ISSUE_ADDRESS = /(https?:\/\/\S+\/-\/(?:issues|work_items)\/(\d+))/;

export function gitlabCommands({ call, attempt, json, repo, fromAddress, refusal, settle, httpsOnly, hostFault }) {
  const R = ['-R', repo];
  const project = `projects/${encodeURIComponent(repo)}`;
  const ask = async (args, input) => json(args, await call(args, input));

  // A pipeline for merged results runs on a merge commit of the target and the head, so the
  // `sha` filter does not find it. For each open merge request of the head, its own
  // `head_pipeline` is used first, when it ran on the head or on a merged-results commit that
  // has the head as a parent; failing that, the merge request's list of pipelines is searched
  // the same way. Anything not found, or not readable, is 'none'.
  const MERGE_REF = /^refs\/merge-requests\/\d+\/merge$/;
  async function ranOnHead(pipeline, sha) {
    if (typeof pipeline?.sha !== 'string') return false;
    if (pipeline.sha === sha) return true;
    if (typeof pipeline.ref !== 'string' || !MERGE_REF.test(pipeline.ref)) return false;
    const commit = await ask(['api', `${project}/repository/commits/${pipeline.sha}`]);
    return Array.isArray(commit?.parent_ids) && commit.parent_ids.includes(sha);
  }
  // With `strict`, a failed lookup is thrown instead of read as 'none' (the health read tells
  // not being able to look from having looked and found nothing; the gate keeps the 'none').
  async function mergedResults(sha, { strict = false } = {}) {
    try {
      const requests = await ask(['api', `${project}/repository/commits/${sha}/merge_requests`]);
      const open = (Array.isArray(requests) ? requests : []).filter((r) => r?.state === 'opened' && Number.isInteger(r.iid));
      for (const request of open.slice(0, 5)) {
        const full = await ask(['api', `${project}/merge_requests/${request.iid}`]);
        if (await ranOnHead(full?.head_pipeline, sha)) return stateOf(full.head_pipeline);
        const list = await ask(['api', `${project}/merge_requests/${request.iid}/pipelines?per_page=5`]);
        for (const pipeline of (Array.isArray(list) ? list : []).filter((p) => MERGE_REF.test(String(p?.ref)))) {
          if (await ranOnHead(pipeline, sha)) return stateOf(pipeline);
          break; // the newest merged-results pipeline is the one that counts
        }
      }
    } catch (error) {
      if (strict) throw error;
      /* not readable: no pipeline is claimed */
    }
    return 'none';
  }

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

    // Closes the merge request, unmerged; its branch is left (setup's step 10 deletes its own).
    async closePr(number) {
      await call(['mr', 'close', String(number), ...R]);
      return { number };
    },

    async prState(number) {
      const mr = await ask(['mr', 'view', String(number), ...R, '--output', 'json']);
      return { headSha: mr.sha, ...(typeof mr.source_branch === 'string' ? { headRef: mr.source_branch } : {}), ...(typeof mr.target_branch === 'string' ? { baseRef: mr.target_branch } : {}), mergeable: mergeable(mr.detailed_merge_status), state: STATE[mr.state] ?? 'unknown', ...(typeof mr.description === 'string' ? { body: mr.description } : {}) };
    },

    async hasCi(sha, branch) {
      // Any pipeline on the head counts, a skipped one too: it was run, and ran nothing.
      const pipelines = await ask(['api', `${project}/pipelines?sha=${sha}&per_page=1&order_by=id&sort=desc`]);
      if (!Array.isArray(pipelines)) throw new Error('GitLab did not list the commit\'s pipelines');
      if (pipelines.length > 0 || await mergedResults(sha, { strict: true }) !== 'none') return true;
      // Pipelines that run only for merge requests leave none on the branch's head, and a head just
      // pushed has none yet: the configuration file says whether CI is set up.
      const { code, stdout, stderr } = await attempt(['api', `${project}/repository/files/.gitlab-ci.yml?ref=${encodeURIComponent(branch)}`]);
      if (code === 0) return true;
      if (/\b404\b|not found/i.test(`${stderr}\n${stdout}`)) return false;
      throw new Error('GitLab could not say whether the project has a CI configuration');
    },

    async branchHead(branch) {
      return (await ask(['api', `${project}/repository/branches/${encodeURIComponent(branch)}`]))?.commit?.id;
    },

    async ciState(sha) {
      const pipelines = await ask(['api', `${project}/pipelines?sha=${sha}&per_page=1&order_by=id&sort=desc`]);
      const newest = Array.isArray(pipelines) ? pipelines[0] : undefined;
      if (newest) return { sha, state: stateOf(newest) };
      return { sha, state: await mergedResults(sha) };
    },

    // The project's successful deployments, newest first (GitLab can't list them by commit). The
    // address is the environment's, which shows its newest deployment, so a deployment of this
    // commit counts only while it is the newest successful one in its own environment; the newest
    // such gives the address. One older than the last hundred deployments is not found, so it has
    // no preview.
    async previewUrl(sha) {
      const deployments = await ask(['api', `${project}/deployments?status=success&order_by=id&sort=desc&per_page=100`]);
      if (!Array.isArray(deployments)) throw new Error('GitLab did not list the project\'s deployments');
      const done = deployments
        .filter((d) => d?.status === 'success' && Number.isSafeInteger(d.id) && Number.isSafeInteger(d.environment?.id))
        .sort((a, b) => b.id - a.id);
      const current = done.find((d) => d.sha === sha && done.find((e) => e.environment.id === d.environment.id) === d);
      return current ? httpsOnly(current.environment.external_url) : null;
    },

    // --auto-merge=false: otherwise, with a pipeline running, glab queues the
    // merge to happen later, after the gate's checks (check 5). A refusal is an
    // answer, not an error.
    async merge({ number, sha }) {
      const { code, stdout, stderr } = await attempt(['mr', 'merge', String(number), ...R, '--sha', sha, '--auto-merge=false', '--yes']);
      if (code !== 0) {
        // A merge that could not reach the host, or did not trust its certificate, is not a refusal:
        // it says so, and its own flag tells the caller why.
        // glab's standard error is its own words. A command that waited and gave up may have
        // reached the host before it did, so that is said as not confirmed, as settle does.
        const fault = hostFault(stderr);
        if (fault !== null) return { merged: false, [fault.kind]: true, reason: `${fault.timedOut ? 'The merge could not be confirmed.' : 'Not merged.'} ${fault.line}` };
        return { merged: false, reason: refusal(`${stderr}\n${stdout}`, 'GitLab did not merge the merge request') };
      }
      return settle({
        state: async () => (await ask(['mr', 'view', String(number), ...R, '--output', 'json'])).state,
        merged: 'merged',
        open: 'opened',
        takeBack: () => call(['api', '--method', 'POST', `${project}/merge_requests/${number}/cancel_merge_when_pipeline_succeeds`]),
      });
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
