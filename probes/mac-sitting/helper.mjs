// probes/mac-sitting/helper.mjs
// The host helper for the sitting, on the home's own socket, where the bridge, the hooks and the
// front desk's command find it. A real helper, as the end-to-end tests run it, with gh and glab
// stood in for: pull request 7 open at the head its stand-in host holds, CI green on it, main the
// default branch, and a merge that is only noted. Started detached by prepare.mjs; stopped by
// undo.mjs (SIGTERM). Writes one line, "ready <address>", to its log once it listens.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { LOGS, PR, REMOTES, REPO, fromPlugin, useHome } from './layout.mjs';

useHome();
const { startHelper } = await fromPlugin('scripts/host/helper.js');
const { matchingBody } = await fromPlugin('tests/helpers/provenance.js');

const remote = path.join(REMOTES, `${REPO}.git`);
const head = () => execFileSync('git', ['--git-dir', remote, 'rev-parse', `refs/pull/${PR}/head`], { encoding: 'utf8' }).trim();
const BODY = matchingBody();
const noted = (what) => fs.appendFileSync(path.join(LOGS, 'stand-in-host.jsonl'), `${JSON.stringify({ at: new Date().toISOString(), ...what })}\n`);

const adapter = {
  defaultBranch: async () => 'main',
  prState: async () => ({ headSha: head(), mergeable: 'mergeable', state: 'open', body: BODY }),
  ciState: async (sha) => ({ sha, state: 'success' }),
  merge: async (args) => { noted({ merge: args }); return { merged: true }; },
  // An https address, so the approval card's Show me is a link (check 42, step 2). It is a public example page.
  previewUrl: async () => 'https://example.com/',
  openPr: async () => ({ number: PR }),
  updatePr: async () => ({ number: PR }),
  issue: { create: async () => ({ number: 1 }), update: async () => ({ number: 1 }), list: async () => [] },
};

const helper = await startHelper({ adapterFor: async () => adapter, envFor: async () => ({}) });
process.stdout.write(`ready ${helper.address}\n`);
const close = () => { helper.close().then(() => process.exit(0), () => process.exit(1)); };
process.on('SIGTERM', close);
process.on('SIGINT', close);
