// tests/helpers/quiet-run.js
// The fake computer setup's tests run steps 2 and 6 on: every tool on the path, at a version good
// enough; nothing real runs. Kept apart from setup-quiet-steps.js, which reads its world as it
// loads, so a module with a world of its own can use it too.
export async function quietRun(file, args = []) {
  const name = file.split(/[\\/]/).pop();
  const answer = (stdout, code = 0) => ({ code, stdout, stderr: '' });
  if (name === 'which' || name === 'where') return answer(`/usr/bin/${args[0]}\n`);
  if (name === 'xcode-select' && args[0] === '-p') return answer('/Library/Developer/CommandLineTools\n');
  if (args[0] === '--version') return answer(name === 'node' ? 'v22.3.0\n' : `${name} version 2.40.0\n`);
  return answer('');
}
