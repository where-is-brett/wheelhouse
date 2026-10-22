// tests/helpers/stood-in.js
// The names of the host programs no test may run, and the `run` that refuses them. Apart from
// host-stand-ins.js so a helper process that isn't a test can use it (tests/helpers/helper-process.js).
export const STOOD_IN = Object.freeze(['gh', 'glab', 'copilot', 'claude', 'launchctl', 'osascript', 'open', 'xdg-open', 'security', 'brew', 'sudo', 'installer', 'softwareupdate', 'curl']);

// A `run` for a test that starts real code (the helper) with real programs it may need, git above
// all: it refuses, without starting it, any program whose base name (without .exe, .cmd, .bat or .com, whatever its case) is
// a stood-in host tool, noting `<name> <args>` in `log`, and hands every other program to `run`.
export function guardedRun(run, { log = [] } = {}) {
  return (file, args = [], options) => {
    const name = String(file).split(/[\\/]/).pop().replace(/\.(exe|cmd|bat|com)$/i, '').toLowerCase();
    if (!STOOD_IN.includes(name)) return run(file, args, options);
    log.push([name, ...args].join(' '));
    return Promise.resolve({ code: 1, stdout: '', stderr: `${name} is not run in this test` });
  };
}
