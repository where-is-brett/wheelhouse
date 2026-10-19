// tests/helpers/setup-answers.js
// A product folder step 3 has connected, for steps 4 and 5: a registered project with its records'
// clone in place and a .git of its own, this computer's key enrolled, a scratch Wheelhouse home, a
// scratch user home (with a space and an accent) and a scratch Claude Code folder through
// CLAUDE_CONFIG_DIR, so nothing reads or writes the real ~/.claude. `plan(step)` is the helper's
// /setup/plan on the real steps; `answer(card, label)` is the director's click on that card, as the
// prompt record sees it, with a stand-in helper that takes every record and keeps what was sent.
import fs from 'node:fs';
import path from 'node:path';
import { setupRoutes } from '../../scripts/setup/engine.js';
import { decide } from '../../scripts/hooks/prompt-record.js';
import { makeSigningKey, enrol } from '../../scripts/state/signing.js';
import { writeProject } from '../../scripts/lib/projects.js';
import { stateDir } from '../../scripts/lib/paths.js';
import { as, shortHome, tempFolder } from './homes.js';

export const T0 = new Date('2026-10-20T03:00:00.000Z');
export const REPO = 'o/Cafe-Menu';
export const SLUG = 'o__Cafe-Menu';

// Lays out `files` ({ relative path: text }) in `folder`.
export function lay(folder, files) {
  for (const [file, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(folder, file)), { recursive: true });
    fs.writeFileSync(path.join(folder, file), text);
  }
}

// A Claude Code session's transcript in the scratch Claude Code folder: `entries` as its lines.
export function transcript(config, dir, name, entries) {
  fs.mkdirSync(path.join(config, 'projects', dir), { recursive: true });
  fs.writeFileSync(path.join(config, 'projects', dir, `${name}.jsonl`), `${entries.map((e) => (typeof e === 'string' ? e : JSON.stringify(e))).join('\n')}\n`);
}

// One typed message of the director's in a session whose working folder is `cwd`.
export const typed = (cwd, text) => ({ type: 'user', cwd, message: { role: 'user', content: text } });

export async function withProject(fn, { files = {}, connected = true } = {}) {
  const home = shortHome();
  const user = tempFolder('wh-user zoë ');
  const config = path.join(user, 'claude config');
  fs.mkdirSync(config, { recursive: true });
  const made = path.join(user, 'Projects', 'Café Menu');
  fs.mkdirSync(made, { recursive: true });
  const folder = fs.realpathSync.native(made);
  lay(folder, files);
  const before = process.env.CLAUDE_CONFIG_DIR;
  process.env.CLAUDE_CONFIG_DIR = config;
  try {
    return await as(home, async () => {
      const { computer, publicKey } = makeSigningKey();
      enrol({ computer, publicKey, enrolledAt: '2026-10-20T00:00:00.000Z' });
      const connect = () => {
        fs.mkdirSync(path.join(folder, '.git'), { recursive: true });
        writeProject(SLUG, { folder, remoteUrl: `https://github.com/${REPO}.git`, host: 'github', repo: REPO, connection: {} });
        fs.mkdirSync(path.join(stateDir(SLUG), '.git'), { recursive: true });
      };
      if (connected) connect();
      const routes = setupRoutes({ now: () => T0, userHome: user });
      const plan = (step) => routes['/setup/plan']({ folder, step });
      const sent = [];
      const client = {
        prState: async () => ({ ok: false }),
        state: {
          write: async (body) => { sent.push({ route: 'write', body }); return { ok: true, id: body.id }; },
          record: async (body) => { sent.push({ route: 'record', body }); return { ok: true, id: body.event?.id }; },
        },
        profile: { record: async (body) => { sent.push({ route: 'profile-record', body }); return { ok: true }; } },
      };
      const answer = async (card, label, { cwd = folder } = {}) => {
        const from = sent.length;
        await decide({
          cwd, hook_event_name: 'PostToolUse', tool_name: 'AskUserQuestion',
          tool_input: { questions: [card], answers: { [card.question]: label } },
          tool_response: { answers: { [card.question]: label } },
        }, { client, now: () => new Date(T0.getTime() - 60 * 1000) });
        return sent.slice(from);
      };
      return fn({ home, user, config, folder, plan, answer, sent, connect });
    });
  } finally {
    if (before === undefined) delete process.env.CLAUDE_CONFIG_DIR; else process.env.CLAUDE_CONFIG_DIR = before;
  }
}
