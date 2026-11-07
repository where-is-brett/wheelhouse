// scripts/host/github.js
// The `gh` command lines behind the adapter, and how GitHub's answers map to the
// adapter's values. Values the caller supplies are passed as `--flag=value`, so
// one that starts with "-" cannot be read as a flag; bodies go on standard input.
import { STATUS_CONTEXT } from '../checks/where.js';

// GitHub's `mergeable`: MERGEABLE is yes, CONFLICTING is no, and UNKNOWN (GitHub
// is still working it out, or the pull request is no longer open) or anything
// new is unknown, never yes.
export const MERGEABLE = { MERGEABLE: 'yes', CONFLICTING: 'no' };

export const STATE = { OPEN: 'open', MERGED: 'merged', CLOSED: 'closed' };

// The commit's status check rollup covers both check runs and commit statuses.
// No rollup (no checks at all) or a commit GitHub does not have is 'none'.
export const ROLLUP = { SUCCESS: 'success', PENDING: 'pending', EXPECTED: 'pending', FAILURE: 'failure', ERROR: 'failure' };

export const CI_QUERY = 'query($owner:String!,$name:String!,$sha:GitObjectID!){repository(owner:$owner,name:$name){object(oid:$sha){... on Commit{oid statusCheckRollup{state}}}}}';

export const CONTEXTS_QUERY = 'query($owner:String!,$name:String!,$sha:GitObjectID!){repository(owner:$owner,name:$name){object(oid:$sha){... on Commit{statusCheckRollup{contexts(first:100){nodes{__typename ... on CheckRun{name status conclusion startedAt completedAt checkSuite{app{slug}}} ... on StatusContext{context state createdAt creator{login}}}}}}}}}';
// A check run's words, and a status's. A run that started and ended in the same moment, or that couldn't start, ran no job.
const RUNNING = { QUEUED: 'queued', WAITING: 'queued', PENDING: 'queued', REQUESTED: 'queued', IN_PROGRESS: 'running' };
const PASSED = ['SUCCESS', 'NEUTRAL', 'SKIPPED'];
const STATUS_WORD = { SUCCESS: 'success', PENDING: 'pending', EXPECTED: 'pending', FAILURE: 'failure', ERROR: 'failure' };

export function contextOf(node) {
  if (node?.__typename === 'StatusContext') {
    const state = STATUS_WORD[node.state] ?? 'pending';
    // A status that has an answer came from something that ran, whichever answer it is.
    return { name: node.context, state, startedAt: state === 'pending' ? null : node.createdAt ?? null, app: node.creator?.login ?? null };
  }
  const app = node?.checkSuite?.app?.slug ?? null;
  if (node?.status !== 'COMPLETED') {
    const state = RUNNING[node?.status] ?? 'queued';
    return { name: node?.name, state, startedAt: state === 'running' ? node?.startedAt ?? null : null, app };
  }
  const ran = typeof node.startedAt === 'string' && node.startedAt !== node.completedAt && node.conclusion !== 'STARTUP_FAILURE';
  return { name: node.name, state: PASSED.includes(node.conclusion) ? 'success' : 'failure', startedAt: ran ? node.startedAt : null, app };
}

// How many of a commit's deployments, newest first, are looked at for a successful one.
export const MOST_DEPLOYMENTS = 3;
// How many pages of a pull request's reviews are read.
export const MOST_REVIEW_PAGES = 10;

// One review as GitHub gives it, kept to what Wheelhouse reads.
export const reviewOf = (r) => ({ login: r?.user?.login ?? null, type: r?.user?.type ?? null, state: r?.state ?? null, commit: r?.commit_id ?? null, at: r?.submitted_at ?? null });

// ---- What both GitHub backends read the same way (this file over `gh`, github-rest.js over the web API) ----

// A GraphQL answer can carry errors with a 200; that is not the absence of checks.
function checksAnswer(answer) {
  if ((Array.isArray(answer?.errors) && answer.errors.length > 0) || answer?.data === null || typeof answer?.data !== 'object') throw new Error('GitHub could not read the commit\'s checks');
  return answer.data;
}

