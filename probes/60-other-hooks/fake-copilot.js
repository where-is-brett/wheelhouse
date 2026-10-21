// probes/60-other-hooks/fake-copilot.js
// A stand-in for Copilot CLI, used only by `run.js --dry-run` so the probe's plumbing (the hook files, the prompts,
// the resumed and fresh /compact runs, the marker and compaction analysis, the results file) can be tested where the
// real Copilot can't run. Its rules are made up and are not evidence of anything:
//   - it reads $COPILOT_HOME/hooks/*.json (flat entries, either spelling)
//   - sessionStart and userPromptSubmitted hooks that answer additionalContext or hookSpecificOutput add to what it
//     "reads"; a prompt mentioning WHMARK gets a reply listing the marker codes it read
//   - a prompt of /compact runs the preCompact hooks; one that prints decision block or exits 2 stops the compaction,
//     otherwise it prints compaction events; the /compact is only understood on a resumed session
//   - a prompt naming the task tool runs the subagentStart and subagentStop hooks with an input that names the agent
//   - every prompt run reports session id stand-in-session
// Environment: WHEELHOUSE_FAKE_FAIL=1 makes a prompt run exit 1 without running any hook; WHEELHOUSE_FAKE_NO_COMPACT=1
// makes /compact an ordinary prompt.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const args = process.argv.slice(2);
const home = process.env.COPILOT_HOME;
const cwd = process.cwd();

const readJson = (file) => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; } };

function registrations() {
  const dir = path.join(home ?? '', 'hooks');
  let names = [];
  try { names = fs.readdirSync(dir).filter((n) => n.endsWith('.json')).sort(); } catch { return []; }
  const found = [];
  for (const name of names) {
    const data = readJson(path.join(dir, name));
    for (const [event, list] of Object.entries(data?.hooks ?? {})) {
      for (const item of Array.isArray(list) ? list : []) found.push({ event, command: item.bash ?? item.command, timeoutSec: item.timeoutSec ?? 30 });
    }
  }
  return found.filter((r) => r.command);
}

// Runs every hook registered for `event` (any spelling) and returns what each answered.
function fire(event, input) {
  const answers = [];
  for (const r of registrations()) {
    if (r.event.toLowerCase().replace(/ted$/, '') !== event.toLowerCase().replace(/ted$/, '')) continue;
    const out = spawnSync(r.command, { shell: true, input: JSON.stringify({ sessionId: 'stand-in-session', timestamp: '2026-10-21T00:00:00.000Z', cwd, ...input }), cwd, env: process.env, encoding: 'utf8', timeout: r.timeoutSec * 1000 });
    let json = null;
    try { json = JSON.parse(out.stdout || ''); } catch { /* plain text or nothing */ }
    answers.push({ status: out.status, json, text: out.stdout });
  }
  return answers;
}

const [first] = args;
if (first === '--version' || first === '-v') {
  console.log('GitHub Copilot CLI 0.0.0-stand-in.');
} else if (args.includes('-p')) {
  if (process.env.WHEELHOUSE_FAKE_FAIL === '1') {
    console.error('Not signed in (stand-in).');
    process.exit(1);
  }
  const original = args[args.indexOf('-p') + 1];
  let prompt = original;
  const resumed = args.some((arg) => arg.startsWith('--resume'));
  const read = [];
  const take = (answers) => {
    for (const a of answers) {
      const text = a.json?.additionalContext ?? a.json?.hookSpecificOutput?.additionalContext;
      if (text) read.push(text);
      if (a.json?.modifiedPrompt) prompt += a.json.modifiedPrompt.slice(original.length);
    }
  };
  const emit = (event) => console.log(JSON.stringify(event));
  take(fire('sessionStart', { source: 'new', initialPrompt: prompt }));
  take(fire('userPromptSubmitted', { prompt }));
  emit({ type: 'user.message', data: { content: prompt } });
  let reply = 'done';
  if (prompt.trim() === '/compact' && process.env.WHEELHOUSE_FAKE_NO_COMPACT !== '1') {
    if (!resumed) {
      reply = 'Nothing to compact.';
    } else {
      const answers = fire('preCompact', { trigger: 'manual' });
      const blocked = answers.some((a) => a.status === 2 || a.json?.decision === 'block');
      if (!blocked) {
        emit({ type: 'session.compaction_start', data: {} });
        emit({ type: 'session.compaction_complete', data: { success: true } });
      }
      reply = blocked ? 'Compaction blocked.' : 'Compacted.';
    }
  } else if (/task tool/i.test(prompt)) {
    fire('subagentStart', { agentName: 'probe-agent' });
    emit({ type: 'tool.execution_start', data: { toolCallId: 't1', toolName: 'task' } });
    emit({ type: 'tool.execution_complete', data: { toolCallId: 't1', success: true } });
    fire('subagentStop', { agentName: 'probe-agent', transcriptPath: '/stand-in' });
  } else if (/WHMARK/.test(prompt)) {
    const codes = read.map((text) => text.match(/WHMARK-\w+/)?.[0]).filter(Boolean);
    reply = codes.length ? codes.map((code, i) => `${code} line ${i}`).join('\n') : 'none';
  }
  emit({ type: 'assistant.message', data: { content: reply } });
  emit({ type: 'result', sessionId: 'stand-in-session', exitCode: 0, usage: { premiumRequests: 0 } });
} else {
  console.error(`The stand-in does not know: ${args.join(' ')}`);
  process.exit(2);
}
