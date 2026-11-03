// tests/helpers/fake-curl.js
// A stand-in for the system's `curl`, run through an injected `run`. It records each call (the file,
// the arguments, the config given on standard input and the environment it was given) and answers
// from a queue of { status, body, exit, connect, stderr }. It fills the --write-out marker the way
// curl would, so code that reads the marker is tested against its real shape.
const ANSWER = { status: 200, body: '', exit: 0, connect: 0, stderr: '' };

// The config text read as [key, value] pairs. A quoted value is unescaped the way curl does it.
export function parseConfig(text) {
  const out = [];
  for (const line of String(text ?? '').split('\n')) {
    const found = /^([a-z0-9-]+)(?:\s*=\s*(.*))?$/.exec(line.trim());
    if (found === null) continue;
    let value = found[2] ?? true;
    if (typeof value === 'string' && value.startsWith('"')) {
      value = value.slice(1, -1).replace(/\\([\\"nrtv])/g, (_, c) => ({ n: '\n', r: '\r', t: '\t', v: '\v' }[c] ?? c));
    }
    out.push([found[1], value]);
  }
  return out;
}

export function makeFakeCurl(queue = []) {
  const answers = [...queue];
  const calls = [];
  async function run(file, args = [], options = {}) {
    const config = String(options.input ?? '');
    calls.push({ file, args: [...args], config, pairs: parseConfig(config), baseEnv: options.baseEnv ?? null, env: options.env ?? null });
    const answer = { ...ANSWER, ...(answers.shift() ?? {}) };
    const format = args[args.indexOf('--write-out') + 1] ?? '';
    const tail = format.replace('%{http_code}', String(answer.exit !== 0 ? 0 : answer.status)).replace('%{http_connect}', String(answer.connect)).replace(/\\n/g, '\n');
    // curl writes the --write-out text after a failure too, with the status it had (0 when none).
    const failed = answer.exit !== 0;
    return { code: answer.exit, stdout: failed ? tail : `${answer.body}${tail}`, stderr: answer.stderr };
  }
  return { run, calls, queue: answers };
}
