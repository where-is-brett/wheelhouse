// scripts/desk/client.js
// The one client every front end reads and changes Wheelhouse through (spec 5.5): `read`, `act` and
// `watch`, sent to the helper's desk routes with `v: 'desk/1'`. When the helper can't be reached
// (a fresh sign-in, a crash) and the caller can read ~/.wheelhouse (it isn't in the sandbox), `read`,
// `watch` and `act('all-stop')` run the same core in process over the files (`local: 'auto'`); every
// other act is refused in plain words, and the caller keeps its pending record as it does today.
// Inside the sandbox ~/.wheelhouse can't be read, so the local core is never used there.
import fs from 'node:fs';
import { helperClient } from '../host/helper-client.js';
import { projectOf } from '../hooks/kit.js';
import { wheelhouseHome } from '../lib/paths.js';
import { setStop } from '../lib/stop.js';
import { deskCore } from './core.js';
import { fileSource } from './file-source.js';
import { DESK_VERSION } from './vocabulary.js';

export const HELPER_NOT_RUNNING = 'Wheelhouse\'s helper isn\'t running; this is kept and sent when it is';
const STOP_SETTERS = ['prompt', 'mod', 'helper', 'runbook'];
// The helper client's own words for a helper it couldn't reach, or that didn't answer in time.
const UNREACHED = /could not be reached|did not answer in time|answer was cut off/;

// Whether an answer says the helper wasn't reached.
export const unreached = (answer) => answer?.ok !== true && typeof answer?.refused === 'string' && UNREACHED.test(answer.refused);

// Whether this process can read the Wheelhouse home: false in the sandbox, which denies it.
function homeReadable() {
  try {
    fs.accessSync(wheelhouseHome(), fs.constants.R_OK);
    fs.readdirSync(wheelhouseHome());
    return true;
  } catch {
    return false;
  }
}

// deskClient({ address, cwd, project, local, timeout, client, now, waitMs }) -> { read, act, watch }. `client`
// is a helper client to ask instead of one made here (a test's, or a front end's own); `waitMs` is how long
// the local core's board inputs wait on the helper.
export function deskClient({ address, cwd, project, local = 'auto', timeout, client, now = () => new Date(), waitMs } = {}) {
  const helper = client ?? helperClient({ ...(address ? { address } : {}), ...(timeout ? { timeout } : {}) });
  const where = project ? { project } : { cwd };

  // The core in process, over the files, or null when it may not run here.
  let core;
  const localCore = () => {
    if (core !== undefined) return core;
    core = null;
    if (local !== 'auto' || !homeReadable()) return core;
    let found = null;
    try {
      found = project ? { project, folder: cwd } : projectOf(cwd);
    } catch {
      found = null;
    }
    if (!found) return core;
    const recorder = {
      setStop: async ({ by }) => { setStop({ by: STOP_SETTERS.includes(by) ? by : 'helper', now }); return { ok: true }; },
      liftStop: async () => ({ ok: false, refused: HELPER_NOT_RUNNING }),
      record: async () => ({ ok: false, refused: HELPER_NOT_RUNNING }),
      write: async () => ({ ok: false, refused: HELPER_NOT_RUNNING }),
      chatClick: async () => ({ ok: false, refused: HELPER_NOT_RUNNING }),
      confirm: async () => ({ ok: false, refused: HELPER_NOT_RUNNING }),
    };
    core = deskCore({ source: fileSource(found.project, { cwd: cwd ?? found.record?.folder, client: helper, now, waitMs }), recorder, now });
    return core;
  };

  const ask = async (route, body) => {
    const got = await helper.desk[route]({ v: DESK_VERSION, ...where, ...body });
    return { got, away: unreached(got) };
  };

  return {
    async read(view, args = {}) {
      const { got, away } = await ask('read', { view, args });
      if (!away || localCore() === null) return got;
      return { ...(await localCore().read(view, args)), local: true };
    },
    async act(command, args = {}, evidence) {
      const { got, away } = await ask('act', { command, args, ...(evidence === undefined ? {} : { evidence }) });
      if (!away) return got;
      if (command === 'all-stop' && localCore() !== null) return { ...(await localCore().act(command, args, evidence)), local: true };
      return { ok: false, v: DESK_VERSION, refused: HELPER_NOT_RUNNING, away: true };
    },
    async watch(cursor = null) {
      const { got, away } = await ask('watch', { cursor });
      if (!away || localCore() === null) return got;
      return { ...(await localCore().watch(cursor)), local: true };
    },
  };
}
