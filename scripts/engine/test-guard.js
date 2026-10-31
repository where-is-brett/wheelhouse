// scripts/engine/test-guard.js
// What the protected-tests guard and check know of tests (Archon design, section 11): which files are tests or test
// settings, the markers that skip a test, and a rough count of a file's assertions. Shared by the hook
// (scripts/hooks/protected-tests.js), which refuses an edit as it is made, and the check step
// (scripts/engine/protected-check.js), which compares the whole change before review.

// A file in a test folder, or named as a test is in the common languages.
const TEST_FOLDER = /(^|\/)(tests?|__tests__|specs?|e2e)\//i;
const TEST_NAME = /(\.(test|spec)\.[cm]?[jt]sx?$)|(_test\.(go|py|rb|exs?)$)|(^|\/)test_[^/]*\.py$|(Tests?\.(java|kt|cs|swift)$)|(_spec\.rb$)/;

export function isTestFile(file) {
  const rel = String(file).replace(/\\/g, '/');
  return TEST_NAME.test(rel) || TEST_FOLDER.test(rel);
}

// The files that set how tests run and what coverage they need: loosening one passes a change without its tests.
const TEST_SETTINGS = /(^|\/)(jest|vitest|karma|mocha|ava|playwright|cypress|babel\.test)\.config\.([cm]?[jt]s|json)$|(^|\/)vitest\.workspace\.[a-z]+$|(^|\/)\.(npmrc|yarnrc(\.yml)?)$|(^|\/)\.(nycrc|c8rc|mocharc)(\.[a-z]+)?$|(^|\/)(pytest\.ini|tox\.ini|noxfile\.py|conftest\.py|\.coveragerc|codecov\.ya?ml|phpunit\.xml(\.dist)?)$|(^|\/)\.cargo\/config(\.toml)?$/i;

// An Xcode scheme or test plan says which tests run, so unticking them is the same thing.
const XCODE_TESTS = /\.(xcscheme|xctestplan)$/;

export const isTestSettings = (file) => {
  const rel = String(file).replace(/\\/g, '/');
  return TEST_SETTINGS.test(rel) || XCODE_TESTS.test(rel);
};

// What a file says the tests run, for the files whose other changes are nobody's business: a dependency added to
// package.json is no finding. Each follows what the test entry leads to, since `npm run unit` empties as well through `unit`,
// and gives text to compare, and null when the file has none of it or can't be read as one.
const PACKAGE = /(^|\/)package\.json$/;
const MAKEFILE = /(^|\/)(GNUmakefile|[Mm]akefile)$/;
const PYTHON_BUILD = /(^|\/)(pyproject\.toml|setup\.cfg)$/;
const CARGO = /(^|\/)Cargo\.toml$/;
const SWIFT_PACKAGE = /(^|\/)Package\.swift$/;

// Everything reachable from `start`, where `next(name)` names what `name` leads to.
function reachable(start, next) {
  const seen = new Set();
  const waiting = [...start];
  while (waiting.length > 0) {
    const name = waiting.pop();
    if (seen.has(name)) continue;
    seen.add(name);
    waiting.push(...next(name));
  }
  return [...seen].sort();
}

