// probes/11-helper/setup.js
// Check 11: makes the scratch project for the trials, with the sandbox on
// and the helper started by a hook, and prints its folder.
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { makeScratchProject } from '../lib/scratch.js';
import { probeLogDir } from '../lib/log.js';

const here = (name) => fileURLToPath(new URL(`./${name}`, import.meta.url));
const socketPath = path.join(probeLogDir('11-helper'), 'helper.sock');

const project = await makeScratchProject({
  name: 'helper',
  files: { '.env.local': 'PROBE_ONLY=not-a-real-secret\n' },
  settings: {
    permissions: { deny: ['Read(./.env*)', 'Read(~/.config/gh/**)', 'Read(~/.ssh/**)'] },
    sandbox: {
      enabled: true,
      failIfUnavailable: true,
      allowUnsandboxedCommands: false,
      filesystem: {
        denyRead: ['~/.config/gh', '~/.ssh', '~/.npmrc', './.env*'],
        allowWrite: ['.', path.join(os.homedir(), '.wheelhouse-probes', '11-helper-trials')],
      },
      network: {
        allowedDomains: ['registry.npmjs.org'],
        allowUnixSockets: [socketPath],
      },
    },
    hooks: { SessionStart: [{ hooks: [{ type: 'command', command: `node "${here('start.js')}"` }] }] },
  },
});
console.log(project.dir);
console.log(`Ask the session there to run: node "${here('trials.js')}"`);
