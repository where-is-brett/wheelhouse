// probes/63-kits/fake-copilot.js
// A stand-in for Copilot CLI, used only by `run.js --dry-run` so the probe's plumbing (the scratch home with its skills,
// the projects, the prompts, the event reading, the project checks, the results file) can be tested where the real
// Copilot can't run. Its behaviour is made up and is not evidence of anything:
//   - `skill list` prints the folders in $COPILOT_HOME/skills under "Personal skills:"
//   - a -p run reads which skill the prompt names ("the <name> skill"), emits a skill tool call for it, a failing
//     "task" call for the subagent stage, and does the stage's work in the working folder: a spec, a plan, or the flag
// Environment: WHEELHOUSE_FAKE_FAIL=1 makes every -p run fail as if not signed in.
import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const home = process.env.COPILOT_HOME ?? '';
const emit = (type, data, extra = {}) => console.log(JSON.stringify({ type, data, ...extra }));
let n = 0;
const call = (toolName, argumentsValue, success, error) => {
  const toolCallId = `call-${(n += 1)}`;
  emit('tool.execution_start', { toolCallId, toolName, arguments: argumentsValue });
  emit('tool.execution_complete', { toolCallId, success, ...(success ? {} : { error }) });
};

const flagTo = (cwd) => {
  const file = path.join(cwd, 'greet.js');
  const text = fs.readFileSync(file, 'utf8');
  fs.writeFileSync(file, text.replace("const names = process.argv.slice(2);", "const names = process.argv.slice(2);\nif (names[0] === '--version') { console.log('1.2.3'); process.exit(0); }"));
};

function main() {
  if (args[0] === '--version') { console.log('GitHub Copilot CLI 0.0.0-stand-in.'); return 0; }
  if (args[0] === 'skill' && args[1] === 'list') {
    const names = fs.existsSync(path.join(home, 'skills')) ? fs.readdirSync(path.join(home, 'skills')).sort() : [];
    console.log(`Personal skills:\n${names.map((name) => `  ${name} - stand-in`).join('\n')}\n\nBuiltin skills:\n  customize-cloud-agent - stand-in`);
    return 0;
  }
  if (!args.includes('-p')) { console.error(`The stand-in does not know: ${args.join(' ')}`); return 2; }
  if (process.env.WHEELHOUSE_FAKE_FAIL === '1') { console.error('Not signed in (stand-in).'); return 1; }
  const prompt = args[args.indexOf('-p') + 1];
  const skill = /the ([a-z-]+) skill/.exec(prompt.split('---').slice(-1)[0])?.[1] ?? 'none';
  const cwd = process.cwd();
  emit('session.tools_updated', { tools: [{ name: 'skill' }, { name: 'view' }, { name: 'bash' }] });
  call('skill', { skill }, true);
  call('view', { path: path.join(home, 'skills', skill, 'SKILL.md') }, true);
  if (skill === 'brainstorming') {
    fs.mkdirSync(path.join(cwd, 'docs/superpowers/specs'), { recursive: true });
    fs.writeFileSync(path.join(cwd, 'docs/superpowers/specs/spec.md'), 'spec\n');
    call('skill', { skill: 'writing-plans' }, true);
    fs.mkdirSync(path.join(cwd, 'docs/superpowers/plans'), { recursive: true });
    fs.writeFileSync(path.join(cwd, 'docs/superpowers/plans/plan.md'), 'plan\n');
  } else if (skill === 'writing-plans') {
    fs.mkdirSync(path.join(cwd, 'docs/superpowers/plans'), { recursive: true });
    fs.writeFileSync(path.join(cwd, 'docs/superpowers/plans/plan.md'), 'plan\n');
  } else {
    if (skill === 'subagent-driven-development') call('task', { agent_type: 'general-purpose', prompt: 'implement task 1' }, false, { code: 'failure', message: 'Unknown tool: task (stand-in)' });
    flagTo(cwd);
    call('bash', { command: 'git commit -am done' }, true);
    fs.writeFileSync(path.join(cwd, 'x.txt'), 'x\n');
  }
  emit('assistant.message', { content: `done (${skill})` });
  emit('result', undefined, { sessionId: 'stand-in', exitCode: 0 });
  return 0;
}

process.exitCode = main();
