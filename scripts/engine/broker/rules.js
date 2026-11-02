// scripts/engine/broker/rules.js
// The broker's rules (Archon design, section 12.4). The broker is the only gh on Archon's PATH: it sends each call to
// the helper, which sorts it by this list and decides. The list is check 76's: every gh call Archon's merge queue
// made, plus the pull request's own calls. Reads pass. Pushes, pull-request creation and comments pass under the push
// rules: never the default branch, the lock held, All stop off. A comment, or a pull request's text edited, that reads
// as the merge queue's verdict passes only with a signed CLEAN review of that head. A merge passes only with the permit. Anything not on the list
// is refused, with a plain reason, and never forwarded.
import { reviewCounts, approvalCounts, incidentReason, checkCounts } from '../../gate/conditions.js';
import { NO_HOST_APPROVAL } from '../../host/host-approval.js';

// The merge queue's verdict comment carries this marker (check 76).
const VERDICT_MARK = '<!-- archon-review-report -->';
const FULL_SHA = /^[0-9a-f]{40}$/;
const HOST = 'github.com';
export const NO_HOST = 'this project has no code host';
// A branch name the broker lets a call write to: plain characters, no `..`, never a ref outside refs/heads.
const BRANCH = /^(?!.*\.\.)(?!.*\/\/)[A-Za-z0-9][A-Za-z0-9._/-]{0,199}$/;
const NUMBER = /^[1-9]\d{0,9}$/;

// The flags each call may carry, and gh's spelling of each: a flag that takes a value, or one that doesn't. The
// broker reads a call the way gh does, so a flag it doesn't know, a short flag glued to its value, `--` or a repeated
// flag that isn't a list is refused, never guessed at (review B1 and H1 of part 3b).
const VALUE = 'value';
const BOOL = 'bool';
const LIST = 'list';
const READ_OUT = { '--json': VALUE, '-q': VALUE, '--jq': VALUE, '-t': VALUE, '--template': VALUE };
const SPECS = {
  api: {
    '-X': VALUE, '--method': VALUE, '-f': LIST, '--raw-field': LIST, '-F': LIST, '--field': LIST, '--input': VALUE,
    '-H': LIST, '--header': LIST, '-q': VALUE, '--jq': VALUE, '-t': VALUE, '--template': VALUE, '--paginate': BOOL,
    '--slurp': BOOL, '-i': BOOL, '--include': BOOL, '--silent': BOOL, '--cache': VALUE, '--hostname': VALUE,
  },
  'pr view': { ...READ_OUT, '-c': BOOL, '--comments': BOOL },
  'pr list': { ...READ_OUT, '-s': VALUE, '--state': VALUE, '-H': VALUE, '--head': VALUE, '-B': VALUE, '--base': VALUE, '-L': VALUE, '--limit': VALUE, '-S': VALUE, '--search': VALUE, '-l': LIST, '--label': LIST, '-A': VALUE, '--author': VALUE },
  'pr checks': { ...READ_OUT, '--required': BOOL, '--watch': BOOL, '-i': VALUE, '--interval': VALUE, '--fail-fast': BOOL },
  'pr diff': { '--name-only': BOOL, '--patch': BOOL, '--color': VALUE },
  'pr status': { ...READ_OUT, '-c': BOOL, '--conflict-status': BOOL },
  'pr create': { '-t': VALUE, '--title': VALUE, '-b': VALUE, '--body': VALUE, '-F': VALUE, '--body-file': VALUE, '-H': VALUE, '--head': VALUE, '-B': VALUE, '--base': VALUE, '-d': BOOL, '--draft': BOOL },
  'pr edit': { '-t': VALUE, '--title': VALUE, '-b': VALUE, '--body': VALUE, '-F': VALUE, '--body-file': VALUE },
  'pr comment': { '-b': VALUE, '--body': VALUE, '-F': VALUE, '--body-file': VALUE },
  'pr merge': { '-s': BOOL, '--squash': BOOL, '-m': BOOL, '--merge': BOOL, '-r': BOOL, '--rebase': BOOL, '--match-head-commit': VALUE, '-d': BOOL, '--delete-branch': BOOL, '-t': VALUE, '--subject': VALUE, '-b': VALUE, '--body': VALUE, '-F': VALUE, '--body-file': VALUE },
  'run list': { ...READ_OUT, '-b': VALUE, '--branch': VALUE, '-L': VALUE, '--limit': VALUE, '-w': VALUE, '--workflow': VALUE, '-s': VALUE, '--status': VALUE, '-c': VALUE, '--commit': VALUE, '-e': VALUE, '--event': VALUE },
  // A re-run of a run's failed jobs: the fix-main lane's cheapest fix (section 7.7). Only --failed is taken.
  'run rerun': { '--failed': BOOL },
  'run view': { ...READ_OUT, '--log': BOOL, '--log-failed': BOOL, '-j': VALUE, '--job': VALUE, '-a': VALUE, '--attempt': VALUE, '--exit-status': BOOL, '-v': BOOL, '--verbose': BOOL },
  'issue view': { ...READ_OUT, '-c': BOOL, '--comments': BOOL },
  'issue list': { ...READ_OUT, '-s': VALUE, '--state': VALUE, '-L': VALUE, '--limit': VALUE, '-l': LIST, '--label': LIST, '-S': VALUE, '--search': VALUE, '-A': VALUE, '--author': VALUE },
  'repo view': { ...READ_OUT },
};
// Every command but `api` and `repo view` may name its repository; `--hostname` is api's own.
const REPO_FLAGS = { '-R': VALUE, '--repo': VALUE };
// Short and long spellings of one flag, so a value given twice under both is seen as given twice.
const SAME = [
  ['-X', '--method'], ['-f', '--raw-field'], ['-F', '--field'], ['-H', '--header'], ['-q', '--jq'], ['-t', '--template'],
  ['-i', '--include'], ['-R', '--repo'], ['-c', '--comments'], ['-s', '--state'], ['-L', '--limit'], ['-S', '--search'],
  ['-l', '--label'], ['-A', '--author'], ['-b', '--body'], ['-d', '--draft'], ['-m', '--merge'], ['-r', '--rebase'],
  ['-j', '--job'], ['-a', '--attempt'], ['-v', '--verbose'], ['-w', '--workflow'], ['-e', '--event'],
];

