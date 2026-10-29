// scripts/engine/broker/git-credential.js
// A git credential helper for Archon's runs (Archon design, section 12.4; ruling 8 of part 3b): git asks it for the
// project's repository, and it asks the helper, which answers only for the project's own repository on its host, with
// the narrow connection's key where there is one. It answers fetches as well as pushes; the branch rules are the
// helper's push route's and the host's. It stores and erases nothing.
//   git -c credential.helper='!node <path>/git-credential.js' ...
import { helperClient } from '../../host/helper-client.js';
import { startedAsScript } from '../../lib/started-as-script.js';

async function readStdin(stream = process.stdin) {
  if (stream.isTTY) return '';
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8');
}

export async function main(argv = process.argv.slice(2), { client = helperClient({ timeout: 30000 }), cwd = process.cwd(), stdin = readStdin, out = (text) => process.stdout.write(text) } = {}) {
  const action = argv[0];
  // git also calls `store` and `erase`; nothing is kept, so there is nothing to do.
  if (action !== 'get') return 0;
  const got = await client.broker.credential({ cwd, action, request: await stdin() });
  if (got?.ok === true && typeof got.username === 'string' && typeof got.password === 'string') {
    out(`username=${got.username}\npassword=${got.password}\n`);
  }
  return 0;
}

if (startedAsScript(import.meta.url)) process.exitCode = await main();
