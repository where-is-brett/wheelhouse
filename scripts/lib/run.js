// scripts/lib/run.js
import { spawn } from 'node:child_process';

// Ends a process and everything it started, on Windows, where killing the process
// alone leaves its children running and holding the pipes and their folders. Resolves once
// taskkill has finished (or could not start), so the caller can remove what they held.
function taskkill(file, args) {
  return new Promise((resolve) => {
    try {
      spawn(file, args, { stdio: 'ignore', windowsHide: true, shell: false }).on('error', resolve).on('exit', resolve);
    } catch { resolve(); /* the process may already be gone */ }
  });
}

// How long an ending waits for taskkill before answering anyway.
const KILL_WAIT_MS = 10000;

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
// takes its children too, and the result comes once taskkill has finished (`platform` and `killer` are for tests). With `signal` (an AbortSignal), the
// program is ended the same way when the signal is aborted, and the result carries `stopped: true`. A variable in `env`
// whose value is undefined or null is removed from the environment. With `limit` (bytes), only about the newest `limit`
// bytes of each stream are kept while it runs. With `windowsVerbatimArguments` (Windows only), the
// arguments are passed to the program as they are, without Node's quoting, for `cmd.exe /c`. With `encoding: 'buffer'`,
// stdout comes back as a Buffer of the bytes the program wrote. With `onOutput(text)`, each piece of output, from either
// stream, is also given as it comes, for a program that shows something to read before it finishes (a sign-in code);
// with `onStdout(text)`, each piece of standard output alone, for a program whose output is read as it comes.
// Resolves with the exit code and the collected
// output; rejects only if the program cannot be started.
export function run(file, args = [], { cwd, env, input, baseEnv = process.env, timeoutMs, limit, platform = process.platform, killer = taskkill, windowsVerbatimArguments = false, encoding = 'utf8', onOutput, onStdout, signal } = {}) {
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
      // A grandchild may still hold the pipes open; stop waiting for them.
      child.stdout.destroy();
      child.stderr.destroy();
      const result = { code: 1, ...text(), ...ending };
      // On Windows taskkill walks the tree from the program, so the program itself is killed only after it: killed
      // first, its children would be left running, holding their folders.
      const killed = platform === 'win32' && Number.isInteger(child.pid) ? killer('taskkill', ['/pid', String(child.pid), '/T', '/F']) : null;
      let waited = null;
      Promise.race([Promise.resolve(killed), new Promise((done) => { waited = setTimeout(done, KILL_WAIT_MS); })])
        .catch(() => {}).then(() => {
          clearTimeout(waited);
          child.kill('SIGKILL');
          resolve(result);
        });
    };
    const onAbort = () => end({ stopped: true });
    if (Number.isFinite(timeoutMs) && timeoutMs > 0) timer = setTimeout(() => end({ timedOut: true }), timeoutMs);
    const keep = (chunks, own) => {
      let size = 0;
      return (d) => {
        for (const reader of [onOutput, own]) {
          if (typeof reader !== 'function') continue;
          try { reader(d.toString('utf8')); } catch { /* the caller's reading never stops the program */ }
        }
        chunks.push(d);
        size += d.length;
        // Drop whole old chunks while the rest still holds `limit` bytes.
        while (Number.isFinite(limit) && chunks.length > 1 && size - chunks[0].length >= limit) size -= chunks.shift().length;
      };
    };
    child.stdout.on('data', keep(out, onStdout));
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
