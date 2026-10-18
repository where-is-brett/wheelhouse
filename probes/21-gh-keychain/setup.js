// probes/21-gh-keychain/setup.js
// Check 21: makes the scratch project for the trials, with the sandbox on and
// the settings Wheelhouse uses, and prints its folder.
import { fileURLToPath } from 'node:url';
import { makeScratchProject } from '../lib/scratch.js';

const here = (name) => fileURLToPath(new URL(`./${name}`, import.meta.url));

const project = await makeScratchProject({
  name: 'gh-keychain',
  files: { '.env.local': 'PROBE_ONLY=not-a-real-secret\n' },
  settings: {
    permissions: {
      deny: ['Read(./.env*)', 'Read(~/.config/gh/**)', 'Read(~/.config/glab-cli/**)', 'Read(~/.ssh/**)'],
    },
    sandbox: {
      enabled: true,
      failIfUnavailable: true,
      allowUnsandboxedCommands: false,
      filesystem: {
        denyRead: ['~/.config/gh', '~/.config/glab-cli', '~/.ssh', '~/.npmrc', './.env*'],
      },
      network: { allowedDomains: ['registry.npmjs.org'], deniedDomains: ['github.com', 'gitlab.com'] },
    },
  },
});
console.log(project.dir);
console.log(`Ask the session there to run: node "${here('trials.js')}"`);
