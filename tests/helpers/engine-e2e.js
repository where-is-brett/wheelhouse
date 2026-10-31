// tests/helpers/engine-e2e.js
// What the engine's end-to-end tests stand in for (tests/e2e/engine-*.test.js): the code host as the helper's adapter
// sees it, over a bare repository, and the wake process.
import { EventEmitter } from 'node:events';
import { run } from '../../scripts/lib/run.js';

// The host as the helper's adapter sees it, over the bare repository: pull requests opened from branches it holds.
export function standInHost(remoteUrl) {
  const prs = new Map();
  const comments = [];
  const headOf = async (branch) => {
    const found = await run('git', ['rev-parse', '--verify', '-q', `refs/heads/${branch}`], { cwd: remoteUrl });
    return found.code === 0 ? found.stdout.trim() : null;
  };
  return {
    comments,
    defaultBranch: async () => 'main',
    openRequests: async () => [...prs.entries()].map(([number, pr]) => ({ number, branch: pr.head, fork: false })),
    openPr: async ({ head, base, title, body }) => {
      prs.set(prs.size + 1, { head, base, title, body });
      return { number: prs.size };
    },
    updatePr: async ({ number }) => ({ number }),
    branchHead: headOf,
    prState: async (number) => ({ number, headSha: await headOf(prs.get(number).head), headRef: prs.get(number).head, baseRef: 'main', mergeable: 'yes', state: 'open', body: '' }),
    verdictComment: async ({ number, id, body }) => { comments.push({ number, id, body }); return { id: id ?? 500 }; },
    ciState: async (sha) => ({ sha, state: 'pending' }),
    checkContexts: async () => [{ name: 'ci', state: 'pending' }],
    requiredChecks: async () => [],
    issue: { create: async () => ({ number: 1 }), update: async () => ({ number: 1 }), list: async () => [] },
  };
}

export function stubSpawn() {
  return () => {
    const child = new EventEmitter();
    child.pid = 7000;
    child.kill = () => { setImmediate(() => child.emit('exit', null, 'SIGTERM')); return true; };
    return child;
  };
}
