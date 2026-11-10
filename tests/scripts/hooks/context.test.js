// tests/scripts/hooks/context.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { contextSize, decide as gauge, updateSession } from '../../../scripts/hooks/context-gauge.js';
import { decide as onTool } from '../../../scripts/hooks/feature-status.js';
import { writeProject } from '../../../scripts/lib/projects.js';

const temp = (prefix) => fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));

async function withHome(fn) {
  const home = temp('wh-ctx-home-');
  const before = process.env.WHEELHOUSE_HOME;
  process.env.WHEELHOUSE_HOME = home;
  try { return await fn(home); } finally {
    if (before === undefined) delete process.env.WHEELHOUSE_HOME; else process.env.WHEELHOUSE_HOME = before;
    fs.rmSync(home, { recursive: true, force: true });
  }
}

function makeProject() {
  const base = temp('wh-ctx-repo-');
  const main = path.join(base, 'main');
  fs.mkdirSync(main);
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: main, stdio: 'pipe' });
  writeProject('owner__name', {
    folder: main, remoteUrl: 'https://example.com/owner/name.git', host: 'github', repo: 'owner/name', connection: {},
  });
  return { base, main };
}

const assistant = (usage, extra = {}) => JSON.stringify({ type: 'assistant', message: { role: 'assistant', model: 'm', usage, ...extra } });
const usage = (i, r, c) => ({ input_tokens: i, cache_read_input_tokens: r, cache_creation_input_tokens: c, output_tokens: 9 });
const writeTranscript = (dir, lines) => {
  const file = path.join(dir, 't.jsonl');
  fs.writeFileSync(file, `${lines.join('\n')}\n`);
  return file;
};
const sessionFile = (home, id) => path.join(home, 'projects', 'owner__name', 'sessions', `${id}.json`);

