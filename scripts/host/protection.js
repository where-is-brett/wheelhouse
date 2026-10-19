// scripts/host/protection.js
// Reads and switches on GitLab's protection of a branch (the GitLab half of
// the host's server-side protection): push access to no one, merge access to
// Developers (or Maintainers if asked), no force-push, and "pipelines must succeed" on the project.
// Errors name the step and the HTTP status, never GitLab's message text.
import { projectPath } from './gitlab-key.js';
import { scrub } from './adapter.js';
import { toolPath } from '../lib/host-tools.js';

const NO_ONE = 0;
const DEVELOPERS = 30;
const MAINTAINERS = 40;
const LEVEL_NAMES = new Map([
  [0, 'No one'],
  [30, 'Developers + Maintainers'],
  [40, 'Maintainers'],
  [60, 'Administrators'],
]);

const branchPath = (projectId, branch) => `${projectPath(projectId)}/protected_branches/${encodeURIComponent(branch)}`;

function levels(list) {
  return (Array.isArray(list) ? list : []).map(
    (one) => one.access_level_description ?? LEVEL_NAMES.get(one.access_level) ?? `level ${one.access_level}`,
  );
}

// What the GitLab client throws when the network fails, or what Node gives: said as "could not be
// reached" and never quoted. Any other error is said as it is, with anything key-like hidden.
const NETWORK_CODE = /^(?:ECONN|ENOTFOUND|ETIMEDOUT|EAI_AGAIN|EPIPE|ENETUNREACH|EHOSTUNREACH|UND_ERR)/;
const isNetworkError = (error) => error?.message === 'Could not reach GitLab'
  || NETWORK_CODE.test(String(error?.code ?? '')) || NETWORK_CODE.test(String(error?.cause?.code ?? ''))
  || error?.name === 'AbortError' || error?.name === 'TimeoutError';
const saidAsItIs = (error, doing) => `${scrub(error instanceof Error ? error.message : '') || 'GitLab could not be asked'} (while ${doing})`;

const onlyLevel = (list, level) => Array.isArray(list) && list.length === 1 && list[0].access_level === level;

function refusal(status, doing) {
  if (status === 401) return `GitLab did not accept the sign-in while ${doing}`;
  if (status === 403) return `GitLab says this sign-in is not allowed to do this (${doing}); it needs the Maintainer or Owner role`;
  if (status === 404) return `GitLab could not find the project while ${doing}`;
  return `GitLab answered ${status} while ${doing}`;
}

async function readProject(api, projectId, doing) {
  const project = await api.get(projectPath(projectId));
  if (project.status !== 200) throw new Error(refusal(project.status, doing));
  return project.body ?? {};
}

export async function readGitlabProtection({ api, projectId, branch }) {
  const found = await api.get(branchPath(projectId, branch));
  if (found.status !== 200 && found.status !== 404) throw new Error(refusal(found.status, 'reading the branch protection'));
  const project = await readProject(api, projectId, 'reading the pipeline rule');
  const pipelinesMustSucceed = project.only_allow_merge_if_pipeline_succeeds === true;
  if (found.status === 404) {
    return { protected: false, pushAccess: [], mergeAccess: [], allowForcePush: false, pipelinesMustSucceed };
  }
  const body = found.body ?? {};
  return {
    protected: true,
    pushAccess: levels(body.push_access_levels),
    mergeAccess: levels(body.merge_access_levels),
    allowForcePush: body.allow_force_push === true,
    pipelinesMustSucceed,
  };
}

