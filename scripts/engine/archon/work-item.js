// scripts/engine/archon/work-item.js
// The `work/<n>` document Archon's merge queue reads from its state store (check 76; ruling 9 of part 3b): the queue
// takes only work items marked ready by the build queue, which Wheelhouse is. Written at mark-ready, one per pull
// request; a lane run again hands the item back with one more round (part 3c's).

// A version 1 work item for pull request `pr` of `repo`, ready for the queue, delivered by run `runId` at `at`.
export function readyWorkItem({ repo, pr, url, at, runId }) {
  return {
    version: 1,
    subject: { repo, number: pr },
    created_at: at,
    stage: 'deliver',
    trust: 'maintainer',
    claim: null,
    requests: [],
    links: { runs: [] },
    promoted: null,
    facts: {
      build: {
        status: 'ready',
        brief: '',
        rounds: [{ run_id: runId, at, delivered: true, reason: 'delivered', pr_url: url, summary: 'Delivered by Wheelhouse.', artifacts: '' }],
        decisions: [],
        at,
      },
    },
    history: [],
  };
}
