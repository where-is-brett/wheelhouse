// scripts/engine/broker/routes.js
// The helper's broker routes (Archon design, section 12.4): /broker/gh takes each gh call Archon makes, sorts it by
// the broker's list and decides it with the rules (rules.js); a call that passes runs as the real gh with the
// project's connection, and its output goes back unchanged. /broker/credential answers git's credential helper for
// the project's own repository. Both place the project by the folder the call came from. They know the helper only
// through what it gives them:
//   placeOf(cwd)                          { project, folder, repo } of the registered project holding the folder, or null
//   permit(project, call)                 the rules' context for the call (rules.js brokerDecision)
//   forward(project, argv, { cwd, stdin })  runs the real gh: { code, stdout, stderr }
//   credential(project)                   { username, password } for the project's host, or null
import { classifyCall, brokerDecision } from './rules.js';

const refused = (reason) => ({ ok: true, code: 1, stdout: '', stderr: `${reason}\n` });

// The fields of git's credential request text, as { protocol, host, path }.
function requestOf(text) {
  const fields = {};
  for (const line of String(text ?? '').split(/\r?\n/)) {
    const at = line.indexOf('=');
    if (at > 0) fields[line.slice(0, at)] = line.slice(at + 1);
  }
  return fields;
}

export function brokerRoutes({ placeOf, permit, forward, credential } = {}) {
  async function gh({ argv, cwd, stdin = '' } = {}) {
    if (!Array.isArray(argv) || !argv.every((a) => typeof a === 'string')) return refused("Wheelhouse's broker was sent a call it can't read.");
    const place = placeOf(cwd);
    if (!place) return refused("Wheelhouse's broker refused this call: it came from a folder that isn't a registered project's.");
    if (typeof place.repo !== 'string' || place.repo === '') return refused("Wheelhouse's broker refused this call: the project's repository isn't known.");
    const call = classifyCall(argv, { stdin, repo: place.repo });
    const context = call.kind === 'other' || call.kind === 'read' ? {} : await permit(place.project, call);
    const decision = brokerDecision(call, context);
    if (!decision.allow) return refused(decision.reason);
    const result = await forward(place.project, argv, { cwd, stdin });
    return { ok: true, code: Number.isInteger(result?.code) ? result.code : 1, stdout: String(result?.stdout ?? ''), stderr: String(result?.stderr ?? '') };
  }

  // Answers git's `get` for the project's own repository on its host, and nothing else.
  async function gitCredential({ cwd, action, request } = {}) {
    if (action !== 'get') return { ok: false, refused: 'the broker only answers a credential request' };
    const place = placeOf(cwd);
    if (!place) return { ok: false, refused: 'the request came from a folder that isn\'t a registered project\'s' };
    const asked = requestOf(request);
    if (asked.protocol !== 'https' || asked.host !== 'github.com') return { ok: false, refused: 'the broker answers only for the project\'s host' };
    // git names the repository only with credential.useHttpPath, which the helper's git setting turns on; a request
    // that names none is refused, never answered for whatever repository it is.
    if (typeof asked.path !== 'string' || asked.path.replace(/\.git$/, '').toLowerCase() !== String(place.repo).toLowerCase()) {
      return { ok: false, refused: 'the broker answers only for the project\'s own repository' };
    }
    const given = await credential(place.project);
    return given ? { ok: true, username: given.username, password: given.password } : { ok: false, refused: 'the project has no connection to give' };
  }

  return { '/broker/gh': gh, '/broker/credential': gitCredential };
}
