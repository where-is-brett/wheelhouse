// scripts/desk/core.js
// The desk's core: three operations, `read`, `act` and `watch`, over the `desk/1` vocabulary
// (spec 5.2). It is built from a source (where views, events and settings come from), a recorder
// (how a decision is written) and a verifier (whether the evidence shows the director made it,
// by default the desk's own, evidence.js), all injected, so the helper runs it over the files
// under ~/.wheelhouse and the stand-in helper over memory. Every answer is `{ ok: true, v, … }` or `{ ok: false, v, refused }`; nothing throws.
import { DESK_VERSION, VIEWS, COMMANDS, needsEvidence } from './vocabulary.js';
import { READERS } from './views.js';
import { ACTORS } from './acts.js';
import { sourceVerifier } from './evidence.js';
import { watchSource } from './watch.js';

const notBuilt = (name) => async () => ({ ok: false, refused: `The desk can't give ${name} yet` });

export function checkVersion(message) {
  const v = message?.v;
  if (v === DESK_VERSION) return { ok: true };
  return { ok: false, refused: v ? `This desk speaks ${DESK_VERSION}, not ${v}` : `A desk message names its version, ${DESK_VERSION}` };
}

const stamp = (answer) => ({ ...answer, v: DESK_VERSION });
const failed = (error) => stamp({ ok: false, refused: `Wheelhouse couldn't do that: ${error?.message || error}` });

// `readers` maps a view to `(args, source, { now }) -> { ok, … }`; `actors` maps a command to
// `(args, checked, { source, recorder, now }) -> { ok, … }`; `watcher` is
// `(cursor, source, { now }) -> { ok, events, cursor }`. The defaults are the desk's own.
export function deskCore({ source, recorder, verifier, now = () => new Date(), readers = READERS, actors = ACTORS, watcher = watchSource, clients }) {
  verifier ??= sourceVerifier(source, { clients, now });
  return {
    async read(view, args = {}) {
      if (!VIEWS.includes(view)) return stamp({ ok: false, refused: `Wheelhouse has no view called "${view}"` });
      try {
        return stamp(await (readers[view] || notBuilt(`the ${view} view`))(args, source, { now }));
      } catch (error) {
        return failed(error);
      }
    },

    async act(command, args = {}, evidence) {
      if (!COMMANDS.includes(command)) return stamp({ ok: false, refused: `Wheelhouse can't "${command}"` });
      if (needsEvidence(command) && !evidence) return stamp({ ok: false, refused: 'That needs evidence the director chose it, and none came with it' });
      try {
        const checked = needsEvidence(command) ? await verifier.check(command, args, evidence) : { ok: true, records: [] };
        if (!checked.ok) return stamp({ ok: false, refused: checked.refused });
        return stamp(await (actors[command] || notBuilt(`"${command}"`))(args, checked, { source, recorder, now }));
      } catch (error) {
        return failed(error);
      }
    },

    async watch(cursor) {
      try {
        return stamp(await watcher(cursor, source, { now }));
      } catch (error) {
        return failed(error);
      }
    },
  };
}
