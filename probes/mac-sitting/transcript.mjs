// probes/mac-sitting/transcript.mjs
// Reads a session's transcript (~/.claude/projects/<folder>/<session id>.jsonl) for the second
// sitting: each tool call with its result, the hook refusals, the assistant's replies (marking one
// that is only the mod's status-line text, as the second attempt ended), and the user rows. Read
// only; needs no preparation, so it runs on a kept transcript too:
//
//   node transcript.mjs <file> calls [name pattern]   tool calls and their results
//   node transcript.mjs <file> refused                tool results a hook refused
//   node transcript.mjs <file> replies                the assistant's text replies
//   node transcript.mjs <file> users                  user rows: time, origin, first line
//   add --since ISO to any of them
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

export function readRows(file) {
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).flatMap((line) => {
    try {
      return [JSON.parse(line)];
    } catch {
      return [];
    }
  });
}

const parts = (row) => (Array.isArray(row?.message?.content) ? row.message.content : []);
const textOf = (content) => {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) return content.map((p) => (typeof p === 'string' ? p : p?.text ?? (p?.type === 'tool_reference' ? `[loaded ${p.tool_name}]` : ''))).join('\n');
  return '';
};
const after = (since) => (row) => since === undefined || Date.parse(row.timestamp ?? 0) >= Date.parse(since);
const clip = (text, n = 200) => (text.length > n ? `${text.slice(0, n)}…` : text);

// Each tool call whose name matches `pattern`, with its input and its result (or null while none).
export function calls(rows, { pattern = /./, since } = {}) {
  const results = new Map();
  for (const row of rows) {
    for (const p of parts(row)) {
      if (p?.type === 'tool_result') results.set(p.tool_use_id, { at: row.timestamp, error: p.is_error === true, text: clip(textOf(p.content)) });
    }
  }
  return rows.filter(after(since)).flatMap((row) => parts(row)
    .filter((p) => p?.type === 'tool_use' && pattern.test(p.name))
    .map((p) => ({ at: row.timestamp, name: p.name, input: clip(JSON.stringify(p.input ?? {})), result: results.get(p.id) ?? null })));
}

// Results that a hook refused: "PreToolUse:… hook error", or a guard's own words.
const REFUSED = /hook error|STOP is on: only|has not listed that connector|Wheelhouse is holding|denied by/i;
export function refused(rows, { since } = {}) {
  return calls(rows, { since }).filter((c) => c.result !== null && c.result.error && REFUSED.test(c.result.text));
}

// The mod's status-line text alone, as the second attempt's last reply was:
// "wheelhouse: Wheelhouse · 5 waiting · week 75%".
const STATUS_ONLY = /^\s*(?:wheelhouse:\s*)?Wheelhouse(?: · [^\n]*)?\s*$/;
export function replies(rows, { since } = {}) {
  return rows.filter(after(since)).filter((row) => row.type === 'assistant').flatMap((row) => parts(row)
    .filter((p) => p?.type === 'text' && typeof p.text === 'string' && p.text.trim() !== '')
    .map((p) => ({ at: row.timestamp, statusOnly: STATUS_ONLY.test(p.text), text: clip(p.text) })));
}

// User rows that aren't tool results: the prompts that reached the conversation.
export function users(rows, { since } = {}) {
  return rows.filter(after(since)).filter((row) => row.type === 'user' && !parts(row).some((p) => p?.type === 'tool_result')).map((row) => {
    const content = row.message?.content;
    const text = textOf(content);
    return { at: row.timestamp, origin: row.origin ?? row.message?.origin ?? null, first: clip(text.split('\n', 1)[0], 120), lines: text.split('\n').length };
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [file, command, ...rest] = process.argv.slice(2);
  const i = rest.indexOf('--since');
  const since = i >= 0 ? rest[i + 1] : undefined;
  const words = rest.filter((w, n) => n !== i && n !== i + 1);
  const rows = readRows(file);
  const answers = {
    calls: () => calls(rows, { pattern: new RegExp(words[0] ?? '.'), since }),
    refused: () => refused(rows, { since }),
    replies: () => replies(rows, { since }),
    users: () => users(rows, { since }),
  };
  if (!file || !answers[command]) {
    process.stdout.write('node transcript.mjs <file> calls [pattern] | refused | replies | users  [--since ISO]\n');
    process.exit(2);
  }
  process.stdout.write(`${JSON.stringify({ file, rows: rows.length, [command]: answers[command]() }, null, 2)}\n`);
}
