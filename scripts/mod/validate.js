// scripts/mod/validate.js
// Checks the mod before its tests run (npm run mod-check). It runs `claude plugin validate`
// on the plugin, which reads hooks/register.ts as Claude Code will, and fails unless the
// mod hooks exactly the four events of its brief, with no tool or permission hook, and calls
// only what the brief names. It also reads the module's source for every member of `$` it
// touches, so nothing the validator doesn't list as a call slips past.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { run } from '../lib/run.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const MODULE = path.join(ROOT, 'hooks', 'register.ts');
const VALIDATE_MS = 60000;

// The hooks, as the validator spells them, and the calls on `$` the brief allows.
export const HOOKS = ['session.start', 'session.measure', 'prompt.submit', 'command.run{command=go}'];
export const CALLS = ['$.command.register', '$.process.run', '$.session.id', '$.session.root', '$.session.usage', '$.ui.toast'];
// A value of `$`, not a call, so the validator doesn't list it.
const VALUES = ['$.plugin.root'];

// The items of a note's list: split at the commas outside brackets, each without the
// "(via helper)" the validator adds to a call made inside one of the module's own functions.
function listed(line) {
  const items = [];
  let depth = 0;
  let item = '';
  for (const c of line) {
    if ('({['.includes(c)) depth += 1;
    if (')}]'.includes(c)) depth -= 1;
    if (c === ',' && depth === 0) { items.push(item); item = ''; } else item += c;
  }
  items.push(item);
  return items.map((i) => i.replace(/\s*\(via [^)]*\)$/, '').trim()).filter(Boolean);
}

// Every `$.noun.member` (or a bare `$.noun`) the source names outside its comments, sorted.
export function membersIn(source) {
  const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:\\])\/\/.*$/gm, '$1');
  const found = new Set();
  for (const m of code.matchAll(/(?<![\w$])\$\.([A-Za-z_]\w*)(?:\.([A-Za-z_]\w*))?/g)) found.add(m[2] ? `$.${m[1]}.${m[2]}` : `$.${m[1]}`);
  return [...found].sort();
}

// checkMod({ report, source }) -> { hooks, calls, problems }. `report` is what
// `claude plugin validate --json` printed, `source` the text of hooks/register.ts.
export function checkMod({ report, source }) {
  const problems = [];
  if (report === null || typeof report !== 'object') {
    return { hooks: [], calls: [], problems: ['claude plugin validate gave no report'] };
  }
  const parts = [report.manifest, ...(Array.isArray(report.contents) ? report.contents : [])].filter((p) => p && typeof p === 'object');
  if (report.success !== true) problems.push('claude plugin validate did not pass');
  for (const part of parts) {
    for (const error of Array.isArray(part.errors) ? part.errors : []) problems.push(`claude plugin validate found an error: ${error?.path ?? ''} ${error?.message ?? ''}`.trim());
  }
  const notes = parts.filter((p) => p.type === 'hooks').flatMap((p) => (Array.isArray(p.notes) ? p.notes : []));
  const hooks = [];
  const calls = [];
  for (const note of notes) {
    const hooked = /^\S+ hooks: (.*)$/.exec(note);
    if (hooked) hooks.push(...listed(hooked[1]));
    const called = /^\S+ calls: (.*)$/.exec(note);
    if (called) calls.push(...listed(called[1]));
  }
  for (const hook of hooks) if (!HOOKS.includes(hook)) problems.push(`The mod hooks ${hook}, which its brief doesn't name`);
  for (const hook of HOOKS) if (!hooks.includes(hook)) problems.push(`The mod doesn't hook ${hook}`);
  if (new Set(hooks).size !== hooks.length) problems.push('The mod hooks an event twice');
  for (const call of calls) if (!CALLS.includes(call)) problems.push(`The mod calls ${call}, which its brief doesn't name`);
  const allowed = new Set([...CALLS, ...VALUES]);
  for (const member of membersIn(typeof source === 'string' ? source : '')) {
    if (!allowed.has(member)) problems.push(`The mod's source uses ${member}, which its brief doesn't name`);
  }
  return { hooks, calls, problems };
}

async function main() {
  let source = '';
  try {
    source = fs.readFileSync(MODULE, 'utf8');
  } catch {
    console.log('The mod check failed: hooks/register.ts can\'t be read.');
    return 1;
  }
  let report = null;
  try {
    const result = await run('claude', ['plugin', 'validate', '--json', ROOT], { timeoutMs: VALIDATE_MS });
    report = JSON.parse(result.stdout);
  } catch {
    report = null;
  }
  const { hooks, calls, problems } = checkMod({ report, source });
  console.log(`The mod hooks: ${hooks.length ? hooks.join(', ') : 'nothing'}.`);
  console.log(`It calls: ${calls.length ? calls.join(', ') : 'nothing'}.`);
  if (problems.length === 0) {
    console.log('The mod check passed.');
    return 0;
  }
  console.log('The mod check failed:');
  for (const problem of problems) console.log(`- ${problem}${/[.!?]$/.test(problem) ? "" : "."}`);
  return 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await main();
}
