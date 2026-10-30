// scripts/engine/broker/routes.js
// The helper's broker routes (Archon design, section 12.4): /broker/gh takes each gh call Archon makes, sorts it by
// the broker's list and decides it with the rules (rules.js); a call that passes runs as the real gh with the
// project's connection, and its output goes back unchanged. No GitHub key ever leaves the helper: Archon's git reads
// come from the fetch mirror the helper keeps, and /broker/refresh has the helper bring it up to date. Both place the
// project by the folder the call came from. They know the helper only through what it gives them:
//   placeOf(cwd)                          { project, folder, repo } of the registered project holding the folder, or null
//   permit(project, call)                 the rules' context for the call (rules.js brokerDecision)
//   forward(project, argv, { cwd, stdin })  runs the real gh: { code, stdout, stderr }
//   refresh(project)                      brings the project's fetch mirror up to date: { ok } or a refusal
//   queueCall(place, argv, stdin)         for a call from the merge queue's folder (place.queue), the call as the
//                                         broker sends it on, { ok, argv, stdin }, or { ok: false, refused }
//   note(project, words)                  a line on the project's Logbook, for each call from the queue's folder refused
import { classifyCall, brokerDecision } from './rules.js';

const refused = (reason) => ({ ok: true, code: 1, stdout: '', stderr: `${reason}\n` });

export function brokerRoutes({ placeOf, permit, forward, refresh, queueCall = async (place, argv, stdin) => ({ ok: true, argv, stdin }), note = async () => {} } = {}) {
  async function gh({ argv, cwd, stdin = '' } = {}) {
    if (!Array.isArray(argv) || !argv.every((a) => typeof a === 'string')) return refused("Wheelhouse's broker was sent a call it can't read.");
    const place = placeOf(cwd);
    if (!place) return refused("Wheelhouse's broker refused this call: it came from a folder that isn't a registered project's.");
    if (typeof place.repo !== 'string' || place.repo === '') return refused("Wheelhouse's broker refused this call: the project's repository isn't known.");
    // A call from the merge queue's folder is shaped first, and each one refused is a line on the Logbook.
    const turnedDown = async (reason) => {
      if (place.queue === true) await Promise.resolve(note(place.project, `The broker refused the merge queue's call gh ${argv.slice(0, 3).join(' ')}: ${reason}`)).catch(() => {});
      return refused(reason);
    };
    let sent = { argv, stdin };
    if (place.queue === true) {
      const shaped = await queueCall(place, argv, stdin);
      if (shaped?.ok !== true) return turnedDown(`Wheelhouse's broker refused this call: ${shaped?.refused ?? 'the merge queue may not make it'}.`);
      sent = { argv: shaped.argv, stdin: shaped.stdin ?? '' };
    }
    const call = classifyCall(sent.argv, { stdin: sent.stdin, repo: place.repo });
    const context = call.kind === 'other' || call.kind === 'read' ? {} : await permit(place.project, call);
    const decision = brokerDecision(call, context);
    if (!decision.allow) return turnedDown(decision.reason);
    const result = await forward(place.project, sent.argv, { cwd, stdin: sent.stdin });
    return { ok: true, code: Number.isInteger(result?.code) ? result.code : 1, stdout: String(result?.stdout ?? ''), stderr: String(result?.stderr ?? '') };
  }

  // Brings the project's fetch mirror up to date, the helper fetching with its own key. The answer carries nothing more.
  async function refreshMirror({ cwd } = {}) {
    const place = placeOf(cwd);
    if (!place) return { ok: false, refused: 'the request came from a folder that isn\'t a registered project\'s' };
    const done = await refresh(place.project);
    return done?.ok === true ? { ok: true } : { ok: false, refused: done?.refused ?? 'the fetch mirror wasn\'t brought up to date' };
  }

  return { '/broker/gh': gh, '/broker/refresh': refreshMirror };
}
