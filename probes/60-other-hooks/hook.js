// probes/60-other-hooks/hook.js
// The hook for check 60. It logs everything Copilot gives it, then answers as told.
// Run as: node hook.js <log file> <tag> <event> <mode> [field [token]]
//   mode log (default)   print nothing, exit 0
//   mode marker          answer with a marker sentence through <field>, which carries <token>:
//                          additionalContext   {"additionalContext": sentence}
//                          hookSpecific        {"hookSpecificOutput": {"hookEventName": event, "additionalContext": sentence}}
//                          systemMessage       {"systemMessage": sentence}
//                          modifiedPrompt      {"modifiedPrompt": the prompt it was given, then the sentence}
//                          plain               the sentence as plain text on stdout
//   mode block           print {"decision":"block","reason":...}, exit 0
//   mode exit2           exit 2 (stderr says why)
// The tag names the registration (spelling and field) so the log says which hook ran.
import { appendJsonl } from '../lib/log.js';

const [file, tag, event, mode = 'log', field = '', token = ''] = process.argv.slice(2);

// Names of the variables that might say how Copilot is run. Values are kept only for Copilot's own (COPILOT_*)
// variables, never for the caller's: a caller's environment can hold anything.
const ENV_NAME = /^(COPILOT|CLAUDE|GITHUB|GH_|CODESPACES|SANDBOX|TERM_PROGRAM|CI$)|SANDBOX/i;
const SECRET_NAME = /token|key|secret|auth|pass/i;

export function sentence(code) {
  return `Wheelhouse probe 60 note: the marker for this hook is ${code}.`;
}

export function promptOf(input) {
  const value = input?.prompt ?? input?.userPrompt ?? input?.user_prompt ?? input?.initialPrompt;
  return typeof value === 'string' ? value : null;
}

// What the hook prints, or null for nothing.
export function answerFor({ mode, field, token, event, input }) {
  if (mode === 'block') return JSON.stringify({ decision: 'block', reason: 'Wheelhouse probe 60 blocks this' });
  if (mode !== 'marker') return null;
  const text = sentence(token);
  if (field === 'additionalContext') return JSON.stringify({ additionalContext: text });
  if (field === 'hookSpecific') return JSON.stringify({ hookSpecificOutput: { hookEventName: event, additionalContext: text } });
  if (field === 'systemMessage') return JSON.stringify({ systemMessage: text });
  if (field === 'modifiedPrompt') {
    const prompt = promptOf(input);
    return prompt === null ? null : JSON.stringify({ modifiedPrompt: `${prompt}\n\n${text}` });
  }
  if (field === 'plain') return text;
  return null;
}

export function environment(env = process.env) {
  const found = {};
  for (const [name, value] of Object.entries(env)) {
    if (ENV_NAME.test(name)) found[name] = /^COPILOT_/.test(name) && !SECRET_NAME.test(name) ? value : '[set]';
  }
  return found;
}

async function main() {
  let raw = '';
  let input;
  try {
    process.stdin.setEncoding('utf8');
    for await (const chunk of process.stdin) raw += chunk;
    try { input = JSON.parse(raw); } catch { input = { unparsed: raw }; }
    if (file) await appendJsonl(file, { at: new Date().toISOString(), tag, event, mode, field, cwd: process.cwd(), raw, input, env: environment() });
  } catch {
    // Logging must never change what Copilot does.
  }
  if (mode === 'exit2') {
    process.stderr.write('probe 60 hook: exiting 2\n');
    process.exit(2);
  }
  const answer = answerFor({ mode, field, token, event, input });
  if (answer !== null) process.stdout.write(answer + '\n');
  process.exit(0);
}

import { pathToFileURL } from 'node:url';
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