// The commit's rollup state from the CI_QUERY answer. No rollup, or a commit GitHub does not have, is 'none'.
export function rollupOf(answer, sha) {
  const rollup = checksAnswer(answer)?.repository?.object?.statusCheckRollup;
  return { sha, state: rollup ? (ROLLUP[rollup.state] ?? 'pending') : 'none' };
}

// Everything that reports on the commit, from the CONTEXTS_QUERY answer.
export function contextsOf(answer) {
  const nodes = checksAnswer(answer)?.repository?.object?.statusCheckRollup?.contexts?.nodes;
  return (Array.isArray(nodes) ? nodes : []).map(contextOf).filter((c) => typeof c.name === 'string' && c.name !== '');
}

// A plan that has no rules at all says so in these words.
export const NO_RULES_PLAN = /upgrade to github pro/i;

// The names of the checks a branch's rules require, from the rules answer, or null when it is not a list.
export function requiredChecksOf(rules) {
  return Array.isArray(rules) ? rules.filter((r) => r?.type === 'required_status_checks').flatMap((r) => r.parameters?.required_status_checks ?? []).map((c) => c?.context) : null;
}

// The approvals still wanted on a pull request: what its branch's rules require, less the people whose newest
// review (an approval, a change request or a dismissal; a comment changes nothing) approves the head it has now.
export function approvalsLeftOf({ rules, reviews, head }) {
  if (!Array.isArray(rules) || !Array.isArray(reviews)) throw new Error('GitHub did not say how many approvals the pull request still needs');
  const wanted = Math.max(0, ...rules.filter((r) => r?.type === 'pull_request').map((r) => Number(r.parameters?.required_approving_review_count) || 0));
  const newest = new Map();
  for (const r of reviews) {
    if (['APPROVED', 'CHANGES_REQUESTED', 'DISMISSED'].includes(r?.state) && typeof r.login === 'string') newest.set(r.login, r);
  }
  const given = [...newest.values()].filter((r) => r.state === 'APPROVED' && r.commit === head).length;
  return Math.max(0, wanted - given);
}

// ---- Approving ----

export const SELF_APPROVAL = 'GitHub doesn\'t let the author approve their own pull request here. Ask a colleague to approve it, or choose a project-only key, so that Wheelhouse opens requests and you approve them.';
export const APPROVE_HEAD_MOVED = 'the head of the pull request has moved since it was checked';
export const APPROVE_KEY_REFUSED = 'GitHub did not accept the key, so the pull request was not approved';
export const APPROVE_NOT_ALLOWED = 'GitHub did not approve the pull request';

// What a refused approval says, from the HTTP status (when there is one) and the host's words, which are
// read to tell the kinds apart and never repeated.
export function approvalRefusal(status, output) {
  const text = String(output ?? '').replace(/\s+/g, ' ');
  if (/own pull request/i.test(text)) return { approved: false, selfApproval: true, reason: SELF_APPROVAL };
  if (status === 401) return { approved: false, keyRefused: true, reason: APPROVE_KEY_REFUSED };
  if (status === 409 || /head.*(?:moved|modified)/i.test(text)) return { approved: false, reason: APPROVE_HEAD_MOVED };
  return { approved: false, reason: APPROVE_NOT_ALLOWED };
}

export const PR_ADDRESS = /(https:\/\/\S+\/pull\/(\d+))/;
export const ISSUE_ADDRESS = /(https:\/\/\S+\/issues\/(\d+))/;

// Whether a repository's answer says it is public: `visibility` is public, private or internal. One that says neither is an error.
export function publicOf(answer) {
  const visibility = typeof answer?.visibility === 'string' ? answer.visibility.toLowerCase() : null;
  if (visibility === null) throw new Error('GitHub did not say whether the repository is public');
  return visibility === 'public';
}

