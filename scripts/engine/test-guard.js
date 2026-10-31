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
const TEST_SETTINGS = /(^|\/)(jest|vitest|karma|mocha|ava|playwright|cypress|babel\.test)\.config\.[cm]?[jt]s$|(^|\/)\.(nycrc|c8rc|mocharc)(\.[a-z]+)?$|(^|\/)(pytest\.ini|tox\.ini|noxfile\.py|conftest\.py|\.coveragerc|codecov\.ya?ml|phpunit\.xml(\.dist)?)$|(^|\/)\.cargo\/config(\.toml)?$/i;

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
// The settings a test tool takes from package.json itself.
const PACKAGE_TOOLS = ['jest', 'mocha', 'ava', 'vitest', 'c8', 'nyc'];

function packageTests(text) {
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
  const named = reachable(Object.keys(scripts).filter((name) => /^(pre|post)?test/.test(name)), (name) => [...scriptCalls(scripts[name]).filter(held).flatMap((call) => [call, ...beside(call)])]);
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
    } else if (line.trim() !== '') current = null;
  }
  return { rules, variables };
}

function makeTests(text) {
  if (text === null) return null;
  const { rules, variables } = makeRules(text);
  if (rules.test === undefined) return null;
  const used = (words) => [...words.matchAll(/\$[({]([A-Za-z_][\w.-]*)[)}]/g)].map((m) => `$${m[1]}`);
  const next = (name) => {
    if (name.startsWith('$')) return used(variables[name.slice(1)] ?? '');
    const rule = rules[name];
    if (rule === undefined) return [];
    const recipe = rule.recipe.join('\n');
    const called = [...recipe.matchAll(/(?:\$\(MAKE\)|\$\{MAKE\}|\bmake)\s+((?:[\w./-]+\s*)+)/g)].flatMap((m) => m[1].trim().split(/\s+/));
    return [...rule.needs, ...called.filter((c) => !c.startsWith('-')), ...used(recipe), ...used(rule.needs.join(' '))];
  };
  return JSON.stringify(reachable(['test'], next).map((name) => [name, name.startsWith('$') ? variables[name.slice(1)] ?? null : rules[name]?.recipe ?? null, name.startsWith('$') ? null : rules[name]?.needs ?? null]));
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
const pythonTests = (text) => (text === null ? null : tablesOf(text, (name) => /^(tool\.(pytest|coverage|tox|nox|hatch\.envs)|tool:pytest|coverage:)/.test(name)));

// Cargo's switches for what `cargo test` builds: `test = false` on a target, `harness`, `autotests`, `[[test]]` tables, the test
// profile.
function cargoTests(text) {
  if (text === null) return null;
  const tables = tablesOf(text, (name) => /^(test|profile\.test)$/.test(name));
  const switches = text.split(/\r?\n/).map((l) => l.trim()).filter((l) => /^(test|doctest|harness|autotests|autobins|autoexamples)\s*=/.test(l));
  const held = [tables ?? '', ...switches.sort()].join('\n').trim();
  return held === '' ? null : held;
}

export const testRunner = (file) => {
  const rel = String(file).replace(/\\/g, '/');
  if (PACKAGE.test(rel)) return packageTests;
  if (MAKEFILE.test(rel)) return makeTests;
  if (PYTHON_BUILD.test(rel)) return pythonTests;
  return CARGO.test(rel) ? cargoTests : null;
};
// A file where a test setting that wasn't there before is a change too: `test = false` added to Cargo.toml.
export const settingsAppear = (file) => {
  const rel = String(file).replace(/\\/g, '/');
  return PYTHON_BUILD.test(rel) || CARGO.test(rel);
};
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
