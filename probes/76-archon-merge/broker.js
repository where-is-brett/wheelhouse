// probes/76-archon-merge/broker.js
// Check 76's stand-in broker (spec 12.4): the only `gh` on Archon's PATH. It holds no key. Each call's arguments are
// logged and sent to the probe's helper stand-in (an HTTP server on 127.0.0.1 run by run.js, which holds the trial
// repository's token), and the real gh's output comes back unchanged. A merge (`gh pr merge`, or the REST merge call
// with PUT) passes only when a permit file for that pull request and head exists; anything else passes, since this
// stand-in's job is to list every call the merge queue makes.
//
// As a program: node broker.js <gh arguments...>, with WHEELHOUSE_BROKER_URL (the helper stand-in's address) and
// WHEELHOUSE_BROKER_LOG set. run.js writes a `gh` launcher that starts it with an absolute Node path.
import fs from 'node:fs';
import { startedAsScript } from '../../scripts/lib/started-as-script.js';

// gh's global flags that take a value, skipped when finding the command.
const GLOBAL_WITH_VALUE = new Set(['-R', '--repo', '--hostname']);

function command(argv) {
  const words = [];
  for (let i = 0; i < argv.length; i += 1) {
    if (GLOBAL_WITH_VALUE.has(argv[i])) { i += 1; continue; }
    words.push(argv[i]);
  }
  return words;
}

function apiMethod(words) {
  for (let i = 0; i < words.length; i += 1) {
    const word = words[i];
    if (word === '-X' || word === '--method') return String(words[i + 1] ?? '').toUpperCase();
    if (word.startsWith('-X') && word.length > 2) return word.slice(2).toUpperCase();
    if (word.startsWith('--method=')) return word.slice(9).toUpperCase();
  }
  // gh api sends a POST when a field is given and no method is.
  const hasField = words.some((word) => /^(-f|-F|--field|--raw-field|--input)$/.test(word) || /^--(raw-)?field=/.test(word));
  return hasField ? 'POST' : 'GET';
}

function apiPath(words) {
  return words.slice(1).find((word) => !word.startsWith('-') && /\//.test(word) && !/=/.test(word)) ?? '';
}

// What kind of call this is, for the allow list: read, push, create, comment, merge or other.
export function classify(argv) {
  const words = command(argv);
  const [group, verb] = words;
  if (group === 'api') {
    const method = apiMethod(words);
    const target = apiPath(words).replace(/^\//, '');
    if (/pulls\/\d+\/merge$/.test(target) && method === 'PUT') return 'merge';
    if (method === 'GET') return 'read';
    if (method === 'POST' && /(^|\/)(issues|pulls)\/\d+\/(comments|reviews)$/.test(target)) return 'comment';
    if (method === 'POST' && /(^|\/)pulls$/.test(target)) return 'create';
    if (/git\/refs/.test(target)) return 'push';
    return 'other';
  }
  if (group === 'pr') {
    if (['view', 'list', 'checks', 'diff', 'status'].includes(verb)) return 'read';
    if (verb === 'create') return 'create';
    if (verb === 'comment' || verb === 'review') return 'comment';
    if (verb === 'merge') return 'merge';
    return 'other';
  }
  if (['run', 'issue', 'repo', 'workflow', 'release', 'label'].includes(group) && ['view', 'list', 'watch', 'status'].includes(verb)) return 'read';
  if (group === 'issue' && verb === 'comment') return 'comment';
  if (group === 'auth' && verb === 'status') return 'read';
  return 'other';
}

export function isMerge(argv) {
  return classify(argv) === 'merge';
}

// The pull request and pinned head of a merge call (head null when the call doesn't pin one).
export function mergeTarget(argv) {
  const words = command(argv);
  if (words[0] === 'api') {
    const pr = /pulls\/(\d+)\/merge$/.exec(apiPath(words))?.[1] ?? null;
    let sha = null;
    for (let i = 0; i < words.length; i += 1) {
      const field = /^(-f|-F|--field|--raw-field)$/.test(words[i]) ? words[i + 1] : /^--(raw-)?field=(.*)$/.exec(words[i])?.[2];
      if (field && field.startsWith('sha=')) sha = field.slice(4);
    }
    return { pr, sha };
  }
  const pr = words.slice(2).find((word) => !word.startsWith('-')) ?? null;
  const at = words.indexOf('--match-head-commit');
  return { pr, sha: at >= 0 ? words[at + 1] ?? null : null };
}

// Every logged call, one per line; a missing log is an empty list.
export function callList(logFile) {
  if (!fs.existsSync(logFile)) return [];
  return fs.readFileSync(logFile, 'utf8').split(/\r?\n/).filter((line) => line.trim()).map((line) => JSON.parse(line));
}

// Decides one call: logs it, refuses a merge without a permit for its head, and forwards the rest.
// `forward(argv)` runs the real gh and resolves { code, stdout, stderr }; `headOf(pr)` finds a pull request's head.
export async function handle(argv, { log, permitsDir, forward, headOf = async () => null }) {
  const kind = classify(argv);
  const entry = { at: new Date().toISOString(), argv, kind };
  if (kind === 'merge') {
    const target = mergeTarget(argv);
    const sha = target.sha ?? (target.pr ? await headOf(target.pr) : null);
    const permit = target.pr && sha ? `${permitsDir}/${target.pr}-${sha}` : null;
    if (!permit || !fs.existsSync(permit)) {
      fs.appendFileSync(log, JSON.stringify({ ...entry, refused: true, head: sha }) + '\n');
      return { code: 1, stdout: '', stderr: `Wheelhouse's broker refused this merge: there is no permit for pull request ${target.pr ?? '(unknown)'} at head ${sha ?? '(unknown)'}.\n` };
    }
    entry.head = sha;
  }
  fs.appendFileSync(log, JSON.stringify(entry) + '\n');
  return forward(argv);
}

// The program: asks the helper stand-in, which runs `handle` with the real gh, and passes its answer back.
if (startedAsScript(import.meta.url)) {
  const url = process.env.WHEELHOUSE_BROKER_URL;
  const argv = process.argv.slice(2);
  if (!url) { process.stderr.write('Wheelhouse\'s broker has no helper to ask.\n'); process.exit(1); }
  try {
    const response = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ argv, cwd: process.cwd() }) });
    const answer = await response.json();
    process.stdout.write(answer.stdout ?? '');
    process.stderr.write(answer.stderr ?? '');
    process.exit(Number.isInteger(answer.code) ? answer.code : 1);
  } catch (error) {
    process.stderr.write(`Wheelhouse's broker could not reach the helper: ${error.message}\n`);
    process.exit(1);
  }
}
