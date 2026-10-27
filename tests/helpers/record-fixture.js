// tests/helpers/record-fixture.js
// Opens a project's private record for a test that seeds events before the helper starts. It takes
// the options a v0.1.x state clone took ({ project, remoteUrl, env }) and reads only `project`: the
// record has no remote (design section 24.1).
import path from 'node:path';
import { openProjectRecord } from '../../scripts/state/record.js';
import { writeProject } from '../../scripts/lib/projects.js';

export function openTestRecord({ project }) {
  return openProjectRecord(project);
}

// Registers `project` on this computer as a project whose repository is the local bare `remote`
// (makeBareRemote's), as setup's record of it would, and opens its record. The lock finds its
// repository from this record.
export async function registerTestProject({ project, remote, folder = remote.root }) {
  const repo = `${path.basename(path.dirname(remote.url))}/${path.basename(remote.url, '.git')}`;
  writeProject(project, { folder, remoteUrl: remote.url, host: 'github', repo, connection: { host: 'github', mode: 'quick', project: repo } });
  return openProjectRecord(project);
}
