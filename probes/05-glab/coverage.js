// probes/05-glab/coverage.js
// Check 5: does glab offer every operation the host adapter needs?
// Reads saved `glab <command> --help` texts; never calls GitLab.

const OPERATIONS = [
  { operation: 'open MR', command: 'mr create', flag: '--source-branch' },
  { operation: 'update MR', command: 'mr update', flag: '--description' },
  { operation: 'CI status for a commit', command: 'ci status', flag: '--branch' },
  { operation: 'watch CI', command: 'ci status', flag: '--live' },
  { operation: 'mergeability', command: 'mr view', flag: '--output' },
  { operation: 'merge exact head', command: 'mr merge', flag: '--sha' },
  { operation: 'issues', command: 'issue create', flag: '--description' },
  { operation: 'issue checklist', command: 'issue update', flag: '--description' },
];

function hasFlag(text, flag) {
  return new RegExp(`(^|\\s)${flag}(\\s|=|$)`, 'm').test(text);
}

export function checkCoverage(helpTexts) {
  return OPERATIONS.map((row) => {
    const text = helpTexts[row.command];
    return { ...row, covered: typeof text === 'string' && hasFlag(text, row.flag) };
  });
}
