// scripts/engine/room.js
// The engine room (Archon design, section 5.6): Archon's own console, for a developer who wants to look inside. Off by
// default; while the Engine room setting is on, the helper keeps one `archon serve` running, bound to this computer
// only (HOST=127.0.0.1), and the Logbook says so. It is closed under All stop. The guards deny its port to agents
// (scripts/protection/archon.js).
import { archonCommand } from './archon/cli.js';
import { ENGINE_ROOM_PORT } from '../protection/archon.js';

export const ROOM_HOST = '127.0.0.1';
export const ROOM_NAME = 'the engine room';

// `archon serve` in the engine's one environment, with the console's address set to this computer.
export function roomCommand(options = {}) {
  const command = archonCommand(['serve'], options);
  return { ...command, env: { ...command.env, HOST: ROOM_HOST, PORT: String(ENGINE_ROOM_PORT) } };
}

// The Logbook's line while the room is open.
export const roomLine = () => `The engine room is on: Archon's console at http://${ROOM_HOST}:${ENGINE_ROOM_PORT}, on this computer only. Turn Engine room off in the settings to close it.`;

// engineRoom({ spawn, command, wanted, held }) -> { tend, line, stop, processes }
// `tend()` starts the console when `wanted()` and not `held()` (All stop), and ends it otherwise; the helper calls it
// on a timer, and `stop()` when it closes. `line()` is the Logbook's line while it runs, else null.
export function engineRoom({ spawn, command, wanted, held = () => false }) {
  let child = null;
  let entry = null;
  // The console is detached, so it leads a process group of its own: the group is ended, with what it started.
  const end = () => {
    if (!child) return;
    const group = child.detachedGroup === true && Number.isInteger(child.pid) && child.pid > 0;
    try {
      if (group) process.kill(-child.pid, 'SIGTERM');
      else child.kill('SIGTERM');
    } catch { /* it has gone */ }
  };
  return {
    tend() {
      const on = wanted() === true && held() !== true;
      if (!on) { end(); return; }
      if (child) return;
      const c = command();
      const detached = process.platform !== 'win32';
      const started = spawn(c.command, c.args, { env: c.env, stdio: 'ignore', detached, windowsHide: true });
      // Only a real child process leads its own group; a stand-in's pid is nobody's.
      started.detachedGroup = detached && typeof started.spawnfile === 'string';
      child = started;
      entry = { pid: started.pid, name: ROOM_NAME, command: [c.command, ...c.args].join(' '), ended: false };
      const gone = () => {
        if (entry && child === started) entry.ended = true;
        if (child === started) child = null;
      };
      started.once('exit', gone);
      started.once('error', gone);
      started.unref?.();
    },
    line: () => (child ? roomLine() : null),
    stop: end,
    processes: () => (entry && !entry.ended ? [entry] : []),
  };
}
