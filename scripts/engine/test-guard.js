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
const TEST_SETTINGS = /(^|\/)(jest|vitest|karma|mocha|ava|playwright|cypress|babel\.test)\.config\.[cm]?[jt]s$|(^|\/)\.(nycrc|c8rc|mocharc)(\.[a-z]+)?$|(^|\/)(pytest\.ini|tox\.ini|\.coveragerc|codecov\.ya?ml|phpunit\.xml(\.dist)?)$/i;

export const isTestSettings = (file) => TEST_SETTINGS.test(String(file).replace(/\\/g, '/'));

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
]);

// How many skip markers `text` holds.
export function skipCount(text) {
  const source = String(text ?? '');
  return SKIP_MARKERS.reduce((n, marker) => n + (source.match(new RegExp(marker.source, 'g'))?.length ?? 0), 0);
}

// A rough count of a test file's assertions: assert and expect calls, should chains and the like.
const ASSERTIONS = /\b(?:assert\w*|expect|should|t\.(?:equal|deepEqual|ok|is|true|false|throws|match|same)\w*|require\.\w+|self\.assert\w*)\s*[.(]/g;
export const assertionCount = (text) => String(text ?? '').match(ASSERTIONS)?.length ?? 0;

// Whether `file` (a path relative to the worktree, with forward slashes) is one the order lets change.
export function listed(file, protectedFiles = []) {
  const rel = String(file).replace(/\\/g, '/').replace(/^\.\//, '');
  return protectedFiles.some((listedFile) => String(listedFile).replace(/\\/g, '/').replace(/^\.\//, '') === rel);
}
