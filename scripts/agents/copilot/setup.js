// scripts/agents/copilot/setup.js
// What setup does on a computer that runs Copilot (design section 8, part 11): the hook file and the First Mate's agent and
// instructions in the person's Copilot home, the check that Copilot is signed in, and the plan and allowance read from the
// GitHub account.
//
// The hook file is registered once per computer (adapters/copilot/hooks.js). Setup records it in the journal as a file
// change, with the text it held before, so uninstall puts the computer back as it was, and only while the file still
// holds what setup wrote. Sign-in is the director's own step (Copilot's device sign-in): setup looks for the keys of
// Copilot's config and never reads or keeps their values. The account is read through `gh api /copilot_internal/user`
// with the director's existing sign-in, and the reading is kept as the usage store's account reading, which the month's
// allowance already goes by (scripts/agents/copilot/usage.js). The `copilotPlan` setting is the director's own, kept in
// their profile, which only the helper writes; setup says what the account shows and leaves the setting.
import fs from 'node:fs';
import path from 'node:path';
import hooks, { copilotHome } from '../../../adapters/copilot/hooks.js';
import { SIGN_IN_KEYS, readCopilotConfig } from '../../../adapters/copilot/session-home.js';
import { readJournal, addChanges, newId } from '../../setup/journal.js';
import { accountOf, recordAccount, DEFAULT_ALLOWANCE } from './usage.js';
import { FIRST_MATE_DIR, FIRST_MATE_FILES } from './first-mate.js';

export const LABEL = 'Copilot';
export const ACCOUNT_TIMEOUT_MS = 20 * 1000;
// How long the sign-in step waits before it looks again.
export const SIGN_IN_WAIT_MS = 30 * 1000;
export const SIGN_IN_WHY = "Copilot isn't signed in on this computer. Sign in with `copilot login` (GitHub's device sign-in, which only you can finish), and setup goes on once it has.";
export const HOOKS_LINE = "Copilot's checks before each of its actions, as one hook file in your Copilot folder";
export const FIRST_MATE_LINE = "Wheelhouse's First Mate for Copilot's chat, as an agent file and an instructions file in your Copilot folder, which is there for every project on this computer (they say to apply only in a Wheelhouse project)";

const isRecord = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);

function textOf(file) {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch {
    return null;
  }
}

// Whether the Copilot home holds a sign-in: a config.json with at least one of the sign-in keys. Only the key names are
// looked at. The home is `home`, else COPILOT_HOME or ~/.copilot as `env` and `userHome` give it.
export function signedIn({ env = process.env, userHome, home = copilotHome({ env, homedir: userHome }) } = {}) {
  const text = textOf(path.join(home, 'config.json'));
  if (text === null) return false;
  try {
    const config = readCopilotConfig(text);
    return isRecord(config) && SIGN_IN_KEYS.some((key) => Object.hasOwn(config, key));
  } catch {
    return false;
  }
}

// The plan class an account reply shows, as the `copilotPlan` setting names it, or null when it can't be told:
// `auto-only` for the free and student plans (the sku starts with "free"), `credits` for a paid plan on usage-based
// billing, `requests` for one still on premium requests.
export function planOf(reply) {
  if (!isRecord(reply)) return null;
  if (typeof reply.access_type_sku === 'string' && /^free/i.test(reply.access_type_sku)) return 'auto-only';
  if (reply.token_based_billing === true) return 'credits';
  if (reply.token_based_billing === false) return 'requests';
  return null;
}

// The account's reading, from `run('gh', ['api', '/copilot_internal/user'])`: { plan, allowance, account } where `account` is the usage
// store's reading (accountOf) or null, and `plan` and `allowance` are null where the reply doesn't show them. Never
// throws: a computer with no gh, no sign-in or no answer gives nulls, and the defaults stand.
export async function readAccount({ run, at = new Date(), env = process.env } = {}) {
  const none = { plan: null, allowance: null, account: null };
  let reply;
  try {
    // The path is written out here so the gh-call scan in tests/scripts/lib/safe-git-lists.test.js can match its row.
    const got = await run('gh', ['api', '/copilot_internal/user'], { timeoutMs: ACCOUNT_TIMEOUT_MS, baseEnv: env });
    if (got?.code !== 0) return none;
    reply = JSON.parse(String(got.stdout ?? ''));
  } catch {
    return none;
  }
  const account = accountOf(reply, at);
  return { plan: planOf(reply), allowance: account?.entitlement ?? null, account };
}

// What the account reading says, in a line for the director.
export function accountLine({ plan, allowance }) {
  if (plan === null && allowance === null) return `The Copilot plan couldn't be read from your GitHub account, so Wheelhouse goes by the default: Auto only, ${DEFAULT_ALLOWANCE} requests a month.`;
  const kind = { 'auto-only': 'Auto only, counted in requests', credits: 'model choice, billed in AI credits', requests: 'model choice, counted in premium requests' }[plan];
  const parts = [kind, allowance === null ? null : `${allowance} requests a month`].filter(Boolean);
  const set = plan !== null && plan !== 'auto-only' ? ` Its plan setting is Auto only until you change it to match; ask the First Mate.` : '';
  return `Your GitHub account shows a Copilot plan with ${parts.join(', ')}.${set}`;
}

