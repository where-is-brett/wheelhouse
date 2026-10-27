// scripts/runbook/runbook.js
// The runbook's one command (design section 12.7): `node runbook.js <step> ...`
// asks the host helper to do a step and prints its plain answer. It is the only
// Bash command STOP lets through, so it checks its arguments strictly before it
// asks anything, and the helper checks them again. Each step but the first also
// needs the director's click on its card (a signed `action` event), which the
// helper looks for; this script cannot supply one.
//
//   node runbook.js 1                  turn STOP on
//   node runbook.js 2                  cut the agents' access to the host
//   node runbook.js 3 <commit>         open the pull request that puts the product back to that release
//   node runbook.js 3 merge <number>   merge that pull request (STOP lets only this one through)
//   node runbook.js 4                  retired: says that no backup of the records is kept
//   node runbook.js 5                  run the project's own containment command
//
// What the host's documentation says about step 2 (read 18 October 2026), and
// which parts only the director can do:
//
//   GitLab, with the key itself. "Any token can use" DELETE /personal_access_tokens/self,
//   which revokes the token that signs the request, so the helper revokes the
//   project key with the key and then deletes its file. The project access
//   token page documents only DELETE /projects/:id/access_tokens/:token_id,
//   which needs the token's number and has no self form; it names no self-revoke
//   for a project key, so a refusal is possible (for example on an older GitLab)
//   and then the file is kept and the director revokes the key by hand.
//     https://docs.gitlab.com/api/personal_access_tokens/
//     https://docs.gitlab.com/api/project_access_tokens/
//   GitLab, with the director's sign-in (the quick connection). Only the director
//   can revoke it: <GitLab address>/-/user_settings/applications.
//
//   GitHub, narrow. An installation is suspended by the app's owner or managers
//   through the API, or by whoever installed it, in the web interface only;
//   the app's own keys are not documented as able to suspend or uninstall
//   it. The director does it: Settings, Integrations, Applications, Installed
//   GitHub Apps, Configure, then Suspend or Uninstall (for an organisation:
//   the organisation's Settings, GitHub Apps). Deleting keys/github-app.json is
//   local only: it stops this computer using the keys, and the answer names
//   the installation's settings page, https://github.com/settings/installations/<id>.
//     https://docs.github.com/en/apps/maintaining-github-apps/suspending-a-github-app-installation
//     https://docs.github.com/en/apps/using-github-apps/reviewing-and-modifying-installed-github-apps
//   GitHub, with the director's sign-in (the quick connection). Only the director
//   can revoke it: https://github.com/settings/applications.
import path from 'node:path';
import { helperClient } from '../host/helper-client.js';
import { startedAsScript } from '../lib/started-as-script.js';

export const USAGE = 'Usage: node runbook.js <step 1 to 5>; for step 3 give the commit (12 or 40 hex characters) or "merge <pull request number>"';

const HEX12 = /^[0-9a-f]{12}$/;
const HEX40 = /^[0-9a-f]{40}$/;
const WHOLE = /^[1-9][0-9]{0,8}$/;

// The arguments, strictly: nothing else is understood.
export function parseArgs(argv) {
  const bad = { ok: false };
  if (!Array.isArray(argv) || argv.length < 1 || !/^[1-5]$/.test(argv[0])) return bad;
  const step = Number(argv[0]);
  const rest = argv.slice(1);
  if (step !== 3) return rest.length === 0 ? { ok: true, step } : bad;
  if (rest.length === 1 && (HEX12.test(rest[0]) || HEX40.test(rest[0]))) return { ok: true, step, sha: rest[0] };
  if (rest.length === 2 && rest[0] === 'merge' && WHOLE.test(rest[1])) return { ok: true, step, merge: Number(rest[1]) };
  return bad;
}

function said(answer) {
  const text = answer?.ok === true ? (answer.message ?? 'Done.') : (answer?.refused ?? answer?.message ?? 'The step did not go through.');
  const more = [];
  if (answer?.url) more.push(`Page: ${answer.url}`);
  if (answer?.ok === true && answer?.output) more.push(`The command said: ${answer.output}`);
  return [text, ...more].join('\n');
}

// Runs one step. Resolves with `{ code, text }`; never throws.
export async function runbook({ argv, cwd = path.resolve(process.cwd()), client = helperClient() } = {}) {
  const args = parseArgs(argv);
  if (!args.ok) return { code: 1, text: USAGE };
  try {
    if (args.step === 1) {
      const answer = await client.stop({});
      return { code: answer?.ok === true ? 0 : 1, text: answer?.ok === true ? 'STOP is on. Nothing more is written to the host until the director lifts it.' : said(answer) };
    }
    // Inside the sandbox ~/.wheelhouse cannot be read, so the helper places the project from the folder.
    const base = { cwd };
    let answer;
    if (args.step === 2) answer = await client.runbook.cutAccess(base);
    else if (args.step === 4) answer = await client.runbook.restoreState(base);
    else if (args.step === 5) answer = await client.runbook.contain(base);
    else if (args.merge !== undefined) answer = await client.runbook.restoreMerge({ ...base, number: args.merge });
    else {
      let sha = args.sha;
      if (sha.length === 12) {
        const listed = await client.runbook.candidates(base);
        if (listed?.ok !== true) return { code: 1, text: said(listed) };
        sha = listed.candidates.find((c) => c.sha12 === args.sha)?.sha;
        if (!sha) return { code: 1, text: 'That commit is not among the last ten merges. Give its full 40-character commit instead.' };
      }
      answer = await client.runbook.restoreMain({ ...base, sha });
    }
    return { code: answer?.ok === true ? 0 : 1, text: said(answer) };
  } catch {
    return { code: 1, text: 'The runbook could not ask the helper.' };
  }
}

if (startedAsScript(import.meta.url)) {
  const { code, text } = await runbook({ argv: process.argv.slice(2) });
  (code === 0 ? process.stdout : process.stderr).write(`${text}\n`);
  process.exitCode = code;
}
