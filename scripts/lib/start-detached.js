// scripts/lib/start-detached.js
// Starting a script in the background, in a module of its own so a hook that only starts one doesn't load the session
// recording, the usage receiver and the weekly job that scripts/lib/background.js carries.
import fs from 'node:fs';
import { jobFolder, wheelhouseHome } from './paths.js';

// Starts `node <script> [args]` detached in Wheelhouse's home, with no window and no output kept; true
// when it started.
export function startDetached(spawn, script, args = []) {
  try {
    const home = wheelhouseHome();
    fs.mkdirSync(home, { recursive: true });
    const child = spawn(process.execPath, [script, ...args], { cwd: jobFolder(), detached: true, windowsHide: true, stdio: 'ignore' });
    child?.unref?.();
    child?.on?.('error', () => {});
    return true;
  } catch {
    return false;
  }
}
