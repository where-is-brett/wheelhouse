// scripts/hooks/read-only-shell.js
// The shell of a step that reads only (Archon design, section 7.5): the reviews the helper signs, the slice lane's task
// review and its tester, and the lesson step. Their steps deny Write, Edit and NotebookEdit, and the design gives them a shell for reading;
// this is what keeps that shell reading. The tool guard asks it before each shell command in such a step.
//
// Why a guard and not the sandbox. On macOS Claude Code's sandbox does refuse a sandboxed command's write to a folder
// in its denyWrite list (tried on 30 October 2026, Claude Code 2.1.302), but its lists are the session's: the run's
// own overlay (ownRunRules) is one project file that every step of the run reads, its building steps too, and a
// step's own `sandbox` in the pack can't name the run's worktree or repository (Archon fills in no variable there, and
// a relative path given that way is not read from the worktree). So the step is told apart here, by the node Archon
// says it runs (ARCHON_NODE_EXECUTION, set for the agent's shell and its hooks), and its command is held to a list of
// reading commands. Anything else, or a command that can't be read with certainty, is refused.
import { segmentsWithOperators } from './shell-words.js';

// The helper's signed reviews (routes.js REVIEW_STEPS), the slice lane's task review and its tester, and the lesson
// step. The pack's tests hold this list to the steps that deny the write tools.
export const READ_ONLY_STEPS = Object.freeze(['review-standards', 'review-spec', 'review-security', 'review-design', 'review-feature', 'task-review', 'tester', 'lesson']);

// The step's node id, when the build engine started this step and the node is one that reads only; else null. Archon
// gives the node's path, a string with loop groups' ids before the node's own (or, as some records hold it, a list).
export function readOnlyStep(env = process.env) {
  if (env?.WHEELHOUSE_ENGINE_RUN !== '1' || typeof env.ARCHON_NODE_EXECUTION !== 'string') return null;
  let where;
  try { where = JSON.parse(env.ARCHON_NODE_EXECUTION)?.path; } catch { return null; }
  const parts = Array.isArray(where) ? where : typeof where === 'string' ? where.split(/[^A-Za-z0-9_-]+/) : [];
  const id = parts.filter((p) => typeof p === 'string' && p !== '').at(-1);
  return READ_ONLY_STEPS.includes(id) ? id : null;
}

// git's commands that only read, and the options of theirs that write a file or run a program.
const GIT_READS = new Set(['diff', 'log', 'show', 'status', 'ls-files', 'ls-tree', 'blame', 'rev-parse', 'rev-list', 'cat-file',
  'merge-base', 'grep', 'shortlog', 'describe', 'name-rev', 'diff-tree', 'diff-index', 'diff-files', 'show-ref', 'for-each-ref',
  'whatchanged', 'cherry', 'range-diff', 'show-branch', 'count-objects']);
const GIT_VALUE_OPTIONS = new Set(['-C', '--git-dir', '--work-tree', '--namespace']);
const GIT_REFUSED_OPTION = /^(-c|--config-env|--exec-path|--output|-O|--open-files-in-pager|--ext-diff|--textconv)(=|$)|^-O./;
// Commands that only read, and for each the options that would make it write or run something.
const READERS = {
  cat: null, head: null, tail: null, wc: null, ls: null, pwd: null, echo: null, printf: null, grep: null, egrep: null,
  fgrep: null, diff: null, cmp: null, file: null, stat: null, basename: null, dirname: null, realpath: null, which: null,
  true: null, false: null, test: null, '[': null, cut: null, tr: null, nl: null, column: null, comm: null, jq: null, cd: null,
  od: null, hexdump: null, du: null, df: null, date: null, git: null, sed: null, find: null, sort: null, uniq: null, rg: null,
  tree: /^-o$/,
};
const FIND_REFUSED = /^-(delete|exec|execdir|ok|okdir|fprint|fprint0|fprintf|fls)$/;
// A sed script that only prints lines: `N`, `N,M`, `N,$` or `$`, then p, perhaps several joined by ;.
const SED_PRINT = /^((\d+|\$)(,(\d+|\$))?p)(;(\d+|\$)(,(\d+|\$))?p)*$/;
// A file descriptor copied or closed (`2>&1`, `>&2`, `2>&-`): the splitter reads it as a redirect to a file named `1`.
const DUPLICATED = /\d*>&(\d+|-)(?=$|[\s;|&)])/g;
const SINKS = new Set(['/dev/null']);

// Why the words of one command might write, or null when it only reads.
function commandWrite(words) {
  if (words.length === 0) return null;
  const [name, ...args] = words;
  if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(name)) return 'it sets a variable for a program';
  if (!Object.hasOwn(READERS, name)) return `${name} is not one of the commands that only read`;
  if (READERS[name] && args.some((a) => READERS[name].test(a))) return `${name} writes a file with that option`;
  if (name === 'git') {
    let i = 0;
    for (; i < args.length && args[i].startsWith('-'); i += 1) {
      if (GIT_REFUSED_OPTION.test(args[i])) return `git ${args[i]} runs a program or writes a file`;
      if (GIT_VALUE_OPTIONS.has(args[i])) i += 1;
    }
    if (!GIT_READS.has(args[i])) return `git ${args[i] ?? ''} is not one of git's reading commands`.trimEnd();
    const refused = args.slice(i + 1).find((a) => GIT_REFUSED_OPTION.test(a));
    return refused ? `git ${refused} runs a program or writes a file` : null;
  }
  if (name === 'sed') {
    if (args.some((a) => /^(-i|--in-place|-f|--file)/.test(a))) return 'sed edits a file or reads its script from one with that option';
    const scripts = [];
    for (let i = 0; i < args.length; i += 1) if (args[i] === '-e' || args[i] === '--expression') scripts.push(args[(i += 1)] ?? '');
    if (scripts.length === 0) scripts.push(args.find((a) => !a.startsWith('-')) ?? '');
    return scripts.every((s) => SED_PRINT.test(s)) ? null : 'only sed\'s scripts that print lines (sed -n 1,80p) are read here';
  }
  if (name === 'find') return args.some((a) => FIND_REFUSED.test(a)) ? 'find deletes, writes or runs a program with that option' : null;
  if (name === 'sort') return args.some((a) => /^(-o|--output)/.test(a)) ? 'sort writes a file with that option' : null;
  if (name === 'uniq') return args.filter((a) => !a.startsWith('-')).length > 1 ? 'uniq writes its second file' : null;
  if (name === 'rg') return args.some((a) => /^--pre(=|$)/.test(a)) ? 'rg runs a program with that option' : null;
  return null;
}

// Why a shell command in a step that reads only might write, or null when every command in it only reads.
export function shellWrite(command, { windows = false } = {}) {
  const read = segmentsWithOperators(String(command).replace(DUPLICATED, ' '), windows);
  if (read === null) return 'the command can\'t be read with certainty';
  // A command inside another ($( ), backticks, <( )): the splitter can't always say whose words follow it.
  if (read.operators.some((op) => op === '(' || op === '`')) return 'it runs a command inside another';
  for (let i = 0; i < read.segments.length; i += 1) {
    const words = read.segments[i];
    if (read.operators[i] === '>') {
      if (words.length > 0 && !SINKS.has(words[0])) return `it writes to ${words[0]}`;
      if (words.length > 1) {
        const why = commandWrite(words.slice(1));
        if (why) return why;
      }
      continue;
    }
    // A redirect's source (`< file`) only reads: its first word is the file, and any words after it a command's.
    const why = commandWrite(read.operators[i] === '<' ? words.slice(1) : words);
    if (why) return why;
  }
  return null;
}
