// tests/helpers/host-ci-facts.js
// What a stand-in host says of a project whose checks run on the host: a job of the host's own reports on every head. The merge
// gate reads these facts to tell where a project's checks run, and refuses a merge when it cannot read them.
export const HOST_CI = {
  checkContexts: async () => [{ name: 'test', state: 'success', startedAt: '2026-11-23T00:00:00Z', app: null }],
  requiredChecks: async () => [],
  branchHead: async () => 'a'.repeat(40),
};
