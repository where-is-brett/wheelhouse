// scripts/desk/mod-desk.js
// The mod's way to the desk: deskClient with the local fallback (`local: 'auto'`), over the helper
// client the mod's bridge was given. A helper client with no desk routes (an older helper's, or a
// test's) reads as a helper that couldn't be reached, as does a desk route that throws, so the desk's
// local fallback reads and the caller keeps its record as it does when the helper is down.
import { deskClient, unreached } from './client.js';
import { helperClient } from '../host/helper-client.js';

export { unreached };

const NOT_REACHED = { ok: false, refused: 'the host helper could not be reached: it has no desk' };

// The helper client with desk routes that never throw.
function withDesk(helper) {
  const routes = helper?.desk;
  const route = (op) => async (body) => {
    if (typeof routes?.[op] !== 'function') return NOT_REACHED;
    try {
      return await routes[op](body);
    } catch {
      return NOT_REACHED;
    }
  };
  return { ...helper, desk: { read: route('read'), act: route('act'), watch: route('watch') } };
}

// modDesk({ project, cwd, client, now, timeout }) -> { read, act, watch }, as deskClient's.
export function modDesk({ project, cwd, client, now = () => new Date(), timeout } = {}) {
  const helper = client ?? helperClient(timeout ? { timeout } : {});
  return deskClient({
    ...(typeof project === 'string' ? { project } : {}),
    ...(typeof cwd === 'string' ? { cwd } : {}),
    client: withDesk(helper),
    local: 'auto',
    now,
  });
}

// The records keepEarned kept, as a signed act's evidence carries them: each kept body's event,
// with the event it confirms (`target`) and whether it goes to the director's profile.
export function signedRecords(kept, { target } = {}) {
  return (Array.isArray(kept) ? kept : [kept]).filter(Boolean).map(({ body, route }) => ({
    event: body.event,
    ...(target !== undefined ? { target } : body.target !== undefined ? { target: body.target } : {}),
    ...(route === 'profile-record' ? { profile: true } : {}),
  }));
}
