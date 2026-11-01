// scripts/engine/stay-awake.js
// Holding the Mac awake (unattended goals design, section 9.1): `caffeinate`, tied to the helper's process, so it ends
// with the helper whatever happens. It needs no password and changes no setting. It holds on mains power only, and a
// closed lid still sleeps the Mac unless a display is attached. Anywhere else this does nothing.
import { spawn as nodeSpawn } from 'node:child_process';

// How long after a child goes before another is started, so a `caffeinate` that can't run doesn't spin.
const AGAIN_MS = 5 * 1000;

// stayAwake({ platform, spawn, pid, againMs }) -> { set(wanted) }
//   pid  the process the hold is tied to: the helper's
// set(true) holds the Mac awake until set(false); a child that goes while wanted is started again.
export function stayAwake({ platform = process.platform, spawn = nodeSpawn, pid = process.pid, againMs = AGAIN_MS } = {}) {
  let wanted = false;
  let child = null;
  let again = null;

  function gone(which) {
    if (which !== null && child !== which) return;
    child = null;
    if (!wanted || again !== null) return;
    again = setTimeout(() => { again = null; if (wanted) begin(); }, againMs);
    again.unref?.();
  }

  function begin() {
    let made;
    try {
      made = spawn('caffeinate', ['-s', '-w', String(pid)], { stdio: 'ignore' });
    } catch {
      gone(null);
      return;
    }
    child = made;
    made.on('error', () => gone(made));
    made.on('exit', () => gone(made));
    made.unref?.();
  }

  return {
    set(want) {
      if (platform !== 'darwin') return;
      wanted = want === true;
      if (wanted) {
        if (child === null && again === null) begin();
        return;
      }
      clearTimeout(again);
      again = null;
      const going = child;
      child = null;
      going?.kill();
    },
  };
}
