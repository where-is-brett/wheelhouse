// probes/61-sessions/fake-copilot.js
// A stand-in for Copilot CLI, used only by `run.js --dry-run` so the probe's plumbing (the worktree, the link, the
// homes, the environments, the prompts, the file checks, the results file) can be tested where the real Copilot can't
// run. Its rules are made up and are not evidence of anything:
//   - a prompt step reads "Use the <shell|view|create> tool ... `argument` ..."; the stand-in does those steps for real
//   - a session is saved in $COPILOT_HOME/session-state/<id>.json; --resume=<id> and --continue load one
//   - a shell command runs only if it matches an --allow-tool shell(word:*) rule (first word, and no `&&` or `$(`),
//     or --allow-all-tools or COPILOT_ALLOW_ALL is on, and no --deny-tool rule matches; a deny beats everything
//   - a file tool may touch the working folder and its subfolders, and the temporary folder unless --disallow-temp-dir;
//     links are followed, as the real path decides; create needs --allow-tool=write (or allow-all)
//   - $HOME containing "person-home" has no keychain, so the run says it is not signed in
// Environment: WHEELHOUSE_FAKE_NAIVE=1 makes a shell rule match on the first word alone (so a chained command gets through).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';

const args = process.argv.slice(2);
const home = process.env.COPILOT_HOME ?? '';
const cwd = process.cwd();
const flag = (name) => args.includes(name);
const values = (name) => args.filter((arg) => arg.startsWith(`${name}=`)).map((arg) => arg.slice(name.length + 1));
const emit = (type, data, extra = {}) => console.log(JSON.stringify({ type, data, ...extra }));

function main() {
  if (args[0] === '--version') { console.log('GitHub Copilot CLI 0.0.0-stand-in.'); return 0; }
  if (!args.includes('-p')) { console.error(`The stand-in does not know: ${args.join(' ')}`); return 2; }
  if (process.env.WHEELHOUSE_FAKE_FAIL === '1' || /person-home/.test(process.env.HOME ?? '')) { console.error('Not signed in (stand-in).'); return 1; }

  const prompt = args[args.indexOf('-p') + 1];
  const dir = path.join(home, 'session-state');
  fs.mkdirSync(dir, { recursive: true });
  let id;
  const resume = values('--resume')[0];
  if (resume) id = resume;
  else if (flag('--continue')) {
    const newest = fs.readdirSync(dir).filter((n) => n.endsWith('.json')).map((n) => ({ n, t: fs.statSync(path.join(dir, n)).mtimeMs })).sort((a, b) => b.t - a.t)[0];
    id = newest ? newest.n.replace(/\.json$/, '') : null;
  } else id = crypto.randomUUID();
  const file = id ? path.join(dir, `${id}.json`) : null;
  if (!file || (!fs.existsSync(file) && (resume || flag('--continue')))) { console.error(`No session to resume (stand-in).`); return 1; }
  const session = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : { prompts: [], memory: '' };

  const allowAll = flag('--allow-all-tools') || /^(true|1|yes|on|y)$/i.test((process.env.COPILOT_ALLOW_ALL ?? '').trim());
  const allow = values('--allow-tool');
  const deny = values('--deny-tool');
  const naive = process.env.WHEELHOUSE_FAKE_NAIVE === '1';
  const matches = (rule, command) => {
    const m = /^shell\(([^:)]+):\*\)$/.exec(rule);
    if (!m) return false;
    const word = command.trim().split(/\s+/)[0];
    return word === m[1] && (naive || !/&&|\$\(|;|\|/.test(command));
  };
  const shellAllowed = (command) => !deny.some((rule) => matches(rule, command)) && (allowAll ? true : allow.some((rule) => matches(rule, command)));
  const writeAllowed = allowAll || allow.includes('write');
  const real = (p) => { try { return fs.realpathSync(p); } catch { return path.resolve(p); } };
  const inside = (p, root) => p === root || p.startsWith(root + path.sep);
  const pathAllowed = (p) => {
    const target = fs.existsSync(p) ? real(p) : path.join(real(path.dirname(p)), path.basename(p));
    return inside(target, real(cwd)) || (!flag('--disallow-temp-dir') && inside(target, real(os.tmpdir())));
  };

  emit('session.tools_updated', { tools: [{ name: 'view' }, { name: 'bash' }, ...(flag('--no-ask-user') ? [] : [{ name: 'ask_user' }])] });
  const agent = args.includes('--agent') ? args[args.indexOf('--agent') + 1] : null;
  let reply = 'done';
  if (agent) {
    try { reply = fs.readFileSync(path.join(home, 'agents', `${agent}.agent.md`), 'utf8').match(/single word (\S+)/)[1]; } catch { reply = 'no such agent'; }
  }
  if (/what was the secret word/i.test(prompt)) reply = session.memory || 'I do not know';
  let n = 0;
  for (const line of prompt.split('\n')) {
    const m = /Use the (\w+) tool .*?`([^`]+)`/.exec(line);
    if (!m) continue;
    const [, tool, argument] = m;
    const toolCallId = `call-${++n}`;
    const toolName = tool === 'shell' ? 'bash' : tool;
    emit('tool.execution_start', { toolCallId, toolName, arguments: tool === 'shell' ? { command: argument } : { path: argument } });
    const done = (success, result, code, message) => emit('tool.execution_complete', { toolCallId, success, ...(success ? { result } : { error: { code, message } }) });
    if (tool === 'shell') {
      if (!shellAllowed(argument)) { done(false, '', 'denied', 'The user did not approve this command (stand-in)'); continue; }
      const out = spawnSync('sh', ['-c', argument], { cwd, encoding: 'utf8' });
      done(out.status === 0, out.stdout, 'failure', out.stderr);
    } else if (tool === 'view') {
      if (!pathAllowed(argument)) { done(false, '', 'denied', 'Path not permitted (stand-in)'); continue; }
      try { const text = fs.readFileSync(argument, 'utf8'); session.memory = (text.match(/secret-\w+/) ?? [''])[0] || session.memory; done(true, text); } catch (e) { done(false, '', 'failure', String(e.message)); }
    } else if (tool === 'create') {
      if (!writeAllowed) { done(false, '', 'denied', 'The user did not approve this write (stand-in)'); continue; }
      if (!pathAllowed(argument)) { done(false, '', 'denied', 'Path not permitted (stand-in)'); continue; }
      fs.writeFileSync(argument, 'created\n');
      done(true, 'created');
    }
  }
  session.prompts.push(prompt);
  fs.writeFileSync(file, JSON.stringify(session));
  emit('assistant.message', { content: reply });
  console.log(JSON.stringify({ type: 'result', sessionId: id, exitCode: 0, usage: { premiumRequests: 0 } }));
  return 0;
}

process.exitCode = main();
