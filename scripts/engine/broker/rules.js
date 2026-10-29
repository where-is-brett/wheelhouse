// scripts/engine/broker/rules.js
// The broker's rules (Archon design, section 12.4). The broker is the only gh on Archon's PATH: it sends each call to
// the helper, which sorts it by this list and decides. The list is check 76's: every gh call Archon's merge queue
// made, plus the pull request's own calls. Reads pass. Pushes, pull-request creation and comments pass under the push
// rules: never the default branch, the lock held, All stop off. A comment, or a pull request's text edited, that reads
// as the merge queue's verdict passes only with a signed CLEAN review of that head. A merge passes only with the permit. Anything not on the list
// is refused, with a plain reason, and never forwarded.
import { reviewCounts, approvalCounts, incidentReason } from '../../gate/conditions.js';

// gh's global flags that take a value, skipped when finding the command.
const GLOBAL_WITH_VALUE = new Set(['-R', '--repo', '--hostname']);
// The merge queue's verdict comment carries this marker (check 76).
const VERDICT_MARK = '<!-- archon-review-report -->';
const FULL_SHA = /^[0-9a-f]{40}$/;

// The call's words without gh's global flags and their values.
function commandOf(argv) {
  const words = [];
  for (let i = 0; i < argv.length; i += 1) {
    const word = String(argv[i]);
    if (GLOBAL_WITH_VALUE.has(word)) { i += 1; continue; }
    if (/^--(repo|hostname)=/.test(word)) continue;
    words.push(word);
  }
  return words;
}

// The value of a flag given as `--name value` or `--name=value`, or null.
function flag(words, ...names) {
  for (let i = 0; i < words.length; i += 1) {
    for (const name of names) {
      if (words[i] === name) return words[i + 1] ?? null;
      if (words[i].startsWith(`${name}=`)) return words[i].slice(name.length + 1);
    }
  }
  return null;
}

// The fields of a gh api call (-f, -F, --field, --raw-field), as { name: value }.
function fieldsOf(words) {
  const fields = {};
  for (let i = 0; i < words.length; i += 1) {
    const raw = /^(-f|-F|--field|--raw-field)$/.test(words[i]) ? words[i + 1] : /^--(raw-)?field=(.*)$/s.exec(words[i])?.[2];
    if (typeof raw !== 'string') continue;
    const at = raw.indexOf('=');
    if (at > 0) fields[raw.slice(0, at)] = raw.slice(at + 1);
  }
  return fields;
}

function apiMethod(words) {
  const given = flag(words, '-X', '--method');
  if (given) return given.toUpperCase();
  const glued = words.find((w) => /^-X[A-Za-z]+$/.test(w));
  if (glued) return glued.slice(2).toUpperCase();
  // gh api sends a POST when a field or an input is given and no method is.
  return words.some((w) => /^(-f|-F|--field|--raw-field|--input)$/.test(w) || /^--(raw-)?field=/.test(w)) ? 'POST' : 'GET';
}

