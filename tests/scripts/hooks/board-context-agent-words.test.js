// tests/scripts/hooks/board-context-agent-words.test.js
// The cards line in the agent's own words (ruling P5-54): on Copilot the board context's line names Copilot's
// clickable-question tool and the Wheelhouse command's `cards`, and under STOP at Lean the Lean command's
// `confirm lift-stop`, never AskUserQuestion or `cli.js cards`; Claude Code's line is as it was.
import '../../helpers/homes.js';
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { standInTools } from '../../helpers/host-stand-ins.js';
import { as, shortHome } from '../../helpers/homes.js';
import { decide, cardsLine } from '../../../scripts/hooks/board-context.js';
import { askTool, cardsLineFor } from '../../../scripts/agents/card-words.js';
import { TOOL_SHEETS } from '../../../scripts/agents/tool-sheets.js';
import { registerLean } from '../../../scripts/lean/project.js';
import { writeProject } from '../../../scripts/lib/projects.js';
import { setStop, liftStop } from '../../../scripts/lib/stop.js';

const stand = standInTools();
after(() => stand.restore());

const NOW = '2026-10-24T03:00:00.000Z';
const CLAUDE_CODE_WORDS = /AskUserQuestion|cli\.js cards/;

// A computer with a Lean project and a Claude Code project, each in a folder with a .git folder, and `waiting`
// cards no visit has handed out in each one's views.
function computer(waiting = 2) {
  const home = shortHome();
  const folder = (name) => {
    const dir = path.join(shortHome(), name);
    fs.mkdirSync(path.join(dir, '.git'), { recursive: true });
    fs.writeFileSync(path.join(dir, '.git', 'HEAD'), 'ref: refs/heads/main\n');
    return fs.realpathSync.native(dir);
  };
  const lean = folder('shop');
  const cc = folder('cc');
  return as(home, () => {
    registerLean({ project: 'shop', folder: lean, now: () => new Date(NOW) });
    writeProject('owner__cc', { folder: cc, remoteUrl: 'https://example.com/owner/cc.git', host: 'github', repo: 'owner/cc', connection: {} });
    for (const project of ['shop', 'owner__cc']) {
      const views = path.join(home, 'projects', project, 'views');
      fs.mkdirSync(views, { recursive: true });
      const cards = Array.from({ length: waiting }, (_, i) => ({ id: `card-${i}`, asked: null, at: NOW, data: { question: `Question ${i}?`, options: ['Yes', 'Not now'] } }));
      fs.writeFileSync(path.join(views, 'waiting.json'), JSON.stringify(cards));
    }
    return { home, lean, cc };
  });
}

const contextOf = (out) => out?.hookSpecificOutput?.additionalContext;
const copilot = (cwd) => decide({ cwd, prompt: 'Hello', session_id: 's1', hook_event_name: 'UserPromptSubmit' }, {
  writeVia: 'helper', agent: 'copilot', helperUp: true, now: () => new Date(NOW), dir: path.join(cwd, 'no-managed-copy'),
});
const claudeCode = (cwd) => decide({ cwd, prompt: 'Hello', session_id: 's2', hook_event_name: 'UserPromptSubmit' }, {
  agent: 'claude-code', now: () => new Date(NOW), dir: path.join(cwd, 'no-managed-copy'), load: async () => ({ none: true }),
});

test('Copilot\'s tool comes from its tool sheet, and Claude Code keeps the core\'s line', () => {
  assert.equal(askTool('copilot'), 'ask_user (askQuestions in VS Code)');
  assert.ok(TOOL_SHEETS.copilot.includes(`Your clickable-question tool is ${askTool('copilot')}.`));
  assert.equal(askTool('claude-code'), 'AskUserQuestion');
  assert.equal(askTool('an-agent-nobody-knows'), null);
  assert.equal(cardsLineFor('claude-code', { count: 2 }), null);
  assert.equal(cardsLineFor(undefined, { count: 2 }), null);
  for (const [lean, stop] of [[false, false], [true, false], [false, true], [true, true]]) {
    const line = cardsLineFor('copilot', { count: 2, lean, stop });
    assert.doesNotMatch(line, CLAUDE_CODE_WORDS, `lean ${lean}, stop ${stop}`);
    assert.doesNotMatch(line, /cli\.js/);
  }
  assert.equal(cardsLineFor('copilot', { count: 2 }), 'Cards to ask this visit: 2. Run the Wheelhouse command\'s `cards` and ask them in one call of ask_user (askQuestions in VS Code), after the briefing.');
  assert.match(cardsLineFor('copilot', { count: 1, lean: true, stop: true }), /the Lean command's `confirm lift-stop`/);
});

test('on Copilot the board context\'s cards line is in Copilot\'s words, and under STOP at Lean names the window', async () => {
  const c = await computer();
  await as(c.home, async () => {
    assert.equal(contextOf(await copilot(c.lean)), cardsLineFor('copilot', { count: 2, lean: true }));
    assert.equal(contextOf(await copilot(c.cc)), cardsLineFor('copilot', { count: 2 }));
    setStop({ by: 'helper' });
    try {
      const stopped = contextOf(await copilot(c.lean));
      assert.equal(stopped, cardsLineFor('copilot', { count: 1, lean: true, stop: true }));
      assert.doesNotMatch(stopped, CLAUDE_CODE_WORDS);
      assert.equal(contextOf(await copilot(c.cc)), cardsLineFor('copilot', { count: 1, stop: true }));
    } finally {
      liftStop();
    }
  });
});

test('Claude Code\'s cards line is as it was', async () => {
  const c = await computer(1);
  await as(c.home, async () => {
    const got = contextOf(await claudeCode(c.cc));
    assert.ok(got.startsWith(cardsLine(1)), got);
    assert.equal(cardsLine(1), 'Cards to ask this visit: 1. Run `cli.js cards` and ask them in one AskUserQuestion call, after the briefing.');
  });
});

test('no real copilot, gh, glab or curl ran', () => {
  assert.deepEqual(stand.calls(), []);
});
