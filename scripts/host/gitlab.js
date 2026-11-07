// scripts/host/gitlab.js
// The `glab` command lines behind the adapter, and how GitLab's answers map to
// the adapter's values. Values the caller supplies are passed as `--flag=value`,
// so one that starts with "-" cannot be read as a flag; descriptions go on
// standard input. Commands that would otherwise ask for confirmation get --yes.
import { gitlabHistory } from './gitlab-history.js';
import {
  stateOf, mergedResults as mergedResultsOf, prStateOf, requestOf, branchRequestOf, issueOf, fileOf, subjectsOf, previewOf,
  approvalRefusal, approvalsLeft, statusIn, MERGE_KEY_REFUSED, publicOf,
} from './gitlab-shared.js';

const MR_ADDRESS = /(https?:\/\/\S+\/-\/merge_requests\/(\d+))/;
const ISSUE_ADDRESS = /(https?:\/\/\S+\/-\/(?:issues|work_items)\/(\d+))/;

export function gitlabCommands({ call, attempt, json, repo, fromAddress, refusal, settle, httpsOnly, hostFault, read }) {
  const R = ['-R', repo];
  const project = `projects/${encodeURIComponent(repo)}`;
  const ask = async (args, input) => json(args, await call(args, input));

  const mergedResults = (sha, { strict = false } = {}) => mergedResultsOf({ get: (path) => ask(['api', `${project}${path.slice(project.length)}`]), project, sha, strict });

  return {
    // The read-only calls of the audit report (gitlab-history.js).
    ...gitlabHistory({ ask, read, project }),

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
      return prStateOf(mr);
    },

    // GitLab stays on the old engine, whose checks run on the host (spec, non-goals).
    async setStatus() {
      return { refused: 'GitLab projects run their checks on the host' };
    },
    async checkContexts() {
      throw new Error('GitLab projects run their checks on the host');
    },
    async requiredChecks() {
      return [];
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
      return previewOf(deployments, sha, httpsOnly);
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
        if (statusIn(stderr) === 401) return { merged: false, keyRefused: true, reason: MERGE_KEY_REFUSED };
        return { merged: false, reason: refusal(`${stderr}\n${stdout}`, 'GitLab did not merge the merge request') };
      }
      return settle({
        state: async () => (await ask(['mr', 'view', String(number), ...R, '--output', 'json'])).state,
        merged: 'merged',
        open: 'opened',
        takeBack: () => call(['api', '--method', 'POST', `${project}/merge_requests/${number}/cancel_merge_when_pipeline_succeeds`]),
      });
    },

    // Approves the merge request at the head the card names. A refusal is an answer, not an error.
    async approve({ number, sha }) {
      const { code, stdout, stderr } = await attempt(['mr', 'approve', String(number), ...R, '--sha', sha]);
      if (code === 0) return { approved: true };
      const fault = hostFault(stderr);
      if (fault !== null) return { approved: false, [fault.kind]: true, reason: `${fault.timedOut ? 'The approval could not be confirmed.' : 'Not approved.'} ${fault.line}` };
      const said = `${stderr}\n${stdout}`;
      return approvalRefusal(statusIn(said), said);
    },

    // How many more approvals the host wants before the merge request can merge.
    async approvalsNeeded(number) {
      return approvalsLeft(await ask(['api', `${project}/merge_requests/${number}/approvals`]));
    },

    // Open merge requests, up to 100, as the adapter's request values. A request from another
    // project's copy has a source project that is not this one.
    async openRequests() {
      const requests = await ask(['mr', 'list', ...R, '--per-page', '100', '--output', 'json']);
      if (!Array.isArray(requests)) throw new Error('GitLab did not list the open merge requests');
      return requests.map(requestOf);
    },

    // The merge requests with this source branch, in any state.
    async requestsOn(branch) {
      const requests = await ask(['api', `${project}/merge_requests?state=all&source_branch=${encodeURIComponent(branch)}&per_page=20`]);
      if (!Array.isArray(requests)) throw new Error('GitLab did not list the merge requests of the branch');
      return requests.map(branchRequestOf);
    },

    // The files a merge request changes, with lines counted from each diff, and its commits'
    // subjects, oldest first (GitLab lists them newest first).
    async requestDetails(number) {
      const changes = await ask(['api', `${project}/merge_requests/${number}/changes`]);
      const commits = await ask(['api', `${project}/merge_requests/${number}/commits?per_page=50`]);
      return {
        files: (changes?.changes ?? []).map(fileOf),
        commits: subjectsOf(commits),
      };
    },

    // The name under which the host keeps a merge request's head, whoever's copy it came from.
    pullRef: (number) => `refs/merge-requests/${number}/head`,

    // Archon's merge queue reads its verdict from a GitHub comment; there is none to post on GitLab.
    async verdictComment() {
      throw new Error('The merge queue\'s verdict comment is for GitHub only');
    },

    // Whether the project is public: its `visibility` (public, internal or private), never a guess.
    async isPublic() {
      return publicOf(await ask(['api', project]));
    },

    // The merge queue's policy names a GitHub login; there is none to name on GitLab.
    async login() {
      throw new Error('The merge queue\'s policy is for GitHub only');
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
        return issues.map(issueOf);
      },
    },
  };
}