// mergeAccess is Developers + Maintainers (30) unless Maintainers (40) is asked
// for (pushAccess is No one unless Developers + Maintainers is asked for, for a
// branch that takes direct pushes by design): a Developer-level project key can then merge, but cannot undo the
// protection. A project with no pipelines at all can never merge once "pipelines must
// succeed" is on, so a caller can leave that rule alone (pipelinesMustSucceed: false).
export async function protectGitlabBranch({ api, projectId, branch, mergeAccess = DEVELOPERS, pushAccess = NO_ONE, pipelinesMustSucceed = true }) {
  if (pushAccess !== NO_ONE && pushAccess !== DEVELOPERS) throw new Error('Push access can be No one (0) or Developers + Maintainers (30)');
  if (mergeAccess !== MAINTAINERS && mergeAccess !== DEVELOPERS) throw new Error('Merge access can be Developers + Maintainers (30) or Maintainers (40)');
  const found = await api.get(branchPath(projectId, branch));
  if (found.status !== 200 && found.status !== 404) throw new Error(refusal(found.status, 'reading the branch protection'));

  const right = (read) => read.status === 200
    && onlyLevel(read.body?.push_access_levels, pushAccess)
    && onlyLevel(read.body?.merge_access_levels, mergeAccess)
    && read.body?.allow_force_push !== true;
  const already = right(found);

  if (!already) {
    const protectWith = (push, merge, force) => api.post(`${projectPath(projectId)}/protected_branches`, {
      name: branch,
      push_access_level: push,
      merge_access_level: merge,
      allow_force_push: force,
    });
    const succeeded = (answer) => answer.status >= 200 && answer.status < 300;

    if (found.status === 200) {
      // GitLab's update call takes access as a list (Premium and Ultimate), so
      // a protection that is wrong is removed and made again by role.
      const removed = await api.delete(branchPath(projectId, branch));
      if (!succeeded(removed)) throw new Error(refusal(removed.status, 'removing the old branch protection'));
    }
    // A dropped connection is read back before anything is said: the change may
    // have landed. If it did not, it is handled like a refusal, and the old
    // protection is put back where there was one.
    let made;
    let failure = null;
    let readBack = true;
    try {
      made = await protectWith(pushAccess, mergeAccess, false);
    } catch (error) {
      made = { status: 0 };
      failure = error;
      try {
        const back = await api.get(branchPath(projectId, branch));
        if (back.status !== 200 && back.status !== 404) readBack = false;
        else if (right(back)) made = { status: 200 };
      } catch {
        readBack = false;
      }
    }
    // Neither the change nor the read-back got an answer: nothing is re-created, because the
    // change may have landed, and a second one could undo it.
    if (!succeeded(made) && made.status === 0 && !readBack) {
      throw new Error('Wheelhouse can\'t tell whether the change landed: check the project\'s protected branches page (Settings, Repository, Protected branches)');
    }
    if (!succeeded(made)) {
      const message = made.status !== 0
        ? refusal(made.status, 'asking GitLab to protect the branch')
        : isNetworkError(failure)
          ? 'GitLab could not be reached while asking it to protect the branch'
          : saidAsItIs(failure, 'asking GitLab to protect the branch');
      if (found.status !== 200) throw new Error(message);
      // The old protection is gone; put it back if it can be put back by role.
      const [oldPush, oldMerge] = [found.body?.push_access_levels, found.body?.merge_access_levels];
      const single = (list) => Array.isArray(list) && list.length === 1 && Number.isInteger(list[0].access_level);
      let restored = false;
      if (single(oldPush) && single(oldMerge)) {
        try {
          restored = succeeded(await protectWith(oldPush[0].access_level, oldMerge[0].access_level, found.body?.allow_force_push === true));
        } catch { /* reported below */ }
      }
      throw new Error(restored
        ? `${message}; the old protection was put back`
        : `${message}; the branch is now unprotected and the old protection could not be put back`);
    }
  }

  if (!pipelinesMustSucceed) return;
  const rule = await api.put(projectPath(projectId), { only_allow_merge_if_pipeline_succeeds: true });
  if (rule.status < 200 || rule.status >= 300) throw new Error(refusal(rule.status, 'setting the pipeline rule'));
}

// ---------------------------------------------------------------------------
// The board's view of the host's protection (design section 12.3).
// The default branch takes no direct pushes. wheelhouse-state and
// wheelhouse-lock take direct pushes by design, so only force-pushes and
// deletion are blocked there (the lock's fencing relies on no force-push).
// Required checks are asked for only where the project already has CI.
// ---------------------------------------------------------------------------
const STATE_BRANCH = 'wheelhouse-state';
const LOCK_BRANCH = 'wheelhouse-lock';
const DEFAULT_RULESET = 'Wheelhouse: default branch';
const STATE_RULESET = 'Wheelhouse: state and lock';

