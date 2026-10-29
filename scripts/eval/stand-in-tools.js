// scripts/eval/stand-in-tools.js
// What the helper may run in the counted evaluation's world on real Archon (archon-world.js): git and Node.js as they
// are, and the code host's tool stood in, each call kept and answered as an empty success, so a call the broker lets
// through reaches no host. Anything else is refused and kept. Its own file, so the world's Archon command lines are
// never read as the host tool's.
import { run as realRun } from '../lib/run.js';

export function standInTools({ forwarded, refused }) {
  return (file, args = [], options) => {
    const name = String(file).split(/[\\/]/).pop().replace(/\.(exe|cmd|bat|com)$/i, '').toLowerCase();
    if (name === 'git' || name === 'node') return realRun(file, args, options);
    if (name === 'gh') {
      forwarded.push(args.join(' '));
      return Promise.resolve({ code: 0, stdout: '', stderr: '' });
    }
    refused.push([name, ...args].join(' '));
    return Promise.resolve({ code: 1, stdout: '', stderr: `${name} is not run in the evaluation's world` });
  };
}
