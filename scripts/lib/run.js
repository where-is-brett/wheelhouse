// scripts/lib/run.js
import { spawn } from 'node:child_process';

// The environment with every GIT_* variable taken out, so git run from inside
// a hook or another git command does not pick up that command's repository,
// config or settings.
export function withoutGitVars(env = process.env) {
  return Object.fromEntries(Object.entries(env).filter(([name]) => !/^GIT_/i.test(name)));
}

// Runs a program without a shell. `env` is merged over `baseEnv` (process.env
// unless given); `input`, when given, is written to stdin and stdin is closed.
// With `timeoutMs`, a program still running then is killed and the result
// carries `timedOut: true`. Resolves with the exit code and the collected
// output; rejects only if the program cannot be started.
export function run(file, args = [], { cwd, env, input, baseEnv = process.env, timeoutMs } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(file, args, {
      cwd,
      env: { ...baseEnv, ...env },
      shell: false,
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const out = [];
    const err = [];
    let settled = false;
    const text = () => ({ stdout: Buffer.concat(out).toString('utf8'), stderr: Buffer.concat(err).toString('utf8') });
    let timer = null;
    if (Number.isFinite(timeoutMs) && timeoutMs > 0) {
      timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        child.kill('SIGKILL');
        // A grandchild may still hold the pipes open; stop waiting for them.
        child.stdout.destroy();
        child.stderr.destroy();
        resolve({ code: 1, ...text(), timedOut: true });
      }, timeoutMs);
    }
    child.stdout.on('data', (d) => out.push(d));
    child.stderr.on('data', (d) => err.push(d));
    child.on('error', (error) => {
      clearTimeout(timer);
      if (!settled) { settled = true; reject(error); }
    });
    child.stdin.on('error', () => {}); // the child may exit without reading its input
    child.on('close', (code) => {
      clearTimeout(timer);
      if (settled) return;
      settled = true;
      resolve({ code: code ?? 1, ...text() });
    });
    child.stdin.end(input);
  });
}