export const FREE_PLAN_LINE = "GitHub's free plan doesn't protect private projects; Wheelhouse's helper and checks hold the line.";
// A commit with no pipeline has not passed (design section 12.3), so with no
// checks at all nothing merges: the line must not suggest otherwise.
const NO_CI = "the project has no checks yet, so Wheelhouse won't merge anything until it has CI.";

const CI_QUERY = 'query($owner:String!,$name:String!,$branch:String!){repository(owner:$owner,name:$name){ref(qualifiedName:$branch){target{... on Commit{statusCheckRollup{contexts(first:50){nodes{__typename ... on CheckRun{name} ... on StatusContext{context}}}}}}}}}';

function ghFailure(status, doing) {
  if (status === 401) return `GitHub did not accept the sign-in while ${doing}`;
  if (status === 403) return `GitHub says this sign-in is not allowed to do this (${doing}); it needs admin rights on the repository`;
  if (status === 404) return `GitHub could not find the repository while ${doing}`;
  return `GitHub answered ${status || 'with an error'} while ${doing}`;
}

function ghApiFor(run, env) {
  return async (method, path, body) => {
    const args = ['api', path, '--method', method];
    if (body !== undefined) args.push('--input', '-');
    const { code, stdout, stderr } = await run(toolPath('gh'), args, { env, input: body === undefined ? undefined : JSON.stringify(body) });
    const text = String(stderr || '') + String(stdout || '');
    if (code === 0) {
      let parsed = null;
      try { parsed = stdout ? JSON.parse(stdout) : null; } catch { /* not JSON */ }
      return { status: 200, body: parsed };
    }
    const status = Number(/HTTP (\d{3})/.exec(text)?.[1] ?? 0);
    return { status, body: null, upgrade: /upgrade to github|make this repository public/i.test(text) };
  };
}

const must = (answer, doing) => {
  if (answer.status !== 200) throw new Error(ghFailure(answer.status, doing));
  return answer.body;
};

async function inspectGithub(gh, repo) {
  const info = must(await gh('GET', `repos/${repo}`), 'reading the repository') ?? {};
  const defaultBranch = info.default_branch;
  if (typeof defaultBranch !== 'string') throw new Error('GitHub did not say which branch is the default');
  let available = info.private !== true;
  if (!available) {
    const owner = info.owner ?? {};
    // The plan is the owner's. For a person it is readable only when the owner is the signed-in
    // user; for anyone else it is not known, and the repository's own answer to rulesets decides.
    const planAnswer = await gh('GET', owner.type === 'Organization' ? `orgs/${owner.login}` : 'user');
    const theirs = planAnswer.status === 200 && (owner.type === 'Organization'
      || String(planAnswer.body?.login ?? '').toLowerCase() === String(owner.login ?? '').toLowerCase());
    const plan = theirs ? planAnswer.body?.plan?.name : undefined;
    if (typeof plan === 'string') {
      available = plan.toLowerCase() !== 'free';
    } else {
      const probe = await gh('GET', `repos/${repo}/rulesets`);
      available = !((probe.status === 403 || probe.status === 404) && probe.upgrade);
    }
  }
  return { defaultBranch, available };
}

const ref = (branch) => `refs/heads/${branch}`;

function rulesetBody(name, branches, rules) {
  return {
    name,
    target: 'branch',
    enforcement: 'active',
    bypass_actors: [],
    conditions: { ref_name: { include: branches.map(ref), exclude: [] } },
    rules,
  };
}

async function existingRulesets(gh, repo) {
  const list = await gh('GET', `repos/${repo}/rulesets`);
  if (list.status !== 200) return { refused: list };
  const found = {};
  for (const one of list.body ?? []) {
    if (one.name !== DEFAULT_RULESET && one.name !== STATE_RULESET) continue;
    const full = must(await gh('GET', `repos/${repo}/rulesets/${one.id}`), 'reading a ruleset') ?? one;
    found[one.name] = { id: one.id, ...full };
  }
  return { found };
}