test('contextSize adds the three input counts of the last assistant entry', () => {
  const dir = temp('wh-ctx-t-');
  try {
    const file = writeTranscript(dir, [
      assistant(usage(1, 2, 3)),
      'not json',
      assistant(usage(5, 100000, 20000)),
      assistant(usage(9, 9, 9), { model: '<synthetic>' }),
      JSON.stringify({ type: 'user', message: { role: 'user', content: 'x' } }),
      assistant({ input_tokens: 'many' }),
    ]);
    assert.equal(contextSize(file), 120005);
    // Only the tail is read: a long file with a cut first line still works.
    const big = writeTranscript(dir, ['x'.repeat(400 * 1024), assistant(usage(1, 1, 1))]);
    assert.equal(contextSize(big), 3);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('contextSize ignores sidechains and reads nothing across a compaction', () => {
  const dir = temp('wh-ctx-t-');
  try {
    const boundary = JSON.stringify({ type: 'system', subtype: 'compact_boundary' });
    const side = JSON.stringify({ type: 'assistant', isSidechain: true, message: { role: 'assistant', model: 'm', usage: usage(999, 0, 0) } });
    assert.equal(contextSize(writeTranscript(dir, [assistant(usage(5, 0, 0)), side])), 5);
    assert.equal(contextSize(writeTranscript(dir, [assistant(usage(300000, 0, 0)), boundary])), null);
    assert.equal(contextSize(writeTranscript(dir, [assistant(usage(300000, 0, 0)), boundary, side])), null);
    assert.equal(contextSize(writeTranscript(dir, [assistant(usage(300000, 0, 0)), boundary, assistant(usage(7, 30000, 0))])), 30007);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('the gauge still speaks when the reading cannot be stored', async () => {
  await withHome(async (home) => {
    const { base, main } = makeProject();
    try {
      fs.mkdirSync(path.join(home, 'projects', 'owner__name'), { recursive: true });
      fs.writeFileSync(path.join(home, 'projects', 'owner__name', 'sessions'), 'a file, not a folder');
      const t = writeTranscript(base, [assistant(usage(1, 41000, 0))]);
      const out = await gauge({ cwd: main, session_id: 's1', transcript_path: t }, {});
      assert.equal(out.hookSpecificOutput.additionalContext, 'Context: about 41k tokens.');
    } finally {
      fs.rmSync(base, { recursive: true, force: true });
    }
  });
});

test('a transcript it cannot read gives null and the gauge says nothing', async () => {
  await withHome(async (home) => {
    const { base, main } = makeProject();
    try {
      assert.equal(contextSize(path.join(base, 'missing.jsonl')), null);
      assert.equal(contextSize(undefined), null);
      const empty = writeTranscript(base, ['{"type":"user"}']);
      assert.equal(contextSize(empty), null);
      assert.equal(await gauge({ cwd: main, session_id: 's1', transcript_path: empty }, {}), undefined);
      assert.equal(await gauge({ cwd: main, session_id: 's1', transcript_path: path.join(base, 'missing') }, {}), undefined);
      assert.equal(fs.existsSync(sessionFile(home, 's1')), false);
    } finally {
      fs.rmSync(base, { recursive: true, force: true });
    }
  });
});

test('the gauge takes its prepare point from the project\'s compactPrepare setting', async () => {
  await withHome(async (home) => {
    const { base, main } = makeProject();
    try {
      const view = path.join(path.dirname(path.dirname(sessionFile(home, 's1'))), 'views', 'settings.json');
      const at = (n) => writeTranscript(base, [assistant(usage(0, n, 0))]);
      const say = async (n) => (await gauge({ cwd: main, session_id: 's1', transcript_path: at(n) }, {})).hookSpecificOutput.additionalContext;
      assert.match(await say(150000), /^Context: about 150k tokens\.$/);
      fs.mkdirSync(path.dirname(view), { recursive: true });
      fs.writeFileSync(view, JSON.stringify({ compactPrepare: { value: 150000 } }));
      assert.match(await say(150000), /save state/);
      assert.doesNotMatch(await say(149000), /save state/);
      fs.writeFileSync(view, JSON.stringify({ compactPrepare: { value: 50 } }));
      assert.doesNotMatch(await say(150000), /save state/);
      assert.match(await say(200000), /save state/);
    } finally {
      fs.rmSync(base, { recursive: true, force: true });
    }
  });
});

test('the gauge asks to save state from 200,000 tokens', async () => {
  await withHome(async (home) => {
    const { base, main } = makeProject();
    try {
      const low = writeTranscript(base, [assistant(usage(10, 41000, 800))]);
      const out = await gauge({ cwd: main, session_id: 's1', transcript_path: low }, {});
      assert.equal(out.hookSpecificOutput.hookEventName, 'UserPromptSubmit');
      assert.equal(out.hookSpecificOutput.additionalContext, 'Context: about 41k tokens.');
      assert.equal(JSON.parse(fs.readFileSync(sessionFile(home, 's1'), 'utf8')).tokens, 41810);

      const high = writeTranscript(base, [assistant(usage(0, 200000, 0))]);
      const out2 = await gauge({ cwd: main, session_id: 's1', transcript_path: high }, {});
      assert.equal(out2.hookSpecificOutput.additionalContext, 'Context: about 200k tokens. Finish this step, save state, then carry on.');
      const just = writeTranscript(base, [assistant(usage(9, 199990, 0))]);
      assert.equal((await gauge({ cwd: main, session_id: 's1', transcript_path: just }, {})).hookSpecificOutput.additionalContext, 'Context: about 199k tokens.');

      // An odd session id stores no reading but the gauge still speaks.
      const odd = await gauge({ cwd: main, session_id: '../evil', transcript_path: low }, {});
      assert.ok(odd.hookSpecificOutput.additionalContext.startsWith('Context:'));
      assert.deepEqual(fs.readdirSync(path.dirname(sessionFile(home, 's1'))), ['s1.json']);

      // Outside a Wheelhouse project it prints nothing.
      const other = temp('wh-ctx-other-');
      try {
        assert.equal(await gauge({ cwd: other, session_id: 's1', transcript_path: low }, {}), undefined);
      } finally {
        fs.rmSync(other, { recursive: true, force: true });
      }
    } finally {
      fs.rmSync(base, { recursive: true, force: true });
    }
  });
});

const toolCall = (main, file, id = 's1') => ({ hook_event_name: 'PostToolUse', cwd: main, session_id: id, transcript_path: file });

test('a tool call speaks once per episode, at the prepare point, and records preparedAt', async () => {
  await withHome(async (home) => {
    const { base, main } = makeProject();
    try {
      let ms = Date.parse('2026-11-03T00:00:00Z');
      const now = () => new Date(ms);
      const low = writeTranscript(base, [assistant(usage(0, 150000, 0))]);
      assert.equal(await onTool(toolCall(main, low), { now }), undefined);
      assert.equal(JSON.parse(fs.readFileSync(sessionFile(home, 's1'), 'utf8')).preparedAt, undefined);
      const high = writeTranscript(base, [assistant(usage(0, 230000, 0))]);
      // Read within five seconds: the transcript is not read again.
      ms += 4000;
      assert.equal(await onTool(toolCall(main, high), { now }), undefined);
      ms += 2000;
      const out = await onTool(toolCall(main, high), { now });
      assert.equal(out.hookSpecificOutput.hookEventName, 'PostToolUse');
      assert.equal(out.hookSpecificOutput.additionalContext, 'Context is about 230k tokens. Finish this step, commit, write your session note, then carry on.');
      const stored = JSON.parse(fs.readFileSync(sessionFile(home, 's1'), 'utf8'));
      assert.equal(stored.tokens, 230000);
      assert.ok(stored.preparedAt);
      ms += 60000;
      assert.equal(await onTool(toolCall(main, high), { now }), undefined);
      // A reset (part 3 clears preparedAt on compaction) lets it speak again.
      updateSession(sessionFile(home, 's1'), { preparedAt: undefined });
      assert.ok(await onTool(toolCall(main, high), { now }));
    } finally {
      fs.rmSync(base, { recursive: true, force: true });
    }
  });
});

test('a tool call says nothing without a reading, a project or a usable session id, and UserPromptSubmit is unchanged', async () => {
  await withHome(async () => {
    const { base, main } = makeProject();
    try {
      const high = writeTranscript(base, [assistant(usage(0, 230000, 0))]);
      assert.equal(await onTool(toolCall(main, path.join(base, 'missing.jsonl')), {}), undefined);
      assert.equal(await onTool(toolCall(main, high, '../evil'), {}), undefined);
      assert.equal(await onTool({ hook_event_name: 'PostToolUse', cwd: 5 }, {}), undefined);
      const other = temp('wh-ctx-other-');
      try {
        assert.equal(await onTool(toolCall(other, high), {}), undefined);
      } finally {
        fs.rmSync(other, { recursive: true, force: true });
      }
      // Other events never prepare through the feature-status hook.
      assert.equal(await onTool({ ...toolCall(main, high), hook_event_name: 'Stop' }, {}), undefined);
      const out = await gauge({ cwd: main, session_id: 's1', transcript_path: high }, {});
      assert.equal(out.hookSpecificOutput.hookEventName, 'UserPromptSubmit');
      assert.match(out.hookSpecificOutput.additionalContext, /save state/);
    } finally {
      fs.rmSync(base, { recursive: true, force: true });
    }
  });
});

test('the gauge says the reading and keeps nothing under the home for an agent whose hooks only read', async () => {
  await withHome(async (home) => {
    const { base, main } = makeProject();
    try {
      const t = writeTranscript(base, [assistant(usage(1, 41000, 0))]);
      const out = await gauge({ cwd: main, session_id: 's1', transcript_path: t }, { writeVia: 'helper' });
      assert.equal(out.hookSpecificOutput.additionalContext, 'Context: about 41k tokens.');
      assert.equal(fs.existsSync(sessionFile(home, 's1')), false);
    } finally {
      fs.rmSync(base, { recursive: true, force: true });
    }
  });
});