// The call's words read against `spec`: { flags: { [long name]: [values] }, positionals }, or null when gh would read
// them differently. A short name is kept under its long one where `SAME` pairs them for the command.
function parseWords(words, spec) {
  const flags = {};
  const positionals = [];
  const canonical = (name) => {
    const pair = SAME.find((p) => p.includes(name) && p.every((n) => spec[n] !== undefined));
    return pair ? pair[1] : name;
  };
  for (let i = 0; i < words.length; i += 1) {
    const word = words[i];
    if (word === '--') return null;
    if (!word.startsWith('-') || word === '-') { positionals.push(word); continue; }
    let name = word;
    let value;
    if (word.startsWith('--') && word.includes('=')) {
      name = word.slice(0, word.indexOf('='));
      value = word.slice(word.indexOf('=') + 1);
    }
    const kind = spec[name];
    if (kind === undefined) return null;
    if (kind === BOOL) {
      if (value !== undefined) return null;
      value = true;
    } else if (value === undefined) {
      if (i + 1 >= words.length) return null;
      value = words[i += 1];
    }
    const key = canonical(name);
    if (flags[key] && kind !== LIST) return null;
    (flags[key] ??= []).push(value);
  }
  return { flags, positionals };
}
const one = (parsed, name) => parsed.flags[name]?.[0];