// The script names a package script's text calls, by the package managers' own ways of calling one.
const SCRIPT_CALL = /\b(?:npm\s+run(?:-script)?|pnpm(?:\s+run)?|yarn(?:\s+run)?|bun\s+run)\s+(?:--?[\w-]+\s+)*([\w:.-]+)|\bnpm:([\w:.-]+)|\b(?:run-s|run-p|npm-run-all)\s+([^&|;]+)/g;
function scriptCalls(body) {
  return [...String(body).matchAll(SCRIPT_CALL)].flatMap((m) => (m[3] ?? m[1] ?? m[2]).split(/\s+/)).filter((word) => word !== '' && !word.startsWith('-'));
}
// The scripts `body` leads to: those it calls in a known way, and any other it names, since `node --run unit`, `bun unit`,
// `turbo run unit` and whatever comes next all do the same, and a script named by chance costs only a look.
function scriptsIn(body, names) {
  const words = new Set(String(body).split(/[\s'"=;&|()]+/));
  return [...new Set([...scriptCalls(body), ...names.filter((name) => words.has(name))])];
}
// The settings a test tool takes from package.json itself.
const PACKAGE_TOOLS = ['jest', 'mocha', 'ava', 'vitest', 'c8', 'nyc'];

// Those settings as they stand: one a package.json gains changes what its tests run, whatever its scripts.
export function packageTools(text) {
  try {
    const manifest = JSON.parse(text);
    return JSON.stringify(PACKAGE_TOOLS.map((tool) => manifest?.[tool] ?? null));
  } catch {
    return null;
  }
}

function packageTests(text, command = '') {
  if (text === null) return null;
  let manifest;
  try {
    manifest = JSON.parse(text);
  } catch {
    return 'unreadable';
  }
  const scripts = manifest?.scripts ?? {};
  const held = (name) => Object.hasOwn(scripts, name);
  const beside = (name) => [`pre${name}`, `post${name}`].filter(held);
  const names = Object.keys(scripts);
  const entry = [...names.filter((name) => /^(pre|post)?test/.test(name)), ...scriptsIn(command, names).filter(held)];
  const named = reachable(entry, (name) => scriptsIn(scripts[name], names).filter(held).flatMap((call) => [call, ...beside(call)]));
  const tools = PACKAGE_TOOLS.filter((tool) => manifest?.[tool] !== undefined).map((tool) => [tool, manifest[tool]]);
  return named.length > 0 || tools.length > 0 ? JSON.stringify([named.map((name) => [name, scripts[name]]), tools]) : null;
}

// A Makefile's rules: { [target]: { needs, recipe } }, and its variables.
function makeRules(text) {
  const rules = {};
  const variables = {};
  let current = null;
  for (const line of text.replace(/\\\r?\n\s*/g, ' ').split(/\r?\n/)) {
    const assigned = /^([A-Za-z_][\w.-]*)\s*[:?+]?=\s*(.*)$/.exec(line);
    const rule = /^([^\s:#=][^:#=]*?)\s*:(?!=)\s*([^#]*)$/.exec(line);
    if (line.startsWith('\t')) current?.recipe.push(line.trim());
    else if (assigned) {
      variables[assigned[1]] = `${variables[assigned[1]] ?? ''}${assigned[2]}`;
      current = null;
    } else if (rule) {
      const [needs, inline] = rule[2].split(';');
      current = { needs: needs.trim().split(/\s+/).filter(Boolean), recipe: inline === undefined ? [] : [inline.trim()] };
      for (const target of rule[1].trim().split(/\s+/)) rules[target] = current;
    } else if (line.trim() !== '' && !line.startsWith('#')) current = null;
  }
  return { rules, variables };
}

function makeTests(text, command = '') {
  if (text === null) return null;
  const { rules, variables } = makeRules(text);
  const entry = ['test', ...[...String(command).matchAll(/\bmake\s+((?:[\w./-]+\s*)+)/g)].flatMap((m) => m[1].trim().split(/\s+/))].filter((name) => rules[name] !== undefined);
  if (entry.length === 0) return null;
  const used = (words) => [...words.matchAll(/\$[({]([A-Za-z_][\w.-]*)[)}]/g)].map((m) => `$${m[1]}`);
  const next = (name) => {
    if (name.startsWith('$')) return used(variables[name.slice(1)] ?? '');
    const rule = rules[name];
    if (rule === undefined) return [];
    const recipe = rule.recipe.join('\n');
    const called = [...recipe.matchAll(/(?:\$\(MAKE\)|\$\{MAKE\}|\bmake)\s+((?:[\w./-]+\s*)+)/g)].flatMap((m) => m[1].trim().split(/\s+/));
    return [...rule.needs, ...called.filter((c) => !c.startsWith('-')), ...used(recipe), ...used(rule.needs.join(' '))];
  };
  return JSON.stringify(reachable(entry, next).map((name) => [name, name.startsWith('$') ? variables[name.slice(1)] ?? null : rules[name]?.recipe ?? null, name.startsWith('$') ? null : rules[name]?.needs ?? null]));
}

// The tables of an ini-like file (TOML's, or setup.cfg's) whose names pass `wanted`, as they stand.
function tablesOf(text, wanted) {
  const kept = [];
  let keeping = false;
  for (const line of text.split(/\r?\n/)) {
    const table = /^\s*\[+\s*([^\]]+?)\s*\]+/.exec(line);
    if (table) keeping = wanted(table[1]);
    if (keeping && line.trim() !== '' && !line.trim().startsWith('#')) kept.push(line.trim());
  }
  return kept.length > 0 ? kept.join('\n') : null;
}
// TOML can also write such a setting whole, as a dotted key above any table.
const PYTHON_TABLE = /^(tool\.(pytest|coverage|tox|nox|hatch\.envs)|tool:pytest|coverage:)/;
function pythonTests(text) {
  if (text === null) return null;
  const dotted = text.split(/\r?\n/).map((l) => l.trim()).filter((l) => PYTHON_TABLE.test(l));
  const held = [tablesOf(text, (name) => PYTHON_TABLE.test(name)) ?? '', ...dotted].join('\n').trim();
  return held === '' ? null : held;
}

// Cargo's switches for what `cargo test` builds: `test = false` on a target, `harness`, `autotests`, `[[test]]` tables, the test
// profile.
function cargoTests(text) {
  if (text === null) return null;
  const tables = tablesOf(text, (name) => /^(test|profile\.test)$/.test(name));
  const switches = text.split(/\r?\n/).map((l) => l.trim()).filter((l) => /^(test|doctest|harness|autotests|autobins|autoexamples)\s*=/.test(l));
  const held = [tables ?? '', ...switches.sort()].join('\n').trim();
  return held === '' ? null : held;
}

// `command` is the project's test command, for one that starts somewhere other than `test`: `npm run verify`, `make check`.
export const testRunner = (file, command = '') => {
  const rel = String(file).replace(/\\/g, '/');
  if (PACKAGE.test(rel)) return (text) => packageTests(text, command);
  if (MAKEFILE.test(rel)) return (text) => makeTests(text, command);
  if (PYTHON_BUILD.test(rel)) return pythonTests;
  return CARGO.test(rel) ? cargoTests : null;
};
// A file where a test setting that wasn't there before is a change too: `test = false` added to Cargo.toml.
export const settingsAppear = (file) => {
  const rel = String(file).replace(/\\/g, '/');
  return PYTHON_BUILD.test(rel) || CARGO.test(rel);
};
export const isPackage = (file) => PACKAGE.test(String(file).replace(/\\/g, '/'));
export const isMakefile = (file) => MAKEFILE.test(String(file).replace(/\\/g, '/'));
export const isSwiftPackage = (file) => SWIFT_PACKAGE.test(String(file).replace(/\\/g, '/'));
export const testTargetCount = (text) => (String(text ?? '').match(/\.testTarget\s*\(/g) ?? []).length;

// Markers that skip, park or narrow a test, across the common test tools.
export const SKIP_MARKERS = Object.freeze([
  /\b(?:it|test|describe|context|suite)\.(?:skip|todo|only)\b/g,
  /\b(?:xit|xtest|xdescribe|xcontext|fit|fdescribe)\s*\(/g,
  /@pytest\.mark\.(?:skip|skipif|xfail)\b/g,
  /\bpytest\.skip\s*\(/g,
  /@unittest\.skip\w*/g,
  /\bt\.Skip(?:Now|f)?\s*\(/g,
  /\{\s*(?:skip|todo)\s*:\s*(?:true|['"`])/g,
  /#\[ignore\]/g,
  /@(?:Disabled|Ignore)\b/g,
  // A build tag on a Go test file leaves it out of `go test ./...`; Rust's and Swift's ways of the same.
  /^\s*\/\/\s*(?:go:build\s|\+build\s)/gm,
  /#\[cfg\(\s*(?:any\(\s*\)|not\(\s*test\s*\)|ignore\b)/g,
  /\bthrow\s+XCTSkip\b/g,
  /\.disabled\s*\(/g,
]);

// How many skip markers `text` holds.
export function skipCount(text) {
  const source = String(text ?? '');
  return SKIP_MARKERS.reduce((n, marker) => n + (source.match(marker)?.length ?? 0), 0);
}

// A rough count of a test file's assertions: assert and expect calls, should chains and the like.
const ASSERTIONS = /\b(?:assert\w*|expect|should|t\.(?:equal|deepEqual|ok|is|true|false|throws|match|same)\w*|require\.\w+|self\.assert\w*)\s*[.(]/g;
export const assertionCount = (text) => String(text ?? '').match(ASSERTIONS)?.length ?? 0;

// Whether `file` (a path relative to the worktree, with forward slashes) is one the order lets change.
export function listed(file, protectedFiles = []) {
  const rel = String(file).replace(/\\/g, '/').replace(/^\.\//, '');
  return protectedFiles.some((listedFile) => String(listedFile).replace(/\\/g, '/').replace(/^\.\//, '') === rel);
}
