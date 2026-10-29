// tests/eval/build-loop/bug-project.js
// The project the bug lane's evaluation works in: a video library's card, with one bug planted. A clip's length shows
// without its leading zero (65 seconds as 1:5). Its files, the bug report as given, and the test and fix a bug run is
// expected to make. Not a scenario itself: its name starts with no number.

export const REPORT = `# A 65-second clip shows as 1:5 on its card

Reported by Sam at the front desk, 30 October 2026: "I uploaded a clip that's a minute and five seconds long, and its
card says 1:5. It should say 1:05."
`;

// The project's test command: a test's name goes after it, as the done check runs it.
export const TEST_COMMAND = 'node --test --test-name-pattern';

export const FILES = {
  'README.md': '# Clip cards\n\nEach clip in the library has a card with its title and its length.\n',
  'package.json': `${JSON.stringify({ name: 'clip-cards', private: true, type: 'module', scripts: { test: 'node --test' } }, null, 2)}\n`,
  'src/duration.js': `// A clip's length as minutes and seconds, for its card.
export function formatDuration(seconds) {
  const minutes = Math.floor(seconds / 60);
  return \`\${minutes}:\${seconds % 60}\`;
}
`,
  'test/card.test.js': `import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatDuration } from '../src/duration.js';

test('formats 70 seconds as 1:10', () => {
  assert.equal(formatDuration(70), '1:10');
});
`,
};

// The reproduction a bug run is expected to write: a test that fails while the bug is there.
export const REPRODUCTION_NAME = 'formats 65 seconds as 1:05';
export const REPRODUCTION_FILE = 'test/duration.test.js';
export const REPRODUCTION = `import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatDuration } from '../src/duration.js';

test('${REPRODUCTION_NAME}', () => {
  assert.equal(formatDuration(65), '1:05');
});
`;

// The fix: the seconds padded to two digits.
export const FIX = `// A clip's length as minutes and seconds, for its card.
export function formatDuration(seconds) {
  const minutes = Math.floor(seconds / 60);
  return \`\${minutes}:\${String(seconds % 60).padStart(2, '0')}\`;
}
`;