export function githubCommands({ call, attempt, json, repo, fromAddress, refusal, settle, httpsOnly }) {
  const [owner, name] = repo.split('/');
  const R = ['--repo', repo];
  const ask = async (args, input) => json(args, await call(args, input));

  async function ciRead(sha) {
    const answer = await ask(['api', 'graphql', '-f', `query=${CI_QUERY}`, '-f', `owner=${owner}`, '-f', `name=${name}`, '-f', `sha=${sha}`]);
    return rollupOf(answer, sha);
  }

  // The rules on a branch, as a list; [] on a plan with no rules and null when they can't be read.
  async function rulesOf(branch) {
    const { code, stdout, stderr } = await attempt(['api', `repos/${repo}/rules/branches/${encodeURIComponent(branch)}?per_page=100`]);
    if (code !== 0) return NO_RULES_PLAN.test(`${stderr}\n${stdout}`) ? [] : null;
    try {
      const rules = JSON.parse(stdout);
      return Array.isArray(rules) ? rules : null;
    } catch {
      return null;
    }
  }

  return {
    async defaultBranch() {
      const answer = await ask(['repo', 'view', repo, '--json', 'defaultBranchRef']);
      const branch = answer?.defaultBranchRef?.name;
      if (typeof branch !== 'string') throw new Error('GitHub did not say which branch is the default');
      return branch;
    },

    async openPr({ head, base, title, body }) {
      const args = ['pr', 'create', ...R, `--head=${head}`, `--base=${base}`, `--title=${title}`, '--body-file', '-'];
      return fromAddress(await call(args, body), PR_ADDRESS);
    },

    async updatePr({ number, title, body }) {
      const args = ['pr', 'edit', String(number), ...R];
      if (title !== undefined) args.push(`--title=${title}`);
      if (body !== undefined) args.push('--body-file', '-');
      await call(args, body);
      return { number };
    },

    // Closes the pull request, unmerged; its branch is left (setup's step 10 deletes its own).
    async closePr(number) {
      await call(['pr', 'close', String(number), ...R]);
      return { number };
    },

    async prState(number) {
      const pr = await ask(['pr', 'view', String(number), ...R, '--json', 'number,url,headRefOid,headRefName,baseRefName,mergeable,state,body,title']);
      return { headSha: pr.headRefOid, ...(typeof pr.title === 'string' ? { title: pr.title } : {}), ...(typeof pr.headRefName === 'string' ? { headRef: pr.headRefName } : {}), ...(typeof pr.baseRefName === 'string' ? { baseRef: pr.baseRefName } : {}), mergeable: MERGEABLE[pr.mergeable] ?? 'unknown', state: STATE[pr.state] ?? 'unknown', ...(typeof pr.body === 'string' ? { body: pr.body } : {}) };
    },

    async branchHead(branch) {
      return (await ask(['api', `repos/${repo}/branches/${encodeURIComponent(branch)}`]))?.commit?.sha;
    },

    async ciState(sha) {
      return ciRead(sha);
    },

    // Everything that reports on the commit, by name: { name, state, startedAt, app }, with `startedAt` null unless a job
    // really ran. Read apart from ciState, whose rollup can't tell Wheelhouse's own status from anything else.
    async checkContexts(sha) {
      const answer = await ask(['api', 'graphql', '-f', `query=${CONTEXTS_QUERY}`, '-f', `owner=${owner}`, '-f', `name=${name}`, '-f', `sha=${sha}`]);
      return contextsOf(answer);
    },

    // The checks the rules on a branch require, by name, from what a connection with no administration may read. Empty on a
    // plan with no rules, and null when they can't be read.
    async requiredChecks(branch) {
      return requiredChecksOf(await rulesOf(branch));
    },

    // Reports a check on the commit (check 84). Each post adds an entry and the rollup takes the newest, so one repeated
    // does no harm. A refusal is an answer: a connection set up before Wheelhouse asked for this permission reads 'permission'.
    async setStatus({ sha, state, description, context = STATUS_CONTEXT }) {
      const got = await attempt(['api', '--method', 'POST', `repos/${repo}/statuses/${sha}`, '-f', `state=${state}`, '-f', `context=${context}`, '-f', `description=${description}`]);
      if (got.code === 0) return { ok: true };
      const said = `${got.stderr}\n${got.stdout}`;
      if (/rate limit/i.test(said)) return { refused: 'GitHub is limiting how fast it takes reports' };
      return { refused: /\b403\b|not accessible/i.test(said) ? 'permission' : 'GitHub did not take the report' };
    },

    // The commit's deployments, newest first: the first whose newest status, of any state, is
    // `success` gives the address. One still building, failed, or made `inactive` because another
    // deployment to the same environment has succeeded since is passed over for the one before.
    async previewUrl(sha) {
      const deployments = await ask(['api', `repos/${repo}/deployments?sha=${sha}`]);
      if (!Array.isArray(deployments)) throw new Error('GitHub did not list the commit\'s deployments');
      const newest = deployments.filter((d) => Number.isSafeInteger(d?.id) && d.id > 0).sort((a, b) => b.id - a.id);
      for (const deployment of newest.slice(0, MOST_DEPLOYMENTS)) {
        const statuses = await ask(['api', `repos/${repo}/deployments/${deployment.id}/statuses`]);
        if (!Array.isArray(statuses)) throw new Error('GitHub did not list the deployment\'s statuses');
        const newestStatus = statuses.filter((s) => Number.isSafeInteger(s?.id)).sort((a, b) => b.id - a.id)[0];
        if (newestStatus?.state === 'success') return httpsOnly(newestStatus.environment_url);
      }
      return null;
    },

    async hasCi(sha, branch) {
      if ((await ciRead(sha)).state !== 'none') return true;
      // Workflows that run only on pull requests leave no check on the branch's head, and a
      // head just pushed has none yet: the workflows folder says whether CI is set up.
      const { code, stdout, stderr } = await attempt(['api', `repos/${repo}/contents/.github/workflows?ref=${encodeURIComponent(branch)}`]);
      if (code === 0) {
        const files = json(['api', 'contents'], stdout);
        return Array.isArray(files) && files.length > 0;
      }
      if (/\b404\b|not found/i.test(`${stderr}\n${stdout}`)) return false;
      throw new Error('GitHub could not say whether the project has CI workflows');
    },

    // A refusal (the head has moved, the branch is protected, a check failed)
    // is an answer, not an error; it is told by kind and never quotes GitHub.
    async merge({ number, sha }) {
      const { code, stdout, stderr } = await attempt(['pr', 'merge', String(number), ...R, '--merge', '--match-head-commit', sha]);
      if (code !== 0) return { merged: false, reason: refusal(`${stderr}\n${stdout}`, 'GitHub did not merge the pull request') };
      // The success line is not read: the pull request is, and it says merged, queued or unknown.
      return settle({
        state: async () => (await ask(['pr', 'view', String(number), ...R, '--json', 'state'])).state,
        merged: 'MERGED',
        open: 'OPEN',
        takeBack: () => call(['pr', 'merge', String(number), ...R, '--disable-auto']),
      });
    },

    // Approves at the head the card names. GitHub accepts a review of any commit in the pull request, so the head is
    // read first and a moved one is refused here; the review then names that commit. A refusal is an answer, not an error.
    async approve({ number, sha }) {
      const pr = await ask(['pr', 'view', String(number), ...R, '--json', 'headRefOid']);
      if (pr?.headRefOid !== sha) return { approved: false, reason: APPROVE_HEAD_MOVED };
      const got = await attempt(['api', '--method', 'POST', `repos/${repo}/pulls/${number}/reviews`, '--input', '-'], JSON.stringify({ event: 'APPROVE', commit_id: sha }));
      if (got.code === 0) return { approved: true };
      const said = `${got.stderr}\n${got.stdout}`;
      const named = /\(HTTP (\d{3})\)/.exec(said);
      return approvalRefusal(named ? Number(named[1]) : null, said);
    },

    // How many more approvals the rules want on the pull request before it can merge (0 when none).
    async approvalsNeeded(number) {
      const pr = await ask(['pr', 'view', String(number), ...R, '--json', 'baseRefName,headRefOid']);
      const rules = await rulesOf(pr.baseRefName);
      if (rules === null) throw new Error('GitHub did not say how many approvals the pull request still needs');
      return approvalsLeftOf({ rules, reviews: await this.reviews(number), head: pr.headRefOid });
    },

    // Open pull requests, up to 100, as the adapter's request values.
    async openRequests() {
      const requests = await ask(['pr', 'list', ...R, '--state', 'open', '--json', 'number,title,body,headRefName,headRefOid,isDraft,isCrossRepository', '--limit', '100']);
      if (!Array.isArray(requests)) throw new Error('GitHub did not list the open pull requests');
      return requests.map((r) => ({
        number: r.number, title: r.title, body: r.body ?? '', branch: r.headRefName, head: r.headRefOid,
        draft: r.isDraft === true, fork: r.isCrossRepository === true,
      }));
    },

    // The pull requests with this head branch, in any state, as the adapter's request values with a state.
    async requestsOn(branch) {
      const requests = await ask(['pr', 'list', ...R, '--state', 'all', '--head', branch, '--json', 'number,headRefName,headRefOid,isCrossRepository,state', '--limit', '20']);
      if (!Array.isArray(requests)) throw new Error('GitHub did not list the pull requests of the branch');
      return requests.map((r) => ({ number: r.number, branch: r.headRefName, head: r.headRefOid, fork: r.isCrossRepository === true, state: STATE[r.state] ?? 'unknown' }));
    },

    // The files a pull request changes and its commits' subjects, oldest first.
    async requestDetails(number) {
      const pr = await ask(['pr', 'view', String(number), ...R, '--json', 'files,commits']);
      return {
        files: (pr?.files ?? []).map((f) => ({ path: f.path, additions: f.additions ?? 0, deletions: f.deletions ?? 0 })),
        commits: (pr?.commits ?? []).map((c) => c.messageHeadline ?? ''),
      };
    },

    // The name under which the host keeps a pull request's head, whoever's copy it came from.
    pullRef: (number) => `refs/pull/${number}/head`,

    // The merge queue's verdict comment on a pull request (check 76; ruling 6 of part 3b): posted once, its id kept,
    // and edited in place for a new head. A kept comment that is gone is posted again. Gives { id }.
    async verdictComment({ number, id, body }) {
      const input = JSON.stringify({ body });
      if (Number.isInteger(id) && id > 0) {
        const edited = await attempt(['api', '--method', 'PATCH', `repos/${owner}/${name}/issues/comments/${id}`, '--input', '-'], input);
        if (edited.code === 0) return { id };
        if (!/\b404\b|Not Found/.test(String(edited.stderr))) throw new Error('GitHub did not edit the verdict comment');
      }
      const posted = await ask(['api', '--method', 'POST', `repos/${owner}/${name}/issues/${number}/comments`, '--input', '-'], input);
      if (!Number.isInteger(posted?.id)) throw new Error('GitHub did not say which comment it posted');
      return { id: posted.id };
    },

    // A pull request's reviews, oldest first, in pages of a hundred: { login, type, state, commit, at }. The person's approval
    // is read from these (host-approval.js).
    async reviews(number) {
      const all = [];
      for (let page = 1; page <= MOST_REVIEW_PAGES; page += 1) {
        const got = await ask(['api', `repos/${repo}/pulls/${number}/reviews?per_page=100&page=${page}`]);
        if (!Array.isArray(got)) throw new Error('GitHub did not list the pull request\'s reviews');
        all.push(...got);
        if (got.length < 100) break;
      }
      return all.map(reviewOf);
    },

    // Whether the repository is public: its `visibility`, never a guess. Private and internal are not public.
    async isPublic() {
      return publicOf(await ask(['api', `repos/${repo}`]));
    },

    // The login of the account the connection posts as: the one the merge queue's policy names (part 3f).
    async login() {
      const login = (await ask(['api', 'user']))?.login;
      if (typeof login !== 'string' || login === '') throw new Error('GitHub did not say which account this is');
      return login;
    },

    issue: {
      async create({ title, body, labels }) {
        const args = ['issue', 'create', ...R, `--title=${title}`, '--body-file', '-', ...labels.map((l) => `--label=${l}`)];
        return fromAddress(await call(args, body), ISSUE_ADDRESS);
      },
      async update({ number, body }) {
        await call(['issue', 'edit', String(number), ...R, '--body-file', '-'], body);
        return { number };
      },
      // Open issues carrying the label, up to 100.
      async list({ label }) {
        const issues = await ask(['issue', 'list', ...R, `--label=${label}`, '--state', 'open', '--limit', '100', '--json', 'number,title,body,url,labels,state']);
        return issues.map((i) => ({
          number: i.number, title: i.title, body: i.body, url: i.url,
          labels: (i.labels ?? []).map((l) => l.name), state: i.state === 'OPEN' ? 'open' : 'closed',
        }));
      },
    },
  };
}
