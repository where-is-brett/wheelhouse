// probes/11-helper/start.js
// Check 11: a SessionStart hook that starts the helper outside the sandbox
// (hooks run with the director's full access) on a socket in the probe's
// log folder, then returns at once.
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { probeLogDir } from '../lib/log.js';

const helper = fileURLToPath(new URL('./helper.js', import.meta.url));
const socketPath = path.join(probeLogDir('11-helper'), 'helper.sock');
spawn(process.execPath, [helper, socketPath], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
