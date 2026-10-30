// scripts/engine/broker/queue.js
// The calls the merge queue may make from its own folder (check 81), checked before the broker's list decides them.
// In that folder gh is the broker alone (queue-folder.js lifts the deny there for it), so this is the whole of what the
// queue's steps reach: reads, merges and re-runs of failed jobs as the list allows them, and one write, a queued pull
// request's text replaced from the body file the sweep wrote in its own run's artefacts. The file is read here and sent
// on as standard input, so the list's verdict rule reads the text that will be posted. Anything else is refused.
import fs from 'node:fs';
import path from 'node:path';
import { classifyCall } from './rules.js';

const NUMBER = /^[1-9]\d{0,9}$/;
const RUN = /^[A-Za-z0-9_-]{1,128}$/;
// The most of a body file the broker reads.
export const BODY_MOST = 64 * 1024;
// The kinds of call the queue makes besides that edit.
const QUEUE_KINDS = ['read', 'merge', 'rerun'];
const ONLY = 'from the merge queue\'s folder only reads, merges, re-runs of failed jobs and a queued pull request\'s text from its body file are made';

// queueCall({ argv, stdin, repo, artefacts, ready }) -> { ok: true, argv, stdin } | { ok: false, refused }
// `repo` is the project's repository, `owner/name`; `artefacts` the folder holding the project's runs' artefacts
// (<archon home>/workspaces/mirrors/<project>/artifacts/runs); `ready` the pull requests the helper marked ready, by number.
export function queueCall({ argv, stdin = '', repo = null, artefacts, ready = {} } = {}) {
  const words = (Array.isArray(argv) ? argv : []).map(String);
  if (words[0] === 'pr' && words[1] === 'edit') return bodyEdit(words.slice(2), { artefacts, ready });
  const call = classifyCall(words, { stdin, repo });
  return QUEUE_KINDS.includes(call.kind) ? { ok: true, argv: words, stdin } : { ok: false, refused: ONLY };
}

// `gh pr edit <n> --body-file <file>`, with --repo kept for the list to check, sent on as `--body-file -`.
function bodyEdit(words, { artefacts, ready }) {
  let number = null;
  let file = null;
  const kept = [];
  for (let i = 0; i < words.length; i += 1) {
    const word = words[i];
    if (word === '--body-file' || word === '-F') {
      if (file !== null || i + 1 >= words.length) return { ok: false, refused: ONLY };
      file = words[i += 1];
    } else if (word.startsWith('--body-file=')) {
      if (file !== null) return { ok: false, refused: ONLY };
      file = word.slice('--body-file='.length);
    } else if (word === '--repo' || word === '-R') {
      if (i + 1 >= words.length) return { ok: false, refused: ONLY };
      kept.push(word, words[i += 1]);
    } else if (word.startsWith('--repo=')) {
      kept.push(word);
    } else if (!word.startsWith('-') && number === null) {
      number = word;
    } else {
      return { ok: false, refused: ONLY };
    }
  }
  if (number === null || !NUMBER.test(number) || file === null) return { ok: false, refused: ONLY };
  if (!Object.hasOwn(ready ?? {}, number)) return { ok: false, refused: `pull request #${number} isn't in the merge queue` };
  const text = bodyFile(file, { artefacts, number });
  if (text === null) return { ok: false, refused: `the body file for #${number} isn't the sweep's own, pr-body-${number}.md in its run's artefacts` };
  return { ok: true, argv: ['pr', 'edit', number, '--body-file', '-', ...kept], stdin: text };
}

// The text of <artefacts>/<run>/pr-body-<number>.md, by real paths, when `file` is that plain file and not too long;
// otherwise null.
function bodyFile(file, { artefacts, number }) {
  if (typeof file !== 'string' || !path.isAbsolute(file) || typeof artefacts !== 'string') return null;
  let stat;
  let root;
  let real;
  try {
    stat = fs.lstatSync(file);
    root = fs.realpathSync.native(artefacts);
    real = fs.realpathSync.native(file);
  } catch {
    return null;
  }
  if (!stat.isFile() || stat.size > BODY_MOST) return null;
  const parts = path.relative(root, real).split(path.sep);
  if (parts.length !== 2 || !RUN.test(parts[0]) || parts[1] !== `pr-body-${number}.md`) return null;
  try { return fs.readFileSync(real, 'utf8'); } catch { return null; }
}