// The First Mate's files as the Wheelhouse folder `root` holds them (adapters/copilot/first-mate/, kept equal to the build by
// a test), each with where it goes in the Copilot home `home`: [{ target, content }]. A file the folder lacks is left out.
// The home's agents/ and instructions/ folders are where Copilot's CLI and VS Code's chat read a person's agents and
// instructions (checks 55, 61 and 70).
function firstMateFiles({ home, root, read }) {
  const out = [];
  for (const file of FIRST_MATE_FILES) {
    const text = root === undefined ? null : read(path.join(root, ...FIRST_MATE_DIR.split('/'), ...file.split('/')));
    if (text !== null) out.push({ target: path.join(home, ...file.split('/')), content: text.replaceAll('\r\n', '\n') });
  }
  return out;
}

// The changes setup makes on this computer for Copilot: the hook file and the First Mate's files, each unless it already
// holds what Wheelhouse writes. `node` is the Node.js that runs setup and `root` the Wheelhouse folder. The First Mate's
// files share one line on the plan; a file of the person's own at one of their paths is replaced, and the journal holds
// it first (applyComputer).
export function computerChanges({ env = process.env, userHome, platform = process.platform, node = process.execPath, root, read = textOf } = {}) {
  const home = copilotHome({ env, homedir: userHome });
  const out = [];
  const target = hooks.file({ home });
  const content = hooks.registrationText({ node, root, platform });
  if (read(target) !== content) out.push({ kind: 'file', part: 'hooks', target, what: 'agent', label: LABEL, line: HOOKS_LINE, home, content, node, root, platform });
  const mate = firstMateFiles({ home, root, read }).filter((f) => read(f.target) !== f.content);
  mate.forEach((f, i) => out.push({ kind: 'file', part: 'first-mate', target: f.target, what: 'agent', label: LABEL, line: i === 0 ? FIRST_MATE_LINE : null, home, content: f.content }));
  return out;
}

// A whole file written by a temporary file and a rename, its folders made first.
function writeWhole(target, content) {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const temp = `${target}.${process.pid}.tmp`;
  try {
    fs.writeFileSync(temp, content);
    fs.renameSync(temp, target);
  } finally {
    fs.rmSync(temp, { force: true });
  }
}

// Makes the changes: each file is written (a whole file, by a temporary file and a rename), recorded in the journal
// first with the text it held before. `record` takes a journal change; `newId` makes its id.
export function applyComputer(changes, { record, newId }) {
  for (const c of changes) {
    record({ id: newId('chg'), kind: 'file', target: c.target, before: textOf(c.target), after: c.content });
    if (c.part === 'first-mate') writeWhole(c.target, c.content);
    else hooks.writeRegistration({ home: c.home, node: c.node, root: c.root, platform: c.platform });
  }
}

// The setup run whose journal holds the hook file's last change, with that change, or null when none does.
function runHolding(target, journal) {
  const runs = Array.isArray(journal?.runs) ? journal.runs : [];
  for (const run of [...runs].reverse()) {
    const change = [...(run.changes ?? [])].reverse().find((c) => c?.kind === 'file' && c.target === target);
    if (change !== undefined) return { run, change };
  }
  return null;
}

// After an update: where the hook file setup made names another Wheelhouse folder (or Node.js) than the new release's, it
// is written again for `root`, and so is each First Mate file whose text the new release changed; each rewrite is recorded
// in the same setup run's journal, so uninstall still takes the file out (or puts back what it held before setup). A file
// setup did not make, or one changed since setup, is left as it is and said so. A computer with none of the files is left
// alone. Resolves the lines to say as one text, or null when nothing changed.
export function refresh({
  env = process.env, userHome, platform = process.platform, node = process.execPath, root, read = textOf, journal = readJournal, add = addChanges,
} = {}) {
  const home = copilotHome({ env, homedir: userHome });
  const said = [];
  // `write` puts the new text in place once the journal holds the change; `what` names the file in the line for a file left
  // as it is, and `done` is the line for one rewritten.
  const redo = (target, content, what, done, write) => {
    const there = read(target);
    if (there === null || there === content) return;
    const held = runHolding(target, journal());
    if (held === null || held.change.after !== there) {
      said.push(`${what} in ${home} isn't the one setup wrote, so it was left as it is; run setup again to write it.`);
      return;
    }
    try {
      add(held.run.id, [{ id: newId('chg'), step: held.change.step, kind: 'file', target, before: there, after: content }]);
      write();
      said.push(done);
    } catch (error) {
      said.push(`${what} in ${home} could not be updated (${String(error?.message ?? error).replace(/\s+/g, ' ')}); run setup again to write it.`);
    }
  };
  const hookTarget = hooks.file({ home });
  const hookText = hooks.registrationText({ node, root, platform });
  redo(hookTarget, hookText, "Copilot's hook file", "Copilot's hook file now points at the new release.", () => hooks.writeRegistration({ home, node, root, platform }));
  for (const f of firstMateFiles({ home, root, read })) redo(f.target, f.content, `The First Mate's file ${path.basename(f.target)}`, `The First Mate's file ${path.basename(f.target)} now matches the new release.`, () => writeWhole(f.target, f.content));
  return said.length === 0 ? null : said.join(' ');
}

// After the hook file: reads the account and keeps the reading. Resolves the line to say. Keeping the reading is the one
// write; it is the usage store's own file, in Wheelhouse's home.
export async function afterApply({ run, at, env, keep = recordAccount }) {
  const got = await readAccount({ run, at, env });
  if (got.account !== null) {
    try { keep(got.account); } catch { /* the line below still says what was read */ }
  }
  return accountLine(got);
}

export default Object.freeze({ label: LABEL, signedIn, computerChanges, applyComputer, afterApply, refresh, SIGN_IN_WAIT_MS, SIGN_IN_WHY });
