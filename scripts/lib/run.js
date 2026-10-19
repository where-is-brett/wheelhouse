// scripts/lib/run.js
import { spawn } from 'node:child_process';

// Ends a process and everything it started, on Windows, where killing the process
// alone leaves its children running and holding the pipes.
function taskkill(file, args) {
  try {
    spawn(file, args, { stdio: 'ignore', windowsHide: true, shell: false }).on('error', () => {}).unref();
  } catch { /* the process may already be gone */ }
}

// The environment with every GIT_* variable taken out, so git run from inside
// a hook or another git command does not pick up that command's repository,
// config or settings.
export function withoutGitVars(env = process.env) {
  return Object.fromEntries(Object.entries(env).filter(([name]) => !/^GIT_/i.test(name)));
}

// Runs a program without a shell. `env` is merged over `baseEnv` (process.env
// unless given); `input`, when given, is written to stdin and stdin is closed.
// With `timeoutMs`, a program still running then is killed and the result
// carries `timedOut: true`; on Windows it is ended with `taskkill /pid <pid> /T /F`, which
// takes its children too (`platform` and `killer` are for tests). With `signal` (an AbortSignal), the
// program is ended the same way when the signal is aborted, and the result carries `stopped: true`. A variable in `env`
// whose value is undefined or null is removed from the environment. With `limit` (bytes), only about the newest `limit`
// bytes of each stream are kept while it runs. With `windowsVerbatimArguments` (Windows only), the
// arguments are passed to the program as they are, without Node's quoting, for `cmd.exe /c`. With `encoding: 'buffer'`,
// stdout comes back as a Buffer of the bytes the program wrote. Resolves with the exit code and the collected
// output; rejects only if the program cannot be started.
export function run(file, args = [], { cwd, env, input, baseEnv = process.env, timeoutMs, limit, platform = process.platform, killer = taskkill, windowsVerbatimArguments = false, encoding = 'utf8', signal } = {}) {
  return new Promise((resolve, reject) => {
    const merged = { ...baseEnv, ...env };
    for (const name of Object.keys(merged)) if (merged[name] === undefined || merged[name] === null) delete merged[name];
    const child = spawn(file, args, {
      cwd,
      env: merged,
      shell: false,
      windowsHide: true,
      windowsVerbatimArguments,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const out = [];
    const err = [];
    let settled = false;
    const text = () => ({ stdout: encoding === 'buffer' ? Buffer.concat(out) : Buffer.concat(out).toString('utf8'), stderr: Buffer.concat(err).toString('utf8') });
    let timer = null;
    // Ends the program and everything it started, and resolves with `ending` added to the result.
    const end = (ending) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      if (platform === 'win32' && Number.isInteger(child.pid)) killer('taskkill', ['/pid', String(child.pid), '/T', '/F']);
      child.kill('SIGKILL');
      // A grandchild may still hold the pipes open; stop waiting for them.
      child.stdout.destroy();
      child.stderr.destroy();
      resolve({ code: 1, ...text(), ...ending });
    };
    const onAbort = () => end({ stopped: true });
    if (Number.isFinite(timeoutMs) && timeoutMs > 0) timer = setTimeout(() => end({ timedOut: true }), timeoutMs);
    const keep = (chunks) => {
      let size = 0;
      return (d) => {
        chunks.push(d);
        size += d.length;
        // Drop whole old chunks while the rest still holds `limit` bytes.
        while (Number.isFinite(limit) && chunks.length > 1 && size - chunks[0].length >= limit) size -= chunks.shift().length;
      };
    };
    child.stdout.on('data', keep(out));
    child.stderr.on('data', keep(err));
    child.on('error', (error) => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      if (!settled) { settled = true; reject(error); }
    });
    child.stdin.on('error', () => {}); // the child may exit without reading its input
    child.on('close', (code) => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      if (settled) return;
      settled = true;
      resolve({ code: code ?? 1, ...text() });
    });
    child.stdin.end(input);
    if (signal?.aborted) onAbort();
    else signal?.addEventListener('abort', onAbort, { once: true });
  });
}
