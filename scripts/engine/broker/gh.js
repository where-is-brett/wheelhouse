// scripts/engine/broker/gh.js
// The broker: the only gh on Archon's PATH (Archon design, section 12.4), installed by setup as
// <engine>/broker/bin/gh, a two-line launcher calling this. It holds no key and interprets nothing: it sends the exact
// call (its arguments, folder and standard input) to the helper, and writes back the real gh's output and exit code
// unchanged, or the helper's plain reason for refusing it.
import { helperClient } from '../../host/helper-client.js';
import { startedAsScript } from '../../lib/started-as-script.js';

async function readStdin(stream = process.stdin) {
  if (stream.isTTY) return '';
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8');
}

export async function main(argv = process.argv.slice(2), {
  client = helperClient({ timeout: 300000 }), cwd = process.cwd(), stdin = readStdin,
  stdout = (text) => process.stdout.write(text), stderr = (text) => process.stderr.write(text),
} = {}) {
  const got = await client.broker.gh({ argv, cwd, stdin: await stdin() });
  if (got?.ok !== true) {
    stderr(`Wheelhouse's broker couldn't ask the helper: ${got?.refused ?? 'no answer'}\n`);
    return 1;
  }
  stdout(String(got.stdout ?? ''));
  stderr(String(got.stderr ?? ''));
  return Number.isInteger(got.code) ? got.code : 1;
}

if (startedAsScript(import.meta.url)) process.exitCode = await main();