const hasRules = (ruleset, wanted, forbidden = []) => {
  const rules = ruleset?.rules ?? [];
  const types = rules.map((r) => r.type);
  // A rule asking for checks but naming none asks for nothing.
  const checksNamed = rules.filter((r) => r.type === 'required_status_checks')
    .every((r) => (r.parameters?.required_status_checks ?? []).length > 0);
  return ruleset?.enforcement === 'active'
    // GitHub shows bypass_actors only to callers who can write the ruleset: absent is unknown,
    // not empty. And when it says whether this caller could bypass, the answer must be never.
    && Array.isArray(ruleset.bypass_actors) && ruleset.bypass_actors.length === 0
    && (ruleset.current_user_can_bypass === undefined || ruleset.current_user_can_bypass === 'never')
    && (ruleset.conditions?.ref_name?.exclude ?? []).length === 0
    && checksNamed
    && wanted.every((t) => types.includes(t))
    && forbidden.every((t) => !types.includes(t));
};

const covers = (ruleset, branches) => {
  const include = ruleset?.conditions?.ref_name?.include ?? [];
  return branches.every((b) => include.includes(ref(b)));
};

async function githubStatus(gh, repo) {
  const { defaultBranch, available } = await inspectGithub(gh, repo);
  if (!available) return { available: false, on: false, line: FREE_PLAN_LINE, defaultBranch };
  const { found, refused } = await existingRulesets(gh, repo);
  if (refused) {
    if ((refused.status === 403 || refused.status === 404) && refused.upgrade) return { available: false, on: false, line: FREE_PLAN_LINE, defaultBranch };
    throw new Error(ghFailure(refused.status, 'reading the rulesets'));
  }
  const main = found[DEFAULT_RULESET];
  const side = found[STATE_RULESET];
  const on = hasRules(main, ['pull_request', 'deletion', 'non_fast_forward']) && covers(main, [defaultBranch])
    && hasRules(side, ['deletion', 'non_fast_forward'], ['pull_request']) && covers(side, [STATE_BRANCH, LOCK_BRANCH]);
  if (!on) return { available: true, on: false, line: "GitHub's protection is available but not switched on for this project yet.", defaultBranch };
  const checks = (main.rules ?? []).some((r) => r.type === 'required_status_checks');
  return {
    available: true,
    on: true,
    line: `GitHub blocks direct pushes to ${defaultBranch}, and force-pushes and deletion of the state and lock branches${checks ? ', and requires its checks to pass' : `; ${NO_CI}`}`.replace(/([^.])$/, '$1.'),
    defaultBranch,
  };
}

async function seenChecks(gh, repo, branch) {
  const [owner, name] = repo.split('/');
  const answer = await gh('POST', 'graphql', { query: CI_QUERY, variables: { owner, name, branch: ref(branch) } });
  const reply = must(answer, 'reading the checks');
  // A 200 can carry errors: that is not the absence of checks.
  if ((Array.isArray(reply?.errors) && reply.errors.length > 0) || reply?.data == null) throw new Error('GitHub could not read the checks, so protection was not switched on');
  const nodes = reply.data.repository?.ref?.target?.statusCheckRollup?.contexts?.nodes ?? [];
  return [...new Set(nodes.map((n) => n.name ?? n.context).filter((n) => typeof n === 'string' && n))];
}

async function switchOnGithub(gh, repo) {
  const status = await githubStatus(gh, repo);
  if (!status.available) return { on: false, line: status.line };
  const { defaultBranch } = status;
  const contexts = await seenChecks(gh, repo, defaultBranch);
  const mainRules = [
    { type: 'pull_request', parameters: {
      required_approving_review_count: 0,
      dismiss_stale_reviews_on_push: false,
      require_code_owner_review: false,
      require_last_push_approval: false,
      required_review_thread_resolution: false,
    } },
    { type: 'deletion' },
    { type: 'non_fast_forward' },
  ];
  if (contexts.length > 0) {
    mainRules.push({ type: 'required_status_checks', parameters: {
      required_status_checks: contexts.map((context) => ({ context })),
      strict_required_status_checks_policy: false,
    } });
  }
  const wanted = [
    rulesetBody(DEFAULT_RULESET, [defaultBranch], mainRules),
    rulesetBody(STATE_RULESET, [STATE_BRANCH, LOCK_BRANCH], [{ type: 'deletion' }, { type: 'non_fast_forward' }]),
  ];
  const { found, refused } = await existingRulesets(gh, repo);
  if (refused) {
    if ((refused.status === 403 || refused.status === 404) && refused.upgrade) return { on: false, line: FREE_PLAN_LINE };
    throw new Error(ghFailure(refused.status, 'reading the rulesets'));
  }
  let lost = false;
  for (const body of wanted) {
    const old = found[body.name];
    const answer = old
      ? await gh('PUT', `repos/${repo}/rulesets/${old.id}`, body)
      : await gh('POST', `repos/${repo}/rulesets`, body);
    if (answer.status === 403 && answer.upgrade) return { on: false, line: FREE_PLAN_LINE };
    // No HTTP answer at all (a dropped connection): read back below before saying anything.
    if (answer.status === 0) { lost = true; continue; }
    must(answer, 'asking GitHub to protect the branches');
  }
  const after = await githubStatus(gh, repo);
  if (lost && !after.on) throw new Error('GitHub did not answer while asking it to protect the branches, and the protection is not in place');
  return { on: after.on, line: after.line };
}

