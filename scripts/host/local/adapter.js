// scripts/host/local/adapter.js
// The host adapter of a project in git alone (spec 6): the same methods as makeAdapter, behind the same checks of their
// arguments (adapterFrom), read from the home, the project's local changes and its signed `check` records. There is no host
// to ask, so nothing here runs `gh` or `glab`, and the core needn't know the difference.
import { adapterFrom } from '../adapter.js';
import { STATUS_CONTEXT } from '../../checks/where.js';
import { readQueue } from '../../checks/standing.js';
import { gitRoute, homeGit, isBranchName } from './home.js';
import { localChanges, signedOf } from './changes.js';

const NO_ISSUES = 'This project is kept on this computer, so it has no issues to read or write';
const NOT_YET = 'The local queue merges this project\'s changes, and it isn\'t here yet';
const THIS_COMPUTER = 'this computer';

// A check's result in the words `mainGreen` and the gate read. A not-counted result reads as success: whether it may pass is
// the permit's to say, and it says so only while the project isn't counting. A check that couldn't run has no answer yet.
const STATE_OF = { passed: 'success', 'not-counted': 'success', failed: 'failure', 'timed-out': 'failure', 'could-not-run': 'pending' };
const PIPELINE_OF = { passed: 'success', 'not-counted': 'success', failed: 'failed', 'timed-out': 'failed', 'could-not-run': 'canceled' };

const asRequest = (c) => ({ number: c.n, title: c.title, body: c.body, branch: c.branch, head: c.head, draft: false, fork: false });

function localCommands({ project, git, write, now }) {
  const home = () => homeGit(project, git);
  const changes = localChanges({ project, git, ...(write ? { write } : {}), now });
  const held = (n) => {
    const change = changes.changeOf(n);
    if (change === null) throw new Error(`There is no change ${n}`);
    return change;
  };

  async function defaultBranch() {
    const ref = await home().must(['symbolic-ref', '-q', 'HEAD'], 'unread');
    return ref.replace(/^refs\/heads\//, '');
  }
  async function branchHead(branch) {
    const got = isBranchName(branch) ? await home().call(['rev-parse', '--verify', '-q', `refs/heads/${branch}^{commit}`]) : { code: 1 };
    if (got.code !== 0) throw new Error(`There is no branch ${branch} in this project's home`);
    return got.stdout.trim();
  }
  // The checks that speak for a commit, oldest first. Only a clean run stands for the main line: a head's pass came from kept
  // build output, and that same commit can come to be the main line.
  async function checksAt(sha) {
    const all = signedOf(project, 'check').filter((e) => e.data.commit === sha);
    const main = await branchHead(await defaultBranch());
    return sha === main ? all.filter((e) => e.data.clean === true) : all;
  }
  // Whether the change's head merges into its base as they stand. Only an open change has an answer, as on a host.
  async function mergeable(change) {
    if (change.state !== 'open') return 'unknown';
    const { code } = await home().call(['merge-tree', '--write-tree', `refs/heads/${change.base}`, change.head]);
    return code === 0 ? 'yes' : code === 1 ? 'no' : 'unknown';
  }

  return {
    defaultBranch,
    branchHead,
    async openPr({ head, base, title, body }) {
      const change = await changes.openChange({ branch: head, base, title, body, head: await branchHead(head) });
      return { number: change.n, url: null };
    },
    async updatePr({ number, title, body }) {
      await changes.updateChange({ n: number, title, body });
      return { number };
    },
    async closePr(number) {
      await changes.closeChange(number);
      return { number };
    },
    async prState(number) {
      const change = held(number);
      return { headSha: change.head, title: change.title, headRef: change.branch, baseRef: change.base, mergeable: await mergeable(change), state: change.state, body: change.body };
    },
    async ciState(sha) {
      const newest = (await checksAt(sha)).at(-1);
      if (newest !== undefined) return { sha, state: STATE_OF[newest.data.result] };
      return { sha, state: readQueue(project).heads.some((h) => h.commit === sha) ? 'pending' : 'none' };
    },
    async checkContexts(sha) {
      const newest = (await checksAt(sha)).at(-1);
      return newest === undefined ? [] : [{ name: STATUS_CONTEXT, state: STATE_OF[newest.data.result], startedAt: newest.at, app: 'wheelhouse' }];
    },
    // No rules on a home: nothing but the permit stands at the door.
    requiredChecks: async () => [],
    // The record is the report.
    setStatus: async () => ({ ok: true }),
    hasCi: async () => true,
    // Always none, so the preview step uses the project's preview command.
    previewUrl: async () => null,
    merge: async () => ({ merged: false, reason: NOT_YET }),
    async mergedRequests({ since }) {
      const merges = signedOf(project, 'change').filter((e) => e.data.state === 'merged' && Date.parse(e.at) >= Date.parse(since));
      const inHome = [];
      for (const { at, data } of merges.reverse()) {
        if (await home().ok(['merge-base', '--is-ancestor', data.mergeCommit, `refs/heads/${data.base}`])) {
          inHome.push({ number: data.n, title: data.title, url: null, mergedAt: at, mergedBy: THIS_COMPUTER, author: null, target: data.base, sha: data.head, mergeCommit: data.mergeCommit });
        }
      }
      return inHome;
    },
    // A commit's checks as pipelines, newest first. The newest is the one that counts for the change named.
    async pipelinesFor(sha, number) {
      const checks = signedOf(project, 'check').map((e, i) => ({ e, id: i + 1 })).filter(({ e }) => e.data.commit === sha).reverse();
      return checks.map(({ e, id }, i) => ({ id, status: PIPELINE_OF[e.data.result], source: 'local', ref: null, sha, head: number !== undefined && i === 0 }));
    },
    // There is no second record to compare with.
    protectionEvents: async () => ({ source: 'none', compared: false, events: [] }),
    openRequests: async () => changes.openChanges().map(asRequest),
    async requestDetails(number) {
      const { base, head } = held(number);
      const range = `refs/heads/${base}...${head}`;
      const numbers = await home().must(['diff', '--numstat', '-z', '--no-renames', range], 'unread');
      const files = numbers.split('\0').filter(Boolean).map((row) => {
        const [additions, deletions, ...name] = row.split('\t');
        return { path: name.join('\t'), additions: Number(additions) || 0, deletions: Number(deletions) || 0 };
      });
      const subjects = await home().must(['log', '--reverse', '--format=%s', `refs/heads/${base}..${head}`], 'unread');
      return { files, commits: subjects === '' ? [] : subjects.split('\n') };
    },
    pullRef: (number) => `refs/pull/${number}/head`,
    // The local queue reads the signed review itself, so there is no comment to keep: the number given back is only a place.
    verdictComment: async ({ number, id }) => ({ id: id ?? number }),
    login: async () => THIS_COMPUTER,
    issue: {
      create: async () => { throw new Error(NO_ISSUES); },
      update: async () => { throw new Error(NO_ISSUES); },
      list: async () => { throw new Error(NO_ISSUES); },
    },
  };
}

// `git` is gitRoute's; `write` keeps a signed event ({ event }), the helper's own way when it is the one asking.
export function makeLocalAdapter({ project, git = gitRoute(), write, now = () => new Date() }) {
  return adapterFrom(localCommands({ project, git, write, now }));
}
