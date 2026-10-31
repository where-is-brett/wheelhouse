// scripts/host/adapter-for.js
// The adapter for a project's record: the host's, or the local one for a project in git alone (spec 6).
import { makeAdapter } from './adapter.js';
import { makeLocalAdapter } from './local/adapter.js';
import { gitRoute } from './local/home.js';

// `write` keeps a local change's signed event the caller's own way; a hosted project has none to keep.
export function adapterOf(record, { run, env = {}, write } = {}) {
  if (record.host === 'local') return makeLocalAdapter({ project: record.repo.slice('local/'.length), git: gitRoute({ run }), write });
  return makeAdapter({ host: record.host, repo: record.repo, run, env, base: record.connection?.baseUrl });
}