// A repository named as gh takes it (`owner/name`, `host/owner/name` or its address) as `owner/name`, or null.
function repoOf(text) {
  const plain = String(text).replace(/^https:\/\//, '').replace(/\.git$/, '');
  const parts = plain.split('/');
  if (parts.length === 3 && parts[0].toLowerCase() === HOST) parts.shift();
  return parts.length === 2 && parts.every((p) => /^[A-Za-z0-9._-]+$/.test(p)) ? parts.join('/') : null;
}
// Whether a positional word is no address, or the address of something in `repo` (not checked when not given).
function addressIsOwn(word, repo) {
  if (!/^(https?:\/\/|[^/\s]+\.[a-z]{2,}\/)/i.test(word)) return true;
  const found = /^(?:https?:\/\/)?([^/\s]+)\/([A-Za-z0-9._-]+)\/([A-Za-z0-9._-]+)(?:[/?#]|$)/.exec(word);
  return found !== null && found[1].toLowerCase() === HOST && (!repo || sameRepo(`${found[2]}/${found[3]}`, repo));
}
const sameRepo = (a, b) => typeof a === 'string' && typeof b === 'string' && a.toLowerCase() === b.toLowerCase();

// The fields of an api call (-f, -F), as { name: value }, or null when one is read from a file (`-F name=@file`), is
// given twice, or has no name.
function fieldsOf(parsed) {
  const fields = {};
  for (const [flag, list] of [['--raw-field', parsed.flags['--raw-field'] ?? []], ['--field', parsed.flags['--field'] ?? []]]) {
    for (const raw of list) {
      const at = raw.indexOf('=');
      if (at < 1) return null;
      const name = raw.slice(0, at);
      const value = raw.slice(at + 1);
      if (flag === '--field' && value.startsWith('@')) return null;
      if (Object.hasOwn(fields, name)) return null;
      fields[name] = value;
    }
  }
  return fields;
}

// Whether `text` is one GraphQL query and nothing else: no mutation or subscription anywhere, one operation, which
// is a query (fragments beside it are fine). Strings and comments are taken out first; anything unbalanced is no.
export function isOneQuery(text) {
  if (typeof text !== 'string') return false;
  const bare = text.replace(/"""[\s\S]*?"""/g, '""').replace(/"(?:[^"\\\n]|\\.)*"/g, '""').replace(/#[^\n]*/g, '');
  if (bare.replace(/""/g, '').includes('"') || /\b(mutation|subscription)\b/.test(bare)) return false;
  // Each `{` at the top level opens a definition: a fragment's, after its `fragment` keyword, or an operation's.
  let depth = 0;
  let operations = 0;
  let fragment = false;
  for (const token of bare.match(/[{}]|[A-Za-z_][A-Za-z0-9_]*/g) ?? []) {
    if (token === '{') {
      if (depth === 0) {
        if (fragment) fragment = false;
        else operations += 1;
      }
      depth += 1;
    } else if (token === '}') {
      depth -= 1;
      if (depth < 0) return false;
    } else if (depth === 0 && token === 'fragment') {
      fragment = true;
    }
  }
  return depth === 0 && operations === 1;
}

// The commit a verdict body names, or null when it names none or more than one; '' when the body isn't a verdict.
function verdictHead(body) {
  if (typeof body !== 'string' || !body.includes(VERDICT_MARK)) return '';
  const named = [...body.matchAll(/Reviewed commit:\s*`?([0-9a-fA-F]{7,64})`?/g)].map((m) => m[1]);
  return named.length === 1 && FULL_SHA.test(named[0]) ? named[0] : null;
}

// A comment's text from a --body or --body-file flag (only `-`, standard input, is read), or undefined when it has
// none; null when it names a file.
function bodyOf(parsed, stdin) {
  const file = one(parsed, '--body-file') ?? one(parsed, '-F');
  if (file !== undefined) return file === '-' ? String(stdin ?? '') : null;
  return one(parsed, '--body');
}
// Standard input given to `--input -`, as its JSON body field where it is JSON.
function inputBody(stdin) {
  try {
    const json = JSON.parse(String(stdin ?? ''));
    return typeof json?.body === 'string' ? json.body : String(stdin ?? '');
  } catch {
    return String(stdin ?? '');
  }
}

const repoPath = String.raw`repos/([A-Za-z0-9._-]+/[A-Za-z0-9._-]+)`;
const at = (pattern) => new RegExp(`^${repoPath}/${pattern}$`);

// The allow list: each entry its name, its kind and a test of the call ({ command, parsed, method, path, fields }).
export const BROKER_ALLOW = Object.freeze([
  { name: 'GraphQL query', kind: 'read', test: (c) => c.command === 'api' && c.path === 'graphql' && c.method === 'POST' && c.input === undefined && c.fields && !Object.hasOwn(c.fields, 'operationName') && c.parsed.flags['--raw-field']?.some((f) => f.startsWith('query=')) && isOneQuery(c.fields.query) },
  { name: 'issue or pull request comments, read', kind: 'read', test: (c) => c.command === 'api' && c.method === 'GET' && at(String.raw`issues/\d+/comments`).test(c.path) },
  { name: 'commit checks and status, read', kind: 'read', test: (c) => c.command === 'api' && c.method === 'GET' && at('commits/[0-9A-Za-z]+/(check-runs|status)').test(c.path) },
  { name: 'pull request, read', kind: 'read', test: (c) => ['pr view', 'pr checks', 'pr diff'].includes(c.command) ? c.parsed.positionals.length <= 1 : ['pr list', 'pr status'].includes(c.command) && c.parsed.positionals.length === 0 },
  { name: 'workflow runs, read', kind: 'read', test: (c) => (c.command === 'run view' ? c.parsed.positionals.length <= 1 : c.command === 'run list' && c.parsed.positionals.length === 0) },
  { name: 'issue, read', kind: 'read', test: (c) => (c.command === 'issue view' ? c.parsed.positionals.length === 1 : c.command === 'issue list' && c.parsed.positionals.length === 0) },
  { name: 'repository, read', kind: 'read', test: (c) => c.command === 'repo view' && c.parsed.positionals.length <= 1 },
  { name: 'pull request, create', kind: 'create', test: (c) => c.command === 'pr create' && c.parsed.positionals.length === 0 },
  { name: 'pull request text, edit', kind: 'comment', test: (c) => c.command === 'pr edit' && c.parsed.positionals.length === 1 && NUMBER.test(c.parsed.positionals[0]) },
  { name: 'pull request, comment', kind: 'comment', test: (c) => c.command === 'pr comment' && c.parsed.positionals.length === 1 && NUMBER.test(c.parsed.positionals[0]) },
  { name: 'comment, edit', kind: 'comment', test: (c) => c.command === 'api' && c.method === 'PATCH' && at(String.raw`issues/comments/\d+`).test(c.path) },
  { name: 'branch, update', kind: 'push', test: (c) => c.command === 'api' && ((c.method === 'PATCH' && at('git/refs/heads/.+').test(c.path)) || (c.method === 'POST' && at('git/refs').test(c.path))) },
  { name: 'workflow run, failed jobs again', kind: 'rerun', test: (c) => c.command === 'run rerun' && c.parsed.positionals.length === 1 && NUMBER.test(c.parsed.positionals[0]) && c.parsed.flags['--failed']?.[0] === true },
  { name: 'pull request, merge', kind: 'merge', test: (c) => c.command === 'pr merge' && c.parsed.positionals.length === 1 && NUMBER.test(c.parsed.positionals[0]) },
  { name: 'pull request, merge by REST', kind: 'merge', test: (c) => c.command === 'api' && c.method === 'PUT' && at(String.raw`pulls/\d+/merge`).test(c.path) },
]);

const other = (words) => ({ kind: 'other', words: words.slice(0, 3) });

// The call as the allow list reads it, or null when it can't be read the way gh reads it, or names another host or
// repository than `repo` (the project's, `owner/name`; not checked when not given).
function readCall(words, { repo }) {
  const command = words[0] === 'api' ? 'api' : `${words[0]} ${words[1]}`;
  const spec = SPECS[command];
  if (!spec) return null;
  const rest = words.slice(command === 'api' ? 1 : 2);
  const parsed = parseWords(rest, command === 'api' || command === 'repo view' ? spec : { ...spec, ...REPO_FLAGS });
  if (!parsed) return null;
  const host = one(parsed, '--hostname');
  if (host !== undefined && host !== HOST) return null;
  const named = one(parsed, '--repo');
  if (named !== undefined && (repoOf(named) === null || (repo && !sameRepo(repoOf(named), repo)))) return null;
  // A pull request, issue or run named by its address must be the project's own.
  if (command !== 'api' && command !== 'repo view' && parsed.positionals.some((p) => !addressIsOwn(p, repo))) return null;
  if (command === 'repo view' && parsed.positionals[0] !== undefined && (repoOf(parsed.positionals[0]) === null || (repo && !sameRepo(repoOf(parsed.positionals[0]), repo)))) return null;
  const call = { command, parsed };
  if (command !== 'api') return call;

  if (parsed.positionals.length !== 1) return null;
  const input = one(parsed, '--input');
  if (input !== undefined && input !== '-') return null;
  const fields = fieldsOf(parsed);
  if (!fields) return null;
  const given = one(parsed, '--method');
  // gh sends a POST when a field or an input is given and no method is.
  const method = given ? given.toUpperCase() : (Object.keys(fields).length > 0 || input !== undefined ? 'POST' : 'GET');
  let target = parsed.positionals[0].replace(/^\//, '');
  if (repo) target = target.replace(/^repos\/\{owner\}\/\{repo\}\//, `repos/${repo}/`);
  // Only a read may carry a query, and it is no part of what the call is; a write's path is plain.
  const [route, query] = target.split(/\?(.*)/s);
  if (/[#%{}\s\\]/.test(route) || (query !== undefined && method !== 'GET')) return null;
  const owner = /^repos\/([^/]+\/[^/]+)\//.exec(route)?.[1];
  if (route !== 'graphql' && (!owner || (repo && !sameRepo(owner, repo)))) return null;
  return { ...call, method, path: route, fields, input };
}

// What a gh call is: { kind, name?, pr?, sha?, branch?, run? }, with kind read, push, create, comment, verdict, rerun,
// merge or other.
// `stdin` is the call's standard input, for a body sent that way; `repo` the project's repository, `owner/name`.
export function classifyCall(argv, { stdin = '', repo = null } = {}) {
  const words = (Array.isArray(argv) ? argv : []).map(String);
  const read = readCall(words, { repo });
  const entry = read && BROKER_ALLOW.find((e) => e.test(read));
  if (!entry) return other(words);
  const call = { kind: entry.kind, name: entry.name };
  const { parsed } = read;
  if (entry.kind === 'merge') {
    if (read.command === 'pr merge') {
      if (one(parsed, '--body-file') !== undefined) return other(words);
      call.pr = Number(parsed.positionals[0]);
      call.sha = one(parsed, '--match-head-commit') ?? null;
    } else {
      call.pr = Number(/pulls\/(\d+)\/merge$/.exec(read.path)[1]);
      call.sha = read.fields.sha ?? null;
    }
  }
  if (entry.kind === 'create') call.branch = one(parsed, '--head') ?? null;
  if (entry.kind === 'rerun') call.run = Number(parsed.positionals[0]);
  if (entry.kind === 'push') {
    const fromPath = /git\/refs\/heads\/(.+)$/.exec(read.path)?.[1];
    const fromField = read.fields.ref?.startsWith('refs/heads/') ? read.fields.ref.slice('refs/heads/'.length) : null;
    const branch = read.method === 'PATCH' ? fromPath : fromField;
    call.branch = typeof branch === 'string' && BRANCH.test(branch) ? branch : null;
  }
  if (entry.kind === 'comment' || entry.kind === 'create') {
    let body;
    if (read.command === 'api') body = read.input === '-' ? inputBody(stdin) : read.fields.body;
    else body = bodyOf(parsed, stdin);
    if (body === null) return other(words);
    const head = verdictHead(body);
    if (head !== '') {
      call.kind = 'verdict';
      call.sha = head;
      call.pr = read.command === 'api' ? null : Number(parsed.positionals[0] ?? NaN) || null;
    }
  }
  return call;
}

const refuse = (reason) => ({ allow: false, reason: `Wheelhouse's broker refused this call: ${reason}.` });

// Whether the call passes. `ctx`: { stop, lockHeld, defaultBranch, incident, enrolled, review (the signed review of
// the call's head, or null), approval (the director's signed approval of it, or null), shownFirst, level, guardrail,
// redMain (whether a red-main incident is open), runBranch (the branch of the run a rerun names, as the host says),
// checksHere (whether the project's checks run on this computer), check (the signed check of the call's head, or null),
// digest (the command now on the default branch), notCounting (whether the project's tests aren't counting yet),
// outsideAreas (whether the change reaches outside its goal's areas, with no Allow this once at this head),
// hostApproval (undefined where the person's approval on GitHub isn't needed, else whether it is there) }.
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
  if (call.kind === 'rerun') {
    if (ctx.redMain !== true) return refuse('a run\'s failed jobs are run again only to mend a red main line');
    if (typeof ctx.runBranch !== 'string' || ctx.runBranch !== ctx.defaultBranch) return refuse('only a run of the default branch has its failed jobs run again');
    return { allow: true };
  }
  const head = call.sha;
  if (!FULL_SHA.test(head ?? '')) return refuse(call.kind === 'merge' ? 'the merge names no head commit' : 'the verdict names no reviewed commit');
  const reviewed = reviewCounts(ctx.review, head, ctx.enrolled);
  if (call.kind === 'verdict') return reviewed ? { allow: true } : refuse(`there is no signed CLEAN review of ${head.slice(0, 7)}`);
  // A merge: the permit.
  const incident = incidentReason(ctx.incident);
  if (incident) return refuse(incident);
  if (ctx.outsideAreas === true) return refuse(`the change at ${head.slice(0, 7)} reaches outside its goal's areas`);
  if (!reviewed) return refuse(`there is no signed CLEAN review of ${head.slice(0, 7)}`);
  const needsApproval = ctx.shownFirst === true || ctx.level === 4 || ctx.guardrail === true;
  if (needsApproval && !approvalCounts(ctx.approval, head, ctx.enrolled)) return refuse(`the director's approval of ${head.slice(0, 7)} isn't signed`);
  if (ctx.hostApproval !== undefined && ctx.hostApproval !== true) return refuse(NO_HOST_APPROVAL(head.slice(0, 7)));
  // The host's green status gets a change past Archon's gate; on a project with no CI the signed record gets it past here.
  if (ctx.checksHere === true && !checkCounts(ctx.check, head, ctx.digest, ctx.enrolled, { notCounting: ctx.notCounting === true })) return refuse(`there is no passing check on this computer of ${head.slice(0, 7)}`);
  return { allow: true };
}