// The path of a gh api call, without a leading slash or its query.
function apiPath(words) {
  const skip = new Set(['-X', '--method', '-f', '-F', '--field', '--raw-field', '--input', '--jq', '-q', '-H', '--header', '--template', '-t', '--cache']);
  for (let i = 1; i < words.length; i += 1) {
    if (skip.has(words[i])) { i += 1; continue; }
    if (!words[i].startsWith('-')) return words[i].replace(/^\//, '');
  }
  return '';
}

// The commit a verdict comment's body names, or null; '' when the body isn't a verdict.
function verdictHead(body) {
  if (typeof body !== 'string' || !body.includes(VERDICT_MARK)) return '';
  const sha = /Reviewed commit:\s*`?([0-9a-f]{40})`?/.exec(body)?.[1];
  return sha ?? null;
}

const number = (text) => (/^\d+$/.test(String(text ?? '')) ? Number(text) : null);
const repoPath = String.raw`repos/[^/\s]+/[^/\s]+`;

// The allow list: each entry its name, its kind and a test of the call's words (with `api` its method and path).
// `body(words, ctx)` gives a comment's text where its kind turns on it.
export const BROKER_ALLOW = Object.freeze([
  { name: 'GraphQL query', kind: 'read', test: (w) => w[0] === 'api' && apiPath(w) === 'graphql' && /^\s*(query\b|\{)/.test(fieldsOf(w).query ?? '') },
  { name: 'issue or pull request comments, read', kind: 'read', test: (w, m, p) => w[0] === 'api' && m === 'GET' && new RegExp(`^${repoPath}/issues/\\d+/comments(\\?.*)?$`).test(p) },
  { name: 'commit checks and status, read', kind: 'read', test: (w, m, p) => w[0] === 'api' && m === 'GET' && new RegExp(`^${repoPath}/commits/[0-9A-Za-z]+/(check-runs|status)(\\?.*)?$`).test(p) },
  { name: 'pull request, read', kind: 'read', test: (w) => w[0] === 'pr' && ['view', 'list', 'checks', 'diff', 'status'].includes(w[1]) },
  { name: 'workflow runs, read', kind: 'read', test: (w) => w[0] === 'run' && ['list', 'view'].includes(w[1]) },
  { name: 'issue, read', kind: 'read', test: (w) => w[0] === 'issue' && ['view', 'list'].includes(w[1]) },
  { name: 'repository, read', kind: 'read', test: (w) => w[0] === 'repo' && w[1] === 'view' },
  { name: 'pull request, create', kind: 'create', test: (w) => w[0] === 'pr' && w[1] === 'create' },
  { name: 'pull request text, edit', kind: 'comment', test: (w) => w[0] === 'pr' && w[1] === 'edit' && w.every((x) => !/^--(add|remove)-(label|reviewer|assignee)/.test(x)) },
  { name: 'pull request, comment', kind: 'comment', test: (w) => w[0] === 'pr' && w[1] === 'comment' },
  { name: 'comment, edit', kind: 'comment', test: (w, m, p) => w[0] === 'api' && m === 'PATCH' && new RegExp(`^${repoPath}/issues/comments/\\d+$`).test(p) },
  { name: 'branch, update', kind: 'push', test: (w, m, p) => w[0] === 'api' && ['PATCH', 'POST'].includes(m) && new RegExp(`^${repoPath}/git/refs(/heads/.+)?$`).test(p) },
  { name: 'pull request, merge', kind: 'merge', test: (w) => w[0] === 'pr' && w[1] === 'merge' },
  { name: 'pull request, merge by REST', kind: 'merge', test: (w, m, p) => w[0] === 'api' && m === 'PUT' && new RegExp(`^${repoPath}/pulls/\\d+/merge$`).test(p) },
]);

// What a gh call is: { kind, name?, pr?, sha?, branch? }, with kind read, push, create, comment, verdict, merge or other.
// `stdin` is the call's standard input, for a body sent that way.
export function classifyCall(argv, { stdin = '' } = {}) {
  const words = commandOf(Array.isArray(argv) ? argv : []);
  const method = words[0] === 'api' ? apiMethod(words) : null;
  const target = words[0] === 'api' ? apiPath(words) : '';
  const entry = BROKER_ALLOW.find((e) => e.test(words, method, target));
  if (!entry) return { kind: 'other', words: words.slice(0, 3) };
  const call = { kind: entry.kind, name: entry.name };
  if (entry.kind === 'merge') {
    if (words[0] === 'pr') {
      call.pr = number(words.slice(2).find((w) => !w.startsWith('-')));
      call.sha = flag(words, '--match-head-commit');
    } else {
      call.pr = number(/pulls\/(\d+)\/merge$/.exec(target)?.[1]);
      call.sha = fieldsOf(words).sha ?? null;
    }
  }
  if (entry.kind === 'create') {
    call.branch = flag(words, '--head', '-H');
  }
  if (entry.kind === 'push') {
    call.branch = /git\/refs\/heads\/(.+)$/.exec(target)?.[1] ?? fieldsOf(words).ref?.replace(/^refs\/heads\//, '') ?? null;
  }
  if (entry.kind === 'comment') {
    let body = flag(words, '--body', '-b');
    if (body === null && (flag(words, '--body-file', '-F') === '-' || words.includes('--input'))) {
      body = stdin;
      try { body = JSON.parse(stdin)?.body ?? stdin; } catch { /* plain text */ }
    }
    const head = verdictHead(body);
    if (head !== '') {
      call.kind = 'verdict';
      call.sha = head;
      call.pr = words[0] === 'pr' ? number(words[2]) : null;
    }
  }
  return call;
}

const refuse = (reason) => ({ allow: false, reason: `Wheelhouse's broker refused this call: ${reason}.` });

// Whether the call passes. `ctx`: { stop, lockHeld, defaultBranch, incident, enrolled, review (the signed review of
// the call's head, or null), approval (the director's signed approval of it, or null), shownFirst, level, guardrail }.
export function brokerDecision(call, ctx = {}) {
  if (!call || call.kind === 'other') {
    const named = Array.isArray(call?.words) && call.words.length > 0 ? ` (gh ${call.words.join(' ')})` : '';
    return refuse(`the call${named} isn't on Wheelhouse's list of the calls the engine may make`);
  }
  if (call.kind === 'read') return { allow: true };
  if (ctx.stop !== false) return refuse('All stop is on');
  if (ctx.lockHeld !== true) return refuse('this computer doesn\'t hold the project\'s lock');
  if (call.kind === 'push' || call.kind === 'create') {
    const branch = call.branch ?? null;
    if (branch === null || branch === ctx.defaultBranch || ['main', 'master'].includes(branch)) return refuse('a push or a pull request is never the default branch\'s');
    return { allow: true };
  }
  if (call.kind === 'comment') return { allow: true };
  const head = call.sha;
  if (!FULL_SHA.test(head ?? '')) return refuse(call.kind === 'merge' ? 'the merge names no head commit' : 'the verdict names no reviewed commit');
  const reviewed = reviewCounts(ctx.review, head, ctx.enrolled);
  if (call.kind === 'verdict') return reviewed ? { allow: true } : refuse(`there is no signed CLEAN review of ${head.slice(0, 7)}`);
  // A merge: the permit.
  const incident = incidentReason(ctx.incident);
  if (incident) return refuse(incident);
  if (!reviewed) return refuse(`there is no signed CLEAN review of ${head.slice(0, 7)}`);
  const needsApproval = ctx.shownFirst === true || ctx.level === 4 || ctx.guardrail === true;
  if (needsApproval && !approvalCounts(ctx.approval, head, ctx.enrolled)) return refuse(`the director's approval of ${head.slice(0, 7)} isn't signed`);
  return { allow: true };
}
