// scripts/host/github.js
// The `gh` command lines behind the adapter, and how GitHub's answers map to the
// adapter's values. Values the caller supplies are passed as `--flag=value`, so
// one that starts with "-" cannot be read as a flag; bodies go on standard input.

// GitHub's `mergeable`: MERGEABLE is yes, CONFLICTING is no, and UNKNOWN (GitHub
// is still working it out, or the pull request is no longer open) or anything
// new is unknown, never yes.
const MERGEABLE = { MERGEABLE: 'yes', CONFLICTING: 'no' };

const STATE = { OPEN: 'open', MERGED: 'merged', CLOSED: 'closed' };

// The commit's status check rollup covers both check runs and commit statuses.
// No rollup (no checks at all) or a commit GitHub does not have is 'none'.
const ROLLUP = { SUCCESS: 'success', PENDING: 'pending', EXPECTED: 'pending', FAILURE: 'failure', ERROR: 'failure' };

const CI_QUERY = 'query($owner:String!,$name:String!,$sha:GitObjectID!){repository(owner:$owner,name:$name){object(oid:$sha){... on Commit{oid statusCheckRollup{state}}}}}';

const PR_ADDRESS = /(https:\/\/\S+\/pull\/(\d+))/;
const ISSUE_ADDRESS = /(https:\/\/\S+\/issues\/(\d+))/;

export function githubCommands({ call, attempt, json, repo, fromAddress, refusal, settle }) {
  const [owner, name] = repo.split('/');
  const R = ['--repo', repo];
  const ask = async (args, input) => json(args, await call(args, input));

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

    async prState(number) {
      const pr = await ask(['pr', 'view', String(number), ...R, '--json', 'number,url,headRefOid,headRefName,baseRefName,mergeable,state']);
      return { headSha: pr.headRefOid, ...(typeof pr.headRefName === 'string' ? { headRef: pr.headRefName } : {}), ...(typeof pr.baseRefName === 'string' ? { baseRef: pr.baseRefName } : {}), mergeable: MERGEABLE[pr.mergeable] ?? 'unknown', state: STATE[pr.state] ?? 'unknown' };
    },

    async ciState(sha) {
      const answer = await ask(['api', 'graphql', '-f', `query=${CI_QUERY}`, '-f', `owner=${owner}`, '-f', `name=${name}`, '-f', `sha=${sha}`]);
      // A GraphQL answer can carry errors with a 200; that is not the absence of checks.
      if ((Array.isArray(answer?.errors) && answer.errors.length > 0) || answer?.data === null || typeof answer?.data !== 'object') throw new Error('GitHub could not read the commit\'s checks');
      const rollup = answer?.data?.repository?.object?.statusCheckRollup;
      return { sha, state: rollup ? (ROLLUP[rollup.state] ?? 'pending') : 'none' };
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