// GitLab ----------------------------------------------------------------
async function gitlabDefaults(api, repo) {
  const project = await readProject(api, repo, 'reading the project');
  const defaultBranch = project.default_branch;
  if (typeof defaultBranch !== 'string') throw new Error('GitLab did not say which branch is the default');
  return defaultBranch;
}

async function gitlabHasPipelines(api, repo, branch) {
  const answer = await api.get(`${projectPath(repo)}/pipelines?ref=${encodeURIComponent(branch)}&per_page=1`);
  if (answer.status !== 200) throw new Error(refusal(answer.status, 'reading the pipelines'));
  return Array.isArray(answer.body) && answer.body.length > 0;
}

const sameList = (got, want) => got.length === 1 && got[0] === want;

async function gitlabStatus(api, repo) {
  const defaultBranch = await gitlabDefaults(api, repo);
  const main = await readGitlabProtection({ api, projectId: repo, branch: defaultBranch });
  const side = [];
  for (const branch of [STATE_BRANCH, LOCK_BRANCH]) side.push(await readGitlabProtection({ api, projectId: repo, branch }));
  const on = main.protected && sameList(main.pushAccess, 'No one') && !main.allowForcePush
    && side.every((one) => one.protected && sameList(one.pushAccess, 'Developers + Maintainers') && !one.allowForcePush);
  if (!on) return { available: true, on: false, line: "GitLab's protection is available but not switched on for this project yet.", defaultBranch, main };
  return {
    available: true,
    on: true,
    line: `GitLab blocks direct pushes to ${defaultBranch}, and force-pushes and deletion of the state and lock branches${main.pipelinesMustSucceed ? ', and requires pipelines to pass.' : `; ${NO_CI}`}`,
    defaultBranch,
    main,
  };
}

async function switchOnGitlab(api, repo) {
  const defaultBranch = await gitlabDefaults(api, repo);
  const hasCi = await gitlabHasPipelines(api, repo, defaultBranch);
  await protectGitlabBranch({ api, projectId: repo, branch: defaultBranch, pushAccess: NO_ONE, pipelinesMustSucceed: hasCi });
  for (const branch of [STATE_BRANCH, LOCK_BRANCH]) {
    await protectGitlabBranch({ api, projectId: repo, branch, pushAccess: DEVELOPERS, mergeAccess: DEVELOPERS, pipelinesMustSucceed: false });
  }
  const after = await gitlabStatus(api, repo);
  return { on: after.on, line: after.line };
}

function unknownHost(host) {
  return new Error(`Protection is not known for the host "${host}"`);
}

export async function protectionStatus({ host, repo, run, api, env }) {
  if (host === 'github') {
    const { available, on, line } = await githubStatus(ghApiFor(run, env), repo);
    return { available, on, line };
  }
  if (host === 'gitlab') {
    const { available, on, line } = await gitlabStatus(api, repo);
    return { available, on, line };
  }
  throw unknownHost(host);
}

export async function switchOnProtection({ host, repo, run, api, env }) {
  if (host === 'github') return switchOnGithub(ghApiFor(run, env), repo);
  if (host === 'gitlab') return switchOnGitlab(api, repo);
  throw unknownHost(host);
}
