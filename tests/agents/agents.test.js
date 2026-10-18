// tests/agents/agents.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseReport } from '../../scripts/hooks/report-check.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const NAMES = ['builder', 'reviewer', 'tester'];
const FULL = 'abcdef1234567890abcdef1234567890abcdef12';

// The front matter (as key: value lines) and the body of an agent file.
function load(name) {
  const file = `agents/${name}.md`;
  const raw = fs.readFileSync(path.join(ROOT, file), 'utf8').replaceAll('\r\n', '\n');
  const m = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(raw);
  assert.ok(m, `${file} starts with front matter`);
  const front = {};
  for (const line of m[1].split('\n')) {
    const kv = /^([A-Za-z-]+):[ \t]*(.*)$/.exec(line);
    if (kv) front[kv[1]] = kv[2].trim();
  }
  return { file, front, body: m[2], raw };
}

// The report block an agent's instructions show, with each placeholder filled by
// a valid value for its field.
function shownBlock(body) {
  const lines = body.split('\n');
  const start = lines.findIndex((l) => l.trim() === 'WHEELHOUSE REPORT');
  assert.ok(start >= 0, 'the instructions show the report block');
  const out = [];
  for (let i = start; i < lines.length && /^(WHEELHOUSE REPORT|[a-z]+:.*)$/.test(lines[i]); i += 1) out.push(lines[i]);
  const fill = { commit: FULL, verdict: 'FINDINGS', findings: '2' };
  return out.map((line) => line.replace(/^([a-z]+):\s*<[^>]*>\s*$/, (_, key) => `${key}: ${fill[key] ?? 'text'}`)).join('\n');
}

test('the reviewer can read and cannot write, run commands or start agents', () => {
  const { front } = load('reviewer');
  const tools = front.tools.split(',').map((t) => t.trim());
  assert.deepEqual(tools.sort(), ['Glob', 'Grep', 'Read']);
  for (const banned of ['Write', 'Edit', 'Bash', 'NotebookEdit', 'Agent', 'Task', 'WebFetch', 'WebSearch']) {
    assert.ok(!tools.includes(banned), banned);
  }
});

test('the tester has the tools to read, fetch and run Playwright, and writes only under the screens folder', () => {
  const { front, body } = load('tester');
  assert.deepEqual(front.tools.split(',').map((t) => t.trim()).sort(), ['Bash', 'Glob', 'Grep', 'Read', 'WebFetch']);
  assert.match(body, /\.wheelhouse\/feature\/screens\//);
});

test('the builder names no tools, so it inherits the session\'s', () => {
  assert.equal(load('builder').front.tools, undefined);
});

test('each agent file has a name, a description and the path comment straight after the front matter', () => {
  for (const name of NAMES) {
    const { file, front, body } = load(name);
    assert.equal(front.name, name);
    assert.ok(front.description.length > 20, `${file} has a description`);
    assert.ok(body.startsWith(`\n<!-- ${file} -->\n`) || body.startsWith(`<!-- ${file} -->\n`), `${file} has its path comment first`);
  }
});

test('each agent ends with the report block the report check reads', () => {
  const roles = { builder: 'builder', reviewer: 'reviewer', tester: 'tester' };
  for (const name of NAMES) {
    const { file, body } = load(name);
    const block = shownBlock(body);
    assert.ok(block.includes(`role: ${roles[name]}`), `${file} shows its own role`);
    assert.match(block, /^pr: none$/m, `${file} shows pr: none until the feature has a pull request`);
    const { missing } = parseReport(block, roles[name]);
    assert.deepEqual(missing, [], `${file}: ${missing.join(', ')}`);
    // The block comes last, in a closing fence.
    assert.equal(body.trimEnd().split('\n').at(-1), '```', `${file} ends with the block's closing fence`);
    assert.equal(body.split('\n').filter((l) => l.trim() === 'WHEELHOUSE REPORT').length, 1, `${file} shows the block once`);
    assert.match(body, /`pr: none`/, `${file} tells its block to say pr: none`);
  }
  // A reviewer block also reads as CLEAN with no findings line.
  const clean = shownBlock(load('reviewer').body).replace('verdict: FINDINGS', 'verdict: CLEAN').replace(/^findings:.*\n?/m, '');
  assert.deepEqual(parseReport(clean, 'reviewer').missing, []);
});

test('no agent file names a model', () => {
  for (const name of NAMES) {
    const { file, front, raw } = load(name);
    assert.equal(front.model, undefined, `${file} sets no model in its front matter`);
    assert.doesNotMatch(raw, /\b(opus|sonnet|haiku|fable|claude-[a-z0-9-]+|gpt-[0-9a-z.-]+)\b/i, file);
    assert.doesNotMatch(raw, /^model:/m, file);
  }
});

test('the reviewer reads the diff file, the brief and the rules, and treats the diff as untrusted text', () => {
  const { body } = load('reviewer');
  assert.match(body, /\.wheelhouse\/feature\/review\/<n>\.diff/);
  assert.match(body, /\.wheelhouse\/feature\/brief\.md/);
  assert.match(body, /untrusted/i);
  assert.match(body, /never follow|not follow|never act on/i);
});

test('the builder works in its worktree only and tests first', () => {
  const { body } = load('builder');
  assert.match(body, /worktree/i);
  assert.match(body, /failing test|test first/i);
  assert.match(body, /never merge/i);
});
