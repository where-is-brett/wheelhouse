// tests/scripts/hooks/context.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { contextSize, decide as gauge, updateSession } from '../../../scripts/hooks/context-gauge.js';
import { decide as guard } from '../../../scripts/hooks/precompact-guard.js';
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

const marker = (main, id) => path.join(main, '.claude', 'state', `unsaved-${id}`);
const unsave = (main, id) => {
  fs.mkdirSync(path.dirname(marker(main, id)), { recursive: true });
  fs.writeFileSync(marker(main, id), '');
};
const compact = (main, extra = {}) => ({ cwd: main, session_id: 's1', trigger: 'auto', ...extra });
const blocked = (out) => out?.decision === 'block';

test('the guard blocks an automatic compaction while work is unsaved', async () => {
  await withHome(async () => {
    const { base, main } = makeProject();
    try {
      const t0 = new Date('2026-10-18T01:00:00.000Z');
      assert.equal(await guard(compact(main), { now: () => t0 }), undefined);
      unsave(main, 's1');
      const out = await guard(compact(main), { now: () => t0 });
      assert.ok(blocked(out));
      assert.equal(typeof out.reason, 'string');
      // Another session's marker does not count.
      assert.equal(await guard(compact(main, { session_id: 's2' }), { now: () => t0 }), undefined);
      // A marker that is a symlink, even a dangling one, still counts.
      fs.rmSync(marker(main, 's1'));
      fs.symlinkSync(path.join(base, 'nowhere'), marker(main, 's1'));
      assert.ok(blocked(await guard(compact(main), { now: () => new Date(t0.getTime() + 1000) })));
      // Not in a Wheelhouse project: nothing.
      assert.equal(await guard(compact(base), { now: () => t0 }), undefined);
    } finally {
      fs.rmSync(base, { recursive: true, force: true });
    }
  });
});

test('the guard gives up two minutes after its first block, and near the limit', async () => {
  await withHome(async (home) => {
    const { base, main } = makeProject();
    try {
      const t0 = new Date('2026-10-18T01:00:00.000Z');
      const at = (ms) => ({ now: () => new Date(t0.getTime() + ms) });
      unsave(main, 's1');
      assert.ok(blocked(await guard(compact(main), at(0))));
      assert.ok(JSON.parse(fs.readFileSync(sessionFile(home, 's1'), 'utf8')).firstBlockAt);
      assert.ok(blocked(await guard(compact(main), at(119999))));
      assert.equal(await guard(compact(main), at(120000)), undefined);

      // Near the limit lets it through at once, and a lower reading does not.
      unsave(main, 's2');
      const file = sessionFile(home, 's2');
      fs.writeFileSync(file, JSON.stringify({ tokens: 359999 }));
      assert.ok(blocked(await guard(compact(main, { session_id: 's2' }), at(0))));
      assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).tokens, 359999);
      unsave(main, 's3');
      fs.mkdirSync(path.dirname(sessionFile(home, 's3')), { recursive: true });
      fs.writeFileSync(sessionFile(home, 's3'), JSON.stringify({ tokens: 360000 }));
      assert.equal(await guard(compact(main, { session_id: 's3' }), at(0)), undefined);

      // No reading: no near-the-limit escape, but the two-minute one applies.
      unsave(main, 's4');
      assert.ok(blocked(await guard(compact(main, { session_id: 's4' }), at(0))));
      assert.equal(await guard(compact(main, { session_id: 's4' }), at(130000)), undefined);

      // A reading and the first-block time live in the same file.
      const kept = JSON.parse(fs.readFileSync(file, 'utf8'));
      assert.equal(kept.tokens, 359999);
      assert.ok(kept.firstBlockAt);
    } finally {
      fs.rmSync(base, { recursive: true, force: true });
    }
  });
});

test('the guard never blocks a manual compaction', async () => {
  await withHome(async () => {
    const { base, main } = makeProject();
    try {
      unsave(main, 's1');
      assert.equal(await guard(compact(main, { trigger: 'manual' }), {}), undefined);
      assert.equal(await guard(compact(main, { trigger: undefined }), {}), undefined);
    } finally {
      fs.rmSync(base, { recursive: true, force: true });
    }
  });
});

test('a later compaction in the same session is blocked again', async () => {
  await withHome(async (home) => {
    const { base, main } = makeProject();
    try {
      const t0 = new Date('2026-10-18T01:00:00.000Z');
      const at = (ms) => ({ now: () => new Date(t0.getTime() + ms) });
      unsave(main, 's1');
      assert.ok(blocked(await guard(compact(main), at(0))));
      assert.equal(await guard(compact(main), at(125000)), undefined);
      assert.equal(JSON.parse(fs.readFileSync(sessionFile(home, 's1'), 'utf8')).firstBlockAt, undefined);
      assert.ok(blocked(await guard(compact(main), at(3 * 3600000))));
      // Letting one through because nothing is unsaved clears it too.
      fs.rmSync(marker(main, 's1'));
      assert.equal(await guard(compact(main), at(3 * 3600000 + 1000)), undefined);
      assert.equal(JSON.parse(fs.readFileSync(sessionFile(home, 's1'), 'utf8')).firstBlockAt, undefined);
      // And so does the near-the-limit escape.
      unsave(main, 's1');
      assert.ok(blocked(await guard(compact(main), at(6 * 3600000))));
      updateSession(sessionFile(home, 's1'), { tokens: 370000 });
      assert.equal(await guard(compact(main), at(6 * 3600000 + 1000)), undefined);
      assert.equal(JSON.parse(fs.readFileSync(sessionFile(home, 's1'), 'utf8')).firstBlockAt, undefined);
    } finally {
      fs.rmSync(base, { recursive: true, force: true });
    }
  });
});

test('the marker is looked for at the root of the worktree holding cwd', async () => {
  await withHome(async () => {
    const { base, main } = makeProject();
    try {
      const sub = path.join(main, 'src', 'deep');
      fs.mkdirSync(sub, { recursive: true });
      unsave(main, 's1');
      assert.ok(blocked(await guard(compact(sub), { now: () => new Date() })));
      // A marker only in the subfolder does not count.
      fs.rmSync(marker(main, 's1'));
      unsave(sub, 's1');
      assert.equal(await guard(compact(sub), { now: () => new Date() }), undefined);
    } finally {
      fs.rmSync(base, { recursive: true, force: true });
    }
  });
});
